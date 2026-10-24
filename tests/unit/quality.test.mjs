import test from "node:test";
import assert from "node:assert/strict";
import {
  analysisSidebar,
  improveSidebar,
  verifyPanel,
  qualityStatus,
  complexityTone,
  sortedFindings,
  decomposeModal,
  inputPreview,
  methodMetrics,
} from "../../web/ide/quality-views.mjs";
import { QualityLab } from "../../web/ide/quality.mjs";

const project = { id: "p1", name: "shop" };
const analysis = {
  stats: { files: 1, methods: 3, lines: 120 },
  analysisMs: 12,
  findings: [
    { rule: "BP109", severity: "info", title: "Вывод <script>", detail: "d", fileName: "src/A.java", line: 9, start: 50, end: 60 },
    { rule: "NESTED_LOOPS", severity: "warning", title: "Вложенные циклы", detail: "d", fileName: "src/A.java", line: 3, start: 10, end: 40, canOptimize: true },
  ],
  hotspots: [{ id: "src/A.java::A#f@1", fileName: "src/A.java", methodId: "A#f@1", name: "f", line: 3, lines: 10, cyclomatic: 4 }],
  methods: [
    { id: "src/A.java::A#f@1", methodId: "A#f@1", fileName: "src/A.java", name: "f", owner: "A", line: 3, lines: 10, static: true, complexity: "O(n^2)" },
    { id: "src/A.java::A#main@0", methodId: "A#main@0", fileName: "src/A.java", name: "main", owner: "A", line: 1, lines: 5, static: true, complexity: "O(1)" },
    { id: "src/A.java::E#parse@2", methodId: "E#parse@2", fileName: "src/A.java", name: "parse", owner: "E", line: 20, lines: 4, static: true, complexity: "O(n)" },
  ],
  modules: [{ id: "computation", suggestedClass: "ComputationEngine", methods: ["src/A.java::A#f@1", "src/A.java::E#parse@2"], lines: 14 }],
};

test("findings are ordered by severity and escaped in the analysis sidebar", () => {
  assert.deepEqual(sortedFindings(analysis.findings).map((item) => item.index), [1, 0]);
  const html = analysisSidebar({ project, analysis, analysing: false, stale: false, error: null, filter: null });
  assert.ok(html.indexOf("Вложенные циклы") < html.indexOf("Вывод &lt;script&gt;"));
  assert.ok(!html.includes("<script>"));
  assert.match(html, /data-action="open-finding" data-index="1"/);
  assert.match(html, /q-big-o bad">O\(n\^2\)/);
  assert.match(html, /data-module="computation"/);
});

test("severity filter hides other levels and stale analysis is announced", () => {
  const html = analysisSidebar({ project, analysis, analysing: false, stale: true, error: null, filter: "info" });
  assert.ok(!html.includes("Вложенные циклы"));
  assert.match(html, /Код изменился после анализа/);
});

test("analysis sidebar asks to open a project or run the analysis", () => {
  assert.match(analysisSidebar({ project: null }), /open-folder/);
  assert.match(analysisSidebar({ project, analysis: null, error: "сбой" }), /сбой/);
});

test("complexity tone separates quadratic, linear and constant estimates", () => {
  assert.equal(complexityTone("O(n^2)"), "bad");
  assert.equal(complexityTone("O(n²)"), "bad");
  assert.equal(complexityTone("O(n log n)"), "ok");
  assert.equal(complexityTone("O(1)"), "good");
});

test("improvements list plans with their cost change and disable read-only files", () => {
  const document = { language: "java", name: "A.java", path: "src/A.java", readOnly: true };
  const entry = {
    data: {
      plans: [{ id: "p", rule: "histogram-pairs", title: "Индекс", rationale: "почему", line: 3, timeBefore: "O(n²)", timeAfter: "O(n)" }],
    },
  };
  const html = improveSidebar({ document, entry, analysis, method: { name: "f", static: true } });
  assert.match(html, /O\(n²\)<\/span>→<span class="q-big-o good">O\(n\)/);
  assert.match(html, /data-action="plan-apply" data-id="p" disabled/);
  assert.match(html, /ComputationEngine/);
});

test("decomposition preselects movable methods of the primary class only", () => {
  const methods = analysis.methods.filter((method) => method.name !== "x");
  const html = decomposeModal({ module: analysis.modules[0], methods, fileName: "src/A.java", className: "Engine" });
  assert.match(html, /value="A#f@1" checked/);
  assert.match(html, /value="A#main@0" disabled/);
  assert.match(html, /value="E#parse@2" \/>/);
  assert.match(html, /E\.parse\(\)/);
});

test("verification panel shows inputs, results and a stdout diff for a mismatch", () => {
  const cases = [{ id: "c1", name: "Вход <1>", input: "5\n", enabled: true }];
  const inputs = verifyPanel({ project, baseline: { files: { "A.java": "" }, label: "Снимок" }, cases, report: null, stale: false, job: null, tab: "inputs", lab: {}, method: null, document: null });
  assert.match(inputs, /Вход &lt;1&gt;/);
  assert.match(inputs, /1\/1/);
  const run = (stdout) => ({ stdout, stderr: "", exitCode: 0, timeMs: 5, timedOut: false, outputLimit: false });
  const report = {
    passed: false,
    caseNames: ["Вход 1"],
    tests: [{ name: "Вход 1", input: "1 2 3", passed: false, baseline: run("a\n"), candidate: run("b\n") }],
    baselineBuild: { success: true },
    candidateBuild: { success: true },
  };
  const results = verifyPanel({ project, baseline: null, cases, report, stale: true, job: null, tab: "results", lab: {}, method: null, document: null });
  assert.match(results, /Поведение изменилось/);
  assert.match(results, /Код изменён после проверки/);
  assert.match(results, /stdout эталона/);
  assert.match(results, /reduce-failure/);
});

test("status chip reflects running, passing, failing and stale checks", () => {
  assert.equal(qualityStatus({ project: null }), "");
  assert.match(qualityStatus({ project, job: { state: "running", kind: "compare" } }), /Проверяем поведение/);
  const tests = [{ passed: true }, { passed: true }];
  assert.match(qualityStatus({ project, report: { passed: true, tests } }), /совпало 2\/2/);
  assert.match(qualityStatus({ project, report: { passed: false, tests: [{ passed: false }, { passed: true }] } }), /Расхождение 1\/2/);
  assert.match(qualityStatus({ project, report: { passed: true, tests }, stale: true }), /устарела/);
});

test("input preview and method metrics stay compact", () => {
  assert.equal(inputPreview(""), "пустой stdin");
  assert.equal(inputPreview("a\n\n b"), "a b");
  assert.ok(inputPreview("x".repeat(80)).endsWith("…"));
  assert.match(methodMetrics({ complexity: { time: "O(n)", cyclomatic: 3, assumptions: [] } }, 2), /CC 3/);
  assert.match(methodMetrics(null, 0), /Big O…/);
});

function lab() {
  const app = { client: {}, bridge: {}, documents: { documents: new Map(), active: null }, runConfig: {} };
  return new QualityLab(app);
}

test("baseline changes list added, deleted and modified files", () => {
  const quality = lab();
  quality.baseline = { files: { "A.java": "a", "B.java": "b" } };
  const changes = quality.baselineChanges({ "A.java": "a", "B.java": "b2", "C.java": "c" });
  assert.deepEqual(changes.map((item) => [item.path, item.status]), [["B.java", "modified"], ["C.java", "added"]]);
  assert.deepEqual(quality.baselineChanges({ "A.java": "a" }).map((item) => item.status), ["deleted"]);
});

test("findings merge file and project analysis only while the source matches", () => {
  const quality = lab();
  const document = {
    path: "src/A.java",
    content: "class A {}",
    currentModel: { findings: [{ rule: "NESTED_LOOPS", start: 1, end: 5, line: 1 }] },
  };
  quality.analysis = { findings: [{ rule: "NESTED_LOOPS", start: 1, end: 5, fileName: "src/A.java" }, { rule: "BP121", start: 2, end: 3, fileName: "src/A.java" }] };
  quality.analysisSources = { "src/A.java": "class A {}" };
  assert.deepEqual(quality.findingsFor(document).map((item) => item.rule), ["NESTED_LOOPS", "BP121"]);
  quality.analysisSources = { "src/A.java": "class A { }" };
  assert.deepEqual(quality.findingsFor(document).map((item) => item.rule), ["NESTED_LOOPS"]);
});

test("a finding is anchored to the smallest blueprint node that contains it", () => {
  const quality = lab();
  const method = {
    graph: {
      nodes: [
        { id: "entry", start: 0, end: 100, line: 1 },
        { id: "loop", start: 10, end: 60, line: 3 },
        { id: "inner", start: 20, end: 40, line: 4 },
      ],
    },
  };
  assert.equal(quality.nodeFor(method, { start: 22, end: 30, line: 4 }).id, "inner");
  assert.equal(quality.nodeFor(method, { start: 5, end: 70, line: 1 }).id, "entry");
  assert.equal(quality.nodeFor(method, { start: -1, end: -1, line: 3 }).id, "loop");
});
