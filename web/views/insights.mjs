import { escapeHtml as e } from "../lib/core.mjs";
import { icon } from "../lib/icons.mjs";
import {
  severityCounts,
  distribution,
  histogramChart,
  donutChart,
} from "../lib/metrics.mjs";
import { searchItems } from "../lib/search.mjs";
import {
  sectionHeading,
  panel,
  button,
  badge,
  notice,
  searchField,
  severityIcon,
} from "../components/primitives.mjs";

export function renderInsights(workspace, runtime, ui) {
  const project = workspace.state.project;
  if (!project) return '<div class="empty-state">Ожидаем анализ проекта…</div>';
  const methods = project.methods;
  const counts = severityCounts(project.findings);
  const findings = searchItems(project.findings, ui.findingQuery ?? "", 100);
  const severityChart = donutChart(
    [
      { label: "Errors", value: counts.error, color: "#f08d99" },
      { label: "Warnings", value: counts.warning, color: "#e0bd81" },
      { label: "Info", value: counts.info, color: "#82c9e5" },
    ],
    { label: "FINDINGS" },
  );
  const hotspots = project.hotspots
    .map(
      (method, index) =>
        `<tr><td class="muted mono">${String(index + 1).padStart(2, "0")}</td><td><button class="table-action" data-action="open-method" data-file="${e(method.fileName)}" data-method="${e(method.methodId)}">${e(method.name)}()<small>${e(method.fileName)}:${method.line}</small></button></td><td class="mono">${method.lines}</td><td class="mono">${method.cyclomatic}</td><td class="mono">${method.cognitive}</td><td><span class="risk-bar"><i style="width:${Math.min(70, method.risk)}px"></i>${method.risk}</span></td></tr>`,
    )
    .join("");
  return (
    sectionHeading(
      "MEASURE WHAT DESERVES ATTENTION",
      "Обзор качества без чёрного ящика.",
      "Диагностика с координатами, объяснимые метрики и приоритеты для ревью.",
      button("Экспорт SARIF", "export-sarif", { icon: "download" }),
    ) +
    `<div class="insights-grid">${panel("Диагностика по уровню", `<div class="quality-ring-row">${severityChart}<ul><li><b class="text-red">${counts.error}</b>Errors</li><li><b class="text-amber">${counts.warning}</b>Warnings</li><li><b class="text-purple">${counts.info}</b>Recommendations</li></ul></div>`, { icon: "target" })}${panel("Цикломатическая сложность", histogramChart(distribution(methods.map((method) => method.cyclomatic))), { icon: "chart", eyebrow: "METHOD DISTRIBUTION" })}</div>` +
    panel(
      "Приоритет ревью",
      `<div class="data-table-wrap"><table class="data-table"><thead><tr><th>#</th><th>Метод</th><th>Lines</th><th>CC</th><th>Cognitive</th><th>Review score</th></tr></thead><tbody>${hotspots}</tbody></table></div>`,
      {
        icon: "target",
        className: "no-padding",
        actions: badge("HEURISTIC", "warning"),
      },
    ) +
    `<div style="margin:16px 0 25px">${notice("Review score = 2×CC + 1.5×cognitive + 0.15×lines. Это порядок ревью, не вероятность ошибки. Cognitive score реализован как структурная оценка, а не сертифицированная метрика Sonar.", "info", "info")}</div>` +
    `<div class="test-input-toolbar"><div class="section-label" style="margin:0">PROJECT FINDINGS<span style="margin-left:12px">${findings.length} / ${project.findings.length}</span></div><div style="width:220px">${searchField("finding-query", "Поиск · severity:warning", ui.findingQuery ?? "")}</div></div>` +
    findings
      .map(
        (finding) =>
          `<article class="finding-card"><div class="finding-card-top">${severityIcon(finding.severity)}<span>${e(finding.category ?? "code-analysis")}</span>${badge(finding.confidence ?? "heuristic", "neutral")}<code>${e(finding.rule)}</code></div><h3>${e(finding.title)}</h3><p>${e(finding.detail)}</p><button class="finding-location" data-action="open-finding" data-index="${project.findings.indexOf(finding)}">${icon("file", "", 11)}${e(finding.fileName)}:${finding.line}${icon("arrow", "", 10)}</button></article>`,
      )
      .join("")
  );
}
