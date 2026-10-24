import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TEMPLATES, templateAnswers } from "../web/builder/templates.mjs";
import { compileBlueprint } from "../web/builder/compiler.mjs";
import { simulate, inputText } from "../web/builder/runtime.mjs";

const root = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "examples",
  "blueprints",
);
for (const template of TEMPLATES) {
  const project = template.create(),
    answers = templateAnswers(project);
  project.inputs = answers;
  const compiled = compileBlueprint(project),
    directory = resolve(root, template.id);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    resolve(directory, "project.blueprint.json"),
    JSON.stringify(project, null, 2),
    "utf8",
  );
  writeFileSync(resolve(directory, "Main.java"), compiled.source, "utf8");
  writeFileSync(
    resolve(directory, "input.txt"),
    inputText(compiled, answers),
    "utf8",
  );
  writeFileSync(
    resolve(directory, "expected.txt"),
    simulate(project, answers).stdout,
    "utf8",
  );
}
console.log(
  "Five visual projects, ordinary Java sources, example inputs and expected outputs generated.",
);
