import { escapeHtml as e } from "../lib/core.mjs";
import { icon } from "../lib/icons.mjs";
import { inputPreview, arraySchema } from "../lib/inputs.mjs";
import {
  lineChart,
  nanoseconds,
  speedup,
  reportSummary,
  donutChart,
} from "../lib/metrics.mjs";
import { highlight } from "../lib/lexer.mjs";
import {
  badge,
  button,
  sectionHeading,
  emptyState,
  notice,
  selectableTabs,
  panel,
  hashLabel,
  metricCard,
} from "../components/primitives.mjs";

export const TEST_TABS = [
  { id: "inputs", label: "Входы", icon: "table" },
  { id: "results", label: "Quality gate", icon: "shield" },
  { id: "benchmark", label: "Бенчмарк", icon: "chart" },
  { id: "mutation", label: "Mutation", icon: "beaker" },
  { id: "reducer", label: "Контрпример", icon: "target" },
];

export function renderTests(workspace, runtime, ui) {
  const active = ui.testsTab ?? "inputs";
  const tabs = TEST_TABS.map((tab) => ({
    ...tab,
    count:
      tab.id === "inputs"
        ? workspace.state.cases.length
        : tab.id === "results" && workspace.state.report
          ? workspace.state.report.tests.length
          : null,
  }));
  const renderers = {
    inputs: renderInputs,
    results: renderResults,
    benchmark: renderBenchmark,
    mutation: renderMutation,
    reducer: renderReducer,
  };
  return (
    sectionHeading(
      "TEST THE CHANGE, NOT THE PROMISE",
      "Доверие начинается с проверки.",
      "Дифференциальные тесты, измерения и проверка силы самого тестового набора.",
      button(
        runtime.online ? "Запустить gate" : "Записанный прогон",
        "run-compare",
        { icon: "play", variant: "primary" },
      ),
    ) +
    selectableTabs(tabs, active, "tests-tab", "test-lab-tabs") +
    renderers[active](workspace, runtime, ui)
  );
}

function renderInputs(workspace, runtime) {
  const cases = workspace.state.cases;
  const selected = cases.filter((item) => item.enabled !== false).length;
  return `<div class="test-input-toolbar"><span class="muted text-small">${selected} / ${cases.length} включено</span><div>${button("Генератор", "open-generator", { icon: "sparkle", className: "small" })}${button("Импорт", "import-cases", { icon: "upload", variant: "ghost", className: "small" })}${button("Добавить", "add-case", { icon: "plus", className: "small" })}</div></div>${!runtime.online ? notice("Входы можно изучать и экспортировать. Для запуска нового набора нужен локальный JVM-сервер; сохранённый прогон относится только к исходному набору демо.", "warning", "eye") + '<div style="height:14px"></div>' : ""}<div class="test-case-list">${cases.map((item, index) => `<article class="test-case-card ${item.enabled === false ? "disabled" : ""}"><div class="test-case-header"><input type="checkbox" class="case-enabled" data-case="${e(item.id)}" aria-label="Включить вход ${index + 1}" ${item.enabled !== false ? "checked" : ""}><input class="test-case-name" data-case="${e(item.id)}" aria-label="Имя входа ${index + 1}" value="${e(item.name)}"><button class="icon-button" data-action="delete-case" data-id="${e(item.id)}" aria-label="Удалить вход ${index + 1}">${icon("trash", "", 13)}</button></div><textarea class="test-case-input" data-case="${e(item.id)}" spellcheck="false" aria-label="stdin для входа ${index + 1}">${e(item.input)}</textarea><div class="test-case-footer">${badge(item.category ?? "manual", "neutral")}<span>${item.input.length} chars · ${arraySchema(item.input) !== null ? "int[] schema" : "raw stdin"}</span></div></article>`).join("")}</div><div style="margin-top:18px">${notice("stdin передаётся точно как задано; после передачи поток закрывается. Пустая строка и отсутствие данных могут иметь разное поведение.", "info", "terminal")}</div>`;
}

function outputBlock(title, output) {
  return `<div class="console-block"><div class="console-label"><span>${e(title)}</span><span>exit ${output.exitCode}${output.timedOut ? " · TIMEOUT" : ""}${output.outputLimit ? " · OUTPUT LIMIT" : ""}</span></div><pre>${e(output.stdout) || '<span class="muted">stdout пуст</span>'}${output.stderr ? `\n<span class="stderr">STDERR\n${e(output.stderr)}</span>` : ""}</pre></div>`;
}

function renderResults(workspace, runtime) {
  const report = workspace.state.report;
  if (!report)
    return emptyState(
      "shield",
      "Эта версия ещё не проверена",
      "После изменения Java, эталона или входов предыдущий отчёт теряет силу.",
      button(
        runtime.online ? "Проверить поведение" : "Показать запись демо",
        "run-compare",
        { icon: "play", variant: "primary" },
      ),
    );
  const summary = reportSummary(report);
  const compile = [
    ["Эталон", report.baselineBuild],
    ["Кандидат", report.candidateBuild],
  ].filter(([, build]) => !build.success);
  return `${report.recorded ? notice("Показан сохранённый реальный прогон встроенного примера. Текущие поля входов не выполнялись.", "warning", "eye") + '<div style="height:14px"></div>' : ""}<div class="test-result-banner ${report.passed ? "" : "failed"}"><div><h2>${icon(report.passed ? "circleCheck" : "warning", "", 23)}${report.passed ? "Поведение совпало." : "Изменение обнаружено."}</h2><p>Исходные байты stdout + stderr + код завершения</p></div><div class="test-result-count">${summary.passed}<span>/${summary.total}</span></div></div><div class="report-hashes">${hashLabel(report.baselineHash, "BASELINE")}${hashLabel(report.candidateHash, "CANDIDATE")}${badge(report.runner ?? "recorded", "neutral")}</div>${compile.map(([title, build]) => `<div class="console-block" style="margin-bottom:14px"><div class="console-label"><span>${e(title)}: ошибка компиляции</span>${badge("BUILD FAILED", "danger")}</div><pre class="stderr">${e(build.diagnostics)}</pre></div>`).join("")}${report.tests.map((test, index) => `<details class="test-result-row" ${!test.passed ? "open" : ""}><summary>${icon(test.passed ? "circleCheck" : "warning", test.passed ? "text-green" : "text-red", 14)}<span>${e(workspace.state.cases[index]?.name ?? test.name)}</span><span class="test-result-time">${test.baseline.timeMs} → ${test.candidate.timeMs} ms</span>${icon("chevron", "", 12)}</summary><div class="test-result-details"><div class="console-block"><div class="console-label">STDIN · ${test.input.length} chars</div><pre>${e(test.input) || '<span class="muted">пусто</span>'}</pre></div><div class="test-console-grid">${outputBlock("BASELINE", test.baseline)}${outputBlock("CANDIDATE", test.candidate)}</div><div style="display:flex;justify-content:space-between;align-items:center;gap:10px">${hashLabel(test.candidate.stdoutSha256, "STDOUT")}${!test.passed && arraySchema(test.input) !== null ? button("Уменьшить контрпример", "reduce-failure", { icon: "target", className: "small", data: { index } }) : ""}</div></div></details>`).join("")}<div style="margin-top:18px">${notice("Совпадение на конечном наборе входов не доказывает эквивалентность на всех данных. Время в строках тестов включает запуск JVM; это не микробенчмарк.", "info", "info")}</div>`;
}

function renderBenchmark(workspace, runtime) {
  const result = workspace.state.benchmark;
  const controls = `<div class="form-grid" style="margin:0 0 18px"><label>Метод <input id="benchmark-method" value="${e(workspace.method?.name ?? "countPairs")}" aria-label="Имя метода для бенчмарка"></label><label>Размеры массива<input id="benchmark-sizes" value="128, 512, 2048" aria-label="Размеры для бенчмарка"></label></div><div class="test-input-toolbar"><span class="muted text-small">static int method(int[]) · 3 warmups · 5 samples</span>${button(runtime.online ? "Измерить до / после" : "Сохранённые измерения", "run-benchmark", { icon: "chart", variant: "primary", className: "small" })}</div>`;
  if (!result)
    return panel(
      "Микробенчмарк метода",
      controls +
        notice(
          "Измеряется вызов метода внутри JVM. Перед каждым повтором вход клонируется вне таймера. Выберите доступный static int method(int[]); вывод в stdout нарушит протокол измерения.",
          "info",
          "clock",
        ),
      { icon: "chart" },
    );
  const series = [
    {
      name: "Эталон",
      color: "#ada7f5",
      values: result.comparison.map((point) => ({
        x: point.size,
        y: point.baselineNs / 1000,
      })),
    },
    {
      name: "Кандидат",
      color: "#c3f48b",
      values: result.comparison.map((point) => ({
        x: point.size,
        y: point.candidateNs / 1000,
      })),
    },
  ];
  return panel(
    "Микробенчмарк метода",
    controls +
      `${result.recorded ? notice("Записанный реальный замер для встроенного примера.", "warning", "eye") : ""}<div class="benchmark-legend" style="margin:18px 0 12px"><span>Эталон</span><span>Кандидат</span></div>${lineChart(series)}<div class="data-table-wrap"><table class="data-table"><thead><tr><th>n</th><th>Эталон, median</th><th>Кандидат, median</th><th>Отношение</th><th>Результат</th></tr></thead><tbody>${result.comparison.map((point) => `<tr><td class="mono">${point.size}</td><td class="mono">${nanoseconds(point.baselineNs)}</td><td class="mono">${nanoseconds(point.candidateNs)}</td><td class="mono ${point.speedup >= 1 ? "text-green" : "text-amber"}">${speedup(point.speedup)}</td><td>${badge(point.sameResult ? "SAME" : "DIFFERENT", point.sameResult ? "success" : "danger")}</td></tr>`).join("")}</tbody></table></div><p class="muted text-tiny" style="margin-top:17px">${e(result.note)}</p>`,
    { icon: "chart" },
  );
}

function renderMutation(workspace, runtime) {
  const result = workspace.state.mutations;
  const actions = `<div class="test-input-toolbar"><span class="muted text-small">${e(workspace.method?.name ?? "method")}() · до 5 мутантов · первые 5 входов</span>${button(runtime.online ? "Проверить силу тестов" : "Запись mutation run", "run-mutation", { icon: "beaker", variant: "primary", className: "small" })}</div>`;
  if (!result)
    return (
      actions +
      emptyState(
        "beaker",
        "Тесты тоже нуждаются в проверке.",
        "Mutation lab меняет операторы и константы в копиях программы. Если тесты не замечают изменения, мутант выживает.",
      ) +
      notice(
        "Score не является покрытием кода. Невалидные мутанты исключаются из знаменателя, а выжившие могут быть эквивалентными.",
        "info",
        "info",
      )
    );
  const chart = donutChart(
    [
      { label: "Killed", value: result.killed, color: "#8bd6ae" },
      { label: "Survived", value: result.survived, color: "#e0bd81" },
      { label: "Invalid", value: result.invalid, color: "#65758e" },
    ],
    { label: "MUTANTS" },
  );
  return (
    actions +
    `${result.recorded ? notice("Сохранённый реальный mutation run для встроенного примера.", "warning", "eye") + '<div style="height:14px"></div>' : ""}<div class="mutation-summary">${chart}<div><div class="eyebrow">MUTATION SCORE</div><h2>${result.score == null ? "—" : result.score + "%"} обнаружено</h2><p>Тесты отличили ${result.killed} изменённых программ из ${result.killed + result.survived} валидных.</p><div class="mutation-legend">${badge(`${result.killed} killed`, "success")}${badge(`${result.survived} survived`, "warning")}${badge(`${result.invalid} invalid`, "neutral")}</div></div></div>${result.mutants.map((mutant) => `<article class="finding-card"><div class="finding-card-top">${badge(mutant.status.toUpperCase(), mutant.status === "killed" ? "success" : mutant.status === "survived" ? "warning" : "neutral")}<span>L${mutant.line}</span><code>${e(mutant.operator)}</code></div><h3>${e(mutant.title)}</h3><div class="plan-preview-grid" style="border:1px solid var(--border);border-radius:5px;max-height:150px"><pre class="plan-code">${highlight(mutant.before)}</pre><pre class="plan-code">${highlight(mutant.after)}</pre></div>${mutant.killedBy != null ? `<p style="margin:10px 0 0">Обнаружен входом ${mutant.killedBy + 1}.</p>` : ""}${mutant.recommendation ? `<p style="margin-top:10px">${e(mutant.recommendation)}</p>` : ""}${mutant.diagnostics ? `<details><summary class="muted text-tiny">Ошибка компиляции</summary><pre class="muted text-tiny" style="white-space:pre-wrap">${e(mutant.diagnostics)}</pre></details>` : ""}</article>`).join("")}<p class="muted text-tiny">${e(result.note)}</p>`
  );
}

function renderReducer(workspace, runtime, ui) {
  const result = workspace.state.reduction;
  const failed = workspace.state.report?.tests.find(
    (test) => !test.passed && arraySchema(test.input) !== null,
  );
  const input = ui.reducerInput ?? failed?.input ?? "";
  const controls = `<p class="muted text-small">Формат: n и ровно n целых чисел. Обе версии должны компилироваться и различаться на этом входе.</p><textarea id="reducer-input" class="code-input" style="min-height:100px" spellcheck="false" aria-label="Вход для уменьшения контрпримера">${e(input)}</textarea><div class="test-input-toolbar" style="margin-top:14px"><span class="muted text-small">Бюджет: 16 попыток + финальная проверка</span>${button(runtime.online ? "Уменьшить вход" : "Сохранённый контрпример", "run-reducer", { icon: "target", variant: "primary", className: "small" })}</div>`;
  if (!result)
    return panel(
      "Delta debugging",
      controls +
        notice(
          "Сокращение сохраняет различие наблюдаемого поведения. Оно ограничено бюджетом и не гарантирует глобально минимальный вход.",
          "info",
          "target",
        ),
      { icon: "target" },
    );
  return (
    panel("Delta debugging", controls, { icon: "target" }) +
    '<div style="height:17px"></div>' +
    `${result.recorded ? notice("Записанное уменьшение для намеренно изменённого примера, а не текущих произвольных исходников.", "warning", "eye") + '<div style="height:15px"></div>' : ""}<div class="reduction-grid"><div class="reduction-card"><div class="eyebrow">ИСХОДНЫЙ ВХОД</div><div class="reduction-size">${result.beforeLength}<small class="muted" style="font-size:11px;letter-spacing:0;margin-left:8px">элементов</small></div><pre>${e(result.originalInput)}</pre></div><div class="reduction-card accent"><div class="eyebrow">СОКРАЩЁННЫЙ ВХОД</div><div class="reduction-size text-lime">${result.afterLength}<small class="muted" style="font-size:11px;letter-spacing:0;margin-left:8px">элементов</small></div><pre>${e(result.minimalInput)}</pre></div></div>${panel("След уменьшения", `<div class="reduction-trace">${result.trace.map((step) => `<div class="reduction-step">${icon(step.retained ? "check" : "close", step.retained ? "text-green" : "muted", 13)}<span>${e(step.operation)}</span><span>n=${step.length}</span></div>`).join("")}</div><p class="muted text-tiny">${e(result.note)}</p>`, { icon: "history", actions: badge(`${result.attempts}/${result.budget} attempts`, "neutral") })}`
  );
}
