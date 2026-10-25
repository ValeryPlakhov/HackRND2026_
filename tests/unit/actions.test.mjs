// Every button the interface can render must lead somewhere: no dead controls.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { TOOL_GROUPS, toolAvailable, filterTools } from "../../web/ide/tools.mjs";

const directory = new URL("../../web/ide/", import.meta.url);
const sources = Object.fromEntries(
  readdirSync(directory)
    .filter((name) => name.endsWith(".mjs"))
    .map((name) => [name, readFileSync(new URL(name, directory), "utf8")]),
);
const all = Object.values(sources).join("\n");

/** Names handled by a `case "name":` branch of the app or the quality lab. */
const handled = new Set([...(sources["app.mjs"] + sources["quality.mjs"]).matchAll(/case "([\w-]+)":/g)].map((match) => match[1]));
// Names handled outside a switch: node and editor actions are routed by the editor modules.
for (const name of ["find", "goto-line", "toggle-eol", "comment", "duplicate-line", "sort-lines", "trim-whitespace", "bracket", "complete", "undo", "redo"]) handled.add(name);

/** Literal actions from data-action attributes and the button()/iconButton() helpers. */
function rendered() {
  const names = new Map();
  const add = (name, where) => name && !name.includes("$") && names.set(name, where);
  for (const [file, text] of Object.entries(sources)) {
    for (const match of text.matchAll(/data-action="([\w-]+)"/g)) add(match[1], file);
    for (const match of text.matchAll(/\b(?:button|iconButton)\(\s*"([\w-]+)"/g)) add(match[1], file);
  }
  return names;
}

test("every rendered action has a handler", () => {
  const missing = [...rendered()].filter(([name]) => !handled.has(name));
  assert.deepEqual(missing, [], `buttons without a handler: ${missing.map(([name, file]) => `${name} (${file})`).join(", ")}`);
});

test("every tool in the menu is wired to a handler", () => {
  for (const group of TOOL_GROUPS)
    for (const item of group.items) assert.ok(handled.has(item.action), `${group.id}/${item.label}: no handler for "${item.action}"`);
});

test("tool availability follows what is open", () => {
  const verify = TOOL_GROUPS.flatMap((group) => group.items).find((item) => item.action === "verify");
  const mutation = TOOL_GROUPS.flatMap((group) => group.items).find((item) => item.action === "lab-mutation");
  assert.equal(toolAvailable(verify, {}), false);
  assert.equal(toolAvailable(verify, { project: {} }), true);
  assert.equal(toolAvailable(mutation, { project: {}, method: null }), false);
  assert.equal(toolAvailable(mutation, { project: {}, method: {} }), true);
});

test("the menu filter hides tools and empty groups", () => {
  const item = (search) => ({ dataset: { search }, hidden: false });
  const first = [item("запуск проверки"), item("поиск")];
  const second = [item("справка")];
  const group = (items) => ({ hidden: false, querySelectorAll: () => items });
  const groups = [group(first), group(second)];
  const empty = { hidden: true };
  const menu = { querySelectorAll: () => groups, querySelector: () => empty };
  assert.equal(filterTools(menu, "провер"), 1);
  assert.equal(groups[1].hidden, true);
  assert.equal(filterTools(menu, "нет такого"), 0);
  assert.equal(empty.hidden, false);
  assert.equal(filterTools(menu, ""), 3);
  assert.equal(groups[1].hidden, false);
});
