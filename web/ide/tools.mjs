// «Инструменты»: one place that lists everything the IDE can do, grouped by the job it serves.
import { escapeHtml as e } from "./core.mjs";
import { glyph } from "./views.mjs";

const ws = (workspace, label, hint, icon, shortcut) => ({ action: "workspace", data: { workspace }, label, hint, icon, shortcut, needs: "project" });

export const TOOL_GROUPS = [
  {
    id: "view", title: "Рабочее пространство",
    items: [
      { action: "view-blueprint", label: "Только схема", hint: "Отдать рабочую область графу выбранного метода", icon: "graph", needs: "method" },
      { action: "view-split", label: "Код и схема рядом", hint: "Следить за Java при изменении блоков", icon: "split", needs: "method" },
      { action: "view-code", label: "Только код", hint: "Редактировать исходную Java", icon: "code", needs: "method" },
      { action: "focus-workspace", label: "Режим фокуса", hint: "Скрыть файлы и вывод; Escape возвращает панели", icon: "graph", needs: "method" },
      { action: "toggle-sidebar", label: "Файлы: показать / скрыть", hint: "Освободить место для кода и схемы", icon: "folder", needs: "method" },
      { action: "toggle-panel", label: "Вывод: показать / скрыть", hint: "Результаты запуска и ошибки компиляции", icon: "terminal", needs: "project" },
    ],
  },
  {
    id: "understand",
    title: "Понять код",
    items: [
      ws("overview", "Карта проекта", "Точка входа, путь данных, дерево вызовов, с чего начать", "nodes", "Alt 1"),
      ws("method", "Логика метода", "Схема шагов рядом с кодом, кто вызывает метод и что он вызывает", "method", "Alt 2"),
      { action: "sidebar", data: { view: "outline" }, label: "Структура файла", hint: "Классы и методы открытого файла", icon: "layers", needs: "java" },
      { action: "sidebar", data: { view: "search" }, label: "Поиск по проекту", hint: "Текст и замена с предпросмотром", icon: "search", shortcut: "Ctrl Shift F", needs: "project" },
    ],
  },
  {
    id: "fix",
    title: "Исправить",
    items: [
      ws("tasks", "Риски и исправления", "Что исправить в первую очередь, исправление одной кнопкой", "target", "Alt 3"),
      { action: "ws-build", label: "Собрать метод из блоков", hint: "Новый метод: блоки и провода сразу становятся Java", icon: "plus", needs: "project" },
      { action: "extract-method", label: "Вынести метод в класс", hint: "Выбранный static-метод переедет в новый класс, останется делегат", icon: "layers", needs: "method" },
    ],
  },
  {
    id: "check",
    title: "Проверить",
    items: [
      ws("verify", "Проверка поведения", "Исходная версия, ваши изменения, тестовые входы и результат", "shield", "Alt 4"),
      { action: "verify", label: "Сравнить с исходной версией", hint: "Запустить обе версии на всех входах: stdout, stderr, код завершения", icon: "play", shortcut: "F6", needs: "project" },
      { action: "lab-mutation", label: "Качество тестов", hint: "Вносит в метод мелкие поломки и смотрит, заметят ли их входы", icon: "flask", needs: "method" },
      { action: "baseline-diff", label: "Отличия от исходной версии", hint: "Что изменилось с момента, когда зафиксирована исходная версия", icon: "diff", needs: "project" },
      { action: "baseline-set-current", label: "Считать текущую версию исходной", hint: "Дальше сравнивать с тем, что сейчас в редакторе", icon: "bookmark", needs: "project" },
      { action: "export-evidence", label: "Отчёт о проверке", hint: "ZIP: исходная версия, новая версия, входы, результаты", icon: "download", needs: "project" },
    ],
  },
  {
    id: "run",
    title: "Запуск",
    items: [
      { action: "run", label: "Запустить", hint: "Сохранить, собрать и выполнить main", icon: "play", shortcut: "F5", needs: "project" },
      { action: "compile", label: "Проверить сборку", hint: "javac без запуска", icon: "check", shortcut: "Ctrl F9", needs: "project" },
      { action: "run-config", label: "Параметры запуска", hint: "Главный класс и стандартный ввод", icon: "settings", needs: "project" },
      { action: "show-problems", label: "Проблемы", hint: "Ошибки компиляции и синтаксиса со строками", icon: "warning", needs: "project" },
    ],
  },
  {
    id: "project",
    title: "Проект",
    items: [
      { action: "open-folder", label: "Открыть папку", hint: "Папка на диске: изменения сохраняются в неё", icon: "folder", shortcut: "Ctrl O" },
      { action: "open-example", label: "Пример монолита", hint: "Магазин на 878 строк с готовыми тестами", icon: "rocket", data: { example: "shop-monolith" } },
      { action: "new-project", label: "Новый проект", hint: "Пустой Java-проект в памяти страницы", icon: "plus" },
      { action: "new-file", label: "Новый файл", hint: "Создать файл в текущем проекте", icon: "file", needs: "project" },
      { action: "save-all", label: "Сохранить всё", hint: "Записать изменённые файлы", icon: "download", shortcut: "Ctrl Shift S", needs: "project" },
      { action: "export-project", label: "Скачать ZIP", hint: "Весь проект с несохранёнными правками", icon: "download", needs: "project" },
      { action: "history", label: "История файла", hint: "Прежние версии открытого файла", icon: "history", needs: "document" },
      { action: "close-project", label: "Закрыть проект", hint: "Вернуться на главный экран без проекта", icon: "close", needs: "project" },
    ],
  },
  {
    id: "help",
    title: "Справка",
    items: [
      { action: "learn-start", label: "Обучение по интерфейсу", hint: "Шесть шагов: карта, команды, метод, порты, исправления и тесты", icon: "rocket" },
      { action: "guide", label: "Руководство пользователя", hint: "Как работают блоки, проверка поведения и автоисправления", icon: "info" },
      { action: "shortcuts", label: "Горячие клавиши", hint: "Все сочетания", icon: "keyboard" },
      { action: "settings", label: "Настройки", hint: "Тема, шрифт и автоматический анализ", icon: "settings" },
      { action: "about", label: "О продукте", hint: "Версия, что входит и что нет", icon: "info" },
    ],
  },
];

const REASONS = {
  project: "Сначала откройте проект",
  java: "Откройте Java-файл",
  document: "Откройте файл",
  method: "Выберите метод в режиме «Метод»",
};

export function toolAvailable(item, state) {
  if (!item.needs) return true;
  if (item.needs === "project") return Boolean(state.project);
  if (item.needs === "document") return Boolean(state.project && state.document);
  if (item.needs === "java") return Boolean(state.project && state.document?.language === "java");
  if (item.needs === "method") return Boolean(state.project && state.method);
  return true;
}

function attributes(data = {}) {
  return Object.entries(data)
    .map(([key, value]) => `data-${key}="${e(value)}"`)
    .join(" ");
}

export function toolsMenuHtml(state, mode = "actions") {
  const groups = TOOL_GROUPS.filter(group => mode === "help" ? group.id === "help" : ["project", "fix", "check", "run"].includes(group.id));
  return `<div class="tools-groups ${mode === "help" ? "tools-help" : ""}">${groups.map(group => {
    const items = group.items.filter(item => item.action !== "workspace" && !(mode === "help" && item.action === "settings"));
    const buttons = items.map(item => {
      const enabled = toolAvailable(item, state);
      return `<button class="tool-item" data-action="${e(item.action)}" ${attributes(item.data)} ${enabled ? "" : "disabled"} title="${e(enabled ? item.hint : REASONS[item.needs] ?? "")}"><span class="tool-icon">${glyph(item.icon,17)}</span><span class="tool-text"><b>${e(item.label)}</b>${!enabled ? `<small>${e(REASONS[item.needs] ?? "")}</small>` : ""}</span>${item.shortcut ? `<kbd>${e(item.shortcut)}</kbd>` : ""}</button>`;
    }).join("");
    return mode === "help" ? `<section class="tool-group" data-group="help">${buttons}</section>` : `<details class="tool-group" name="ide-action-group" data-group="${group.id}" ${group.id === "project" ? "open" : ""}><summary>${e(group.title)}</summary>${buttons}</details>`;
  }).join("")}</div>`;
}

/** Hides tools that do not match the query and the groups left without tools. */
export function filterTools(menu, query) {
  const text = query.trim().toLocaleLowerCase();
  let shown = 0;
  for (const group of menu.querySelectorAll(".tool-group")) {
    let visible = 0;
    for (const item of group.querySelectorAll(".tool-item")) {
      const match = !text || item.dataset.search.includes(text);
      item.hidden = !match;
      if (match) visible++;
    }
    group.hidden = visible === 0;
    shown += visible;
  }
  const empty = menu.querySelector(".tools-empty");
  if (empty) empty.hidden = shown > 0;
  return shown;
}
