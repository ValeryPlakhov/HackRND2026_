import { createBridge } from "./bridge.mjs";
import { DocumentStore } from "./documents.mjs";
import { SourceEditor, editorShell } from "./editor.mjs";
import { CommandPalette } from "./palette.mjs";
import { availableCommands, shortcutCommand } from "./commands.mjs";
import { JAVA_FILE_TEMPLATES } from "./language.mjs";
import { StudioClient } from "../lib/client.mjs";
import { zipBytes } from "../lib/export.mjs";
import { BlueprintEditor } from "../blueprint/editor.mjs";
import { GraphWidget, graphShell } from "../components/graph.mjs";
import { autoLayout } from "../blueprint/layout.mjs";
import { generate, CodegenError } from "../blueprint/codegen.mjs";
import {
  escapeHtml as e,
  $,
  $$,
  debounce,
  basename,
  dirname,
  safeRelative,
  download,
  readableError,
  delay,
  clamp,
  positionAt,
  normalizeEol,
} from "./core.mjs";
import * as view from "./views.mjs";
import { QualityLab } from "./quality.mjs";
import { nodeFindings } from "./quality-views.mjs";
import * as ws from "./workspace.mjs";
import { toolsMenuHtml, filterTools } from "./tools.mjs";
import { TOUR_STEPS, welcomeHtml, tourHtml, guideHtml } from "./learning.mjs";

const DEFAULT_SETTINGS = {
  theme: "light",
  fontSize: 14,
  tabSize: 4,
  autoAnalyse: true,
  wordWrap: false,
  restoreSession: true,
  reduceMotion: false,
  showWhitespace: false,
  graphDirection: "TB",
  editorView: "blueprint",
  explorerWidth: 248,
  panelHeight: 210,
};

export class IdeApplication {
  constructor(root, bridge = createBridge()) {
    this.root = root;
    this.bridge = bridge;
    this.client = new StudioClient();
    this.documents = new DocumentStore();
    this.project = null;
    this.bootInfo = {};
    this.settings = { ...DEFAULT_SETTINGS };
    this.recent = [];
    this.tree = new Map();
    this.expanded = new Set();
    this.selectedPath = null;
    this.sidebar = "explorer";
    this.sidebarHidden = false;
    this.panel = "output";
    this.panelHidden = true;
    this.mode = "blueprint";
    this.home = false;
    this.workspace = "overview";
    this.toolsOpen = false;
    this.notices = [];
    this.unread = 0;
    this.noticesOpen = false;
    this.treeExpanded = new Set();
    this.treeTouched = false;
    this.navStack = [];
    this.blueprintEditing = false;
    this.editor = null;
    this.graph = null;
    this.selectedNode = null;
    this.analysing = new Set();
    this.analysisControllers = new Map();
    this.searchState = {
      query: "",
      include: "",
      replacement: "",
      caseSensitive: false,
      wholeWord: false,
      result: null,
      busy: false,
    };
    this.gitState = null;
    this.historyEntries = [];
    this.overviewState = null;
    this.runConfig = { mainClass: "", input: "" };
    this.taskState = null;
    this.taskOutdated = false;
    this.taskTimer = null;
    this.modalContext = null;
    this.saving = new Set();
    this.watchQueue = Promise.resolve();
    this.sessionSoon = debounce(() => this.saveSession(), 350);
    this.analyseSoon = debounce(
      (document) => this.safe(() => this.analyse(document)),
      650,
    );
    this.overviewSoon = debounce(() => {
      this.overviewState = null;
    }, 1000);
    this.controller = new AbortController();
    this.followCaretSoon = debounce(() => this.safe(() => this.followCaret()), 150);
    this.quality = new QualityLab(this);
  }

  async start() {
    this.root.innerHTML = view.shell();
    this.dialog = $("#ide-dialog");
    this.palette = new CommandPalette(this.dialog, (item, mode) =>
      this.safe(() =>
        mode === "files" ? this.openFile(item.path) : this.action(item.id),
      ),
    );
    this.bind();
    // On a narrow window (or a zoomed-in page) the file panel is an overlay that starts closed.
    const narrow = matchMedia("(max-width: 900px)");
    this.sidebarHidden = true;
    narrow.addEventListener("change", (event) => {
      if (event.matches) this.sidebarHidden = true;
      this.renderSidebar();
    });
    this.documents.changed.subscribe((event) => this.documentChanged(event));
    this.bridge.filesChanged.subscribe((event) => {
      this.watchQueue = this.watchQueue
        .then(() => this.filesChanged(event))
        .catch((error) => this.notify(readableError(error), "error"));
    });
    this.bridge.taskChanged.subscribe((task) => this.updateTask(task));
    this.bridge.command.subscribe((command) =>
      this.safe(() => this.action(command.name)),
    );
    this.bootInfo = await this.bridge.boot();
    this.settings = { ...DEFAULT_SETTINGS, ...this.bootInfo.settings };
    this.mode = this.settings.editorView;
    this.recent = this.bootInfo.recent ?? [];
    this.applySettings();
    this.renderAll();
    await this.client.connect();
    if (!this.client.online)
      this.notify(
        "Java-сервис пока недоступен. Чтение и редактирование файлов доступны; схемы требуют локальный Java-сервис.",
        "warning",
        10000,
      );
    if (new URLSearchParams(location.search).get("demo") === "1")
      await this.adopt(await this.bridge.demo());
    this.root.dataset.ready = "true";
    if (!this.settings.onboardingSeen) this.showModal(welcomeHtml());
  }

  async acknowledgeWelcome() {
    this.settings.onboardingSeen = true;
    await this.bridge.settings(this.settings);
    this.closeModal();
  }

  async startLearning() {
    await this.acknowledgeWelcome();
    if (!this.project) await this.adopt(await this.bridge.openExample("shop-monolith"));
    this.learningStep = 0;
    await this.showLearningStep();
  }

  async showLearningStep() {
    const step = TOUR_STEPS[this.learningStep];
    if (!step) return this.endLearning();
    this.closeTools();
    if (step.workspace === "method") {
      const file = this.documents.active;
      if (file && !file.currentModel) await this.analyse(file);
      if (file && !file.selectedMethod()) {
        const first = file.currentModel?.methods?.[0];
        if (first) file.methodId = first.id;
      }
      this.blueprintEditing = Boolean(step.blocks);
    }
    if (step.workspace === "verify") this.quality.tab = "inputs";
    this.setWorkspace(step.workspace);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    this.root.querySelectorAll(".ux-tour-target").forEach((node) => node.classList.remove("ux-tour-target"));
    $(step.target, this.root)?.classList.add("ux-tour-target");
    let host = $("#ux-learning", this.root);
    if (!host) { host = document.createElement("div"); host.id = "ux-learning"; this.root.append(host); }
    host.innerHTML = tourHtml(this.learningStep);
    $(".ux-tour", host)?.focus({ preventScroll: true });
  }

  endLearning() {
    $("#ux-learning", this.root)?.remove();
    this.root.querySelectorAll(".ux-tour-target").forEach((node) => node.classList.remove("ux-tour-target"));
    this.learningStep = null;
    $("[data-action=guide]", this.root)?.focus();
  }

  toggleFocus() {
    this.focusMode = !this.focusMode;
    $(".ide-shell", this.root).classList.toggle("ux-focus", this.focusMode);
    this.renderToolbar();
    requestAnimationFrame(() => this.graph?.fit?.());
  }

  async safe(operation) {
    try {
      return await operation();
    } catch (error) {
      this.notify(
        readableError(error),
        error?.code === "CONFLICT" ? "warning" : "error",
      );
      return null;
    }
  }

  /** Every message goes to one place: the bell in the top bar. Nothing floats over the work area. */
  notify(message, kind = "info") {
    const level = kind === "ok" ? "success" : kind;
    this.notices.unshift({ id: crypto.randomUUID(), message: String(message), kind: level, time: Date.now() });
    this.notices.length = Math.min(this.notices.length, 100);
    if (this.noticesOpen) this.renderNotices();
    else this.unread++;
    const live = $("#ide-notifications");
    if (live) live.textContent = String(message);
    const bell = $(".ide-bell", this.root);
    if (!this.noticesOpen) this.refreshBell(true);
    else bell?.classList.remove("pulse");
  }

  noticeState() {
    return { unread: this.unread, error: this.notices.slice(0, this.unread).some((item) => item.kind === "error" || item.kind === "warning") };
  }

  refreshBell(pulse = false) {
    const target = $("#ide-title-actions", this.root);
    if (!target) return;
    this.renderToolbar();
    if (pulse) {
      const bell = $(".ide-bell", this.root);
      bell?.classList.add("pulse");
      setTimeout(() => bell?.classList.remove("pulse"), 1400);
    }
  }

  renderNotices() {
    $("#ide-notify-panel", this.root).innerHTML = view.notifyPanelHtml(this.notices);
  }

  openNotices() {
    this.closeTools();
    this.noticesOpen = true;
    this.unread = 0;
    this.renderNotices();
    $("#ide-notify-panel", this.root).hidden = false;
    this.renderToolbar();
  }

  closeNotices() {
    if (!this.noticesOpen) return;
    this.noticesOpen = false;
    $("#ide-notify-panel", this.root).hidden = true;
    this.renderToolbar();
  }

  /** The slim bar under the top bar: shown while anything is being analysed, checked or run. */
  renderLoader() {
    const loader = $("#ide-loader", this.root);
    if (!loader) return;
    const job = this.quality.job && ["queued", "running"].includes(this.quality.job.state);
    loader.hidden = !(job || this.quality.analysing || this.quality.projectPlansLoading || this.analysing.size || this.busy);
  }

  get busy() {
    return (
      this.taskState && ["queued", "running"].includes(this.taskState.status)
    );
  }

  applySettings() {
    const dark =
      this.settings.theme === "dark" ||
      (this.settings.theme === "system" &&
        matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.classList.toggle(
      "reduce-motion",
      this.settings.reduceMotion,
    );
    this.root.style.setProperty(
      "--sidebar-width",
      this.settings.explorerWidth + "px",
    );
    this.root.style.setProperty(
      "--panel-height",
      this.settings.panelHeight + "px",
    );
    this.editor?.setSettings(this.settings);
  }

  renderAll() {
    this.renderWorkspaceNav();
    this.renderTabs();
    this.renderToolbar();
    this.renderSidebar();
    this.renderCenter();
    this.renderPanel();
    this.renderStatus();
  }
  renderTabs() {
    const tabs = $("#ide-tabs", this.root);
    tabs.innerHTML = view.tabs(this.documents);
    tabs.hidden = this.documents.tabs.length < 2;
  }
  get workspace() {
    return this._workspace;
  }

  /** Choosing a mode always leaves the home screen. */
  set workspace(value) {
    this._workspace = value;
    this.home = false;
  }

  goHome() {
    this.closeTools();
    this.home = true;
    this.renderWorkspaceNav();
    this.renderTabs();
    this.renderToolbar();
    this.renderCenter();
    this.renderStatus();
  }

  // ---------- code → diagram ----------

  /** The block or step whose code contains the caret is selected on the diagram (the reverse of block → code). */
  async followCaret() {
    const file = this.documents.active;
    if (this.workspace !== "method" || this.home || !file?.currentModel || !this.editor || this.mode === "code") return;
    const offset = this.editor.input.selectionStart;
    const method = file.currentModel.methods
      .filter((item) => item.start <= offset && item.end >= offset)
      .sort((a, b) => a.end - a.start - (b.end - b.start))[0];
    if (!method) return;
    if (method.id !== file.methodId) {
      // The caret moved into another method: show that method's diagram.
      file.methodId = method.id;
      file.selectedNode = null;
      await this.renderGraph();
      await this.blueprintReady;
    }
    const smallest = (nodes, accept) =>
      nodes
        .filter((node) => accept(node) && node.start >= 0 && node.start <= offset && node.end >= offset)
        .sort((a, b) => a.end - a.start - (b.end - b.start))[0];
    if (this.graph instanceof BlueprintEditor) {
      const node = smallest(this.graph.graph.nodes, (item) => item.type !== "entry");
      if (node) this.graph.highlightNode(node.id);
    } else if (this.graph?.layout) {
      const node = smallest(this.graph.layout.nodes, (item) => !["entry", "exit"].includes(item.kind));
      if (node) this.graph.focusNode(node.id);
    }
  }

  // ---------- tools menu ----------

  toolsState() {
    const file = this.documents.active;
    const stats = this.quality.analysis?.stats;
    return {
      project: this.project,
      document: file,
      method: this.workspace === "method" ? file?.selectedMethod?.() ?? null : null,
      workspace: this.workspace,
      home: this.home,
      summary: stats ? `${stats.files} файлов · ${stats.methods} методов · ${stats.lines} строк` : "",
    };
  }

  openTools(group = null) {
    this.closeNotices();
    this.root.classList.remove("ux-help-open");
    const menu = $("#ide-tools-menu", this.root);
    menu.innerHTML = toolsMenuHtml(this.toolsState(), group === "help" ? "help" : "actions");
    menu.setAttribute("aria-label", group === "help" ? "Помощь" : "Действия");
    menu.querySelectorAll(".tool-group").forEach((item) => { item.hidden = Boolean(group && item.dataset.group !== group && !(group === "check" && item.dataset.group === "run")); });
    this.toolsGroup = group;
    menu.hidden = false;
    this.toolsOpen = true;
    $$("[data-action=tool-group]", this.root).forEach((item) => item.setAttribute("aria-expanded", String(item.dataset.group === group)));
    $("#ide-tools-trigger", this.root).setAttribute("aria-expanded", String(group !== "help"));
    $("[data-action=help-menu]", this.root)?.setAttribute("aria-expanded", String(group === "help"));
    requestAnimationFrame(() => $("button:not(:disabled)", menu)?.focus());
  }

  closeTools() {
    if (!this.toolsOpen) return;
    this.toolsOpen = false;
    this.toolsGroup = null;
    this.root.classList.remove("ux-help-open");
    $$("[data-action=tool-group]", this.root).forEach((item) => item.setAttribute("aria-expanded", "false"));
    $("#ide-tools-menu", this.root).hidden = true;
    $("#ide-tools-trigger", this.root)?.setAttribute("aria-expanded", "false");
    $("[data-action=help-menu]", this.root)?.setAttribute("aria-expanded", "false");
  }

  renderToolbar() {
    $("#ide-title-actions", this.root).innerHTML = view.titleActions(this.project, this.busy, this.noticeState());
    this.renderLoader();
    $("#ide-toolbar", this.root).innerHTML = view.toolbar(
      this.workspace === "method" ? this.documents.active : null,
      this.mode,
      this.project,
      this.busy,
      this.documents.active?.currentModel ? this.methodContext(this.documents.active, this.documents.active.selectedMethod()) : "",
    );
    $("#ide-toolbar", this.root).hidden = this.workspace !== "method" || this.home || !this.project;
    const sidebarToggle = $("#ide-toolbar [data-action=toggle-sidebar]", this.root);
    sidebarToggle?.setAttribute("aria-expanded", String(!this.sidebarHidden));
  }

  renderSidebar() {
    $(".ide-shell", this.root).classList.toggle(
      "sidebar-hidden",
      this.sidebarHidden,
    );
    $$(".sidebar-tab", this.root).forEach((item) => {
      const active = item.dataset.view === this.sidebar;
      item.classList.toggle("active", active);
      item.setAttribute("aria-selected", String(active));
    });
    const actions = $("#ide-sidebar-actions", this.root);
    actions.innerHTML =
      this.sidebar === "explorer" && this.project
        ? view.iconButton("new-file", "Новый файл", "plus") +
          view.iconButton("refresh-tree", "Обновить дерево", "loop") +
          view.iconButton("explorer-menu", "Действия с файлами", "settings")
        : this.sidebar === "git"
          ? view.iconButton("refresh-git", "Обновить Git", "loop")
          : this.sidebar === "history"
            ? view.iconButton("refresh-history", "Обновить историю", "loop")
            : "";
    const body = $("#ide-sidebar-body", this.root);
    if (this.sidebar === "explorer")
      body.innerHTML = view.projectTree(
        this.project,
        this.tree,
        this.expanded,
        this.documents.activePath,
        this.selectedPath,
      );
    if (this.sidebar === "search")
      body.innerHTML = this.project
        ? view.searchSidebar(this.searchState)
        : view.projectTree(null);
    if (this.sidebar === "outline")
      body.innerHTML = view.outlineSidebar(this.documents.active);
    if (this.sidebar === "history")
      body.innerHTML = view.historySidebar(
        this.documents.active,
        this.historyEntries,
        false,
      );
  }

  disposeCenter() {
    this.editor?.destroy();
    this.editor = null;
    this.graph?.destroy();
    this.graph = null;
  }

  // ---------- workspaces ----------

  workspaceTasks() {
    return ws.buildTasks(this.quality.analysis, this.quality.projectPlans ?? {}, this.quality.hiddenRules);
  }

  renderWorkspaceNav() {
    const target = $("#ide-workspaces", this.root);
    if (!target) return;
    $(".ide-shell", this.root).dataset.workspace = !this.project ? "none" : this.home ? "home" : this.workspace;
    if (!this.project) return (target.innerHTML = "");
    const tasks = this.quality.analysis ? this.workspaceTasks() : null;
    target.innerHTML = ws.workspaceNav(this.home ? null : this.workspace, {
      tasks: tasks ? tasks.risks.length + tasks.performance.length + tasks.faster.length : 0,
    });
  }

  workspaceState() {
    const quality = this.quality;
    return {
      project: this.project,
      analysis: quality.analysis,
      analysing: quality.analysing,
      error: quality.analysisError,
      report: quality.report,
      stale: quality.reportStale,
      job: quality.job,
      pending: quality.pending,
      cases: quality.cases,
      baseline: quality.baseline,
      expanded: this.treeExpanded,
      plansLoading: quality.projectPlansLoading,
      showAdvice: this.showAdvice,
      tasks: quality.analysis ? this.workspaceTasks() : null,
    };
  }

  /** Re-renders the active non-editor workspace in place (keeps scroll and the verify inputs' focus). */
  renderWorkspace() {
    this.renderWorkspaceNav();
    this.renderLoader();
    if (!this.project || this.workspace === "method") return;
    const target = $("#ide-content", this.root);
    if (!target) return;
    if (!target.querySelector(`[data-ws="${this.workspace}"]`)) return this.renderCenter();
    if (this.workspace === "verify") {
      const head = $("#ws-verify-head", target);
      if (head) head.innerHTML = this.verifyHeader();
      this.quality.renderPanel($("#ws-verify-panel", target));
      return;
    }
    const page = $(".ws-scroll", target);
    const scroll = page?.scrollTop ?? 0;
    page.innerHTML = this.workspaceBody();
    page.scrollTop = scroll;
  }

  verifyHeader() {
    const quality = this.quality;
    return ws.verifyHeaderHtml({
      baseline: quality.baseline,
      changes: ws.baselineChanges(quality.baseline, this.documents.documents),
      report: quality.report,
      stale: quality.reportStale,
      job: quality.job,
      pending: quality.pending,
      cases: quality.cases,
    });
  }

  workspaceBody() {
    const state = this.workspaceState();
    if (this.workspace === "tasks") {
      if (state.analysis && !this.quality.projectPlans && !this.quality.projectPlansLoading && this.client.online)
        queueMicrotask(() => this.safe(() => this.quality.loadProjectPlans()));
      return ws.tasksHtml(state);
    }
    if (state.analysis && !this.quality.projectPlans && !this.quality.projectPlansLoading && this.client.online)
      queueMicrotask(() => this.safe(() => this.quality.loadProjectPlans()));
    if (state.analysis && !this.treeTouched)
      for (const method of ws.entryPoints(state.analysis)) {
        // Open the entry point and its direct callees: the first screen shows how commands are dispatched.
        this.treeExpanded.add(method.id);
        for (const call of state.analysis.calls)
          if (call.from === method.id) for (const target of call.targets ?? []) this.treeExpanded.add(`${method.id}>${target}`);
      }
    if (!state.analysis && !state.analysing && !state.error && this.client.online)
      queueMicrotask(() => this.safe(() => this.quality.analyseProject({ reveal: false })));
    return ws.overviewHtml(state);
  }

  setWorkspace(name) {
    if (!ws.WORKSPACES.some((item) => item.id === name)) return;
    this.workspace = name;
    this.renderWorkspaceNav();
    this.renderTabs();
    this.renderToolbar();
    this.renderCenter();
  }

  /** Remembers where the user was, so «Назад» returns there after jumping through calls. */
  rememberLocation() {
    const file = this.documents.active;
    this.navStack.push({ workspace: this.workspace, path: file?.path ?? null, methodId: file?.methodId ?? null });
    if (this.navStack.length > 50) this.navStack.shift();
  }

  async openMethod(path, methodId) {
    this.rememberLocation();
    this.workspace = "method";
    await this.quality.openLocation(path, { methodId });
    this.renderWorkspaceNav();
    this.renderTabs();
    this.renderToolbar();
  }

  async navigateBack() {
    const place = this.navStack.pop();
    if (!place) return;
    if (place.workspace !== "method" || !place.path) return this.setWorkspace(place.workspace);
    this.workspace = "method";
    await this.quality.openLocation(place.path, { methodId: place.methodId });
    this.renderWorkspaceNav();
  }

  methodContext(file, method) {
    return ws.methodContextHtml({
      analysis: this.quality.analysis,
      fileName: file.path,
      methodId: method?.id,
      methods: file.currentModel?.methods ?? [],
      canAdd: Boolean(file.currentModel?.valid),
      canBack: this.navStack.length > 0,
      editing: this.blueprintEditing,
    });
  }

  renderCenter() {
    this.disposeCenter();
    const target = $("#ide-content", this.root);
    if (this.home) {
      this.renderWorkspaceNav();
      target.innerHTML = view.welcome({
        recent: this.recent,
        project: this.project,
        summary: this.toolsState().summary,
      });
      return;
    }
    if (this.project && this.workspace !== "method") {
      this.renderWorkspaceNav();
      if (this.workspace === "verify") {
        target.innerHTML = `<section class="ws-page ws-verify" data-ws="verify"><div id="ws-verify-head">${this.verifyHeader()}</div><div id="ws-verify-panel" class="ide-panel-body quality-panel"></div></section>`;
        this.quality.renderPanel($("#ws-verify-panel", target));
      } else {
        target.innerHTML = `<div class="ws-scroll" data-ws="${this.workspace}">${this.workspaceBody()}</div>`;
      }
      return;
    }
    const file = this.documents.active;
    if (!file) {
      target.innerHTML = this.project
        ? ws.methodEmptyHtml()
        : view.welcome({ recent: this.recent });
      return;
    }
    const java = file.language === "java";
    const mode = java ? this.mode : "code";
    target.innerHTML = `<div id="ide-conflict"></div>${!java && ["python", "javascript", "typescript", "kotlin", "csharp", "cpp", "go", "rust", "c"].includes(file.language) ? `<div class="language-coming-strip">${view.glyph("info", 14)}Блоки для ${e(file.language)} — <b>Coming soon</b>. Сейчас доступен текстовый редактор.</div>` : ""}<div class="ide-workarea mode-${mode}"><div id="ide-code-pane">${editorShell()}</div><div class="ide-splitter" role="separator" aria-label="Ширина редактора" tabindex="0"></div><section id="ide-graph-pane" aria-label="Схема метода"></section></div>`;
    this.editor = new SourceEditor($("#ide-code-pane", target), {
      onChange: (document) => this.editorChanged(document),
      onPosition: (position, length) => {
        this.renderPosition(position, length);
        this.followCaretSoon?.();
      },
    });
    this.editor.setSettings(this.settings);
    this.editor.setDocument(file);
    this.renderConflict();
    this.renderGraph();
    this.bindSplitters();
  }

  renderConflict() {
    const target = $("#ide-conflict", this.root);
    if (!target) return;
    const file = this.documents.active;
    target.innerHTML = file?.missing
      ? `<div class="file-conflict-strip">${view.glyph("warning", 15)}Файл удалён или перемещён снаружи. Ваша версия осталась в редакторе.${view.button("download-file", "Экспортировать", "download", "ide-button small")}</div>`
      : file?.external
        ? `<div class="file-conflict-strip">${view.glyph("warning", 15)}Файл изменён другой программой.${view.button("resolve-conflict", "Сравнить версии", "diff", "ide-button small")}</div>`
        : "";
  }

  blueprintKey(file, method) {
    return `${this.project?.id ?? "-"}|${file.path}#${method.owner}.${method.name}/${method.signature}`;
  }

  renderGraph() {
    this.renderToolbar();
    const target = $("#ide-graph-pane", this.root);
    if (!target) return;
    const file = this.documents.active;
    const method = file?.language === "java" ? file.selectedMethod() : null;
    const key = method ? this.blueprintKey(file, method) : null;
    // The graph the user is editing stays mounted while the code below it is regenerated.
    // While the code it generated is being re-analysed the model is briefly absent: keep the graph.
    const generating =
      !file?.currentModel && this.blueprint?.path === file?.path && this.blueprint?.projectId === this.project?.id;
    if (
      this.blueprintEditing &&
      this.graph instanceof BlueprintEditor &&
      (this.blueprint?.key === key || generating) &&
      this.blueprint.revision === file.revision &&
      $(".bp-root", target)
    ) {
      if (!method) return (this.blueprintReady = Promise.resolve());
      const context = $(".ws-context", target);
      if (context) context.remove();
      this.quality.decorateGraph(this.graph, file, method);
      return (this.blueprintReady = Promise.resolve());
    }
    this.graph?.destroy();
    this.graph = null;
    if (!file || file.language !== "java") {
      target.innerHTML = "";
      return (this.blueprintReady = Promise.resolve());
    }
    target.classList.toggle("bp-reading", !this.blueprintEditing);
    target.innerHTML =
      `<div class="ide-graph-body">${method && file.currentModel?.valid ? '<div class="graph-empty"><span class="ide-spinner"></span><h3>Строим схему</h3></div>' : view.graphEmpty(file, this.analysing.has(file.path))}</div><div id="ide-node-inspector" hidden></div>`;
    if (!method || !file.currentModel?.valid) return (this.blueprintReady = Promise.resolve());
    if (!this.blueprintEditing) {
      this.mountFlowchart(file, method, target);
      return (this.blueprintReady = Promise.resolve());
    }
    this.blueprintReady = this.mountBlueprint(file, method, key, target).catch((error) => {
      const body = $(".ide-graph-body", target);
      if (body && this.documents.active === file)
        body.innerHTML = `<div class="graph-empty error"><h3>Не удалось построить схему</h3><p>${e(readableError(error))}</p></div>`;
    });
    return this.blueprintReady;
  }

  /** Reading mode: a statement-level flowchart of the method; double-click a step to edit it as blocks. */
  mountFlowchart(file, method, target) {
    const body = $(".ide-graph-body", target);
    if (!body || !method.graph?.nodes?.length) return;
    this.blueprint = null;
    body.innerHTML = graphShell({ toolbar: false, minimal: true });
    this.expandedSteps ??= new Map();
    const expanded = this.expandedSteps.get(method.id) ?? new Set();
    const chart = ws.condenseGraph(method.graph, expanded);
    const original = (id) => method.graph.nodes.find((item) => item.id === id) ?? null;
    const flowchart = new GraphWidget($(".graph-workbench", body), chart, {
      view: { x: 0, y: 0, scale: 1 },
      onSelect: (node) => {
        if (!node) return;
        if (node.members) {
          // A run of plain statements opens into single steps, each of which can be edited.
          this.expandedSteps.set(method.id, new Set([...expanded, ...node.members]));
          return this.mountFlowchart(file, method, target);
        }
        const step = original(node.id);
        this.selectNode(step);
        if (step && step.start >= 0) this.editor?.reveal(step.start, step.end);
      },
      onEdit: (node) => {
        if (!node || node.members) return;
        this.selectNode(original(node.id));
        this.safe(() => this.action("edit-node"));
      },
    });
    this.graph = flowchart;
    // Long methods fitted to the pane become unreadable: start at a readable scale at the first step.
    flowchart.fitted = true;
    requestAnimationFrame(() => {
      const nodes = flowchart.layout.nodes;
      const entry = nodes.find((node) => node.id === method.graph.entry) ?? nodes[0];
      const width = flowchart.viewport.clientWidth;
      if (!entry || !width) return flowchart.fit();
      const scale = 1;
      flowchart.view = { scale, x: width / 2 - (entry.x + entry.width / 2) * scale, y: 24 - entry.y * scale };
      flowchart.transform();
    });
    const marks = new Map();
    for (const finding of this.quality.findingsFor(file)) {
      if (finding.methodId !== method.id || finding.start < 0) continue;
      const inside = chart.nodes.filter((node) => node.start >= finding.start && node.end <= finding.end);
      const focus = inside.length > 3 ? inside.filter((node) => node.kind === "loop") : inside;
      for (const node of focus) if (marks.get(node.id) !== "warning") marks.set(node.id, finding.severity);
    }
    flowchart.mark(marks);
  }

  async mountBlueprint(file, method, key, target) {
    const revision = file.revision;
    let graph;
    if (this.blueprint?.key === key && this.blueprint.revision === revision) graph = this.blueprint.graph;
    else {
      const fresh = await this.client.request("/blueprint", { source: file.content, methodId: method.id });
      if (this.documents.active !== file || file.revision !== revision) return;
      const body = file.content.slice(fresh.bodyStart, fresh.bodyEnd);
      const saved = this.quality.layoutFor(key, body);
      if (saved) {
        // Same body text: keep the user's arrangement, re-anchor spans to the current offsets.
        const delta = fresh.bodyStart - saved.bodyStart;
        graph = { ...fresh, nodes: saved.nodes, links: saved.links };
        for (const node of graph.nodes) {
          if (node.start >= 0) node.start += delta;
          if (node.end >= 0) node.end += delta;
        }
      } else graph = autoLayout(fresh);
    }
    if (this.documents.active !== file || file.revision !== revision) return;
    this.blueprint = {
      key,
      revision,
      graph,
      path: file.path,
      projectId: this.project?.id,
      body: file.content.slice(graph.bodyStart, graph.bodyEnd),
    };
    const body = $(".ide-graph-body", target);
    if (!body) return;
    this.graph = new BlueprintEditor(body, graph, {
      view: this.blueprint.view?.[key],
      onStatus: (text, kind) => kind === "error" && text && this.notify(text, "warning"),
      onChange: (changed, info) => this.blueprintChanged(file, changed, info),
      onSelect: (node) => {
        this.selectedNode = node;
        file.selectedNode = node?.id ?? null;
        // The code beside the blocks follows the selection, without taking the keyboard focus.
        if (node && node.start >= 0 && this.mode !== "blueprint") this.editor?.reveal(node.start, node.end);
      },
      onOpenLine: (node) => {
        if (this.mode === "blueprint") this.setMode("split");
        this.editor?.selectSpan(node.start, node.end);
      },
      onLayout: (current) => autoLayout(current),
      onView: (view) => {
        this.blueprintViews ??= {};
        this.blueprintViews[key] = { ...view };
      },
    });
    if (this.blueprintViews?.[key]) {
      Object.assign(this.graph.view, this.blueprintViews[key]);
      this.graph.transform();
    }
    this.quality.decorateGraph(this.graph, file, method);
  }

  /** Graph edit → regenerate the method body in the document; layout-only changes are just saved. */
  blueprintChanged(file, graph, { structural }) {
    const state = this.blueprint;
    if (!state || state.graph !== graph) return;
    // A graph may only rewrite the text it was built from (F03): same project, revision and body.
    if (
      state.projectId !== this.project?.id ||
      file.revision !== state.revision ||
      file.content.slice(graph.bodyStart, graph.bodyEnd) !== state.body
    ) {
      this.blueprint = null;
      this.notify("Код изменился, пока блоки были открыты: схема перестроена по текущему коду, правка не применена.", "warning");
      this.renderGraph();
      return;
    }
    if (structural) {
      if (file.readOnly) {
        this.graph?.setStatus("Файл только для чтения: правки блоков не попадут в код", "error");
        return;
      }
      let result;
      try {
        const lineStart = file.content.lastIndexOf("\n", graph.bodyStart) + 1;
        const outer = file.content.slice(lineStart).match(/^\s*/)[0];
        result = generate(graph, { indent: outer + "    " });
        if (result.problems.length) {
          this.graph?.setStatus(
            `Черновик: не подключено входов — ${result.problems.length}. Код не изменён, пока блоки не соединены полностью.`,
            "error",
          );
          const body = file.content.slice(graph.bodyStart, graph.bodyEnd);
          this.quality.saveLayout(state.key, body, graph);
          return;
        }
        const body = "{\n" + result.code + (result.code ? "\n" : "") + outer + "}";
        const content = file.content.slice(0, graph.bodyStart) + body + file.content.slice(graph.bodyEnd);
        graph.bodyEnd = graph.bodyStart + body.length;
        file.update(content);
        state.revision = file.revision;
        state.body = body;
        this.editor?.refresh();
        this.analyseSoon(file);
      } catch (error) {
        this.graph?.setStatus(error instanceof CodegenError ? "Ошибка блоков: " + error.message : readableError(error), "error");
        if (error.nodeId) this.graph?.select(error.nodeId);
        return;
      }
      this.graph?.setStatus("Java обновлена из блоков (поведение проверяет F6)", "ok");
    }
    const body = file.content.slice(graph.bodyStart, graph.bodyEnd);
    this.quality.saveLayout(state.key, body, graph);
  }

  inspectorHtml(node, file) {
    return view.nodeInspector(
      node,
      file,
      node && file ? nodeFindings(this.quality.methodFindings(file, node)) : "",
    );
  }

  renderPanel() {
    const panel = $("#ide-panel", this.root);
    panel.hidden = this.panelHidden;
    $(".ide-panel-resizer", this.root).hidden = this.panelHidden;
    $$("[data-action=panel]", panel).forEach((button) => {
      button.classList.toggle("active", button.dataset.panel === this.panel);
      button.setAttribute(
        "aria-selected",
        String(button.dataset.panel === this.panel),
      );
    });
    const problems = this.problems();
    $("#ide-problem-count", panel).textContent = problems.length;
    const target = $("#ide-panel-body", panel);
    if (this.panel === "output") {
      const atEnd =
        target.scrollTop + target.clientHeight >= target.scrollHeight - 30;
      const typing = document.activeElement?.id === "console-stdin";
      const caret = typing ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
      target.innerHTML = view.outputPanel(
        this.taskState ? { ...this.taskState, stale: this.taskOutdated } : null,
        this.runConfig.input,
        this.askInput,
        this.runConfig.mainClass?.includes("#") ? this.runConfig.mainClass : "",
      );
      if (atEnd || this.busy) target.scrollTop = target.scrollHeight;
      const field = $("#console-stdin", target);
      if (field && (typing || this.askInput)) {
        field.focus();
        if (caret) field.setSelectionRange(...caret);
      }
    }
    if (this.panel === "problems")
      target.innerHTML = view.problemsPanel(problems);
    target.classList.toggle("quality-panel", this.panel === "verify");
    if (this.panel === "verify") this.quality.renderPanel(target);
    if (this.panel === "run")
      target.innerHTML = view.runSettingsPanel(
        this.runConfig,
        this.overviewState,
      );
  }

  problems() {
    const syntax = [...this.documents.documents.values()].flatMap((document) =>
      (document.currentModel?.diagnostics ?? []).map((problem) => ({
        ...problem,
        path: document.path,
        source: "javac parse",
      })),
    );
    return [...syntax, ...(this.taskState?.diagnostics ?? [])];
  }

  renderStatus() {
    const file = this.documents.active;
    const cursor = $("#ide-cursor-status", this.root);
    cursor.hidden = !file || this.workspace !== "method" || this.home;
    $("#ide-save-status", this.root).textContent = this.saving.size
      ? "Сохранение…"
      : this.documents.hasDirty
        ? `Не сохранено: ${this.documents.dirty.length}`
        : "Все изменения сохранены";
    if (file)
      this.renderPosition(
        file.position,
        file.selection.end - file.selection.start,
      );
    this.quality.renderStatus();
    this.bridge.dirty(this.documents.hasDirty).catch(() => {});
    document.title = `${file ? file.name + (file.dirty ? " ●" : "") + " — " : ""}${this.project ? this.project.name + " — " : ""}Blueprints IDE`;
  }

  renderPosition(position, length = 0) {
    $("#ide-cursor-status", this.root).textContent =
      `Стр ${position.line}, стлб ${position.column}${length ? " · выбрано " + length : ""}`;
  }

  documentChanged(event) {
    if (["content", "external", "renamed"].includes(event.kind))
      this.quality.invalidate();
    if (
      ["content", "metadata", "external", "renamed"].includes(event.kind) &&
      this.taskState
    ) {
      this.taskOutdated = true;
      if (this.panel === "output") this.renderPanel();
    }
    this.renderTabs();
    this.renderToolbar();
    this.renderStatus();
    this.sessionSoon();
    if (["active", "closed", "clear", "renamed"].includes(event.kind)) {
      this.renderCenter();
      this.renderSidebar();
      if (this.sidebar === "history") this.safe(() => this.loadHistory());
    }
    if (event.kind === "analysis") {
      if (event.document === this.documents.active) {
        this.renderGraph();
        this.editor?.paint();
      }
      if (this.sidebar === "outline") this.renderSidebar();
      this.renderPanel();
    }
    if (["external", "rebased", "reloaded"].includes(event.kind))
      this.renderConflict();
  }

  editorChanged(file) {
    if (file.language === "java") {
      if (this.settings.autoAnalyse) this.analyseSoon(file);
      const badge = $(".graph-live-label", this.root);
      if (badge) {
        badge.textContent = "Обновляем…";
        badge.classList.add("stale");
      }
      if (this.selectedNode) {
        this.selectedNode = null;
        const inspector = $("#ide-node-inspector", this.root);
        if (inspector) inspector.innerHTML = this.inspectorHtml(null, file);
      }
    }
    this.overviewSoon();
    this.renderTabs();
    this.renderToolbar();
    this.renderStatus();
  }

  async analyse(file = this.documents.active) {
    if (!file || file.language !== "java") return;
    if (file.content.length > 250000) {
      file.analysisError =
        "Схема строится для файлов до 250 000 символов. Текстовый редактор поддерживает до 2 МиБ.";
      if (file === this.documents.active) this.renderGraph();
      return;
    }
    const revision = file.revision;
    const projectId = this.project?.id;
    this.analysisControllers.get(file.path)?.abort();
    const controller = new AbortController();
    this.analysisControllers.set(file.path, controller);
    this.analysing.add(file.path);
    if (file === this.documents.active && !file.currentModel)
      this.renderGraph();
    try {
      const model = await this.client.request(
        "/analyze",
        { source: file.content },
        { signal: controller.signal },
      );
      if (
        this.project?.id !== projectId ||
        !this.documents.documents.has(file.path)
      )
        return;
      file.applyModel(model, revision);
    } catch (error) {
      if (controller.signal.aborted || revision !== file.revision) return;
      file.analysisError = readableError(error);
    } finally {
      if (this.analysisControllers.get(file.path) === controller) {
        this.analysisControllers.delete(file.path);
        this.analysing.delete(file.path);
        if (file === this.documents.active) this.renderGraph();
      }
    }
  }

  async adopt(result) {
    if (!result || result.cancelled) return;
    this.disposeCenter();
    for (const controller of this.analysisControllers.values())
      controller.abort();
    this.analysisControllers.clear();
    this.analysing.clear();
    this.documents.clear();
    this.project = result.project;
    this.recent = result.recent ?? this.recent;
    this.tree.clear();
    this.expanded = new Set(result.session?.expanded ?? []);
    this.selectedPath = null;
    this.overviewState = null;
    this.gitState = null;
    this.historyEntries = [];
    this.taskState = null;
    this.taskOutdated = false;
    this.searchState.result = null;
    this.runConfig = { mainClass: "", input: "" };
    this.quality.reset(null);
    this.blueprint = null;
    this.blueprintViews = {};
    this.sidebar = "explorer";
    this.sidebarHidden = true;
    this.panelHidden = true;
    this.mode = this.settings.editorView;
    this.workspace = "overview";
    this.treeExpanded = new Set();
    this.treeTouched = false;
    this.navStack = [];
    this.blueprintEditing = false;
    await this.refreshTree();
    if (this.settings.restoreSession) {
      for (const path of result.session?.tabs ?? [])
        await this.safe(() => this.openFile(path, false));
      if (result.session?.active)
        this.documents.activate(result.session.active);
    }
    if (!this.documents.active) {
      const scan = await this.bridge.scan(this.project.id);
      const main =
        scan.files.find((file) => file.path.endsWith("Main.java")) ??
        scan.files.find((file) => file.language === "java");
      if (main) await this.openFile(main.path);
    }
    this.renderAll();
    if (this.documents.active?.language === "java") await this.analyse();
    await this.quality.open(this.project);
    this.notify(
      this.project.capabilities?.disk
        ? `Открыта папка «${this.project.name}». Ctrl+S сохраняет изменения в неё.`
        : "Проект открыт в памяти страницы. Скачайте ZIP, чтобы сохранить изменения.",
    );
    this.safe(() => this.refreshGit());
  }

  async openFile(path, analyse = true) {
    if (!this.project) return;
    if (this.documents.documents.has(path)) {
      this.documents.activate(path);
    } else {
      const id = this.project.id;
      const file = await this.bridge.read(id, safeRelative(path));
      if (this.project?.id !== id) return;
      this.documents.open(file);
    }
    this.selectedPath = path;
    if (
      analyse &&
      this.documents.active?.language === "java" &&
      !this.documents.active.currentModel
    )
      await this.analyse();
    this.renderSidebar();
  }

  async refreshTree() {
    if (!this.project) return;
    const id = this.project.id;
    const directories = ["", ...this.expanded];
    for (const directory of directories) {
      try {
        const entries = await this.bridge.list(id, directory);
        if (this.project?.id === id) this.tree.set(directory, entries);
      } catch {
        this.tree.delete(directory);
        this.expanded.delete(directory);
      }
    }
    this.renderSidebar();
  }

  async toggleFolder(path) {
    this.selectedPath = path;
    if (this.expanded.has(path)) this.expanded.delete(path);
    else {
      this.expanded.add(path);
      this.tree.set(path, await this.bridge.list(this.project.id, path));
    }
    this.renderSidebar();
    this.sessionSoon();
  }

  async saveFile(file = this.documents.active) {
    if (!file || !file.dirty) return true;
    if (file.readOnly)
      throw new Error(
        "Этот файл открыт только для чтения.",
      );
    if (this.saving.has(file.path)) return false;
    if (file.external) {
      this.showConflict(file);
      return false;
    }
    const snapshot = file.content;
    const id = this.project.id;
    this.saving.add(file.path);
    this.renderStatus();
    try {
      const result = await this.bridge.write(id, {
        path: file.path,
        content: normalizeEol(snapshot, file.eol),
        expectedHash: file.hash,
        bom: file.bom,
      });
      if (this.project?.id !== id) return false;
      file.saved(result, snapshot);
      this.quality.accepted(file.path);
      this.overviewState = null;
      if (this.sidebar === "history") await this.loadHistory();
      return true;
    } catch (error) {
      if (error.code === "CONFLICT") {
        const latest = await this.bridge.read(id, file.path);
        file.markExternal(latest);
        this.showConflict(file);
        return false;
      }
      throw error;
    } finally {
      this.saving.delete(file.path);
      this.renderStatus();
    }
  }

  async saveAll() {
    for (const file of this.documents.dirty)
      if (!(await this.saveFile(file))) return false;
    this.renderToolbar();
    return true;
  }

  async closeTab(path = this.documents.activePath) {
    const file = this.documents.documents.get(path);
    if (!file) return;
    if (file.dirty) {
      const decision = await this.ask(
        "Сохранить изменения?",
        `Файл «${file.name}» содержит несохранённые изменения.`,
        [
          { id: "cancel", label: "Отмена" },
          { id: "discard", label: "Не сохранять" },
          { id: "save", label: "Сохранить", primary: true },
        ],
      );
      if (decision === "cancel") return;
      if (decision === "save" && !(await this.saveFile(file))) return;
    }
    this.analysisControllers.get(path)?.abort();
    this.documents.close(path);
  }

  async guardSwitch() {
    if (!this.documents.hasDirty) return true;
    const answer = await this.ask(
      "Несохранённые изменения",
      `Изменены файлы: ${this.documents.dirty.map((file) => file.name).join(", ")}`,
      [
        { id: "cancel", label: "Отмена" },
        { id: "discard", label: "Продолжить без сохранения" },
        { id: "save", label: "Сохранить всё", primary: true },
      ],
    );
    if (answer === "cancel") return false;
    if (answer === "save") return this.saveAll();
    // The explicit choice applies to this switch only. Native close guard remains active.
    await this.bridge.dirty(false);
    return true;
  }

  async saveSession() {
    if (!this.project || !this.settings.restoreSession) return;
    await this.bridge
      .session(this.project.id, this.documents.serialize(this.expanded))
      .catch(() => {});
  }

  async switchProject(operation) {
    if (!(await this.guardSwitch())) return;
    try {
      await this.adopt(await operation());
    } finally {
      await this.bridge.dirty(this.documents.hasDirty);
    }
  }

  async filesChanged(event) {
    if (event.id !== this.project?.id) return;
    if (event.paths.some((path) => path.endsWith(".java")))
      this.quality.invalidate();
    if (
      this.taskState &&
      event.paths.some(
        (path) => path.endsWith(".java") && !this.documents.documents.has(path),
      )
    ) {
      this.taskOutdated = true;
      if (this.panel === "output") this.renderPanel();
    }
    for (const file of this.documents.documents.values()) {
      if (
        !event.paths.some(
          (path) => path === file.path || file.path.startsWith(path + "/"),
        )
      )
        continue;
      if (this.saving.has(file.path)) continue;
      try {
        const latest = await this.bridge.read(this.project.id, file.path);
        if (latest.hash === file.hash) continue;
        if (file.dirty) file.markExternal(latest);
        else {
          file.acceptExternal(latest);
          if (file === this.documents.active) this.editor?.refresh();
          if (file.language === "java") await this.analyse(file);
        }
      } catch (error) {
        if (error.code === "MISSING") {
          file.missing = true;
          this.renderConflict();
        }
      }
    }
    this.overviewState = null;
    await this.refreshTree();
    if (this.sidebar === "git") await this.refreshGit();
  }

  async setSidebar(name) {
    this.sidebar = name;
    this.sidebarHidden = false;
    this.renderSidebar();
    if (name === "git") await this.refreshGit();
    if (name === "history") await this.loadHistory();
    if (name === "search") $("#project-search", this.root)?.focus();
  }

  async refreshGit() {
    if (!this.project) return;
    this.gitState = await this.bridge.gitStatus(this.project.id);
    if (this.sidebar === "git") this.renderSidebar();
    this.renderStatus();
  }

  async loadHistory() {
    const file = this.documents.active;
    if (!file || !this.project) {
      this.historyEntries = [];
      return;
    }
    this.historyEntries = await this.bridge.history(this.project.id, file.path);
    if (this.sidebar === "history") this.renderSidebar();
  }

  async getOverview() {
    if (!this.project) return null;
    if (!this.overviewState)
      this.overviewState = await this.bridge.overview(this.project.id);
    return this.overviewState;
  }

  async projectSearch(form = $("#project-search-form", this.root)) {
    if (!this.project || !form) return;
    const data = new FormData(form);
    Object.assign(this.searchState, {
      query: String(data.get("query") ?? ""),
      include: String(data.get("include") ?? ""),
      replacement: String(data.get("replacement") ?? ""),
      caseSensitive: data.has("caseSensitive"),
      wholeWord: data.has("wholeWord"),
    });
    if (!this.searchState.query.trim()) {
      this.notify("Введите текст для поиска");
      return;
    }
    this.searchState.busy = true;
    this.renderSidebar();
    try {
      this.searchState.result = await this.bridge.search(
        this.project.id,
        this.searchState,
      );
    } finally {
      this.searchState.busy = false;
      if (this.sidebar === "search") this.renderSidebar();
    }
  }

  async previewReplace() {
    const form = $("#project-search-form", this.root);
    if (!form) return;
    const data = new FormData(form);
    const request = {
      query: String(data.get("query") ?? ""),
      replacement: String(data.get("replacement") ?? ""),
      include: String(data.get("include") ?? ""),
      caseSensitive: data.has("caseSensitive"),
      wholeWord: data.has("wholeWord"),
    };
    if (!request.query)
      throw new Error("Введите текст, который нужно заменить");
    if (this.documents.hasDirty)
      throw new Error(
        "Сначала сохраните открытые файлы перед заменой по проекту",
      );
    const result = await this.bridge.previewReplace(this.project.id, request);
    this.modalContext = { kind: "replace", result, projectId: this.project.id };
    this.showModal(
      view.modalFrame(
        "Предпросмотр замены",
        `<p class="modal-lead">${result.matches} совпадений в ${result.files} файлах. Замена будет записана в файлы; предыдущие версии сохранятся в локальной истории.</p>${result.changes.map((change) => `<details class="replace-preview-file" ${result.changes.length === 1 ? "open" : ""}><summary>${e(change.path)} · ${change.count} замен</summary>${view.diffView(change.before, change.after)}</details>`).join("") || "<p>Совпадений нет.</p>"}`,
        `${view.button("close-modal", "Отмена")}${view.button("apply-replace", "Применить замену", "check", "ide-button primary", result.files ? "" : "disabled")}`,
        "wide",
      ),
    );
  }

  async applyReplace() {
    const context = this.modalContext;
    if (context?.kind !== "replace" || this.project?.id !== context.projectId)
      return;
    const saved = [];
    let failure = null;
    for (const change of context.result.changes) {
      try {
        const result = await this.bridge.write(this.project.id, {
          path: change.path,
          content: change.after,
          expectedHash: change.expectedHash,
          bom: change.bom,
        });
        saved.push(change.path);
        const file = this.documents.documents.get(change.path);
        if (file) {
          file.update(change.after);
          file.saved(result, change.after);
          if (file.language === "java") await this.analyse(file);
        }
      } catch (error) {
        failure = error;
        break;
      }
    }
    this.closeModal();
    this.editor?.refresh();
    this.notify(
      failure
        ? `Сохранено ${saved.length} файлов. Остальные не изменены: ${readableError(failure)}`
        : `Замена применена к ${saved.length} файлам`,
      failure ? "warning" : "info",
      10000,
    );
    this.overviewState = null;
    await this.refreshTree();
  }

  selectNode(node) {
    this.selectedNode = node;
    if (this.documents.active)
      this.documents.active.selectedNode = node?.id ?? null;
    const target = $("#ide-node-inspector", this.root);
    if (target) {
      target.innerHTML = this.inspectorHtml(node, this.documents.active);
      target.hidden = !node || this.blueprintEditing;
    }
  }

  async selectMethod(id) {
    const file = this.documents.active;
    if (!file?.currentModel?.methods.some((method) => method.id === id)) return;
    file.methodId = id;
    file.selectedNode = null;
    this.selectedNode = null;
    this.renderGraph();
    if (["outline", "improve"].includes(this.sidebar)) this.renderSidebar();
  }

  setMode(mode) {
    this.mode = mode;
    this.renderToolbar();
    this.renderCenter();
  }

  async startTask(kind) {
    if (!this.project) {
      this.notify("Сначала откройте папку проекта");
      return;
    }
    if (this.busy) throw new Error("Задача уже выполняется. Нажмите «Стоп».");
    // A program that reads the keyboard would just crash on empty input: ask for it first.
    const sources = [...this.documents.documents.values()].filter((item) => item.language === "java").map((item) => item.content);
    if (kind === "run" && !this.runConfig.input.trim() && sources.some((code) => /System\.in|new\s+Scanner\s*\(/.test(code)) && !this.askedInput) {
      this.askedInput = true;
      this.askInput = "Программа читает ввод с клавиатуры. Впишите значения (каждое с новой строки) и нажмите «Запустить». Если ввод не нужен — просто нажмите «Запустить».";
      this.panel = "output";
      this.panelHidden = false;
      return this.renderPanel();
    }
    this.askInput = "";
    this.askedInput = false;
    if (!(await this.saveAll())) return;
    this.panelHidden = false;
    this.panel = "output";
    this.taskOutdated = false;
    this.taskState = {
      status: "queued",
      kind,
      stdout: "",
      stderr: "",
      diagnostics: [],
      stage: "Подготовка проекта",
    };
    this.renderPanel();
    this.renderToolbar();
    try {
      const task = await this.bridge.startTask(this.project.id, {
        kind,
        ...this.runConfig,
        entryFile: this.documents.active?.language === "java" ? this.documents.active.path : "",
      });
      this.taskState = task;
      this.updateTask(task);
      this.pollTask(task.id);
    } catch (error) {
      this.taskState = {
        ...this.taskState,
        status: "failed",
        stderr: readableError(error),
        stage: "Задача не запущена",
      };
      this.renderPanel();
      this.renderToolbar();
    }
  }

  updateTask(task) {
    if (task.projectId && task.projectId !== this.project?.id) return;
    if (this.taskState?.id && this.taskState.id !== task.id) return;
    this.taskState = task;
    if (this.panel === "output" || this.panel === "problems")
      this.renderPanel();
    this.renderToolbar();
    if (!["queued", "running"].includes(task.status))
      clearTimeout(this.taskTimer);
  }

  pollTask(id) {
    clearTimeout(this.taskTimer);
    if (!this.busy) return;
    this.taskTimer = setTimeout(
      () =>
        this.safe(async () => {
          const task = await this.bridge.task(id);
          this.updateTask(task);
          if (this.busy) this.pollTask(id);
        }),
      500,
    );
  }

  showModal(html) {
    this.palette.close();
    this.dialog.className = "ide-modal-dialog";
    this.dialog.innerHTML = html;
    this.dialog.showModal();
    requestAnimationFrame(() =>
      $("input:not([type=checkbox]), textarea, select", this.dialog)?.focus(),
    );
  }

  closeModal() {
    this.dialog.close();
    const resolve = this.modalResolve;
    this.modalResolve = null;
    if (resolve) resolve("cancel");
    this.modalContext = null;
  }

  ask(title, message, buttons) {
    return new Promise((resolve) => {
      this.showModal(
        view.modalFrame(
          title,
          `<p class="modal-lead">${e(message)}</p>`,
          buttons
            .map(
              (button) =>
                `<button class="ide-button ${button.primary ? "primary" : ""}" data-action="modal-answer" data-answer="${button.id}">${e(button.label)}</button>`,
            )
            .join(""),
        ),
      );
      this.modalResolve = resolve;
    });
  }

  showConflict(file) {
    if (!file.external) return;
    this.modalContext = {
      kind: "conflict",
      file,
      externalHash: file.external.hash,
    };
    this.showModal(
      view.modalFrame(
        "Файл изменён снаружи",
        `<p class="modal-lead">«${e(file.path)}» изменился после открытия. Сравните версии. «Оставить мою» подготовит сохранение поверх показанной внешней версии; нажмите Ctrl+S после проверки.</p>${view.diffView(file.external.content, file.content, { before: "Сейчас на диске", after: "Ваша версия в редакторе" })}`,
        `${view.button("conflict-reload", "Принять с диска", "loop")}${view.button("conflict-keep", "Оставить мою в редакторе", "check", "ide-button primary")}`,
        "wide",
      ),
    );
  }

  async paletteOpen(mode = "commands") {
    if (mode === "files") {
      if (!this.project) return this.notify("Сначала откройте папку проекта");
      const scan = await this.bridge.scan(this.project.id);
      this.palette.open(scan.files, "files");
    } else
      this.palette.open(
        availableCommands({
          project: this.project,
          document: this.documents.active,
        }),
      );
  }

  async action(name, element = null) {
    if (this.toolsOpen && !["tools-menu", "tool-group", "help-menu"].includes(name)) this.closeTools();
    if (this.noticesOpen && name !== "notifications" && name !== "notifications-clear") this.closeNotices();
    const file = this.documents.active;
    const path = element?.dataset.path;
    switch (name) {
      case "help-menu":
        if (this.toolsOpen && this.toolsGroup === "help") this.closeTools();
        else { this.openTools("help"); this.root.classList.add("ux-help-open"); }
        break;
      case "tool-group":
        if (this.toolsOpen && this.toolsGroup === element.dataset.group) this.closeTools();
        else this.openTools(element.dataset.group);
        break;
      case "learn-beginner":
      case "learn-start":
        await this.startLearning();
        break;
      case "learn-experienced":
        await this.acknowledgeWelcome();
        break;
      case "learn-next":
      case "learn-back":
        element.disabled = true;
        this.learningStep += name === "learn-next" ? 1 : -1;
        await this.showLearningStep();
        break;
      case "learn-end":
        this.endLearning();
        break;
      case "guide":
        this.showModal(guideHtml());
        break;
      case "focus-workspace":
        this.toggleFocus();
        break;
      case "open-folder":
        await this.switchProject(() => this.bridge.chooseFolder());
        break;
      case "recent":
        await this.switchProject(() =>
          this.bridge.openRecent(element.dataset.root),
        );
        break;
      case "demo":
        await this.switchProject(() => this.bridge.demo());
        break;
      case "new-project":
        this.showModal(
          view.modalFrame(
            "Новый Java-проект",
            `<form id="new-project-form"><label class="modal-field">Название папки<input name="name" value="MyJavaProject" required maxlength="80" autocomplete="off"/></label><p class="modal-note">Следующим шагом выберите, где создать эту папку. Java 21 уже включена в настольную IDE.</p></form>`,
            '<button type="submit" form="new-project-form" class="ide-button primary">Выбрать расположение</button>',
          ),
        );
        break;
      case "close-project":
        if (this.project && (await this.guardSwitch())) {
          try {
            const result = await this.bridge.closeProject(this.project.id);
            if (!result.cancelled) {
              this.closeModal();
              this.disposeCenter();
              this.documents.clear();
              this.project = null;
              this.quality.reset(null);
              this.tree.clear();
              this.renderAll();
            }
          } finally {
            await this.bridge.dirty(this.documents.hasDirty);
          }
        }
        break;
      case "open-file":
        await this.openFile(path);
        break;
      case "toggle-folder":
        await this.toggleFolder(path);
        break;
      case "home":
        this.goHome();
        break;
      case "rule-hide":
        this.quality.hiddenRules.add(element.dataset.rule);
        this.quality.persistSoon();
        this.notify(`Правило ${element.dataset.rule} скрыто в этом проекте. Вернуть — внизу страницы «Задачи».`);
        this.renderWorkspace();
        break;
      case "rule-unhide-all":
        this.quality.hiddenRules.clear();
        this.quality.persistSoon();
        this.renderWorkspace();
        break;
      case "run-entry":
        this.runConfig.mainClass = element.dataset.entry;
        this.askedInput = true;
        await this.startTask("run");
        break;
      case "run-entry-reset":
        this.runConfig.mainClass = "";
        this.renderPanel();
        break;
      case "create-launcher": {
        if (!this.project) break;
        const scan = await this.bridge.scan(this.project.id);
        const javaRoot = scan.files.find((item) => item.path.includes("src/main/java/"))?.path.replace(/src\/main\/java\/.*/, "src/main/java/") ?? "";
        let path = javaRoot + "RunMe.java";
        for (let index = 2; scan.files.some((item) => item.path === path); index++) path = javaRoot + `RunMe${index}.java`;
        const name = basename(path).replace(/\.java$/, "");
        await this.bridge.create(this.project.id, {
          path,
          kind: "file",
          content: `/** Точка входа для запуска кода проекта из IDE. */\npublic class ${name} {\n    public static void main(String[] args) throws Exception {\n        // Вызовите здесь код проекта, например:\n        // System.out.println(new SomeClass().someMethod());\n        System.out.println("Hello from ${name}");\n    }\n}\n`,
        });
        this.runConfig.mainClass = name;
        await this.refreshTree();
        this.workspace = "method";
        await this.openFile(path);
        this.renderAll();
        this.notify(`Создан ${path}: напишите в main вызов нужного кода и нажмите ▶.`);
        break;
      }
      case "notifications":
        if (this.noticesOpen) this.closeNotices();
        else this.openNotices();
        break;
      case "notifications-clear":
        this.notices = [];
        this.renderNotices();
        break;
      case "tools-menu":
        if (this.toolsOpen) this.closeTools();
        else this.openTools();
        break;
      case "workspace":
        this.setWorkspace(element.dataset.workspace);
        break;
      case "ws-open-method":
        await this.openMethod(element.dataset.file, element.dataset.method);
        break;
      case "ws-tree-toggle": {
        const key = element.dataset.key;
        this.treeTouched = true;
        if (this.treeExpanded.has(key)) this.treeExpanded.delete(key);
        else this.treeExpanded.add(key);
        this.renderWorkspace();
        break;
      }
      case "ws-tour": {
        const entry = ws.entryPoints(this.quality.analysis)[0] ?? this.quality.analysis?.hotspots?.[0];
        if (!entry) return this.notify("Дождитесь окончания анализа проекта");
        if (this.mode === "blueprint") this.mode = "split";
        await this.openMethod(entry.fileName, entry.methodId);
        this.notify("Слева код, справа его логика блоками. Над схемой — кто вызывает метод и что вызывает он сам: кликайте, чтобы идти по программе.", "info", 9000);
        break;
      }
      case "ws-build":
        this.blueprintEditing = true;
        if (!this.documents.active) {
          const main = ws.entryPoints(this.quality.analysis)[0];
          if (main) await this.openFile(main.fileName);
        }
        this.setWorkspace("method");
        await this.action("new-method");
        break;
      case "blueprint-edit":
        this.blueprintEditing = element.dataset.edit === "1";
        this.renderGraph();
        $("#ide-graph-pane", this.root)?.classList.toggle("bp-reading", !this.blueprintEditing);
        break;
      case "nav-back":
        await this.navigateBack();
        break;
      case "task-preview":
      case "task-fix": {
        const plan = await this.quality.planForTask(element.dataset.file, element.dataset.id);
        await this.quality.action("plan-preview", { dataset: { id: plan.id } });
        break;
      }
      case "activate-tab":
        if (this.workspace !== "method") {
          this.workspace = "method";
          this.renderWorkspaceNav();
          this.renderToolbar();
          this.renderCenter();
        }
        this.documents.activate(path);
        break;
      case "close-tab":
        await this.closeTab(path ?? this.documents.activePath);
        break;
      case "reopen-tab":
        if (this.documents.closed[0])
          await this.openFile(this.documents.closed.shift());
        break;
      case "next-tab":
        this.documents.cycle(1);
        break;
      case "previous-tab":
        this.documents.cycle(-1);
        break;
      case "save":
        await this.saveFile();
        break;
      case "save-all":
        await this.saveAll();
        break;
      case "analyse":
        await this.analyse();
        break;
      case "editor-mode":
        this.setMode(element.dataset.mode);
        break;
      case "view-blueprint":
        this.setMode("blueprint");
        break;
      case "view-split":
        this.setMode("split");
        break;
      case "view-code":
      case "show-code":
        this.setMode("code");
        break;
      case "sidebar":
      case "search":
      case "outline":
      case "history": {
        const view_ = name === "sidebar" ? element.dataset.view : name;
        if (["analysis", "improve"].includes(view_)) return this.setWorkspace("tasks");
        if (view_ === "git") break;
        if (this.project && (this.home || this.workspace !== "method")) this.setWorkspace("method");
        await this.setSidebar(view_);
        break;
      }
      case "toggle-sidebar":
        this.sidebarHidden = !this.sidebarHidden;
        this.renderSidebar();
        this.renderToolbar();
        break;
      case "toggle-panel":
        this.panelHidden = !this.panelHidden;
        this.renderPanel();
        break;
      case "panel":
        this.panel = element.dataset.panel;
        this.panelHidden = false;
        this.renderPanel();
        break;
      case "run-config":
        this.panel = "run";
        this.panelHidden = false;
        await this.getOverview();
        this.renderPanel();
        break;
      case "show-problems":
        this.panel = "problems";
        this.panelHidden = false;
        this.renderPanel();
        break;
      case "run":
      case "compile":
        await this.startTask(name);
        break;
      case "stop":
        if (this.taskState?.id)
          this.updateTask(await this.bridge.stopTask(this.taskState.id));
        break;
      case "clear-output":
        if (!this.busy) {
          this.taskState = null;
          this.renderPanel();
        }
        break;
      case "refresh-tree":
        await this.refreshTree();
        break;
      case "refresh-git":
        await this.refreshGit();
        break;
      case "refresh-history":
        await this.loadHistory();
        break;
      case "quick-open":
        await this.paletteOpen("files");
        break;
      case "palette":
        await this.paletteOpen();
        break;
      case "settings":
        this.showModal(view.settingsModal(this.settings));
        break;
      case "languages":
        this.showModal(view.languageModal());
        break;
      case "choose-java":
        this.closeModal();
        this.notify(
          "Java выбрана. Откройте .java файл, чтобы увидеть схему.",
        );
        break;
      case "coming-soon":
        this.notify(
          `${element.dataset.language} · Coming soon. В этой версии доступны только Java-блоки.`,
        );
        break;
      case "shortcuts":
        this.showModal(view.shortcutsModal());
        break;
      case "about":
        this.showModal(view.aboutModal(this.bootInfo));
        break;
      case "open-example":
        await this.switchProject(() =>
          this.bridge.openExample(element?.dataset.example ?? "shop-monolith"),
        );
        break;
      case "verify-open":
        if (!this.project) await this.action("open-folder");
        else this.setWorkspace("verify");
        break;
      case "close-modal":
        this.closeModal();
        break;
      case "modal-answer": {
        const resolve = this.modalResolve;
        this.modalResolve = null;
        this.dialog.close();
        this.modalContext = null;
        resolve?.(element.dataset.answer);
        break;
      }
      case "overview":
        this.openTools();
        break;
      case "open-entry":
        this.runConfig.mainClass = element.dataset.class;
        this.closeModal();
        await this.openFile(path);
        break;
      case "open-config":
        this.closeModal();
        await this.openFile(path);
        break;
      case "select-method":
        await this.selectMethod(element.dataset.id);
        break;
      case "close-node":
        this.selectNode(null);
        break;
      case "node-source":
        if (this.selectedNode && file?.currentModel) {
          if (this.mode === "blueprint") this.setMode("split");
          this.editor?.selectSpan(
            this.selectedNode.start,
            this.selectedNode.end,
          );
        }
        break;
      case "edit-node":
      case "node-insert-before":
      case "node-insert-after":
        if (this.selectedNode && file?.currentModel && !file.readOnly) {
          const action =
            name === "edit-node"
              ? "replace"
              : name === "node-insert-before"
                ? "before"
                : "after";
          this.modalContext = {
            kind: "node",
            file,
            node: { ...this.selectedNode },
            revision: file.revision,
            action,
          };
          this.showModal(view.nodeEditModal(this.selectedNode, file, action));
        }
        break;
      case "node-delete":
        if (this.selectedNode && file?.currentModel && !file.readOnly) {
          const result = await this.client.edit(
            file.content,
            file.methodId,
            this.selectedNode.id,
            "delete",
            "",
          );
          file.update(result.source);
          file.applyModel(result.model, file.revision);
          file.selectedNode = null;
          this.selectedNode = null;
          this.editor?.refresh();
          this.renderGraph();
          this.notify("Блок удалён из Java-кода. Сохраните файл, когда проверите результат.");
        }
        break;
      case "graph-fit":
        this.graph?.fit(true);
        break;
      case "graph-zoom-in":
        this.graph?.zoom(1.2);
        break;
      case "graph-zoom-out":
        this.graph?.zoom(1 / 1.2);
        break;
      case "new-method":
        if (file?.language === "java" && file.currentModel?.valid && !file.readOnly)
          this.showModal(view.newMethodModal(file.currentModel.classes ?? [], file.selectedMethod()?.owner?.split(".")[0]));
        break;
      case "new-file":
        if (this.project)
          this.showModal(view.newFileModal(this.selectedFolder()));
        break;
      case "new-folder":
        if (this.project)
          this.showModal(
            view.modalFrame(
              "Новая папка",
              `<form id="new-folder-form"><label class="modal-field">Путь внутри проекта<input name="path" value="${e(this.selectedFolder() ? this.selectedFolder() + "/" : "")}new-folder" required/></label></form>`,
              '<button type="submit" form="new-folder-form" class="ide-button primary">Создать</button>',
            ),
          );
        break;
      case "rename-file":
        if (this.project && (this.selectedPath || file)) {
          const from = this.selectedPath ?? file.path;
          this.modalContext = { kind: "rename", path: from };
          this.showModal(
            view.modalFrame(
              "Переименовать",
              `<form id="rename-file-form"><label class="modal-field">Новый путь<input name="to" value="${e(from)}" required maxlength="1024"/></label><p class="modal-note">Переименование файла не меняет имя класса и ссылки в Java-коде.</p></form>`,
              '<button type="submit" form="rename-file-form" class="ide-button primary">Переименовать</button>',
            ),
          );
        }
        break;
      case "trash-file":
        if (this.project && this.selectedPath) {
          const selected = this.selectedPath;
          const dirty = this.documents.dirty.some(
            (file) =>
              file.path === selected || file.path.startsWith(selected + "/"),
          );
          if (dirty)
            throw new Error("Сначала сохраните или закройте изменённые файлы");
          const disk = this.project.capabilities?.disk;
          const result =
            (await this.ask(
              disk ? "Удалить с диска?" : "Удалить из проекта?",
              disk ? `«${selected}» будет удалён из папки без корзины.` : selected,
              [
                { id: "cancel", label: "Отмена" },
                { id: "delete", label: "Удалить", primary: true },
              ],
            )) === "delete"
              ? await this.bridge.trash(this.project.id, selected)
              : { cancelled: true };
          if (!result.cancelled) {
            for (const path of [...this.documents.tabs])
              if (path === selected || path.startsWith(selected + "/"))
                this.documents.close(path);
            await this.refreshTree();
          }
        }
        break;
      case "explorer-menu":
        this.showModal(
          view.modalFrame(
            "Действия с проектом",
            `<div class="file-actions-menu">${view.button("new-file", "Создать файл", "file")}${view.button("new-folder", "Создать папку", "folder")}${this.selectedPath ? view.button("rename-file", "Переименовать «" + basename(this.selectedPath) + "»", "edit") + view.button("trash-file", "Переместить в корзину", "close") : ""}${view.button("export-project", "Скачать проект (ZIP)", "download")}${view.button("close-project", "Закрыть проект", "folder")}</div>`,
          ),
        );
        break;
      case "export-project": {
        if (!this.project) break;
        const scan = await this.bridge.scan(this.project.id);
        const files = {};
        for (const item of scan.files) {
          const open = this.documents.documents.get(item.path);
          files[item.path] = open ? open.content : (await this.bridge.read(this.project.id, item.path)).content;
        }
        download(`${this.project.name}.zip`, new Blob([zipBytes(files)], { type: "application/zip" }));
        this.notify(`Скачан проект: ${Object.keys(files).length} файлов, включая несохранённые правки в редакторе.`);
        break;
      }
      case "download-file":
        if (file) download(file.name, file.content);
        break;
      case "link-info":
        this.notify(
          "Символическая ссылка. Для работы с её файлами откройте целевую папку как отдельный проект.",
        );
        break;
      case "search-result":
      case "problem":
        await this.openFile(path);
        if (this.mode === "blueprint") this.setMode("split");
        this.editor?.goTo(
          Number(element.dataset.line),
          Number(element.dataset.column),
          Number(element.dataset.length ?? 0),
        );
        break;
      case "preview-replace":
        await this.previewReplace();
        break;
      case "apply-replace":
        await this.applyReplace();
        break;
      case "resolve-conflict":
        if (file) this.showConflict(file);
        break;
      case "conflict-reload": {
        const context = this.modalContext;
        if (
          context?.kind === "conflict" &&
          context.file.external?.hash === context.externalHash
        ) {
          context.file.acceptExternal(context.file.external);
          this.closeModal();
          this.editor?.refresh();
          await this.analyse(context.file);
        }
        break;
      }
      case "conflict-keep": {
        const context = this.modalContext;
        if (
          context?.kind === "conflict" &&
          context.file.external?.hash === context.externalHash
        ) {
          context.file.rebaseExternal(context.file.external);
          this.closeModal();
          this.notify(
            "Ваша версия оставлена в редакторе. Проверьте её и сохраните Ctrl+S.",
          );
        }
        break;
      }
      case "history-version":
        if (file) {
          const entry = await this.bridge.historyRead(
            this.project.id,
            file.path,
            element.dataset.version,
          );
          this.modalContext = { kind: "history", file, entry };
          this.showModal(
            view.modalFrame(
              "История · " + file.name,
              view.diffView(entry.content, file.content, {
                before: "Версия из истории",
                after: "Сейчас в редакторе",
              }),
              `${view.button("close-modal", "Закрыть")}${view.button("restore-history", "Вернуть в редактор", "history", "ide-button primary")}`,
              "wide",
            ),
          );
        }
        break;
      case "restore-history": {
        const context = this.modalContext;
        if (context?.kind === "history") {
          context.file.update(context.entry.content);
          this.closeModal();
          this.editor?.refresh();
          await this.analyse(context.file);
          this.notify(
            "Версия восстановлена в редакторе. Сохраните файл, когда проверите изменения.",
          );
        }
        break;
      }
      case "git-file": {
        const result = await this.bridge.gitDiff(this.project.id, {
          path,
          staged: element.dataset.staged === "true",
        });
        this.showModal(
          view.modalFrame(
            "Git diff · " + basename(path),
            `<pre class="git-diff-pre">${e(result.diff || "Для нового или бинарного файла текстовый diff недоступен.")}</pre>`,
            view.button("close-modal", "Закрыть"),
            "wide",
          ),
        );
        break;
      }
      case "find":
        if (this.mode === "blueprint") this.setMode("split");
        this.editor?.openFind();
        break;
      case "goto-line":
        if (file)
          this.showModal(
            view.modalFrame(
              "Перейти к строке",
              '<form id="goto-line-form"><label class="modal-field">Строка или строка:столбец<input name="position" value="1" inputmode="text" required pattern="[0-9]+(:[0-9]+)?"/></label></form>',
              '<button type="submit" form="goto-line-form" class="ide-button primary">Перейти</button>',
            ),
          );
        break;
      case "toggle-eol":
        if (file && !file.readOnly) {
          file.setEol(file.eol === "LF" ? "CRLF" : "LF");
          this.editor?.refresh();
        }
        break;
      case "comment":
      case "duplicate-line":
      case "sort-lines":
      case "trim-whitespace":
      case "bracket":
      case "complete":
      case "undo":
      case "redo":
        if (this.mode === "blueprint") this.setMode("split");
        this.editor?.command(name);
        break;
      default:
        await this.quality.action(name, element);
    }
  }

  selectedFolder() {
    if (!this.selectedPath) return "";
    const entry = [...this.tree.values()]
      .flat()
      .find((item) => item.path === this.selectedPath);
    return entry?.kind === "directory"
      ? this.selectedPath
      : dirname(this.selectedPath);
  }

  async submit(form) {
    const data = new FormData(form);
    switch (form.id) {
      case "console-form":
        this.runConfig.input = String(data.get("input") ?? "");
        this.askedInput = true;
        await this.startTask("run");
        break;
      case "project-search-form":
        await this.projectSearch(form);
        break;
      case "new-project-form": {
        const name = String(data.get("name"));
        await this.switchProject(() => {
          this.closeModal();
          return this.bridge.newProject({ name });
        });
        break;
      }
      case "new-file-form": {
        const path = safeRelative(String(data.get("path")));
        const template = JAVA_FILE_TEMPLATES.find(
          (item) => item.id === data.get("template"),
        );
        const name = basename(path).replace(/\.java$/, "");
        if (template?.id !== "text" && !/^[A-Za-z_$][\w$]*$/.test(name))
          throw new Error(
            "Для Java-шаблона укажите имя класса латиницей, например OrderService.java",
          );
        await this.bridge.create(this.project.id, {
          path,
          kind: "file",
          content: template?.create(name) ?? "",
        });
        this.closeModal();
        await this.refreshTree();
        await this.openFile(path);
        break;
      }
      case "new-folder-form":
        await this.bridge.create(this.project.id, {
          path: safeRelative(String(data.get("path"))),
          kind: "directory",
        });
        this.closeModal();
        await this.refreshTree();
        break;
      case "rename-file-form": {
        const from = this.modalContext?.path;
        if (!from) return;
        const to = safeRelative(String(data.get("to")));
        await this.bridge.rename(this.project.id, { path: from, to });
        this.documents.rename(from, to);
        this.selectedPath = to;
        this.closeModal();
        await this.refreshTree();
        break;
      }
      case "new-method-form": {
        const doc = this.documents.active;
        const model = doc?.currentModel;
        const owner = (model?.classes ?? []).find((item) => item.name === data.get("owner")) ?? model?.classes?.[0];
        const name = String(data.get("name")).trim();
        if (!/^[a-zA-Z_$][\w$]*$/.test(name)) throw new Error("Имя метода: латиница, цифры и _, например calculateTotal");
        if (!owner || owner.end <= 0) throw new Error("Не найден класс для нового метода");
        const params = String(data.get("params") ?? "").trim();
        const returnType = String(data.get("returnType") || "void").trim();
        const modifiers = data.has("static") ? "static " : "";
        const close = doc.content.lastIndexOf("}", owner.end - 1);
        const fallback = returnType === "void" ? "" : returnType === "boolean" ? "\n        return false;" : /^(int|long|short|byte|double|float|char)$/.test(returnType) ? "\n        return 0;" : "\n        return null;";
        const method = `\n    ${modifiers}${returnType} ${name}(${params}) {${fallback}\n    }\n`;
        doc.update(doc.content.slice(0, close) + method + doc.content.slice(close));
        this.closeModal();
        this.editor?.refresh();
        await this.analyse(doc);
        const created = doc.currentModel?.methods.find((item) => item.name === name && item.owner === owner.name);
        if (created) await this.selectMethod(created.id);
        if (this.mode === "code") this.setMode("blueprint");
        this.notify(`Метод ${name} создан. Добавляйте блоки правой кнопкой мыши на поле блоков.`);
        break;
      }
      case "goto-line-form": {
        const [line, column = 1] = String(data.get("position"))
          .split(":")
          .map(Number);
        this.closeModal();
        if (this.mode === "blueprint") this.setMode("split");
        this.editor?.goTo(line, column);
        break;
      }
      case "run-settings-form":
        this.runConfig = {
          mainClass: String(data.get("mainClass")).trim(),
          input: String(data.get("input")),
        };
        this.quality.invalidate();
        this.notify("Параметры запуска сохранены для текущей сессии");
        break;
      case "ide-settings-form": {
        const next = { ...this.settings };
        for (const key of ["theme", "editorView", "graphDirection"])
          next[key] = String(data.get(key));
        for (const key of ["fontSize", "tabSize"])
          next[key] = Number(data.get(key));
        for (const key of [
          "autoAnalyse",
          "wordWrap",
          "restoreSession",
          "reduceMotion",
          "showWhitespace",
        ])
          next[key] = data.has(key);
        this.settings = {
          ...DEFAULT_SETTINGS,
          ...(await this.bridge.settings(next)),
        };
        this.mode = this.settings.editorView;
        this.applySettings();
        this.closeModal();
        this.renderAll();
        break;
      }
      case "edit-node-form": {
        const context = this.modalContext;
        if (
          context?.kind !== "node" ||
          context.file.revision !== context.revision
        )
          throw new Error(
            "Код изменился. Закройте окно и выберите блок заново.",
          );
        const button = $("[form=edit-node-form]", this.dialog);
        button.disabled = true;
        try {
          const result = await this.client.edit(
            context.file.content,
            context.file.methodId,
            context.node.id,
            context.action ?? "replace",
            String(data.get("code")),
          );
          if (context.file.revision !== context.revision)
            throw new Error("Код изменился во время проверки");
          context.file.update(result.source);
          context.file.applyModel(result.model, context.file.revision);
          this.closeModal();
          this.editor?.refresh();
          this.notify(
            context.action && context.action !== "replace"
              ? "Новый блок добавлен в Java-код. Сохраните файл, когда проверите результат."
              : "Блок изменён. Нажмите «Сохранить», чтобы записать Java-файл.",
          );
        } catch (error) {
          const target = $("#node-edit-error", this.dialog);
          if (target) {
            target.hidden = false;
            target.textContent = readableError(error);
          }
        } finally {
          button.disabled = false;
        }
        break;
      }
      default:
        await this.quality.submit(form);
    }
  }

  bind() {
    const signal = this.controller.signal;
    this.quality.bind(this.root, signal);
    document.addEventListener(
      "click",
      (event) => {
        if (this.toolsOpen && !event.target.closest("#ide-tools-menu, #ide-tools-trigger, [data-action=help-menu]")) this.closeTools();
        if (this.noticesOpen && !event.target.closest("#ide-notify-panel, .ide-bell")) this.closeNotices();
        const target = event.target.closest("[data-action]");
        if (target && !target.disabled && !event.defaultPrevented) {
          event.preventDefault();
          this.safe(() => this.action(target.dataset.action, target));
        }
        if (event.target === this.dialog) this.closeModal();
      },
      { signal },
    );
    document.addEventListener(
      "submit",
      (event) => {
        if (event.target instanceof HTMLFormElement) {
          event.preventDefault();
          this.safe(() => this.submit(event.target));
        }
      },
      { signal },
    );
    this.root.addEventListener(
      "input",
      (event) => {
        if (event.target.id === "console-stdin") this.runConfig.input = event.target.value;
        if (event.target.id === "tools-filter") {
          const menu = $("#ide-tools-menu", this.root);
          filterTools(menu, event.target.value);
          if (!event.target.value && this.toolsGroup) menu.querySelectorAll(".tool-group").forEach((item) => { item.hidden = item.dataset.group !== this.toolsGroup && !(this.toolsGroup === "check" && item.dataset.group === "run"); });
        }
      },
      { signal },
    );
    this.root.addEventListener(
      "change",
      (event) => {
        if (event.target.id === "ide-method-select")
          this.safe(() => this.selectMethod(event.target.value));
      },
      { signal },
    );
    this.dialog.addEventListener(
      "cancel",
      (event) => {
        event.preventDefault();
        this.closeModal();
      },
      { signal },
    );
    document.addEventListener(
      "keydown",
      (event) => {
        if (this.dialog.open) return;
        if (event.key === "Escape" && this.learningStep != null) { event.preventDefault(); return this.endLearning(); }
        if (event.key === "Escape" && this.focusMode) { event.preventDefault(); return this.toggleFocus(); }
        if (event.key === "Escape" && this.noticesOpen) {
          event.preventDefault();
          return this.closeNotices();
        }
        if (event.key === "Escape" && this.toolsOpen) {
          event.preventDefault();
          this.closeTools();
          return $("#ide-tools-trigger", this.root)?.focus();
        }
        if (event.altKey && !event.ctrlKey && event.code === "KeyT") {
          event.preventDefault();
          return this.safe(() => this.action("tools-menu"));
        }
        if (event.altKey && !event.ctrlKey && this.project) {
          const target = ws.WORKSPACES.find((item) => item.key === event.key);
          if (target || event.key === "ArrowLeft") {
            event.preventDefault();
            return this.safe(() => (target ? this.setWorkspace(target.id) : this.navigateBack()));
          }
        }
        const command = shortcutCommand(event);
        if (!command) return;
        event.preventDefault();
        this.safe(() => this.action(command));
      },
      { signal },
    );
    this.root.addEventListener(
      "contextmenu",
      (event) => {
        const item = event.target.closest("[data-tree-path]");
        if (!item) return;
        event.preventDefault();
        this.selectedPath = item.dataset.treePath;
        this.renderSidebar();
        this.safe(() => this.action("explorer-menu"));
      },
      { signal },
    );
    let draggedTab = null;
    this.root.addEventListener(
      "dragstart",
      (event) => {
        const tab = event.target.closest("[data-tab]");
        if (tab) {
          draggedTab = tab.dataset.tab;
          event.dataTransfer.setData("text/plain", draggedTab);
        }
      },
      { signal },
    );
    this.root.addEventListener(
      "dragover",
      (event) => {
        if (draggedTab && event.target.closest("[data-tab]"))
          event.preventDefault();
      },
      { signal },
    );
    this.root.addEventListener(
      "drop",
      (event) => {
        const tab = event.target.closest("[data-tab]");
        if (tab && draggedTab) {
          event.preventDefault();
          this.documents.reorder(draggedTab, tab.dataset.tab);
          draggedTab = null;
        }
      },
      { signal },
    );
    window.addEventListener(
      "beforeunload",
      (event) => {
        this.saveSession();
        if (this.documents.hasDirty) {
          event.preventDefault();
          event.returnValue = "";
        }
      },
      { signal },
    );
    this.bindResizer(
      $(".ide-sidebar-resizer", this.root),
      "horizontal",
      (delta) => {
        this.settings.explorerWidth = clamp(
          this.settings.explorerWidth + delta,
          190,
          420,
        );
        this.applySettings();
      },
    );
    this.bindResizer(
      $(".ide-panel-resizer", this.root),
      "vertical",
      (delta) => {
        this.settings.panelHeight = clamp(
          this.settings.panelHeight - delta,
          130,
          500,
        );
        this.applySettings();
      },
    );
  }

  bindResizer(element, direction, update) {
    if (!element) return;
    let previous = null;
    const signal = this.controller.signal;
    element.addEventListener(
      "pointerdown",
      (event) => {
        previous = direction === "horizontal" ? event.clientX : event.clientY;
        element.setPointerCapture(event.pointerId);
        element.classList.add("resizing");
      },
      { signal },
    );
    element.addEventListener(
      "pointermove",
      (event) => {
        if (previous === null) return;
        const current =
          direction === "horizontal" ? event.clientX : event.clientY;
        update(current - previous);
        previous = current;
      },
      { signal },
    );
    element.addEventListener(
      "pointerup",
      () => {
        previous = null;
        element.classList.remove("resizing");
        this.bridge.settings(this.settings).catch(() => {});
      },
      { signal },
    );
    element.addEventListener(
      "keydown",
      (event) => {
        if (
          ["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"].includes(
            event.key,
          )
        ) {
          event.preventDefault();
          update(["ArrowLeft", "ArrowUp"].includes(event.key) ? -10 : 10);
        }
      },
      { signal },
    );
  }

  bindSplitters() {
    const splitter = $(".ide-splitter", this.root);
    const area = $(".ide-workarea", this.root);
    if (!splitter || !area) return;
    this.bindResizer(splitter, "horizontal", (delta) => {
      const current =
        parseFloat(area.style.getPropertyValue("--code-width")) || 42;
      const change = (delta / Math.max(1, area.clientWidth)) * 100;
      area.style.setProperty(
        "--code-width",
        clamp(current + change, 25, 70) + "%",
      );
    });
  }
}

const root = typeof document === "undefined" ? null : $("#ide-root");
if (root) {
  const application = new IdeApplication(root);
  application.start().catch((error) => {
    root.innerHTML = `<div class="ide-start-error"><h1>Не удалось открыть IDE</h1><p>${e(readableError(error))}</p></div>`;
    console.error(error);
  });
}
