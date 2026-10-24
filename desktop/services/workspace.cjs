"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { TextDecoder } = require("node:util");
const { EventEmitter } = require("node:events");
const {
  IdeError,
  ensure,
  relative,
  sha,
  stamp,
  inside,
  EXCLUDED,
  isTextFile,
  languageOf,
} = require("./contracts.cjs");

const MAX_FILE = 2 * 1024 * 1024;
const MAX_FILES = 10000;
const MAX_DEPTH = 32;

class Workspace extends EventEmitter {
  constructor(options = {}) {
    super();
    this.root = null;
    this.id = null;
    this.generation = 0;
    this.history = options.history ?? null;
    this.watcher = null;
    this.watchTimer = null;
    this.pendingChanges = new Set();
    this.writeQueue = Promise.resolve();
  }

  async open(directory) {
    ensure(
      typeof directory === "string" && path.isAbsolute(directory),
      "PATH",
      "Выберите папку проекта",
    );
    const canonical = await fs.realpath(directory);
    const info = await fs.stat(canonical);
    ensure(info.isDirectory(), "PATH", "Выбранный путь не является папкой");
    this.close();
    this.root = canonical;
    this.id = crypto.randomUUID();
    this.generation++;
    this.watch();
    return this.describe();
  }

  close() {
    this.watcher?.close();
    this.watcher = null;
    clearTimeout(this.watchTimer);
    this.pendingChanges.clear();
    this.root = null;
    this.id = null;
    this.generation++;
  }

  require(id) {
    ensure(
      this.root && this.id,
      "NO_PROJECT",
      "Сначала откройте папку проекта",
    );
    ensure(
      id === this.id,
      "STALE_PROJECT",
      "Запрос относится к уже закрытому проекту",
    );
    return { root: this.root, id: this.id, generation: this.generation };
  }

  current(snapshot) {
    ensure(
      snapshot.id === this.id && snapshot.generation === this.generation,
      "STALE_PROJECT",
      "Проект был переключён во время операции",
    );
  }

  async resolve(value, options = {}) {
    const snapshot = this.require(options.id ?? this.id);
    const rel = relative(value, options.allowRoot === true);
    const absolute = path.resolve(snapshot.root, ...rel.split("/"));
    ensure(
      inside(snapshot.root, absolute),
      "PATH",
      "Путь находится вне проекта",
    );
    let cursor = snapshot.root;
    const parts = rel ? rel.split("/") : [];
    for (let index = 0; index < parts.length; index++) {
      cursor = path.join(cursor, parts[index]);
      try {
        const stat = await fs.lstat(cursor);
        ensure(
          !stat.isSymbolicLink(),
          "SYMLINK",
          "Символические ссылки внутри проекта доступны только как элементы дерева",
        );
        if (index < parts.length - 1)
          ensure(
            stat.isDirectory(),
            "PATH",
            "Родитель пути не является папкой",
          );
      } catch (error) {
        if (
          error.code === "ENOENT" &&
          options.missing &&
          index === parts.length - 1
        )
          break;
        throw error;
      }
    }
    this.current(snapshot);
    return { absolute, relative: rel, snapshot };
  }

  async describe() {
    const snapshot = this.require(this.id);
    const entries = await fs.readdir(snapshot.root, { withFileTypes: true });
    this.current(snapshot);
    const names = entries.map((item) => item.name);
    const buildSystem = names.includes("pom.xml")
      ? "maven"
      : names.some((name) => /^build\.gradle(?:\.kts)?$/.test(name))
        ? "gradle"
        : "plain";
    return {
      id: snapshot.id,
      name: path.basename(snapshot.root),
      root: snapshot.root,
      buildSystem,
      openedAt: stamp(),
      git: names.includes(".git"),
      platform: process.platform,
      limits: {
        maxFileBytes: MAX_FILE,
        maxFiles: MAX_FILES,
        maxDepth: MAX_DEPTH,
      },
      capabilities: {
        read: true,
        write: true,
        folderPicker: true,
        java: true,
        otherLanguages: false,
      },
    };
  }

  async list(id, directory = "") {
    const target = await this.resolve(directory, { id, allowRoot: true });
    const entries = await fs.readdir(target.absolute, { withFileTypes: true });
    this.current(target.snapshot);
    return entries
      .filter(
        (item) =>
          !EXCLUDED.has(item.name) &&
          !item.name.startsWith(".blueprints-write-"),
      )
      .map((item) => ({
        name: item.name,
        path: directory ? `${directory}/${item.name}` : item.name,
        kind: item.isSymbolicLink()
          ? "link"
          : item.isDirectory()
            ? "directory"
            : "file",
        editable: item.isFile() && isTextFile(item.name),
        language: languageOf(item.name),
      }))
      .sort(
        (a, b) =>
          (a.kind === "directory" ? 0 : 1) - (b.kind === "directory" ? 0 : 1) ||
          a.name.localeCompare(b.name, "en", { numeric: true }),
      );
  }

  async scan(id, options = {}) {
    const snapshot = this.require(id);
    const files = [];
    const omitted = [];
    let limited = false;
    const visit = async (directory, depth) => {
      this.current(snapshot);
      if (depth > MAX_DEPTH || files.length >= MAX_FILES) {
        limited = true;
        return;
      }
      let entries;
      try {
        entries = await fs.readdir(path.join(snapshot.root, directory), {
          withFileTypes: true,
        });
      } catch (error) {
        omitted.push({ path: directory, reason: error.code ?? "ACCESS" });
        return;
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const item of entries) {
        this.current(snapshot);
        if (files.length >= MAX_FILES) {
          limited = true;
          break;
        }
        if (
          EXCLUDED.has(item.name) ||
          item.name.startsWith(".blueprints-write-")
        )
          continue;
        const rel = directory ? `${directory}/${item.name}` : item.name;
        if (item.isSymbolicLink()) {
          omitted.push({ path: rel, reason: "SYMLINK" });
          continue;
        }
        if (item.isDirectory()) await visit(rel, depth + 1);
        else if (item.isFile() && (!options.textOnly || isTextFile(item.name)))
          files.push({
            path: rel,
            name: item.name,
            language: languageOf(item.name),
            editable: isTextFile(item.name),
          });
      }
    };
    await visit("", 0);
    return {
      files,
      omitted: omitted.slice(0, 100),
      limited,
      total: files.length,
      generation: snapshot.generation,
    };
  }

  async read(id, file) {
    const target = await this.resolve(file, { id });
    const handle = await fs.open(target.absolute, "r");
    try {
      const info = await handle.stat();
      ensure(info.isFile(), "NOT_FILE", "Выберите текстовый файл");
      ensure(
        info.size <= MAX_FILE,
        "FILE_SIZE",
        "Редактор открывает файлы не больше 2 МиБ",
      );
      const bytes = await handle.readFile();
      ensure(
        bytes.length <= MAX_FILE,
        "FILE_SIZE",
        "Файл увеличился во время чтения",
      );
      ensure(
        !bytes.subarray(0, 8192).includes(0),
        "BINARY",
        "Это бинарный файл",
      );
      let content;
      try {
        content = new TextDecoder("utf-8", {
          fatal: true,
          ignoreBOM: false,
        }).decode(bytes);
      } catch {
        throw new IdeError(
          "ENCODING",
          "Поддерживается UTF-8. Сначала преобразуйте кодировку файла.",
        );
      }
      this.current(target.snapshot);
      const bom =
        bytes.length >= 3 &&
        bytes[0] === 239 &&
        bytes[1] === 187 &&
        bytes[2] === 191;
      return {
        path: target.relative,
        content,
        hash: sha(bytes),
        bytes: bytes.length,
        modifiedAt: info.mtime.toISOString(),
        language: languageOf(file),
        eol: content.includes("\r\n") ? "CRLF" : "LF",
        bom,
        encoding: "UTF-8",
        readOnly: false,
      };
    } finally {
      await handle.close();
    }
  }

  serialize(operation) {
    const next = this.writeQueue.then(operation, operation);
    this.writeQueue = next.catch(() => {});
    return next;
  }

  async write(id, request) {
    return this.serialize(async () => {
      ensure(
        typeof request.content === "string" &&
          Buffer.byteLength(request.content, "utf8") <= MAX_FILE,
        "FILE_SIZE",
        "Содержимое слишком большое",
      );
      const target = await this.resolve(request.path, { id, missing: true });
      let previous = null;
      try {
        const stat = await fs.stat(target.absolute);
        ensure(
          stat.isFile() && stat.size <= MAX_FILE,
          "FILE_SIZE",
          "Существующий файл слишком большой для редактора",
        );
        previous = await fs.readFile(target.absolute);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      const actualHash = previous === null ? null : sha(previous);
      ensure(
        request.expectedHash === actualHash,
        "CONFLICT",
        "Файл изменён другой программой. Сравните версии перед сохранением.",
        { path: target.relative, actualHash },
      );
      if (previous !== null && this.history)
        await this.history.capture(
          target.snapshot.root,
          target.relative,
          previous,
          "before-save",
        );
      const bytes = Buffer.from(
        (request.bom ? "\ufeff" : "") + request.content.replace(/^\ufeff/, ""),
        "utf8",
      );
      const temp = path.join(
        path.dirname(target.absolute),
        `.blueprints-write-${crypto.randomUUID()}.tmp`,
      );
      let handle;
      try {
        handle = await fs.open(temp, "wx");
        await handle.writeFile(bytes);
        await handle.sync();
        await handle.close();
        handle = null;
        this.current(target.snapshot);
        let check = null;
        try {
          check = sha(await fs.readFile(target.absolute));
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        ensure(
          check === actualHash,
          "CONFLICT",
          "Файл изменился во время сохранения. Ваша версия остаётся в редакторе.",
          { path: target.relative, actualHash: check },
        );
        await fs.rename(temp, target.absolute);
      } finally {
        await handle?.close();
        await fs.unlink(temp).catch(() => {});
      }
      this.current(target.snapshot);
      const info = await fs.stat(target.absolute);
      return {
        path: target.relative,
        hash: sha(bytes),
        bytes: bytes.length,
        modifiedAt: info.mtime.toISOString(),
      };
    });
  }

  async create(id, request) {
    return this.serialize(async () => {
      const target = await this.resolve(request.path, { id, missing: true });
      if (request.kind === "directory") {
        await fs.mkdir(target.absolute);
      } else {
        ensure(request.kind === "file", "ARGUMENT", "Выберите файл или папку");
        const content =
          typeof request.content === "string" ? request.content : "";
        ensure(
          Buffer.byteLength(content) <= MAX_FILE,
          "FILE_SIZE",
          "Содержимое слишком большое",
        );
        await fs.writeFile(target.absolute, content, {
          encoding: "utf8",
          flag: "wx",
        });
      }
      return { path: target.relative, kind: request.kind };
    });
  }

  async rename(id, request) {
    return this.serialize(async () => {
      const source = await this.resolve(request.path, { id });
      const destination = await this.resolve(request.to, { id, missing: true });
      ensure(
        source.relative !== destination.relative,
        "PATH",
        "Имя не изменилось",
      );
      ensure(
        !inside(source.absolute, destination.absolute),
        "PATH",
        "Нельзя переместить папку в саму себя",
      );
      let exists = false;
      try {
        await fs.lstat(destination.absolute);
        exists = true;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      ensure(!exists, "EXISTS", "Файл или папка с таким именем уже существует");
      this.current(source.snapshot);
      await fs.rename(source.absolute, destination.absolute);
      return { path: source.relative, to: destination.relative };
    });
  }

  async prepareTrash(id, file) {
    const target = await this.resolve(file, { id });
    ensure(target.relative !== "", "PATH", "Нельзя удалить корень проекта");
    const info = await fs.stat(target.absolute);
    if (info.isFile() && info.size <= MAX_FILE && this.history) {
      await this.history.capture(
        target.snapshot.root,
        target.relative,
        await fs.readFile(target.absolute),
        "before-trash",
      );
    }
    return target;
  }

  watch() {
    try {
      const nodeFs = require("node:fs");
      const generation = this.generation;
      this.watcher = nodeFs.watch(
        this.root,
        { recursive: true },
        (event, filename) => {
          if (!filename || generation !== this.generation) return;
          const name = String(filename).replaceAll("\\", "/");
          if (
            name
              .split("/")
              .some(
                (part) =>
                  EXCLUDED.has(part) || part.startsWith(".blueprints-write-"),
              )
          )
            return;
          this.pendingChanges.add(name);
          clearTimeout(this.watchTimer);
          this.watchTimer = setTimeout(() => {
            const paths = [...this.pendingChanges].slice(0, 200);
            this.pendingChanges.clear();
            this.emit("change", { id: this.id, paths, event, time: stamp() });
          }, 220);
        },
      );
      this.watcher.on("error", (error) =>
        this.emit("watch-error", { message: error.message }),
      );
    } catch (error) {
      this.emit("watch-error", { message: error.message });
    }
  }
}

module.exports = { Workspace, MAX_FILE, MAX_FILES, MAX_DEPTH };
