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
    super(error?.message ?? "Ошибка");
    this.code = error?.code;
    this.detail = error?.detail;
  }
}

const SKIPPED_FOLDERS = new Set([".git", "node_modules", "target", "build", ".runtime", ".gradle", "dist", "out", ".idea"]);
const READABLE = /\.(java|md|txt|json|xml|gradle|kts|properties|ya?ml|gitignore|js|ts|py|kt|cs|cpp|go|rs)$/i;

/** Reads the readable text files of a directory handle into `files` (relative path -> text). */
async function readDirectory(handle, prefix, files, state) {
  for await (const [name, entry] of handle.entries()) {
    if (files.size >= 3000 || state.bytes > 24 * 1024 * 1024) return;
    const path = prefix + name;
    if (entry.kind === "directory") {
      if (!SKIPPED_FOLDERS.has(name)) await readDirectory(entry, path + "/", files, state);
      continue;
    }
    if (!READABLE.test(name)) continue;
    const file = await entry.getFile();
    if (file.size > 2 * 1024 * 1024) continue;
    const content = await file.text();
    if (content.includes("\0")) continue;
    state.bytes += file.size;
    files.set(safeRelative(path), content);
  }
}

/** Plain words for the failures beginners hit most when a program reads the keyboard. */
export function explainFailure(stderr = "") {
  if (/NoSuchElementException/.test(stderr) && /Scanner/.test(stderr))
    return "Программа ждала ввод (Scanner), но его нет или он закончился. Впишите значения в поле «Ввод для программы» под консолью и запустите снова.";
  if (/InputMismatchException/.test(stderr))
    return "Введено не то, что ждёт программа: например, текст вместо числа. Проверьте поле «Ввод для программы».";
  if (/NumberFormatException/.test(stderr))
    return "Строку не удалось превратить в число. Проверьте, что во вводе только цифры.";
  if (/HeadlessException/.test(stderr))
    return "Программа открывает окно (Swing/AWT). В веб-IDE окна не показываются: запускаются консольные программы.";
  const missingPackage = /error: package ([\w.]+) does not exist/.exec(stderr);
  if (missingPackage)
    return `Нет пакета ${missingPackage[1]}: это внешняя библиотека (Maven/Gradle-зависимость). Зависимости не подключаются — запускаются только файлы самого проекта.`;
  const missingClass = /symbol:\s+class (\w+)/.exec(stderr);
  if (missingClass)
    return `Не найден класс ${missingClass[1]}. Возможно, загружены не все файлы проекта или класс из внешней библиотеки.`;
  return "";
}

async function digest(value) {
  const bytes = new TextEncoder().encode(value);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export class BrowserBridge {
  constructor() {
    this.filesChanged = new Signal();
    this.taskChanged = new Signal();
    this.command = new Signal();
    this.files = new Map();
    this.versions = new Map();
    this.project = null;
    this.jobs = new Map();
    this.client = new StudioClient();
    this.imported = false;
    this.handle = null;
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
      version: "5.0.0",
      settings: this.savedSettings,
      recent: [],
      platform: "browser",
      runtime: { java: "21" },
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

  /** Folder access through the browser: read and write the real directory (Chromium), copy elsewhere. */
  async chooseFolder() {
    if (!("showDirectoryPicker" in window)) return this.chooseFolderCopy();
    let handle;
    try {
      handle = await window.showDirectoryPicker({ id: "blueprints", mode: "readwrite" });
    } catch (error) {
      if (error?.name === "AbortError") return { cancelled: true };
      throw error;
    }
    const files = new Map();
    const state = { bytes: 0 };
    await readDirectory(handle, "", files, state);
    this.files = files;
    this.versions.clear();
    this.qualityState = null;
    this.imported = true;
    this.handle = handle;
    this.project = {
      id: crypto.randomUUID(),
      name: handle.name,
      root: handle.name,
      buildSystem: files.has("pom.xml") ? "maven" : files.has("build.gradle") ? "gradle" : "plain",
      git: false,
      capabilities: { read: true, write: true, disk: true, java: true, otherLanguages: false },
    };
    return { project: this.project, recent: [], session: { tabs: [], expanded: [] } };
  }

  /** Mirrors a change into the opened folder; the in-memory copy is updated only after this succeeds. */
  async persist(path, content) {
    if (!this.handle) return;
    const parts = path.split("/");
    const name = parts.pop();
    let directory = this.handle;
    for (const part of parts) directory = await directory.getDirectoryHandle(part, { create: true });
    const file = await directory.getFileHandle(name, { create: true });
    const writer = await file.createWritable();
    await writer.write(content);
    await writer.close();
  }

  async persistDirectory(path) {
    if (!this.handle) return;
    let directory = this.handle;
    for (const part of path.split("/")) directory = await directory.getDirectoryHandle(part, { create: true });
  }

  async unlink(path) {
    if (!this.handle) return;
    const parts = path.split("/");
    const name = parts.pop();
    try {
      let directory = this.handle;
      for (const part of parts) directory = await directory.getDirectoryHandle(part);
      await directory.removeEntry(name, { recursive: true });
    } catch (error) {
      if (error?.name !== "NotFoundError") throw error;
    }
  }

  async chooseFolderCopy() {
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
            this.handle = null;
            this.project = {
              id: crypto.randomUUID(),
              name,
              root: "Копия папки в памяти страницы (сохраните ZIP)",
              buildSystem: files.has("pom.xml") ? "maven" : "plain",
              git: false,
              capabilities: {
                read: true,
                write: true,
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
    this.handle = null;
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
      readOnly: false,
    };
  }

  async write(id, request) {
    this.require(id);
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
    await this.persist(request.path, request.content);
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
    const path = safeRelative(request.path);
    if (this.files.has(path)) throw new Error("Файл уже существует");
    if (request.kind === "directory") {
      await this.persistDirectory(path);
      this.files.set(path + "/.gitkeep", "");
    } else {
      await this.persist(path, request.content ?? "");
      this.files.set(path, request.content ?? "");
    }
    return { path, kind: request.kind };
  }

  async rename(id, request) {
    this.require(id);
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
    for (const [path, content] of entries)
      if (!path.endsWith("/.gitkeep")) await this.persist(to + path.slice(request.path.length), content);
    if (entries.every(([path]) => path.endsWith("/.gitkeep"))) await this.persistDirectory(to);
    await this.unlink(request.path);
    for (const [path, content] of entries) {
      this.files.delete(path);
      this.files.set(to + path.slice(request.path.length), content);
    }
    return { path: request.path, to };
  }

  async trash(id, path) {
    this.require(id);
    await this.unlink(path);
    for (const name of [...this.files.keys()])
      if (name === path || name.startsWith(path + "/")) this.files.delete(name);
    return { path, trashed: true };
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
      error: "Git-статус в браузере недоступен.",
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
    for (const [path, content] of this.files)
      if (path.endsWith(".java") && !/(^|\/)src\/test\//.test(path)) files[path] = content;
    if (!Object.keys(files).length) throw new Error("В проекте нет Java-файлов");
    const job = {
      id: crypto.randomUUID(),
      projectId: id,
      kind: request.kind,
      status: "running",
      stage: "Java 21",
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
          const result = await this.client.request("/compile", { files, mainClass: request.mainClass ?? "", entryFile: request.entryFile ?? "" });
          job.status = result.success ? "done" : "failed";
          job.stdout = result.stdout ?? "";
          job.stderr =
            result.stderr ?? result.diagnostics ?? result.compile?.stderr ?? "";
          job.exitCode = result.success ? 0 : 1;
        } else {
          const result = await this.client.startJob(
            "run",
            { files, input: request.input ?? "", mainClass: request.mainClass ?? "", entryFile: request.entryFile ?? "" },
            (update) => {
              job.serverJob = update.id;
              this.taskChanged.emit({ ...job });
            },
          );
          const execution = result.result?.execution;
          job.stdout = execution?.stdout ?? "";
          const build = result.result?.compile ?? {};
          job.phase = result.result?.phase ?? "";
          job.stderr = execution?.stderr ?? (job.phase === "compile" ? build.diagnostics ?? "" : "") ?? result.error ?? "";
          job.choices = job.phase === "entry" ? build.entryCandidates ?? [] : [];
          if (job.phase === "entry") job.message = build.mainError || "Нечего запускать";
          if (job.phase === "compile") job.message = "Не скомпилировалось — ошибки ниже";
          job.status = job.cancelled
            ? "cancelled"
            : result.result?.success
              ? "done"
              : "failed";
          job.exitCode = execution?.exitCode ?? null;
          job.timedOut = execution?.timedOut ?? false;
          job.entryPoint = job.phase === "execute" ? build.entryPoint ?? "" : "";
          job.hint = explainFailure(job.stderr);
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
  return new BrowserBridge();
}
