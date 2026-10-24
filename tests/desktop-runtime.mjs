import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Workspace } = require("../desktop/services/workspace.cjs");
const { TaskService } = require("../desktop/services/tasks.cjs");
const { LocalHistory } = require("../desktop/services/persistence.cjs");
const { inside } = require("../desktop/services/contracts.cjs");
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const base = path.join(ROOT, "tmp", "desktop-runtime");
await fs.mkdir(base, { recursive: true });
const directory = await fs.mkdtemp(path.join(base, "test-"));
const project = path.join(directory, "Java проект с пробелами");
await fs.mkdir(path.join(project, "src", "demo"), { recursive: true });
const javaHome = path.join(ROOT, ".runtime", "desktop-java");
const workspace = new Workspace({
  history: new LocalHistory(path.join(directory, "state")),
});
const tasks = new TaskService(workspace, {
  javaHome,
  directory: path.join(directory, "state"),
});
let passed = 0;
const results = [];
const started = Date.now();

async function check(name, operation) {
  const time = Date.now();
  await operation();
  passed++;
  results.push({ name, passed: true, durationMs: Date.now() - time });
  console.log("PASS " + name);
}

async function source(name, content) {
  await fs.writeFile(path.join(project, "src", "demo", name), content, "utf8");
}
async function wait(job) {
  const deadline = Date.now() + 45000;
  let current = job;
  while (["queued", "running"].includes(current.status)) {
    if (Date.now() > deadline) throw new Error("Task wait timeout");
    await new Promise((resolve) => setTimeout(resolve, 80));
    current = tasks.get(job.id);
  }
  return current;
}

try {
  await source(
    "Main.java",
    "package demo; public class Main { public static void main(String[] args) { System.out.println(Helper.value()); } }",
  );
  await source(
    "Helper.java",
    'package demo; public class Helper { static String value() { java.sql.DriverManager.getDrivers(); javax.xml.parsers.DocumentBuilderFactory.newInstance(); if (java.awt.Color.RED.getRed() != 255) throw new AssertionError(); return "Привет, Java!"; } }',
  );
  const opened = await workspace.open(project);
  await check(
    "bundled Java compiles and runs a packaged multi-file project in a Unicode path",
    async () => {
      const result = await wait(
        await tasks.start(opened.id, { kind: "run", input: "" }),
      );
      assert.equal(result.status, "done", result.stderr);
      assert.equal(result.stdout.trim(), "Привет, Java!");
      assert.equal(result.mainClass, "demo.Main");
      assert.equal(
        (await fs.readdir(path.join(project, "src", "demo"))).some((name) =>
          name.endsWith(".class"),
        ),
        false,
      );
    },
  );
  await check(
    "compiler errors include actionable project-relative diagnostics",
    async () => {
      await source(
        "Helper.java",
        "package demo; public class Helper { static String value() { return missing; } }",
      );
      const result = await wait(
        await tasks.start(opened.id, { kind: "compile" }),
      );
      assert.equal(result.status, "failed");
      assert.ok(
        result.diagnostics.some(
          (item) => item.path === "src/demo/Helper.java" && item.line === 1,
        ),
      );
    },
  );
  await check(
    "explicit main class resolves multiple project entry points",
    async () => {
      await source(
        "Helper.java",
        'package demo; public class Helper { static String value(){return "helper";} public static void main(String[] args){System.out.println("selected");} }',
      );
      const result = await wait(
        await tasks.start(opened.id, { kind: "run", mainClass: "demo.Helper" }),
      );
      assert.equal(result.status, "done", result.stderr);
      assert.equal(result.stdout.trim(), "selected");
    },
  );
  await check("native run passes stdin as UTF-8", async () => {
    await source(
      "Main.java",
      "package demo; public class Main { public static void main(String[] args) { var s=new java.util.Scanner(System.in,java.nio.charset.StandardCharsets.UTF_8); System.out.println(s.nextLine()); } }",
    );
    const result = await wait(
      await tasks.start(opened.id, {
        kind: "run",
        mainClass: "demo.Main",
        input: "данные из IDE\n",
      }),
    );
    assert.equal(result.status, "done", result.stderr);
    assert.equal(result.stdout.trim(), "данные из IDE");
  });
  await check(
    "output flooding is stopped and reported as a failed task",
    async () => {
      await source(
        "Main.java",
        'package demo; public class Main { public static void main(String[] args) { while(true) System.out.println("0123456789012345678901234567890123456789"); } }',
      );
      const result = await wait(
        await tasks.start(opened.id, { kind: "run", mainClass: "demo.Main" }),
      );
      assert.equal(result.status, "failed");
      assert.equal(result.truncated, true);
      assert.ok(Buffer.byteLength(result.stdout) <= 256 * 1024);
    },
  );
  await check("cancellation terminates the active JVM task", async () => {
    await source(
      "Main.java",
      "package demo; public class Main { public static void main(String[] args) { while(true) {} } }",
    );
    const job = await tasks.start(opened.id, {
      kind: "run",
      mainClass: "demo.Main",
    });
    const deadline = Date.now() + 15000;
    while (!String(tasks.get(job.id).stage).startsWith("java ·")) {
      if (Date.now() > deadline) throw new Error("JVM did not start");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    tasks.cancel(job.id);
    const result = await wait(job);
    assert.equal(result.status, "cancelled");
  });
  await check("run timeout stops non-terminating Java", async () => {
    const result = await wait(
      await tasks.start(opened.id, { kind: "run", mainClass: "demo.Main" }),
    );
    assert.equal(result.status, "failed");
    assert.equal(result.timedOut, true);
  });
  const summary = {
    passed: true,
    tests: passed,
    results,
    durationSeconds: (Date.now() - started) / 1000,
    runtime: "bundled Java 21",
    platform: process.platform,
  };
  await fs.writeFile(
    path.join(ROOT, "docs/desktop-runtime-summary.json"),
    JSON.stringify(summary, null, 2),
  );
  console.log(JSON.stringify(summary));
} finally {
  tasks.close();
  workspace.close();
  assert.ok(inside(base, directory));
  await fs.rm(directory, {
    recursive: true,
    force: true,
    maxRetries: 4,
    retryDelay: 150,
  });
}
