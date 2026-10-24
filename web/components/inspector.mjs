import { escapeHtml as e } from "../lib/core.mjs";
import { icon, nodeIcon } from "../lib/icons.mjs";
import { severityCounts } from "../lib/metrics.mjs";
import {
  button,
  badge,
  selectableTabs,
  severityIcon,
  keyValueRows,
  notice,
  hashLabel,
} from "./primitives.mjs";

export function renderInspector(workspace, runtime) {
  const state = workspace.state;
  const selected = workspace.method?.graph.nodes.find(
    (node) => node.id === state.selectedNode,
  );
  const findings = (state.project?.findings ?? []).filter(
    (finding) =>
      finding.fileName === state.activeFile &&
      (!finding.methodId || finding.methodId === workspace.method?.id),
  );
  const counts = severityCounts(findings);
  const tabs = selectableTabs(
    [
      { id: "diagnostics", label: "Проблемы", count: findings.length },
      { id: "complexity", label: "Сложность" },
      { id: "flow", label: "Данные" },
    ],
    state.inspector,
    "inspector-tab",
  );
  const content =
    state.inspector === "flow"
      ? dataFlow(state.detail)
      : state.inspector === "complexity"
        ? complexity(state.detail, workspace.method)
        : diagnostics(findings, state.project, state.plans);
  const job = state.jobs.find((item) =>
    ["queued", "running"].includes(item.state),
  );
  return `<div class="inspector-title"><span>Инспектор</span><div>${badge(`${counts.error + counts.warning} ATTENTION`, counts.error ? "danger" : counts.warning ? "warning" : "neutral")}<button class="icon-button" data-action="toggle-inspector" aria-label="Скрыть инспектор">${icon("split", "", 14)}</button></div></div>${tabs}${selected ? selection(selected, runtime) : ""}${job ? jobCard(job) : ""}<div class="inspector-section">${content}</div><div class="inspector-section">${notice(runtime.online ? "Все преобразования создают кандидата. Совпадение поведения подтверждается на выбранных входах." : "Сохранённый AST и результаты. Для живых запусков откройте локальную версию.", runtime.online ? "info" : "warning", runtime.online ? "shield" : "eye")}</div>${state.detail?.sourceHash ? `<div style="margin-top:17px">${hashLabel(state.detail.sourceHash)}</div>` : ""}`;
}

function selection(node, runtime) {
  const editable = runtime.online && node.editStart >= 0;
  const deletable =
    editable &&
    ["operation", "variable", "return", "throw"].includes(node.kind);
  const insertable =
    editable &&
    ["operation", "return", "throw", "break", "continue"].includes(node.kind);
  return `<div class="inspector-section"><div class="inspector-section-title">ВЫБРАННЫЙ УЗЕЛ<span>L${node.line}</span></div><div class="node-selection-card"><h3>${icon(nodeIcon(node.kind), "", 13)}${e(node.kind.toUpperCase())}</h3><pre>${e(node.editCode || node.code || node.label)}</pre>${button("Редактировать фрагмент", "edit-node", { icon: "code", variant: "accent", className: "small", disabled: !editable })}<div class="node-secondary-actions">${button("До", "insert-before", { icon: "plus", className: "small", disabled: !insertable })}${button("После", "insert-after", { icon: "plus", className: "small", disabled: !insertable })}${button("Удалить", "delete-node", { icon: "trash", className: "small", variant: "ghost", disabled: !deletable })}</div></div></div>`;
}

function diagnostics(findings, project, planData) {
  const selectedPlans = planData?.plans ?? [];
  const histogram = selectedPlans.find(
    (plan) => plan.rule === "histogram-pairs",
  );
  const cards = findings
    .slice(0, 7)
    .map((finding) => {
      const index = project.findings.indexOf(finding);
      return `<article class="finding-card"><div class="finding-card-top">${severityIcon(finding.severity)}<span>${finding.severity === "error" ? "Error" : finding.severity === "warning" ? "Warning" : "Recommendation"}</span><code>${e(finding.rule)}</code></div><h3>${e(finding.title)}</h3><p>${e(finding.detail)}</p><button class="finding-location" data-action="open-finding" data-index="${index}">${e(finding.fileName)}:${finding.line}${icon("arrow", "", 10)}</button>${finding.canOptimize ? button("Просмотреть улучшение", "navigate", { icon: "sparkle", variant: "accent", className: "small", data: { view: "changes" } }) : ""}</article>`;
    })
    .join("");
  return `<div class="inspector-section-title">ДИАГНОСТИКА<span>${findings.length}</span></div>${cards || `<div class="finding-card"><div class="finding-card-top">${icon("check", "text-green", 14)}Сработавших правил нет</div><p>Это не означает отсутствие дефектов. Проверьте сборку и поведение.</p></div>`}${findings.length > 7 ? button("Все проблемы проекта", "navigate", { icon: "arrow", variant: "ghost", className: "small", data: { view: "insights" } }) : ""}${histogram ? `<div class="potential-card"><div class="eyebrow">ОЖИДАЕМОЕ УЛУЧШЕНИЕ</div><div class="potential-comparison"><strong>O(n²)</strong>${icon("arrow", "", 17)}<strong>O(n)</strong></div><p>Индекс частот. Среднее время линейное, память O(k). Применимость проверена AST-шаблоном.</p></div>` : ""}`;
}

function complexity(detail, method) {
  if (!detail)
    return '<div class="muted text-small">Загружаем подробный анализ метода…</div>';
  const metrics = detail.complexity;
  return `<div class="inspector-section-title">СТРУКТУРНАЯ ОЦЕНКА${badge("HEURISTIC", "warning")}</div><div class="potential-card"><div class="eyebrow">TIME COMPLEXITY</div><div style="font:31px var(--mono);color:var(--lime);margin:15px 0">${e(metrics.time)}</div><p>Оценка тела метода с явно указанными допущениями.</p></div><div style="margin-top:13px">${keyValueRows(
    [
      ["Cyclomatic", metrics.cyclomatic],
      ["Cognitive estimate", metrics.cognitive],
      ["Maximum nesting", metrics.maximumNesting],
      ["Graph nodes", method?.graph.nodes.length ?? 0],
    ],
  )}</div><div class="inspector-section-title" style="margin-top:24px">ОТКУДА ВЗЯЛАСЬ ОЦЕНКА</div>${metrics.reasoning.map((reason) => `<div class="reasoning-item"><strong>${e(reason.cost)} <span class="muted">· L${reason.line}</span></strong><p>${e(reason.reason)}</p></div>`).join("") || '<p class="muted text-tiny">Явных циклов не найдено. Стоимость вызовов отдельно не доказана.</p>'}<div class="inspector-section-title" style="margin-top:22px">ДОПУЩЕНИЯ</div>${metrics.assumptions.map((assumption) => `<p class="muted text-tiny">${e(assumption)}</p>`).join("")}`;
}

function dataFlow(detail) {
  if (!detail)
    return '<div class="muted text-small">Загружаем определения и использования…</div>';
  const flow = detail.dataFlow;
  const variables = flow.variables;
  return `<div class="inspector-section-title">ПЕРЕМЕННЫЕ<span>${variables.length}</span></div><p class="muted text-tiny">Выберите переменную для подсветки соответствующих строк на графе.</p>${variables.map((variable) => `<button class="variable-row" data-action="slice-variable" data-name="${e(variable.name)}"><span><code>${e(variable.name)}</code><small>${e(variable.type)} · ${e(variable.role)}${variable.unused ? " · no reads" : ""}</small></span><span>R ${variable.readCount}<br>W ${variable.writeCount}</span></button>`).join("")}${button("Сбросить подсветку", "clear-slice", { icon: "close", variant: "ghost", className: "small" })}<div class="inspector-section-title" style="margin-top:25px">DEF-USE СВЯЗИ<span>${flow.edges.length}</span></div>${flow.edges
    .slice(0, 14)
    .map(
      (edge) =>
        `<div class="key-value-list"><div><dt class="mono">${e(edge.name)}</dt><dd>L${edge.fromLine} → L${edge.toLine}</dd></div></div>`,
    )
    .join(
      "",
    )}<p class="muted text-tiny" style="margin-top:20px">${e(flow.note)}</p>`;
}

export function jobCard(job) {
  const fraction = job.total
    ? Math.max(5, Math.round((job.completed / job.total) * 100))
    : 0;
  return `<div class="job-card"><div class="job-card-title"><span class="spinner"></span>${e(job.kind.toUpperCase())}<button class="icon-button" style="margin-left:auto;width:22px;height:22px" data-action="cancel-job" data-id="${e(job.id)}" aria-label="Отменить задание">${icon("close", "", 13)}</button></div><p>${e(job.stage)}</p><div class="job-progress ${fraction === 0 ? "indeterminate" : ""}"><span style="${fraction ? `width:${fraction}%` : ""}"></span></div></div>`;
}
