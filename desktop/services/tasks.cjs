"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { StringDecoder } = require("node:string_decoder");
const { ensure, text, stamp, inside } = require("./contracts.cjs");

function argumentFileValue(value) {
  return (
    '"' +
    value
      .replaceAll("\\", "\\\\")
      .replaceAll('"', '\\"')
      .replaceAll("\n", "")
      .replaceAll("\r", "") +
    '"'
  );
}

function parseJavacDiagnostics(stderr, root) {
  const lines = stderr.split(/\r?\n/);
  const results = [];
  const prefix = path.resolve(root).replaceAll("\\", "/") + "/";
  for (let index = 0; index < lines.length; index++) {
    const match = lines[index].match(
      /^(.+\.java):(\d+):\s*(error|warning):\s*(.*)$/,
    );
    if (!match) continue;
    const normalized = match[1].replaceAll("\\", "/");
    const column = lines[index + 2]?.indexOf("^") ?? -1;
    results.push({
      path: normalized
        .toLocaleLowerCase()
        .startsWith(prefix.toLocaleLowerCase())
        ? normalized.slice(prefix.length)
        : normalized,
      line: Number(match[2]),
      column: Math.max(1, column + 1),
      severity: match[3],
      message: match[4],
      source: "javac",
    });
  }
  return results;
}

function discoverMain(source) {
  const packageName = source.match(/^\s*package\s+([\w.]+)\s*;/m)?.[1] ?? "";
  const className = source.match(
    /\b(?:public\s+)?(?:final\s+)?class\s+(\w+)/,
  )?.[1];
  const hasMain =
    /\b(?:public\s+static|static\s+public)\s+void\s+main\s*\(\s*(?:final\s+)?String\s*(?:\[\s*\]|\.\.\.)/.test(
      source,
    );
  return className && hasMain
    ? (packageName ? packageName + "." : "") + className
    : null;
}

class TaskService {
  constructor(workspace, options) {
    this.workspace = workspace;
    this.javaHome = options.javaHome;
    this.directory = path.join(options.directory, "tasks");
    this.jobs = new Map();
    this.active = null;
    this.onChange = options.onChange ?? (() => {});
  }

  async start(id, request) {
    ensure(!this.active, "BUSY", "Дождитесь текущей задачи или остановите её");
    ensure(
      ["compile", "run"].includes(request.kind),
      "ARGUMENT",
      "Неизвестная задача",
    );
    const snapshot = this.workspace.require(id);
    const input = text(request.input ?? "", "Ввод программы", 32768, true);
    const mainClass = request.mainClass
      ? text(request.mainClass, "Главный класс", 256)
      : null;
    if (mainClass)
      ensure(
        /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(mainClass),
        "ARGUMENT",
        "Укажите полное имя класса, например com.example.Main",
      );
    const job = {
      id: crypto.randomUUID(),
      projectId: id,
      kind: request.kind,
      status: "queued",
      stage: "Подготовка проекта",
      startedAt: stamp(),
      finishedAt: null,
      stdout: "",
      stderr: "",
      diagnostics: [],
      exitCode: null,
      cancelled: false,
      timedOut: false,
      truncated: false,
      mainClass,
      input,
      files: 0,
    };
    this.jobs.set(job.id, job);
    this.active = job;
    this.execute(job, snapshot)
      .catch((error) => {
        job.status = job.cancelled ? "cancelled" : "failed";
        job.stderr += "\n" + String(error.message ?? error);
        job.finishedAt = stamp();
      })
      .finally(() => {
        this.active = null;
        delete job.process;
        delete job.input;
        this.onChange(this.public(job));
        if (this.jobs.size > 30)
          this.jobs.delete(this.jobs.keys().next().value);
      });
    return this.public(job);
  }

  public(job) {
    const { process: child, input, ...result } = job;
    if (
      this.active === job &&
      ["done", "failed", "cancelled"].includes(result.status)
    ) {
      result.status = "running";
      result.stage = "Завершение задачи";
    }
    return structuredClone(result);
  }

  get(id) {
    const job = this.jobs.get(id);
    ensure(job, "MISSING", "Задача больше не хранится");
    return this.public(job);
  }

  cancel(id) {
    const job = this.jobs.get(id);
    ensure(job, "MISSING", "Неизвестная задача");
    if (["done", "failed", "cancelled"].includes(job.status))
      return this.public(job);
    job.cancelled = true;
    job.stage = "Остановка";
    job.process?.kill();
    return this.public(job);
  }

  async runProcess(job, executable, args, options) {
    ensure(!job.cancelled, "CANCELLED", "Задача отменена");
    return new Promise((resolve, reject) => {
      const child = spawn(executable, args, {
        cwd: options.cwd,
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          JAVA_HOME: this.javaHome,
          JAVA_TOOL_OPTIONS: "",
          JDK_JAVA_OPTIONS: "",
          _JAVA_OPTIONS: "",
          CLASSPATH: "",
        },
      });
      job.process = child;
      let outputBytes = 0;
      let stdout = "";
      let stderr = "";
      let settled = false;
      const decoders = {
        stdout: new StringDecoder("utf8"),
        stderr: new StringDecoder("utf8"),
      };
      const timer = setTimeout(() => {
        job.timedOut = true;
        child.kill();
      }, options.timeout);
      const capture = (stream, chunk) => {
        outputBytes += chunk.length;
        if (outputBytes > 256 * 1024) {
          job.truncated = true;
          child.kill();
          return;
        }
        const value = decoders[stream].write(chunk);
        if (stream === "stdout") {
          stdout += value;
          job.stdout += value;
        } else {
          stderr += value;
          job.stderr += value;
        }
        this.onChange(this.public(job));
      };
      child.stdout.on("data", (chunk) => capture("stdout", chunk));
      child.stderr.on("data", (chunk) => capture("stderr", chunk));
      child.stdin.on("error", () => {});
      child.stdin.end(options.input ?? "", "utf8");
      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        delete job.process;
        const stdoutTail = decoders.stdout.end();
        const stderrTail = decoders.stderr.end();
        stdout += stdoutTail;
        stderr += stderrTail;
        job.stdout += stdoutTail;
        job.stderr += stderrTail;
        resolve({ code, stdout, stderr });
      });
    });
  }

  async execute(job, snapshot) {
    job.status = "running";
    this.workspace.current(snapshot);
    const scan = await this.workspace.scan(snapshot.id, { textOnly: true });
    const sources = scan.files.filter((item) => item.language === "java");
    ensure(
      !scan.limited,
      "LIMIT",
      "Проект слишком большой для встроенного запуска",
    );
    ensure(sources.length > 0, "NO_JAVA", "В выбранной папке нет Java-файлов");
    ensure(
      sources.length <= 300,
      "LIMIT",
      "Встроенная сборка поддерживает до 300 Java-файлов",
    );
    job.files = sources.length;
    const mains = [];
    let totalBytes = 0;
    const staging = path.join(this.directory, job.id);
    const stagedSources = path.join(staging, "source");
    const classes = path.join(staging, "classes");
    await fs.mkdir(classes, { recursive: true });
    const names = [];
    try {
      for (const file of sources) {
        ensure(!job.cancelled, "CANCELLED", "Задача отменена");
        const document = await this.workspace.read(snapshot.id, file.path);
        totalBytes += document.bytes;
        ensure(
          totalBytes <= 8 * 1024 * 1024,
          "LIMIT",
          "Исходники превышают 8 МиБ",
        );
        const destination = path.join(stagedSources, ...file.path.split("/"));
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.writeFile(destination, document.content, "utf8");
        names.push(destination);
        const entry = discoverMain(document.content);
        if (entry) mains.push({ className: entry, path: file.path });
      }
      this.workspace.current(snapshot);
      job.mains = mains;
      if (job.kind === "run" && !job.mainClass) {
        ensure(
          mains.length === 1,
          "MAIN_CLASS",
          mains.length
            ? "В проекте несколько main. Выберите главный класс в параметрах запуска."
            : "Не найден public static void main(String[] args). Укажите главный класс.",
        );
        job.mainClass = mains[0].className;
      }
      const argumentFile = path.join(staging, "sources.args");
      await fs.writeFile(
        argumentFile,
        names.map(argumentFileValue).join("\n"),
        "utf8",
      );
      job.stage = `javac · ${sources.length} файлов`;
      this.onChange(this.public(job));
      const compilation = await this.runProcess(
        job,
        path.join(this.javaHome, "bin", "javac.exe"),
        [
          "-J-Xmx384m",
          "-J-Duser.language=en",
          "-J-Dfile.encoding=UTF-8",
          "-J-Dstdout.encoding=UTF-8",
          "-J-Dstderr.encoding=UTF-8",
          "--release",
          "21",
          "-proc:none",
          "-encoding",
          "UTF-8",
          "-d",
          classes,
          "@" + argumentFile,
        ],
        { cwd: staging, timeout: 30000 },
      );
      job.diagnostics = parseJavacDiagnostics(
        compilation.stderr,
        stagedSources,
      );
      if (
        job.cancelled ||
        job.timedOut ||
        job.truncated ||
        compilation.code !== 0
      ) {
        job.exitCode = compilation.code;
        job.status = job.cancelled ? "cancelled" : "failed";
        if (compilation.code !== 0 && !job.cancelled)
          job.hint =
            "Для Maven/Gradle с внешними зависимостями нужен их classpath. Встроенный запуск компилирует исходники и стандартную Java 21; build-скрипты не запускаются.";
        return;
      }
      if (job.kind === "compile") {
        job.status = "done";
        job.exitCode = 0;
        job.stage = "Сборка завершена";
        return;
      }
      ensure(!job.cancelled, "CANCELLED", "Задача отменена");
      job.stage = "java · " + job.mainClass;
      this.onChange(this.public(job));
      const execution = await this.runProcess(
        job,
        path.join(this.javaHome, "bin", "java.exe"),
        [
          "-Xmx128m",
          "-Dfile.encoding=UTF-8",
          "-Dstdout.encoding=UTF-8",
          "-Dstderr.encoding=UTF-8",
          "-cp",
          classes,
          job.mainClass,
        ],
        { cwd: snapshot.root, timeout: 10000, input: job.input },
      );
      job.exitCode = execution.code;
      job.status = job.cancelled
        ? "cancelled"
        : execution.code === 0 && !job.timedOut && !job.truncated
          ? "done"
          : "failed";
      job.stage = job.cancelled ? "Остановлено" : "Задача завершена";
    } finally {
      job.finishedAt = stamp();
      ensure(
        inside(this.directory, staging) && staging !== this.directory,
        "PATH",
        "Неверная папка временной сборки",
      );
      await fs
        .rm(staging, {
          recursive: true,
          force: true,
          maxRetries: 3,
          retryDelay: 100,
        })
        .catch(() => {});
    }
  }

  close() {
    if (this.active) {
      this.active.cancelled = true;
      this.active.process?.kill();
    }
  }
}

module.exports = {
  TaskService,
  parseJavacDiagnostics,
  discoverMain,
  argumentFileValue,
};
