"use strict";
const { ensure, text, integer } = require("./contracts.cjs");

function findMatches(content, needle, options = {}) {
  const haystack = options.caseSensitive
    ? content
    : content.toLocaleLowerCase();
  const query = options.caseSensitive ? needle : needle.toLocaleLowerCase();
  if (!query) return [];
  const results = [];
  const lines = content.split("\n");
  const offsets = [0];
  for (let index = 0; index < content.length; index++)
    if (content[index] === "\n") offsets.push(index + 1);
  let cursor = 0;
  let row = 0;
  const word = (char) => !!char && /[\p{L}\p{N}_$]/u.test(char);
  while (results.length < (options.limit ?? 1000)) {
    const start = haystack.indexOf(query, cursor);
    if (start < 0) break;
    const end = start + query.length;
    cursor = Math.max(end, start + 1);
    if (options.wholeWord && (word(content[start - 1]) || word(content[end])))
      continue;
    while (row + 1 < offsets.length && offsets[row + 1] <= start) row++;
    results.push({
      start,
      end,
      line: row + 1,
      column: start - offsets[row] + 1,
      preview: lines[row].replace(/\r$/, "").slice(0, 320),
    });
  }
  return results;
}

class ProjectSearch {
  constructor(workspace) {
    this.workspace = workspace;
    this.sequence = 0;
  }

  cancel() {
    this.sequence++;
  }

  async search(id, request) {
    const query = text(request.query, "Поиск", 500);
    const limit = integer(request.limit, "Лимит", 1, 2000, 500);
    const snapshot = this.workspace.require(id);
    const sequence = ++this.sequence;
    const scan = await this.workspace.scan(id, { textOnly: true });
    const results = [];
    const skipped = [];
    let bytes = 0;
    let searchedFiles = 0;
    let limited = scan.limited;
    const include =
      typeof request.include === "string"
        ? request.include.trim().toLocaleLowerCase()
        : "";
    for (const file of scan.files) {
      this.workspace.current(snapshot);
      if (sequence !== this.sequence)
        return { cancelled: true, results: [], searchedFiles };
      if (results.length >= limit || bytes >= 24 * 1024 * 1024) {
        limited = true;
        break;
      }
      if (include && !file.path.toLocaleLowerCase().includes(include)) continue;
      let document;
      try {
        document = await this.workspace.read(id, file.path);
      } catch (error) {
        skipped.push({ path: file.path, reason: error.code ?? "READ" });
        continue;
      }
      bytes += document.bytes;
      searchedFiles++;
      const matches = findMatches(document.content, query, {
        caseSensitive: request.caseSensitive === true,
        wholeWord: request.wholeWord === true,
        limit: limit - results.length,
      });
      for (const match of matches)
        results.push({ ...match, path: file.path, hash: document.hash });
    }
    return {
      results,
      searchedFiles,
      bytes,
      limited,
      skipped: skipped.slice(0, 30),
      query,
    };
  }

  async previewReplace(id, request) {
    text(request.replacement, "Замена", 4000, true);
    const found = await this.search(id, { ...request, limit: 2000 });
    ensure(!found.cancelled, "CANCELLED", "Поиск отменён");
    ensure(
      !found.limited,
      "LIMIT",
      "Сузьте поиск перед заменой: результат ограничен",
    );
    const grouped = new Map();
    for (const match of found.results) {
      if (!grouped.has(match.path)) grouped.set(match.path, []);
      grouped.get(match.path).push(match);
    }
    const changes = [];
    for (const [file, matches] of grouped) {
      const document = await this.workspace.read(id, file);
      ensure(
        document.hash === matches[0].hash,
        "CONFLICT",
        "Файлы изменились во время поиска",
      );
      let content = document.content;
      for (const match of [...matches].reverse())
        content =
          content.slice(0, match.start) +
          request.replacement +
          content.slice(match.end);
      ensure(
        Buffer.byteLength(content) <= 2 * 1024 * 1024,
        "FILE_SIZE",
        `Результат замены слишком большой: ${file}`,
      );
      changes.push({
        path: file,
        expectedHash: document.hash,
        before: document.content,
        after: content,
        count: matches.length,
        bom: document.bom,
      });
    }
    return { changes, matches: found.results.length, files: changes.length };
  }
}

module.exports = { ProjectSearch, findMatches };
