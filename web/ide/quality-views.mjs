import { escapeHtml as e, basename, timeLabel } from "./core.mjs";
import { glyph, button, iconButton, modalFrame, diffView } from "./views.mjs";
import { highlight } from "../lib/lexer.mjs";

const SEVERITY = {
  error: ["Ошибка", "warning"],
  warning: ["Риск", "warning"],
  info: ["Совет", "info"],
};

const severityRank = (value) =>
  ({ error: 0, warning: 1, info: 2 })[value] ?? 3;

export function severityBadge(severity) {
  const [label, name] = SEVERITY[severity] ?? SEVERITY.info;
  return `<span class="q-severity ${e(severity)}">${glyph(name, 12)}${label}</span>`;
}

export function inputPreview(input, maximum = 48) {
  const compact = String(input).replace(/\s+/g, " ").trim();
  if (!compact) return "пустой stdin";
  return compact.length > maximum ? compact.slice(0, maximum) + "…" : compact;
}

function hash(value) {
  return value ? `<code class="q-hash" title="${e(value)}">${e(value.slice(0, 12))}</code>` : "";
}

export function sortedFindings(findings = []) {
  return findings
    .map((finding, index) => ({ finding, index }))
    .sort(
      (a, b) =>
        severityRank(a.finding.severity) - severityRank(b.finding.severity) ||
        String(a.finding.fileName).localeCompare(String(b.finding.fileName)) ||
        a.finding.line - b.finding.line,
    );
}

export function analysisSidebar(state) {
  const { project, analysis, analysing, stale, error, filter } = state;
  if (!project)
    return `<div class="sidebar-empty">${glyph("target", 30)}<h3>Анализ проекта</h3><p>Откройте папку с Java-кодом: IDE найдёт дефекты, оценит сложность и предложит улучшения.</p>${button("open-folder", "Открыть папку", "folder", "ide-button primary small")}</div>`;
  if (analysing && !analysis)
    return `<div class="sidebar-empty"><span class="ide-spinner"></span><h3>Анализируем проект</h3><p>javac строит AST каждого файла, затем работают правила, граф вызовов и оценка сложности.</p></div>`;
  if (!analysis)
    return `<div class="sidebar-empty">${glyph("target", 30)}<h3>Диагностика и Big O</h3><p>${error ? e(error) : "Проверим все Java-файлы проекта: дефекты, сложность методов, граф вызовов и кандидатов на декомпозицию."}</p>${button("quality-analyse", "Проанализировать проект", "target", "ide-button primary small")}</div>`;
  const stats = analysis.stats ?? {};
  const counts = { error: 0, warning: 0, info: 0 };
  for (const finding of analysis.findings) counts[finding.severity] = (counts[finding.severity] ?? 0) + 1;
  const findings = sortedFindings(analysis.findings).filter(
    ({ finding }) => !filter || finding.severity === filter,
  );
  const chip = (severity, label) =>
    `<button class="q-filter ${severity} ${filter === severity ? "active" : ""}" data-action="finding-filter" data-severity="${severity}"><b>${counts[severity] ?? 0}</b>${label}</button>`;
  const hotspots = (analysis.hotspots ?? []).slice(0, 8);
  const methodById = new Map((analysis.methods ?? []).map((method) => [method.id, method]));
  return `${stale ? `<div class="q-stale">${glyph("warning", 13)}Код изменился после анализа.${button("quality-analyse", "Обновить", "loop", "ide-button small")}</div>` : ""}
  <div class="q-summary"><div><b>${stats.files ?? 0}</b><span>файлов</span></div><div><b>${stats.methods ?? 0}</b><span>методов</span></div><div><b>${stats.lines ?? 0}</b><span>строк</span></div></div>
  <div class="q-filters">${chip("error", "ошибок")}${chip("warning", "рисков")}${chip("info", "советов")}</div>
  <h4 class="q-section-title">Найденные проблемы <span>${findings.length}</span></h4>
  <div class="q-findings">${
    findings
      .map(
        ({ finding, index }) =>
          `<button class="q-finding ${e(finding.severity)}" data-action="open-finding" data-index="${index}"><span class="q-finding-top">${severityBadge(finding.severity)}<code>${e(finding.rule)}</code>${finding.canOptimize ? `<i class="q-fixable" title="Есть автоматическое улучшение">${glyph("sparkle", 11)}</i>` : ""}</span><b>${e(finding.title)}</b><small>${e(finding.detail ?? "")}</small><em>${e(basename(finding.fileName))}:${finding.line}</em></button>`,
      )
      .join("") ||
    `<p class="sidebar-note">${filter ? "Нет проблем этого уровня." : "Правила не сработали. Это не доказывает отсутствие дефектов — проверьте поведение тестами."}</p>`
  }</div>
  <h4 class="q-section-title">Сложные методы <span>Big O</span></h4>
  <div class="q-hotspots">${hotspots
    .map((spot) => {
      const method = methodById.get(spot.id) ?? spot;
      return `<button data-action="open-hotspot" data-file="${e(spot.fileName)}" data-method="${e(spot.methodId)}"><span><b>${e(spot.name)}()</b><small>${e(basename(spot.fileName))}:${spot.line} · ${spot.lines} строк · CC ${spot.cyclomatic}</small></span><em class="q-big-o ${complexityTone(method.complexity)}">${e(method.complexity ?? "—")}</em></button>`;
    })
    .join("")}</div>
  <h4 class="q-section-title">Декомпозиция <span>${(analysis.modules ?? []).length} ответственности</span></h4>
  <div class="q-modules">${moduleCards(analysis)}</div>
  <p class="sidebar-note">Правила и Big O — объяснимые эвристики по AST javac (${analysis.analysisMs ?? 0} мс). Решение о корректности принимает проверка поведения.</p>`;
}

export function complexityTone(label = "") {
  if (/n\s*[²³]|n\^|2\^|n\s*\*\s*n|!/.test(label)) return "bad";
  if (/n/.test(label)) return "ok";
  return "good";
}

const RESPONSIBILITY = {
  input: "Ввод и разбор",
  output: "Вывод результата",
  validation: "Проверки",
  computation: "Вычисления",
  utility: "Вспомогательное",
};

export function moduleCards(analysis, fileName = null) {
  const methods = new Map((analysis?.methods ?? []).map((method) => [method.id, method]));
  const cards = (analysis?.modules ?? [])
    .map((module) => {
      const members = module.methods
        .map((id) => methods.get(id))
        .filter((method) => method && (!fileName || method.fileName === fileName));
      if (!members.length) return "";
      const movable = members.filter((method) => method.static && method.name !== "main").length;
      return `<div class="q-module"><div><b>${e(module.suggestedClass)}</b><small>${e(RESPONSIBILITY[module.id] ?? module.id)} · ${members.length} методов · ${module.lines} строк</small></div>${movable ? button("decompose-open", "Выделить", "layers", "ide-button small", `data-module="${e(module.id)}"`) : '<span class="q-muted">нет static-методов</span>'}</div>`;
    })
    .join("");
  return cards || '<p class="sidebar-note">Кандидатов на выделение нет.</p>';
}

export function improveSidebar(state) {
  const { document, entry, analysis, method } = state;
  if (!document || document.language !== "java")
    return `<div class="sidebar-empty">${glyph("sparkle", 30)}<h3>Улучшения кода</h3><p>Откройте Java-файл. IDE предложит преобразования с обоснованием, а проверка поведения подтвердит результат.</p></div>`;
  const plans = entry?.data?.plans ?? [];
  const planCards = entry?.loading
    ? '<div class="q-loading"><span class="ide-spinner small"></span>Ищем применимые преобразования…</div>'
    : entry?.error
      ? `<div class="q-error">${e(entry.error)}</div>`
      : plans.length
        ? plans
            .map(
              (plan) =>
                `<article class="q-plan"><div class="q-plan-head"><span>${glyph("sparkle", 14)}</span><div><b>${e(plan.title)}</b><small>${e(plan.rationale)}</small></div></div><div class="q-plan-meta"><code>${e(plan.rule)}</code><span>стр. ${plan.line}</span>${plan.timeBefore && plan.timeBefore !== "unchanged" ? `<span class="q-big-o bad">${e(plan.timeBefore)}</span>→<span class="q-big-o good">${e(plan.timeAfter)}</span>` : '<span class="q-muted">упрощение структуры</span>'}</div><div class="q-plan-actions">${button("plan-preview", "Посмотреть изменение", "diff", "ide-button small", `data-id="${e(plan.id)}"`)}${button("plan-apply", "Применить", "check", "ide-button small primary", `data-id="${e(plan.id)}" ${document.readOnly ? "disabled" : ""}`)}</div></article>`,
            )
            .join("") +
          (plans.length > 1
            ? button("plans-apply-all", `Применить все (${plans.length})`, "check", "ide-button small", document.readOnly ? "disabled" : "")
            : "")
        : `<div class="sidebar-empty compact">${glyph("circleCheck", 22)}<h3>Автоулучшений нет</h3><p>Для этого файла не нашлось распознанных шаблонов. Посмотрите диагностику в «Анализе».</p></div>`;
  return `<div class="q-file">${glyph("file", 14)}<b>${e(document.name)}</b>${iconButton("plans-refresh", "Обновить предложения", "loop")}</div>
  <h4 class="q-section-title">Оптимизации <span>${plans.length}</span></h4>${planCards}
  <h4 class="q-section-title">Декомпозиция монолита</h4>
  <div class="q-decompose">${method ? `<div class="q-module"><div><b>${e(method.name)}()</b><small>Вынести текущий метод в отдельный класс</small></div>${button("extract-method", "Вынести", "layers", "ide-button small", document.readOnly || !method.static ? "disabled" : "")}</div>${method.static ? "" : '<p class="sidebar-note">Выносятся static-методы: метод экземпляра зависит от состояния объекта.</p>'}` : ""}${analysis ? moduleCards(analysis, document.path) : `<p class="sidebar-note">Анализ проекта сгруппирует методы по ответственностям: ввод, вычисления, вывод.</p>${button("quality-analyse", "Найти ответственности", "target", "ide-button small")}`}</div>
  <p class="sidebar-note">Изменения попадают в редактор, затем запускается проверка поведения против исходной версии. Сохраните файл, когда результат совпадёт.</p>`;
}

export function planModal(plan) {
  return modalFrame(
    plan.title,
    `<div class="q-plan-meta"><code>${e(plan.rule)}</code><span>строка ${plan.line}</span>${plan.timeBefore && plan.timeBefore !== "unchanged" ? `<span class="q-big-o bad">${e(plan.timeBefore)}</span>→<span class="q-big-o good">${e(plan.timeAfter)}</span>` : ""}<span>память: ${e(plan.memoryAfter ?? "—")}</span></div><p class="modal-lead">${e(plan.rationale)}</p>${diffView(plan.before, plan.after, { before: "Сейчас", after: "После преобразования" })}<p class="modal-note"><b>Условия применимости.</b> ${e(plan.description)} Патч привязан к хешу исходника: если код изменится, предложение будет пересчитано, а после применения запустится проверка поведения.</p>`,
    `${button("close-modal", "Закрыть")}${button("plan-apply", "Применить и проверить", "check", "ide-button primary", `data-id="${e(plan.id)}"`)}`,
    "wide",
  );
}

export function decomposeModal({ module, methods, fileName, className }) {
  const counts = new Map();
  for (const method of methods) counts.set(method.owner, (counts.get(method.owner) ?? 0) + 1);
  const primary = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const movable = (method) => method.static && method.name !== "main";
  return modalFrame(
    "Выделить ответственность в класс",
    `<form id="decompose-form"><p class="modal-lead">Методы группы «${e(RESPONSIBILITY[module.id] ?? module.id)}» из ${e(basename(fileName))} будут перенесены в новый класс рядом с исходным файлом. В исходном классе останутся делегаты, поэтому вызывающий код не меняется.</p><label class="modal-field">Имя нового класса<input name="className" value="${e(className)}" required pattern="[A-Z][A-Za-z0-9_]*" maxlength="60" autocomplete="off"/></label><div class="q-method-picks">${methods
      .map(
        (method) =>
          `<label class="${movable(method) ? "" : "disabled"}"><input type="checkbox" name="method" value="${e(method.methodId)}" ${movable(method) ? (method.owner === primary ? "checked" : "") : "disabled"}/><span><b>${method.name === "<init>" ? "new " + e(method.owner) : (method.owner !== primary ? e(method.owner) + "." : "") + e(method.name)}()</b><small>стр. ${method.line} · ${method.lines} строк${method.static ? "" : " · метод экземпляра"}${method.name === "main" ? " · точка входа" : ""}</small></span></label>`,
      )
      .join("")}</div><p class="modal-note">Методы, которые читают поля класса или вызывают оставшиеся методы, будут пропущены с объяснением. После переноса javac собирает проект, затем запускается проверка поведения.</p><div id="decompose-error" class="modal-inline-error" role="alert" hidden></div></form>`,
    `${button("close-modal", "Отмена")}<button type="submit" form="decompose-form" class="ide-button primary">${glyph("layers")}<span>Выделить и проверить</span></button>`,
    "wide",
  );
}

export function extractModal(method) {
  return modalFrame(
    "Вынести метод в класс",
    `<form id="extract-form"><p class="modal-lead">Метод <b>${e(method.name)}()</b> переедет в новый класс. На старом месте останется делегат с той же сигнатурой.</p><label class="modal-field">Имя класса<input name="className" value="${e(method.name.charAt(0).toUpperCase() + method.name.slice(1))}Logic" required pattern="[A-Z][A-Za-z0-9_]*" maxlength="60" autocomplete="off"/></label><div id="extract-error" class="modal-inline-error" role="alert" hidden></div></form>`,
    `${button("close-modal", "Отмена")}<button type="submit" form="extract-form" class="ide-button primary">${glyph("layers")}<span>Вынести и проверить</span></button>`,
  );
}

export function decomposeResultNote(result) {
  const skipped = result.skipped ?? [];
  return `Перенесено методов: ${result.moved.length} → ${basename(result.created)}${skipped.length ? `. Пропущено: ${skipped.length} (${skipped
    .slice(0, 3)
    .map((item) => `${item.name}: ${item.reason}`)
    .join("; ")}${skipped.length > 3 ? "…" : ""})` : ""}`;
}

export function generatorModal() {
  return modalFrame(
    "Сгенерировать входы",
    `<form id="generator-form"><p class="modal-lead">Детерминированный генератор граничных и случайных stdin. Одинаковый seed даёт одинаковый набор.</p><div class="q-form-grid"><label class="modal-field">Формат ввода<select name="schema"><option value="int-array">n и n целых чисел</option><option value="single-int">одно целое число</option><option value="text-line">строка текста</option></select></label><label class="modal-field">Количество<input name="count" type="number" min="1" max="30" value="8"/></label><label class="modal-field">Seed<input name="seed" type="number" value="42"/></label><label class="modal-field">Макс. длина<input name="maximumLength" type="number" min="0" max="256" value="24"/></label><label class="modal-field">Минимум<input name="minimum" type="number" value="-50"/></label><label class="modal-field">Максимум<input name="maximum" type="number" value="50"/></label></div><label class="setting-checkbox"><input type="checkbox" name="replace"/><span><b>Заменить текущие входы</b><small>Иначе новые входы добавятся к существующим (до 30)</small></span></label></form>`,
    `${button("close-modal", "Отмена")}<button type="submit" form="generator-form" class="ide-button primary">${glyph("sparkle")}<span>Сгенерировать</span></button>`,
  );
}

export function baselineDiffModal(changes) {
  return modalFrame(
    "Изменения относительно исходной версии",
    changes.length
      ? changes
          .map(
            (change) =>
              `<details class="replace-preview-file" ${changes.length === 1 ? "open" : ""}><summary>${e(change.path)} · ${change.status === "added" ? "новый файл" : change.status === "deleted" ? "удалён" : "изменён"}</summary>${diffView(change.before, change.after, { before: "Исходная версия", after: "Сейчас" })}</details>`,
          )
          .join("")
      : '<p class="modal-lead">Текущая версия совпадает с исходной версией.</p>',
    button("close-modal", "Закрыть", null, "ide-button primary"),
    "wide",
  );
}

export function qualityStatus({ report, stale, job, project }) {
  if (!project) return "";
  if (job && ["queued", "running"].includes(job.state))
    return `<i class="ide-spinner small"></i>${e(jobTitle(job.kind))}…`;
  if (!report) return `${glyph("shield", 12)}Поведение не проверено`;
  const passed = report.tests.filter((test) => test.passed).length;
  if (stale) return `${glyph("shield", 12)}Проверка устарела`;
  return report.passed
    ? `<span class="q-ok">${glyph("circleCheck", 12)}Поведение совпало ${passed}/${report.tests.length}</span>`
    : `<span class="q-bad">${glyph("warning", 12)}Расхождение ${report.tests.length - passed}/${report.tests.length}</span>`;
}

export function jobTitle(kind) {
  return (
    {
      compare: "Проверяем поведение",
      mutation: "Проверка качества тестов",
      benchmark: "Измеряем скорость",
      minimize: "Ищем минимальный вход",
    }[kind] ?? "Задача"
  );
}

export function methodMetrics(detail, findings) {
  if (!detail) return `<span class="q-metric muted"><i class="ide-spinner small"></i>Big O…</span>`;
  const metrics = detail.complexity ?? {};
  return `<span class="q-metric q-big-o ${complexityTone(metrics.time)}" title="${e((metrics.assumptions ?? []).join(" "))}">${e(metrics.time ?? "—")}</span><span class="q-metric" title="Цикломатическая сложность">CC ${metrics.cyclomatic ?? "—"}</span>${findings ? `<button class="q-metric warn" data-action="sidebar" data-view="analysis" title="Проблемы метода">${glyph("warning", 11)}${findings}</button>` : ""}`;
}

export function complexityModal(method, detail) {
  const metrics = detail?.complexity;
  const reasons = (metrics?.reasoning ?? []).map((reason) => `<p><b>${e(reason.cost)}</b> · стр. ${reason.line}: ${e(reason.reason)}</p>`).join("");
  return modalFrame(
    `${method.name}(): ${metrics?.time ?? "оценка недоступна"}`,
    `<p class="modal-lead">Оценка времени работы считается по AST: вложенные циклы перемножаются, последовательные участки берут максимум. Вызовы других методов в оценку не входят.</p>${reasons || "<p>Циклов в методе нет: время не зависит от размера данных.</p>"}${(metrics?.assumptions ?? []).map((item) => `<p class="q-muted">${e(item)}</p>`).join("")}`,
    button("close-modal", "Закрыть", null, "ide-button primary"),
  );
}

export function complexityDetails(detail) {
  const metrics = detail?.complexity;
  if (!metrics) return "";
  return `<details class="q-complexity"><summary>Почему ${e(metrics.time)}</summary>${(metrics.reasoning ?? [])
    .map((reason) => `<p><b>${e(reason.cost)}</b> · стр. ${reason.line}: ${e(reason.reason)}</p>`)
    .join("") || "<p>Циклов не найдено: стоимость вызовов отдельно не доказывается.</p>"}${(metrics.assumptions ?? []).map((item) => `<p class="q-muted">${e(item)}</p>`).join("")}</details>`;
}

export function nodeFindings(findings) {
  if (!findings.length) return "";
  return `<div class="q-node-findings">${findings
    .map(
      (finding) =>
        `<div class="q-node-finding ${e(finding.severity)}">${severityBadge(finding.severity)}<b>${e(finding.title)}</b><small>${e(finding.detail ?? "")}</small>${finding.canOptimize ? button("improve", "Показать улучшение", "sparkle", "ide-button small") : ""}</div>`,
    )
    .join("")}</div>`;
}

const TABS = [
  ["inputs", "Входы", "table"],
  ["results", "Результат", "shield"],
  ["mutation", "Качество тестов", "beaker"],
  ["benchmark", "Скорость", "chart"],
  ["reducer", "Минимальный вход", "target"],
];

export function verifyPanel(state) {
  const { project, baseline, cases, report, stale, job, tab, lab, method, document, pending } = state;
  if (!project)
    return `<div class="panel-empty">${glyph("shield", 23)}<span>Проверка поведения</span><small>Откройте проект: IDE сохранит исходную версию и будет сравнивать с ним каждое изменение.</small></div>`;
  const running = job && ["queued", "running"].includes(job.state);
  const enabled = cases.filter((item) => item.enabled !== false).length;
  const head = `<div class="q-verify-head"><div class="q-baseline">${glyph("bookmark", 14)}<span><b>Исходная версия</b><small>${baseline ? `${e(baseline.label || "Снимок")} · ${Object.keys(baseline.files).length} файлов${baseline.takenAt ? " · " + e(timeLabel(baseline.takenAt)) : ""}` : "не зафиксирован"}</small></span>${button("baseline-diff", "Отличия", "diff", "ide-button small subtle")}${button("baseline-set-current", "Считать текущую исходной", "bookmark", "ide-button small subtle")}</div><div class="q-tabs" role="tablist">${TABS.map(([id, label, name]) => `<button role="tab" class="${tab === id ? "active" : ""}" aria-selected="${tab === id}" data-action="verify-tab" data-tab="${id}">${glyph(name, 13)}${label}${id === "inputs" ? ` <span>${enabled}/${cases.length}</span>` : id === "results" && report ? ` <span class="${report.passed && !stale ? "ok" : "bad"}">${report.tests.filter((test) => test.passed).length}/${report.tests.length}</span>` : ""}</button>`).join("")}</div><div class="q-verify-actions">${running ? `<span class="q-job"><i class="ide-spinner small"></i>${e(job.stage || jobTitle(job.kind))}</span>${button("job-cancel", "Отменить", "close", "ide-button small danger")}` : `${pending ? button("rollback-change", "Откатить: " + pending.label, "undo", "ide-button small danger", `title="Вернуть файлы к состоянию до автоматического изменения"`) : ""}${button("export-evidence", "Отчёт", "download", "ide-button small subtle", report && !stale ? "" : "disabled")}${button("verify", "Проверить поведение", "shield", "ide-button small primary")}`}</div></div>`;
  const body = {
    inputs: () => inputsTab(cases),
    results: () => resultsTab(report, stale, running),
    mutation: () => mutationTab(lab.mutation, method, document, running),
    benchmark: () => benchmarkTab(lab.benchmark, method, running),
    reducer: () => reducerTab(lab.reduction, lab.reducerInput, running),
  }[tab]();
  return head + `<div class="q-verify-body">${body}</div>`;
}

function inputsTab(cases) {
  return `<div class="q-cases-toolbar"><span>Каждый вход — stdin программы. Исходная версия и текущая версия запускаются в отдельных JVM, сравниваются stdout, stderr и код завершения.</span><div>${button("case-add", "Добавить", "plus", "ide-button small")}${button("case-from-run", "Из параметров запуска", "terminal", "ide-button small subtle")}${button("cases-generate-open", "Сгенерировать", "sparkle", "ide-button small subtle")}${button("cases-export", "Экспорт", "download", "ide-button small subtle", cases.length ? "" : "disabled")}</div></div><div class="q-cases">${
    cases
      .map(
        (item, index) =>
          `<div class="q-case ${item.enabled === false ? "disabled" : ""}"><div class="q-case-head"><input type="checkbox" class="q-case-enabled" data-id="${e(item.id)}" ${item.enabled !== false ? "checked" : ""} aria-label="Включить вход ${index + 1}"/><input class="q-case-name" data-id="${e(item.id)}" value="${e(item.name)}" aria-label="Название входа ${index + 1}" maxlength="80"/><button class="ide-icon-button" data-action="case-delete" data-id="${e(item.id)}" aria-label="Удалить вход ${index + 1}" title="Удалить">${glyph("close", 13)}</button></div><textarea class="q-case-input" data-id="${e(item.id)}" spellcheck="false" rows="3" aria-label="stdin входа ${index + 1}" placeholder="Пустой stdin">${e(item.input)}</textarea></div>`,
      )
      .join("") ||
    `<div class="panel-empty">${glyph("table", 22)}<span>Нет тестовых входов</span><small>Добавьте stdin вручную, возьмите из параметров запуска или сгенерируйте набор.</small></div>`
  }</div>`;
}

function stream(title, output) {
  return `<div class="q-stream"><div><span>${e(title)}</span><small>код ${output.exitCode}${output.timedOut ? " · таймаут" : ""}${output.outputLimit ? " · лимит вывода" : ""} · ${output.timeMs} мс</small></div><pre>${e(output.stdout) || '<span class="q-muted">stdout пуст</span>'}${output.stderr ? `\n<span class="q-stderr">${e(output.stderr)}</span>` : ""}</pre></div>`;
}

function resultsTab(report, stale, running) {
  if (!report)
    return `<div class="panel-empty">${glyph("shield", 23)}<span>${running ? "Проверка выполняется…" : "Текущая версия ещё не проверена"}</span><small>Нажмите «Проверить поведение» или F6: исходная версия и текущий код будут собраны javac и запущены на всех включённых входах.</small></div>`;
  const passed = report.tests.filter((test) => test.passed).length;
  const builds = [
    ["Исходная версия", report.baselineBuild],
    ["Текущая версия", report.candidateBuild],
  ].filter(([, build]) => build && !build.success);
  return `${stale ? `<div class="task-stale-notice">Код изменён после проверки. Результат относится к предыдущей версии — запустите проверку снова.</div>` : ""}<div class="q-result-banner ${report.passed ? "pass" : "fail"}">${glyph(report.passed ? "circleCheck" : "warning", 22)}<div><b>${report.passed ? "Поведение сохранено" : builds.length ? "Сборка не прошла" : "Поведение изменилось"}</b><small>${passed} из ${report.tests.length} входов совпали · stdout, stderr (без номеров строк стека), код завершения</small></div><span class="q-hashes">исходная ${hash(report.baselineHash)} · текущая ${hash(report.candidateHash)}</span></div>${builds.map(([title, build]) => `<div class="q-stream fail"><div><span>${e(title)}: ошибка компиляции</span></div><pre class="q-stderr">${e(build.diagnostics)}</pre></div>`).join("")}<div class="q-tests">${report.tests
    .map(
      (test, index) =>
        `<details class="q-test ${test.passed ? "pass" : "fail"}" ${!test.passed ? "open" : ""}><summary>${glyph(test.passed ? "circleCheck" : "warning", 14)}<b>${e(report.caseNames?.[index] ?? test.name)}</b><code>${e(inputPreview(test.input))}</code><small>${test.baseline.timeMs} → ${test.candidate.timeMs} мс</small></summary><div class="q-test-body"><div class="q-streams">${stream("Исходная версия", test.baseline)}${stream("Текущая версия", test.candidate)}</div>${!test.passed && test.baseline.stdout !== test.candidate.stdout ? diffView(test.baseline.stdout, test.candidate.stdout, { before: "stdout исходной версии", after: "stdout текущей версии" }) : ""}${!test.passed && /^\s*\d+(\s+-?\d+)*\s*$/.test(test.input) ? button("reduce-failure", "Найти минимальный вход", "target", "ide-button small", `data-index="${index}"`) : ""}</div></details>`,
    )
    .join("")}</div><p class="q-footnote">Совпадение на конечном наборе входов — свидетельство, а не доказательство эквивалентности на всех данных. Время включает старт JVM.</p>`;
}

function mutationTab(result, method, document, running) {
  const intro = `<div class="q-cases-toolbar"><span>IDE по одной вносит в <b>${e(method?.name ?? "—")}()</b> мелкие поломки (замена &lt; на &lt;=, + на −, константа ±1) и запускает ваши входы. Если вывод программы не изменился, входы поломку не заметили: метод ими покрыт слабо.</span><div>${button("lab-mutation", "Проверить тесты", "beaker", "ide-button small primary", running || !method || document?.language !== "java" ? "disabled" : "")}</div></div>`;
  if (!result) return intro + `<div class="panel-empty">${glyph("beaker", 22)}<span>Заметят ли входы поломку метода?</span><small>Выберите метод в режиме «Метод». Используются первые 5 включённых входов.</small></div>`;
  return (
    intro +
    `<div class="q-mutation-summary"><b>${result.score == null ? "—" : result.score + "%"}</b><span>заметили ${result.killed} · пропустили ${result.survived} · не компилируются ${result.invalid}</span></div><div class="q-mutants">${result.mutants
      .map(
        (mutant) =>
          `<div class="q-mutant ${e(mutant.status)}"><div><span class="q-chip">${e(mutant.status === "killed" ? "замечена" : mutant.status === "survived" ? "пропущена" : "не компилируется")}</span><code>${e(mutant.operator)}</code><small>стр. ${mutant.line}</small><b>${e(mutant.title)}</b></div><div class="q-mutant-code"><pre>${highlight(mutant.before)}</pre><pre>${highlight(mutant.after)}</pre></div>${mutant.recommendation ? `<small>${e(mutant.recommendation)}</small>` : ""}</div>`,
      )
      .join("")}</div><p class="q-footnote">${e(result.note ?? "")}</p>`
  );
}

function benchmarkTab(result, method, running) {
  const controls = `<form id="benchmark-form" class="q-inline-form"><label>Метод <input name="methodName" value="${e(method?.name ?? "")}" required/></label><label>Размеры n <input name="sizes" value="128, 512, 2048"/></label><button type="submit" class="ide-button small primary" ${running ? "disabled" : ""}>${glyph("chart", 14)}<span>Измерить исходную и текущую версии</span></button><small>Метод вида static int name(int[]) · 3 прогрева · 5 замеров · медиана</small></form>`;
  if (!result) return controls + `<div class="panel-empty">${glyph("chart", 22)}<span>Скорость до и после</span><small>Измерение внутри JVM: вход клонируется вне таймера, проверяется совпадение результата.</small></div>`;
  return (
    controls +
    `<table class="q-table"><thead><tr><th>n</th><th>Исходная версия</th><th>Текущая версия</th><th>Быстрее в</th><th>Результат</th></tr></thead><tbody>${result.comparison
      .map(
        (point) =>
          `<tr><td>${point.size}</td><td>${nanos(point.baselineNs)}</td><td>${nanos(point.candidateNs)}</td><td class="${point.speedup >= 1 ? "q-ok" : "q-bad"}">×${Number(point.speedup).toFixed(point.speedup >= 10 ? 0 : 2)}</td><td>${point.sameResult ? '<span class="q-ok">совпал</span>' : '<span class="q-bad">отличается</span>'}</td></tr>`,
      )
      .join("")}</tbody></table><p class="q-footnote">${e(result.note ?? "")}</p>`
  );
}

function nanos(value) {
  const number = Number(value);
  if (number >= 1e6) return (number / 1e6).toFixed(2) + " мс";
  if (number >= 1e3) return (number / 1e3).toFixed(1) + " мкс";
  return Math.round(number) + " нс";
}

function reducerTab(result, input, running) {
  const controls = `<form id="reducer-form" class="q-inline-form"><label class="grow">Вход, на котором версии расходятся (n и n целых)<textarea name="input" rows="2" spellcheck="false">${e(input ?? "")}</textarea></label><button type="submit" class="ide-button small primary" ${running ? "disabled" : ""}>${glyph("target", 14)}<span>Найти минимальный</span></button></form>`;
  if (!result) return controls + `<div class="panel-empty">${glyph("target", 22)}<span>Минимальный входной пример</span><small>IDE по шагам убирает из входа лишнее, пока версии всё ещё расходятся. Получается короткий пример для отладки. Каждый шаг проверяется запуском JVM.</small></div>`;
  return (
    controls +
    `<div class="q-reduction"><div><small>Было · ${result.beforeLength} элементов</small><pre>${e(result.originalInput)}</pre></div><div class="accent"><small>Стало · ${result.afterLength} элементов</small><pre>${e(result.minimalInput)}</pre></div></div><p class="q-footnote">${result.attempts}/${result.budget} попыток. ${e(result.note ?? "")}</p>`
  );
}
