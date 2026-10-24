import { escapeHtml as e } from "../lib/core.mjs";
import {
  TYPES,
  ARITHMETIC,
  COMPARISONS,
  analyse,
  definitions,
  locate,
  itemId,
} from "./model.mjs";
import { TEMPLATES } from "./templates.mjs";

const paths = {
  logo: '<path d="M6 4h9l3 3v13H6zM9 9h6M9 13h6M9 17h3"/><path d="m16 3 4 0 0 4M20 3l-6 6"/>',
  input: '<path d="M4 7h16v13H4zM8 3v8M5 8l3 3 3-3M8 16h8"/>',
  calculate:
    '<rect x="5" y="3" width="14" height="18" rx="3"/><path d="M8 7h8M8 11h1m3 0h1m3 0h1M8 15h1m3 0h1m3 0h1M8 18h1m3 0h1m3 0h1"/>',
  print:
    '<rect x="3" y="4" width="18" height="14" rx="3"/><path d="m7 9 2 2-2 2M12 13h4M8 21h8M12 18v3"/>',
  condition: '<path d="m12 3 8 9-8 9-8-9zM9 12h6"/>',
  repeat:
    '<path d="M19 8a7 7 0 0 0-12-3L4 8m0-5v5h5M5 16a7 7 0 0 0 12 3l3-3m0 5v-5h-5"/>',
  value: '<path d="m4 7 8-4 8 4-8 4zM4 7v10l8 4 8-4V7M12 11v10"/>',
  note: '<path d="M5 3h14v14l-4 4H5zM8 8h8M8 12h8M8 16h4M15 21v-4h4"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  play: '<path d="m8 4 12 8-12 8z"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  undo: '<path d="M4 5v6h6M4 11c1-6 15-7 16 1 1 6-8 9-12 5"/>',
  redo: '<path d="M20 5v6h-6M20 11C19 5 5 4 4 12c-1 6 8 9 12 5"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 17v4h16v-4"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 5M12 17h.01"/>',
  code: '<path d="m7 7-5 5 5 5m10-10 5 5-5 5M14 4l-4 16"/>',
  grip: '<path d="M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V3H3v13h5"/>',
  up: '<path d="m6 14 6-6 6 6"/>',
  down: '<path d="m6 10 6 6 6-6"/>',
  hello:
    '<path d="M7 12V6a2 2 0 0 1 4 0v6-8a2 2 0 0 1 4 0v8-5a2 2 0 0 1 4 0v9c0 5-10 7-13 2l-3-5c-1-3 2-4 4-1z"/>',
  discount: '<path d="M4 4h9l8 8-9 9-8-8z"/><circle cx="9" cy="9" r="1.3"/>',
  basket: '<path d="M3 9h18l-2 12H5zM7 9l3-7m7 7-3-7M9 13v4M15 13v4"/>',
  delivery:
    '<path d="M3 5h11v12H3zM14 10h4l3 4v3h-7"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  sparkle:
    '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/>',
};
export function icon(name, size = 20) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.value}</svg>`;
}
export function button(
  label,
  action,
  { className = "", iconName = "", disabled = false, attributes = "" } = {},
) {
  return `<button type="button" class="b-button ${className}" data-action="${action}" ${disabled ? "disabled" : ""} ${attributes}>${iconName ? icon(iconName, 17) : ""}<span>${e(label)}</span></button>`;
}
const iconButton = (name, label, action, attributes = "") =>
  `<button type="button" class="b-icon-button" aria-label="${e(label)}" title="${e(label)}" data-action="${action}" ${attributes}>${icon(name, 17)}</button>`;

export function operandLabel(operand, defs) {
  if (!operand) return "выберите значение";
  if (operand.kind === "ref")
    return defs.get(operand.id)?.name || "значение удалено";
  return operand.type === "text"
    ? `«${operand.value}»`
    : String(operand.value ?? "…");
}

export function nodeSummary(node, defs) {
  const c = node.config,
    label = (operand) => operandLabel(operand, defs);
  switch (node.type) {
    case "input":
      return {
        title: c.name || "Что спросить?",
        detail: {
          number: "Человек введёт число",
          text: "Человек напишет ответ",
          list: "Человек введёт список чисел",
        }[c.dataType],
      };
    case "value":
      return {
        title: `${c.name || "Число"} = ${label(c.value)}`,
        detail: "Используем в следующих шагах",
      };
    case "calculate":
      return {
        title: `${label(c.left)} ${ARITHMETIC[c.operator] ?? "…"} ${label(c.right)}`,
        detail: `Запомним как «${c.name || "результат"}»`,
      };
    case "change":
      return {
        title: `Изменить «${defs.get(c.target)?.name || "выберите число"}»`,
        detail: `${ARITHMETIC[c.operator] ?? "…"} ${label(c.value)}`,
      };
    case "print":
      return {
        title: c.text || (c.value ? "Показать значение" : "Что написать?"),
        detail: c.value
          ? `+ ${label(c.value)}`
          : "Сообщение появится в результате",
      };
    case "condition":
      return {
        title: `${label(c.left)} ${COMPARISONS[c.operator] ?? "…"} ${label(c.right)}`,
        detail: "Дальше пойдём по одному из двух путей",
      };
    case "foreach":
      return {
        title: `Для каждого: ${label(c.list)}`,
        detail: `Внутри доступно «${c.itemName || "Текущее число"}»`,
      };
    case "repeat":
      return {
        title: `Повторить ${label(c.times)} раз`,
        detail: "Каждый раз выполним шаги внутри",
      };
    case "note":
      return {
        title: c.text || "Добавьте пояснение",
        detail: "Заметка не влияет на результат",
      };
    case "stop":
      return {
        title: "На этом закончить",
        detail: "Следующие шаги не выполняются",
      };
  }
}

export function library({ compact = false } = {}) {
  const primary = [
    "input",
    "calculate",
    "print",
    "condition",
    "foreach",
    "value",
  ];
  const tile = (type) =>
    `<button type="button" draggable="true" class="b-library-item ${TYPES[type].color}" data-action="add" data-type="${type}" data-drag-type="${type}"><span class="b-block-icon">${icon(TYPES[type].icon)}</span><span><strong>${TYPES[type].title}</strong><small>${TYPES[type].hint}</small></span>${icon("plus", 15)}</button>`;
  return `<div class="b-library-items ${compact ? "compact" : ""}">${primary.map(tile).join("")}</div><details class="b-more-blocks"><summary>Ещё четыре блока ${icon("down", 14)}</summary><div class="b-library-items">${["change", "repeat", "note", "stop"].map(tile).join("")}</div></details>`;
}

function insertion(parentId, branch, index) {
  return `<div class="b-insertion" data-drop-slot data-parent="${parentId ?? ""}" data-branch="${branch}" data-index="${index}"><button type="button" data-action="insert" data-parent="${parentId ?? ""}" data-branch="${branch}" data-index="${index}" aria-label="Добавить шаг в этом месте">${icon("plus", 12)}<span>Добавить шаг</span></button></div>`;
}

function nodes(steps, project, ui, parentId = null, branch = "steps") {
  const analysis = analyse(project),
    defs = analysis.definitions;
  return `<div class="b-flow-sequence">${steps
    .map((node, index) => {
      const meta = TYPES[node.type],
        summary = nodeSummary(node, defs),
        issues = analysis.issues.filter((issue) => issue.nodeId === node.id);
      const selected = ui.selectedId === node.id,
        traced = ui.tracedNode === node.id;
      const content = `<article class="b-node ${meta.color} ${selected ? "selected" : ""} ${issues.length ? "needs-attention" : ""} ${traced ? "traced" : ""}" data-node="${node.id}"><div class="b-node-top"><span class="b-node-kind">${icon(meta.icon, 15)}${meta.title}</span><button type="button" class="b-drag-handle" draggable="true" data-drag-node="${node.id}" aria-label="Перетащить блок ${e(meta.title)}" title="Перетащите на плюс между шагами">${icon("grip", 16)}</button></div><button type="button" class="b-node-open" data-action="select" data-id="${node.id}" aria-label="Настроить блок: ${e(summary.title)}" aria-pressed="${selected}"><strong>${e(summary.title)}</strong><small>${e(summary.detail)}</small>${issues.length ? `<span class="b-needs-label">Нужно настроить ${icon("chevron", 12)}</span>` : ""}</button></article>`;
      let children = "";
      if (node.type === "condition")
        children = `<div class="b-branches"><section class="b-branch"><div class="b-branch-label yes"><span></span>Да</div>${nodes(node.yes, project, ui, node.id, "yes")}</section><section class="b-branch"><div class="b-branch-label no"><span></span>Нет</div>${nodes(node.no, project, ui, node.id, "no")}</section></div><div class="b-branch-join"></div>`;
      if (["foreach", "repeat"].includes(node.type))
        children = `<div class="b-loop-body"><div class="b-loop-caption">${icon("repeat", 13)}Шаги, которые повторяются</div>${nodes(node.body, project, ui, node.id, "body")}</div>`;
      return (
        insertion(parentId, branch, index) +
        `<div class="b-flow-unit">${content}${children}</div>`
      );
    })
    .join(
      "",
    )}${insertion(parentId, branch, steps.length)}${steps.length ? "" : `<div class="b-empty-branch">${parentId ? "Добавьте действие для этого пути" : "Начните с блока слева или выберите пример"}</div>`}</div>`;
}

const field = (label, control, hint = "") =>
  `<label class="b-field"><span>${label}</span>${control}${hint ? `<small>${hint}</small>` : ""}</label>`;
const input = (
  name,
  value = "",
  { type = "text", placeholder = "", maxLength = 50, ariaLabel = "" } = {},
) =>
  `<input name="${name}" type="${type}" value="${e(value ?? "")}" placeholder="${e(placeholder)}" maxlength="${maxLength}" ${ariaLabel ? `aria-label="${e(ariaLabel)}"` : ""} ${type === "number" ? 'step="1" min="-2147483648" max="2147483647"' : ""}>`;
const select = (name, value, choices) =>
  `<select name="${name}">${choices.map(([key, label]) => `<option value="${e(key)}" ${String(value) === String(key) ? "selected" : ""}>${e(label)}</option>`).join("")}</select>`;

function operandField(
  label,
  key,
  operand,
  scope,
  { type = "number", optional = false } = {},
) {
  const options = [...scope.values()]
    .filter((item) => !type || item.type === type)
    .map((item) => [`ref:${item.id}`, item.name]);
  const source =
    operand?.kind === "ref"
      ? `ref:${operand.id}`
      : operand?.kind === "literal"
        ? operand.type
        : "none";
  const choices = [
    ...(optional ? [["none", "Только сообщение, без значения"]] : []),
    ...(type !== "list"
      ? [
          ["number", "Ввести число"],
          ...(!type || type === "text" ? [["text", "Ввести текст"]] : []),
        ]
      : []),
    ...options,
  ];
  if (!choices.some(([key]) => key === source))
    choices.unshift([source, "Выберите доступное значение…"]);
  return `<div class="b-operand">${field(label, select(`${key}_source`, source, choices))}${["number", "text"].includes(source) ? input(`${key}_literal`, operand?.value, { type: source === "number" ? "number" : "text", maxLength: source === "number" ? 12 : 2000, placeholder: source === "number" ? "Например, 100" : "Например, да", ariaLabel: label + ": значение" }) : ""}</div>`;
}

export function inspector(project, ui) {
  const original = locate(project, ui.selectedId)?.node;
  if (!original) return "";
  const node = ui.draft ?? original,
    c = node.config,
    meta = TYPES[node.type],
    analysis = analyse(project);
  const scope = analysis.scopes.get(node.id) ?? new Map();
  let fields = "";
  if (["input", "value", "calculate"].includes(node.type))
    fields += field(
      node.type === "input"
        ? "Что спросить у человека?"
        : "Как назовём результат?",
      input("name", c.name),
      "Это имя увидите в следующих блоках.",
    );
  switch (node.type) {
    case "input":
      fields += field(
        "Какой ответ нужен?",
        select("dataType", c.dataType, [
          ["number", "Число"],
          ["text", "Текст"],
          ["list", "Список чисел"],
        ]),
      );
      fields += field(
        "Пример ответа",
        input("example", c.example, {
          maxLength: 1000,
          placeholder:
            c.dataType === "list"
              ? "100 250 300"
              : c.dataType === "text"
                ? "Анна"
                : "1500",
        }),
        c.dataType === "list"
          ? "Целые числа через пробел, не больше 256."
          : c.dataType === "number"
            ? "Пока работаем с целыми числами."
            : "Одна строка текста.",
      );
      break;
    case "value":
      fields += operandField("Какое число запомнить?", "value", c.value, scope);
      break;
    case "calculate":
      fields += operandField("Первое число", "left", c.left, scope);
      fields += field(
        "Что сделать?",
        select("operator", c.operator, Object.entries(ARITHMETIC)),
      );
      fields += operandField("Второе число", "right", c.right, scope);
      break;
    case "change":
      fields += field(
        "Какое число изменить?",
        select("target", c.target, [
          ["", "Выберите число…"],
          ...[...scope.values()]
            .filter((item) => item.type === "number" && !item.readOnly)
            .map((item) => [item.id, item.name]),
        ]),
      );
      fields += field(
        "Что сделать?",
        select("operator", c.operator, Object.entries(ARITHMETIC)),
      );
      fields += operandField("На сколько / на что?", "value", c.value, scope);
      break;
    case "print":
      fields += field(
        "Напишите сообщение",
        `<textarea name="text" rows="3" maxlength="2000" placeholder="Например, Итого к оплате: ">${e(c.text)}</textarea>`,
      );
      fields += operandField(
        "Добавить к сообщению значение",
        "value",
        c.value,
        scope,
        { type: null, optional: true },
      );
      break;
    case "condition":
      fields += operandField("Что сравнить?", "left", c.left, scope, {
        type: null,
      });
      fields += field(
        "Условие",
        select("operator", c.operator, Object.entries(COMPARISONS)),
      );
      fields += operandField("С чем сравнить?", "right", c.right, scope, {
        type: null,
      });
      fields +=
        '<p class="b-field-explanation">Если условие верно, выполним путь <strong>«Да»</strong>. Иначе — <strong>«Нет»</strong>. Добавляйте шаги через плюс под нужной веткой.</p>';
      break;
    case "foreach":
      fields += operandField("Какой список перебрать?", "list", c.list, scope, {
        type: "list",
      });
      fields += field(
        "Как назвать одно число из списка?",
        input("itemName", c.itemName),
        "Это значение доступно только в шагах внутри повтора.",
      );
      break;
    case "repeat":
      fields += operandField("Сколько раз повторить?", "times", c.times, scope);
      fields += field(
        "Имя номера повтора",
        input("itemName", c.itemName),
        "Начинается с 1. Допустимо от 0 до 1000 повторений.",
      );
      break;
    case "note":
      fields += field(
        "Ваше пояснение",
        `<textarea name="text" rows="5" maxlength="2000">${e(c.text)}</textarea>`,
      );
      break;
    case "stop":
      fields +=
        '<p class="b-field-explanation">На этом пути программа закончится. Следующие шаги выполняться не будут.</p>';
      break;
  }
  const issues = analysis.issues.filter((issue) => issue.nodeId === node.id);
  return `<aside class="b-inspector" aria-label="Настройки блока"><div class="b-panel-head"><span class="b-step-label ${meta.color}">${icon(meta.icon, 17)}${meta.title}</span>${iconButton("close", "Закрыть настройки блока", "close-inspector")}</div><h2>Настроим этот шаг</h2><p class="b-panel-intro">Заполните поля — остальное соберём сами.</p><form id="block-form" data-node="${node.id}">${fields}${issues.length ? `<div class="b-form-hint">${e(issues[0].message)}</div>` : ""}<button type="submit" class="b-button primary b-full">${icon("check", 17)}Готово</button></form><div class="b-block-tools">${iconButton("up", "Переместить блок выше", "move-up", `data-id="${node.id}"`)}${iconButton("down", "Переместить блок ниже", "move-down", `data-id="${node.id}"`)}${iconButton("copy", "Создать копию блока", "duplicate", `data-id="${node.id}"`)}<span></span>${iconButton("trash", "Удалить блок", "delete", `data-id="${node.id}"`)}</div></aside>`;
}

export function readInspector(node, form) {
  const data = new FormData(form),
    c = { ...node.config };
  const operand = (key) => {
    const source = data.get(`${key}_source`);
    if (source === "none") return null;
    if (source?.startsWith("ref:")) return { kind: "ref", id: source.slice(4) };
    const raw = data.get(`${key}_literal`);
    return {
      kind: "literal",
      type: source === "text" ? "text" : "number",
      value:
        source === "text"
          ? String(raw ?? "")
          : String(raw ?? "").trim() === ""
            ? null
            : Number(raw),
    };
  };
  for (const name of [
    "name",
    "example",
    "dataType",
    "text",
    "itemName",
    "operator",
    "target",
  ])
    if (data.has(name)) c[name] = String(data.get(name));
  for (const name of ["left", "right", "value", "list", "times"])
    if (data.has(`${name}_source`)) c[name] = operand(name);
  return { ...node, config: c };
}

export function runPanel(project, ui) {
  const run = ui.run,
    analysis = analyse(project),
    inputs = project.steps.filter((node) => node.type === "input");
  return `<aside class="b-run-panel" aria-label="Запуск схемы"><div class="b-panel-head"><span class="b-step-label green">${icon("play", 16)}Проверка схемы</span>${iconButton("close", "Закрыть результат", "close-run")}</div><h2>Посмотрим, что получится</h2><p class="b-panel-intro">${inputs.length ? "Введите ответы, с которыми запустим программу." : "Вопросов нет — можно сразу запустить."}</p>${
    !analysis.valid
      ? `<div class="b-issues"><strong>Сначала настроим ${analysis.issues.length === 1 ? "один момент" : "несколько моментов"}</strong>${analysis.issues
          .slice(0, 8)
          .map(
            (issue) =>
              `<button type="button" data-action="fix" data-id="${issue.nodeId ?? ""}">${e(issue.message)}${icon("chevron", 14)}</button>`,
          )
          .join("")}</div>`
      : `<form id="run-form">${inputs.map((node) => field(node.config.name, `<input name="answer:${node.id}" value="${e(ui.answers[node.id] ?? node.config.example ?? "")}" ${node.config.dataType === "number" ? 'inputmode="numeric"' : ""} maxlength="4000" autocomplete="off" ${run.status === "running" ? "disabled" : ""}>`, node.config.dataType === "list" ? "Целые числа через пробел. Можно оставить список пустым." : node.config.dataType === "number" ? "Целое число, например 1500." : "")).join("")}<button type="submit" class="b-button primary b-full" ${run.status === "running" ? "disabled" : ""}>${run.status === "running" ? '<span class="b-spinner"></span>Выполняем…' : icon("play", 17) + "Получить результат"}</button></form>`
  }${run.status === "running" ? `<div class="b-running" role="status"><div class="b-running-dots"><i></i><i></i><i></i></div><strong>${e(run.stage || "Подготавливаем вашу программу")}</strong><p>Обычно это занимает несколько секунд.</p>${button("Отменить", "cancel-run", { className: "quiet" })}</div>` : ""}${
    run.status === "done"
      ? `<section class="b-result" aria-live="polite"><div class="b-result-heading">${icon("check", 17)}<strong>Вот что получилось</strong></div><pre>${e(run.stdout || "Программа завершилась без сообщений.")}</pre><div class="b-result-mode">${run.mode === "java" ? "Выполнено на Java" : "Предпросмотр в браузере · Java-сервер не подключён"}</div>${
          run.trace?.length
            ? `<details class="b-trace"><summary>Как получился ответ? ${icon("down", 14)}</summary><p>Пошаговое объяснение визуальной модели.</p><ol>${run.trace
                .slice(0, 100)
                .map(
                  (step, index) =>
                    `<li><button type="button" data-action="trace" data-index="${index}" class="${ui.tracedNode === step.nodeId ? "active" : ""}"><span>${index + 1}</span>${e(step.message)}</button></li>`,
                )
                .join(
                  "",
                )}</ol>${run.truncatedTrace || run.trace.length > 100 ? "<small>Показаны первые шаги объяснения.</small>" : ""}</details>`
            : ""
        }</section>`
      : ""
  }${run.status === "failed" ? `<div class="b-run-error" role="alert"><strong>Пока не получилось</strong><p>${e(run.error)}</p>${run.nodeId ? button("Открыть нужный блок", "fix", { className: "quiet", attributes: `data-id="${run.nodeId}"` }) : ""}${run.details ? `<details><summary>Технические подробности</summary><pre>${e(run.details)}</pre></details>` : ""}</div>` : ""}</aside>`;
}

export function modalContent(project, ui) {
  if (ui.modal === "templates")
    return `<dialog id="builder-modal" class="b-modal b-templates-modal"><div class="b-modal-header"><div><span class="b-overline">Начните с понятной задачи</span><h2>Не нужно начинать с пустого листа.</h2><p>Выберите пример и поменяйте его под себя.</p></div>${iconButton("close", "Закрыть примеры", "close-modal")}</div><div class="b-template-grid">${TEMPLATES.map((template) => `<button type="button" class="b-template-card ${template.color}" data-action="template" data-template="${template.id}"><span class="b-template-icon">${icon(template.icon, 25)}</span><small>${template.badge} · ${template.duration}</small><strong>${e(template.title)}</strong><p>${e(template.subtitle)}</p><span class="b-template-link">Открыть пример ${icon("chevron", 15)}</span></button>`).join("")}<button type="button" class="b-template-card blank" data-action="blank"><span class="b-template-icon">${icon("plus", 25)}</span><small>Ваша идея</small><strong>Чистый лист</strong><p>Соберите свою программу из блоков.</p><span class="b-template-link">Создать схему ${icon("chevron", 15)}</span></button></div><p class="b-modal-foot">Текущую схему можно вернуть кнопкой «Отменить».</p></dialog>`;
  if (ui.modal === "picker")
    return `<dialog id="builder-modal" class="b-modal b-picker-modal"><div class="b-modal-header"><div><h2>Какой шаг добавить?</h2><p>Добавим его в выбранное место схемы.</p></div>${iconButton("close", "Закрыть выбор блока", "close-modal")}</div>${library({ compact: true })}</dialog>`;
  if (ui.modal === "code")
    return `<dialog id="builder-modal" class="b-modal b-code-modal"><div class="b-modal-header"><div><span class="b-overline">Создано из вашей схемы</span><h2>Обычная Java. Можно забрать с собой.</h2><p>Код обновляется автоматически, когда вы меняете блоки.</p></div>${iconButton("close", "Закрыть Java", "close-modal")}</div><pre class="b-generated-code"><code>${e(ui.generatedSource)}</code></pre><div class="b-modal-actions">${button("Скачать Main.java", "download-java", { iconName: "download" })}${button("Скачать проект целиком", "export", { iconName: "download", className: "primary" })}</div></dialog>`;
  if (ui.modal === "help")
    return `<dialog id="builder-modal" class="b-modal b-help-modal"><div class="b-modal-header"><div><span class="b-overline">Всё начинается с трёх шагов</span><h2>Думайте о задаче, а не о синтаксисе.</h2></div>${iconButton("close", "Закрыть помощь", "close-modal")}</div><div class="b-help-steps"><div><span>1</span><section><h3>Добавьте блоки</h3><p>Нажмите на действие слева. Или нажмите плюс в нужном месте схемы.</p></section></div><div><span>2</span><section><h3>Настройте обычными словами</h3><p>Нажмите на блок, заполните поля и нажмите «Готово». Программа идёт сверху вниз.</p></section></div><div><span>3</span><section><h3>Попробуйте на своих данных</h3><p>Нажмите «Запустить», введите ответы и посмотрите результат.</p></section></div></div><div class="b-help-note">Условия выбирают путь «Да» или «Нет». Повторы выполняют шаги внутри. Изменения сохраняются в этом браузере. Скачайте проект, чтобы передать его другому человеку.</div><div class="b-modal-actions">${button("Попробовать пример", "examples", { className: "primary", iconName: "sparkle" })}</div></dialog>`;
  return "";
}

export function renderApp(project, ui, store) {
  const analysis = analyse(project),
    isPanel = Boolean(ui.selectedId || ui.runOpen);
  return `<header class="b-header"><a class="b-brand" href="./" aria-label="Blueprints — конструктор программ"><span>${icon("logo", 25)}</span><strong>blueprints<small>Программы из блоков</small></strong></a><nav aria-label="Разделы конструктора"><span class="b-nav-current">Конструктор</span><button type="button" data-action="examples">Готовые примеры</button></nav><div class="b-header-actions">${iconButton("help", "Как пользоваться конструктором", "help")}${button("Сохранить проект", "export", { iconName: "download", className: "secondary" })}</div></header><main class="b-workspace"><aside class="b-library" aria-label="Блоки программы"><div class="b-library-heading"><span class="b-overline">Ваша программа</span><h1>Соберите схему.</h1><p>Выберите действие.<br>Добавим его в вашу схему.</p></div>${library()}<button type="button" class="b-example-nudge" data-action="examples">${icon("sparkle", 20)}<span><strong>Нужна отправная точка?</strong><small>Возьмите готовый пример</small></span>${icon("chevron", 15)}</button><div class="b-library-bottom"><button type="button" data-action="import">${icon("upload", 15)}Открыть свою схему</button><a href="expert.html">${icon("code", 15)}Расширенная Studio ${icon("chevron", 12)}</a></div></aside><section class="b-board ${isPanel ? "with-panel" : ""}" aria-label="Визуальная схема"><div class="b-board-toolbar"><div class="b-project-meta"><input id="project-title" aria-label="Название программы" maxlength="80" value="${e(project.title)}"><span class="b-save-status" id="save-status">${icon("check", 12)}${e(ui.saveStatus || "Сохранено на этом компьютере")}</span></div><div class="b-board-actions">${iconButton("undo", "Отменить последнее изменение", "undo", store.undoStack.length ? "" : "disabled")}${iconButton("redo", "Повторить изменение", "redo", store.redoStack.length ? "" : "disabled")}<span class="b-toolbar-divider"></span>${button("Запустить", "open-run", { iconName: "play", className: "primary" })}</div></div><div class="b-canvas" id="blueprint-canvas"><div class="b-canvas-caption"><span>Моя схема</span><span>Шаги выполняются сверху вниз ${icon("down", 12)}</span></div><div class="b-flow"><div class="b-terminal start"><span></span>Начало</div>${nodes(project.steps, project, ui)}<div class="b-terminal finish">${icon("check", 13)}Готово</div></div>${project.steps.length && !ui.dismissedTip ? `<div class="b-canvas-tip">${icon("help", 16)}<span>Нажмите на блок, чтобы настроить его. Плюс добавляет новый шаг.</span><button type="button" data-action="dismiss-tip" aria-label="Скрыть подсказку">${icon("close", 14)}</button></div>` : ""}</div><footer class="b-board-footer"><span>${analysis.count} ${analysis.count === 1 ? "блок" : analysis.count < 5 ? "блока" : "блоков"}<span class="b-footer-dot">·</span>${analysis.valid ? "Можно запускать" : "Есть незаполненные настройки"}</span><button type="button" data-action="show-code">${icon("code", 14)}Посмотреть Java</button></footer></section>${ui.selectedId ? inspector(project, ui) : ui.runOpen ? runPanel(project, ui) : ""}</main><input type="file" id="blueprint-file" accept=".json" hidden><div id="builder-toast" class="b-toast" role="status" aria-live="polite"></div>${modalContent(project, ui)}`;
}
