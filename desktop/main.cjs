"use strict";
const {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  shell,
  session,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { Workspace } = require("./services/workspace.cjs");
const { Persistence, LocalHistory } = require("./services/persistence.cjs");
const { ProjectSearch } = require("./services/search.cjs");
const { GitReader } = require("./services/git.cjs");
const { TaskService } = require("./services/tasks.cjs");
const { ProjectInfo } = require("./services/project-info.cjs");
const { Backend, locateEngine } = require("./services/backend.cjs");
const {
  record,
  text,
  ensure,
  relative,
  publicError,
} = require("./services/contracts.cjs");

app.setName("Blueprints IDE");
app.setAppUserModelId("local.blueprints.ide");
let mainWindow;
let backend;
let tasks;
let workspace;
let persistence;
let dirty = false;
let quitting = false;
let baseUrl;
const smoke = process.argv.includes("--smoke-test");
if (smoke && process.env.BLUEPRINTS_SMOKE_PROFILE) {
  app.setPath("userData", path.resolve(process.env.BLUEPRINTS_SMOKE_PROFILE));
}

function send(channel, value) {
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send("blueprints:" + channel, value);
}

function validSender(event) {
  ensure(
    mainWindow &&
      event.sender === mainWindow.webContents &&
      event.senderFrame === mainWindow.webContents.mainFrame,
    "SENDER",
    "Недопустимый отправитель",
  );
  const url = new URL(event.senderFrame.url);
  ensure(
    url.origin === baseUrl && url.pathname === "/ide.html",
    "SENDER",
    "IPC доступен только окну IDE",
  );
}

function handle(name, callback) {
  ipcMain.handle("blueprints:" + name, async (event, input) => {
    try {
      validSender(event);
      record(input);
      return { ok: true, value: await callback(input) };
    } catch (error) {
      return { ok: false, error: publicError(error) };
    }
  });
}

async function maySwitch() {
  if (!dirty) return true;
  const answer = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    title: "Несохранённые файлы",
    message: "В редакторе есть несохранённые изменения.",
    detail:
      "Сохраните файлы через Ctrl+S или выберите «Продолжить без сохранения».",
    buttons: ["Вернуться в редактор", "Продолжить без сохранения"],
    defaultId: 0,
    cancelId: 0,
  });
  return answer.response === 1;
}

async function openFolder(root) {
  if (tasks.active)
    throw new Error("Остановите задачу перед переключением проекта");
  const project = await workspace.open(root);
  dirty = false;
  await persistence.remember(project);
  return {
    project,
    recent: await persistence.recent(),
    session: await persistence.session(root),
  };
}

function wire(engine) {
  const search = new ProjectSearch(workspace);
  const git = new GitReader(workspace);
  const info = new ProjectInfo(workspace);
  handle("boot", async () => ({
    version: app.getVersion(),
    settings: await persistence.settings(),
    recent: await persistence.recent(),
    platform: process.platform,
    runtime: { java: "21", electron: process.versions.electron },
    desktop: true,
    smoke,
  }));
  handle("choose-folder", async () => {
    if (!(await maySwitch())) return { cancelled: true };
    const answer = await dialog.showOpenDialog(mainWindow, {
      title: "Открыть папку проекта",
      properties: ["openDirectory", "dontAddToRecent"],
    });
    return answer.canceled
      ? { cancelled: true }
      : openFolder(answer.filePaths[0]);
  });
  handle("open-recent", async (request) => {
    text(request.root, "Папка");
    ensure(
      (await persistence.recent()).some((item) => item.root === request.root),
      "PROJECT",
      "Эта папка отсутствует в недавних проектах",
    );
    return (await maySwitch()) ? openFolder(request.root) : { cancelled: true };
  });
  handle("forget-recent", async (request) =>
    persistence.forget(text(request.root, "Папка")),
  );
  handle("new-project", async (request) => {
    const name = relative(text(request.name, "Имя проекта", 80));
    ensure(
      !name.includes("/"),
      "PATH",
      "Имя проекта должно быть одним именем папки",
    );
    if (!(await maySwitch())) return { cancelled: true };
    const answer = await dialog.showOpenDialog(mainWindow, {
      title: "В какой папке создать проект?",
      properties: ["openDirectory", "createDirectory"],
    });
    if (answer.canceled) return { cancelled: true };
    const target = path.join(answer.filePaths[0], name);
    await fs.mkdir(target);
    await fs.mkdir(path.join(target, "src"));
    await fs.writeFile(
      path.join(target, "src", "Main.java"),
      'public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello, Blueprints!");\n    }\n}\n',
      "utf8",
    );
    await fs.writeFile(
      path.join(target, "README.md"),
      `# ${name}\n\nОткройте src/Main.java в Blueprints IDE и нажмите «Запустить».\n`,
      "utf8",
    );
    return openFolder(target);
  });
  handle("close-project", async (request) => {
    workspace.require(request.id);
    if (!(await maySwitch())) return { cancelled: true };
    ensure(!tasks.active, "BUSY", "Остановите задачу");
    workspace.close();
    dirty = false;
    return { closed: true };
  });
  handle("list", (request) => workspace.list(request.id, request.path ?? ""));
  handle("scan", (request) => workspace.scan(request.id, { textOnly: true }));
  handle("read", (request) => workspace.read(request.id, request.path));
  handle("write", (request) => workspace.write(request.id, request));
  handle("create", (request) => workspace.create(request.id, request));
  handle("rename", (request) => workspace.rename(request.id, request));
  handle("trash", async (request) => {
    const target = await workspace.prepareTrash(request.id, request.path);
    const answer = await dialog.showMessageBox(mainWindow, {
      type: "question",
      message: `Переместить «${target.relative}» в корзину?`,
      buttons: ["Отмена", "В корзину"],
      defaultId: 0,
      cancelId: 0,
    });
    if (answer.response !== 1) return { cancelled: true };
    workspace.current(target.snapshot);
    await shell.trashItem(target.absolute);
    return { path: target.relative, trashed: true };
  });
  handle("reveal", async (request) => {
    const target = await workspace.resolve(request.path ?? "", {
      id: request.id,
      allowRoot: true,
    });
    shell.showItemInFolder(target.absolute);
    return { revealed: true };
  });
  handle("search", (request) => search.search(request.id, request));
  handle("cancel-search", () => {
    search.cancel();
    return { cancelled: true };
  });
  handle("preview-replace", (request) =>
    search.previewReplace(request.id, request),
  );
  handle("overview", (request) => info.overview(request.id));
  handle("git-status", (request) => git.status(request.id));
  handle("git-diff", (request) => git.diff(request.id, request));
  handle("git-log", (request) => git.log(request.id));
  handle("history", (request) => {
    const snapshot = workspace.require(request.id);
    return workspace.history.list(snapshot.root, relative(request.path));
  });
  handle("history-read", (request) => {
    const snapshot = workspace.require(request.id);
    return workspace.history.read(
      snapshot.root,
      relative(request.path),
      text(request.version, "Версия", 80),
    );
  });
  handle("settings", (request) =>
    request.value === undefined
      ? persistence.settings()
      : persistence.saveSettings(request.value),
  );
  handle("session", (request) => {
    const snapshot = workspace.require(request.id);
    return request.value
      ? persistence.saveSession(snapshot.root, record(request.value))
      : persistence.session(snapshot.root);
  });
  handle("task-start", (request) => tasks.start(request.id, request));
  handle("task-get", (request) =>
    tasks.get(text(request.taskId, "Задача", 80)),
  );
  handle("task-stop", (request) =>
    tasks.cancel(text(request.taskId, "Задача", 80)),
  );
  handle("dirty", (request) => {
    dirty = request.value === true;
    return { dirty };
  });
  handle("project-state", (request) => {
    const snapshot = workspace.require(request.id);
    return request.value
      ? persistence.saveProjectState(snapshot.root, record(request.value))
      : persistence.projectState(snapshot.root);
  });
  handle("open-example", async (request) => {
    const name = text(request.name, "Пример", 60);
    ensure(/^[a-z0-9-]+$/.test(name), "PATH", "Неизвестный пример");
    const source = await examplesDirectory(name);
    if (!(await maySwitch())) return { cancelled: true };
    // Examples are copied so experiments never modify the bundled originals.
    const target = path.join(app.getPath("documents"), "Blueprints IDE", name);
    try {
      await fs.access(target);
    } catch {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.cp(source, target, { recursive: true, errorOnExist: false });
    }
    return openFolder(target);
  });
}

async function examplesDirectory(name) {
  const candidates = [
    path.resolve(__dirname, "..", "..", "examples", name),
    path.resolve(__dirname, "..", "examples", name),
  ];
  for (const candidate of candidates) {
    try {
      if ((await fs.stat(candidate)).isDirectory()) return candidate;
    } catch {}
  }
  ensure(false, "MISSING", "Пример не найден в комплекте IDE");
}

function secureWindow(window) {
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    try {
      if (new URL(url).origin !== baseUrl) event.preventDefault();
    } catch {
      event.preventDefault();
    }
  });
  window.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
}

function menu() {
  const command = (name) => () => send("command", { name });
  return Menu.buildFromTemplate([
    {
      label: "Файл",
      submenu: [
        {
          label: "Открыть папку…",
          accelerator: "CmdOrCtrl+O",
          click: command("open-folder"),
        },
        {
          label: "Создать проект…",
          accelerator: "CmdOrCtrl+Shift+N",
          click: command("new-project"),
        },
        { type: "separator" },
        {
          label: "Сохранить",
          accelerator: "CmdOrCtrl+S",
          click: command("save"),
        },
        {
          label: "Сохранить всё",
          accelerator: "CmdOrCtrl+Shift+S",
          click: command("save-all"),
        },
        {
          label: "Закрыть вкладку",
          accelerator: "CmdOrCtrl+W",
          click: command("close-tab"),
        },
        { type: "separator" },
        { role: "quit", label: "Выход" },
      ],
    },
    {
      label: "Правка",
      submenu: [
        { role: "undo", label: "Отменить" },
        { role: "redo", label: "Повторить" },
        { type: "separator" },
        { role: "cut", label: "Вырезать" },
        { role: "copy", label: "Копировать" },
        { role: "paste", label: "Вставить" },
        { role: "selectAll", label: "Выделить всё" },
        { type: "separator" },
        {
          label: "Поиск в проекте",
          accelerator: "CmdOrCtrl+Shift+F",
          click: command("search"),
        },
      ],
    },
    {
      label: "Вид",
      submenu: [
        {
          label: "Палитра команд",
          accelerator: "CmdOrCtrl+Shift+P",
          click: command("palette"),
        },
        {
          label: "Быстро открыть файл",
          accelerator: "CmdOrCtrl+P",
          click: command("quick-open"),
        },
        {
          label: "Настройки",
          accelerator: "CmdOrCtrl+,",
          click: command("settings"),
        },
        { type: "separator" },
        { role: "togglefullscreen", label: "Полный экран" },
        { role: "resetZoom", label: "Масштаб 100%" },
        { role: "zoomIn", label: "Увеличить" },
        { role: "zoomOut", label: "Уменьшить" },
      ],
    },
    {
      label: "Анализ",
      submenu: [
        {
          label: "Анализ проекта",
          accelerator: "CmdOrCtrl+Shift+A",
          click: command("quality-analyse"),
        },
        {
          label: "Улучшения и декомпозиция",
          accelerator: "CmdOrCtrl+Shift+I",
          click: command("improve"),
        },
        { type: "separator" },
        {
          label: "Проверить поведение",
          accelerator: "F6",
          click: command("verify"),
        },
        {
          label: "Сделать текущую версию эталоном",
          click: command("baseline-set-current"),
        },
        { label: "Экспорт отчёта о проверке", click: command("export-evidence") },
      ],
    },
    {
      label: "Запуск",
      submenu: [
        { label: "Запустить Java", accelerator: "F5", click: command("run") },
        {
          label: "Проверить сборку",
          accelerator: "CmdOrCtrl+F9",
          click: command("compile"),
        },
        {
          label: "Остановить",
          accelerator: "Shift+F5",
          click: command("stop"),
        },
      ],
    },
    {
      label: "Помощь",
      submenu: [
        { label: "Горячие клавиши", click: command("shortcuts") },
        { label: "О программе", click: command("about") },
      ],
    },
  ]);
}

async function start() {
  const engine = await locateEngine(__dirname);
  backend = new Backend(engine);
  await backend.start();
  baseUrl = backend.url;
  const userDirectory = app.getPath("userData");
  persistence = new Persistence(userDirectory);
  workspace = new Workspace({ history: new LocalHistory(userDirectory) });
  tasks = new TaskService(workspace, {
    javaHome: engine.javaHome,
    directory: userDirectory,
    onChange: (value) => send("task-changed", value),
  });
  workspace.on("change", (value) => send("files-changed", value));
  session.defaultSession.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.on("will-download", (event, item, contents) => {
    const owner = contents ? BrowserWindow.fromWebContents(contents) : null;
    const urls = item.getURLChain();
    const allowed =
      owner === mainWindow &&
      urls.length > 0 &&
      urls.every((value) => {
        try {
          const url = new URL(value);
          return (
            url.origin === baseUrl && ["http:", "blob:"].includes(url.protocol)
          );
        } catch {
          return false;
        }
      });
    if (!allowed) {
      event.preventDefault();
      return;
    }
    const filename =
      path
        .basename(item.getFilename())
        .replace(/[<>:"|?*\u0000-\u001f]/g, "_")
        .replace(/[. ]+$/, "") || "blueprints-export";
    if (smoke) item.setSavePath(path.join(userDirectory, "smoke-export.svg"));
    else
      item.setSaveDialogOptions({
        title: "Сохранить экспорт Blueprints",
        defaultPath: path.join(app.getPath("downloads"), filename),
      });
  });
  mainWindow = new BrowserWindow({
    icon: path.join(__dirname, "assets", "blueprints.ico"),
    width: 1440,
    height: 940,
    minWidth: 960,
    minHeight: 640,
    show: !smoke,
    title: "Blueprints IDE",
    backgroundColor: "#f6f7fa",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      spellcheck: false,
    },
  });
  secureWindow(mainWindow);
  wire(engine);
  Menu.setApplicationMenu(menu());
  mainWindow.on("close", async (event) => {
    if (quitting || (!dirty && !tasks.active)) return;
    event.preventDefault();
    if (!(await maySwitch())) return;
    tasks.close();
    quitting = true;
    mainWindow.close();
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
    app.quit();
  });
  if (smoke) {
    // This is an application self-test, not a browser automation transport.
    // Renderer announces readiness through the normal boot IPC contract.
    const deadline = setTimeout(() => {
      console.error("SMOKE TIMEOUT");
      backend.stop();
      app.exit(2);
    }, 20000);
    ipcMain.handle("blueprints:smoke-ready", async (event, value) => {
      validSender(event);
      clearTimeout(deadline);
      let exportVerified = false;
      let exportError = null;
      try {
        exportVerified = await new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error("Export did not complete")),
            7000,
          );
          session.defaultSession.once("will-download", (_event, item) => {
            item.once("done", async (_done, state) => {
              clearTimeout(timer);
              try {
                const content = await fs.readFile(
                  path.join(userDirectory, "smoke-export.svg"),
                  "utf8",
                );
                resolve(state === "completed" && content.includes("<svg"));
              } catch (error) {
                reject(error);
              }
            });
          });
          mainWindow.webContents.downloadURL(baseUrl + "/ide/mark.svg");
        });
      } catch (error) {
        exportError = error.message;
      }
      const report = {
        passed: value?.ready === true && exportVerified,
        exportVerified,
        exportError,
        version: app.getVersion(),
        runtime: process.versions,
        backend: backend.url,
      };
      if (process.env.BLUEPRINTS_SMOKE_REPORT)
        await fs.writeFile(
          process.env.BLUEPRINTS_SMOKE_REPORT,
          JSON.stringify(report, null, 2),
          "utf8",
        );
      console.log("BLUEPRINTS_SMOKE " + JSON.stringify(report));
      tasks.close();
      workspace.close();
      backend.stop();
      app.exit(report.passed ? 0 : 3);
      return { ok: true };
    });
  }
  await mainWindow.loadURL(baseUrl + "/ide.html");
}

app
  .whenReady()
  .then(start)
  .catch((error) => {
    if (smoke) console.error(error.stack ?? error.message);
    else
      dialog.showErrorBox(
        "Blueprints IDE не запустилась",
        String(error.message ?? error),
      );
    backend?.stop();
    app.exit(1);
  });
app.on("before-quit", () => {
  tasks?.close();
  workspace?.close();
  backend?.stop();
});
app.on("window-all-closed", () => app.quit());
process.on("uncaughtException", (error) => {
  console.error(error.stack);
  backend?.stop();
  app.exit(1);
});
