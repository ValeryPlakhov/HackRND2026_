import {
  Signal,
  basename,
  dirname,
  safeRelative,
  languageOf,
  delay,
} from "./core.mjs";
import { DEMO_FILES } from "./demo-data.mjs";
import { StudioClient } from "../lib/client.mjs";

export class BridgeError extends Error {
  constructor(error) {
    super(error?.message ?? "Ошибка настольного приложения");
    this.code = error?.code;
    this.detail = error?.detail;
  }
}

async function digest(value) {
  const bytes = new TextEncoder().encode(value);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export class NativeBridge {
  constructor(api) {
    this.api = api;
    this.desktop = true;
    this.filesChanged = new Signal();
    this.taskChanged = new Signal();
    this.command = new Signal();
    this.unsubscribe = [
      api.onFilesChanged((value) => this.filesChanged.emit(value)),
      api.onTaskChanged((value) => this.taskChanged.emit(value)),
      api.onCommand((value) => this.command.emit(value)),
    ];
  }
  async call(name, ...args) {
    const result = await this.api[name](...args);
    if (!result?.ok) throw new BridgeError(result?.error);
    return result.value;
  }
  boot() {
    return this.call("boot");
  }
  chooseFolder() {
    return this.call("chooseFolder");
  }
  openRecent(root) {
    return this.call("openRecent", root);
  }
  forgetRecent(root) {
    return this.call("forgetRecent", root);
  }
  newProject(request) {
    return this.call("newProject", request);
  }
  closeProject(id) {
    return this.call("closeProject", id);
  }
  list(id, path = "") {
    return this.call("list", id, path);
  }
  scan(id) {
    return this.call("scan", id);
  }
  read(id, path) {
    return this.call("read", id, path);
  }
  write(id, request) {
    return this.call("write", id, request);
  }
  create(id, request) {
    return this.call("create", id, request);
  }
  rename(id, request) {
    return this.call("rename", id, request);
  }
  trash(id, path) {
    return this.call("trash", id, path);
  }
  reveal(id, path) {
    return this.call("reveal", id, path);
  }
  search(id, request) {
    return this.call("search", id, request);
  }
  cancelSearch() {
    return this.call("cancelSearch");
  }
  previewReplace(id, request) {
    return this.call("previewReplace", id, request);
  }
  overview(id) {
    return this.call("overview", id);
  }
  gitStatus(id) {
    return this.call("gitStatus", id);
  }
  gitDiff(id, request) {
    return this.call("gitDiff", id, request);
  }
  gitLog(id) {
    return this.call("gitLog", id);
  }
  history(id, path) {
    return this.call("history", id, path);
  }
  historyRead(id, path, version) {
    return this.call("historyRead", id, path, version);
  }
  settings(value) {
    return this.call("settings", value);
  }
  session(id, value) {
    return this.call("session", id, value);
  }
  startTask(id, request) {
    return this.call("startTask", id, request);
  }
  task(id) {
    return this.call("task", id);
  }
  stopTask(id) {
    return this.call("stopTask", id);
  }
  dirty(value) {
    return this.call("dirty", value);
  }
  projectState(id, value) {
    return this.call("projectState", id, value);
  }
  openExample(name) {
    return this.call("openExample", name);
  }
  smokeReady(value) {
    return this.api.smokeReady?.(value);
  }
  destroy() {
    for (const unsubscribe of this.unsubscribe) unsubscribe();
  }
}

export class BrowserBridge {
  constructor() {
    this.desktop = false;
    this.filesChanged = new Signal();
    this.taskChanged = new Signal();
    this.command = new Signal();
    this.files = new Map();
    this.versions = new Map();
    this.project = null;
    this.jobs = new Map();
    this.client = new StudioClient();
    this.imported = false;
    this.searchGeneration = 0;
    this.savedSettings = {};
  }

  async boot() {
    try {
      this.savedSettings = JSON.parse(
        localStorage.getItem("blueprints-ide-settings") ?? "{}",
      );
    } catch {}
    return {
      version: "4.0.0",
      desktop: false,
      settings: this.savedSettings,
      recent: [],
      platform: "browser",
      runtime: { java: "21 · локальный сервер", electron: "EXE" },
    };
  }

  async demo() {
    this.files = new Map(Object.entries(DEMO_FILES));
    this.versions.clear();
    this.qualityState = null;
    this.imported = false;
    this.project = {
      id: crypto.randomUUID(),
      name: "Магазин · Java",
      root: "Пример в памяти страницы",
      buildSystem: "plain",
      git: false,
      capabilities: {
        read: true,
        write: true,
        folderPicker: false,
        java: true,
        otherLanguages: false,
      },
    };
    return {
      project: this.project,
      recent: [],
      session: {
        tabs: ["src/Pricing.java", "src/Main.java"],
        active: "src/Pricing.java",
        expanded: ["src"],
      },
    };
  }

  require(id) {
    if (id !== this.project?.id)
      throw new BridgeError({
        code: "STALE_PROJECT",
        message: "Проект был закрыт",
      });
  }

  async chooseFolder() {
    const input = document.createElement("input");
    input.type = "file";
    input.setAttribute("webkitdirectory", "");
    input.multiple = true;
    return new Promise((resolve, reject) => {
      input.addEventListener("cancel", () => resolve({ cancelled: true }), {
        once: true,
      });
      input.addEventListener(
        "change",
        async () => {
          try {
            const selected = [...input.files];
            if (!selected.length) return resolve({ cancelled: true });
            const files = new Map();
            let bytes = 0;
            const name = selected[0].webkitRelativePath.split("/")[0];
            for (const file of selected) {
              const relative = file.webkitRelativePath
                .split("/")
                .slice(1)
                .join("/");
              if (
                relative
                  .split("/")
                  .some((part) =>
                    [
                      ".git",
                      "node_modules",
                      "target",
                      "build",
                      ".runtime",
                      ".gradle",
                      "dist",
                    ].includes(part),
                  )
              )
                continue;
              if (file.size > 2 * 1024 * 1024 || files.size >= 3000) continue;
              if (
                !/\.(java|md|txt|json|xml|gradle|kts|properties|ya?ml|gitignore|js|ts|py|kt|cs|cpp|go|rs)$/i.test(
                  relative,
                )
              )
                continue;
              bytes += file.size;
              if (bytes > 24 * 1024 * 1024) break;
              const content = await file.text();
              if (!content.includes("\0"))
                files.set(safeRelative(relative), content);
            }
            this.files = files;
            this.imported = true;
            this.project = {
              id: crypto.randomUUID(),
              name,
              root: "Импорт папки · только чтение",
              buildSystem: files.has("pom.xml") ? "maven" : "plain",
              git: false,
              capabilities: {
                read: true,
                write: false,
                folderPicker: false,
                java: true,
                otherLanguages: false,
              },
            };
            resolve({
              project: this.project,
              recent: [],
              session: { tabs: [], expanded: [] },
            });
          } catch (error) {
            reject(error);
          }
        },
        { once: true },
      );
      input.click();
    });
  }

  async newProject() {
    return this.demo();
  }
  async openRecent() {
    return { cancelled: true };
  }
  async forgetRecent() {
    return [];
  }
  async closeProject(id) {
    this.require(id);
    this.project = null;
    this.files.clear();
    return { closed: true };
  }

  async list(id, directory = "") {
    this.require(id);
    const prefix = directory ? directory + "/" : "";
    const items = new Map();
    for (const [path] of this.files) {
      if (!path.startsWith(prefix)) continue;
      const remaining = path.slice(prefix.length);
      const name = remaining.split("/")[0];
      const folder = remaining.includes("/");
      items.set(name, {
        name,
        path: prefix + name,
        kind: folder ? "directory" : "file",
        editable: !folder,
        language: languageOf(name),
      });
    }
    return [...items.values()].sort(
      (a, b) =>
        (a.kind === "directory" ? 0 : 1) - (b.kind === "directory" ? 0 : 1) ||
        a.name.localeCompare(b.name),
    );
  }

  async scan(id) {
    this.require(id);
    return {
      files: [...this.files.keys()].map((path) => ({
        path,
        name: basename(path),
        language: languageOf(path),
        editable: true,
      })),
      omitted: [],
      limited: false,
      total: this.files.size,
    };
  }

  async read(id, path) {
    this.require(id);
    if (!this.files.has(path))
      throw new BridgeError({ code: "MISSING", message: "Файл не найден" });
    const content = this.files.get(path);
    return {
      path,
      content,
      hash: await digest(content),
      bytes: new TextEncoder().encode(content).length,
      modifiedAt: new Date().toISOString(),
      language: languageOf(path),
      eol: content.includes("\r\n") ? "CRLF" : "LF",
      bom: false,
      readOnly: this.imported,
    };
  }

  async write(id, request) {
    this.require(id);
    if (this.imported)
      throw new Error("Для сохранения в выбранную папку откройте EXE-версию");
    const previous = this.files.get(request.path);
    const hash = previous === undefined ? null : await digest(previous);
    if (hash !== request.expectedHash)
      throw new BridgeError({ code: "CONFLICT", message: "Файл изменён" });
    const history = this.versions.get(request.path) ?? [];
    if (previous !== undefined)
      history.unshift({
        id: crypto.randomUUID(),
        path: request.path,
        content: previous,
        hash,
        bytes: new TextEncoder().encode(previous).length,
        time: new Date().toISOString(),
        reason: "before-save",
      });
    this.versions.set(request.path, history.slice(0, 20));
    this.files.set(request.path, request.content);
    return {
      path: request.path,
      hash: await digest(request.content),
      bytes: new TextEncoder().encode(request.content).length,
      modifiedAt: new Date().toISOString(),
    };
  }

  async create(id, request) {
    this.require(id);
    if (this.imported) throw new Error("Изменение папки доступно в EXE");
    const path = safeRelative(request.path);
    if (this.files.has(path)) throw new Error("Файл уже существует");
    if (request.kind === "directory") this.files.set(path + "/.gitkeep", "");
    else this.files.set(path, request.content ?? "");
    return { path, kind: request.kind };
  }

  async rename(id, request) {
    this.require(id);
    if (this.imported) throw new Error("Переименование доступно в EXE");
    const to = safeRelative(request.to);
    if (
      this.files.has(to) ||
      [...this.files.keys()].some((path) => path.startsWith(to + "/"))
    )
      throw new Error("Имя уже занято");
    const entries = [...this.files].filter(
      ([path]) => path === request.path || path.startsWith(request.path + "/"),
    );
    if (!entries.length) throw new Error("Файл не найден");
    for (const [path, content] of entries) {
      this.files.delete(path);
      this.files.set(to + path.slice(request.path.length), content);
    }
    return { path: request.path, to };
  }

  async trash(id, path) {
    this.require(id);
    if (this.imported) throw new Error("Удаление доступно в EXE");
    for (const name of [...this.files.keys()])
      if (name === path || name.startsWith(path + "/")) this.files.delete(name);
    return { path, trashed: true };
  }

  async reveal() {
    throw new Error("Проводник открывается в настольном EXE-приложении");
  }
  cancelSearch() {
    this.searchGeneration++;
    return Promise.resolve({ cancelled: true });
  }

  async search(id, request) {
    this.require(id);
    const results = [];
    const query = request.caseSensitive
      ? request.query
      : request.query.toLocaleLowerCase();
    let searchedFiles = 0;
    for (const [path, content] of this.files) {
      if (
        request.include &&
        !path.toLocaleLowerCase().includes(request.include.toLocaleLowerCase())
      )
        continue;
      searchedFiles++;
      const haystack = request.caseSensitive
        ? content
        : content.toLocaleLowerCase();
      let cursor = 0;
      while (query && results.length < 500) {
        const start = haystack.indexOf(query, cursor);
        if (start < 0) break;
        cursor = start + query.length;
        if (
          request.wholeWord &&
          (/[\p{L}\p{N}_$]/u.test(content[start - 1] ?? " ") ||
            /[\p{L}\p{N}_$]/u.test(content[cursor] ?? " "))
        )
          continue;
        const before = content.slice(0, start);
        const line = before.split("\n").length;
        results.push({
          path,
          start,
          end: cursor,
          line,
          column: start - before.lastIndexOf("\n"),
          preview: content.split("\n")[line - 1].slice(0, 320),
          hash: await digest(content),
        });
      }
    }
    return {
      results,
      searchedFiles,
      limited: results.length >= 500,
      skipped: [],
      query: request.query,
    };
  }

  async previewReplace(id, request) {
    const found = await this.search(id, request);
    const grouped = new Map();
    for (const match of found.results) {
      if (!grouped.has(match.path)) grouped.set(match.path, []);
      grouped.get(match.path).push(match);
    }
    const changes = [];
    for (const [path, matches] of grouped) {
      const before = this.files.get(path);
      let after = before;
      for (const match of [...matches].reverse())
        after =
          after.slice(0, match.start) +
          request.replacement +
          after.slice(match.end);
      changes.push({
        path,
        before,
        after,
        expectedHash: await digest(before),
        count: matches.length,
        bom: false,
      });
    }
    return { changes, matches: found.results.length, files: changes.length };
  }

  async overview(id) {
    this.require(id);
    const files = [...this.files.keys()].filter(
      (path) => languageOf(path) === "java",
    );
    const entryPoints = [];
    const types = [];
    const packages = new Map();
    let lines = 0;
    for (const path of files) {
      const source = this.files.get(path);
      const model = await this.client.request("/analyze", { source });
      const packageName = model.package ?? "";
      packages.set(
        packageName || "(default)",
        (packages.get(packageName || "(default)") ?? 0) + 1,
      );
      lines += source.split("\n").length;
      for (const type of model.classes ?? [])
        types.push({ ...type, path, packageName });
      if (/\bstatic\s+void\s+main\s*\(/.test(source))
        entryPoints.push({
          path,
          className:
            (packageName ? packageName + "." : "") +
            basename(path).replace(/\.java$/, ""),
        });
    }
    return {
      files: this.files.size,
      javaFiles: files.length,
      indexed: files.length,
      lines,
      packages: [...packages].map(([name, files]) => ({ name, files })),
      entryPoints,
      types,
      configs: [...this.files.keys()]
        .filter((path) => /README|pom.xml|build.gradle/.test(path))
        .map((path) => ({ path })),
      failures: [],
      limited: false,
    };
  }

  async gitStatus() {
    return {
      available: false,
      entries: [],
      error: "Git-статус выбранной папки доступен в настольном приложении.",
    };
  }
  async gitDiff() {
    return { diff: "", path: "" };
  }
  async gitLog() {
    return { entries: [] };
  }
  async history(id, path) {
    this.require(id);
    return (this.versions.get(path) ?? []).map(
      ({ content, ...entry }) => entry,
    );
  }
  async historyRead(id, path, version) {
    this.require(id);
    const entry = (this.versions.get(path) ?? []).find(
      (item) => item.id === version,
    );
    if (!entry) throw new Error("Версия не найдена");
    return entry;
  }
  async settings(value) {
    if (value) {
      this.savedSettings = value;
      try {
        localStorage.setItem("blueprints-ide-settings", JSON.stringify(value));
      } catch {}
    }
    return this.savedSettings;
  }
  async session() {
    return { tabs: [], expanded: [] };
  }
  async dirty() {
    return {};
  }
  async projectState(id, value) {
    this.require(id);
    if (value) this.qualityState = structuredClone(value);
    return structuredClone(this.qualityState ?? { baseline: null, cases: [] });
  }
  async openExample(name) {
    let example;
    try {
      example = await this.client.request(
        `/examples/${encodeURIComponent(name)}`,
        undefined,
        { timeout: 8000 },
      );
    } catch {
      return this.demo();
    }
    this.files = new Map(Object.entries(example.files));
    this.versions.clear();
    this.qualityState = null;
    this.imported = false;
    this.project = {
      id: crypto.randomUUID(),
      name,
      root: "Пример в памяти страницы",
      buildSystem: "plain",
      git: false,
      capabilities: {
        read: true,
        write: true,
        folderPicker: false,
        java: true,
        otherLanguages: false,
      },
    };
    const main = [...this.files.keys()].find((path) => path.endsWith(".java"));
    return {
      project: this.project,
      recent: [],
      session: {
        tabs: main ? [main] : [],
        active: main ?? null,
        expanded: main?.includes("/") ? [main.split("/")[0]] : [],
      },
    };
  }

  async startTask(id, request) {
    this.require(id);
    const files = {};
    for (const [path, content] of this.files) {
      if (!path.endsWith(".java")) continue;
      if (Object.hasOwn(files, basename(path)))
        throw new Error(
          "В веб-предпросмотре имена Java-файлов должны отличаться. Проекты с пакетами запускайте в EXE.",
        );
      if (/^\s*package\s/m.test(content))
        throw new Error(
          "Запуск Java-пакетов доступен в настольной версии. Блупринты можно читать здесь.",
        );
      files[basename(path)] = content;
    }
    const job = {
      id: crypto.randomUUID(),
      projectId: id,
      kind: request.kind,
      status: "running",
      stage: "Java 21 · локальный сервер",
      stdout: "",
      stderr: "",
      diagnostics: [],
      startedAt: new Date().toISOString(),
      exitCode: null,
    };
    this.jobs.set(job.id, job);
    const execute = async () => {
      try {
        if (request.kind === "compile") {
          const result = await this.client.request("/compile", { files });
          job.status = result.success ? "done" : "failed";
          job.stdout = result.stdout ?? "";
          job.stderr =
            result.stderr ?? result.diagnostics ?? result.compile?.stderr ?? "";
          job.exitCode = result.success ? 0 : 1;
        } else {
          const result = await this.client.startJob(
            "run",
            { files, input: request.input ?? "" },
            (update) => {
              job.serverJob = update.id;
              this.taskChanged.emit({ ...job });
            },
          );
          const execution = result.result?.execution;
          job.stdout = execution?.stdout ?? "";
          job.stderr =
            execution?.stderr ??
            result.result?.compile?.stderr ??
            result.error ??
            "";
          job.status = job.cancelled
            ? "cancelled"
            : result.result?.success
              ? "done"
              : "failed";
          job.exitCode = execution?.exitCode ?? null;
          job.timedOut = execution?.timedOut ?? false;
        }
      } catch (error) {
        job.status = job.cancelled ? "cancelled" : "failed";
        job.stderr = error.message;
      }
      job.finishedAt = new Date().toISOString();
      job.stage =
        job.status === "done"
          ? "Готово"
          : job.status === "cancelled"
            ? "Остановлено"
            : "Завершено с ошибкой";
      this.taskChanged.emit({ ...job });
    };
    execute();
    return { ...job };
  }

  async task(id) {
    const job = this.jobs.get(id);
    if (!job) throw new Error("Задача не найдена");
    return { ...job };
  }
  async stopTask(id) {
    const job = this.jobs.get(id);
    if (job) {
      job.cancelled = true;
      if (job.serverJob) await this.client.cancelJob(job.serverJob);
      job.status = "cancelled";
      this.taskChanged.emit({ ...job });
    }
    return { ...job };
  }
  destroy() {
    this.filesChanged.clear();
    this.taskChanged.clear();
    this.command.clear();
  }
}

export function createBridge() {
  return window.blueprintsDesktop
    ? new NativeBridge(window.blueprintsDesktop)
    : new BrowserBridge();
}
