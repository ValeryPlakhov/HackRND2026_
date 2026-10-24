import { escapeHtml as e, formatInteger } from "../lib/core.mjs";
import { icon } from "../lib/icons.mjs";
import {
  badge,
  button,
  iconButton,
  searchField,
  statusPill,
} from "./primitives.mjs";

export const NAVIGATION = [
  { id: "overview", label: "Обзор проекта", icon: "grid", short: "Обзор" },
  { id: "canvas", label: "Визуальная модель", icon: "nodes", short: "Холст" },
  {
    id: "changes",
    label: "Рефакторинг и diff",
    icon: "diff",
    short: "Изменения",
  },
  { id: "tests", label: "Test Lab", icon: "flask", short: "Тесты" },
  {
    id: "architecture",
    label: "Архитектура проекта",
    icon: "layers",
    short: "Архитектура",
  },
  {
    id: "insights",
    label: "Метрики и диагностика",
    icon: "chart",
    short: "Метрики",
  },
  {
    id: "history",
    label: "История и снимки",
    icon: "history",
    short: "История",
  },
  {
    id: "presentation",
    label: "Режим защиты",
    icon: "presentation",
    short: "Защита",
  },
];

export function navigation(state) {
  return `<a class="rail-brand" href="./" aria-label="Blueprints Studio">${icon("logo", "", 25)}</a><nav class="rail-navigation">${NAVIGATION.map((item) => `<button class="rail-button ${state.view === item.id ? "active" : ""}" data-action="navigate" data-view="${item.id}" aria-label="${item.label}" aria-current="${state.view === item.id ? "page" : "false"}">${icon(item.icon, "", 20)}</button>`).join("")}</nav><div class="rail-bottom"><div class="rail-divider"></div><button class="rail-button" data-action="toggle-project" aria-label="Файлы проекта">${icon("folder", "", 19)}</button><button class="rail-button" data-action="toggle-theme" aria-label="Сменить тему">${icon(state.theme === "dark" ? "sun" : "moon", "", 18)}</button><button class="rail-button" data-action="help" aria-label="Клавиши и помощь">${icon("help", "", 19)}</button><div class="rail-avatar" title="Локальная рабочая среда">BP</div></div>`;
}

export function header(workspace, runtime) {
  const activeJob = workspace.state.jobs.find((job) =>
    ["queued", "running"].includes(job.state),
  );
  return `<div class="header-wordmark">blueprints<span>studio / 2.0</span></div><div class="header-breadcrumb">${icon("folder", "", 13)}<span>/</span><strong>${e(workspace.state.name)}</strong>${badge("JAVA 21", "neutral")}</div><button class="header-search" data-action="command-palette" aria-label="Открыть поиск команд">${icon("search", "", 14)}<span>Найти что угодно…</span><kbd>⌘ K</kbd></button><div class="header-actions">${button("Импорт", "import", { icon: "upload", variant: "ghost", className: "header-import", title: "Загрузить Java-файлы" })}${button("Экспорт", "export", { icon: "download", variant: "ghost", className: "header-export" })}<span class="header-separator"></span>${button(runtime.online ? (activeJob ? "Выполняется…" : "Проверить") : "Запись прогона", "run-compare", { icon: activeJob ? "clock" : "play", variant: "primary", disabled: Boolean(activeJob), title: runtime.online ? "Запустить обе версии на выбранных входах" : "Показать сохранённый реальный прогон встроенного примера" })}</div>`;
}

export function projectPanel(workspace, runtime, ui) {
  const state = workspace.state;
  const stats = state.project?.stats;
  const methods = (workspace.model?.methods ?? []).filter((method) =>
    `${method.owner}.${method.name}`
      .toLowerCase()
      .includes((ui.methodQuery ?? "").toLowerCase()),
  );
  const changed = new Set(workspace.changedFiles);
  return `<div class="workspace-tile"><div class="workspace-tile-eyebrow">ENGINEERING WORKSPACE</div><div class="workspace-tile-name">${icon("git", "", 15)}<span>${e(state.name)}</span></div><div class="workspace-tile-meta"><span>${formatInteger(stats?.lines ?? 0)} lines · ${Object.keys(state.files).length} files</span>${badge(runtime.online ? "LIVE" : "PREVIEW", runtime.online ? "lime" : "warning")}</div></div><div class="section-label">EXPLORER<span>${Object.keys(state.files).length.toString().padStart(2, "0")}</span></div><div class="file-list">${Object.keys(
    state.files,
  )
    .map(
      (name) =>
        `<button class="file-row ${state.activeFile === name ? "active" : ""}" data-action="select-file" data-file="${e(name)}"><span class="java-mark">J</span><span class="file-name">${e(name)}</span>${changed.has(name) ? '<span class="dirty-indicator" title="Изменён относительно эталона"></span>' : ""}</button>`,
    )
    .join(
      "",
    )}</div><div class="section-label">METHODS<span>${workspace.model?.methods?.length ?? 0}</span></div>${searchField("method-filter", "Поиск методов", ui.methodQuery ?? "")}<div class="method-list">${methods.map((method) => `<button class="method-row ${workspace.method?.id === method.id ? "active" : ""}" data-action="select-method" data-method="${e(method.id)}" title="${e(method.signature)}">${icon("method", "", 15)}<span class="method-name">${e(method.name === "<init>" ? method.owner.split(".").at(-1) : method.name)}<small>${e(method.metrics.complexity)} · ${e(method.owner)}</small></span><span class="method-line">L${method.line}</span></button>`).join("") || '<p class="muted text-tiny" style="padding:9px">Совпадений нет</p>'}</div><div class="project-bottom"><div class="section-label" style="margin:0 2px 9px">CASE STUDIES</div><div class="sample-picker"><select id="sample-picker" aria-label="Демонстрационный проект">${Object.entries(
    runtime.demo?.samples ?? {},
  )
    .map(
      ([id, sample]) =>
        `<option value="${e(id)}" ${runtime.sampleId === id ? "selected" : ""}>${e(sample.title)}</option>`,
    )
    .join(
      "",
    )}</select>${iconButton("arrow", "load-sample", "Открыть пример")}</div><div class="project-help"><span>${icon(runtime.online ? "lock" : "eye", "", 12)} ${runtime.online ? "Локальная JVM" : "Обзор без JVM"}</span><a href="guide.html" target="_blank" rel="noopener">Документация ↗</a></div></div>`;
}

export function statusBar(workspace, runtime, ui) {
  const job = workspace.state.jobs.find((item) =>
    ["queued", "running"].includes(item.state),
  );
  return `<div class="status-group"><span><i class="status-light ${runtime.online ? "" : "warning"}"></i>${runtime.online ? `JDK ${e(runtime.environment?.java ?? "21")} / ${e(runtime.environment?.runner ?? "local")}` : "RECORDED DEMO / NO JVM"}</span><span id="analysis-status">${job ? e(job.stage) : ui.analyzing ? "Анализ проекта…" : `${workspace.state.project?.analysisMs ?? "—"} ms analysis`}</span></div><div class="status-group"><span>${workspace.state.savedAt ? "Сохранено локально" : "Workspace ready"}</span><span>UTF-8 · AST spans · Java 21</span></div>`;
}
