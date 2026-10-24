import test from "node:test";
import assert from "node:assert/strict";
import { Workspace } from "../../web/lib/workspace.mjs";

const source = "class Main { int x; }";
const create = () =>
  new Workspace({
    files: { "Main.java": source },
    cases: [{ id: "one", input: "", enabled: true }],
  });

test("workspace starts from a cloned baseline", () => {
  const files = { "Main.java": source };
  const workspace = new Workspace({ files });
  files["Main.java"] = "changed elsewhere";
  assert.equal(workspace.source, source);
  assert.equal(workspace.gate, "unverified");
  assert.deepEqual(workspace.changedFiles, []);
});

test("source transaction invalidates every source-bound result", () => {
  const workspace = create();
  Object.assign(workspace.state, {
    report: { passed: true },
    reportJobId: "job",
    benchmark: {},
    mutations: {},
    reduction: {},
    plans: {},
    detail: {},
  });
  workspace.setSource(source + "\n");
  for (const key of [
    "report",
    "reportJobId",
    "benchmark",
    "mutations",
    "reduction",
    "plans",
    "detail",
  ])
    assert.equal(workspace.state[key], null, key);
  assert.equal(workspace.state.revision, 1);
  assert.equal(workspace.state.dirty, true);
  assert.deepEqual(workspace.changedFiles, ["Main.java"]);
});

test("a no-op edit does not grow history or change revision", () => {
  const workspace = create();
  assert.equal(workspace.setSource(source), false);
  assert.equal(workspace.state.revision, 0);
  assert.equal(workspace.undoStack.length, 0);
});

test("undo and redo restore contents but require a fresh gate", () => {
  const workspace = create();
  workspace.setSource(source + " // edit");
  workspace.state.report = { passed: true };
  assert.equal(workspace.undo(), true);
  assert.equal(workspace.source, source);
  assert.equal(workspace.gate, "unverified");
  assert.equal(workspace.redo(), true);
  assert.equal(workspace.source, source + " // edit");
  assert.equal(workspace.gate, "unverified");
});

test("new edit discards the redo branch", () => {
  const workspace = create();
  workspace.setSource("class Main { int a; }");
  workspace.undo();
  workspace.setSource("class Main { int b; }");
  assert.equal(workspace.redo(), false);
});

test("late job result cannot attach to a newer source revision", () => {
  const workspace = create();
  const revision = workspace.state.revision;
  workspace.setSource(source + "\n");
  assert.equal(
    workspace.updateResult("compare", { passed: true }, revision, "job"),
    false,
  );
  assert.equal(workspace.gate, "unverified");
});

test("case changes invalidate the report but retain source analysis", () => {
  const workspace = create();
  workspace.state.detail = { sourceHash: "same" };
  workspace.state.plans = { plans: [] };
  workspace.state.report = { passed: true };
  workspace.setCases([{ id: "new", input: "1\n", enabled: true }]);
  assert.equal(workspace.gate, "unverified");
  assert.deepEqual(workspace.state.detail, { sourceHash: "same" });
  assert.deepEqual(workspace.state.plans, { plans: [] });
});

test("restoring a checkpoint never replaces the chosen baseline", () => {
  const workspace = create();
  const snapshot = workspace.checkpoint("before");
  workspace.setSource(source + " // new");
  workspace.restore(snapshot.id);
  assert.equal(workspace.source, source);
  assert.equal(workspace.state.baseline["Main.java"], source);
  assert.equal(workspace.gate, "unverified");
});

test("accepting a baseline clears dirty status and evidence", () => {
  const workspace = create();
  workspace.setSource(source + " // baseline");
  workspace.state.report = { passed: true };
  workspace.acceptBaseline();
  assert.equal(workspace.state.baseline["Main.java"], workspace.source);
  assert.equal(workspace.state.dirty, false);
  assert.equal(workspace.state.report, null);
});

test("multi-file transaction preserves the active source", () => {
  const workspace = create();
  workspace.applyFiles(
    { "Main.java": source, "Helper.java": "class Helper {}" },
    "extract",
  );
  assert.equal(workspace.state.activeFile, "Main.java");
  assert.deepEqual(workspace.changedFiles, ["Helper.java"]);
  workspace.selectFile("Helper.java");
  assert.equal(workspace.source, "class Helper {}");
});

test("removed active file falls back to an existing file", () => {
  const workspace = create();
  workspace.applyFiles({ "Replacement.java": "class Replacement {}" });
  assert.equal(workspace.state.activeFile, "Replacement.java");
});

test("imports reject traversal and excessive project size", () => {
  const workspace = create();
  for (const files of [
    {},
    { "../Main.java": "" },
    { "Main.java": "x".repeat(500001) },
  ]) {
    assert.throws(() => workspace.importFiles(files));
  }
});

test("valid import resets the baseline, checkpoints and previous evidence", () => {
  const workspace = create();
  workspace.setSource("class Main { int previous; }");
  workspace.importFiles({ "Next.java": "class Next {}" }, "Next project");
  assert.equal(workspace.state.name, "Next project");
  assert.equal(workspace.state.snapshots.length, 1);
  assert.equal(workspace.state.baseline["Next.java"], "class Next {}");
  assert.equal(workspace.undo(), false);
});

test("history is bounded and serialization keeps at most 12 snapshots", () => {
  const workspace = create();
  for (let index = 0; index < 30; index++) {
    workspace.setSource(`class Main { int n${index}; }`);
    workspace.checkpoint("snapshot " + index);
  }
  assert.equal(workspace.state.snapshots.length, 24);
  assert.equal(workspace.serialize().snapshots.length, 12);
});

test("stale project analysis is ignored", () => {
  const workspace = create();
  workspace.setSource(source + "\n");
  assert.equal(workspace.updateProject({ files: {} }, 0), false);
  assert.equal(workspace.state.project, null);
});

test("navigation is limited to declared studio views", () => {
  const workspace = create();
  workspace.navigate("tests");
  assert.equal(workspace.state.view, "tests");
  assert.throws(() => workspace.navigate("https://external.example"));
});

test("event subscriptions can be removed without retaining listeners", () => {
  const workspace = create();
  let calls = 0;
  const unsubscribe = workspace.events.on("navigate", () => calls++);
  workspace.navigate("canvas");
  unsubscribe();
  workspace.navigate("tests");
  assert.equal(calls, 1);
});
