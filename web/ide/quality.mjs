import { $, $$, debounce, download, readableError } from "./core.mjs";
import * as qv from "./quality-views.mjs";
import { projectArchive } from "../lib/export.mjs";

const TESTS_FILE = "blueprints-tests.json";
const normalize = (source) => String(source).replace(/^﻿/, "").replace(/\r\n?/g, "\n");
/** FNV-1a: cheap identity of a method body for remembering its blueprint layout. */
function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16) + ":" + text.length;
}

const uid = () => "case-" + (crypto.randomUUID?.() ?? Date.now() + Math.random()).toString().slice(0, 18);

/**
 * Analysis, refactoring, decomposition and behaviour verification inside the IDE.
 * The baseline is the project as it was when opened (or when the user re-pins it);
 * every candidate is the current editor content compared against it on stdin cases.
 */
export class QualityLab {
  constructor(app) {
    this.app = app;
    this.persistSoon = debounce(() => this.persist(), 500);
    this.reset(null);
  }

  get client() {
    return this.app.client;
  }
  get bridge() {
    return this.app.bridge;
  }

  reset(project) {
    this.project = project;
    this.baseline = null;
    this.cases = [];
    this.report = null;
    this.reportJobId = null;
    this.reportStale = false;
    this.analysis = null;
    this.analysisSources = {};
    this.analysisStale = false;
    this.analysing = false;
    this.analysisError = null;
    this.filter = null;
    this.plans = new Map();
    this.details = new Map();
    this.tab = "inputs";
    this.lab = { mutation: null, benchmark: null, reduction: null, reducerInput: "" };
    this.job = null;
    this.layouts = {};
    this.pending = null;
    this.changedDuringCheck = false;
    this.projectPlans = null;
    this.projectPlansLoading = false;
  }

  // ---------- blueprint layouts ----------

  layoutFor(key, body) {
    const saved = this.layouts?.[key];
    return saved && saved.bodyHash === hash(body) ? saved : null;
  }

  saveLayout(key, body, graph) {
    this.layouts[key] = {
      bodyHash: hash(body),
      bodyStart: graph.bodyStart,
      nodes: graph.nodes,
      links: graph.links,
      savedAt: Date.now(),
    };
    const keys = Object.keys(this.layouts);
    if (keys.length > 150)
      for (const old of keys.sort((a, b) => this.layouts[a].savedAt - this.layouts[b].savedAt).slice(0, keys.length - 150))
        delete this.layouts[old];
    this.persistSoon();
  }

  // ---------- project lifecycle ----------

  async open(project) {
    this.reset(project);
    let saved = null;
    try {
      saved = await this.bridge.projectState(project.id);
    } catch {}
    if (this.project?.id !== project.id) return;
    if (saved?.baseline?.files && Object.keys(saved.baseline.files).length)
      this.baseline = saved.baseline;
    this.layouts = saved?.layouts ?? {};
    const bundled = await this.readTestsFile();
    if (saved?.cases?.length) this.cases = saved.cases;
    else if (bundled?.cases?.length) this.cases = bundled.cases;
    if (bundled?.mainClass && !this.app.runConfig.mainClass)
      this.app.runConfig.mainClass = bundled.mainClass;
    if (!this.baseline) {
      try {
        await this.captureBaseline("Снимок при открытии проекта", { fromDisk: true, quiet: true });
      } catch (error) {
        this.app.notify("Исходная версия не зафиксирован: " + readableError(error), "warning");
      }
    }
    this.persistSoon();
    this.render();
    // Diagnostics markers on the blueprint need the project-wide pass; run it quietly.
    if (this.client.online)
      this.analyseProject({ reveal: false }).catch(() => {});
  }

  async readTestsFile() {
    try {
      const file = await this.bridge.read(this.project.id, TESTS_FILE);
      const parsed = JSON.parse(file.content);
      const list = Array.isArray(parsed) ? parsed : (parsed.cases ?? parsed.inputs ?? []);
      return {
        mainClass: typeof parsed.mainClass === "string" ? parsed.mainClass : "",
        cases: list.slice(0, 30).map((item, index) => ({
          id: uid(),
          name: typeof item === "string" ? `Вход ${index + 1}` : (item.name ?? `Вход ${index + 1}`),
          input: typeof item === "string" ? item : String(item.input ?? ""),
          enabled: item.enabled !== false,
          category: "project",
        })),
      };
    } catch {
      return null;
    }
  }

  async persist() {
    if (!this.project) return;
    await this.bridge
      .projectState(this.project.id, { baseline: this.baseline, cases: this.cases, layouts: this.layouts })
      .catch((error) => this.app.notify("Не удалось сохранить тесты: " + readableError(error), "warning"));
  }

  invalidate() {
    if (this.report) this.reportStale = true;
    if (this.job && ["queued", "running"].includes(this.job.state)) this.changedDuringCheck = true;
    if (this.analysis) this.analysisStale = true;
    this.renderStatus();
  }

  // ---------- sources ----------

  async javaPaths() {
    const scan = await this.bridge.scan(this.project.id);
    const paths = scan.files
      .map((file) => file.path)
      .filter((path) => path.endsWith(".java") && !/(^|\/)src\/test\//.test(path));
    if (paths.length > 300)
      throw new Error(`В проекте ${paths.length} Java-файлов. Анализ и проверка поддерживают до 300.`);
    return paths;
  }

  /** Current project sources: open editor buffers win over the disk. */
  async collect({ fromDisk = false } = {}) {
    if (!this.project) throw new Error("Сначала откройте папку проекта");
    const id = this.project.id;
    const files = {};
    for (const path of await this.javaPaths()) {
      const open = this.app.documents.documents.get(path);
      files[path] = normalize(
        !fromDisk && open ? open.content : (await this.bridge.read(id, path)).content,
      );
    }
    if (this.project?.id !== id) throw new Error("Проект был закрыт");
    if (!Object.keys(files).length) throw new Error("В проекте нет Java-файлов");
    return files;
  }

  async captureBaseline(label, { fromDisk = false, quiet = false } = {}) {
    const files = await this.collect({ fromDisk });
    this.baseline = { files, takenAt: new Date().toISOString(), label };
    this.report = null;
    this.persistSoon();
    if (!quiet) this.app.notify("Исходная версия обновлён: дальнейшие изменения сравниваются с этой версией.");
    this.render();
  }

  // ---------- rendering ----------

  render() {
    if (this.app.panel === "verify" && !this.app.panelHidden) this.renderPanel();
    this.app.renderWorkspace?.();
    this.renderStatus();
  }

  renderStatus() {
    this.app.renderLoader?.();
    const target = $("#ide-quality-status", this.app.root);
    if (!target) return;
    target.hidden = !this.project;
    target.innerHTML = qv.qualityStatus({
      report: this.report,
      stale: this.reportStale,
      job: this.job,
      project: this.project,
    });
  }

  sidebarHtml(name) {
    if (name === "analysis") {
      if (this.project && !this.analysis && !this.analysing && !this.analysisError && this.client.online)
        queueMicrotask(() => this.app.safe(() => this.analyseProject()));
      return qv.analysisSidebar({
        project: this.project,
        analysis: this.analysis,
        analysing: this.analysing,
        stale: this.analysisStale,
        error: this.analysisError,
        filter: this.filter,
      });
    }
    const document = this.app.documents.active;
    if (document?.language === "java" && !this.plansFor(document) && this.app.client.online)
      queueMicrotask(() => this.app.safe(() => this.loadPlans(document)));
    return qv.improveSidebar({
      document,
      entry: document ? this.plansFor(document) : null,
      analysis: this.analysis,
      method: document?.selectedMethod?.() ?? null,
    });
  }

  renderPanel(target = $("#ide-panel-body", this.app.root)) {
    if (!target) return;
    const focused = document.activeElement;
    const focus =
      focused && target.contains(focused) && focused.dataset.id
        ? { id: focused.dataset.id, cls: focused.className, start: focused.selectionStart, end: focused.selectionEnd }
        : null;
    const scroll = $(".q-verify-body", target)?.scrollTop ?? 0;
    const active = this.app.documents.active;
    target.innerHTML = qv.verifyPanel({
      project: this.project,
      baseline: this.baseline,
      cases: this.cases,
      report: this.report,
      stale: this.reportStale,
      job: this.job,
      tab: this.tab,
      lab: this.lab,
      pending: this.pending,
      method: active?.language === "java" ? active.selectedMethod() : null,
      document: active,
    });
    const body = $(".q-verify-body", target);
    if (body) body.scrollTop = scroll;
    if (focus) {
      const element = $(`.${focus.cls.split(" ")[0]}[data-id="${CSS.escape(focus.id)}"]`, target);
      element?.focus();
      if (element && focus.start != null) element.setSelectionRange?.(focus.start, focus.end);
    }
  }

  openPanel(tab) {
    if (tab) this.tab = tab;
    // Outside the editor the overview, task and check pages show the result themselves.
    if (this.app.project && this.app.workspace && this.app.workspace !== "method") {
      if (this.app.workspace !== "verify" && tab !== "results") this.app.setWorkspace("verify");
      else this.render();
      return;
    }
    this.app.panel = "verify";
    this.app.panelHidden = false;
    if (this.app.settings.panelHeight < 300) {
      this.app.settings.panelHeight = 320;
      this.app.applySettings();
    }
    this.app.renderPanel();
  }

  async showSidebar(name) {
    await this.app.setSidebar(name);
  }

  // ---------- analysis ----------

  async analyseProject({ reveal = true } = {}) {
    if (!this.project) return reveal ? this.app.notify("Сначала откройте папку проекта") : undefined;
    if (this.analysing) return;
    this.analysing = true;
    this.analysisError = null;
    if (reveal && (this.app.workspace !== "tasks" || this.app.home)) this.app.setWorkspace("tasks");
    else this.app.renderWorkspace?.();
    const id = this.project.id;
    try {
      const files = await this.collect();
      const result = await this.client.request("/project", { files }, { timeout: 120000 });
      if (this.project?.id !== id) return;
      this.analysis = result;
      this.analysisSources = files;
      this.analysisStale = false;
      if (reveal)
        this.app.notify(
          `Анализ готов: ${result.stats?.files ?? 0} файлов, ${result.stats?.methods ?? 0} методов, ${result.findings.length} замечаний`,
        );
    } catch (error) {
      this.analysisError = readableError(error);
      throw error;
    } finally {
      this.analysing = false;
      if (this.project?.id === id) {
        this.app.renderSidebar();
        this.app.renderGraph();
        this.app.renderWorkspace?.();
      }
    }
  }

  findingsFor(document) {
    const local = (document.currentModel?.findings ?? []).map((finding) => ({
      ...finding,
      fileName: document.path,
    }));
    const project =
      this.analysis && this.analysisSources[document.path] === normalize(document.content)
        ? this.analysis.findings.filter((finding) => finding.fileName === document.path)
        : [];
    const seen = new Set();
    return [...local, ...project].filter((finding) => {
      const key = `${finding.rule}:${finding.start}:${finding.end}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  nodeFor(method, finding) {
    const nodes = method?.graph?.nodes ?? [];
    return (
      nodes
        .filter((node) => node.start >= 0 && node.start <= finding.start && node.end >= finding.end)
        .sort((a, b) => a.end - a.start - (b.end - b.start))[0] ??
      nodes
        .filter((node) => node.line === finding.line)
        .sort((a, b) => a.end - a.start - (b.end - b.start))[0] ??
      null
    );
  }

  async openLocation(path, { methodId = null, line = 1, start = -1, end = -1, finding = null } = {}) {
    const switching = this.app.workspace !== "method";
    this.app.workspace = "method";
    await this.app.openFile(path);
    if (switching) {
      this.app.renderWorkspaceNav();
      this.app.renderTabs();
      this.app.renderToolbar();
      this.app.renderCenter();
    }
    const document = this.app.documents.active;
    if (!document || document.path !== path) return;
    if (document.language === "java" && !document.currentModel) await this.app.analyse(document);
    const model = document.currentModel;
    const method =
      model?.methods.find((item) => item.id === methodId) ??
      model?.methods
        .filter((item) => (start >= 0 ? item.start <= start && item.end >= start : item.line <= line))
        .sort((a, b) => a.end - a.start - (b.end - b.start))[0] ??
      null;
    if (this.app.mode !== "split") this.app.setMode("split");
    if (method) {
      document.methodId = method.id;
      document.selectedNode = null;
      await this.app.renderGraph();
      const editor = this.app.graph;
      const node = finding && editor?.graph ? this.nodeFor({ graph: editor.graph }, finding) : null;
      if (node) {
        editor.select(node.id);
        editor.center(node.id);
      }
    }
    this.app.editor?.goTo(line === 1 && method?.line ? method.line : line, 1);
  }

  async openFinding(index) {
    const finding = this.analysis?.findings[index];
    if (!finding) return;
    await this.openLocation(finding.fileName, {
      methodId: finding.methodId,
      line: finding.line,
      start: finding.start,
      end: finding.end,
      finding,
    });
  }

  // ---------- graph decoration ----------

  decorateGraph(editor, document, method) {
    if (!editor || !method) return;
    const graph = editor;
    const nodes = { graph: editor.graph ?? method.graph };
    const findings = this.findingsFor(document).filter(
      (finding) =>
        (finding.methodId === method.id || (finding.start >= method.start && finding.end <= method.end)) &&
        finding.start >= 0,
    );
    const marks = new Map();
    const notes = new Map();
    for (const finding of findings) {
      const node = this.nodeFor(nodes, finding);
      if (node) notes.set(node.id, [...(notes.get(node.id) ?? []), finding]);
      if (!node) continue;
      const current = marks.get(node.id);
      if (!current || current === "info" || (current === "warning" && finding.severity === "error"))
        marks.set(node.id, finding.severity);
    }
    graph.mark?.(marks);
    graph.setNotes?.(new Map([...notes].map(([id, list]) => [id, qv.nodeFindings(list)])));
    const target = $("#ide-method-metrics", this.app.root);
    if (target) {
      const detail = this.detailFor(document, method);
      target.innerHTML = qv.methodMetrics(detail, findings.length);
      if (!detail) this.app.safe(() => this.loadDetail(document, method));
    }
  }

  methodFindings(document, node) {
    if (!node || node.start < 0) return [];
    const method = document.selectedMethod();
    return this.findingsFor(document).filter((finding) => this.nodeFor(method, finding)?.id === node.id);
  }

  detailKey(document, method) {
    return `${document.path}|${document.revision}|${method.id}`;
  }

  detailFor(document, method) {
    return this.details.get(this.detailKey(document, method)) ?? null;
  }

  async loadDetail(document, method) {
    const key = this.detailKey(document, method);
    if (this.details.has(key) || this.loadingDetail === key || !this.client.online) return;
    this.loadingDetail = key;
    try {
      const detail = await this.client.request("/method", { source: document.content, methodId: method.id });
      if (this.details.size > 200) this.details.clear();
      this.details.set(key, detail);
      if (this.app.documents.active === document && document.methodId === method.id) {
        const target = $("#ide-method-metrics", this.app.root);
        if (target) target.innerHTML = qv.methodMetrics(detail, this.findingsFor(document).filter((finding) => finding.start >= method.start && finding.end <= method.end).length);
        const why = $("#ide-method-why", this.app.root);
        if (why) why.innerHTML = qv.complexityDetails(detail);
      }
    } catch {
      // Metrics are optional decoration; the blueprint itself already rendered.
    } finally {
      if (this.loadingDetail === key) this.loadingDetail = null;
    }
  }

  // ---------- refactoring plans ----------

  plansFor(document) {
    const entry = this.plans.get(document.path);
    return entry?.revision === document.revision ? entry : null;
  }

  async loadPlans(document = this.app.documents.active) {
    if (!document || document.language !== "java") return;
    const existing = this.plansFor(document);
    if (existing?.loading) return;
    const entry = { revision: document.revision, loading: true, data: null, error: null };
    this.plans.set(document.path, entry);
    if (this.app.sidebar === "improve") this.app.renderSidebar();
    try {
      entry.data = await this.client.request("/plans", { source: document.content });
    } catch (error) {
      entry.error = readableError(error);
    } finally {
      entry.loading = false;
      if (this.app.sidebar === "improve") this.app.renderSidebar();
    }
  }

  /** Plans for every Java file of the project, for the task list. */
  async loadProjectPlans() {
    if (!this.project || this.projectPlansLoading) return;
    const id = this.project.id;
    this.projectPlansLoading = true;
    this.app.renderWorkspace?.();
    try {
      const files = await this.collect();
      const result = {};
      for (const [path, source] of Object.entries(files)) {
        try {
          result[path] = await this.client.request("/plans", { source });
        } catch {
          result[path] = { plans: [] };
        }
      }
      if (this.project?.id === id) this.projectPlans = result;
    } finally {
      this.projectPlansLoading = false;
      if (this.project?.id === id) this.app.renderWorkspace?.();
    }
  }

  /** Opens the task's file and returns the same plan computed for the editor's current text. */
  async planForTask(path, id) {
    const listed = Object.values(this.projectPlans?.[path]?.plans ?? []).find((plan) => plan.id === id);
    await this.app.openFile(path);
    const document = this.app.documents.active;
    if (document?.path !== path) throw new Error("Не удалось открыть файл задачи");
    if (!this.plansFor(document)?.data) await this.loadPlans(document);
    const plans = this.plansFor(document)?.data?.plans ?? [];
    const plan =
      plans.find((item) => item.id === id) ??
      plans.find((item) => listed && item.rule === listed.rule && item.methodId === listed.methodId);
    if (!plan) {
      this.projectPlans = null;
      this.app.renderWorkspace?.();
      throw new Error("Код изменился, и это исправление больше не применимо. Список задач обновлён.");
    }
    return plan;
  }

  /** Saving the files of a pending change accepts it. */
  accepted(path) {
    if (!this.pending?.docs.some((item) => item.path === path)) return;
    if (this.app.documents.documents.get(path)?.dirty) return;
    this.pending = null;
    this.render();
  }

  /** After an accepted change the project map and the task list must be rebuilt. */
  refreshAfterChange() {
    this.projectPlans = null;
    this.analyseProject({ reveal: false }).catch(() => {});
  }

  findPlan(id) {
    const document = this.app.documents.active;
    const entry = document ? this.plansFor(document) : null;
    return entry?.data?.plans.find((plan) => plan.id === id) ?? null;
  }

  async applyPlans(ids) {
    const document = this.app.documents.active;
    const entry = document ? this.plansFor(document) : null;
    if (!entry?.data) throw new Error("Предложения устарели. Обновите список улучшений.");
    if (document.readOnly) throw new Error("Файл открыт только для чтения");
    const target = entry.data.plans.find((plan) => plan.id === ids[0]);
    const targetMethod = document.currentModel?.methods.find((method) => method.id === target?.methodId);
    const result = await this.client.request("/plans/apply", {
      source: document.content,
      sourceHash: entry.data.sourceHash,
      planIds: ids,
    });
    if (this.app.documents.active !== document || document.revision !== entry.revision)
      throw new Error("Код изменился во время применения. Повторите.");
    this.pending = { label: target?.title ?? "улучшение", docs: [{ path: document.path, content: document.content }], created: null };
    document.update(result.source);
    this.app.closeModal();
    this.app.editor?.refresh();
    await this.app.analyse(document);
    const changed = targetMethod
      ? document.currentModel?.methods.find(
          (method) => method.name === targetMethod.name && method.owner === targetMethod.owner,
        )
      : null;
    if (changed && document.methodId !== changed.id) {
      document.methodId = changed.id;
      document.selectedNode = null;
      this.app.renderGraph();
    }
    this.app.notify(
      `Применено улучшений: ${result.applied.length}. Изменения в редакторе — проверяем поведение против исходной версии.`,
    );
    await this.loadPlans(document);
    await this.verifyAfterChange();
    this.refreshAfterChange();
  }

  async verifyAfterChange() {
    if (this.cases.some((item) => item.enabled !== false)) await this.verify();
    else {
      this.openPanel("inputs");
      this.app.notify("Добавьте тестовые входы (stdin), чтобы проверить, что поведение не изменилось.", "warning", 8000);
    }
  }

  // ---------- decomposition ----------

  async openDecompose(moduleId) {
    if (!this.analysis || this.analysisStale) await this.analyseProject();
    const module = this.analysis.modules.find((item) => item.id === moduleId);
    if (!module) throw new Error("Группа методов не найдена. Обновите анализ.");
    const methods = new Map(this.analysis.methods.map((method) => [method.id, method]));
    const members = module.methods.map((id) => methods.get(id)).filter(Boolean);
    const active = this.app.documents.active?.path;
    const byFile = new Map();
    for (const method of members) byFile.set(method.fileName, (byFile.get(method.fileName) ?? 0) + 1);
    const fileName = byFile.has(active)
      ? active
      : [...byFile.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const list = members.filter((method) => method.fileName === fileName);
    this.app.modalContext = { kind: "decompose", fileName, projectId: this.project.id };
    this.app.showModal(qv.decomposeModal({ module, methods: list, fileName, className: module.suggestedClass }));
  }

  openExtract() {
    const document = this.app.documents.active;
    const method = document?.selectedMethod();
    if (!method) throw new Error("Выберите метод в режиме «Метод»");
    if (!method.static) throw new Error("Выносятся static-методы: метод экземпляра зависит от состояния объекта");
    this.app.modalContext = { kind: "extract", fileName: document.path, methodId: method.id, projectId: this.project.id };
    this.app.showModal(qv.extractModal(method));
  }

  async decompose({ fileName, methodIds, className, errorTarget }) {
    const projectId = this.project.id;
    const files = await this.collect();
    let result;
    try {
      result = await this.client.request(
        "/decompose",
        { files, fileName, methodIds, className },
        { timeout: 90000 },
      );
    } catch (error) {
      const target = $(errorTarget, this.app.dialog);
      if (target) {
        target.hidden = false;
        target.textContent = readableError(error);
        return;
      }
      throw error;
    }
    if (this.project?.id !== projectId) throw new Error("Проект сменился во время выделения класса — результат не применён");
    const now = await this.collect();
    if (JSON.stringify(now) !== JSON.stringify(files))
      throw new Error("Код изменился во время выделения класса — результат не применён. Повторите операцию.");
    await this.app.openFile(fileName);
    const document = this.app.documents.documents.get(fileName);
    const previous = document.content;
    document.update(result.files[fileName]);
    try {
      await this.bridge.create(projectId, { path: result.created, kind: "file", content: result.files[result.created] });
    } catch (error) {
      // One operation: without the new class the delegates would not compile.
      document.update(previous);
      this.app.editor?.refresh();
      throw new Error("Не удалось создать " + result.created + ": изменения отменены. " + readableError(error));
    }
    this.pending = { label: "выделение " + className, docs: [{ path: fileName, content: previous }], created: result.created };
    this.app.closeModal();
    this.app.editor?.refresh();
    await this.app.refreshTree();
    await this.app.analyse(document);
    this.analysisStale = true;
    this.app.notify(qv.decomposeResultNote(result) + ". Новый файл создан, исходный изменён в редакторе.", "info", 10000);
    await this.verifyAfterChange();
    this.refreshAfterChange();
  }

  // ---------- cases ----------

  setCases(cases) {
    this.cases = cases.slice(0, 30);
    this.invalidate();
    this.persistSoon();
    this.render();
  }

  updateCase(id, patch) {
    const item = this.cases.find((value) => value.id === id);
    if (!item) return;
    Object.assign(item, patch);
    this.persistSoon();
    this.reportStale = Boolean(this.report);
    this.renderStatus();
  }

  async generate(form) {
    const data = new FormData(form);
    const number = (name) => Number(data.get(name));
    const result = await this.client.request("/inputs/generate", {
      schema: String(data.get("schema")),
      seed: number("seed"),
      count: number("count"),
      maximumLength: number("maximumLength"),
      minimum: number("minimum"),
      maximum: number("maximum"),
    });
    const generated = result.cases.map((item) => ({
      id: uid(),
      name: item.name,
      input: item.input,
      enabled: true,
      category: item.category ?? "generated",
    }));
    const base = data.has("replace") ? [] : this.cases;
    const seen = new Set(base.map((item) => item.input));
    this.setCases([...base, ...generated.filter((item) => !seen.has(item.input))]);
    this.app.closeModal();
    this.openPanel("inputs");
    this.app.notify(`Добавлено входов: ${generated.length} · seed ${result.seed}`);
  }

  // ---------- jobs ----------

  async runJob(kind, payload) {
    if (this.job && ["queued", "running"].includes(this.job.state))
      throw new Error("Дождитесь завершения текущей проверки или отмените её.");
    const id = this.project.id;
    this.job = { kind, state: "queued", stage: qv.jobTitle(kind) };
    this.render();
    try {
      const result = await this.client.startJob(
        kind,
        { ...payload, mainClass: this.app.runConfig.mainClass || "" },
        (job) => {
          if (this.project?.id !== id) return;
          this.job = { ...job, kind };
          this.renderStatus();
          if (this.app.panel === "verify" && !this.app.panelHidden) this.renderPanel();
        },
      );
      return this.project?.id === id ? result : null;
    } finally {
      if (this.project?.id === id) {
        this.job = null;
        this.render();
      }
    }
  }

  enabledCases() {
    return this.cases.filter((item) => item.enabled !== false);
  }

  async verify() {
    if (!this.project) return this.app.notify("Сначала откройте папку проекта");
    if (!this.client.online) throw new Error("Java-сервис недоступен: проверка поведения требует локальной JVM.");
    if (!this.baseline) await this.captureBaseline("Снимок при первой проверке", { fromDisk: true, quiet: true });
    const cases = this.enabledCases();
    if (!cases.length) {
      this.openPanel("inputs");
      throw new Error("Добавьте и включите хотя бы один тестовый вход (stdin)");
    }
    this.openPanel("results");
    const candidate = await this.collect();
    this.reportStale = false;
    this.changedDuringCheck = false;
    const job = await this.runJob("compare", {
      original: this.baseline.files,
      candidate,
      inputs: cases.map((item) => item.input),
    });
    if (!job) return;
    this.report = { ...job.result, caseNames: cases.map((item) => item.name), finishedAt: new Date().toISOString() };
    this.reportJobId = job.id;
    this.reportFiles = candidate;
    // The result belongs to the code and inputs captured at the start, not to later edits.
    this.reportStale = this.changedDuringCheck === true;
    // A passed change stays pending until the user saves it (accept) or rolls it back.
    this.tab = "results";
    this.render();
    const passed = this.report.tests.filter((test) => test.passed).length;
    this.app.notify(
      this.report.passed
        ? `Поведение сохранено: ${passed}/${this.report.tests.length} входов совпали с исходной версией.`
        : `Обнаружено расхождение с исходной версией: ${this.report.tests.length - passed} из ${this.report.tests.length}.`,
      this.report.passed ? "info" : "warning",
      8000,
    );
  }

  async mutation() {
    const document = this.app.documents.active;
    const method = document?.selectedMethod();
    if (!method) throw new Error("Выберите метод в режиме «Метод»");
    const cases = this.enabledCases().slice(0, 5);
    if (!cases.length) throw new Error("Нужен хотя бы один тестовый вход");
    this.openPanel("mutation");
    const files = await this.collect();
    const job = await this.runJob("mutation", {
      files,
      fileName: document.path,
      methodId: method.id,
      inputs: cases.map((item) => item.input),
      maximum: 6,
    });
    if (job) {
      this.lab.mutation = job.result;
      this.render();
    }
  }

  async benchmark(form) {
    const data = new FormData(form);
    const document = this.app.documents.active;
    if (!document || document.language !== "java") throw new Error("Откройте Java-файл с методом");
    const sizes = String(data.get("sizes"))
      .split(/[,\s]+/)
      .map(Number)
      .filter((value) => Number.isInteger(value) && value > 0);
    const candidate = await this.collect();
    if (!this.baseline.files[document.path]) throw new Error("Файла нет в исходной версии — бенчмарк сравнивает одну и ту же функцию до и после");
    const job = await this.runJob("benchmark", {
      original: this.baseline.files,
      candidate,
      fileName: document.path,
      methodName: String(data.get("methodName")).trim(),
      sizes: sizes.slice(0, 5).map(String),
      repetitions: 5,
    });
    if (job) {
      this.lab.benchmark = job.result;
      this.render();
    }
  }

  async reduce(input) {
    this.lab.reducerInput = input;
    this.openPanel("reducer");
    const candidate = await this.collect();
    const job = await this.runJob("minimize", {
      original: this.baseline.files,
      candidate,
      input,
      budget: 24,
    });
    if (job) {
      this.lab.reduction = job.result;
      this.render();
    }
  }

  async exportEvidence() {
    if (!this.report) throw new Error("Сначала выполните проверку поведения");
    let evidence = null;
    try {
      evidence = await this.client.request("/evidence", {
        original: this.baseline.files,
        candidate: this.reportFiles,
        ...(this.reportJobId ? { jobId: this.reportJobId } : {}),
      });
    } catch {}
    const bytes = projectArchive(
      {
        name: this.project.name,
        files: this.reportFiles,
        baseline: this.baseline.files,
        cases: this.enabledCases(),
        report: this.report,
        project: this.analysis,
        benchmark: this.lab.benchmark,
        mutations: this.lab.mutation,
      },
      evidence,
    );
    download(`${this.project.name}-behaviour-evidence.zip`, new Blob([bytes], { type: "application/zip" }));
  }

  /** Restores the files an automatic change touched and removes a class it created. */
  async rollback() {
    const change = this.pending;
    if (!change) return;
    for (const item of change.docs) {
      await this.app.openFile(item.path);
      this.app.documents.documents.get(item.path)?.update(item.content);
    }
    if (change.created) {
      const open = this.app.documents.documents.get(change.created);
      if (open) await this.app.closeTab(change.created);
      await this.bridge.trash(this.project.id, change.created).catch(() => {});
      await this.app.refreshTree();
    }
    this.pending = null;
    this.app.editor?.refresh();
    const document = this.app.documents.active;
    if (document?.language === "java") await this.app.analyse(document);
    this.invalidate();
    this.refreshAfterChange();
    this.render();
    this.app.notify(`Изменение «${change.label}» отменено.`);
  }

  baselineChanges(current) {
    const names = [...new Set([...Object.keys(this.baseline?.files ?? {}), ...Object.keys(current)])].sort();
    return names
      .map((path) => {
        const before = this.baseline?.files[path];
        const after = current[path];
        if (before === after) return null;
        return {
          path,
          before: before ?? "",
          after: after ?? "",
          status: before === undefined ? "added" : after === undefined ? "deleted" : "modified",
        };
      })
      .filter(Boolean);
  }

  // ---------- dispatch ----------

  async action(name, element) {
    const data = element?.dataset ?? {};
    switch (name) {
      case "quality-analyse":
        await this.analyseProject();
        return true;
      case "finding-filter":
        this.filter = this.filter === data.severity ? null : data.severity;
        this.app.renderSidebar();
        return true;
      case "open-finding":
        await this.openFinding(Number(data.index));
        return true;
      case "open-hotspot":
        await this.openLocation(data.file, { methodId: data.method });
        return true;
      case "complexity-why": {
        const document = this.app.documents.active;
        const method = document?.currentModel?.methods.find((item) => item.id === data.method);
        if (!document || !method) return true;
        const detail = this.detailFor(document, method) ?? (await this.loadDetail(document, method), this.detailFor(document, method));
        this.app.showModal(qv.complexityModal(method, detail));
        return true;
      }
      case "improve":
      case "analysis-view":
        this.app.setWorkspace("tasks");
        return true;
      case "plans-refresh":
        await this.loadPlans();
        return true;
      case "plan-preview": {
        const plan = this.findPlan(data.id);
        if (!plan) throw new Error("Предложение устарело. Обновите список.");
        this.app.showModal(qv.planModal(plan));
        return true;
      }
      case "plan-apply":
        await this.applyPlans([data.id]);
        return true;
      case "plans-apply-all": {
        const document = this.app.documents.active;
        const ids = (this.plansFor(document)?.data?.plans ?? []).map((plan) => plan.id);
        if (ids.length) await this.applyPlans(ids);
        return true;
      }
      case "decompose-open":
        await this.openDecompose(data.module);
        return true;
      case "extract-method":
        this.openExtract();
        return true;
      case "verify":
        await this.verify();
        return true;
      case "verify-tab":
        this.tab = data.tab;
        this.renderPanel();
        return true;
      case "case-add":
        this.setCases([
          ...this.cases,
          { id: uid(), name: `Вход ${this.cases.length + 1}`, input: "", enabled: true, category: "manual" },
        ]);
        this.tab = "inputs";
        requestAnimationFrame(() => $$(".q-case-input", this.app.root).at(-1)?.focus());
        return true;
      case "case-delete":
        this.setCases(this.cases.filter((item) => item.id !== data.id));
        return true;
      case "case-from-run": {
        const input = this.app.runConfig.input ?? "";
        this.setCases([
          ...this.cases,
          { id: uid(), name: `Из запуска ${this.cases.length + 1}`, input, enabled: true, category: "run" },
        ]);
        this.app.notify(input ? "Вход из параметров запуска добавлен" : "Добавлен пустой stdin. Задайте ввод в «Параметрах запуска».");
        return true;
      }
      case "cases-generate-open":
        this.app.showModal(qv.generatorModal());
        return true;
      case "cases-export":
        download(
          TESTS_FILE,
          JSON.stringify(
            {
              mainClass: this.app.runConfig.mainClass || undefined,
              cases: this.cases.map(({ name, input, enabled }) => ({ name, input, enabled })),
            },
            null,
            2,
          ),
          "application/json",
        );
        return true;
      case "baseline-set-current":
        await this.captureBaseline("Зафиксировано вручную");
        return true;
      case "baseline-diff":
        if (!this.baseline) throw new Error("Исходная версия ещё не зафиксирован");
        this.app.showModal(qv.baselineDiffModal(this.baselineChanges(await this.collect())));
        return true;
      case "export-evidence":
        await this.exportEvidence();
        return true;
      case "lab-mutation":
        await this.mutation();
        return true;
      case "reduce-failure": {
        const test = this.report?.tests[Number(data.index)];
        if (test) await this.reduce(test.input);
        return true;
      }
      case "rollback-change":
        await this.rollback();
        return true;
      case "job-cancel":
        if (this.job?.id) await this.client.cancelJob(this.job.id);
        return true;
    }
    return false;
  }

  async submit(form) {
    const data = new FormData(form);
    switch (form.id) {
      case "generator-form":
        await this.generate(form);
        return true;
      case "benchmark-form":
        await this.benchmark(form);
        return true;
      case "reducer-form":
        await this.reduce(String(data.get("input")));
        return true;
      case "decompose-form": {
        const context = this.app.modalContext;
        if (context?.kind !== "decompose") return true;
        const methodIds = data.getAll("method").map(String);
        if (!methodIds.length) throw new Error("Отметьте хотя бы один метод");
        await this.decompose({
          fileName: context.fileName,
          methodIds,
          className: String(data.get("className")).trim(),
          errorTarget: "#decompose-error",
        });
        return true;
      }
      case "extract-form": {
        const context = this.app.modalContext;
        if (context?.kind !== "extract") return true;
        await this.decompose({
          fileName: context.fileName,
          methodIds: [context.methodId],
          className: String(data.get("className")).trim(),
          errorTarget: "#extract-error",
        });
        return true;
      }
    }
    return false;
  }

  bind(root, signal) {
    root.addEventListener(
      "change",
      (event) => {
        const target = event.target;
        if (target.matches?.(".q-case-enabled"))
          this.updateCase(target.dataset.id, { enabled: target.checked });
      },
      { signal },
    );
    root.addEventListener(
      "input",
      (event) => {
        const target = event.target;
        if (target.matches?.(".q-case-name")) this.updateCase(target.dataset.id, { name: target.value });
        if (target.matches?.(".q-case-input")) this.updateCase(target.dataset.id, { input: target.value });
      },
      { signal },
    );
  }
}

