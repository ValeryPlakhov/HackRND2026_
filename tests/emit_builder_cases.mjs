import { TEMPLATES, templateAnswers } from "../web/builder/templates.mjs";
import { compileBlueprint } from "../web/builder/compiler.mjs";
import { simulate, inputText } from "../web/builder/runtime.mjs";
import { emptyProject } from "../web/builder/model.mjs";

const cases = [];
for (const template of TEMPLATES) {
  const project = template.create(),
    compiled = compileBlueprint(project);
  const variants = [templateAnswers(project)];
  if (template.id === "discount")
    variants.push({ shop_amount: "999" }, { shop_amount: "1000" });
  if (template.id === "sum")
    variants.push(
      { basket_prices: "" },
      { basket_prices: "-5\t10 10" },
      { basket_prices: "2147483647 1" },
    );
  if (template.id === "hello")
    variants.push({ hello_name: '"; System.exit(9); // Кириллица 🧩' });
  for (const answers of variants)
    cases.push({
      name: template.id + "-" + cases.length,
      source: compiled.source,
      input: inputText(compiled, answers),
      expected: simulate(project, answers).stdout,
    });
}
const project = {
  ...emptyProject("Escapes"),
  steps: [
    {
      id: "escaped",
      type: "print",
      config: { text: '"\\\t\nКириллица 🧩\0', value: null },
    },
  ],
};
cases.push({
  name: "escapes",
  source: compileBlueprint(project).source,
  input: "",
  expected: simulate(project).stdout,
});
console.log(JSON.stringify(cases));
