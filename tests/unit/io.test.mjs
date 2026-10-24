import test from "node:test";
import assert from "node:assert/strict";
import {
  crc32,
  zipBytes,
  graphDot,
  graphMermaid,
  standaloneReport,
} from "../../web/lib/export.mjs";
import {
  MemoryStorage,
  WorkspaceStorage,
  STORAGE_KEY,
} from "../../web/lib/storage.mjs";
import { Workspace } from "../../web/lib/workspace.mjs";
import {
  arraySchema,
  importCaseJson,
  mergeCases,
  validateCases,
  parseConsoleCases,
  serializeConsoleCases,
  caseStatistics,
} from "../../web/lib/inputs.mjs";

const encode = (text) => new TextEncoder().encode(text);
test("ZIP CRC uses the standard published check vector", () =>
  assert.equal(crc32(encode("123456789")), 0xcbf43926));
test("empty ZIP has an end record with zero entries", () => {
  const bytes = zipBytes({});
  assert.equal(bytes.length, 22);
  assert.equal(new DataView(bytes.buffer).getUint32(0, true), 0x06054b50);
});
test("ZIP stores UTF-8 names and correct CRC, sizes and offsets", () => {
  const name = "src/Пример.java",
    content = "class Пример {}";
  const bytes = zipBytes({ [name]: content });
  const view = new DataView(bytes.buffer);
  const filename = encode(name),
    data = encode(content);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint16(6, true), 0x800);
  assert.equal(view.getUint32(14, true), crc32(data));
  assert.equal(view.getUint32(18, true), data.length);
  assert.deepEqual(bytes.slice(30, 30 + filename.length), filename);
  assert.deepEqual(
    bytes.slice(30 + filename.length, 30 + filename.length + data.length),
    data,
  );
  const end = bytes.length - 22;
  assert.equal(view.getUint16(end + 10, true), 1);
  assert.equal(
    view.getUint32(view.getUint32(end + 16, true), true),
    0x02014b50,
  );
});
for (const name of [
  "",
  "/root",
  "../x",
  "a/../b",
  "a\\b",
  "C:/secret",
  "a\0b",
  "a//b",
  "./x",
]) {
  test(`ZIP rejects unsafe filename ${JSON.stringify(name)}`, () =>
    assert.throws(() => zipBytes({ [name]: "" }), /Unsafe/));
}
test("graph exporters quote hostile labels", () => {
  const graph = { nodes: [{ id: "x", label: '<script>"\n' }], edges: [] };
  assert.match(graphDot(graph), /\\n/);
  assert.ok(!graphMermaid(graph).includes("<script>"));
});
test("standalone report escapes project and console output and includes CSP", () => {
  const html = standaloneReport(
    {
      name: "<script>alert(1)</script>",
      report: {
        passed: false,
        tests: [
          {
            passed: false,
            input: "<img>",
            baseline: { stdout: "<script>" },
            candidate: { stdout: "&" },
          },
        ],
      },
    },
    null,
  );
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;img&gt;"));
  assert.ok(html.includes("Content-Security-Policy"));
  assert.ok(html.includes("FAIL"));
});
test("unverified report does not produce a PASS badge", () =>
  assert.ok(
    standaloneReport({ name: "Test" }, null).includes(
      "<strong>UNVERIFIED</strong>",
    ),
  ));
test("storage round trip preserves sources while not retaining analysis", () => {
  const backend = new MemoryStorage(),
    storage = new WorkspaceStorage(backend);
  const workspace = new Workspace({ files: { "Main.java": "class Main {}" } });
  workspace.state.project = { large: "derived result" };
  assert.ok(storage.save(workspace));
  assert.equal(storage.load().files["Main.java"], "class Main {}");
  assert.equal(storage.load().project, undefined);
});
test("corrupt storage is recoverable", () => {
  const backend = new MemoryStorage(),
    storage = new WorkspaceStorage(backend);
  backend.setItem(STORAGE_KEY, "{");
  assert.equal(storage.load(), null);
  assert.ok(storage.lastError);
  storage.clear();
  assert.equal(backend.getItem(STORAGE_KEY), null);
});
test("storage rejects unknown schema and non-source values", () => {
  const backend = new MemoryStorage(),
    storage = new WorkspaceStorage(backend);
  for (const value of [
    { schema: 999, files: {}, baseline: {} },
    { schema: 2, files: { a: 7 }, baseline: {} },
  ]) {
    backend.setItem(STORAGE_KEY, JSON.stringify(value));
    assert.equal(storage.load(), null);
  }
});
test("quota errors are surfaced without throwing or claiming saved", () => {
  const storage = new WorkspaceStorage({
    setItem() {
      throw new Error("quota");
    },
  });
  assert.equal(storage.save(new Workspace({ files: { A: "a" } })), null);
  assert.match(storage.lastError.message, /quota/);
});
test("legacy workspace migrates its original baseline", () => {
  const backend = new MemoryStorage();
  backend.setItem(
    "blueprints-workspace-v1",
    JSON.stringify({
      file: "A.java",
      files: { "A.java": "new" },
      original: { "A.java": "old" },
    }),
  );
  const value = new WorkspaceStorage(backend).load();
  assert.equal(value.baseline["A.java"], "old");
  assert.equal(value.name, "A");
});
test("preferences round trip and invalid JSON fallback", () => {
  const backend = new MemoryStorage(),
    storage = new WorkspaceStorage(backend);
  assert.equal(storage.savePreferences({ theme: "light" }), true);
  assert.equal(storage.preferences().theme, "light");
  backend.setItem("blueprints-studio-preferences", "{");
  assert.deepEqual(storage.preferences(), {});
});
test("array schema accepts int limits and a zero-length array", () => {
  assert.deepEqual(arraySchema("0\n"), []);
  assert.deepEqual(
    arraySchema("2\n-2147483648 2147483647\n"),
    [-2147483648, 2147483647],
  );
});
for (const input of ["", "2\n1", "1 2147483648", "-1", "1 1.2", "1 NaN"]) {
  test(`array schema refuses malformed input ${JSON.stringify(input)}`, () =>
    assert.equal(arraySchema(input), null));
}
test("console case serialization retains an intentionally empty stdin", () => {
  const cases = parseConsoleCases("a\n---\n");
  assert.equal(cases.length, 2);
  assert.equal(cases[1].input, "");
  assert.equal(parseConsoleCases(serializeConsoleCases(cases)).length, 2);
});
test("JSON case import supports strings and metadata", () => {
  const cases = importCaseJson(
    JSON.stringify({
      inputs: ["", { name: "off", input: "0", enabled: false }],
    }),
  );
  assert.equal(cases[0].input, "");
  assert.equal(cases[1].enabled, false);
  assert.equal(cases[1].name, "off");
});
test("case import refuses empty, malformed, oversized and disabled-only suites", () => {
  for (const value of [
    [],
    {},
    [null],
    [4],
    [{ input: "", enabled: false }],
    ["x".repeat(32769)],
    Array(31).fill(""),
  ])
    assert.throws(() => importCaseJson(JSON.stringify(value)));
});
test("case merge deduplicates by stdin and enforces 30 entries", () => {
  const current = [{ input: "x" }],
    generated = Array.from({ length: 40 }, (_, i) => ({ input: String(i) }));
  assert.equal(mergeCases(current, [{ input: "x" }, ...generated]).length, 30);
  assert.equal(mergeCases(current, [{ input: "x" }]).length, 1);
});
test("case validation and statistics distinguish enabled and generated inputs", () => {
  const cases = [
    { input: "0\n", enabled: true, category: "manual" },
    { input: "hello", enabled: false, category: "random" },
  ];
  assert.deepEqual(validateCases(cases), []);
  assert.deepEqual(caseStatistics(cases), {
    total: 2,
    enabled: 1,
    characters: 7,
    generated: 1,
    compatibleArrays: 1,
  });
});
