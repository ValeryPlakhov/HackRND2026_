import test from "node:test";
import assert from "node:assert/strict";
import {
  diffLines,
  reconstruct,
  projectDiff,
  unifiedDiff,
  changeStatistics,
  hunks,
} from "../../web/lib/diff.mjs";

for (const [name, before, after] of [
  ["identical", "a\nb\nc", "a\nb\nc"],
  ["insert first", "b\nc", "a\nb\nc"],
  ["insert last", "a\nb", "a\nb\nc"],
  ["delete first", "a\nb\nc", "b\nc"],
  ["delete last", "a\nb\nc", "a\nb"],
  ["replace", "a\nb\nc", "a\nx\nc"],
  ["empty left", "", "a\nb"],
  ["empty right", "a\nb", ""],
  ["blank lines", "a\n\n\nb", "a\n\nb\n"],
  ["repeated text", "x\nx\ny\nx", "x\ny\nx\nx"],
  ["unicode", "Привет\n🚀\nмир", "Привет\nмир\n😀"],
  ["brace changes", "{\n return 0;\n}", "{\n return 1;\n}"],
]) {
  test(`line diff reconstructs both sides: ${name}`, () => {
    const operations = diffLines(before, after);
    assert.equal(reconstruct(operations, "before"), before);
    assert.equal(reconstruct(operations, "after"), after);
  });
}

test("seeded randomized line edits reconstruct exactly", () => {
  let seed = 75000;
  const random = () =>
    (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  for (let iteration = 0; iteration < 300; iteration++) {
    const a = Array.from(
      { length: Math.floor(random() * 28) + 1 },
      () => `line${Math.floor(random() * 9)}`,
    );
    const b = [...a];
    for (let edit = 0; edit < 8; edit++) {
      const index = Math.floor(random() * (b.length + 1));
      b.splice(index, random() < 0.5 ? 1 : 0, `new${Math.floor(random() * 8)}`);
    }
    const operations = diffLines(a.join("\n"), b.join("\n"));
    assert.equal(
      reconstruct(operations, "before"),
      a.join("\n"),
      `before iteration ${iteration}`,
    );
    assert.equal(
      reconstruct(operations, "after"),
      b.join("\n"),
      `after iteration ${iteration}`,
    );
  }
});

test("large edit fallback remains lossless", () => {
  const a = Array.from({ length: 600 }, (_, index) => `a${index}`).join("\n");
  const b = Array.from({ length: 600 }, (_, index) => `b${index}`).join("\n");
  const operations = diffLines(a, b, 8);
  assert.equal(reconstruct(operations, "before"), a);
  assert.equal(reconstruct(operations, "after"), b);
});

test("unified diff contains file names and hunk ranges", () => {
  const patch = unifiedDiff("Main.java", "a\nb\nc", "a\nx\nc");
  assert.match(patch, /--- a\/Main.java/);
  assert.match(patch, /\+\+\+ b\/Main.java/);
  assert.match(patch, /-b\n\+x/);
  assert.match(patch, /@@ -1,3 \+1,3 @@/);
});

test("no-op unified diff is empty", () => {
  assert.equal(unifiedDiff("Main.java", "a", "a"), "");
});

test("statistics count insertions and deletions separately", () => {
  const counts = changeStatistics(diffLines("a\nb", "a\nx\ny"));
  assert.deepEqual(counts, { additions: 2, deletions: 1, changes: 3 });
});

test("distant changes yield distinct context hunks", () => {
  const a = Array.from({ length: 40 }, (_, index) => `line${index}`);
  const b = [...a];
  b[2] = "changed-first";
  b[35] = "changed-last";
  assert.equal(hunks(diffLines(a.join("\n"), b.join("\n")), 2).length, 2);
});

test("multi-file diff reports additions, changes and removals", () => {
  const result = projectDiff(
    { "A.java": "A", "B.java": "B" },
    { "B.java": "B2", "C.java": "C" },
  );
  assert.deepEqual(
    result.map((file) => [file.name, file.status]),
    [
      ["A.java", "deleted"],
      ["B.java", "modified"],
      ["C.java", "added"],
    ],
  );
});
