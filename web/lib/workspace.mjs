import {
  clone,
  EventBus,
  stableFiles,
  uniqueId,
  validateFileName,
} from "./core.mjs";

export const WORKSPACE_SCHEMA = 2;

/** Workspace transactions invalidate evidence once and create a reviewable checkpoint. */
export class Workspace {
  constructor(initial = {}) {
    this.events = new EventBus();
    this.state = {
      name: initial.name ?? "Untitled workspace",
      files: clone(initial.files ?? {}),
      baseline: clone(initial.baseline ?? initial.files ?? {}),
      activeFile:
        initial.activeFile ?? Object.keys(initial.files ?? {})[0] ?? "",
      activeMethod: null,
      view: "overview",
      inspector: "diagnostics",
      theme: initial.theme ?? "dark",
      revision: 0,
      project: null,
      detail: null,
      plans: null,
      report: null,
      reportJobId: null,
      benchmark: null,
      mutations: null,
      reduction: null,
      cases: clone(initial.cases ?? []),
      jobs: [],
      snapshots: clone(initial.snapshots ?? []),
      selectedNode: null,
      selectedPlan: null,
      selectedFinding: null,
      focusMode: false,
      graphDirection: "vertical",
      graphFilter: "",
      dirty: false,
      demoStage: "before",
      savedAt: null,
    };
    this.undoStack = [];
    this.redoStack = [];
    this.transactionDepth = 0;
    this.#ensureActiveFile();
  }

  get source() {
    return this.state.files[this.state.activeFile] ?? "";
  }

  get model() {
    return this.state.project?.files?.[this.state.activeFile] ?? null;
  }

  get method() {
    return (
      this.model?.methods?.find(
        (method) => method.id === this.state.activeMethod,
      ) ??
      this.model?.methods?.find((method) => method.name === "countPairs") ??
      this.model?.methods?.find((method) => method.graph.nodes.length > 2) ??
      this.model?.methods?.[0] ??
      null
    );
  }

  get changedFiles() {
    const names = new Set([
      ...Object.keys(this.state.files),
      ...Object.keys(this.state.baseline),
    ]);
    return [...names].filter(
      (name) => this.state.files[name] !== this.state.baseline[name],
    );
  }

  get gate() {
    if (!this.state.report) return "unverified";
    return this.state.report.passed ? "passed" : "failed";
  }

  #ensureActiveFile() {
    if (!Object.hasOwn(this.state.files, this.state.activeFile)) {
      this.state.activeFile = Object.keys(this.state.files)[0] ?? "";
    }
  }

  #capture() {
    return {
      files: clone(this.state.files),
      activeFile: this.state.activeFile,
      demoStage: this.state.demoStage,
    };
  }

  #invalidate(sourceChanged = true) {
    this.state.revision += 1;
    this.state.report = null;
    this.state.reportJobId = null;
    this.state.benchmark = null;
    this.state.mutations = null;
    this.state.reduction = null;
    if (sourceChanged) {
      this.state.plans = null;
      this.state.detail = null;
    }
    this.state.dirty =
      stableFiles(this.state.files) !== stableFiles(this.state.baseline);
    this.state.selectedNode = null;
  }

  transaction(label, operation, options = {}) {
    const before = this.#capture();
    operation(this.state);
    this.#ensureActiveFile();
    const changed = stableFiles(before.files) !== stableFiles(this.state.files);
    if (!changed && !options.force) return false;
    this.undoStack.push({ label, ...before });
    if (this.undoStack.length > 40) this.undoStack.shift();
    this.redoStack = [];
    this.#invalidate();
    if (options.checkpoint !== false) this.checkpoint(label, false);
    this.events.emit(options.event ?? "change", {
      label,
      revision: this.state.revision,
    });
    return true;
  }

  setSource(source, options = {}) {
    const name = this.state.activeFile;
    return this.transaction(
      options.label ?? `Изменён ${name}`,
      (state) => {
        state.files[name] = source;
      },
      { event: "source", checkpoint: false },
    );
  }

  applyFiles(files, label = "Применено преобразование") {
    return this.transaction(label, (state) => {
      state.files = clone(files);
    });
  }

  importFiles(files, name) {
    const entries = Object.entries(files);
    if (!entries.length || entries.length > 30)
      throw new Error("Нужно от 1 до 30 Java-файлов");
    if (entries.some(([file]) => !validateFileName(file)))
      throw new Error("Неподдерживаемое имя Java-файла");
    if (entries.reduce((sum, [, source]) => sum + source.length, 0) > 500000)
      throw new Error("Проект больше 500000 символов");
    this.state.files = clone(files);
    this.state.baseline = clone(files);
    this.state.name = name ?? entries[0][0].replace(/\.java$/, "");
    this.state.activeFile = entries[0][0];
    this.state.activeMethod = null;
    this.state.project = null;
    this.state.demoStage = "before";
    this.state.snapshots = [];
    this.undoStack = [];
    this.redoStack = [];
    this.#invalidate();
    this.checkpoint("Исходный проект", false);
    this.events.emit("import", { name: this.state.name });
  }

  selectFile(name) {
    if (!Object.hasOwn(this.state.files, name))
      throw new Error("Файл не найден");
    this.state.activeFile = name;
    this.state.activeMethod = null;
    this.state.detail = null;
    this.state.selectedNode = null;
    this.state.selectedPlan = null;
    this.events.emit("selection", { file: name });
  }

  selectMethod(id) {
    if (!this.model?.methods?.some((method) => method.id === id)) return;
    this.state.activeMethod = id;
    this.state.detail = null;
    this.state.selectedNode = null;
    this.events.emit("selection", { method: id });
  }

  setCases(cases) {
    if (cases.length > 30) throw new Error("Максимум 30 тестовых входов");
    this.state.cases = clone(cases);
    this.#invalidate(false);
    this.events.emit("cases", { count: cases.length });
  }

  acceptBaseline() {
    this.state.baseline = clone(this.state.files);
    this.#invalidate(false);
    this.checkpoint("Новый эталон", false);
    this.events.emit("change", { label: "Текущая версия принята за эталон" });
  }

  updateProject(project, revision) {
    if (revision !== this.state.revision) return false;
    const name = this.method?.name;
    this.state.project = project;
    const available = this.model?.methods ?? [];
    this.state.activeMethod =
      available.find((method) => method.id === this.state.activeMethod)?.id ??
      available.find((method) => method.name === name)?.id ??
      available.find((method) => method.name === "countPairs")?.id ??
      available[0]?.id ??
      null;
    this.events.emit("analysis", { revision });
    return true;
  }

  updateDetail(detail, revision, methodId) {
    if (revision !== this.state.revision || methodId !== this.method?.id)
      return false;
    this.state.detail = detail;
    this.events.emit("detail", { methodId });
    return true;
  }

  updateResult(kind, result, revision, jobId = null) {
    if (revision !== this.state.revision) return false;
    const key = {
      compare: "report",
      benchmark: "benchmark",
      mutation: "mutations",
      minimize: "reduction",
    }[kind];
    if (!key) throw new Error("Неизвестный вид результата");
    this.state[key] = clone(result);
    if (kind === "compare") this.state.reportJobId = jobId;
    this.events.emit("result", { kind, result });
    return true;
  }

  checkpoint(label, notify = true) {
    const snapshot = {
      id: uniqueId("snapshot"),
      label,
      createdAt: new Date().toISOString(),
      files: clone(this.state.files),
      activeFile: this.state.activeFile,
      demoStage: this.state.demoStage,
      gate: this.gate,
      changedFiles: this.changedFiles.length,
    };
    const last = this.state.snapshots.at(-1);
    if (
      last &&
      stableFiles(last.files) === stableFiles(snapshot.files) &&
      last.label === label
    )
      return last;
    this.state.snapshots.push(snapshot);
    if (this.state.snapshots.length > 24) this.state.snapshots.shift();
    if (notify) this.events.emit("history", snapshot);
    return snapshot;
  }

  restore(id) {
    const selected = this.state.snapshots.find(
      (snapshot) => snapshot.id === id,
    );
    if (!selected) throw new Error("Снимок не найден");
    this.transaction(`Восстановлен снимок: ${selected.label}`, (state) => {
      state.files = clone(selected.files);
      state.activeFile = selected.activeFile;
      state.demoStage = selected.demoStage;
    });
  }

  undo() {
    const previous = this.undoStack.pop();
    if (!previous) return false;
    this.redoStack.push({ label: previous.label, ...this.#capture() });
    this.state.files = clone(previous.files);
    this.state.activeFile = previous.activeFile;
    this.state.demoStage = previous.demoStage;
    this.#invalidate();
    this.events.emit("change", { label: `Отмена: ${previous.label}` });
    return true;
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push({ label: next.label, ...this.#capture() });
    this.state.files = clone(next.files);
    this.state.activeFile = next.activeFile;
    this.state.demoStage = next.demoStage;
    this.#invalidate();
    this.events.emit("change", { label: `Повтор: ${next.label}` });
    return true;
  }

  navigate(view) {
    const allowed = new Set([
      "overview",
      "canvas",
      "changes",
      "tests",
      "architecture",
      "insights",
      "history",
      "presentation",
    ]);
    if (!allowed.has(view)) throw new Error("Неизвестный раздел");
    this.state.view = view;
    this.events.emit("navigate", { view });
  }

  serialize() {
    return {
      schema: WORKSPACE_SCHEMA,
      name: this.state.name,
      files: this.state.files,
      baseline: this.state.baseline,
      activeFile: this.state.activeFile,
      cases: this.state.cases,
      theme: this.state.theme,
      snapshots: this.state.snapshots.slice(-12),
      savedAt: new Date().toISOString(),
    };
  }
}
