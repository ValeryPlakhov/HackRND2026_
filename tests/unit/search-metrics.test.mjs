import test from "node:test";
import assert from "node:assert/strict";
import {
  fuzzyScore,
  parseQuery,
  matchesFilters,
  searchItems,
  CommandRegistry,
} from "../../web/lib/search.mjs";
import {
  median,
  percentile,
  distribution,
  complexityClass,
  reportSummary,
  lineChart,
} from "../../web/lib/metrics.mjs";

test("fuzzy search ranks exact over substring over subsequence", () => {
  assert.ok(fuzzyScore("count", "count") > fuzzyScore("countPairs", "count"));
  assert.ok(
    fuzzyScore("countPairs", "count") > fuzzyScore("countPairs", "cpr"),
  );
  assert.equal(fuzzyScore("count", "xyz"), -1);
});
test("fuzzy search is case insensitive for Cyrillic", () =>
  assert.equal(fuzzyScore("ПРОВЕРКА", "проверка"), 1000));
test("query parser separates quoted filters and free text", () =>
  assert.deepEqual(
    parseQuery('pair file:"Main.java" severity:warning line:5-9'),
    {
      text: "pair",
      filters: { file: "Main.java", severity: "warning", line: "5-9" },
    },
  ));
test("line filter includes both endpoints", () => {
  assert.equal(matchesFilters({ line: 5 }, { line: "5-9" }), true);
  assert.equal(matchesFilters({ line: 9 }, { line: "5-9" }), true);
  assert.equal(matchesFilters({ line: 10 }, { line: "5-9" }), false);
});
test("search combines filters, ranking, stable ties and maximum", () => {
  const items = [
    { title: "a", severity: "error" },
    { title: "same", severity: "warning" },
    { title: "same", severity: "warning" },
  ];
  assert.deepEqual(searchItems(items, "severity:warning", 1), [items[1]]);
  assert.deepEqual(searchItems(items, "notfound"), []);
});
test("command registry rejects malformed and unavailable commands", async () => {
  const registry = new CommandRegistry();
  assert.throws(() => registry.register({ id: "bad" }));
  registry.register({
    id: "guard",
    title: "Guard",
    enabled: () => false,
    run: () => 7,
  });
  await assert.rejects(registry.execute("guard", {}), /недоступна/);
  await assert.rejects(registry.execute("missing", {}), /не найдена/);
});
test("command registry passes the execution context", async () => {
  const registry = new CommandRegistry([
    { id: "run", title: "Verify", run: (context) => context.value + 1 },
  ]);
  assert.equal(await registry.execute("run", { value: 7 }), 8);
});
test("median handles unsorted, even and empty samples without mutating", () => {
  const values = [9, 1, 3, 7];
  assert.equal(median(values), 5);
  assert.deepEqual(values, [9, 1, 3, 7]);
  assert.equal(median([]), null);
  assert.equal(median([3]), 3);
});
test("percentile interpolates and clamps its requested fraction", () => {
  assert.equal(percentile([0, 10], 0.25), 2.5);
  assert.equal(percentile([0, 10], 2), 10);
  assert.equal(percentile([0, 10], -1), 0);
  assert.equal(percentile([], 0.5), null);
});
test("distribution assigns boundaries once and retains overflow", () =>
  assert.deepEqual(
    distribution([1, 5, 6, 10, 11], [5, 10]).map((x) => x.count),
    [2, 2, 1],
  ));
test("complexity classifier distinguishes polynomial, logarithmic and unknown", () => {
  for (const [label, expected] of [
    ["O(n^2)", "quadratic"],
    ["O(n log n)", "nlogn"],
    ["O(log n)", "logarithmic"],
    ["unknown", "unknown"],
    ["O(1)", "constant"],
  ])
    assert.equal(complexityClass(label), expected);
});
test("behavior summary counts individual results instead of trusting the top-level flag", () =>
  assert.deepEqual(
    reportSummary({
      passed: true,
      tests: [
        { passed: true, baseline: { timeMs: 2 }, candidate: { timeMs: 1 } },
        { passed: false },
      ],
    }),
    { total: 2, passed: 1, failed: 1, baselineMs: 2, candidateMs: 1 },
  ));
test("chart handles empty and single-size data without invalid SVG coordinates", () => {
  assert.ok(lineChart([]).includes("Нет измерений"));
  const chart = lineChart([{ name: "<script>", values: [{ x: 128, y: 3 }] }]);
  assert.ok(!chart.includes("NaN"));
  assert.ok(!chart.includes("<script>"));
});
