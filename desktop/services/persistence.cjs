"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { ensure, sha, stamp } = require("./contracts.cjs");

const DEFAULT_SETTINGS = Object.freeze({
  theme: "light",
  fontSize: 14,
  tabSize: 4,
  wordWrap: false,
  showMinimap: false,
  autoAnalyse: true,
  graphDirection: "TB",
  restoreSession: true,
  reduceMotion: false,
  showWhitespace: false,
  formatOnSave: false,
  explorerWidth: 250,
  panelHeight: 220,
  editorView: "split",
  lastLanguage: "java",
});

function normalizeSettings(input) {
  const result = { ...DEFAULT_SETTINGS };
  if (!input || typeof input !== "object") return result;
  for (const key of [
    "wordWrap",
    "showMinimap",
    "autoAnalyse",
    "restoreSession",
    "reduceMotion",
    "showWhitespace",
    "formatOnSave",
  ]) {
    if (typeof input[key] === "boolean") result[key] = input[key];
  }
  if (["light", "dark", "system"].includes(input.theme))
    result.theme = input.theme;
  if (["TB", "LR"].includes(input.graphDirection))
    result.graphDirection = input.graphDirection;
  if (["split", "blueprint", "code"].includes(input.editorView))
    result.editorView = input.editorView;
  if (
    Number.isInteger(input.fontSize) &&
    input.fontSize >= 11 &&
    input.fontSize <= 24
  )
    result.fontSize = input.fontSize;
  if ([2, 4, 8].includes(input.tabSize)) result.tabSize = input.tabSize;
  if (Number.isFinite(input.explorerWidth))
    result.explorerWidth = Math.max(190, Math.min(420, input.explorerWidth));
  if (Number.isFinite(input.panelHeight))
    result.panelHeight = Math.max(130, Math.min(500, input.panelHeight));
  return result;
}

function normalizeProjectState(input) {
  const result = { baseline: null, cases: [] };
  if (!input || typeof input !== "object") return result;
  const baseline = input.baseline;
  if (baseline && typeof baseline === "object" && baseline.files) {
    const files = {};
    for (const [name, source] of Object.entries(baseline.files).slice(0, 300))
      if (
        typeof name === "string" &&
        name.endsWith(".java") &&
        name.length <= 400 &&
        typeof source === "string"
      )
        files[name] = source;
    if (Object.keys(files).length)
      result.baseline = {
        files,
        takenAt: typeof baseline.takenAt === "string" ? baseline.takenAt : null,
        label: typeof baseline.label === "string" ? baseline.label.slice(0, 120) : "",
      };
  }
  if (Array.isArray(input.cases))
    result.cases = input.cases
      .filter((item) => item && typeof item.input === "string")
      .slice(0, 30)
      .map((item, index) => ({
        id: typeof item.id === "string" ? item.id.slice(0, 80) : `case-${index}`,
        name:
          typeof item.name === "string" && item.name
            ? item.name.slice(0, 80)
            : `Вход ${index + 1}`,
        input: item.input.slice(0, 32768),
        enabled: item.enabled !== false,
        category: typeof item.category === "string" ? item.category.slice(0, 40) : "manual",
      }));
  return result;
}

class Persistence {
  constructor(directory) {
    this.directory = directory;
    this.queue = Promise.resolve();
  }

  async read(name, fallback) {
    try {
      const bytes = await fs.readFile(path.join(this.directory, name), "utf8");
      ensure(
        bytes.length <= 16 * 1024 * 1024,
        "LIMIT",
        "Файл настроек слишком большой",
      );
      return JSON.parse(bytes);
    } catch {
      return structuredClone(fallback);
    }
  }

  write(name, value) {
    const operation = async () => {
      await fs.mkdir(this.directory, { recursive: true });
      const destination = path.join(this.directory, name);
      const temporary = destination + "." + crypto.randomUUID() + ".tmp";
      try {
        await fs.writeFile(temporary, JSON.stringify(value, null, 2), {
          encoding: "utf8",
          flag: "wx",
        });
        await fs.rename(temporary, destination);
      } finally {
        await fs.unlink(temporary).catch(() => {});
      }
      return value;
    };
    const next = this.queue.then(operation, operation);
    this.queue = next.catch(() => {});
    return next;
  }

  async settings() {
    return normalizeSettings(await this.read("settings.json", {}));
  }

  async saveSettings(value) {
    return this.write("settings.json", normalizeSettings(value));
  }

  async recent() {
    const items = await this.read("recent.json", []);
    return Array.isArray(items)
      ? items
          .filter(
            (item) =>
              typeof item.root === "string" && typeof item.name === "string",
          )
          .slice(0, 12)
      : [];
  }

  async remember(project) {
    const previous = await this.recent();
    const key = project.root.toLocaleLowerCase();
    const items = [
      {
        root: project.root,
        name: project.name,
        buildSystem: project.buildSystem,
        time: stamp(),
      },
      ...previous.filter((item) => item.root.toLocaleLowerCase() !== key),
    ].slice(0, 12);
    await this.write("recent.json", items);
    return items;
  }

  async forget(root) {
    const items = (await this.recent()).filter((item) => item.root !== root);
    return this.write("recent.json", items);
  }

  async session(root) {
    const value = await this.read(`session-${sha(root).slice(0, 24)}.json`, {});
    return {
      tabs: Array.isArray(value.tabs)
        ? value.tabs.filter((item) => typeof item === "string").slice(0, 24)
        : [],
      active: typeof value.active === "string" ? value.active : null,
      expanded: Array.isArray(value.expanded)
        ? value.expanded
            .filter((item) => typeof item === "string")
            .slice(0, 200)
        : [],
    };
  }

  /** Behaviour baseline and stdin cases are IDE data, so they stay out of the user's folder. */
  async projectState(root) {
    const value = await this.read(`quality-${sha(root).slice(0, 24)}.json`, {});
    return normalizeProjectState(value);
  }

  async saveProjectState(root, value) {
    const normalized = normalizeProjectState(value);
    ensure(
      JSON.stringify(normalized).length <= 12 * 1024 * 1024,
      "LIMIT",
      "Эталон проекта слишком большой для сохранения",
    );
    return this.write(`quality-${sha(root).slice(0, 24)}.json`, normalized);
  }

  async saveSession(root, value) {
    return this.write(`session-${sha(root).slice(0, 24)}.json`, {
      tabs: Array.isArray(value.tabs)
        ? value.tabs
            .filter((item) => typeof item === "string" && item.length <= 1024)
            .slice(0, 24)
        : [],
      active:
        typeof value.active === "string" ? value.active.slice(0, 1024) : null,
      expanded: Array.isArray(value.expanded)
        ? value.expanded
            .filter((item) => typeof item === "string" && item.length <= 1024)
            .slice(0, 200)
        : [],
      time: stamp(),
    });
  }
}

class LocalHistory {
  constructor(directory, options = {}) {
    this.directory = path.join(directory, "history");
    this.maxVersions = options.maxVersions ?? 20;
    this.maxBytes = options.maxBytes ?? 2 * 1024 * 1024;
  }

  folder(root, file) {
    return path.join(
      this.directory,
      sha(root).slice(0, 24),
      sha(file).slice(0, 24),
    );
  }

  async capture(root, file, bytes, reason = "save") {
    if (bytes.length > this.maxBytes) return null;
    const folder = this.folder(root, file);
    await fs.mkdir(folder, { recursive: true });
    const hash = sha(bytes);
    const entries = await this.list(root, file);
    if (entries[0]?.hash === hash) return entries[0];
    const id =
      Date.now().toString(36) + "-" + crypto.randomBytes(4).toString("hex");
    const metadata = {
      id,
      path: file,
      hash,
      bytes: bytes.length,
      reason,
      time: stamp(),
    };
    await fs.writeFile(path.join(folder, id + ".txt"), bytes, { flag: "wx" });
    await fs.writeFile(
      path.join(folder, id + ".json"),
      JSON.stringify(metadata),
      { flag: "wx" },
    );
    for (const entry of entries.slice(this.maxVersions - 1)) {
      await fs.unlink(path.join(folder, entry.id + ".txt")).catch(() => {});
      await fs.unlink(path.join(folder, entry.id + ".json")).catch(() => {});
    }
    return metadata;
  }

  async list(root, file) {
    const folder = this.folder(root, file);
    let names;
    try {
      names = await fs.readdir(folder);
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
    const result = [];
    for (const name of names.filter((name) =>
      /^[a-z0-9]+-[a-f0-9]{8}\.json$/.test(name),
    )) {
      try {
        result.push(
          JSON.parse(await fs.readFile(path.join(folder, name), "utf8")),
        );
      } catch {}
    }
    return result
      .filter((item) => typeof item.id === "string" && item.path === file)
      .sort((a, b) => b.time.localeCompare(a.time))
      .slice(0, this.maxVersions);
  }

  async read(root, file, id) {
    ensure(
      /^[a-z0-9]+-[a-f0-9]{8}$/.test(id),
      "ARGUMENT",
      "Неизвестная версия",
    );
    const entries = await this.list(root, file);
    const metadata = entries.find((item) => item.id === id);
    ensure(metadata, "MISSING", "Эта версия больше не хранится");
    const bytes = await fs.readFile(
      path.join(this.folder(root, file), id + ".txt"),
    );
    ensure(sha(bytes) === metadata.hash, "HISTORY", "Версия повреждена");
    return { ...metadata, content: bytes.toString("utf8") };
  }
}

module.exports = {
  Persistence,
  LocalHistory,
  DEFAULT_SETTINGS,
  normalizeSettings,
};
