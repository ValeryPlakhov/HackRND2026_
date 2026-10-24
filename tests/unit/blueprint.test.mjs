import test from "node:test";
import assert from "node:assert/strict";
import { generate, CodegenError, reindent } from "../../web/blueprint/codegen.mjs";
import { pinsOf, connect, disconnectPin, removeNode, variablesOf, CATALOG } from "../../web/blueprint/model.mjs";
import { autoLayout, pinPosition, nodeWidth } from "../../web/blueprint/layout.mjs";

const method = (returnType = "int", params = [{ name: "a", type: "int" }, { name: "b", type: "int" }]) => ({ name: "f", returnType, params });
const node = (id, type, props = {}) => ({ id, type, props, x: 0, y: 0 });
const link = (from, fromPin, to, toPin) => ({ from, fromPin, to, toPin });

test("data wires become an expression with minimal parentheses", () => {
  const graph = {
    method: method(),
    nodes: [node("e", "entry"), node("r", "return"), node("ga", "get", { name: "a", type: "int" }), node("gb", "get", { name: "b", type: "int" }), node("p", "op", { op: "+" }), node("two", "literal", { value: "2", type: "int" }), node("m", "op", { op: "*" })],
    links: [link("e", "then", "r", "in"), link("ga", "value", "p", "a"), link("gb", "value", "p", "b"), link("p", "value", "m", "a"), link("two", "value", "m", "b"), link("m", "value", "r", "value")],
  };
  assert.equal(generate(graph, { indent: "" }).code, "return (a + b) * 2;");
});

test("branch and loops nest their exec outputs and continue after Then", () => {
  const graph = {
    method: method("void", [{ name: "n", type: "int" }]),
    nodes: [
      node("e", "entry"),
      node("i", "set", { name: "i", type: "int", declare: true }),
      node("zero", "literal", { value: "0", type: "int" }),
      node("w", "while"),
      node("cond", "op", { op: "<" }),
      node("gi", "get", { name: "i", type: "int" }),
      node("gn", "get", { name: "n", type: "int" }),
      node("br", "branch"),
      node("odd", "op", { op: "==" }),
      node("mod", "op", { op: "%" }),
      node("gi2", "get", { name: "i", type: "int" }),
      node("two", "literal", { value: "2", type: "int" }),
      node("one", "literal", { value: "1", type: "int" }),
      node("print", "call", { target: "System.out", name: "println", argc: 1, pure: false }),
      node("gi3", "get", { name: "i", type: "int" }),
      node("inc", "set", { name: "i", type: "int", declare: false, assignOp: "++" }),
      node("done", "call", { target: "System.out", name: "println", argc: 1, pure: false }),
      node("text", "literal", { value: '"конец"', type: "String" }),
    ],
    links: [
      link("e", "then", "i", "in"), link("zero", "value", "i", "value"),
      link("i", "then", "w", "in"), link("gi", "value", "cond", "a"), link("gn", "value", "cond", "b"), link("cond", "value", "w", "condition"),
      link("w", "body", "br", "in"), link("gi2", "value", "mod", "a"), link("two", "value", "mod", "b"), link("mod", "value", "odd", "a"), link("one", "value", "odd", "b"), link("odd", "value", "br", "condition"),
      link("br", "true", "print", "in"), link("gi3", "value", "print", "a0"),
      link("br", "then", "inc", "in"),
      link("w", "then", "done", "in"), link("text", "value", "done", "a0"),
    ],
  };
  assert.equal(
    generate(graph, { indent: "" }).code,
    ["int i = 0;", "while (i < n) {", "    if (i % 2 == 1) {", "        System.out.println(i);", "    }", "    i++;", "}", 'System.out.println("конец");'].join("\n"),
  );
});

test("unconnected inputs fall back to defaults and are reported", () => {
  const graph = { method: method("boolean", []), nodes: [node("e", "entry"), node("r", "return")], links: [link("e", "then", "r", "in")] };
  const result = generate(graph, { indent: "" });
  assert.equal(result.code, "return false;");
  assert.equal(result.problems.length, 1);
});

test("exec cycles are rejected instead of generating endless code", () => {
  const graph = {
    method: method("void", []),
    nodes: [node("e", "entry"), node("a", "code", { code: "x();" }), node("b", "code", { code: "y();" })],
    links: [link("e", "then", "a", "in"), link("a", "then", "b", "in"), link("b", "then", "a", "in")],
  };
  assert.throws(() => generate(graph), CodegenError);
});

test("raw Java nodes keep their relative indentation", () => {
  assert.deepEqual(reindent("try {\n            x();\n        } finally {\n            y();\n        }", "  "), ["  try {", "      x();", "  } finally {", "      y();", "  }"]);
});

test("pure call nodes inline into expressions; reroute knots are transparent", () => {
  const graph = {
    method: method("int", [{ name: "values", type: "int[]" }]),
    nodes: [node("e", "entry"), node("r", "return"), node("max", "call", { target: "Math", name: "max", argc: 2, pure: true }), node("len", "member", { name: "length" }), node("gv", "get", { name: "values", type: "int[]" }), node("k", "reroute", { kind: "data", type: "int" }), node("ten", "literal", { value: "10", type: "int" })],
    links: [link("e", "then", "r", "in"), link("gv", "value", "len", "target"), link("len", "value", "k", "a"), link("k", "value", "max", "a0"), link("ten", "value", "max", "a1"), link("max", "value", "r", "value")],
  };
  assert.equal(generate(graph, { indent: "" }).code, "return Math.max(values.length, 10);");
});

test("connections respect pin kinds; data inputs and exec outputs take one wire", () => {
  const graph = { method: method(), nodes: [node("e", "entry"), node("r", "return"), node("x", "literal", { value: "1", type: "int" }), node("y", "literal", { value: "2", type: "int" })], links: [] };
  assert.equal(connect(graph, "x", "value", "r", "in"), false);
  assert.equal(connect(graph, "x", "value", "r", "value"), true);
  assert.equal(connect(graph, "y", "value", "r", "value"), true);
  assert.deepEqual(graph.links.filter((l) => l.to === "r").map((l) => l.from), ["y"]);
  assert.equal(connect(graph, "e", "then", "r", "in"), true);
  assert.equal(disconnectPin(graph, "r", "in"), true);
  assert.equal(removeNode(graph, "e"), false);
  assert.equal(removeNode(graph, "y"), true);
  assert.equal(graph.links.length, 0);
});

test("variables list parameters, locals and loop variables with their uses", () => {
  const graph = {
    method: method("void", [{ name: "n", type: "int" }]),
    fields: [{ name: "TOTAL", type: "int" }],
    nodes: [node("s", "set", { name: "sum", type: "int", declare: true }), node("g1", "get", { name: "sum", type: "int" }), node("g2", "get", { name: "sum", type: "int" }), node("f", "foreach", { name: "v", type: "int" })],
    links: [],
  };
  const variables = variablesOf(graph);
  assert.deepEqual(variables.map((v) => v.name), ["n", "sum", "v", "TOTAL"]);
  assert.equal(variables.find((v) => v.name === "sum").reads, 2);
});

test("every palette entry has pins and a valid default", () => {
  for (const spec of CATALOG) {
    const pins = pinsOf({ type: spec.type, props: spec.props }, { method: method() });
    assert.ok(pins.inputs.length + pins.outputs.length > 0, spec.title);
  }
});

test("auto layout keeps the exec spine left to right and pins on node edges", () => {
  const graph = {
    method: method(),
    nodes: [node("e", "entry"), node("s", "set", { name: "x", type: "int", declare: true }), node("one", "literal", { value: "1", type: "int" }), node("r", "return"), node("g", "get", { name: "x", type: "int" })],
    links: [link("e", "then", "s", "in"), link("one", "value", "s", "value"), link("s", "then", "r", "in"), link("g", "value", "r", "value")],
  };
  autoLayout(graph);
  const at = Object.fromEntries(graph.nodes.map((n) => [n.id, n]));
  assert.ok(at.e.x < at.s.x && at.s.x < at.r.x);
  assert.ok(at.one.x + nodeWidth(at.one) <= at.s.x);
  assert.ok(at.one.y > at.s.y);
  const out = pinPosition(at.s, graph, "then", "out");
  assert.equal(out.x, at.s.x + nodeWidth(at.s));
});
