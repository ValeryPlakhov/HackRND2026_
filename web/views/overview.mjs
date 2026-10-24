import { escapeHtml as e, formatInteger } from "../lib/core.mjs";
import { icon } from "../lib/icons.mjs";
import { severityCounts } from "../lib/metrics.mjs";
import {
  badge,
  button,
  metricCard,
  panel,
  statusPill,
  notice,
} from "../components/primitives.mjs";

export function renderOverview(workspace, runtime) {
  const state = workspace.state;
  const project = state.project;
  const stats = project?.stats ?? {};
  const severities = severityCounts(project?.findings ?? []);
  const plans = state.plans?.plans ?? [];
  const pipeline = [
    [
      "Исходник разобран",
      `${stats.files ?? 0} файлов · ${stats.methods ?? 0} методов · настоящий AST javac`,
      Boolean(project),
    ],
    [
      "Изменение подготовлено",
      workspace.changedFiles.length
        ? `${workspace.changedFiles.length} файлов отличаются от эталона`
        : `${plans.length} предложений доступно для текущего файла`,
      workspace.changedFiles.length > 0,
    ],
    [
      "Поведение проверено",
      state.report
        ? `${state.report.tests.filter((test) => test.passed).length}/${state.report.tests.length} входов · stdout + stderr + exitCode`
        : "Запустите обе версии на одинаковых тестовых входах",
      Boolean(state.report?.passed),
    ],
  ];
  const features = [
    [
      "sparkle",
      "Патч с обоснованием",
      "Просмотрите diff, допущения и ожидаемую сложность до применения.",
      "changes",
    ],
    [
      "beaker",
      "Mutation testing",
      "Узнайте, какие изменения программы не замечает ваш набор тестов.",
      "tests",
    ],
    [
      "target",
      "Минимальный контрпример",
      "Сократите вход, на котором поведение изменилось, и найдите причину.",
      "tests",
    ],
    [
      "chart",
      "Замер внутри JVM",
      "Разогрев и медиана времени метода без учёта старта процесса.",
      "tests",
    ],
    [
      "layers",
      "Архитектура из кода",
      "Вызовы, циклические зависимости и кандидаты на выделение модулей.",
      "architecture",
    ],
    [
      "shield",
      "Evidence bundle",
      "Исходники, эталон, входы, хеши и отчёт в воспроизводимом ZIP.",
      "export",
    ],
  ];
  const hotspots = project?.hotspots?.slice(0, 4) ?? [];
  const hotspotHtml = hotspots
    .map(
      (method) =>
        `<button class="pipeline-step" data-action="open-method" data-file="${e(method.fileName)}" data-method="${e(method.methodId)}" style="width:100%;border:0;border-bottom:1px solid var(--border-soft);background:transparent;text-align:left"><span class="pipeline-number">${e(method.risk)}</span><span><strong class="mono">${e(method.name)}()</strong><small>${e(method.fileName)}:${method.line} · ${method.lines} lines · ${e(method.complexity)}</small></span>${icon("arrow", "", 14)}</button>`,
    )
    .join("");
  return `<div class="overview-hero"><div class="hero-content"><div class="eyebrow">UNDERSTAND · REFACTOR · VERIFY</div><h1>Ваш код.<br><span>Под контролем.</span></h1><p>Увидеть структуру. Обосновать изменение. Проверить результат на настоящей JVM.</p><div class="hero-actions">${button("Открыть визуальную модель", "navigate", { variant: "primary", icon: "nodes", trailing: "arrow", data: { view: "canvas" } })}${button("Режим защиты", "navigate", { variant: "ghost", icon: "presentation", data: { view: "presentation" } })}</div></div><div class="hero-art" aria-hidden="true"><div class="hero-orbit"></div><div class="hero-core">${icon("logo", "", 40)}</div><div class="hero-float hero-float-one">${icon("code", "", 13)} Java → AST</div><div class="hero-float hero-float-two">${icon("nodes", "", 13)} structure.graph</div><div class="hero-float hero-float-three">${icon("shield", "", 13)} verify the change</div></div></div><div class="metrics-grid">${metricCard("Строк Java", formatInteger(stats.lines), "в загруженном проекте", { name: "code" })}${metricCard("Методы", stats.methods ?? "—", "из реального AST", { name: "method" })}${metricCard("Точки внимания", stats.findings ?? "—", `${severities.error} ошибок · ${severities.warning} предупреждений`, { name: "target" })}${metricCard("Quality gate", workspace.gate === "passed" ? "PASS" : workspace.gate === "failed" ? "FAIL" : "—", workspace.gate === "unverified" ? "текущая версия не проверена" : "для выбранных входов", { accent: workspace.gate === "passed", name: "shield" })}</div>${!runtime.online ? notice("Это интерактивный обзор сохранённых реальных AST и запусков. Импорт своих исходников и выполнение Java доступны в локальной версии.", "warning", "eye") : ""}<div class="overview-grid" style="margin-top:20px">${panel("От изменения к доказательствам", `<div class="pipeline-steps">${pipeline.map(([title, detail, ready], index) => `<div class="pipeline-step ${ready ? "ready" : ""}"><span class="pipeline-number">${ready ? icon("check", "", 13) : String(index + 1).padStart(2, "0")}</span><span><strong>${e(title)}</strong><small>${e(detail)}</small></span>${icon("chevron", "", 13)}</div>`).join("")}</div>`, { icon: "git", actions: statusPill(workspace.gate, state.report?.recorded) })}${panel("Начните с этих методов", hotspotHtml || '<p class="muted text-small">Анализ проекта ещё загружается.</p>', { icon: "target", actions: badge("REVIEW PRIORITY", "neutral") })}</div><div class="section-label" style="margin:26px 0 13px">BUILT FOR THE HARD PARTS<span>06 CAPABILITIES</span></div><div class="capability-grid">${features.map(([name, title, description, view]) => `<button class="capability-card" data-action="${view === "export" ? "export" : "navigate"}" ${view !== "export" ? `data-view="${view}"` : ""}>${icon(name, "", 23)}<h3>${e(title)}</h3><p>${e(description)}</p></button>`).join("")}</div><p class="muted text-tiny" style="margin-top:22px">Оценки сложности и связей статические. Quality gate подтверждает наблюдаемое поведение на выбранных входах.</p>`;
}
