import test from "node:test";
import assert from "node:assert/strict";
import {
  BlueprintStore,
  emptyProject,
  createNode,
  analyse,
  assertStructure,
  scopeForSlot,
  literal,
  reference,
  itemId,
  locate,
  LIMITS,
} from "../../web/builder/model.mjs";
import {
  compileBlueprint,
  javaString,
  sourceBlockForLine,
} from "../../web/builder/compiler.mjs";
import {
  simulate,
  parseInteger,
  arithmetic,
  parseAnswer,
  inputText,
} from "../../web/builder/runtime.mjs";
import {
  TEMPLATES,
  templateAnswers,
  templateById,
} from "../../web/builder/templates.mjs";

const node = (id, type, config, children = {}) => ({
  id,
  type,
  config,
  ...children,
});
const program = (steps) => ({ ...emptyProject("Test"), steps });
const print = (id, text, value = null) => node(id, "print", { text, value });
for (const template of TEMPLATES) {
  test(`visual template ${template.id} is complete and produces ordinary Java`, () => {
    const project = template.create();
    assert.equal(analyse(project).valid, true);
    const result = compileBlueprint(project);
    assert.ok(result.source.includes("public class Main"));
    assert.ok(result.source.includes("public static void main"));
    assert.ok(Object.keys(result.spans).length > 0);
    assert.doesNotThrow(() => simulate(project, templateAnswers(project)));
  });
}
test("greeting handles Cyrillic and empty text as actual data", () => {
  const project = templateById("hello").create();
  assert.equal(
    simulate(project, { hello_name: "Анна" }).stdout,
    "Привет, Анна\n",
  );
  assert.equal(simulate(project, { hello_name: "" }).stdout, "Привет, \n");
});
test("business rule uses the exact threshold, including the boundary", () => {
  const project = templateById("discount").create();
  for (const value of [1000, 1001, 2147483647])
    assert.match(
      simulate(project, { shop_amount: String(value) }).stdout,
      /доступна/,
    );
  for (const value of [999, 0, -1])
    assert.match(
      simulate(project, { shop_amount: String(value) }).stdout,
      /пока недоступна/,
    );
});
test("list total supports empty, negative, duplicates and Java overflow", () => {
  const project = templateById("sum").create();
  for (const [input, total] of [
    ["", 0],
    ["100 250 300", 650],
    ["-5 5", 0],
    ["7 7", 14],
    ["2147483647 1", -2147483648],
  ])
    assert.equal(
      simulate(project, { basket_prices: input }).stdout,
      `Итого к оплате: ${total}\n`,
    );
});
test("repeat exposes a one-based counter and allows zero iterations", () => {
  const project = templateById("repeat").create();
  assert.equal(
    simulate(project).stdout,
    "Напоминание № 1\nНапоминание № 2\nНапоминание № 3\n",
  );
  project.steps[0].config.times = literal(0);
  assert.equal(simulate(project).stdout, "");
});
test("integer parser refuses fractions, notation, blanks and overflow", () => {
  for (const value of [
    "1.5",
    "1e3",
    "",
    " ",
    "Infinity",
    "2147483648",
    "-2147483649",
  ])
    assert.throws(() => parseInteger(value));
  assert.equal(parseInteger(" +12 "), 12);
  assert.equal(parseInteger("-2147483648"), -2147483648);
});
test("integer arithmetic reproduces Java overflow and division semantics", () => {
  assert.equal(arithmetic("+", 2147483647, 1), -2147483648);
  assert.equal(arithmetic("*", 2147483647, 3), 2147483645);
  assert.equal(arithmetic("/", -7, 2), -3);
  assert.equal(arithmetic("%", -7, 2), -1);
  assert.equal(arithmetic("/", -2147483648, -1), -2147483648);
  assert.throws(() => arithmetic("/", 4, 0), /ноль/);
});
test("list parsing accepts arbitrary whitespace and enforces 256 entries", () => {
  assert.deepEqual(parseAnswer(" 1\t2   -3 ", { type: "list" }), [1, 2, -3]);
  assert.throws(
    () => parseAnswer(Array(257).fill("1").join(" "), { type: "list" }),
    /256/,
  );
  assert.throws(() => parseAnswer("line\nbreak", { type: "text" }), /строку/);
});
test("input serialization preserves spaces in text and one-answer-per-line protocol", () => {
  const compiled = compileBlueprint(templateById("hello").create());
  assert.equal(inputText(compiled, { hello_name: " Анна " }), " Анна \n");
});
test("an empty canvas is a draft, not an executable success", () => {
  assert.equal(analyse(emptyProject()).valid, false);
  assert.throws(() => compileBlueprint(emptyProject()), /первый шаг/);
});
test("using a value before it is created points to the exact block", () => {
  const project = program([
    print("show", "", reference("later")),
    node("later", "value", { name: "Later", value: literal(4) }),
  ]);
  assert.ok(analyse(project).issues.some((issue) => issue.nodeId === "show"));
  assert.throws(() => compileBlueprint(project));
});
test("branch-local values are unavailable after the branch", () => {
  const project = program([
    node(
      "branch",
      "condition",
      { left: literal(1), operator: "==", right: literal(1) },
      {
        yes: [node("inside", "value", { name: "Inside", value: literal(4) })],
        no: [],
      },
    ),
    print("after", "", reference("inside")),
  ]);
  assert.ok(analyse(project).issues.some((issue) => issue.nodeId === "after"));
});
test("loop item is available inside but cannot escape the loop", () => {
  const project = templateById("sum").create();
  project.steps.push(print("escaped", "", reference("basket_loop_item")));
  assert.ok(
    analyse(project).issues.some((issue) => issue.nodeId === "escaped"),
  );
  assert.ok(
    !analyse(project).issues.some((issue) => issue.nodeId === "basket_add"),
  );
});
test("questions nested in a condition are rejected to keep stdin protocol unambiguous", () => {
  const project = templateById("discount").create();
  project.steps[1].yes.push(createNode("input"));
  assert.ok(
    analyse(project).issues.some((issue) => /вне условий/.test(issue.message)),
  );
});
test("unsafe imported arithmetic operators are rejected before generation", () => {
  const project = templateById("delivery").create();
  project.steps[1].config.operator = "; System.exit(0);";
  assert.throws(() => compileBlueprint(project));
});
test("text comparisons use value equality instead of Java reference equality", () => {
  const project = program([
    node(
      "condition",
      "condition",
      {
        left: literal("да", "text"),
        operator: "==",
        right: literal("да", "text"),
      },
      { yes: [print("yes", "OK")], no: [] },
    ),
  ]);
  assert.equal(simulate(project).stdout, "OK\n");
  assert.match(compileBlueprint(project).source, /Objects.equals/);
  project.steps[0].config.operator = ">";
  assert.equal(analyse(project).valid, false);
});
test("human labels never become Java identifiers or expressions", () => {
  const project = templateById("delivery").create();
  project.steps[0].config.name = 'Цена "; System.exit(0); //';
  const source = compileBlueprint(project).source;
  assert.ok(!source.includes("Цена"));
  assert.match(source, /v_delivery_price/);
});
test("Java string encoding escapes quotes, slashes, control characters and newlines", () => {
  assert.equal(javaString('"\\\n\0'), '"\\"\\\\\\n\\000"');
  const project = program([print("text", '"; System.exit(5); //\nПривет')]);
  assert.equal(simulate(project).stdout, '"; System.exit(5); //\nПривет\n');
  assert.match(compileBlueprint(project).source, /\\nПривет/);
});
test("comments cannot inject Java Unicode line terminators", () => {
  const project = program([
    node("note", "note", { text: "\\u000a System.exit(0);" }),
    print("print", "OK"),
  ]);
  assert.ok(!compileBlueprint(project).source.includes("\\u000a"));
});
test("source map chooses the innermost block", () => {
  const compiled = compileBlueprint(templateById("sum").create());
  const line = compiled.spans.basket_add.end;
  assert.equal(sourceBlockForLine(compiled, line), "basket_add");
  assert.equal(sourceBlockForLine(compiled, 1), null);
});
test("stop ends the model and unreachable following actions are reported", () => {
  assert.equal(
    simulate(program([print("one", "First"), node("stop", "stop", {})])).stdout,
    "First\n",
  );
  assert.equal(
    analyse(program([node("stop", "stop", {}), print("later", "Later")])).valid,
    false,
  );
});
test("runtime work budget terminates nested repetition without hanging", () => {
  const inner = node(
    "inner",
    "repeat",
    { times: literal(1000), itemName: "Inner" },
    { body: [node("value", "value", { name: "Value", value: literal(1) })] },
  );
  const outer = node(
    "outer",
    "repeat",
    { times: literal(1000), itemName: "Outer" },
    { body: [inner] },
  );
  assert.throws(() => simulate(program([outer])), /много действий/);
});
test("store add, edit, undo and redo preserve exact visual structure", () => {
  const store = new BlueprintStore(emptyProject());
  const id = store.add("print");
  store.update(id, (node) => {
    node.config.text = "Changed";
  });
  assert.equal(store.project.steps[0].config.text, "Changed");
  store.undo();
  assert.equal(store.project.steps[0].config.text, "Результат: ");
  store.redo();
  assert.equal(store.project.steps[0].config.text, "Changed");
});
test("no-op transactions do not grow history or invalidate revision", () => {
  const store = new BlueprintStore(templateById("hello").create());
  assert.equal(
    store.transact(() => {}),
    false,
  );
  assert.equal(store.revision, 0);
});
test("moving nodes supports reordering and rejects placement into descendants", () => {
  const store = new BlueprintStore(templateById("hello").create());
  store.move("hello_result", { parentId: null, branch: "steps", index: 0 });
  assert.equal(store.project.steps[0].id, "hello_result");
  const nested = new BlueprintStore(templateById("sum").create());
  assert.throws(
    () =>
      nested.move("basket_loop", {
        parentId: "basket_loop",
        branch: "body",
        index: 0,
      }),
    /самого себя/,
  );
});
test("deep duplication remaps nested IDs and internal variable references", () => {
  const store = new BlueprintStore(templateById("sum").create());
  const id = store.duplicate("basket_loop");
  const copied = locate(store.project, id).node;
  assert.notEqual(copied.body[0].id, "basket_add");
  assert.equal(copied.body[0].config.value.id, itemId(copied));
  assert.equal(copied.body[0].config.target, "basket_total");
  assert.equal(analyse(store.project).valid, true);
});
test("insertion context exposes only preceding values and loop items", () => {
  const project = templateById("sum").create();
  assert.equal(scopeForSlot(project, null, "steps", 0).size, 0);
  assert.equal(
    scopeForSlot(project, "basket_loop", "body", 0).has("basket_loop_item"),
    true,
  );
  assert.equal(
    scopeForSlot(project, null, "steps", 3).has("basket_loop_item"),
    false,
  );
});
test("import rejects foreign schema, duplicate IDs, unknown types and excessive size", () => {
  assert.throws(() => assertStructure({ schema: "other", steps: [] }));
  assert.throws(() =>
    assertStructure(program([print("same", "a"), print("same", "b")])),
  );
  assert.throws(() => assertStructure(program([node("unknown", "shell", {})])));
  assert.throws(() =>
    assertStructure(
      program(
        Array.from({ length: LIMITS.nodes + 1 }, (_, i) => print(`n${i}`, "a")),
      ),
    ),
  );
});
test("removing a referenced input creates actionable errors rather than invalid Java", () => {
  const store = new BlueprintStore(templateById("delivery").create());
  store.remove("delivery_price");
  assert.equal(analyse(store.project).valid, false);
  assert.throws(() => compileBlueprint(store.project), /предыдущих шагов/);
  store.undo();
  assert.equal(analyse(store.project).valid, true);
});
