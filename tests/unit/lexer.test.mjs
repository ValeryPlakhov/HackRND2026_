import test from "node:test";
import assert from "node:assert/strict";
import {
  tokenize,
  highlight,
  indentationAt,
  lineAt,
  offsetAtLine,
  bracketPairs,
} from "../../web/lib/lexer.mjs";

const sources = [
  "class A { static int f(int x) { return x + 1; } }",
  "String s=\"Привет, 🚀\"; // кириллица\nchar c='\\n';",
  "/* comment */\nrecord Point(int x, int y) {}",
  'String s = """\n<html>text</html>\n""";',
  "double x = 0x1.0p-2; int y=0b101_010; long z=12_000L;",
  '@Override public String toString(){return "a\\\"b";}',
];

for (const [index, source] of sources.entries())
  test(`lexer preserves every source character ${index}`, () => {
    const tokens = tokenize(source);
    assert.equal(tokens.map((token) => token.text).join(""), source);
    for (const token of tokens)
      assert.equal(source.slice(token.start, token.end), token.text);
  });

test("highlight escapes HTML and scripts in Java strings", () => {
  const html = highlight('String s="<script>alert(1)</script>";');
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
});

test("comments do not become keyword tokens", () => {
  const tokens = tokenize("// return class\n/* if */");
  assert.equal(tokens.filter((token) => token.type === "keyword").length, 0);
  assert.equal(tokens.filter((token) => token.type === "comment").length, 2);
});

test("unterminated literals and comments still display losslessly", () => {
  for (const source of [
    'String s="unfinished',
    "/* unfinished",
    '""" unfinished',
  ]) {
    assert.equal(
      tokenize(source)
        .map((token) => token.text)
        .join(""),
      source,
    );
  }
});

test("indentation follows an opening block", () => {
  const source = "class A {\n    if (true) {";
  assert.equal(indentationAt(source, source.length), "        ");
});

test("line mapping handles UTF-16 text without changing offsets", () => {
  const source = "🚀\nПривет\nworld";
  assert.equal(offsetAtLine(source, 2), 3);
  assert.equal(lineAt(source, 3), 2);
});

test("bracket pairs exclude brackets inside literals and comments", () => {
  const source = 'f("[ignore]"); // {ignore}\n{ int[] a; }';
  const pairs = bracketPairs(source);
  assert.equal(pairs.length, 3);
  assert.ok(pairs.every(([a, b]) => a < b));
});
