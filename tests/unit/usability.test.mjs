import test from "node:test";
import assert from "node:assert/strict";
import { IdeApplication } from "../../web/ide/app.mjs";
import { QualityLab } from "../../web/ide/quality.mjs";
import { portPresentation } from "../../web/blueprint/presentation.mjs";
import { generate } from "../../web/blueprint/codegen.mjs";
import { verifyPanel, planModal, qualityStatus } from "../../web/ide/quality-views.mjs";
import { shell, toolbar } from "../../web/ide/views.mjs";
import { toolsMenuHtml } from "../../web/ide/tools.mjs";
import { graphShell } from "../../web/components/graph.mjs";
import { methodContextHtml } from "../../web/ide/workspace.mjs";

test("compact shell has one action trigger, a separate help icon and no second command bar", () => {
  const html = shell();
  assert.equal([...html.matchAll(/id="ide-tools-trigger"/g)].length, 1);
  assert.doesNotMatch(html, /ux-command-bar|data-action="tool-group"|ide-command-trigger/);
  assert.match(html, /aria-label="Поиск"[^>]*title="Поиск"/);
});

test("help and actions menus do not duplicate one another or include search and project banners", () => {
  const actions = toolsMenuHtml({});
  const help = toolsMenuHtml({}, "help");
  assert.doesNotMatch(actions, /data-action="guide"|data-group="view"|data-group="help"|tools-filter|tools-project/);
  assert.match(help, /data-action="guide"/);
  assert.doesNotMatch(help, /tools-filter|tools-project|data-action="home"|data-action="settings"|data-action="run"/);
});

test("method controls name the method once and reserve layout for icons without the fullscreen action", () => {
  const context = methodContextHtml({ methodId: "m", methods: [{ id: "m", owner: "Order", name: "id" }], editing: false });
  const html = toolbar({ path: "Order.java", language: "java" }, "blueprint", {}, false, context);
  assert.equal([...html.matchAll(/Order\.id/g)].length, 1);
  assert.doesNotMatch(html, /Вызывают|Вызывает|ветвлений|ide-breadcrumb|focus-workspace|>Рядом<|>Схема</);
  assert.match(html, /data-action="toggle-sidebar"/);
});

test("minimal algorithm shell omits the duplicate title, legend and watermark", () => {
  const html = graphShell({ title: "Order.id", toolbar: false, minimal: true });
  assert.doesNotMatch(html, /Order\.id|graph-topline|graph-legend|graph-watermark/);
  assert.match(html, /data-action="graph-fit"/);
});

test("switching to blocks preserves the user's canvas layout", async () => {
  let rendered = 0;
  const app = { mode: "blueprint", documents: { active: null }, root: { querySelector: () => null }, renderGraph: () => rendered++, setMode: () => assert.fail("layout must stay unchanged") };
  await IdeApplication.prototype.action.call(app, "blueprint-edit", { dataset: { edit: "1" } });
  assert.equal(app.mode, "blueprint");
  assert.equal(app.blueprintEditing, true);
  assert.equal(rendered, 1);
});

test("port appearance changes labels and colours without changing generated Java", () => {
  const graph = { method: { name: "f", returnType: "int", params: [] }, nodes: [
    { id: "e", type: "entry", props: {} }, { id: "r", type: "return", props: {} }, { id: "v", type: "literal", props: { type: "int", value: "7" } },
  ], links: [{ from: "e", fromPin: "then", to: "r", toPin: "in" }, { from: "v", fromPin: "value", to: "r", toPin: "value" }] };
  const before = generate(graph).code;
  graph.nodes[2].appearance = { ports: { "out:value": { label: "Количество товаров", color: "#123456" } } };
  assert.equal(generate(graph).code, before);
  assert.deepEqual(portPresentation(graph.nodes[2], { id: "value", type: "int", kind: "data" }, "out"), { label: "Количество товаров", color: "#123456", type: "int" });
  graph.nodes[2].appearance.ports["out:value"].color = "url(unsafe)";
  assert.match(portPresentation(graph.nodes[2], { id: "value", type: "int", kind: "data" }, "out").color, /^#[0-9a-f]{6}$/i);
});

test("flow ports get explicit readable defaults", () => {
  assert.equal(portPresentation({}, { id: "true", kind: "exec" }, "out").label, "Да · true");
  assert.equal(portPresentation({}, { id: "in", kind: "exec" }, "in").label, "Выполнить");
});

test("guided learning loads a tested example and never replaces an open project", async () => {
  const loaded = [];
  const app = { acknowledgeWelcome: async () => {}, bridge: { openExample: async (name) => { loaded.push(name); return {}; } }, adopt: async () => {}, showLearningStep: async () => {} };
  await IdeApplication.prototype.startLearning.call(app);
  assert.deepEqual(loaded, ["shop-monolith"]);
  app.project = { id: "user-project" };
  await IdeApplication.prototype.startLearning.call(app);
  assert.deepEqual(loaded, ["shop-monolith"]);
});

test("task fix opens a preview instead of silently applying code", async () => {
  const calls = [];
  const app = { documents: { active: null }, quality: { planForTask: async () => ({ id: "p1" }), action: async (...args) => calls.push(args), applyPlans: () => assert.fail("must not apply without preview") } };
  await IdeApplication.prototype.action.call(app, "task-fix", { dataset: { file: "Main.java", id: "p1" } });
  assert.equal(calls[0][0], "plan-preview");
});

test("automatic fixes refuse missing inputs and unresolved previous changes", async () => {
  await assert.rejects(() => QualityLab.prototype.applyPlans.call({ pending: { label: "previous" } }, ["p1"]), /предыдущее изменение/);
  await assert.rejects(() => QualityLab.prototype.applyPlans.call({ pending: null, enabledCases: () => [] }, ["p1"]), /тестовый вход/);
});

test("verification tab re-renders the visible workspace instead of the hidden bottom panel", () => {
  const selectors = [];
  const visible = { contains: () => false, querySelector: () => null, innerHTML: "" };
  const app = { workspace: "verify", root: { querySelector: (selector) => { selectors.push(selector); return visible; } }, documents: { active: null }, runConfig: { mainClass: "Main" } };
  const quality = new QualityLab(app);
  quality.project = { id: "test" };
  const previous = globalThis.document;
  globalThis.document = { activeElement: null };
  try { quality.renderPanel(); } finally { globalThis.document = previous; }
  assert.equal(selectors[0], "#ws-verify-panel");
  assert.match(visible.innerHTML, /Главный класс для проверки/);
});

test("plan preview explains inputs and disables apply until inputs are configured", () => {
  const plan = { id: "p1", title: "Fix", before: "int a=1;", after: "int a=2;" };
  assert.match(planModal(plan, { cases: [] }), /data-action="plan-apply"[^>]*disabled/);
  const html = planModal(plan, { cases: [{ name: "Граница", input: "0", enabled: true }, { name: "Отключён", input: "1", enabled: false }], mainClass: "Main" });
  assert.match(html, /Граница/);
  assert.doesNotMatch(html, /Отключён/);
  assert.doesNotMatch(html, /data-action="plan-apply"[^>]*disabled/);
});

test("infrastructure failure is presented as unverified rather than changed behaviour", () => {
  const html = verifyPanel({ project: {}, cases: [], tab: "results", lab: {}, report: { passed: false, inconclusive: true, tests: [] } });
  assert.match(html, /Не удалось проверить: ошибка среды запуска/);
  assert.doesNotMatch(html, /<b>Поведение изменилось<\/b>/);
  const status = qualityStatus({ project: {}, report: { passed: false, inconclusive: true, tests: [] } });
  assert.match(status, /Не удалось проверить/);
  assert.doesNotMatch(status, /Расхождение/);
});
