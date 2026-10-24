"use strict";
const { execFile } = require("node:child_process");
const { ensure, relative } = require("./contracts.cjs");

function executeGit(root, argumentsList) {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["--no-pager", "-C", root, ...argumentsList],
      {
        windowsHide: true,
        shell: false,
        encoding: "utf8",
        timeout: 7000,
        maxBuffer: 2 * 1024 * 1024,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
          GIT_OPTIONAL_LOCKS: "0",
          GIT_PAGER: "",
          GIT_CONFIG_NOSYSTEM: "1",
        },
      },
      (error, stdout, stderr) =>
        resolve({
          ok: !error,
          output: stdout ?? "",
          error: error
            ? error.code === "ENOENT"
              ? "Git не установлен. Остальные функции IDE доступны."
              : String(stderr || error.message).slice(0, 2000)
            : null,
        }),
    );
  });
}

function parseStatus(output) {
  const parts = output.split("\0");
  const entries = [];
  for (let index = 0; index < parts.length; index++) {
    const item = parts[index];
    if (item.length < 4) continue;
    const code = item.slice(0, 2);
    const file = item.slice(3);
    let from = null;
    if (/[RC]/.test(code)) from = parts[++index] ?? null;
    entries.push({
      path: file.replaceAll("\\", "/"),
      code,
      index: code[0],
      working: code[1],
      from,
      untracked: code === "??",
      conflict: ["DD", "AU", "UD", "UA", "DU", "AA", "UU"].includes(code),
    });
  }
  return entries;
}

class GitReader {
  constructor(workspace) {
    this.workspace = workspace;
  }

  async status(id) {
    const snapshot = this.workspace.require(id);
    const state = await executeGit(snapshot.root, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=normal",
    ]);
    this.workspace.current(snapshot);
    if (!state.ok) return { available: false, error: state.error, entries: [] };
    const branch = await executeGit(snapshot.root, [
      "branch",
      "--show-current",
    ]);
    const head = await executeGit(snapshot.root, [
      "rev-parse",
      "--short",
      "HEAD",
    ]);
    const entries = parseStatus(state.output);
    return {
      available: true,
      branch: branch.output.trim() || "detached HEAD",
      head: head.ok ? head.output.trim() : null,
      entries,
      counts: {
        staged: entries.filter((item) => ![" ", "?"].includes(item.index))
          .length,
        changed: entries.filter((item) => ![" ", "?"].includes(item.working))
          .length,
        untracked: entries.filter((item) => item.untracked).length,
        conflicts: entries.filter((item) => item.conflict).length,
      },
    };
  }

  async diff(id, request) {
    const target = await this.workspace.resolve(relative(request.path), {
      id,
      missing: true,
    });
    const argumentsList = [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--unified=4",
    ];
    if (request.staged === true) argumentsList.push("--cached");
    argumentsList.push("--", target.relative);
    const result = await executeGit(target.snapshot.root, argumentsList);
    this.workspace.current(target.snapshot);
    ensure(result.ok, "GIT", result.error ?? "Не удалось прочитать diff");
    return {
      path: target.relative,
      diff: result.output,
      staged: request.staged === true,
    };
  }

  async log(id) {
    const snapshot = this.workspace.require(id);
    const result = await executeGit(snapshot.root, [
      "log",
      "-20",
      "--format=%h%x00%s%x00%an%x00%aI%x00",
    ]);
    this.workspace.current(snapshot);
    if (!result.ok) return { entries: [], error: result.error };
    const parts = result.output.split("\0");
    const entries = [];
    for (let index = 0; index + 3 < parts.length; index += 4)
      entries.push({
        hash: parts[index].trim(),
        subject: parts[index + 1],
        author: parts[index + 2],
        time: parts[index + 3],
      });
    return { entries };
  }
}

module.exports = { GitReader, parseStatus, executeGit };
