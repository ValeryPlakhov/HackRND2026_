// Plain words for complexity and for the run failures beginners meet first.
import test from "node:test";
import assert from "node:assert/strict";
import { costText, prettyBigO } from "../../web/ide/workspace.mjs";
import { explainFailure } from "../../web/ide/bridge.mjs";

test("complexity is explained as growth, not notation", () => {
  assert.equal(prettyBigO("O(n^2)"), "O(n²)");
  assert.match(costText("O(n^2)"), /в 100 раз/);
  assert.match(costText("O(n)"), /в 10 раз дольше/);
  assert.match(costText("O(1)"), /не зависит/);
});

test("a program that wanted input says so", () => {
  assert.match(explainFailure('Exception in thread "main" java.util.NoSuchElementException\n\tat java.base/java.util.Scanner.throwFor'), /ждала ввод/);
  assert.match(explainFailure("java.util.InputMismatchException"), /не то, что ждёт/);
  assert.equal(explainFailure("ok"), "");
});
