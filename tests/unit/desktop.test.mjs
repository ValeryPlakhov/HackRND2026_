import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const { Workspace } = require("../../desktop/services/workspace.cjs");
const {
  LocalHistory,
  Persistence,
  normalizeSettings,
} = require("../../desktop/services/persistence.cjs");
const {
  ProjectSearch,
  findMatches,
} = require("../../desktop/services/search.cjs");
const {
  relative,
  inside,
  sha,
  publicError,
} = require("../../desktop/services/contracts.cjs");
const { parseStatus } = require("../../desktop/services/git.cjs");
const {
  parseJavacDiagnostics,
  discoverMain,
  argumentFileValue,
} = require("../../desktop/services/tasks.cjs");
const { ProjectInfo } = require("../../desktop/services/project-info.cjs");
const ROOT = fileURLToPath(new URL("../../", import.meta.url));

async function fixture(callback) {
  const base = path.join(ROOT, "tmp", "ide-tests");
  await fs.mkdir(base, { recursive: true });
  const temporary = await fs.mkdtemp(path.join(base, "case-"));
  const project = path.join(temporary, "project");
  await fs.mkdir(project);
  await fs.mkdir(path.join(project, "src"));
  await fs.writeFile(
    path.join(project, "src/Main.java"),
    'package demo;\npublic class Main { public static void main(String[] args) { System.out.println("ok"); } }\n',
  );
  const history = new LocalHistory(path.join(temporary, "state"));
  const workspace = new Workspace({ history });
  try {
    const opened = await workspace.open(project);
    await callback({ workspace, id: opened.id, project, history, temporary });
  } finally {
    workspace.close();
    assert.equal(inside(base, temporary), true);
    await fs.rm(temporary, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  }
}

test("desktop rejects traversal, device names and NTFS alternate data streams", () => {
  for (const value of [
    "../x",
    "C:\\Windows",
    "/etc/passwd",
    "src/../x",
    "x:stream",
    "a//b",
    "NUL.java",
    "con",
    "src/COM1.txt",
    "folder. /file",
    "a\0b",
  ])
    assert.throws(() => relative(value));
  assert.equal(relative("src\\demo\\Main.java"), "src/demo/Main.java");
});

test("desktop root containment does not accept sibling prefixes", () => {
  assert.equal(
    inside(path.resolve("project"), path.resolve("project-sibling/x")),
    false,
  );
  assert.equal(
    inside(path.resolve("project"), path.resolve("project/src/x")),
    true,
  );
});

test("desktop opening a folder scans nested Java sources", () =>
  fixture(async ({ workspace, id }) => {
    const scan = await workspace.scan(id, { textOnly: true });
    assert.equal(
      scan.files.some((file) => file.path === "src/Main.java"),
      true,
    );
    const entries = await workspace.list(id, "");
    assert.equal(entries[0].kind, "directory");
  }));

test("desktop stale project capabilities cannot read the next folder", () =>
  fixture(async ({ workspace, id, project }) => {
    await workspace.open(project);
    await assert.rejects(
      () => workspace.read(id, "src/Main.java"),
      (error) => error.code === "STALE_PROJECT",
    );
  }));

test("desktop read rejects binary and non UTF-8 files", () =>
  fixture(async ({ workspace, id, project }) => {
    await fs.writeFile(
      path.join(project, "binary.txt"),
      Buffer.from([1, 0, 2]),
    );
    await fs.writeFile(
      path.join(project, "legacy.txt"),
      Buffer.from([0xff, 0xfe, 0x99]),
    );
    await assert.rejects(
      () => workspace.read(id, "binary.txt"),
      (error) => error.code === "BINARY",
    );
    await assert.rejects(
      () => workspace.read(id, "legacy.txt"),
      (error) => error.code === "ENCODING",
    );
  }));

test("desktop atomic save retains previous version and rejects stale hashes", () =>
  fixture(async ({ workspace, id, history, project }) => {
    const original = await workspace.read(id, "src/Main.java");
    const saved = await workspace.write(id, {
      path: original.path,
      content: "class Main {}",
      expectedHash: original.hash,
    });
    assert.notEqual(saved.hash, original.hash);
    assert.equal(
      (await workspace.read(id, original.path)).content,
      "class Main {}",
    );
    await assert.rejects(
      () =>
        workspace.write(id, {
          path: original.path,
          content: "stale",
          expectedHash: original.hash,
        }),
      (error) => error.code === "CONFLICT",
    );
    const versions = await history.list(project, original.path);
    assert.equal(versions.length, 1);
    assert.equal(
      (await history.read(project, original.path, versions[0].id)).content,
      original.content,
    );
  }));

test("desktop save preserves UTF-8 BOM on request", () =>
  fixture(async ({ workspace, id, project }) => {
    const content = "привет\r\n";
    await workspace.write(id, {
      path: "text.txt",
      content,
      expectedHash: null,
      bom: true,
    });
    const raw = await fs.readFile(path.join(project, "text.txt"));
    assert.deepEqual([...raw.subarray(0, 3)], [239, 187, 191]);
    const read = await workspace.read(id, "text.txt");
    assert.equal(read.bom, true);
    assert.equal(read.eol, "CRLF");
    assert.equal(read.content, content);
  }));

test("desktop new file cannot overwrite an existing file", () =>
  fixture(async ({ workspace, id }) => {
    await assert.rejects(() =>
      workspace.create(id, {
        path: "src/Main.java",
        kind: "file",
        content: "overwrite",
      }),
    );
    assert.match(
      (await workspace.read(id, "src/Main.java")).content,
      /package demo/,
    );
  }));

test("desktop rename refuses collisions and root traversal", () =>
  fixture(async ({ workspace, id }) => {
    await workspace.create(id, {
      path: "other.java",
      kind: "file",
      content: "other",
    });
    await assert.rejects(
      () => workspace.rename(id, { path: "src/Main.java", to: "other.java" }),
      (error) => error.code === "EXISTS",
    );
    await assert.rejects(
      () => workspace.rename(id, { path: "src", to: "src/deep" }),
      (error) => error.code === "PATH",
    );
    await workspace.rename(id, { path: "other.java", to: "renamed.java" });
    assert.equal((await workspace.read(id, "renamed.java")).content, "other");
  }));

test("desktop excludes dependencies and build outputs from the project index", () =>
  fixture(async ({ workspace, id, project }) => {
    for (const folder of ["target", ".git", "node_modules", "build"]) {
      await fs.mkdir(path.join(project, folder));
      await fs.writeFile(
        path.join(project, folder, "Hidden.java"),
        "class Hidden {}",
      );
    }
    const scan = await workspace.scan(id);
    assert.equal(
      scan.files.some((file) => file.path.includes("Hidden")),
      false,
    );
  }));

test("desktop refuses directory junctions that point outside the selected root", () =>
  fixture(async ({ workspace, id, temporary, project }) => {
    const outside = path.join(temporary, "outside");
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, "secret.txt"), "outside");
    await fs.symlink(
      outside,
      path.join(project, "link"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const scan = await workspace.scan(id);
    assert.equal(
      scan.omitted.some((item) => item.reason === "SYMLINK"),
      true,
    );
    await assert.rejects(
      () => workspace.read(id, "link/secret.txt"),
      (error) => error.code === "SYMLINK",
    );
  }));

test("desktop search treats metacharacters literally and reports line offsets", () => {
  const result = findMatches("one\r\na.b\r\nA.B", "a.b");
  assert.equal(result.length, 2);
  assert.deepEqual([result[0].line, result[0].column], [2, 1]);
  assert.equal(
    findMatches("a.b aXb", "a.b", { caseSensitive: true }).length,
    1,
  );
});

test("desktop replace preview binds every change to original file hash", () =>
  fixture(async ({ workspace, id }) => {
    const search = new ProjectSearch(workspace);
    const preview = await search.previewReplace(id, {
      query: "System.out",
      replacement: "System.err",
    });
    assert.equal(preview.files, 1);
    assert.equal(preview.matches, 1);
    assert.match(preview.changes[0].after, /System.err/);
    const original = await workspace.read(id, "src/Main.java");
    assert.equal(preview.changes[0].expectedHash, original.hash);
    assert.match(original.content, /System.out/);
  }));

test("desktop history keeps its bounded most recent versions", () =>
  fixture(async ({ history, project }) => {
    history.maxVersions = 3;
    for (let index = 0; index < 6; index++)
      await history.capture(project, "A.java", Buffer.from(String(index)));
    const entries = await history.list(project, "A.java");
    assert.equal(entries.length, 3);
    assert.equal(
      (await history.read(project, "A.java", entries[0].id)).content,
      "5",
    );
  }));

test("desktop recent projects and sessions survive reopening persistence", () =>
  fixture(async ({ temporary, project }) => {
    const directory = path.join(temporary, "settings");
    const first = new Persistence(directory);
    await first.remember({
      root: project,
      name: "Example",
      buildSystem: "plain",
    });
    await first.saveSession(project, {
      tabs: ["src/Main.java"],
      active: "src/Main.java",
      expanded: ["src"],
    });
    const second = new Persistence(directory);
    assert.equal((await second.recent())[0].root, project);
    assert.deepEqual((await second.session(project)).tabs, ["src/Main.java"]);
  }));

test("desktop malformed settings recover to validated defaults", () => {
  const result = normalizeSettings({
    fontSize: 500,
    theme: "unknown",
    tabSize: -1,
    panelHeight: -50,
    wordWrap: "true",
    explorerWidth: 9999,
  });
  assert.equal(result.fontSize, 14);
  assert.equal(result.theme, "light");
  assert.equal(result.panelHeight, 130);
  assert.equal(result.wordWrap, false);
  assert.equal(result.explorerWidth, 420);
});

test("desktop Git parser handles paths containing spaces and renames", () => {
  const result = parseStatus(
    " M src/My Class.java\0R  renamed.java\0old.java\0?? New.java\0",
  );
  assert.equal(result[0].path, "src/My Class.java");
  assert.equal(result[1].from, "old.java");
  assert.equal(result[2].untracked, true);
});

test("desktop compiler diagnostics map Windows drive paths to project files", () => {
  const root = path.resolve("C:/project/source");
  const file = path.join(root, "demo/Main.java");
  const result = parseJavacDiagnostics(
    `${file}:3: error: cannot find symbol\n    x();\n    ^\n`,
    root,
  );
  assert.equal(result[0].path, "demo/Main.java");
  assert.equal(result[0].line, 3);
  assert.equal(result[0].column, 5);
});

test("desktop identifies a packaged main class for run configuration", () => {
  assert.equal(
    discoverMain(
      "package org.shop; public class Main { public static void main(String[] args) {} }",
    ),
    "org.shop.Main",
  );
  assert.equal(
    discoverMain("class Helper { int value() { return 1; } }"),
    null,
  );
});

test("desktop javac argument file quoting protects spaces and quote characters", () => {
  assert.equal(
    argumentFileValue("C:\\My Project\\Main.java"),
    '"C:\\\\My Project\\\\Main.java"',
  );
  assert.equal(argumentFileValue('a"b.java'), '"a\\"b.java"');
});

test("desktop overview reports entry points and packages without running code", () =>
  fixture(async ({ workspace, id }) => {
    const result = await new ProjectInfo(workspace).overview(id);
    assert.equal(result.javaFiles, 1);
    assert.equal(result.entryPoints[0].className, "demo.Main");
    assert.equal(result.packages[0].name, "demo");
  }));

test("desktop public errors describe missing and locked files", () => {
  assert.equal(publicError({ code: "ENOENT" }).code, "MISSING");
  assert.equal(publicError({ code: "EACCES" }).code, "ACCESS");
});
