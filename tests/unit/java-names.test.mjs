// Blocks and flowchart steps are named the way Java names them: if, for, return, method signatures.
import test from "node:test";
import assert from "node:assert/strict";
import { nodeTitle, pinsOf } from "../../web/blueprint/model.mjs";
import { javaFace } from "../../web/ide/workspace.mjs";

const graph = { method: { name: "main", returnType: "void", params: [{ name: "args", type: "String[]" }] } };

test("block titles use Java keywords and the real method signature", () => {
  assert.equal(nodeTitle({ type: "entry", props: {} }, graph), "void main(String[] args)");
  assert.equal(nodeTitle({ type: "branch", props: {} }, graph), "if");
  assert.equal(nodeTitle({ type: "while", props: {} }, graph), "while");
  assert.equal(nodeTitle({ type: "return", props: {} }, graph), "return");
  assert.equal(nodeTitle({ type: "throw", props: {} }, graph), "throw");
  assert.equal(nodeTitle({ type: "foreach", props: { type: "Order", name: "order" } }, graph), "for (Order order : …)");
  assert.equal(nodeTitle({ type: "set", props: { declare: true, type: "int", name: "n" } }, graph), "int n");
});

test("branch outputs are called true and false", () => {
  const labels = pinsOf({ type: "branch", props: {} }, graph).outputs.map((pin) => pin.label);
  assert.deepEqual(labels.slice(0, 2), ["true", "false"]);
});

test("a flowchart step shows the Java keyword and the statement head", () => {
  const face = (kind, code, label = code) => javaFace({ kind, code, label });
  assert.deepEqual(face("entry", "static int f(int a) {\n return a;\n}", "f"), { tag: "method", text: "static int f(int a)" });
  assert.deepEqual(face("condition", "if (a < b) {\n x();\n}", "(a < b)"), { tag: "if", text: "if (a < b)" });
  assert.deepEqual(face("loop", "for (int i = 0; i < n; i++) {\n x();\n}", "i < n"), { tag: "for", text: "for (int i = 0; i < n; i++)" });
  assert.deepEqual(face("loop", "while (it.hasNext()) {\n}", "it.hasNext()"), { tag: "while", text: "while (it.hasNext())" });
  assert.equal(face("operation", "total += x;").tag, "assign");
  assert.equal(face("operation", "System.out.println(x);").tag, "call");
  assert.equal(face("variable", "int n = 0;").tag, "var");
  assert.equal(face("return", "return n;").tag, "return");
  assert.equal(face("exit", "").tag, "end");
});
