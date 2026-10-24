import { offsetAt, lineOffsets, positionAt, clamp } from "./core.mjs";

function edit(
  source,
  start,
  end,
  replacement,
  selectionStart,
  selectionEnd = selectionStart,
) {
  return {
    content: source.slice(0, start) + replacement + source.slice(end),
    selection: { start: selectionStart, end: selectionEnd, direction: "none" },
  };
}

export function indentSelection(source, selection, size = 4, outdent = false) {
  const offsets = lineOffsets(source);
  const first = positionAt(source, selection.start, offsets).line - 1;
  let last = positionAt(source, selection.end, offsets).line - 1;
  if (selection.end > selection.start && offsets[last] === selection.end)
    last--;
  if (selection.start === selection.end && !outdent) {
    const column = positionAt(source, selection.start, offsets).column - 1;
    const spaces = " ".repeat(size - (column % size));
    return edit(
      source,
      selection.start,
      selection.end,
      spaces,
      selection.start + spaces.length,
    );
  }
  const start = offsets[first];
  const end = last + 1 < offsets.length ? offsets[last + 1] : source.length;
  const lines = source.slice(start, end).split("\n");
  let startDelta = 0;
  let totalDelta = 0;
  const updated = lines
    .map((line, index) => {
      if (index === lines.length - 1 && !line && end < source.length)
        return line;
      let delta;
      let result;
      if (outdent) {
        const removed = line.startsWith("\t")
          ? 1
          : Math.min(size, line.match(/^ */)[0].length);
        delta = -removed;
        result = line.slice(removed);
      } else {
        delta = size;
        result = " ".repeat(size) + line;
      }
      if (index === 0) startDelta = delta;
      totalDelta += delta;
      return result;
    })
    .join("\n");
  return edit(
    source,
    start,
    end,
    updated,
    Math.max(start, selection.start + startDelta),
    Math.max(start, selection.end + totalDelta),
  );
}

export function insertNewline(source, selection, size = 4, eol = "LF") {
  const lineStart = source.lastIndexOf("\n", selection.start - 1) + 1;
  const before = source.slice(lineStart, selection.start);
  const indentation = before.match(/^[\t ]*/)?.[0] ?? "";
  const after = source.slice(selection.end);
  const opens = /[{[(]\s*$/.test(before);
  const closes = /^\s*[}\])]/.test(after);
  const newline = eol === "CRLF" ? "\r\n" : "\n";
  const extra = opens ? " ".repeat(size) : "";
  const replacement =
    newline +
    indentation +
    extra +
    (opens && closes ? newline + indentation : "");
  return edit(
    source,
    selection.start,
    selection.end,
    replacement,
    selection.start + newline.length + indentation.length + extra.length,
  );
}

export function toggleComment(source, selection) {
  const offsets = lineOffsets(source);
  const first = positionAt(source, selection.start, offsets).line - 1;
  let last = positionAt(source, selection.end, offsets).line - 1;
  if (selection.end > selection.start && offsets[last] === selection.end)
    last--;
  const start = offsets[first];
  const end = last + 1 < offsets.length ? offsets[last + 1] : source.length;
  const block = source.slice(start, end);
  const lines = block.split("\n");
  const substantive = lines.filter((line) => line.trim());
  const remove =
    substantive.length > 0 &&
    substantive.every((line) => /^\s*\/\//.test(line));
  const changed = lines
    .map((line, index) => {
      if (!line.trim()) return line;
      if (remove) return line.replace(/^(\s*)\/\/ ?/, "$1");
      return line.replace(/^(\s*)/, "$1// ");
    })
    .join("\n");
  return edit(source, start, end, changed, start, start + changed.length);
}

export function duplicateLine(source, selection) {
  if (selection.start !== selection.end) {
    const selected = source.slice(selection.start, selection.end);
    return edit(
      source,
      selection.end,
      selection.end,
      selected,
      selection.end,
      selection.end + selected.length,
    );
  }
  const start = source.lastIndexOf("\n", selection.start - 1) + 1;
  const found = source.indexOf("\n", selection.start);
  const end = found < 0 ? source.length : found + 1;
  const line = source.slice(start, end);
  const copy = found < 0 ? "\n" + line : line;
  return edit(source, end, end, copy, selection.start + copy.length);
}

export function moveLines(source, selection, direction) {
  const lines = source.split("\n");
  const offsets = lineOffsets(source);
  const first = positionAt(source, selection.start, offsets).line - 1;
  const last = positionAt(source, selection.end, offsets).line - 1;
  if (
    (direction < 0 && first === 0) ||
    (direction > 0 && last === lines.length - 1)
  )
    return { content: source, selection };
  const segment = lines.splice(first, last - first + 1);
  const target = first + direction;
  lines.splice(target, 0, ...segment);
  const content = lines.join("\n");
  const movedOffsets = lineOffsets(content);
  const delta = movedOffsets[target] - offsets[first];
  return {
    content,
    selection: {
      start: selection.start + delta,
      end: selection.end + delta,
      direction: selection.direction ?? "none",
    },
  };
}

export function wrapPair(source, selection, opening) {
  const closing = { "(": ")", "[": "]", "{": "}", '"': '"', "'": "'" }[opening];
  if (!closing) return null;
  const selected = source.slice(selection.start, selection.end);
  return edit(
    source,
    selection.start,
    selection.end,
    opening + selected + closing,
    selection.start + 1,
    selection.end + 1,
  );
}

export function findInDocument(content, query, options = {}) {
  if (!query) return [];
  const haystack = options.caseSensitive
    ? content
    : content.toLocaleLowerCase();
  const needle = options.caseSensitive ? query : query.toLocaleLowerCase();
  const matches = [];
  let cursor = 0;
  while (cursor <= haystack.length && matches.length < 5000) {
    const start = haystack.indexOf(needle, cursor);
    if (start < 0) break;
    const end = start + needle.length;
    cursor = end;
    if (
      options.wholeWord &&
      (/[\p{L}\p{N}_$]/u.test(content[start - 1] ?? " ") ||
        /[\p{L}\p{N}_$]/u.test(content[end] ?? " "))
    )
      continue;
    matches.push({ start, end, ...positionAt(content, start) });
  }
  return matches;
}

export function wordAt(content, offset) {
  let start = clamp(offset, 0, content.length);
  let end = start;
  while (start > 0 && /[\p{L}\p{N}_$]/u.test(content[start - 1])) start--;
  while (end < content.length && /[\p{L}\p{N}_$]/u.test(content[end])) end++;
  return { start, end, text: content.slice(start, end) };
}

export function trimTrailingWhitespace(content) {
  return content.replace(/[\t ]+(?=\r?$)/gm, "");
}

export function sortSelectedLines(source, selection) {
  const first = source.lastIndexOf("\n", selection.start - 1) + 1;
  const found = source.indexOf("\n", selection.end);
  const last = found < 0 ? source.length : found;
  const changed = source
    .slice(first, last)
    .split("\n")
    .sort((a, b) => a.localeCompare(b))
    .join("\n");
  return edit(source, first, last, changed, first, first + changed.length);
}
