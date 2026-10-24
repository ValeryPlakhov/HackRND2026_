import { Workspace } from "./lib/workspace.mjs";
import { WorkspaceStorage } from "./lib/storage.mjs";
import { StudioClient } from "./lib/client.mjs";
import {
  clone,
  debounce,
  downloadFile,
  escapeHtml as e,
  getSelectedInputs,
  uniqueId,
  clamp,
} from "./lib/core.mjs";
import { icon } from "./lib/icons.mjs";
import {
  CommandRegistry,
  projectSearchItems,
  searchItems,
} from "./lib/search.mjs";
import { flowSlice } from "./lib/layout.mjs";
import { validateCases, importCaseJson } from "./lib/inputs.mjs";
import {
  projectArchive,
  zipBytes,
  graphSvg,
  graphMermaid,
  graphDot,
  standaloneReport,
} from "./lib/export.mjs";
import { unifiedDiff } from "./lib/diff.mjs";
import { GraphWidget } from "./components/graph.mjs";
import { bindSourceEditor, focusSourceLine } from "./components/editor.mjs";
import {
  navigation,
  header,
  projectPanel,
  statusBar,
  NAVIGATION,
} from "./components/shell.mjs";
import { renderInspector } from "./components/inspector.mjs";
import { renderOverview } from "./views/overview.mjs";
import { renderCanvas } from "./views/canvas.mjs";
import { renderChanges } from "./views/changes.mjs";
import { renderTests } from "./views/tests.mjs";
import {
  renderArchitecture,
  architectureGraph,
} from "./views/architecture.mjs";
import { renderInsights } from "./views/insights.mjs";
import { renderHistory } from "./views/history.mjs";
import { renderPresentation } from "./views/presentation.mjs";
import { button, emptyState } from "./components/primitives.mjs";

const $ = (selector) => document.querySelector(selector);

class Studio {
  constructor() {
    this.client = new StudioClient();
    this.storage = new WorkspaceStorage();
    this.workspace = new Workspace();
    this.runtime = {
      online: false,
      demo: null,
      sampleId: "monolith",
      environment: null,
    };
    this.ui = {
      analyzing: false,
      analysisRevision: -1,
      methodQuery: "",
      findingQuery: "",
      changesTab: "plans",
      testsTab: "inputs",
      expandedPlans: new Set(),
      presentationSlide: 0,
      commandIndex: 0,
      commandResults: [],
    };
    this.graph = null;
    this.editorCleanup = null;
    this.analysisController = null;
    this.analysisSerial = 0;
    this.graphViews = new Map();
    this.analyzeLater = debounce(() => this.perform(() => this.analyze()), 700);
    this.saveLater = debounce(() => this.save(), 600);
    this.commands = this.createCommands();
    this.bindGlobal();
    this.bindWorkspace();
  }

  createCommands() {
    const commands = NAVIGATION.map((item) => ({
      id: `view-${item.id}`,
      title: item.label,
      icon: item.icon,
      category: "Навигация",
      keywords: item.short,
      run: () => this.workspace.navigate(item.id),
    }));
    commands.push(
      {
        id: "import",
        title: "Импортировать Java-проект",
        icon: "upload",
        run: () => this.importJava(),
      },
      {
        id: "verify",
        title: "Проверить поведение двух версий",
        icon: "play",
        shortcut: "Ctrl ↵",
        run: () => this.compare(),
      },
      {
        id: "plans",
        title: "Обновить предложения рефакторинга",
        icon: "sparkle",
        run: () => this.loadPlans(),
      },
      {
        id: "export",
        title: "Экспортировать evidence bundle",
        icon: "download",
        run: () => this.openExport(),
      },
      {
        id: "checkpoint",
        title: "Создать checkpoint исходников",
        icon: "bookmark",
        shortcut: "Ctrl S",
        run: () => this.checkpoint(),
      },
      {
        id: "theme",
        title: "Переключить светлую / тёмную тему",
        icon: "sun",
        run: () => this.toggleTheme(),
      },
      {
        id: "focus",
        title: "Переключить режим фокуса",
        icon: "focus",
        run: () => this.toggleFocus(),
      },
      {
        id: "generator",
        title: "Генератор граничных и случайных входов",
        icon: "sparkle",
        run: () => $("#generator-dialog").showModal(),
      },
      {
        id: "mutation",
        title: "Запустить mutation testing",
        icon: "beaker",
        run: () => this.mutate(),
      },
      {
        id: "benchmark",
        title: "Измерить метод до / после",
        icon: "chart",
        run: () => {
          this.ui.testsTab = "benchmark";
          this.workspace.navigate("tests");
        },
      },
    );
    return new CommandRegistry(commands);
  }

  bindWorkspace() {
    const workspace = this.workspace;
    workspace.events.on("source", () => {
      this.renderChrome();
      this.renderInspector();
      this.analyzeLater();
      this.saveLater();
    });
    for (const event of ["change", "import"])
      workspace.events.on(event, () => {
        this.render();
        this.saveLater();
        this.perform(() => this.analyze());
      });
    workspace.events.on("selection", () => {
      this.render();
      this.perform(() => this.loadDetailAndPlans());
      this.saveLater();
    });
    workspace.events.on("analysis", () => {
      this.render();
    });
    workspace.events.on("detail", () => {
      this.renderInspector();
    });
    workspace.events.on("cases", () => {
      this.ui.analysisRevision = workspace.state.revision;
      this.render();
      this.saveLater();
    });
    for (const event of ["navigate", "history", "result"])
      workspace.events.on(event, () => {
        this.render();
        this.saveLater();
      });
  }

  async boot() {
    const [connection, demo] = await Promise.all([
      this.client.connect(),
      fetch("studio-demo.json").then((response) => {
        if (!response.ok)
          throw new Error(
            "Не найден studio-demo.json. Выполните tests/prepare_studio_demo.py.",
          );
        return response.json();
      }),
    ]);
    this.runtime.online = Boolean(connection);
    this.runtime.environment = connection?.environment ?? null;
    this.runtime.demo = demo;
    const saved = this.storage.load();
    const preferences = this.storage.preferences();
    if (preferences.theme) this.workspace.state.theme = preferences.theme;
    if (saved?.savedAt && this.runtime.online) {
      this.workspace.state.name = saved.name;
      this.workspace.state.files = clone(saved.files);
      this.workspace.state.baseline = clone(saved.baseline);
      this.workspace.state.activeFile = saved.activeFile;
      this.workspace.state.cases = clone(saved.cases ?? []);
      this.workspace.state.snapshots = clone(saved.snapshots ?? []);
    } else {
      this.loadSample("monolith", false);
    }
    document.documentElement.dataset.theme = this.workspace.state.theme;
    $("#studio").hidden = false;
    $("#boot-screen").hidden = true;
    this.render();
    if (this.runtime.online) await this.analyze();
    else this.loadCachedAnalysis();
    this.save();
    if (connection?.environment?.runner === "disabled")
      this.notify(
        "Анализ включён. Для выполнения своих программ запустите start.ps1 -TrustedLocal.",
      );
  }

  async perform(operation) {
    try {
      return await operation();
    } catch (error) {
      if (
        error.name !== "AbortError" &&
        !["ABORTED", "CANCELLED"].includes(error.code)
      )
        this.notify(error.message ?? String(error), true);
      return null;
    }
  }

  notify(message, error = false) {
    const element = document.createElement("div");
    element.className = `notification ${error ? "error" : ""}`;
    element.innerHTML =
      icon(error ? "warning" : "check", "", 16) + `<span>${e(message)}</span>`;
    $("#notification-stack").append(element);
    setTimeout(() => element.remove(), error ? 9500 : 4300);
  }

  save() {
    const savedAt = this.storage.save(this.workspace);
    this.workspace.state.savedAt = savedAt;
    if (!savedAt && this.storage.lastError)
      this.notify(
        "Автосохранение недоступно. Экспортируйте проект в ZIP.",
        true,
      );
    this.renderStatus();
  }

  loadSample(id, notify = true) {
    const sample = this.runtime.demo.samples[id];
    if (!sample) throw new Error("Пример не найден");
    this.runtime.sampleId = id;
    const state = this.workspace.state;
    state.name = sample.title;
    state.files = clone(sample.before.files);
    state.baseline = clone(sample.before.files);
    state.activeFile = Object.keys(state.files)[0];
    state.activeMethod = null;
    state.cases = clone(sample.cases);
    state.demoStage = "before";
    state.project = clone(sample.before.project);
    state.report = null;
    state.reportJobId = null;
    state.benchmark = null;
    state.mutations = null;
    state.reduction = null;
    state.snapshots = [];
    state.selectedNode = null;
    state.selectedPlan = null;
    state.revision++;
    state.dirty = false;
    this.workspace.undoStack = [];
    this.workspace.redoStack = [];
    this.workspace.checkpoint("Исходный проект", false);
    this.ui.expandedPlans.clear();
    this.ui.methodQuery = "";
    this.ui.reducerInput = null;
    this.graphViews.clear();
    this.loadCachedAnalysis();
    if (notify) {
      this.render();
      this.save();
      if (this.runtime.online) this.perform(() => this.analyze());
      this.notify(`Открыт пример: ${sample.title}`);
    }
  }

  loadCachedAnalysis() {
    const sample = this.runtime.demo.samples[this.runtime.sampleId];
    const stage = sample[this.workspace.state.demoStage] ?? sample.before;
    const state = this.workspace.state;
    state.project = clone(stage.project);
    const methods = this.workspace.model?.methods ?? [];
    state.activeMethod =
      methods.find((method) => method.id === state.activeMethod)?.id ??
      methods.find((method) => method.name === sample.primaryMethod)?.id ??
      methods[0]?.id;
    state.detail = clone(
      stage.details?.[state.activeFile]?.[state.activeMethod] ?? null,
    );
    state.plans = clone(stage.plans?.[state.activeFile] ?? { plans: [] });
    this.ui.analysisRevision = state.revision;
  }

  async analyze() {
    if (!this.runtime.online) {
      this.loadCachedAnalysis();
      this.render();
      return;
    }
    this.analysisController?.abort();
    this.analysisController = new AbortController();
    const serial = ++this.analysisSerial;
    const revision = this.workspace.state.revision;
    this.ui.analyzing = true;
    this.renderStatus();
    try {
      const project = await this.client.analyze(
        clone(this.workspace.state.files),
        this.analysisController.signal,
      );
      if (serial !== this.analysisSerial) return;
      if (this.workspace.updateProject(project, revision)) {
        this.ui.analysisRevision = revision;
        await this.loadDetailAndPlans();
      }
    } finally {
      if (serial === this.analysisSerial) {
        this.ui.analyzing = false;
        this.renderStatus();
      }
    }
  }

  async loadDetailAndPlans() {
    if (!this.runtime.online) {
      this.loadCachedAnalysis();
      this.renderInspector();
      this.renderMain();
      return;
    }
    const method = this.workspace.method;
    if (!method) return;
    const revision = this.workspace.state.revision;
    const source = this.workspace.source;
    const methodId = method.id;
    const file = this.workspace.state.activeFile;
    const [detail, plans] = await Promise.all([
      this.client.detail(source, methodId),
      this.client.plans(source),
    ]);
    if (
      revision !== this.workspace.state.revision ||
      file !== this.workspace.state.activeFile
    )
      return;
    this.workspace.updateDetail(detail, revision, methodId);
    this.workspace.state.plans = plans;
    this.renderInspector();
    if (["changes", "overview"].includes(this.workspace.state.view))
      this.renderMain();
  }

  async loadPlans() {
    if (!this.runtime.online) {
      this.loadCachedAnalysis();
      this.render();
      return;
    }
    await this.loadDetailAndPlans();
    this.notify("Предложения привязаны к текущей версии исходника.");
  }

  render() {
    const shell = $("#studio");
    shell.classList.toggle("focus-mode", this.workspace.state.focusMode);
    shell.classList.toggle(
      "wide-view",
      !["overview", "canvas"].includes(this.workspace.state.view),
    );
    $("#navigation-rail").innerHTML = navigation(this.workspace.state);
    this.renderChrome();
    this.renderMain();
    this.renderInspector();
    this.renderStatus();
  }

  renderChrome() {
    $("#studio-header").innerHTML = header(this.workspace, this.runtime);
    const currentFilter = document.activeElement?.id === "method-filter";
    const cursor = currentFilter ? document.activeElement.selectionStart : null;
    $("#project-panel").innerHTML = projectPanel(
      this.workspace,
      this.runtime,
      this.ui,
    );
    if (currentFilter) {
      $("#method-filter").focus();
      $("#method-filter").setSelectionRange(cursor, cursor);
    }
  }

  renderStatus() {
    if (!$("#studio").hidden)
      $("#studio-status").innerHTML = statusBar(
        this.workspace,
        this.runtime,
        this.ui,
      );
  }

  renderInspector() {
    $("#studio-inspector").innerHTML = renderInspector(
      this.workspace,
      this.runtime,
    );
  }

  renderMain() {
    const focused =
      document.activeElement?.id === "source-input"
        ? {
            start: document.activeElement.selectionStart,
            end: document.activeElement.selectionEnd,
            top: document.activeElement.scrollTop,
            left: document.activeElement.scrollLeft,
          }
        : null;
    this.graph?.destroy();
    this.graph = null;
    this.editorCleanup?.();
    this.editorCleanup = null;
    const view = this.workspace.state.view;
    const renderers = {
      overview: renderOverview,
      canvas: renderCanvas,
      changes: renderChanges,
      tests: renderTests,
      architecture: renderArchitecture,
      insights: renderInsights,
      history: renderHistory,
      presentation: renderPresentation,
    };
    $("#studio-main").innerHTML = renderers[view](
      this.workspace,
      this.runtime,
      this.ui,
    );
    if (view === "canvas" && this.workspace.method) this.bindCanvas();
    if (focused && $("#source-input")) {
      const input = $("#source-input");
      input.focus({ preventScroll: true });
      input.setSelectionRange(focused.start, focused.end);
      input.scrollTop = focused.top;
      input.scrollLeft = focused.left;
      input.dispatchEvent(new Event("scroll"));
    }
    if (view === "architecture" && this.workspace.state.project) {
      this.graph = new GraphWidget(
        $("#architecture-graph-slot"),
        architectureGraph(this.workspace.state.project),
        {
          direction: "horizontal",
          onSelect: (node) => {
            if (node?.fileName) this.openMethod(node.fileName, node.methodId);
          },
        },
      );
    }
  }

  bindCanvas() {
    const state = this.workspace.state;
    const key = state.activeFile + "::" + this.workspace.method.id;
    const cached = this.graphViews.get(key);
    this.graph = new GraphWidget(
      $("#canvas-graph-slot"),
      this.workspace.method.graph,
      {
        direction: state.graphDirection,
        selected: state.selectedNode,
        view: cached?.view,
        positions: cached?.positions ?? {},
        onSelect: (node) => {
          state.selectedNode = node.id;
          this.renderInspector();
          if (node.line)
            focusSourceLine(
              $("#studio-main"),
              this.workspace.source,
              node.line,
            );
        },
        onEdit: (node) => this.perform(() => this.openNodeEditor(node)),
        onView: (view, positions) =>
          this.graphViews.set(key, {
            view: { ...view },
            positions: clone(positions),
          }),
      },
    );
    this.editorCleanup = bindSourceEditor($("#studio-main"), {
      onChange: (source) => this.workspace.setSource(source),
      onSave: () => this.checkpoint(),
    });
    const handle = $("#canvas-resize");
    handle.onpointerdown = (event) => {
      const start = event.clientY;
      const height = $(".canvas-code-slot").getBoundingClientRect().height;
      handle.setPointerCapture(event.pointerId);
      handle.onpointermove = (move) => {
        const next = clamp(
          height + start - move.clientY,
          130,
          $(".canvas-view").clientHeight - 240,
        );
        $("#studio").style.setProperty("--editor-height", next + "px");
      };
      handle.onpointerup = () => {
        handle.onpointermove = null;
        handle.onpointerup = null;
      };
    };
  }

  async openMethod(file, id) {
    this.workspace.state.activeFile = file;
    this.workspace.state.activeMethod = id;
    this.workspace.state.selectedNode = null;
    this.workspace.state.detail = null;
    this.workspace.state.view = "canvas";
    this.render();
    await this.loadDetailAndPlans();
  }

  async openFinding(index) {
    const finding = this.workspace.state.project.findings[index];
    if (!finding) return;
    const model = this.workspace.state.project.files[finding.fileName];
    const method =
      model.methods.find((item) => item.id === finding.methodId) ??
      model.methods[0];
    await this.openMethod(finding.fileName, method?.id);
    const node = this.workspace.method?.graph.nodes
      .filter((item) => item.start <= finding.start && item.end >= finding.end)
      .sort((a, b) => a.end - a.start - (b.end - b.start))[0];
    if (node) {
      this.graph.select(node.id);
      this.graph.center(node.id);
    } else
      focusSourceLine($("#studio-main"), this.workspace.source, finding.line);
  }

  async applyPlan(id) {
    const plans = this.workspace.state.plans;
    const plan = plans?.plans.find((item) => item.id === id);
    if (!plan) throw new Error("Предложение устарело. Обновите анализ.");
    if (!this.runtime.online) {
      const sample = this.runtime.demo.samples[this.runtime.sampleId];
      if (plan.rule !== sample.primaryPlanRule)
        throw new Error(
          "Для этого правила требуется локальный JVM-сервер. В обзоре доступен основной сохранённый патч примера.",
        );
      this.applyCachedStage("after", plan.title);
      this.notify(
        "Показан сохранённый результат преобразования. Запись gate доступна отдельно.",
      );
      return;
    }
    const response = await this.client.applyPlans(
      this.workspace.source,
      plans.sourceHash,
      [id],
    );
    const files = {
      ...this.workspace.state.files,
      [this.workspace.state.activeFile]: response.source,
    };
    this.workspace.applyFiles(files, plan.title);
    await this.analyze();
    this.ui.changesTab = "diff";
    this.renderMain();
    await this.compare();
  }

  applyCachedStage(stage, label) {
    const sample = this.runtime.demo.samples[this.runtime.sampleId];
    this.workspace.transaction(label, (state) => {
      state.files = clone(sample[stage].files);
      state.demoStage = stage;
    });
    this.loadCachedAnalysis();
    this.render();
  }

  async compare() {
    const errors = validateCases(this.workspace.state.cases);
    if (errors.length) throw new Error(errors.join(". "));
    this.ui.testsTab = "results";
    if (!this.runtime.online) {
      const sample = this.runtime.demo.samples[this.runtime.sampleId];
      if (this.workspace.state.demoStage !== "after")
        this.applyCachedStage(
          "after",
          "Открыт сохранённый оптимизированный сценарий",
        );
      this.workspace.state.cases = clone(sample.cases);
      this.workspace.updateResult(
        "compare",
        { ...clone(sample.report), recorded: true },
        this.workspace.state.revision,
      );
      this.workspace.navigate("tests");
      this.notify(
        "Открыта запись реального прогона для встроенных исходников и входов.",
      );
      return;
    }
    this.workspace.navigate("tests");
    await this.runJob("compare", {
      original: clone(this.workspace.state.baseline),
      candidate: clone(this.workspace.state.files),
      inputs: getSelectedInputs(this.workspace.state.cases),
    });
  }

  async runJob(kind, payload) {
    if (
      this.workspace.state.jobs.some((job) =>
        ["queued", "running"].includes(job.state),
      )
    ) {
      throw new Error("Дождитесь завершения или отмените текущее задание.");
    }
    const revision = this.workspace.state.revision;
    const result = await this.client.startJob(kind, payload, (job) => {
      const jobs = this.workspace.state.jobs;
      const index = jobs.findIndex((item) => item.id === job.id);
      if (index >= 0) jobs[index] = job;
      else jobs.unshift(job);
      this.workspace.state.jobs = jobs.slice(0, 12);
      this.renderChrome();
      this.renderInspector();
      this.renderStatus();
    });
    if (
      !this.workspace.updateResult(kind, result.result, revision, result.id)
    ) {
      this.notify(
        "Исходники или входы изменились во время запуска. Отчёт не привязан к текущей версии.",
        true,
      );
      return;
    }
    if (kind === "compare") {
      this.notify(
        result.result.passed
          ? "Quality gate: поведение совпало на всех выбранных входах."
          : "Quality gate обнаружил различие или ошибку сборки.",
        !result.result.passed,
      );
      this.workspace.checkpoint(
        result.result.passed ? "Quality gate PASS" : "Quality gate FAIL",
      );
    } else this.notify("Задание завершено. Результат доступен в Test Lab.");
  }

  async benchmark() {
    const methodName =
      $("#benchmark-method")?.value ||
      this.workspace.method?.name ||
      "countPairs";
    const sizes = ($("#benchmark-sizes")?.value || "128,512,2048")
      .split(",")
      .map((value) => Number(value.trim()));
    this.ui.testsTab = "benchmark";
    this.workspace.navigate("tests");
    if (!this.runtime.online)
      return this.cachedResult("benchmark", "benchmark");
    await this.runJob("benchmark", {
      original: clone(this.workspace.state.baseline),
      candidate: clone(this.workspace.state.files),
      fileName: this.workspace.state.activeFile,
      methodName,
      sizes,
      repetitions: 5,
    });
  }

  async mutate() {
    this.ui.testsTab = "mutation";
    this.workspace.navigate("tests");
    if (!this.runtime.online) return this.cachedResult("mutation", "mutations");
    if (!this.workspace.method) throw new Error("Выберите метод");
    await this.runJob("mutation", {
      files: clone(this.workspace.state.files),
      fileName: this.workspace.state.activeFile,
      methodId: this.workspace.method.id,
      inputs: getSelectedInputs(this.workspace.state.cases).slice(0, 5),
      maximum: 5,
    });
  }

  async minimize() {
    const input = $("#reducer-input")?.value ?? this.ui.reducerInput ?? "";
    this.ui.reducerInput = input;
    this.ui.testsTab = "reducer";
    this.workspace.navigate("tests");
    if (!this.runtime.online) return this.cachedResult("minimize", "reduction");
    await this.runJob("minimize", {
      original: clone(this.workspace.state.baseline),
      candidate: clone(this.workspace.state.files),
      input,
      budget: 16,
    });
  }

  cachedResult(kind, key) {
    const sample = this.runtime.demo.samples[this.runtime.sampleId];
    const result = sample[key];
    if (!result)
      throw new Error(
        "Для этого примера запись отсутствует. Запустите функцию в локальной версии.",
      );
    if (kind !== "minimize" && this.workspace.state.demoStage !== "after")
      this.applyCachedStage(
        "after",
        "Открыт сохранённый оптимизированный сценарий",
      );
    this.workspace.updateResult(
      kind,
      { ...clone(result), recorded: true },
      this.workspace.state.revision,
    );
    this.notify("Показан сохранённый результат реального JVM-запуска.");
  }

  importJava() {
    if (!this.runtime.online)
      throw new Error(
        "Для загрузки и разбора своих исходников запустите start-local.cmd и откройте localhost:8080.",
      );
    $("#java-file-input").click();
  }

  async generateInputs() {
    if (!this.runtime.online)
      throw new Error(
        "Генератор работает через локальный JVM-сервер. В обзоре доступны готовые примеры входов.",
      );
    const number = (id) => Number($(id).value);
    const response = await this.client.generate({
      schema: $("#generator-schema").value,
      seed: number("#generator-seed"),
      count: number("#generator-count"),
      maximumLength: number("#generator-length"),
      minimum: number("#generator-minimum"),
      maximum: number("#generator-maximum"),
    });
    this.workspace.setCases(response.cases);
    $("#generator-dialog").close();
    this.ui.testsTab = "inputs";
    this.workspace.navigate("tests");
    this.notify(
      `Создано ${response.cases.length} входов, seed ${response.seed}.`,
    );
  }

  openNodeEditor(node = null, action = "replace") {
    if (!this.runtime.online)
      throw new Error("Редактирование Java доступно в локальной версии.");
    if (this.ui.analysisRevision !== this.workspace.state.revision)
      throw new Error("Граф устарел после ввода. Дождитесь нового анализа.");
    node ??= this.workspace.method.graph.nodes.find(
      (item) => item.id === this.workspace.state.selectedNode,
    );
    if (!node || node.editStart < 0)
      throw new Error("Выберите редактируемый узел инструкции или условия.");
    this.editing = {
      node,
      action,
      revision: this.workspace.state.revision,
      methodId: this.workspace.method.id,
    };
    $("#edit-eyebrow").textContent =
      `${node.kind.toUpperCase()} / L${node.line} / ${action.toUpperCase()}`;
    $("#node-edit-code").value =
      action === "replace" ? node.editCode : 'System.out.println("trace");';
    $("#edit-dialog").showModal();
  }

  async applyNode() {
    const editing = this.editing;
    if (!editing || editing.revision !== this.workspace.state.revision)
      throw new Error("Исходник изменился после открытия редактора");
    const result = await this.client.edit(
      this.workspace.source,
      editing.methodId,
      editing.node.id,
      editing.action,
      $("#node-edit-code").value,
    );
    $("#edit-dialog").close();
    this.workspace.applyFiles(
      {
        ...this.workspace.state.files,
        [this.workspace.state.activeFile]: result.source,
      },
      `Правка узла L${editing.node.line}`,
    );
    await this.analyze();
    this.notify("Java обновлена. Текущая версия требует нового quality gate.");
  }

  async deleteNode() {
    if (!this.runtime.online) throw new Error("Нужен локальный JVM-сервер");
    const node = this.workspace.method?.graph.nodes.find(
      (item) => item.id === this.workspace.state.selectedNode,
    );
    if (!node) return;
    if (this.ui.analysisRevision !== this.workspace.state.revision)
      throw new Error("Дождитесь обновления графа");
    const result = await this.client.edit(
      this.workspace.source,
      this.workspace.method.id,
      node.id,
      "delete",
      "",
    );
    this.workspace.applyFiles(
      {
        ...this.workspace.state.files,
        [this.workspace.state.activeFile]: result.source,
      },
      `Удалена инструкция L${node.line}`,
    );
  }

  async extract() {
    if (!this.runtime.online)
      throw new Error("Декомпозиция выполняется в локальной версии");
    const result = await this.client.extract(
      this.workspace.state.files,
      this.workspace.state.activeFile,
      this.workspace.method.id,
    );
    this.workspace.applyFiles(
      result.files,
      `Выделен ${this.workspace.method.name} в BlueprintFunctions`,
    );
    this.notify("Сборка после переноса прошла. Проверьте поведение проекта.");
  }

  checkpoint() {
    this.workspace.checkpoint(
      `Checkpoint · ${new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`,
    );
    this.save();
    this.notify("Снимок исходников сохранён в истории.");
  }

  toggleTheme() {
    const state = this.workspace.state;
    state.theme = state.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = state.theme;
    this.storage.savePreferences({ theme: state.theme });
    this.renderChrome();
    $("#navigation-rail").innerHTML = navigation(state);
  }

  toggleFocus() {
    this.workspace.state.focusMode = !this.workspace.state.focusMode;
    $("#studio").classList.toggle("focus-mode", this.workspace.state.focusMode);
    requestAnimationFrame(() => this.graph?.fit());
  }

  openExport() {
    const options = [
      [
        "archive",
        "Evidence bundle / ZIP",
        "Эталон, кандидат, входы, patch, отчёты и manifest",
        "shield",
      ],
      [
        "patch",
        "Unified diff / .patch",
        "Изменения Java относительно выбранного эталона",
        "diff",
      ],
      [
        "report",
        "HTML-отчёт",
        "Автономный отчёт для просмотра и печати",
        "file",
      ],
      [
        "sarif",
        "Диагностика / SARIF 2.1",
        "Результаты анализа в стандартном формате",
        "target",
      ],
      ["svg", "Граф / SVG", "Векторное изображение текущего графа", "nodes"],
      [
        "mermaid",
        "Граф / Mermaid + DOT",
        "Редактируемое описание связей",
        "code",
      ],
    ];
    $("#export-options").innerHTML = options
      .map(
        ([id, title, detail, name]) =>
          `<button class="export-option" data-action="do-export" data-format="${id}">${icon(name, "", 22)}<span><strong>${e(title)}</strong><small>${e(detail)}</small></span>${icon("download", "", 16)}</button>`,
      )
      .join("");
    $("#export-dialog").showModal();
  }

  async doExport(format) {
    const state = this.workspace.state;
    if (format === "archive") {
      let evidence = null;
      if (this.runtime.online)
        evidence = await this.client.evidence(
          state.baseline,
          state.files,
          state.reportJobId,
        );
      downloadFile(
        "blueprints-evidence.zip",
        projectArchive(state, evidence),
        "application/zip",
      );
    } else if (format === "patch") {
      const names = [
        ...new Set([
          ...Object.keys(state.baseline),
          ...Object.keys(state.files),
        ]),
      ].sort();
      downloadFile(
        "blueprints-changes.patch",
        names
          .map((name) =>
            unifiedDiff(
              name,
              state.baseline[name] ?? "",
              state.files[name] ?? "",
            ),
          )
          .join("\n"),
        "text/plain",
      );
    } else if (format === "report") {
      downloadFile(
        "blueprints-report.html",
        standaloneReport(state, null),
        "text/html",
      );
    } else if (format === "sarif") {
      const sarif = this.runtime.online
        ? await this.client.sarif(state.files)
        : this.runtime.demo.samples[this.runtime.sampleId][state.demoStage]
            ?.sarif;
      if (!sarif) throw new Error("Для SARIF-экспорта нужен локальный сервер");
      downloadFile(
        "blueprints-analysis.sarif",
        JSON.stringify(sarif, null, 2),
        "application/json",
      );
    } else {
      if (!this.workspace.method) throw new Error("Выберите метод");
      const { layoutGraph } = await import("./lib/layout.mjs");
      const layout =
        this.graph?.layout ?? layoutGraph(this.workspace.method.graph);
      if (format === "svg")
        downloadFile("blueprints-graph.svg", graphSvg(layout), "image/svg+xml");
      else
        downloadFile(
          "blueprints-graph-sources.zip",
          zipBytes({
            "graph.mmd": graphMermaid(layout),
            "graph.dot": graphDot(layout),
          }),
          "application/zip",
        );
    }
    $("#export-dialog").close();
    this.notify("Экспорт подготовлен.");
  }

  openCommands() {
    this.ui.commandIndex = 0;
    $("#command-query").value = "";
    $("#command-search-icon").innerHTML = icon("search", "", 20);
    this.renderCommands();
    $("#command-dialog").showModal();
    $("#command-query").focus();
  }

  renderCommands() {
    const query = $("#command-query").value;
    const commands = this.commands
      .list(query)
      .map((command) => ({ ...command, kind: "command" }));
    const code = query
      ? searchItems(projectSearchItems(this.workspace.state.project), query, 12)
      : [];
    this.ui.commandResults = [...commands.slice(0, query ? 6 : 12), ...code];
    this.ui.commandIndex = clamp(
      this.ui.commandIndex,
      0,
      Math.max(0, this.ui.commandResults.length - 1),
    );
    $("#command-results").innerHTML =
      this.ui.commandResults
        .map(
          (result, index) =>
            `<button class="command-result ${index === this.ui.commandIndex ? "active" : ""}" data-action="execute-command-result" data-index="${index}">${icon(result.icon ?? (result.kind === "method" ? "method" : result.kind === "finding" ? "target" : "file"), "", 18)}<span>${e(result.title)}<small>${e(result.category ?? result.fileName ?? "Команда")}${result.line ? ` · L${result.line}` : ""}</small></span>${result.shortcut ? `<kbd>${e(result.shortcut)}</kbd>` : icon("arrow", "muted", 13)}</button>`,
        )
        .join("") ||
      '<div class="empty-state" style="min-height:150px">Ничего не найдено</div>';
  }

  async executeCommand(index) {
    const result = this.ui.commandResults[index];
    if (!result) return;
    $("#command-dialog").close();
    if (result.kind === "command") await this.commands.execute(result.id, this);
    else if (result.kind === "method")
      await this.openMethod(result.fileName, result.methodId);
    else if (result.kind === "file") {
      this.workspace.selectFile(result.fileName);
      this.workspace.navigate("canvas");
    } else if (result.kind === "finding")
      await this.openFinding(
        this.workspace.state.project.findings.findIndex(
          (finding) =>
            finding === result ||
            (finding.fileName === result.fileName &&
              finding.start === result.start &&
              finding.rule === result.rule),
        ),
      );
  }

  async action(name, element) {
    const data = element.dataset;
    const state = this.workspace.state;
    switch (name) {
      case "navigate":
        this.workspace.navigate(data.view);
        break;
      case "select-file":
        this.workspace.selectFile(data.file);
        break;
      case "select-method":
        this.workspace.selectMethod(data.method);
        break;
      case "open-method":
        await this.openMethod(data.file, data.method);
        break;
      case "open-finding":
        await this.openFinding(Number(data.index));
        break;
      case "import":
        this.importJava();
        break;
      case "export":
        this.openExport();
        break;
      case "analyze":
        await this.analyze();
        break;
      case "run-compare":
        await this.compare();
        break;
      case "run-benchmark":
        await this.benchmark();
        break;
      case "run-mutation":
        await this.mutate();
        break;
      case "run-reducer":
        await this.minimize();
        break;
      case "command-palette":
        this.openCommands();
        break;
      case "execute-command-result":
        await this.executeCommand(Number(data.index));
        break;
      case "load-sample":
        this.loadSample($("#sample-picker").value);
        break;
      case "load-plans":
        await this.loadPlans();
        break;
      case "apply-plan":
        await this.applyPlan(data.id);
        break;
      case "toggle-plan":
        this.ui.expandedPlans.has(data.id)
          ? this.ui.expandedPlans.delete(data.id)
          : this.ui.expandedPlans.add(data.id);
        this.renderMain();
        break;
      case "changes-tab":
        this.ui.changesTab = data.id;
        this.renderMain();
        break;
      case "tests-tab":
        this.ui.testsTab = data.id;
        this.renderMain();
        break;
      case "inspector-tab":
        state.inspector = data.id;
        this.renderInspector();
        break;
      case "toggle-theme":
        this.toggleTheme();
        break;
      case "toggle-focus":
        this.toggleFocus();
        break;
      case "toggle-project":
        $("#studio").classList.toggle("project-open");
        break;
      case "toggle-inspector":
        $("#studio").classList.toggle("inspector-open");
        break;
      case "help":
        $("#help-dialog").showModal();
        break;
      case "close-dialog":
        document.getElementById(data.dialog).close();
        break;
      case "checkpoint":
        this.checkpoint();
        break;
      case "restore-snapshot":
        this.workspace.restore(data.id);
        break;
      case "export-snapshot": {
        const snapshot = state.snapshots.find((item) => item.id === data.id);
        if (snapshot)
          downloadFile(
            "blueprints-checkpoint.zip",
            zipBytes(snapshot.files),
            "application/zip",
          );
        break;
      }
      case "undo":
        if (!this.workspace.undo()) this.notify("Нет изменений для отмены.");
        break;
      case "redo":
        if (!this.workspace.redo()) this.notify("Нет изменений для повтора.");
        break;
      case "graph-fit":
        this.graph?.fit();
        break;
      case "graph-zoom-in":
        this.graph?.zoom(1.18);
        break;
      case "graph-zoom-out":
        this.graph?.zoom(1 / 1.18);
        break;
      case "graph-direction":
        state.graphDirection =
          state.graphDirection === "vertical" ? "horizontal" : "vertical";
        this.graphViews.clear();
        this.renderMain();
        break;
      case "export-graph":
        await this.doExport("svg");
        break;
      case "slice-variable":
        this.graph?.highlight(flowSlice(state.detail, data.name));
        break;
      case "clear-slice":
        this.graph?.highlight(null);
        break;
      case "edit-node":
        this.openNodeEditor();
        break;
      case "insert-before":
        this.openNodeEditor(null, "before");
        break;
      case "insert-after":
        this.openNodeEditor(null, "after");
        break;
      case "delete-node":
        await this.deleteNode();
        break;
      case "apply-node":
        await this.applyNode();
        break;
      case "extract":
        await this.extract();
        break;
      case "open-generator":
        $("#generator-dialog").showModal();
        break;
      case "generate-inputs":
        await this.generateInputs();
        break;
      case "import-cases":
        $("#case-file-input").click();
        break;
      case "add-case":
        this.workspace.setCases([
          ...state.cases,
          {
            id: uniqueId("case"),
            name: `Вход ${state.cases.length + 1}`,
            input: "",
            enabled: true,
            category: "manual",
          },
        ]);
        break;
      case "delete-case":
        this.workspace.setCases(
          state.cases.filter((item) => item.id !== data.id),
        );
        break;
      case "reduce-failure":
        this.ui.reducerInput = state.report.tests[Number(data.index)].input;
        this.ui.testsTab = "reducer";
        this.renderMain();
        break;
      case "cancel-job":
        await this.client.cancelJob(data.id);
        break;
      case "copy-source":
        await navigator.clipboard.writeText(this.workspace.source);
        this.notify("Исходник скопирован.");
        break;
      case "export-patch":
        await this.doExport("patch");
        break;
      case "export-sarif":
        await this.doExport("sarif");
        break;
      case "do-export":
        await this.doExport(data.format);
        break;
      case "presentation-next":
        this.ui.presentationSlide = Math.min(5, this.ui.presentationSlide + 1);
        this.renderMain();
        break;
      case "presentation-previous":
        this.ui.presentationSlide = Math.max(0, this.ui.presentationSlide - 1);
        this.renderMain();
        break;
      case "presentation-slide":
        this.ui.presentationSlide = Number(data.index);
        this.renderMain();
        break;
      default:
        throw new Error(`Неизвестное действие: ${name}`);
    }
  }

  bindGlobal() {
    document.addEventListener("click", (event) => {
      const element = event.target.closest?.("[data-action]");
      if (element && !element.disabled)
        this.perform(() => this.action(element.dataset.action, element));
    });
    document.addEventListener("input", (event) => {
      if (event.target.id === "method-filter") {
        this.ui.methodQuery = event.target.value;
        this.renderChrome();
      } else if (event.target.id === "graph-search")
        this.graph?.filter(event.target.value);
      else if (event.target.id === "command-query") {
        this.ui.commandIndex = 0;
        this.renderCommands();
      } else if (event.target.id === "finding-query") {
        const input = event.target;
        const position = input.selectionStart;
        this.ui.findingQuery = input.value;
        this.renderMain();
        $("#finding-query").focus();
        $("#finding-query").setSelectionRange(position, position);
      }
    });
    document.addEventListener("change", (event) => {
      if (event.target.id === "canvas-method")
        this.workspace.selectMethod(event.target.value);
      if (
        event.target.matches(".case-enabled,.test-case-name,.test-case-input")
      ) {
        const cases = clone(this.workspace.state.cases);
        const item = cases.find(
          (candidate) => candidate.id === event.target.dataset.case,
        );
        if (!item) return;
        if (event.target.matches(".case-enabled"))
          item.enabled = event.target.checked;
        if (event.target.matches(".test-case-name"))
          item.name = event.target.value;
        if (event.target.matches(".test-case-input"))
          item.input = event.target.value;
        this.perform(() => this.workspace.setCases(cases));
      }
    });
    $("#java-file-input").addEventListener("change", (event) =>
      this.perform(async () => {
        const selected = [...event.target.files];
        if (!selected.length) return;
        const files = {};
        for (const file of selected) {
          if (Object.hasOwn(files, file.name))
            throw new Error(`Повтор имени файла: ${file.name}`);
          files[file.name] = await file.text();
        }
        this.workspace.importFiles(files);
        this.workspace.navigate("canvas");
        event.target.value = "";
      }),
    );
    $("#case-file-input").addEventListener("change", (event) =>
      this.perform(async () => {
        const file = event.target.files[0];
        if (file) this.workspace.setCases(importCaseJson(await file.text()));
        event.target.value = "";
      }),
    );
    document.addEventListener("keydown", (event) => {
      if (event.defaultPrevented) return;
      if ($("#command-dialog").open) {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          this.ui.commandIndex = clamp(
            this.ui.commandIndex + (event.key === "ArrowDown" ? 1 : -1),
            0,
            this.ui.commandResults.length - 1,
          );
          this.renderCommands();
          $(".command-result.active")?.scrollIntoView({ block: "nearest" });
        } else if (event.key === "Enter") {
          event.preventDefault();
          this.perform(() => this.executeCommand(this.ui.commandIndex));
        }
        return;
      }
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === "k") {
        event.preventDefault();
        this.openCommands();
      } else if (key === "enter") {
        event.preventDefault();
        this.perform(() => this.compare());
      } else if (key === "s") {
        event.preventDefault();
        this.checkpoint();
      } else if (
        key === "z" &&
        !["TEXTAREA", "INPUT"].includes(event.target.tagName)
      ) {
        event.preventDefault();
        event.shiftKey ? this.workspace.redo() : this.workspace.undo();
      }
    });
    window.addEventListener("beforeunload", () => this.save());
  }
}

const studio = new Studio();
studio.boot().catch((error) => {
  $("#boot-message").textContent = error.message;
  $(".boot-track").hidden = true;
  studio.notify(error.message, true);
});
