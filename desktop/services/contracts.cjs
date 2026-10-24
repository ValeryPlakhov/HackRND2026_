"use strict";
const crypto = require("node:crypto");
const path = require("node:path");

class IdeError extends Error {
  constructor(code, message, detail = null) {
    super(message);
    this.name = "IdeError";
    this.code = code;
    this.detail = detail;
  }
}

function ensure(condition, code, message, detail) {
  if (!condition) throw new IdeError(code, message, detail);
}

function record(value, name = "Запрос") {
  ensure(
    value && typeof value === "object" && !Array.isArray(value),
    "ARGUMENT",
    `${name}: нужен объект`,
  );
  return value;
}

function text(value, name, maximum = 4096, allowEmpty = false) {
  ensure(typeof value === "string", "ARGUMENT", `${name}: нужна строка`);
  ensure(
    value.length <= maximum,
    "LIMIT",
    `${name}: превышен лимит ${maximum}`,
  );
  ensure(!value.includes("\0"), "ARGUMENT", `${name}: недопустимый символ`);
  ensure(
    allowEmpty || value.length > 0,
    "ARGUMENT",
    `${name}: пустое значение`,
  );
  return value;
}

function integer(value, name, minimum, maximum, fallback) {
  if (value === undefined && fallback !== undefined) return fallback;
  ensure(
    Number.isInteger(value) && value >= minimum && value <= maximum,
    "ARGUMENT",
    `${name}: диапазон ${minimum}…${maximum}`,
  );
  return value;
}

function relative(value, allowRoot = false) {
  text(value, "Путь", 1024, allowRoot);
  const normalized = value.replaceAll("\\", "/");
  ensure(
    !path.win32.isAbsolute(normalized) && !path.posix.isAbsolute(normalized),
    "PATH",
    "Нужен путь внутри проекта",
  );
  ensure(!normalized.includes(":"), "PATH", "Потоки NTFS не поддерживаются");
  const parts = normalized.split("/");
  if (allowRoot && normalized === "") return "";
  ensure(
    parts.every((part) => part && part !== "." && part !== ".."),
    "PATH",
    "Недопустимый относительный путь",
  );
  ensure(
    parts.every((part) => !/[<>:"|?*\u0000-\u001f]/.test(part)),
    "PATH",
    "Имя содержит запрещённые символы",
  );
  ensure(
    parts.every((part) => !/[ .]$/.test(part)),
    "PATH",
    "Имя не должно оканчиваться пробелом или точкой",
  );
  ensure(
    parts.every(
      (part) => !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
    ),
    "PATH",
    "Это системное имя Windows",
  );
  return parts.join("/");
}

function sha(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stamp() {
  return new Date().toISOString();
}

function publicError(error) {
  if (error instanceof IdeError)
    return { code: error.code, message: error.message, detail: error.detail };
  if (error?.code === "ENOENT")
    return {
      code: "MISSING",
      message: "Файл больше не существует. Обновите дерево проекта.",
    };
  if (error?.code === "EACCES" || error?.code === "EPERM")
    return {
      code: "ACCESS",
      message:
        "Нет доступа к файлу. Проверьте права и не открыт ли он в другой программе.",
    };
  if (error?.code === "ENOSPC")
    return { code: "DISK_FULL", message: "На диске закончилось место." };
  return {
    code: "INTERNAL",
    message: String(error?.message ?? error).slice(0, 1000),
  };
}

function inside(root, target) {
  const delta = path.relative(root, target);
  return (
    delta === "" ||
    (!delta.startsWith(`..${path.sep}`) &&
      delta !== ".." &&
      !path.isAbsolute(delta))
  );
}

const EXCLUDED = new Set([
  ".git",
  ".svn",
  ".hg",
  "node_modules",
  ".gradle",
  ".idea",
  ".runtime",
  "target",
  "build",
  "dist",
  "out",
  ".blueprints-cache",
  "__pycache__",
  ".next",
  ".venv",
  "venv",
  ".mvn-cache",
  ".DS_Store",
]);

const TEXT_EXTENSIONS = new Set([
  ".java",
  ".json",
  ".xml",
  ".gradle",
  ".kts",
  ".properties",
  ".yaml",
  ".yml",
  ".md",
  ".txt",
  ".gitignore",
  ".gitattributes",
  ".editorconfig",
  ".html",
  ".css",
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".jsx",
  ".py",
  ".kt",
  ".go",
  ".rs",
  ".c",
  ".h",
  ".cpp",
  ".cs",
  ".sql",
  ".sh",
  ".cmd",
  ".bat",
  ".ps1",
  ".toml",
  ".csv",
  ".svg",
  ".blueprint",
  ".log",
  ".fxml",
  ".iml",
  ".MF",
]);

function isTextFile(name) {
  const base = path.basename(name);
  return (
    TEXT_EXTENSIONS.has(path.extname(base).toLowerCase()) ||
    TEXT_EXTENSIONS.has(base) ||
    ["Dockerfile", "Makefile", "LICENSE", "README", "gradlew", "mvnw"].includes(
      base,
    )
  );
}

function languageOf(name) {
  const extension = path.extname(name).toLowerCase();
  return (
    {
      ".java": "java",
      ".js": "javascript",
      ".mjs": "javascript",
      ".ts": "typescript",
      ".py": "python",
      ".kt": "kotlin",
      ".go": "go",
      ".rs": "rust",
      ".cpp": "cpp",
      ".c": "c",
      ".cs": "csharp",
      ".json": "json",
      ".xml": "xml",
      ".html": "html",
      ".css": "css",
      ".md": "markdown",
    }[extension] ?? "text"
  );
}

module.exports = {
  IdeError,
  ensure,
  record,
  text,
  integer,
  relative,
  sha,
  stamp,
  publicError,
  inside,
  EXCLUDED,
  isTextFile,
  languageOf,
};
