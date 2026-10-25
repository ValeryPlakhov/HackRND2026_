// Task-oriented workspaces: project map, task list, method context and the behaviour check page.
// Everything here is built from the project analysis (/api/project) and the refactoring plans (/api/plans).
import { escapeHtml as e, basename, timeLabel } from "./core.mjs";
import { glyph, button } from "./views.mjs";
import { complexityTone, severityBadge } from "./quality-views.mjs";

export const WORKSPACES = [
  { id: "overview", label: "Обзор", icon: "nodes", hint: "Что это за программа и с чего начать", key: "1" },
  { id: "method", label: "Метод", icon: "method", hint: "Логика метода блоками и кодом, кто его вызывает", key: "2" },
  { id: "tasks", label: "Задачи", icon: "target", hint: "Риски, ускорения и разделение монолита по приоритету", key: "3" },
  { id: "verify", label: "Проверка", icon: "shield", hint: "Исходная версия, ваши изменения и результат сравнения поведения", key: "4" },
];

export const LANES = [
  { id: "input", title: "Ввод и разбор", hint: "Читает stdin, разбирает команды" },
  { id: "validation", title: "Проверки", hint: "Отсекает неверные данные" },
  { id: "computation", title: "Вычисления", hint: "Бизнес-правила и расчёты" },
  { id: "output", title: "Вывод", hint: "Отчёты и сообщения" },
];

const methodKey = (fileName, methodId) => `${fileName}::${methodId}`;

/** Call graph lookups: resolved callers and callees per method, plus unresolved (library) calls. */
export function callIndex(analysis) {
  const methods = new Map((analysis?.methods ?? []).map((method) => [method.id, method]));
  const callees = new Map();
  const callers = new Map();
  const external = new Map();
  const add = (map, key, value) => {
    if (!map.has(key)) map.set(key, []);
    if (!map.get(key).includes(value)) map.get(key).push(value);
  };
  for (const call of analysis?.calls ?? []) {
    const targets = (call.targets ?? []).filter((target) => methods.has(target));
    for (const target of targets) {
      add(callees, call.from, target);
      add(callers, target, call.from);
    }
    if (!targets.length) add(external, call.from, call.select || call.name);
  }
  const findings = new Map();
  for (const finding of analysis?.findings ?? []) add(findings, methodKey(finding.fileName, finding.methodId), finding);
  return { methods, callees, callers, external, findings };
}

export function entryPoints(analysis) {
  return (analysis?.methods ?? []).filter((method) => method.name === "main" && method.static && method.arity === 1);
}

const speeds = (plan) => Boolean(plan.timeBefore && plan.timeBefore !== "unchanged" && plan.timeBefore !== plan.timeAfter);

/** A fix answers a finding only when it removes what the finding is about, not just because it is nearby. */
export function addresses(finding, plan) {
  const performance = finding.category === "performance" || /LOOP|COMPLEXITY|SEARCH/i.test(finding.rule ?? "");
  return performance && speeds(plan);
}

/** Risk-ordered tasks: what a maintainer should look at first and what the IDE can fix with a check. */
export function buildTasks(analysis, plansByFile = {}) {
  const index = callIndex(analysis);
  const risks = [];
  const advice = [];
  for (const [position, finding] of (analysis?.findings ?? []).entries()) {
    const method = index.methods.get(methodKey(finding.fileName, finding.methodId));
    const task = { kind: "finding", index: position, finding, method };
    (finding.severity === "info" ? advice : risks).push(task);
  }
  const plans = [];
  for (const [fileName, entry] of Object.entries(plansByFile)) {
    for (const plan of entry?.plans ?? []) {
      const method = index.methods.get(methodKey(fileName, plan.methodId));
      plans.push({ kind: "plan", plan, fileName, method });
    }
  }
  // A risk and an automatic fix in the same method become one task: finding → fix → behaviour check.
  const attached = new Set();
  for (const task of risks) {
    task.fixes = plans.filter(
      (candidate) =>
        !attached.has(candidate) &&
        candidate.fileName === task.finding.fileName &&
        candidate.plan.methodId === task.finding.methodId &&
        addresses(task.finding, candidate.plan),
    );
    for (const fix of task.fixes) attached.add(fix);
  }
  const rest = plans.filter((task) => !attached.has(task));
  const faster = rest.filter((task) => speeds(task.plan));
  const simpler = rest.filter((task) => !faster.includes(task));
  const split = (analysis?.modules ?? [])
    .map((module) => {
      const members = module.methods.map((id) => index.methods.get(id)).filter(Boolean);
      const movable = members.filter((method) => method.static && method.name !== "main");
      return { kind: "module", module, members, movable };
    })
    .filter((task) => task.module.id !== "utility" && task.movable.length);
  risks.sort((a, b) => (b.method?.risk ?? 0) - (a.method?.risk ?? 0));
  return { risks, faster, simpler, split, advice };
}

/** O(n^2) → O(n²): how developers write it. */
export function prettyBigO(label = "") {
  return String(label).replace(/\^2/g, "²").replace(/\^3/g, "³");
}

/** What a complexity class means in practice, without the notation. */
export function costText(label = "") {
  const value = prettyBigO(label).replace(/\s+/g, "");
  if (/n³|n\^3/.test(value)) return "данных в 10 раз больше — работает в 1000 раз дольше";
  if (/n²|n\*n/.test(value)) return "данных в 10 раз больше — работает в 100 раз дольше";
  if (/nlogn|n·logn/.test(value)) return "данных в 10 раз больше — работает примерно в 13 раз дольше";
  if (/^O\(logn\)$/.test(value)) return "почти не замедляется с ростом данных";
  if (/^O\(n\)$/.test(value)) return "данных в 10 раз больше — работает в 10 раз дольше";
  if (/^O\(1\)$/.test(value)) return "время не зависит от объёма данных";
  return "";
}

function bigO(label) {
  return label ? `<em class="q-big-o ${complexityTone(label)}" title="${e(costText(label))}">${e(prettyBigO(label))}</em>` : "";
}

const PLAIN_TITLES = {
  NESTED_LOOPS: "Цикл внутри цикла — медленно на больших данных",
};

function riskLevel(method) {
  const risk = method?.risk ?? 0;
  return risk >= 30 ? "high" : risk >= 12 ? "medium" : "low";
}

function methodButton(method, extra = "") {
  return `<button class="ws-method risk-${riskLevel(method)}" data-action="ws-open-method" data-file="${e(method.fileName)}" data-method="${e(method.methodId)}" title="${e(method.owner)}.${e(method.name)} · стр. ${method.line}"><i class="ws-risk-dot"></i><b>${e(method.name === "<init>" ? method.owner : method.name)}()</b>${bigO(method.complexity)}${extra}</button>`;
}

export function workspaceNav(active, counts = {}) {
  return WORKSPACES.map(
    (item) =>
      `<button class="ws-tab ${active === item.id ? "active" : ""}" data-action="workspace" data-workspace="${item.id}" aria-label="${e(item.label)}" aria-pressed="${active === item.id}" title="${e(item.hint)} (Alt+${item.key})">${glyph(item.icon, 15)}<span>${item.label}</span>${counts[item.id] ? `<i class="ws-count">${counts[item.id]}</i>` : ""}</button>`,
  ).join("");
}

function loading(title, detail) {
  return `<section class="ws-page"><div class="ws-empty"><span class="ide-spinner"></span><h2>${e(title)}</h2><p>${e(detail)}</p></div></section>`;
}

function callTreeRows(index, id, expanded, path, depth) {
  const method = index.methods.get(id);
  if (!method) return "";
  const key = [...path, id].join(">");
  const children = index.callees.get(id) ?? [];
  const recursive = path.includes(id);
  const open = expanded.has(key) && !recursive;
  const findings = (index.findings.get(id) ?? []).filter((finding) => finding.severity !== "info").length;
  const external = (index.external.get(id) ?? []).length;
  const row = `<div class="ws-tree-row" style="--depth:${depth}">${
    children.length && !recursive
      ? `<button class="ws-tree-toggle" data-action="ws-tree-toggle" data-key="${e(key)}" aria-expanded="${open}" aria-label="${open ? "Свернуть" : "Развернуть"}">${open ? "▾" : "▸"}</button>`
      : '<span class="ws-tree-toggle"></span>'
  }${methodButton(method)}<small>${e(method.owner)} · стр. ${method.line}${children.length ? ` · вызывает ${children.length}` : ""}${external ? ` · библиотека ${external}` : ""}</small>${recursive ? '<span class="ws-tag">↻ рекурсия</span>' : ""}${findings ? `<span class="ws-tag warn">${glyph("warning", 11)}${findings}</span>` : ""}</div>`;
  if (!open || depth > 12) return row;
  return row + children.map((child) => callTreeRows(index, child, expanded, [...path, id], depth + 1)).join("");
}

export function overviewHtml(state) {
  const { project, analysis, analysing, error, expanded, tasks, report, stale, cases, baseline } = state;
  if (!analysis && (analysing || !error)) return loading("Строим карту проекта", "javac разбирает файлы, затем строятся граф вызовов, ответственности и оценки сложности.");
  if (!analysis)
    return `<section class="ws-page"><div class="ws-empty">${glyph("warning", 30)}<h2>Карту построить не удалось</h2><p>${e(error)}</p>${button("quality-analyse", "Повторить", "loop", "ide-button primary")}</div></details></section>`;
  const index = callIndex(analysis);
  const stats = analysis.stats ?? {};
  const entries = entryPoints(analysis);
  const classes = new Set(analysis.methods.map((method) => method.owner));
  const fixable = tasks.faster.length + tasks.simpler.length;
  const passed = report ? report.tests.filter((test) => test.passed).length : 0;
  const behaviour = !report
    ? `<span class="ws-state neutral">${glyph("shield", 13)}Не проверено</span>`
    : stale
      ? `<span class="ws-state neutral">${glyph("shield", 13)}Проверка устарела</span>`
      : report.inconclusive
        ? `<span class="ws-state neutral">${glyph("warning", 13)}Ошибка среды · не проверено</span>`
      : report.passed
        ? `<span class="ws-state ok">${glyph("circleCheck", 13)}Совпадает с исходной версией ${passed}/${report.tests.length}</span>`
        : `<span class="ws-state bad">${glyph("warning", 13)}Расхождение ${report.tests.length - passed}/${report.tests.length}</span>`;
  const lanes = LANES.map((lane) => {
    const members = analysis.methods
      .filter((method) => method.responsibility === lane.id)
      .sort((a, b) => a.fileName.localeCompare(b.fileName) || a.line - b.line);
    const shown = members.slice(0, 9);
    return `<div class="ws-lane"><header><b>${e(lane.title)}</b><small>${members.length ? `${members.length} методов` : "нет методов"} · ${e(lane.hint)}</small></header><div class="ws-lane-body">${shown.map((method) => methodButton(method)).join("") || '<p class="ws-muted">Ничего не найдено по признакам</p>'}${members.length > shown.length ? `<span class="ws-more">ещё ${members.length - shown.length}</span>` : ""}</div></div>`;
  }).join('<i class="ws-lane-arrow">→</i>');
  const utility = analysis.methods.filter((method) => method.responsibility === "utility").length;
  const roots = entries.length ? entries : [...analysis.methods].sort((a, b) => b.fanOut - a.fanOut).slice(0, 1);
  const tree = roots.map((method) => callTreeRows(index, method.id, expanded, [], 0)).join("");
  const hotspots = (analysis.hotspots ?? []).slice(0, 5).map((spot) => {
    const method = index.methods.get(spot.id) ?? spot;
    const findings = (index.findings.get(spot.id) ?? []).filter((finding) => finding.severity !== "info");
    const reasons = [
      /n/.test(method.complexity ?? "") && method.complexity !== "O(1)" ? `сложность ${method.complexity}` : null,
      method.cyclomatic >= 8 ? `${method.cyclomatic} ветвлений` : null,
      method.lines >= 30 ? `${method.lines} строк` : null,
      method.fanIn > 1 ? `вызывается из ${method.fanIn} мест` : null,
      findings.length ? `${findings.length} риск${findings.length === 1 ? "" : "а"}` : null,
    ].filter(Boolean);
    return `<li>${methodButton(method)}<span>${e(reasons.join(" · ") || "сложнее остальных")}</span></li>`;
  });
  return `<section class="ws-page ws-overview">
    <header class="ws-hero"><div><p class="ws-eyebrow">Карта проекта — чтобы понять чужой код за минуту</p><h1>${e(project.name)}</h1><p class="ws-lead">Где программа начинается, что из чего вызывается и какие места самые сложные. Кликните метод, чтобы открыть его код и схему. ${stats.files ?? 0} файлов · ${classes.size} классов · ${stats.methods ?? 0} методов · ${stats.lines ?? 0} строк. ${entries.length ? `Точка входа: <b>${entries.map((method) => `${e(method.owner)}.main`).join(", ")}</b>.` : "Метод main не найден."}</p></div>
      <div class="ws-hero-cards">
        <button class="ws-kpi" data-action="workspace" data-workspace="tasks"><b>${tasks.risks.length}</b><span>рисков требуют внимания</span></button>
        <button class="ws-kpi" data-action="workspace" data-workspace="tasks"><b>${fixable}</b><span>исправлений IDE сделает сама</span></button>
        <button class="ws-kpi" data-action="workspace" data-workspace="verify"><b>${cases.length}</b><span>тестовых входов${baseline ? " · исходная версия есть" : ""}</span>${behaviour}</button>
      </div></header>
    <div class="ws-scenarios">
      <button data-action="ws-tour">${glyph("eye", 18)}<span><b>Разобраться в коде</b><small>Пройдите от main по дереву вызовов. Клик по методу откроет его логику блоками рядом с кодом</small></span></button>
      <button data-action="workspace" data-workspace="tasks">${glyph("target", 18)}<span><b>Исправить проблемы</b><small>Риски по приоритету. Автоисправление → проверка поведения → принять или откатить</small></span></button>
      <button data-action="ws-build">${glyph("plus", 18)}<span><b>Собрать метод из блоков</b><small>Новый метод в выбранном классе: блоки и провода сразу становятся Java</small></span></button>
    </div>
    <details class="ux-project-details"><summary>Как программа обрабатывает данные</summary><h2 class="ws-section">Путь данных <small>группы по признакам в коде; ещё ${utility} служебных методов (геттеры, конструкторы) скрыты</small></h2>
    <div class="ws-lanes">${lanes}</div>
    </details><details class="ux-project-details"><summary>Дерево вызовов и рискованные методы</summary><div class="ws-columns">
      <div class="ws-card"><h2 class="ws-section">Дерево вызовов <small>${entries.length ? "от точки входа" : "от метода с наибольшим числом вызовов"}</small></h2><div class="ws-tree">${tree || '<p class="ws-muted">Вызовы между методами проекта не найдены</p>'}</div><p class="ws-note">Показаны вызовы, которые удалось связать с методами проекта. Вызовы библиотек и неразрешённые имена посчитаны отдельно.</p></div>
      <div class="ws-card"><h2 class="ws-section">С чего начать <small>самые рискованные методы</small></h2><ol class="ws-hotspots">${hotspots.join("") || '<p class="ws-muted">Сложных методов не найдено</p>'}</ol><p class="ws-note">Риск складывается из сложности, длины, ветвлений и числа вызывающих. Это ориентир для чтения кода, а не оценка качества автора.</p></div>
    </div></details></section>`;
}

function taskCard(task) {
  if (task.kind === "finding") {
    const { finding, method, index, fixes } = task;
    return `<article class="ws-task ${fixes?.length ? "fix" : ""}"><div class="ws-task-head">${severityBadge(finding.severity)}<b>${e(PLAIN_TITLES[finding.rule] ?? prettyBigO(finding.title))}</b></div>${method?.complexity && costText(method.complexity) && /n/.test(method.complexity) ? `<p class="ws-plain"><b>Что это значит:</b> ${e(costText(method.complexity))} (${e(prettyBigO(method.complexity))}).</p>` : ""}<p>${e(finding.detail ?? "")}</p><div class="ws-task-meta">${method ? `<span>${e(method.owner)}.${e(method.name)}()</span>${bigO(method.complexity)}` : ""}<span>${e(basename(finding.fileName))}:${finding.line}</span></div>${(fixes ?? [])
      .map(
        ({ plan, fileName }) =>
          `<div class="ws-fix">${glyph("sparkle", 13)}<span><b>${e(plan.title)}</b>${speeds(plan) ? ` ${bigO(plan.timeBefore)}→${bigO(plan.timeAfter)}<small class="ws-plain">станет: ${e(costText(plan.timeAfter))}</small>` : ""}</span>${button("task-fix", "Разобрать исправление", "check", "ide-button small primary", `data-file="${e(fileName)}" data-id="${e(plan.id)}"`)}</div>`,
      )
      .join("")}<div class="ws-task-actions">${button("open-finding", "Показать в коде и блоках", "eye", "ide-button small", `data-index="${index}"`)}${fixes?.length ? "" : '<span class="ws-muted">Автоисправления нет — разберите вручную</span>'}</div></article>`;
  }
  if (task.kind === "plan") {
    const { plan, fileName, method } = task;
    const speed = speeds(plan);
    return `<article class="ws-task fix"><div class="ws-task-head"><span class="ws-tag ok">${glyph("sparkle", 11)}${speed ? "ускорение" : "упрощение"}</span><b>${e(plan.title)}</b></div><p>${e(plan.rationale)}</p><div class="ws-task-meta">${method ? `<span>${e(method.owner)}.${e(method.name)}()</span>` : ""}<span>${e(basename(fileName))}:${plan.line}</span>${speed ? `${bigO(plan.timeBefore)}→${bigO(plan.timeAfter)}` : ""}</div><div class="ws-task-actions">${button("task-fix", "Разобрать исправление", "check", "ide-button small primary", `data-file="${e(fileName)}" data-id="${e(plan.id)}"`)}</div></article>`;
  }
  const { module, members, movable } = task;
  const lanes = Object.fromEntries(LANES.map((lane) => [lane.id, lane.title]));
  return `<article class="ws-task"><div class="ws-task-head"><span class="ws-tag">${glyph("layers", 11)}новый класс</span><b>${e(module.suggestedClass)}</b></div><p>${e(lanes[module.id] ?? module.id)}: ${members.length} методов, ${module.lines} строк. Перенести можно ${movable.length} static-методов, в монолите останутся делегаты.</p><div class="ws-task-meta">${movable.slice(0, 6).map((method) => `<span>${e(method.name)}()</span>`).join("")}${movable.length > 6 ? `<span>ещё ${movable.length - 6}</span>` : ""}</div><div class="ws-task-actions">${button("decompose-open", "Выделить класс и проверить", "layers", "ide-button small primary", `data-module="${e(module.id)}"`)}</div></article>`;
}

function changeBanner({ pending, report, stale, job }) {
  if (job && ["queued", "running"].includes(job.state))
    return `<div class="ws-banner running"><span><b>${e(job.stage || "Проверяем поведение")}…</b> Обе версии собираются и запускаются на тестовых входах.</span><span class="ws-progress" role="progressbar" aria-label="Выполняется проверка"><i></i></span></div>`;
  if (!pending) return "";
  if (report?.inconclusive && !stale) return `<div class="ws-banner">${glyph("warning", 15)}<span><b>Ошибка среды запуска.</b> Поведение не проверено. Повторите запуск или откатите изменение.</span>${button("verify", "Повторить проверку", "shield", "ide-button small")}${button("rollback-change", "Откатить", "undo", "ide-button small")}</div>`;
  if (!report || stale)
    return `<div class="ws-banner">${glyph("info", 15)}<span><b>Применено: ${e(pending.label)}.</b> Поведение ещё не проверено.</span>${button("verify", "Проверить", "shield", "ide-button small primary")}${button("rollback-change", "Откатить", "undo", "ide-button small")}</div>`;
  const passed = report.tests.filter((test) => test.passed).length;
  return report.passed
    ? `<div class="ws-banner ok">${glyph("circleCheck", 15)}<span><b>${e(pending.label)}: поведение совпало ${passed}/${report.tests.length}.</b> Сохраните файл, чтобы принять изменение.</span>${button("save-all", "Принять и сохранить", "check", "ide-button small primary")}${button("rollback-change", "Откатить", "undo", "ide-button small")}</div>`
    : `<div class="ws-banner bad">${glyph("warning", 15)}<span><b>${e(pending.label)}: расхождение на ${report.tests.length - passed} из ${report.tests.length} входов.</b> Изменение не стоит принимать.</span>${button("rollback-change", "Откатить", "undo", "ide-button small primary")}${button("workspace", "Разобрать расхождение", "diff", "ide-button small", 'data-workspace="verify"')}</div>`;
}

export function tasksHtml(state) {
  const { analysis, analysing, error, tasks, plansLoading, showAdvice } = state;
  if (!analysis && (analysing || !error)) return loading("Собираем задачи", "Ищем риски, применимые оптимизации и кандидатов на выделение классов.");
  if (!analysis)
    return `<section class="ws-page"><div class="ws-empty">${glyph("warning", 30)}<h2>Анализ не выполнен</h2><p>${e(error)}</p>${button("quality-analyse", "Повторить", "loop", "ide-button primary")}</div></section>`;
  const section = (title, hint, items, empty) =>
    `<h2 class="ws-section">${title} <span class="ws-count">${items.length}</span><small>${hint}</small></h2><div class="ws-task-grid">${items.map(taskCard).join("") || `<p class="ws-muted">${empty}</p>`}</div>`;
  return `<section class="ws-page ws-tasks">
    <header class="ws-hero compact"><div><p class="ws-eyebrow">Задачи</p><h1>Что сделать с кодом</h1><p class="ws-lead">Места, где программа может тормозить или ломаться. У каждого — что не так простыми словами. Если IDE умеет это исправить, есть кнопка: она поправит код и сразу проверит, что программа выдаёт то же самое. Не понравилось — «Откатить».</p></div></header>
    ${changeBanner(state)}
    ${section("Риски", "места, где вероятна ошибка или медленная работа", tasks.risks, "Правила не нашли рисков. Это не доказывает отсутствие ошибок — проверьте поведение тестами.")}
    ${plansLoading ? '<div class="q-loading"><span class="ide-spinner small"></span>Ищем применимые преобразования во всех файлах…</div>' : ""}
    ${section("Ускорить", "IDE перепишет участок и сразу проверит поведение", tasks.faster, "Распознанных шаблонов ускорения нет.")}
    ${section("Упростить", "та же логика короче и понятнее", tasks.simpler, "Упрощений не найдено.")}
    ${section("Разделить монолит", "группы методов по ответственности, которые можно вынести в отдельный класс", tasks.split, "Кандидатов на выделение нет: переносятся только static-методы.")}
    <details class="ws-advice" ${showAdvice ? "open" : ""}><summary>Советы по стилю и сопровождению <span class="ws-count">${tasks.advice.length}</span></summary><div class="ws-task-grid">${tasks.advice.map(taskCard).join("")}</div></details>
  </section>`;
}

/** One row above the method: who calls it, which method is open (with cost), what it calls. */
export function methodContextHtml({ methodId, methods = [], canBack, editing, canAdd }) {
  const back = canBack ? `<button class="ide-icon-button" data-action="nav-back" title="Назад (Alt+←)" aria-label="К предыдущему методу">${glyph("undo",16)}</button>` : "";
  const select = `<label class="sr-only" for="ide-method-select">Метод</label><select id="ide-method-select" aria-label="Метод" ${!methods.length ? "disabled" : ""}>${methods.map(item => `<option value="${e(item.id)}" ${item.id === methodId ? "selected" : ""}>${e(item.owner)}.${e(item.name === "<init>" ? item.owner : item.name)}()</option>`).join("") || "<option>Нет методов</option>"}</select>`;
  const toggle = `<div class="ws-edit-toggle" role="group" aria-label="Вид метода"><button data-action="blueprint-edit" data-edit="0" class="${editing ? "" : "active"}" aria-pressed="${!editing}">Алгоритм</button><button data-action="blueprint-edit" data-edit="1" class="${editing ? "active" : ""}" aria-pressed="${editing}">Блоки</button></div>`;
  const add = editing && canAdd ? `<button class="ide-icon-button" data-action="new-method" aria-label="Добавить метод" title="Добавить метод">${glyph("plus",16)}</button>` : "";
  return `<div class="ux-method-controls">${back}${select}${toggle}${add}</div>`;
}

/** Changed files relative to the baseline, from what the editor currently holds. */
export function baselineChanges(baseline, documents) {
  if (!baseline) return [];
  const changed = [];
  for (const [path, document] of documents) {
    if (document.language !== "java") continue;
    const before = baseline.files[path];
    if (before === undefined) changed.push({ path, status: "added" });
    else if (before !== document.content) changed.push({ path, status: "modified" });
  }
  return changed;
}

export function verifyHeaderHtml({ baseline, changes, report, stale, job, pending, cases }) {
  const running = job && ["queued", "running"].includes(job.state);
  const passed = report ? report.tests.filter((test) => test.passed).length : 0;
  const enabled = cases.filter((item) => item.enabled !== false).length;
  const result = running
    ? ["running", "Идёт проверка", "Сборка javac и запуск обеих версий"]
    : !report
      ? ["neutral", "Не проверено", changes.length ? "Нажмите «Проверить поведение»" : "Изменений относительно исходной версии нет"]
      : stale
        ? ["neutral", "Устарело", "Код или тесты изменились после проверки"]
        : report.inconclusive
          ? ["neutral", "Не определено", "Сбой среды запуска, а не программы"]
          : report.passed
            ? ["ok", `Совпало ${passed}/${report.tests.length}`, "stdout, stderr без Java stack frames и код завершения совпали"]
            : ["bad", `Расхождение ${report.tests.length - passed}/${report.tests.length}`, "Откройте вход с расхождением ниже"];
  const step = (n, title, body, tone = "") => `<div class="ws-step ${tone}"><span>${n}</span><div><b>${title}</b>${body}</div></div>`;
  return `<header class="ws-hero compact"><div><p class="ws-eyebrow">Проверка поведения</p><h1>Ничего не сломалось?</h1><details class="ux-check-help"><summary>Как проходит сравнение?</summary><p>Исходный снимок и текущий редактор компилируются и запускаются отдельно на одинаковом stdin. Совпадение на выбранных входах не доказывает эквивалентность для всех данных. Подробности — в руководстве.</p></details></div></header>
  <div class="ws-steps">
    ${step(1, "Исходная версия", `<small>${baseline ? `${e(baseline.label || "Снимок")} · ${Object.keys(baseline.files).length} файлов${baseline.takenAt ? " · " + e(timeLabel(baseline.takenAt)) : ""}` : "не зафиксирован"}</small>`)}
    ${step(2, "Ваши изменения", `<small>${changes.length ? changes.map((item) => `${e(basename(item.path))}${item.status === "added" ? " (новый)" : ""}`).join(", ") : "нет отличий от исходной версии"}${pending ? ` · последнее: ${e(pending.label)}` : ""}</small>`, changes.length ? "active" : "")}
    ${step(3, "Тестовые входы", `<small>${enabled} из ${cases.length} включено</small>`, enabled ? "" : "bad")}
    ${step(4, result[1], `<small>${result[2]}</small>`, result[0])}
    <div class="ws-step-actions">${button("verify", running ? "Проверяется…" : "Проверить поведение", "shield", "ide-button primary", running || !enabled ? "disabled" : "")}${pending ? button("rollback-change", "Откатить изменение", "undo", "ide-button") : ""}${button("baseline-diff", "Что изменено", "diff", "ide-button subtle")}${report?.passed && !stale && changes.length ? button("save-all", "Принять и сохранить", "check", "ide-button") : ""}</div>
  </div>`;
}

const SIMPLE = new Set(["variable", "operation"]);

export function plural(count, one, few, many) {
  const tens = count % 100;
  const units = count % 10;
  if (tens >= 11 && tens <= 14) return many;
  if (units === 1) return one;
  return units >= 2 && units <= 4 ? few : many;
}

const COMPOUND = new Set(["entry", "condition", "loop", "switch", "try", "catch"]);
const KEYWORD = /^\s*(else\s+if|if|else|for|while|do|switch|try|catch|finally|return|throw|break|continue|synchronized)\b/;

/** What a step looks like in Java terms: the keyword as the tag and the statement head as the text. */
export function javaFace(node) {
  const code = String(node.code ?? "").trim();
  const flat = (value) => value.replace(/\s+/g, " ").trim();
  if (node.kind === "entry") return { tag: "method", text: flat(code.slice(0, Math.max(code.indexOf("{"), 0) || code.length)) || node.label };
  if (node.kind === "exit") return { tag: "end", text: "конец метода" };
  const word = KEYWORD.exec(code)?.[1]?.replace(/\s+/g, " ");
  const head = COMPOUND.has(node.kind) && code.includes("{") ? flat(code.slice(0, code.indexOf("{"))) : flat(code || node.label);
  if (word) return { tag: word, text: head };
  if (node.kind === "variable") return { tag: "var", text: head };
  if (node.kind === "operation") return { tag: /^[\w.\[\]]+\s*(=|\+=|-=|\*=|\/=|%=)[^=]|^[\w.\[\]]+(\+\+|--)/.test(head) || /^(\+\+|--)/.test(head) ? "assign" : "call", text: head };
  if (node.kind === "condition") return { tag: "if", text: head };
  if (node.kind === "loop") return { tag: "loop", text: head };
  return { tag: node.kind, text: head };
}

/**
 * Reading view of a control-flow graph: runs of plain statements collapse into one «steps» node,
 * so branches, loops and exits are what the eye sees first. Spans and the first line are kept.
 */
export function condenseGraph(graph, expanded = new Set()) {
  const nodes = new Map((graph?.nodes ?? []).map((node) => [node.id, node]));
  const outgoing = new Map();
  const incoming = new Map();
  for (const edge of graph?.edges ?? []) {
    if (!outgoing.has(edge.from)) outgoing.set(edge.from, []);
    if (!incoming.has(edge.to)) incoming.set(edge.to, []);
    outgoing.get(edge.from).push(edge);
    incoming.get(edge.to).push(edge);
  }
  const next = (node) => {
    const out = outgoing.get(node.id) ?? [];
    if (out.length !== 1 || expanded.has(node.id)) return null;
    const target = nodes.get(out[0].to);
    if (!target || expanded.has(target.id) || !SIMPLE.has(target.kind) || target.depth !== node.depth) return null;
    return (incoming.get(target.id) ?? []).length === 1 ? target : null;
  };
  const owner = new Map();
  const result = [];
  for (const node of graph?.nodes ?? []) {
    if (owner.has(node.id)) continue;
    const previous = (incoming.get(node.id) ?? []).length === 1 ? nodes.get(incoming.get(node.id)[0].from) : null;
    const continues = previous && SIMPLE.has(previous.kind) && next(previous) === node;
    if (!SIMPLE.has(node.kind) || continues) {
      if (!continues) {
        owner.set(node.id, node.id);
        result.push(node);
      }
      continue;
    }
    const chain = [node];
    for (let item = next(node); item && !owner.has(item.id); item = next(item)) chain.push(item);
    for (const item of chain) owner.set(item.id, node.id);
    if (chain.length === 1) {
      result.push(node);
      continue;
    }
    const statements = chain.map((item) => String(item.label).replace(/\s+/g, " ").trim());
    result.push({
      ...node,
      kind: "sequence",
      label: `${chain.length} ${plural(chain.length, "шаг", "шага", "шагов")}: ${statements.slice(0, 3).join(" · ")}${chain.length > 3 ? " …" : ""}`,
      end: chain.at(-1).end,
      members: chain.map((item) => item.id),
    });
  }
  // Statements absorbed into a chain are only reachable through it.
  for (const node of graph?.nodes ?? []) if (!owner.has(node.id)) owner.set(node.id, node.id);
  const seen = new Set();
  const edges = [];
  for (const edge of graph?.edges ?? []) {
    const from = owner.get(edge.from);
    const to = owner.get(edge.to);
    if (from === to && edge.from !== edge.to) continue;
    const tail = result.find((node) => node.id === from);
    if (tail?.members && tail.members.at(-1) !== edge.from) continue;
    const key = `${from}>${to}>${edge.label ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ ...edge, from, to });
  }
  const faced = result.map((node) => (node.kind === "sequence" ? { ...node, tag: "steps", text: node.label } : { ...node, ...javaFace(node) }));
  return { ...graph, nodes: faced.map((node) => ({ ...node, label: node.text })), edges };
}

export function methodEmptyHtml() {
  return `<section class="ws-page"><div class="ws-empty">${glyph("method", 30)}<h2>Выберите метод</h2><p>Откройте Java-файл в дереве слева или перейдите к методу с карты проекта: код и схема шагов появятся рядом.</p>${button("workspace", "Карта проекта", "nodes", "ide-button primary", 'data-workspace="overview"')}</div></section>`;
}
