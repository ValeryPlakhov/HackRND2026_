// Regressions for the independent audit (FINDINGS F01, F02, F05, F19, F20).
import test from "node:test";
import assert from "node:assert/strict";
import { generate } from "../../web/blueprint/codegen.mjs";
import { connect, assignable } from "../../web/blueprint/model.mjs";
import { QualityLab } from "../../web/ide/quality.mjs";

const node = (id, type, props = {}) => ({ id, type, props, x: 0, y: 0 });
const link = (from, fromPin, to, toPin) => ({ from, fromPin, to, toPin });
const ret = (method, nodes, links) => generate({ method, nodes, links }, { indent: "" }).code;

test("F02: nested unary minus never fuses into a decrement", () => {
  const code = ret(
    { name: "f", returnType: "int", params: [{ name: "x", type: "int" }] },
    [node("e", "entry"), node("r", "return"), node("o", "op", { op: "-", unary: true }), node("i", "op", { op: "-", unary: true }), node("g", "get", { name: "x", type: "int" })],
    [link("e", "then", "r", "in"), link("g", "value", "i", "a"), link("i", "value", "o", "a"), link("o", "value", "r", "value")],
  );
  assert.equal(code, "return -(-x);");
});

test("F02: a conditional receiver keeps its parentheses", () => {
  const code = ret(
    { name: "f", returnType: "String", params: [{ name: "c", type: "boolean" }] },
    [
      node("e", "entry"), node("r", "return"), node("s", "select"), node("c", "get", { name: "c", type: "boolean" }),
      node("a", "literal", { value: '"yes"', type: "String" }), node("b", "literal", { value: '"no"', type: "String" }),
      node("u", "call", { name: "toUpperCase", argc: 0, pure: true, targetPin: true }),
    ],
    [link("e", "then", "r", "in"), link("c", "value", "s", "condition"), link("a", "value", "s", "a"), link("b", "value", "s", "b"), link("s", "value", "u", "target"), link("u", "value", "r", "value")],
  );
  assert.equal(code, 'return (c ? "yes" : "no").toUpperCase();');
});

test("F02: unary plus inside minus and casts of negated values stay separate tokens", () => {
  const code = ret(
    { name: "f", returnType: "int", params: [{ name: "x", type: "int" }] },
    [node("e", "entry"), node("r", "return"), node("m", "op", { op: "-", unary: true }), node("p", "op", { op: "+", unary: true }), node("g", "get", { name: "x", type: "int" })],
    [link("e", "then", "r", "in"), link("g", "value", "p", "a"), link("p", "value", "m", "a"), link("m", "value", "r", "value")],
  );
  assert.equal(code, "return -(+x);");
});

test("F18: comments carried by nodes are written before and after statements", () => {
  const code = ret(
    { name: "f", returnType: "void", params: [] },
    [node("e", "entry"), node("c", "call", { target: "System.out", name: "println", argc: 0, pure: false, comment: "// why", after: "// end" })],
    [link("e", "then", "c", "in")],
  );
  assert.equal(code, "// why\nSystem.out.println();\n// end");
});

test("F19: wires refuse clear primitive mismatches and accept widening", () => {
  assert.equal(assignable("boolean", "int"), false);
  assert.equal(assignable("int", "boolean"), false);
  assert.equal(assignable("String", "int"), false);
  assert.equal(assignable("int", "long"), true);
  assert.equal(assignable("long", "int"), false);
  assert.equal(assignable("Integer", "int"), true);
  assert.equal(assignable("any", "boolean"), true);
  const graph = {
    method: { name: "f", returnType: "int", params: [] },
    nodes: [node("e", "entry"), node("r", "return"), node("t", "literal", { value: "true", type: "boolean" }), node("one", "literal", { value: "1", type: "int" })],
    links: [],
  };
  assert.equal(connect(graph, "t", "value", "r", "value"), false);
  assert.equal(connect(graph, "one", "value", "r", "value"), true);
});

test("F19: an incomplete graph reports problems instead of silently passing defaults", () => {
  const result = generate({ method: { name: "f", returnType: "int", params: [] }, nodes: [node("e", "entry"), node("r", "return")], links: [link("e", "then", "r", "in")] });
  assert.equal(result.problems.length, 1);
});

function lab() {
  const app = { client: {}, bridge: {}, documents: { documents: new Map(), active: null }, runConfig: {}, root: null };
  const quality = new QualityLab(app);
  quality.renderStatus = () => {};
  quality.render = () => {};
  quality.persistSoon = () => {};
  return quality;
}

test("F05: edits during the first running check make its result stale", () => {
  const quality = lab();
  quality.job = { state: "running", kind: "compare" };
  quality.changedDuringCheck = false;
  quality.invalidate();
  assert.equal(quality.changedDuringCheck, true);
});

test("F05: replacing the test set invalidates a passing result", () => {
  const quality = lab();
  quality.report = { passed: true, tests: [{ passed: true }] };
  quality.reportStale = false;
  quality.setCases([{ id: "a", name: "a", input: "1", enabled: true }]);
  assert.equal(quality.reportStale, true);
});

test("F01: an imported folder in the browser is an editable in-memory copy", async () => {
  globalThis.localStorage ??= { getItem: () => null, setItem: () => {} };
  const { BrowserBridge } = await import("../../web/ide/bridge.mjs");
  const bridge = new BrowserBridge();
  bridge.project = { id: "p" };
  bridge.imported = true;
  bridge.files = new Map([["src/A.java", "class A {}"]]);
  const file = await bridge.read("p", "src/A.java");
  assert.equal(file.readOnly, false);
  await bridge.write("p", { path: "src/A.java", content: "class A { int x; }", expectedHash: file.hash });
  assert.equal(bridge.files.get("src/A.java"), "class A { int x; }");
});
