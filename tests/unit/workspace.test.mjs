// Workspaces: project map, task list and the reading flowchart are built from analysis data only.
import test from "node:test";
import assert from "node:assert/strict";
import { addresses, buildTasks, callIndex, condenseGraph, entryPoints, plural } from "../../web/ide/workspace.mjs";

const method = (name, extra = {}) => ({
  id: `A.java::A#${name}@1`,
  methodId: `A#${name}@1`,
  fileName: "A.java",
  name,
  owner: "A",
  arity: 0,
  line: 1,
  lines: 5,
  complexity: "O(1)",
  cyclomatic: 1,
  risk: 1,
  responsibility: "computation",
  static: true,
  fanIn: 0,
  fanOut: 0,
  ...extra,
});

const analysis = {
  methods: [
    method("main", { arity: 1, risk: 5 }),
    method("count", { complexity: "O(n^2)", risk: 40 }),
    method("print", { responsibility: "output" }),
  ],
  calls: [
    { from: "A.java::A#main@1", name: "count", targets: ["A.java::A#count@1"] },
    { from: "A.java::A#main@1", name: "println", select: "System.out.println", targets: [] },
    { from: "A.java::A#count@1", name: "print", targets: ["A.java::A#print@1"] },
  ],
  findings: [
    { rule: "NESTED_LOOPS", severity: "warning", fileName: "A.java", methodId: "A#count@1", title: "Вложенные циклы", line: 3 },
    { rule: "STYLE", severity: "info", fileName: "A.java", methodId: "A#print@1", title: "Совет", line: 9 },
  ],
  modules: [
    { id: "output", suggestedClass: "Reports", methods: ["A.java::A#print@1"], lines: 5 },
    { id: "utility", suggestedClass: "Util", methods: ["A.java::A#main@1"], lines: 5 },
  ],
};

test("call index links callers, callees and library calls", () => {
  const index = callIndex(analysis);
  assert.deepEqual(index.callees.get("A.java::A#main@1"), ["A.java::A#count@1"]);
  assert.deepEqual(index.callers.get("A.java::A#print@1"), ["A.java::A#count@1"]);
  assert.deepEqual(index.external.get("A.java::A#main@1"), ["System.out.println"]);
  assert.deepEqual(entryPoints(analysis).map((item) => item.name), ["main"]);
});

test("a risk carries only the fix that removes it, the rest stay separate", () => {
  const plans = {
    "A.java": {
      plans: [
        { id: "p1", rule: "histogram-pairs", methodId: "A#count@1", timeBefore: "O(n²)", timeAfter: "O(n)", title: "Индекс частот" },
        { id: "p2", rule: "constant-branch", methodId: "A#count@1", timeBefore: "unchanged", timeAfter: "unchanged", title: "Ветвь" },
      ],
    },
  };
  const tasks = buildTasks(analysis, plans);
  assert.equal(tasks.risks.length, 1);
  assert.deepEqual(tasks.risks[0].fixes.map((fix) => fix.plan.id), ["p1"]);
  assert.deepEqual(tasks.faster, []);
  assert.deepEqual(tasks.simpler.map((task) => task.plan.id), ["p2"]);
  assert.equal(tasks.advice.length, 1);
  assert.deepEqual(tasks.split.map((task) => task.module.id), ["output"]);
});

test("a nearby simplification never answers a performance finding", () => {
  const finding = { rule: "NESTED_LOOPS", category: "performance" };
  assert.equal(addresses(finding, { timeBefore: "O(1)", timeAfter: "O(1)" }), false);
  assert.equal(addresses(finding, { timeBefore: "unchanged" }), false);
  assert.equal(addresses({ rule: "MAGIC_NUMBER", category: "maintainability" }, { timeBefore: "O(n²)", timeAfter: "O(n)" }), false);
  assert.equal(addresses(finding, { timeBefore: "O(n²)", timeAfter: "O(n)" }), true);
});

test("reading flowchart merges straight runs of statements and keeps branches", () => {
  const node = (id, kind, label, depth = 0) => ({ id, kind, label, depth, line: 1, start: Number(id.slice(1)) * 10, end: Number(id.slice(1)) * 10 + 5 });
  const graph = {
    entry: "n0",
    nodes: [
      node("n0", "entry", "f"),
      node("n1", "variable", "int a = 0;"),
      node("n2", "variable", "int b = 0;"),
      node("n3", "operation", "log();"),
      node("n4", "loop", "i < n"),
      node("n5", "operation", "a++;", 1),
      node("n6", "operation", "b++;", 1),
      node("n7", "exit", "end"),
    ],
    edges: [
      { from: "n0", to: "n1" },
      { from: "n1", to: "n2" },
      { from: "n2", to: "n3" },
      { from: "n3", to: "n4" },
      { from: "n4", to: "n5", label: "повтор" },
      { from: "n5", to: "n6" },
      { from: "n6", to: "n4" },
      { from: "n4", to: "n7", label: "выход" },
    ],
  };
  const chart = condenseGraph(graph);
  assert.deepEqual(chart.nodes.map((item) => item.kind), ["entry", "sequence", "loop", "sequence", "exit"]);
  assert.match(chart.nodes[1].label, /^3 шага: int a = 0;/);
  assert.equal(chart.nodes[1].end, 35);
  const ids = new Set(chart.nodes.map((item) => item.id));
  for (const edge of chart.edges) assert.ok(ids.has(edge.from) && ids.has(edge.to));
  assert.deepEqual(
    chart.edges.map((edge) => `${edge.from}>${edge.to}`),
    ["n0>n1", "n1>n4", "n4>n5", "n5>n4", "n4>n7"],
  );
});

test("russian plural forms for step counts", () => {
  assert.equal(plural(1, "шаг", "шага", "шагов"), "шаг");
  assert.equal(plural(3, "шаг", "шага", "шагов"), "шага");
  assert.equal(plural(5, "шаг", "шага", "шагов"), "шагов");
  assert.equal(plural(12, "шаг", "шага", "шагов"), "шагов");
  assert.equal(plural(22, "шаг", "шага", "шагов"), "шага");
});

test("an expanded run of statements is shown as single steps", () => {
  const node = (id, kind, label) => ({ id, kind, label, code: label, depth: 0, line: 1, start: 0, end: 1 });
  const graph = {
    entry: "a",
    nodes: [node("a", "entry", "f"), node("b", "variable", "int x = 0;"), node("c", "variable", "int y = 0;"), node("d", "exit", "")],
    edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "c", to: "d" }],
  };
  const folded = condenseGraph(graph);
  assert.deepEqual(folded.nodes.map((item) => item.tag), ["method", "steps", "end"]);
  const open = condenseGraph(graph, new Set(folded.nodes[1].members));
  assert.deepEqual(open.nodes.map((item) => item.tag), ["method", "var", "var", "end"]);
  assert.equal(open.edges.length, 3);
});
