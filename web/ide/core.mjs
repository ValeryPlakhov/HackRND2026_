export const clamp = (value, minimum, maximum) =>
  Math.max(minimum, Math.min(maximum, value));
export const basename = (value) => String(value).split("/").at(-1) ?? "";
export const dirname = (value) =>
  String(value).split("/").slice(0, -1).join("/");
export const extension = (value) =>
  basename(value).includes(".")
    ? basename(value).split(".").at(-1).toLocaleLowerCase()
    : "";
export const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [
  ...root.querySelectorAll(selector),
];
export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class Signal {
  constructor() {
    this.listeners = new Set();
  }
  subscribe(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }
  emit(value) {
    for (const callback of [...this.listeners]) callback(value);
  }
  clear() {
    this.listeners.clear();
  }
}

export function debounce(callback, milliseconds = 250) {
  let timer;
  const debounced = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => callback(...args), milliseconds);
  };
  debounced.cancel = () => clearTimeout(timer);
  return debounced;
}

export function fuzzyScore(query, candidate) {
  if (!query) return 0;
  const needle = query.toLocaleLowerCase();
  const haystack = candidate.toLocaleLowerCase();
  const exact = haystack.indexOf(needle);
  if (exact >= 0) return 1000 - exact * 2 - haystack.length * 0.05;
  let cursor = 0;
  let score = 0;
  let previous = -2;
  for (const character of needle) {
    const found = haystack.indexOf(character, cursor);
    if (found < 0) return -Infinity;
    score += found === previous + 1 ? 8 : 1;
    if (found === 0 || /[\s/._-]/.test(haystack[found - 1])) score += 12;
    score -= (found - cursor) * 0.2;
    previous = found;
    cursor = found + 1;
  }
  return score - haystack.length * 0.01;
}

export function rankItems(items, query, label = (item) => item.label) {
  return items
    .map((item, index) => ({
      item,
      score: fuzzyScore(query, label(item)),
      index,
    }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.item);
}

export function lineOffsets(content) {
  const offsets = [0];
  for (let index = 0; index < content.length; index++)
    if (content[index] === "\n") offsets.push(index + 1);
  return offsets;
}

export function positionAt(content, offset, offsets = lineOffsets(content)) {
  const bounded = clamp(offset, 0, content.length);
  let low = 0;
  let high = offsets.length;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (offsets[middle] <= bounded) low = middle;
    else high = middle;
  }
  return { line: low + 1, column: bounded - offsets[low] + 1, offset: bounded };
}

export function offsetAt(
  content,
  line,
  column = 1,
  offsets = lineOffsets(content),
) {
  const row = clamp(Math.floor(line) - 1, 0, offsets.length - 1);
  const start = offsets[row];
  const end = row + 1 < offsets.length ? offsets[row + 1] - 1 : content.length;
  return clamp(start + Math.max(0, column - 1), start, end);
}

export function byteSize(value) {
  const bytes = Number(value);
  if (bytes < 1024) return bytes + " Б";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " КиБ";
  return (bytes / 1024 / 1024).toFixed(1) + " МиБ";
}

export function timeLabel(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : new Intl.DateTimeFormat("ru", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date);
}

export function download(name, text, type = "text/plain") {
  const blob = text instanceof Blob ? text : new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function languageOf(path) {
  return (
    {
      java: "java",
      js: "javascript",
      mjs: "javascript",
      ts: "typescript",
      py: "python",
      kt: "kotlin",
      go: "go",
      rs: "rust",
      cs: "csharp",
      cpp: "cpp",
      c: "c",
      json: "json",
      xml: "xml",
      html: "html",
      css: "css",
      md: "markdown",
    }[extension(path)] ?? "text"
  );
}

export function normalizeEol(content, eol) {
  const normalized = content.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  return eol === "CRLF" ? normalized.replaceAll("\n", "\r\n") : normalized;
}

export function readableError(error) {
  if (error?.code === "CONFLICT")
    return "Файл изменён снаружи. Откройте сравнение версий и выберите, какие изменения сохранить.";
  if (error?.name === "AbortError") return "Операция отменена";
  return String(error?.message ?? error ?? "Неизвестная ошибка");
}

export function safeRelative(value) {
  const path = String(value).replaceAll("\\", "/");
  if (
    !path ||
    /^[A-Za-z]:|^\//.test(path) ||
    path.includes("\0") ||
    path.includes(":")
  )
    throw new Error("Укажите путь внутри проекта");
  if (
    path
      .split("/")
      .some(
        (part) =>
          !part ||
          part === "." ||
          part === ".." ||
          /[<>:"|?*\u0000-\u001f]|[ .]$/.test(part),
      )
  )
    throw new Error("Недопустимый путь");
  return path;
}

export function nodeLabel(kind) {
  return (
    {
      entry: "Начало метода",
      exit: "Завершение",
      variable: "Сохранить значение",
      operation: "Действие",
      condition: "Проверить условие",
      loop: "Повторение",
      return: "Вернуть результат",
      throw: "Сообщить об ошибке",
      switch: "Выбрать вариант",
      try: "Попробовать",
      catch: "Обработать ошибку",
      break: "Завершить цикл",
      continue: "Следующая итерация",
      opaque: "Java-конструкция",
    }[kind] ?? kind
  );
}

export function describeNode(node) {
  switch (node.kind) {
    case "condition":
      return "Программа проверяет условие. Ветка «да» выполняется, если оно истинно; «нет» — в остальных случаях.";
    case "loop":
      return "Эта часть программы повторяет действия. Стрелка назад показывает переход к следующей итерации.";
    case "variable":
      return "В этом шаге программа создаёт переменную и запоминает в ней значение.";
    case "return":
      return "Метод заканчивает работу и передаёт результат тому, кто его вызвал.";
    case "entry":
      return "Здесь начинается выполнение выбранного метода. Аргументы приходят от вызывающего кода.";
    case "exit":
      return "Здесь выбранный метод завершает выполнение.";
    case "throw":
      return "Выполнение прерывается исключением. Обработчик может находиться в другом методе.";
    case "try":
      return "Начало блока с обработкой исключений. Пунктирные связи консервативны и не заменяют анализ JVM.";
    case "opaque":
      return "Конструкция сохранена как исходный Java-блок. IDE показывает её целиком, чтобы не потерять смысл.";
    default:
      return "Действие из исходного Java-файла. Нажмите «К строке», чтобы увидеть его в редакторе.";
  }
}
