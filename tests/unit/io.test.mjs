import test from "node:test";
import assert from "node:assert/strict";
import {
  crc32,
  zipBytes,
  graphDot,
  graphMermaid,
  standaloneReport,
} from "../../web/lib/export.mjs";
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
