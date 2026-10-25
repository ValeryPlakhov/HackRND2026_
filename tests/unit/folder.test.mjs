// Opening a real folder in the browser: reads text files, mirrors every change to disk, keeps memory consistent on failure.
import test from "node:test";
import assert from "node:assert/strict";

class FakeFile {
  constructor(text) {
    this.text = text;
  }
  async getFile() {
    return { size: this.text.length, text: async () => this.text };
  }
}

class FakeDirectory {
  constructor(name, failWrites = false) {
    this.kind = "directory";
    this.name = name;
    this.children = new Map();
    this.failWrites = failWrites;
  }
  async *entries() {
    for (const [name, child] of this.children) yield [name, child.kind === "directory" ? child : { kind: "file", getFile: () => child.getFile() }];
  }
  async getDirectoryHandle(name, { create = false } = {}) {
    let child = this.children.get(name);
    if (!child && create) this.children.set(name, (child = new FakeDirectory(name, this.failWrites)));
    if (!child) throw Object.assign(new Error("missing"), { name: "NotFoundError" });
    return child;
  }
  async getFileHandle(name, { create = false } = {}) {
    let child = this.children.get(name);
    if (!child && create) this.children.set(name, (child = Object.assign(new FakeFile(""), { kind: "file", name })));
    if (!child) throw Object.assign(new Error("missing"), { name: "NotFoundError" });
    const file = child;
    return {
      createWritable: async () => ({
        write: async (value) => {
          if (this.failWrites) throw new Error("disk is read-only");
          file.text = value;
        },
        close: async () => {},
      }),
    };
  }
  async removeEntry(name) {
    if (!this.children.delete(name)) throw Object.assign(new Error("missing"), { name: "NotFoundError" });
  }
  put(path, text) {
    const parts = path.split("/");
    const name = parts.pop();
    let directory = this;
    for (const part of parts) {
      if (!directory.children.has(part)) directory.children.set(part, new FakeDirectory(part, this.failWrites));
      directory = directory.children.get(part);
    }
    directory.children.set(name, Object.assign(new FakeFile(text), { kind: "file", name }));
  }
  read(path) {
    let node = this;
    for (const part of path.split("/")) node = node.children.get(part);
    return node?.text;
  }
}

async function open(root) {
  globalThis.window = globalThis;
  globalThis.localStorage ??= { getItem: () => null, setItem: () => {} };
  globalThis.window.showDirectoryPicker = async () => root;
  const { BrowserBridge } = await import("../../web/ide/bridge.mjs");
  const bridge = new BrowserBridge();
  const opened = await bridge.chooseFolder();
  return { bridge, opened };
}

test("an opened folder is read, junk is skipped and the project says it is saved to disk", async () => {
  const root = new FakeDirectory("shop");
  root.put("src/A.java", "class A {}");
  root.put("README.md", "# shop");
  root.put("node_modules/x.js", "skip");
  root.put("target/classes/B.java", "skip");
  root.put("logo.png", "binary");
  const { bridge, opened } = await open(root);
  assert.equal(opened.project.name, "shop");
  assert.equal(opened.project.capabilities.disk, true);
  assert.deepEqual([...bridge.files.keys()].sort(), ["README.md", "src/A.java"]);
});

test("saving, creating, renaming and deleting reach the folder", async () => {
  const root = new FakeDirectory("shop");
  root.put("src/A.java", "class A {}");
  const { bridge, opened } = await open(root);
  const id = opened.project.id;
  const file = await bridge.read(id, "src/A.java");
  await bridge.write(id, { path: "src/A.java", content: "class A { int x; }", expectedHash: file.hash });
  assert.equal(root.read("src/A.java"), "class A { int x; }");
  await bridge.create(id, { path: "src/B.java", kind: "file", content: "class B {}" });
  assert.equal(root.read("src/B.java"), "class B {}");
  await bridge.rename(id, { path: "src/B.java", to: "src/C.java" });
  assert.equal(root.read("src/C.java"), "class B {}");
  assert.equal(root.read("src/B.java"), undefined);
  await bridge.trash(id, "src/C.java");
  assert.equal(root.read("src/C.java"), undefined);
  assert.equal(bridge.files.has("src/C.java"), false);
});

test("a failed write leaves the in-memory copy untouched", async () => {
  const root = new FakeDirectory("shop");
  root.put("A.java", "class A {}");
  const { bridge, opened } = await open(root);
  const id = opened.project.id;
  const file = await bridge.read(id, "A.java");
  root.failWrites = true;
  await assert.rejects(bridge.write(id, { path: "A.java", content: "class A { }", expectedHash: file.hash }), /read-only/);
  assert.equal(bridge.files.get("A.java"), "class A {}");
});

test("running a project sends package paths and the chosen main class", async () => {
  const root = new FakeDirectory("app");
  root.put("src/main/java/app/Main.java", "package app; class Main { public static void main(String[] a) {} }");
  root.put("src/test/java/app/MainTest.java", "package app; class MainTest {}");
  const { bridge, opened } = await open(root);
  const sent = [];
  bridge.client = {
    request: async (route, body) => (sent.push({ route, body }), { success: true, stdout: "", stderr: "" }),
    startJob: async (kind, body) => (sent.push({ kind, body }), { result: { success: true, execution: { stdout: "ok", exitCode: 0 } } }),
  };
  await bridge.startTask(opened.project.id, { kind: "run", mainClass: "app.Main", input: "1" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const run = sent.find((item) => item.kind === "run");
  assert.deepEqual(Object.keys(run.body.files), ["src/main/java/app/Main.java"]);
  assert.equal(run.body.mainClass, "app.Main");
});
