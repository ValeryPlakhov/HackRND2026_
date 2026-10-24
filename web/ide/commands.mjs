export const COMMANDS = [
  {
    id: "open-folder",
    label: "Открыть папку проекта…",
    detail: "Файл",
    shortcut: "Ctrl O",
    icon: "folder",
  },
  {
    id: "new-project",
    label: "Создать Java-проект…",
    detail: "Файл",
    shortcut: "Ctrl Shift N",
    icon: "plus",
  },
  {
    id: "new-file",
    label: "Создать файл…",
    detail: "Проект",
    icon: "file",
    project: true,
  },
  {
    id: "new-folder",
    label: "Создать папку…",
    detail: "Проект",
    icon: "folder",
    project: true,
  },
  {
    id: "quick-open",
    label: "Быстро открыть файл…",
    detail: "Переход",
    shortcut: "Ctrl P",
    icon: "search",
    project: true,
  },
  {
    id: "save",
    label: "Сохранить текущий файл",
    detail: "Файл",
    shortcut: "Ctrl S",
    icon: "download",
    document: true,
  },
  {
    id: "save-all",
    label: "Сохранить все файлы",
    detail: "Файл",
    shortcut: "Ctrl Shift S",
    icon: "download",
    project: true,
  },
  {
    id: "close-tab",
    label: "Закрыть текущую вкладку",
    detail: "Файл",
    shortcut: "Ctrl W",
    icon: "close",
    document: true,
  },
  {
    id: "reopen-tab",
    label: "Вернуть закрытую вкладку",
    detail: "Файл",
    shortcut: "Ctrl Shift T",
    icon: "history",
    project: true,
  },
  {
    id: "close-project",
    label: "Закрыть проект",
    detail: "Файл",
    icon: "folder",
    project: true,
  },
  {
    id: "analyse",
    label: "Обновить блупринт",
    detail: "Java",
    icon: "loop",
    java: true,
  },
  {
    id: "view-blueprint",
    label: "Показать только блупринт",
    detail: "Вид",
    icon: "graph",
    java: true,
  },
  {
    id: "view-split",
    label: "Показать код и блупринт вместе",
    detail: "Вид",
    icon: "split",
    java: true,
  },
  {
    id: "view-code",
    label: "Показать только код",
    detail: "Вид",
    icon: "code",
    document: true,
  },
  {
    id: "search",
    label: "Поиск по проекту",
    detail: "Поиск",
    shortcut: "Ctrl Shift F",
    icon: "search",
    project: true,
  },
  {
    id: "find",
    label: "Найти в текущем файле",
    detail: "Поиск",
    shortcut: "Ctrl F",
    icon: "search",
    document: true,
  },
  {
    id: "goto-line",
    label: "Перейти к строке…",
    detail: "Переход",
    shortcut: "Ctrl G",
    icon: "arrow",
    document: true,
  },
  {
    id: "outline",
    label: "Показать структуру Java-файла",
    detail: "Переход",
    icon: "layers",
    java: true,
  },
  {
    id: "overview",
    label: "Обзор Java-проекта",
    detail: "Проект",
    icon: "chart",
    project: true,
  },
  {
    id: "run",
    label: "Сохранить и запустить Java",
    detail: "Запуск",
    shortcut: "F5",
    icon: "play",
    project: true,
  },
  {
    id: "compile",
    label: "Проверить сборку проекта",
    detail: "Запуск",
    shortcut: "Ctrl F9",
    icon: "check",
    project: true,
  },
  {
    id: "stop",
    label: "Остановить задачу",
    detail: "Запуск",
    shortcut: "Shift F5",
    icon: "close",
    project: true,
  },
  {
    id: "run-config",
    label: "Параметры запуска и stdin",
    detail: "Запуск",
    icon: "settings",
    project: true,
  },
  {
    id: "show-problems",
    label: "Показать проблемы",
    detail: "Вид",
    icon: "warning",
    project: true,
  },
  {
    id: "toggle-sidebar",
    label: "Показать или скрыть дерево файлов",
    detail: "Вид",
    shortcut: "Ctrl B",
    icon: "folder",
  },
  {
    id: "toggle-panel",
    label: "Показать или скрыть нижнюю панель",
    detail: "Вид",
    shortcut: "Ctrl J",
    icon: "terminal",
  },
  {
    id: "history",
    label: "Локальная история текущего файла",
    detail: "Файл",
    icon: "history",
    document: true,
  },
  {
    id: "git",
    label: "Изменения Git",
    detail: "Проект",
    icon: "diff",
    project: true,
  },
  {
    id: "rename-file",
    label: "Переименовать файл…",
    detail: "Файл",
    icon: "edit",
    document: true,
  },
  {
    id: "reveal-file",
    label: "Показать файл в проводнике",
    detail: "Файл",
    icon: "external",
    document: true,
  },
  {
    id: "download-file",
    label: "Экспортировать текущий файл",
    detail: "Файл",
    icon: "download",
    document: true,
  },
  {
    id: "comment",
    label: "Переключить комментарий строк",
    detail: "Редактор",
    shortcut: "Ctrl /",
    icon: "code",
    document: true,
  },
  {
    id: "duplicate-line",
    label: "Дублировать строку",
    detail: "Редактор",
    shortcut: "Alt Shift ↓",
    icon: "layers",
    document: true,
  },
  {
    id: "sort-lines",
    label: "Отсортировать выделенные строки",
    detail: "Редактор",
    icon: "down",
    document: true,
  },
  {
    id: "trim-whitespace",
    label: "Удалить пробелы в конце строк",
    detail: "Редактор",
    icon: "code",
    document: true,
  },
  {
    id: "bracket",
    label: "Перейти к парной скобке",
    detail: "Редактор",
    icon: "code",
    document: true,
  },
  {
    id: "complete",
    label: "Показать шаблоны Java",
    detail: "Редактор",
    shortcut: "Ctrl Space",
    icon: "sparkle",
    java: true,
  },
  {
    id: "undo",
    label: "Отменить изменение кода",
    detail: "Редактор",
    shortcut: "Ctrl Z",
    icon: "undo",
    document: true,
  },
  {
    id: "redo",
    label: "Повторить изменение кода",
    detail: "Редактор",
    shortcut: "Ctrl Shift Z",
    icon: "redo",
    document: true,
  },
  { id: "languages", label: "Язык блупринтов", detail: "IDE", icon: "code" },
  {
    id: "settings",
    label: "Настройки IDE",
    detail: "IDE",
    shortcut: "Ctrl ,",
    icon: "settings",
  },
  { id: "shortcuts", label: "Горячие клавиши", detail: "Помощь", icon: "info" },
  {
    id: "quality-analyse",
    label: "Анализ проекта: дефекты, Big O, декомпозиция",
    detail: "Анализ",
    shortcut: "Ctrl Shift A",
    icon: "target",
    project: true,
  },
  {
    id: "improve",
    label: "Улучшения и декомпозиция текущего файла",
    detail: "Анализ",
    shortcut: "Ctrl Shift I",
    icon: "sparkle",
    java: true,
  },
  {
    id: "verify",
    label: "Проверить поведение против эталона",
    detail: "Проверка",
    shortcut: "F6",
    icon: "shield",
    project: true,
  },
  {
    id: "verify-open",
    label: "Тестовые входы и результаты проверки",
    detail: "Проверка",
    icon: "table",
    project: true,
  },
  {
    id: "baseline-set-current",
    label: "Сделать текущую версию эталоном",
    detail: "Проверка",
    icon: "bookmark",
    project: true,
  },
  {
    id: "baseline-diff",
    label: "Показать изменения относительно эталона",
    detail: "Проверка",
    icon: "diff",
    project: true,
  },
  {
    id: "export-evidence",
    label: "Экспортировать отчёт о проверке (ZIP)",
    detail: "Проверка",
    icon: "download",
    project: true,
  },
  {
    id: "lab-mutation",
    label: "Мутационное тестирование выбранного метода",
    detail: "Проверка",
    icon: "beaker",
    java: true,
  },
  {
    id: "extract-method",
    label: "Вынести выбранный метод в отдельный класс",
    detail: "Анализ",
    icon: "layers",
    java: true,
  },
  {
    id: "export-project",
    label: "Скачать проект ZIP (с несохранёнными правками)",
    detail: "Файл",
    icon: "download",
    project: true,
  },
  {
    id: "open-example",
    label: "Открыть пример монолита",
    detail: "Файл",
    icon: "rocket",
  },
  { id: "about", label: "О Blueprints IDE", detail: "Помощь", icon: "info" },
];

export function availableCommands({ project, document }) {
  return COMMANDS.filter(
    (command) =>
      (!command.project || project) &&
      (!command.document || document) &&
      (!command.java || document?.language === "java"),
  );
}

export function shortcutCommand(event) {
  const control = event.ctrlKey || event.metaKey;
  const key = event.key.toLocaleLowerCase();
  if (event.key === "F5") return event.shiftKey ? "stop" : "run";
  if (event.key === "F6") return "verify";
  if (control && event.key === "F9") return "compile";
  if (!control || event.altKey) return null;
  if (key === "o") return "open-folder";
  if (key === "s") return event.shiftKey ? "save-all" : "save";
  if (key === "p") return event.shiftKey ? "palette" : "quick-open";
  if (key === "k") return "palette";
  if (key === "f" && event.shiftKey) return "search";
  if (key === "a" && event.shiftKey) return "quality-analyse";
  if (key === "i" && event.shiftKey) return "improve";
  if (key === "g") return "goto-line";
  if (key === "w") return "close-tab";
  if (key === "t" && event.shiftKey) return "reopen-tab";
  if (key === "n" && event.shiftKey) return "new-project";
  if (key === "b") return "toggle-sidebar";
  if (key === "j") return "toggle-panel";
  if (key === ",") return "settings";
  if (key === "tab") return event.shiftKey ? "previous-tab" : "next-tab";
  return null;
}
