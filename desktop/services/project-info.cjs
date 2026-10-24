"use strict";
const path = require("node:path");
const { discoverMain } = require("./tasks.cjs");

function summarizeJava(source) {
  const packageName = source.match(/^\s*package\s+([\w.]+)\s*;/m)?.[1] ?? "";
  const imports = [
    ...source.matchAll(/^\s*import\s+(?:static\s+)?([\w.*]+)\s*;/gm),
  ].map((match) => match[1]);
  const types = [
    ...source.matchAll(
      /\b(class|interface|enum|record)\s+([\p{L}_$][\p{L}\p{N}_$]*)/gu,
    ),
  ].map((match) => ({ kind: match[1], name: match[2], offset: match.index }));
  return {
    packageName,
    imports,
    types,
    mainClass: discoverMain(source),
    lines: source.split("\n").length,
  };
}

class ProjectInfo {
  constructor(workspace) {
    this.workspace = workspace;
  }

  async overview(id) {
    const snapshot = this.workspace.require(id);
    const scan = await this.workspace.scan(id, { textOnly: true });
    const java = scan.files.filter((item) => item.language === "java");
    const packages = new Map();
    const entries = [];
    const types = [];
    const failures = [];
    let lines = 0;
    let indexed = 0;
    let bytes = 0;
    for (const file of java.slice(0, 300)) {
      this.workspace.current(snapshot);
      try {
        const document = await this.workspace.read(id, file.path);
        bytes += document.bytes;
        if (bytes > 8 * 1024 * 1024) break;
        const summary = summarizeJava(document.content);
        indexed++;
        lines += summary.lines;
        const key = summary.packageName || "(default)";
        packages.set(key, (packages.get(key) ?? 0) + 1);
        if (summary.mainClass)
          entries.push({ path: file.path, className: summary.mainClass });
        for (const type of summary.types)
          types.push({
            ...type,
            path: file.path,
            packageName: summary.packageName,
          });
      } catch (error) {
        failures.push({ path: file.path, reason: error.message });
      }
    }
    const configs = scan.files.filter((item) =>
      /(?:^|\/)(pom\.xml|build\.gradle(?:\.kts)?|settings\.gradle(?:\.kts)?|module-info\.java|README\.md|\.editorconfig)$/.test(
        item.path,
      ),
    );
    return {
      files: scan.files.length,
      javaFiles: java.length,
      indexed,
      lines,
      packages: [...packages]
        .map(([name, files]) => ({ name, files }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      entryPoints: entries,
      types: types.slice(0, 1500),
      configs,
      failures: failures.slice(0, 30),
      limited: scan.limited || indexed < java.length,
      indexing: "lexical-summary",
      omitted: scan.omitted,
    };
  }
}

module.exports = { ProjectInfo, summarizeJava };
