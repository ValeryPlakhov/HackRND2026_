import { escapeHtml as e } from "../lib/core.mjs";
import { icon } from "../lib/icons.mjs";
import {
  button,
  badge,
  iconButton,
  statusPill,
  emptyState,
} from "../components/primitives.mjs";
import { graphShell } from "../components/graph.mjs";
import { sourceEditor } from "../components/editor.mjs";

export function renderCanvas(workspace, runtime) {
  const state = workspace.state;
  const method = workspace.method;
  const model = workspace.model;
  if (!method)
    return emptyState(
      "nodes",
      "Выберите Java-метод",
      "Загрузите исходник или откройте демонстрационный проект.",
      button("Импорт Java", "import", { icon: "upload", variant: "primary" }),
    );
  return `<div class="canvas-view"><div class="canvas-heading"><div class="canvas-heading-left"><div class="eyebrow">CODE INTELLIGENCE / VISUAL WORKSPACE</div><h1>Понять логику. Увидеть связи.</h1></div><div class="canvas-heading-actions">${statusPill(workspace.gate, state.report?.recorded)}${iconButton("undo", "undo", "Отменить изменение")}${iconButton("redo", "redo", "Повторить изменение")}${iconButton("focus", "toggle-focus", "Режим фокуса")}${iconButton("settings", "toggle-inspector", "Показать инспектор")}</div></div><div class="canvas-toolbar"><div class="canvas-method-selector">${icon("method", "", 16)}<select id="canvas-method" aria-label="Выбор метода">${model.methods.map((item) => `<option value="${e(item.id)}" ${item.id === method.id ? "selected" : ""}>${e(item.name)}()</option>`).join("")}</select></div><div class="canvas-stats">${badge(state.detail?.complexity?.time ?? method.metrics.complexity, "accent")}${badge(`${method.graph.nodes.length} nodes`, "neutral")}</div><label class="search-field">${icon("search", "", 13)}<input id="graph-search" type="search" placeholder="Найти узел…" aria-label="Поиск узлов графа"></label>${button("Выделить", "extract", { icon: "split", variant: "ghost", className: "small", disabled: !runtime.online || !method.static, title: "Перенести независимый static-метод в отдельный файл" })}</div><div id="canvas-graph-slot" class="canvas-graph-slot">${graphShell({ title: `${method.name}()` })}</div><div id="canvas-resize" class="canvas-resize-handle" role="separator" aria-label="Изменить высоту редактора" aria-orientation="horizontal"></div><div class="canvas-code-slot">${sourceEditor(workspace.source, { fileName: state.activeFile, readonly: !runtime.online, diagnostics: model.diagnostics })}</div></div>`;
}
