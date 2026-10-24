import { escapeHtml as e } from "../lib/core.mjs";
import { icon } from "../lib/icons.mjs";
import { highlight } from "../lib/lexer.mjs";
import { projectDiff } from "../lib/diff.mjs";
import {
  button,
  badge,
  sectionHeading,
  emptyState,
  notice,
  selectableTabs,
  hashLabel,
} from "../components/primitives.mjs";
import { diffViewer } from "../components/editor.mjs";

export function renderChanges(workspace, runtime, ui) {
  const plans = workspace.state.plans?.plans ?? [];
  const changes = projectDiff(workspace.state.baseline, workspace.state.files);
  const active = ui.changesTab ?? "plans";
  const tabs = selectableTabs(
    [
      {
        id: "plans",
        label: "Предложения",
        icon: "sparkle",
        count: plans.length,
      },
      {
        id: "diff",
        label: "Изменения к эталону",
        icon: "diff",
        count: changes.length,
      },
    ],
    active,
    "changes-tab",
  );
  return (
    sectionHeading(
      "REFACTOR WITH EVIDENCE",
      "Изменение с обоснованием.",
      "Каждое предложение привязано к версии исходника. Просмотрите патч и подтвердите результат на тестах.",
      button("Обновить предложения", "load-plans", {
        icon: "sparkle",
        variant: "secondary",
      }),
    ) +
    tabs +
    '<div style="height:19px"></div>' +
    (active === "diff"
      ? renderDiff(changes, workspace)
      : renderPlans(plans, workspace, runtime, ui))
  );
}

function renderPlans(plans, workspace, runtime, ui) {
  if (!plans.length)
    return emptyState(
      "sparkle",
      "Для текущего файла нет применимых правил",
      "Оптимизатор предлагает только распознанные преобразования. Выберите другой файл или проверьте диагностику.",
      button("На визуальную модель", "navigate", {
        icon: "nodes",
        data: { view: "canvas" },
      }),
    );
  return (
    plans
      .map((plan) => {
        const expanded = ui.expandedPlans?.has(plan.id);
        return `<article class="plan-card ${expanded ? "selected" : ""}"><div class="plan-card-header"><span class="plan-card-marker">${icon("sparkle", "", 16)}</span><div class="plan-card-copy"><h3>${e(plan.title)}</h3><p>${e(plan.description)}</p><div class="plan-meta">${badge(plan.rule, "accent")}${badge(`L${plan.line}`, "neutral")}${plan.timeBefore !== "unchanged" ? `${badge(plan.timeBefore, "warning")}${icon("arrow", "", 13)}${badge(plan.timeAfter, "lime")}` : badge("Структурное упрощение", "neutral")}</div></div></div>${expanded ? `<div class="plan-preview-grid"><pre class="plan-code"><span class="plan-code-label">BEFORE</span>${highlight(plan.before)}</pre><pre class="plan-code"><span class="plan-code-label">AFTER</span>${highlight(plan.after)}</pre></div><div class="plan-card-details"><strong class="text-purple">Почему применимо</strong><br>${e(plan.rationale)}<br><span class="muted">Память после преобразования: ${e(plan.memoryAfter)}. После применения quality gate сбрасывается.</span></div>` : ""}<div class="plan-card-footer"><div>${button(expanded ? "Скрыть патч" : "Просмотреть патч", "toggle-plan", { icon: "diff", variant: "ghost", className: "small", data: { id: plan.id } })}</div>${button(runtime.online ? "Применить и проверить" : "Показать сохранённый патч", "apply-plan", { icon: "arrow", variant: "primary", className: "small", data: { id: plan.id } })}</div></article>`;
      })
      .join("") + hashLabel(workspace.state.plans.sourceHash, "SOURCE HASH")
  );
}

function renderDiff(changes, workspace) {
  if (!changes.length)
    return emptyState(
      "diff",
      "Исходники совпадают с эталоном",
      "Примените предложение или отредактируйте код, чтобы увидеть review diff.",
    );
  const total = changes.reduce(
    (result, file) => ({
      additions: result.additions + file.additions,
      deletions: result.deletions + file.deletions,
    }),
    { additions: 0, deletions: 0 },
  );
  return `<div class="test-input-toolbar"><span class="muted text-small">${changes.length} файлов · <span class="text-green">+${total.additions}</span> <span class="text-red">−${total.deletions}</span></span><div>${button("Сохранить patch", "export-patch", { icon: "download", className: "small" })}${button("Проверить", "run-compare", { icon: "play", variant: "primary", className: "small" })}</div></div>${workspace.state.report ? "" : notice("Текущие изменения ещё не подтверждены quality gate.", "warning", "shield")}<div style="height:15px"></div>${changes.map((file) => `<section class="file-diff"><header class="file-diff-header"><span>${icon("file", "", 13)}${e(file.name)}${badge(file.status, file.status === "added" ? "success" : "neutral")}</span><span class="file-diff-counts"><span class="text-green">+${file.additions}</span><span class="text-red">−${file.deletions}</span></span></header>${diffViewer(file.operations)}</section>`).join("")}`;
}
