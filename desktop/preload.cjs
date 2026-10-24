"use strict";
const { contextBridge, ipcRenderer } = require("electron");

const invoke = (name, request = {}) =>
  ipcRenderer.invoke("blueprints:" + name, request);
const subscribe = (channel) => (callback) => {
  if (typeof callback !== "function") throw new TypeError("Callback required");
  const listener = (_event, value) => callback(value);
  ipcRenderer.on("blueprints:" + channel, listener);
  return () => ipcRenderer.removeListener("blueprints:" + channel, listener);
};

contextBridge.exposeInMainWorld(
  "blueprintsDesktop",
  Object.freeze({
    version: "4.2.0",
    smokeReady: (value) => invoke("smoke-ready", value),
    boot: () => invoke("boot"),
    chooseFolder: () => invoke("choose-folder"),
    openRecent: (root) => invoke("open-recent", { root }),
    forgetRecent: (root) => invoke("forget-recent", { root }),
    newProject: (request) => invoke("new-project", request),
    closeProject: (id) => invoke("close-project", { id }),
    list: (id, path) => invoke("list", { id, path }),
    scan: (id) => invoke("scan", { id }),
    read: (id, path) => invoke("read", { id, path }),
    write: (id, request) => invoke("write", { id, ...request }),
    create: (id, request) => invoke("create", { id, ...request }),
    rename: (id, request) => invoke("rename", { id, ...request }),
    trash: (id, path) => invoke("trash", { id, path }),
    reveal: (id, path) => invoke("reveal", { id, path }),
    search: (id, request) => invoke("search", { id, ...request }),
    cancelSearch: () => invoke("cancel-search"),
    previewReplace: (id, request) =>
      invoke("preview-replace", { id, ...request }),
    overview: (id) => invoke("overview", { id }),
    gitStatus: (id) => invoke("git-status", { id }),
    gitDiff: (id, request) => invoke("git-diff", { id, ...request }),
    gitLog: (id) => invoke("git-log", { id }),
    history: (id, path) => invoke("history", { id, path }),
    historyRead: (id, path, version) =>
      invoke("history-read", { id, path, version }),
    settings: (value) => invoke("settings", { value }),
    session: (id, value) => invoke("session", { id, value }),
    startTask: (id, request) => invoke("task-start", { id, ...request }),
    task: (id) => invoke("task-get", { taskId: id }),
    stopTask: (id) => invoke("task-stop", { taskId: id }),
    dirty: (value) => invoke("dirty", { value: value === true }),
    projectState: (id, value) => invoke("project-state", { id, value }),
    openExample: (name) => invoke("open-example", { name }),
    onFilesChanged: subscribe("files-changed"),
    onTaskChanged: subscribe("task-changed"),
    onCommand: subscribe("command"),
  }),
);
