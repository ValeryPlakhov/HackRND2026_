import { escapeHtml as e } from "../lib/core.mjs";
import { icon } from "../lib/icons.mjs";
import { sectionHeading, button, badge } from "../components/primitives.mjs";

export function presentationSlides(workspace, runtime) {
  const state = workspace.state;
  const stats = state.project?.stats ?? {};
  return [
    {
      eyebrow: "01 / THE PROBLEM",
      title: "Изменить Java-монолит. Сохранить его поведение.",
      body: "Blueprints связывает настоящий AST, визуальную модель и реальные запуски. Каждое преобразование становится проверяемым решением.",
      proof: [
        [stats.lines ?? "—", "строк в проекте"],
        [stats.methods ?? "—", "методов в AST"],
        ["JDK 21", "стандартная семантика"],
      ],
      action: ["Показать граф", "navigate", { view: "canvas" }],
      notes:
        "Покажите исходник и список методов. Объясните, что сложные конструкции сохраняются в Java, а граф служит структурной проекцией.",
    },
    {
      eyebrow: "02 / UNDERSTAND",
      title: "Диагноз привязан к строке. И к узлу графа.",
      body: "Циклы, ветвления, данные и вызовы становятся видимыми. Оценка сложности сопровождается объяснениями и явными допущениями.",
      proof: [
        [stats.findings ?? "—", "точек внимания"],
        [stats.branches ?? "—", "структурных ветвлений"],
        ["UTF-16", "точные source spans"],
      ],
      action: ["Открыть диагностику", "navigate", { view: "insights" }],
      notes:
        "Откройте countPairs. Кликните рекомендацию и покажите соответствующий код. Укажите, что Big O не учитывает неизвестную стоимость вызовов.",
    },
    {
      eyebrow: "03 / REFACTOR",
      title: "Патч, который можно прочитать до применения.",
      body: "Планы привязаны к хешу исходника. Они содержат diff, причину применимости и цену по памяти. Устаревшие и пересекающиеся планы отклоняются.",
      proof: [
        ["5", "семейств преобразований"],
        ["SHA-256", "идентичность исходника"],
        ["Review", "до изменения кода"],
      ],
      action: ["Показать предложения", "navigate", { view: "changes" }],
      notes:
        "Примените индекс частот. Объясните сумму квадратов частот, самопары и сохранение модульной int-арифметики.",
    },
    {
      eyebrow: "04 / VERIFY",
      title: "Проверяется результат. Не обещание.",
      body: "Обе версии компилируются независимо. Каждый вход запускается в новой JVM. Сравниваются исходные байты stdout, stderr и код завершения.",
      proof: [
        [
          state.report
            ? `${state.report.tests.filter((test) => test.passed).length}/${state.report.tests.length}`
            : "—",
          "тестовых входов",
        ],
        ["2.5 s", "лимит local run"],
        ["64 KiB", "лимит каждого потока"],
      ],
      action: [
        runtime.online ? "Запустить quality gate" : "Показать записанный gate",
        "run-compare",
        {},
      ],
      notes:
        "Покажите PASS. Затем намеренно измените n == 0 на n == 1 и получите FAIL. Конечные тесты не являются универсальным доказательством эквивалентности.",
    },
    {
      eyebrow: "05 / GO DEEPER",
      title: "Проверяем сами тесты. Уменьшаем контрпример.",
      body: "Mutation lab показывает изменения, которые набор входов пропустил. Delta debugging сокращает вход, сохраняя найденное различие.",
      proof: [
        [
          state.mutations?.score != null ? `${state.mutations.score}%` : "—",
          "mutation score",
        ],
        [
          state.reduction
            ? `${state.reduction.beforeLength} → ${state.reduction.afterLength}`
            : "n → n′",
          "элементов контрпримера",
        ],
        ["Seed", "воспроизводимые входы"],
      ],
      action: ["Открыть Test Lab", "navigate", { view: "tests" }],
      notes:
        "Расскажите о выживших эквивалентных мутантах и ограниченном бюджете уменьшения. Не выдавайте mutation score за покрытие кода.",
    },
    {
      eyebrow: "06 / MEASURE & DELIVER",
      title: "Артефакты, которые можно воспроизвести.",
      body: "Микробенчмарк измеряет метод внутри JVM. Evidence bundle содержит эталон, кандидат, входы, отчёт, patch и manifest идентичности исходников.",
      proof: [
        ["3", "warmup calls"],
        ["5", "измерений / размер"],
        ["ZIP", "исходники и evidence"],
      ],
      action: ["Экспортировать evidence", "export", {}],
      notes:
        "Покажите README и реальные тестовые отчёты. Отделите протестированный local runner от непроверенного здесь Docker-пути. Хеши — идентификаторы содержимого, не цифровая подпись.",
    },
  ];
}

export function renderPresentation(workspace, runtime, ui) {
  const slides = presentationSlides(workspace, runtime);
  const index = Math.max(
    0,
    Math.min(slides.length - 1, ui.presentationSlide ?? 0),
  );
  const slide = slides[index];
  const [label, action, data] = slide.action;
  return (
    sectionHeading(
      "TELL THE ENGINEERING STORY",
      "Режим защиты.",
      "Шесть шагов от проблемы к воспроизводимому результату.",
      badge(`${index + 1} / ${slides.length}`, "accent"),
    ) +
    `<section class="presentation-stage"><div class="eyebrow text-lime">${e(slide.eyebrow)}</div><h2>${e(slide.title)}</h2><p>${e(slide.body)}</p><div class="presentation-proof">${slide.proof.map(([value, description]) => `<div><strong>${e(value)}</strong><small>${e(description)}</small></div>`).join("")}</div>${button(label, action, { variant: "primary", icon: "arrow", data })}</section><div class="presentation-controls">${button("Назад", "presentation-previous", { variant: "ghost", disabled: index === 0 })}<div class="presentation-dots">${slides.map((_, position) => `<button class="${position === index ? "active" : ""}" data-action="presentation-slide" data-index="${position}" aria-label="Слайд ${position + 1}"></button>`).join("")}</div>${button("Далее", "presentation-next", { trailing: "arrow", disabled: index === slides.length - 1 })}</div><div class="presentation-notes"><span class="eyebrow">ЗАМЕТКИ ДЛЯ ВЫСТУПАЮЩЕГО</span><br>${e(slide.notes)}</div>`
  );
}
