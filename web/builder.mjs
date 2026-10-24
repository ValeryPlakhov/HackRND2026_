import {
  BlueprintStore,
  emptyProject,
  assertStructure,
  locate,
} from "./builder/model.mjs";
import { compileBlueprint } from "./builder/compiler.mjs";
import { simulate, inputText } from "./builder/runtime.mjs";
import {
  TEMPLATES,
  templateById,
  templateAnswers,
} from "./builder/templates.mjs";
import {
  renderApp,
  inspector,
  readInspector,
  runPanel,
} from "./builder/view.mjs";
import { StudioClient } from "./lib/client.mjs";
import { downloadFile, clone } from "./lib/core.mjs";
import { zipBytes } from "./lib/export.mjs";

const STORAGE = "blueprints-visual-project-v1";
const $ = (selector) => document.querySelector(selector);

class VisualBuilder {
  constructor() {
    this.root = $("#visual-builder");
    this.client = new StudioClient();
    this.store = new BlueprintStore(this.restore());
    this.ui = {
      selectedId: null,
      draft: null,
      runOpen: false,
      modal: null,
      answers: {
        ...templateAnswers(this.store.project),
        ...this.store.project.inputs,
      },
      run: { status: "idle" },
      tracedNode: null,
      generatedSource: "",
      saveStatus: "Сохранено на этом компьютере",
      dismissedTip: false,
    };
    this.insertion = null;
    this.jobId = null;
    this.runToken = 0;
    this.cancelledIds = new Set();
    this.toastTimer = null;
    this.bind();
    this.render();
    this.save();
    this.client.connect();
  }

  restore() {
    try {
      const saved = localStorage.getItem(STORAGE);
      if (saved && saved.length <= 150000)
        return assertStructure(JSON.parse(saved));
    } catch {
      /* A damaged save never prevents opening the constructor. */
    }
    return TEMPLATES[0].create();
  }

  save() {
    try {
      localStorage.setItem(STORAGE, JSON.stringify(this.store.project));
      this.ui.saveStatus = "Сохранено на этом компьютере";
    } catch {
      this.ui.saveStatus = "Не удалось сохранить. Скачайте проект";
    }
    const status = $("#save-status");
    if (status) {
      const last = status.lastChild;
      if (last?.nodeType === Node.TEXT_NODE)
        last.textContent = this.ui.saveStatus;
    }
  }

  render() {
    const scroll = $("#blueprint-canvas")?.scrollTop ?? 0;
    this.root.innerHTML = renderApp(this.store.project, this.ui, this.store);
    $("#blueprint-canvas").scrollTop = scroll;
    if (this.ui.modal) $("#builder-modal").showModal();
  }

  renderInspector() {
    const current = $(".b-inspector");
    if (current) current.outerHTML = inspector(this.store.project, this.ui);
  }

  renderRun() {
    const current = $(".b-run-panel");
    if (current) current.outerHTML = runPanel(this.store.project, this.ui);
  }

  toast(message) {
    clearTimeout(this.toastTimer);
    const target = $("#builder-toast");
    if (!target) return;
    target.textContent = message;
    target.classList.add("visible");
    this.toastTimer = setTimeout(
      () => target.classList.remove("visible"),
      4500,
    );
  }

  async safely(operation) {
    try {
      await operation();
    } catch (error) {
      this.toast(error.message || "Не удалось выполнить действие");
    }
  }

  cancelActive() {
    this.runToken++;
    if (this.jobId && !this.cancelledIds.has(this.jobId)) {
      const id = this.jobId;
      this.cancelledIds.add(id);
      this.client.cancelJob(id).catch(() => {});
    }
    this.jobId = null;
  }

  changed() {
    this.cancelActive();
    this.ui.run = { status: "idle" };
    this.ui.tracedNode = null;
    this.save();
  }

  commitInspector() {
    const form = $("#block-form");
    if (!form || !this.ui.selectedId) return false;
    const node =
      this.ui.draft ?? locate(this.store.project, this.ui.selectedId)?.node;
    if (!node) return false;
    const updated = readInspector(node, form);
    const changed = this.store.update(node.id, (current) => {
      current.config = updated.config;
    });
    this.ui.draft = clone(updated);
    if (changed) this.changed();
    return changed;
  }

  select(id) {
    this.commitInspector();
    const node = locate(this.store.project, id)?.node;
    if (!node) return;
    this.ui.modal = null;
    this.ui.runOpen = false;
    this.ui.selectedId = id;
    this.ui.draft = clone(node);
    this.render();
    this.scrollToNode(id);
  }

  scrollToNode(id) {
    const target = this.root.querySelector(`[data-node="${id}"]`);
    target?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "nearest",
    });
  }

  closeInspector() {
    this.commitInspector();
    this.ui.selectedId = null;
    this.ui.draft = null;
    this.render();
  }

  openModal(kind) {
    this.commitInspector();
    this.ui.modal = kind;
    this.render();
  }

  loadProject(project) {
    this.commitInspector();
    const next = clone(assertStructure(project));
    this.store.transact((current) => {
      Object.keys(current).forEach((key) => delete current[key]);
      Object.assign(current, next);
    });
    this.changed();
    Object.assign(this.ui, {
      selectedId: null,
      draft: null,
      modal: null,
      runOpen: false,
      answers: { ...templateAnswers(next), ...next.inputs },
    });
    this.render();
    $("#blueprint-canvas").scrollTop = 0;
  }

  add(type) {
    this.commitInspector();
    const target = this.insertion ?? {
      parentId: null,
      branch: "steps",
      index: this.store.project.steps.length,
    };
    if (type === "input" && target.parentId) {
      this.toast(
        "Вопрос добавляется в начало схемы. Внутри ветки выберите действие",
      );
      return;
    }
    const id = this.store.add(type, target);
    this.insertion = null;
    this.changed();
    this.ui.modal = null;
    this.ui.selectedId = id;
    this.ui.draft = clone(locate(this.store.project, id).node);
    this.ui.runOpen = false;
    this.render();
    this.scrollToNode(id);
    $("#block-form input, #block-form textarea, #block-form select")?.focus({
      preventScroll: true,
    });
  }

  remove(id) {
    const found = locate(this.store.project, id);
    if (!found) return;
    this.store.remove(id);
    this.changed();
    this.ui.selectedId = null;
    this.ui.draft = null;
    this.render();
    this.toast("Блок удалён. Кнопка «Отменить» вернёт его");
  }

  move(id, direction) {
    const found = locate(this.store.project, id);
    if (!found) return;
    const target = found.index + direction;
    if (target < 0 || target >= found.array.length) {
      this.toast(
        direction < 0
          ? "Блок уже в начале этого пути"
          : "Блок уже в конце этого пути",
      );
      return;
    }
    this.store.move(id, {
      parentId: found.parentId,
      branch: found.branch,
      index: direction > 0 ? target + 1 : target,
    });
    this.changed();
    this.render();
    this.scrollToNode(id);
  }

  openRun() {
    this.commitInspector();
    this.ui.selectedId = null;
    this.ui.draft = null;
    this.ui.runOpen = true;
    for (const node of this.store.project.steps)
      if (node.type === "input" && this.ui.answers[node.id] == null)
        this.ui.answers[node.id] = node.config.example ?? "";
    this.render();
    $('.b-run-panel input, .b-run-panel button[type="submit"]')?.focus({
      preventScroll: true,
    });
  }

  async execute(form) {
    if (this.ui.run.status === "running") return;
    const answers = {};
    for (const [key, value] of new FormData(form))
      if (key.startsWith("answer:")) answers[key.slice(7)] = String(value);
    this.ui.answers = answers;
    // Input values belong to the visual project, not to its executable instructions.
    this.store.project.inputs = clone(answers);
    this.save();
    let compiled, preview, stdin;
    try {
      compiled = compileBlueprint(this.store.project);
      preview = simulate(this.store.project, answers);
      stdin = inputText(compiled, answers);
    } catch (error) {
      this.ui.run = {
        status: "failed",
        error: error.message,
        nodeId: error.nodeId,
      };
      this.renderRun();
      return;
    }
    this.cancelActive();
    const token = this.runToken,
      revision = this.store.revision;
    if (!this.client.online || this.client.environment?.runner === "disabled") {
      this.ui.run = { status: "done", mode: "preview", ...preview };
      this.renderRun();
      return;
    }
    this.ui.run = { status: "running", stage: "Подготавливаем вашу программу" };
    this.renderRun();
    try {
      const job = await this.client.startJob(
        "run",
        { files: { "Main.java": compiled.source }, input: stdin },
        (snapshot) => {
          if (token !== this.runToken || revision !== this.store.revision) {
            if (!this.cancelledIds.has(snapshot.id)) {
              this.cancelledIds.add(snapshot.id);
              this.client.cancelJob(snapshot.id).catch(() => {});
            }
            return;
          }
          this.jobId = snapshot.id;
          this.ui.run.stage = snapshot.stage;
          this.renderRun();
        },
      );
      if (token !== this.runToken || revision !== this.store.revision) return;
      const result = job.result;
      this.jobId = null;
      if (!result.success) {
        this.ui.run = {
          status: "failed",
          error:
            result.phase === "compile"
              ? "Не удалось подготовить программу. Проверьте настройки блоков"
              : result.execution?.timedOut
                ? "Выполнение заняло слишком долго. Уменьшите количество повторений"
                : result.execution?.outputLimit
                  ? "Получилось слишком много сообщений. Уменьшите количество повторений"
                  : "Программа остановилась с ошибкой. Проверьте входные данные",
          details: result.compile?.diagnostics || result.execution?.stderr,
        };
      } else {
        this.ui.run = {
          status: "done",
          mode: "java",
          stdout: result.execution.stdout,
          trace:
            preview.stdout === result.execution.stdout.replace(/\r\n/g, "\n")
              ? preview.trace
              : [],
          truncatedTrace: preview.truncatedTrace,
          projectHash: result.projectHash,
          inputHash: result.inputHash,
        };
      }
      this.renderRun();
    } catch (error) {
      if (token !== this.runToken) return;
      this.jobId = null;
      this.ui.run = {
        status: "failed",
        error: "Связь с Java-сервером прервалась. Попробуйте запустить ещё раз",
        details: error.message,
      };
      this.renderRun();
    }
  }

  showCode() {
    this.commitInspector();
    try {
      this.ui.generatedSource = compileBlueprint(this.store.project).source;
      this.openModal("code");
    } catch {
      this.openRun();
      this.toast("Сначала заполните настройки отмеченных блоков");
    }
  }

  export() {
    this.commitInspector();
    const project = clone(this.store.project);
    const files = {
      "project.blueprint.json": JSON.stringify(project, null, 2),
    };
    try {
      files["Main.java"] = compileBlueprint(project).source;
      files["README.txt"] = [
        "Blueprints / визуальная программа",
        "",
        project.title,
        "",
        "Открыть схему: загрузите project.blueprint.json в конструкторе.",
        "Запуск Java: нужен JDK 21+.",
        "javac -encoding UTF-8 --release 21 Main.java",
        "java -Dfile.encoding=UTF-8 Main",
        "",
        "Ответы вводятся по одному на строку. Список: числа через пробел.",
        "Целые числа используют Java int. Деление отбрасывает дробную часть.",
        "Схема и Java созданы локально; внешние сервисы не нужны.",
      ].join("\n");
      files["run.cmd"] =
        '@echo off\r\ncd /d "%~dp0"\r\njavac -encoding UTF-8 --release 21 Main.java\r\nif errorlevel 1 goto finish\r\njava -Dfile.encoding=UTF-8 Main\r\n:finish\r\npause\r\n';
      if (this.ui.run.status === "done")
        files["last-result.json"] = JSON.stringify(
          { ...this.ui.run, answers: this.ui.answers },
          null,
          2,
        );
    } catch {
      files["README.txt"] =
        "В этой схеме есть незаполненные блоки. Откройте project.blueprint.json в конструкторе и закончите настройки, чтобы получить Java.";
    }
    downloadFile("blueprints-project.zip", zipBytes(files), "application/zip");
    this.ui.modal = null;
    this.render();
    this.toast("Проект скачан: схема и готовая Java, если все блоки настроены");
  }

  async import(file) {
    if (!file) return;
    if (file.size > 150000)
      throw new Error("Схема слишком большая: максимум 150 КБ");
    let project;
    try {
      project = JSON.parse(await file.text());
    } catch {
      throw new Error(
        "Не удалось прочитать файл. Выберите project.blueprint.json",
      );
    }
    this.loadProject(assertStructure(project));
    this.toast("Схема открыта. Можно продолжить работу");
  }

  async action(name, element) {
    if (!["select", "close-inspector", "cancel-run"].includes(name))
      this.commitInspector();
    const id = element.dataset.id;
    switch (name) {
      case "add":
        this.add(element.dataset.type);
        break;
      case "insert":
        this.insertion = {
          parentId: element.dataset.parent || null,
          branch: element.dataset.branch,
          index: Number(element.dataset.index),
        };
        this.openModal("picker");
        break;
      case "select":
        this.select(id);
        break;
      case "close-inspector":
        this.closeInspector();
        break;
      case "delete":
        this.remove(id);
        break;
      case "duplicate": {
        const copied = this.store.duplicate(id);
        this.changed();
        this.select(copied);
        break;
      }
      case "move-up":
        this.move(id, -1);
        break;
      case "move-down":
        this.move(id, 1);
        break;
      case "undo":
      case "redo":
        if (this.store[name]()) {
          this.changed();
          this.ui.selectedId = null;
          this.ui.draft = null;
          this.render();
        }
        break;
      case "examples":
        this.insertion = null;
        this.openModal("templates");
        break;
      case "template":
        this.loadProject(templateById(element.dataset.template).create());
        this.toast("Пример открыт. Нажмите на любой блок, чтобы изменить его");
        break;
      case "blank":
        this.loadProject(emptyProject("Новая программа"));
        break;
      case "close-modal":
        this.ui.modal = null;
        this.insertion = null;
        this.render();
        break;
      case "help":
        this.openModal("help");
        break;
      case "open-run":
        this.openRun();
        break;
      case "close-run":
        this.ui.runOpen = false;
        this.render();
        break;
      case "cancel-run":
        this.cancelActive();
        this.ui.run = { status: "idle" };
        this.renderRun();
        this.toast("Запуск отменён");
        break;
      case "fix":
        if (id) this.select(id);
        else {
          this.ui.runOpen = false;
          this.openModal("picker");
        }
        break;
      case "trace": {
        const step = this.ui.run.trace?.[Number(element.dataset.index)];
        if (!step) break;
        this.ui.tracedNode = step.nodeId;
        this.root
          .querySelectorAll(".b-node.traced")
          .forEach((node) => node.classList.remove("traced"));
        this.root
          .querySelector(`[data-node="${step.nodeId}"]`)
          ?.classList.add("traced");
        this.scrollToNode(step.nodeId);
        break;
      }
      case "show-code":
        this.showCode();
        break;
      case "download-java":
        downloadFile(
          "Main.java",
          compileBlueprint(this.store.project).source,
          "text/plain;charset=utf-8",
        );
        break;
      case "export":
        this.export();
        break;
      case "import":
        $("#blueprint-file").click();
        break;
      case "dismiss-tip":
        this.ui.dismissedTip = true;
        this.render();
        break;
    }
  }

  bind() {
    this.root.addEventListener("input", (event) => {
      if (event.target.id === "project-title") {
        this.safely(() => {
          this.store.transact((project) => {
            project.title = event.target.value.slice(0, 100);
          });
          this.changed();
          this.renderRun();
        });
        return;
      }
      const form = event.target.closest("#run-form");
      if (!form) return;
      for (const [key, value] of new FormData(form))
        if (key.startsWith("answer:"))
          this.ui.answers[key.slice(7)] = String(value);
      if (["done", "failed"].includes(this.ui.run.status)) {
        this.ui.run = { status: "idle" };
        this.ui.tracedNode = null;
        this.root
          .querySelectorAll(".b-result, .b-run-error")
          .forEach((element) => element.remove());
        this.root
          .querySelectorAll(".b-node.traced")
          .forEach((element) => element.classList.remove("traced"));
      }
    });
    this.root.addEventListener("click", (event) => {
      const target = event.target.closest("[data-action]");
      if (target && !target.disabled)
        this.safely(() => this.action(target.dataset.action, target));
    });
    this.root.addEventListener("submit", (event) => {
      event.preventDefault();
      if (event.target.id === "block-form")
        this.safely(() => this.closeInspector());
      if (event.target.id === "run-form")
        this.safely(() => this.execute(event.target));
    });
    this.root.addEventListener("change", (event) => {
      if (event.target.id === "blueprint-file")
        this.safely(() => this.import(event.target.files[0]));
      if (event.target.id === "project-title")
        this.safely(() => {
          this.commitInspector();
          this.store.transact((project) => {
            project.title = event.target.value.trim() || "Моя программа";
          });
          this.changed();
          this.render();
        });
      const form = event.target.closest("#block-form");
      if (form && event.target.tagName === "SELECT") {
        this.ui.draft = readInspector(this.ui.draft, form);
        this.renderInspector();
      }
    });
    this.root.addEventListener(
      "cancel",
      (event) => {
        if (event.target.id === "builder-modal") {
          event.preventDefault();
          this.ui.modal = null;
          this.insertion = null;
          this.render();
        }
      },
      true,
    );
    this.root.addEventListener("dragstart", (event) => {
      const target = event.target.closest("[data-drag-type], [data-drag-node]");
      if (!target) return;
      this.commitInspector();
      event.dataTransfer.setData(
        "application/x-blueprint",
        JSON.stringify(
          target.dataset.dragType
            ? { type: target.dataset.dragType }
            : { id: target.dataset.dragNode },
        ),
      );
      event.dataTransfer.effectAllowed = target.dataset.dragType
        ? "copy"
        : "move";
      this.root.classList.add("is-dragging");
    });
    this.root.addEventListener("dragover", (event) => {
      if (!event.dataTransfer.types.includes("application/x-blueprint")) return;
      const target = event.target.closest("[data-drop-slot]");
      if (target) {
        event.preventDefault();
        target.classList.add("drop-active");
      }
    });
    this.root.addEventListener("dragleave", (event) =>
      event.target.closest("[data-drop-slot]")?.classList.remove("drop-active"),
    );
    this.root.addEventListener("dragend", () =>
      this.root.classList.remove("is-dragging"),
    );
    this.root.addEventListener("drop", (event) => {
      const target = event.target.closest("[data-drop-slot]");
      if (!target) return;
      const raw = event.dataTransfer.getData("application/x-blueprint");
      if (!raw) return;
      event.preventDefault();
      this.root.classList.remove("is-dragging");
      this.safely(() => {
        const data = JSON.parse(raw),
          destination = {
            parentId: target.dataset.parent || null,
            branch: target.dataset.branch,
            index: Number(target.dataset.index),
          };
        if (data.type) {
          this.insertion = destination;
          this.add(data.type);
        } else if (data.id) {
          this.store.move(data.id, destination);
          this.changed();
          this.render();
          this.scrollToNode(data.id);
        }
      });
    });
    window.addEventListener("keydown", (event) => {
      const typing = event.target.closest(
        'input, textarea, select, [contenteditable="true"]',
      );
      if (
        !typing &&
        !this.ui.modal &&
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "z"
      ) {
        event.preventDefault();
        this.safely(() =>
          this.action(event.shiftKey ? "redo" : "undo", { dataset: {} }),
        );
      }
      if (event.key === "Escape" && !this.ui.modal) {
        if (this.ui.selectedId) this.closeInspector();
        else if (this.ui.runOpen) {
          this.ui.runOpen = false;
          this.render();
        }
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        this.openRun();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        this.export();
      }
    });
    window.addEventListener("beforeunload", () => {
      this.commitInspector();
      this.save();
    });
  }
}

new VisualBuilder();
