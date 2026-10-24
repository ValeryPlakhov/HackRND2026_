import { escapeHtml as e } from "../lib/core.mjs";
import { highlight, indentationAt, lineAt } from "../lib/lexer.mjs";
import { hunks } from "../lib/diff.mjs";
import { icon } from "../lib/icons.mjs";

export function sourceEditor(
  source,
  { fileName = "", readonly = false, diagnostics = [], compact = false } = {},
) {
  const errors = new Set(
    diagnostics
      .filter((item) => item.severity === "ERROR")
      .map((item) => item.line),
  );
  const lines = source.split("\n");
  return `<section class="source-editor ${compact ? "compact" : ""}"><div class="source-editor-header"><span>${icon("file", "", 14)}${e(fileName)}</span><div>${readonly ? '<span class="editor-readonly">Демо / read only</span>' : '<span class="editor-live-dot"></span><span>Java 21</span>'}<button class="icon-button" data-action="copy-source" aria-label="Скопировать исходник">${icon("copy", "", 14)}</button></div></div><div class="source-editor-body"><div id="source-gutter" class="source-gutter" aria-hidden="true">${lines.map((_, index) => `<span class="${errors.has(index + 1) ? "gutter-error" : ""}">${index + 1}</span>`).join("")}</div><div class="source-code-stack"><pre id="source-highlight" class="source-highlight" aria-hidden="true"><code>${highlight(source)}\n</code></pre><textarea id="source-input" spellcheck="false" wrap="off" aria-label="Исходный код Java" ${readonly ? "readonly" : ""}>${e(source)}</textarea></div></div><div class="source-editor-footer"><span id="cursor-position">Ln 1, Col 1</span><span>UTF-8 <b>·</b> 4 spaces <b>·</b> ${lines.length} lines</span></div></section>`;
}

export function bindSourceEditor(
  container,
  { onChange, onSave, onSelection } = {},
) {
  const input = container.querySelector("#source-input");
  const display = container.querySelector("#source-highlight");
  const gutter = container.querySelector("#source-gutter");
  if (!input || !display) return () => {};
  const controller = new AbortController();
  const options = { signal: controller.signal };
  const syncScroll = () => {
    display.scrollTop = input.scrollTop;
    display.scrollLeft = input.scrollLeft;
    gutter.scrollTop = input.scrollTop;
  };
  const selection = () => {
    const start = input.selectionStart;
    const before = input.value.slice(0, start);
    const line = lineAt(input.value, start);
    const column = start - before.lastIndexOf("\n");
    const position = container.querySelector("#cursor-position");
    if (position) position.textContent = `Ln ${line}, Col ${column}`;
    onSelection?.({ start, end: input.selectionEnd, line, column });
  };
  let highlightTimer;
  const refresh = () => {
    display.querySelector("code").innerHTML = highlight(input.value) + "\n";
    const count = input.value.split("\n").length;
    gutter.innerHTML = Array.from(
      { length: count },
      (_, index) => `<span>${index + 1}</span>`,
    ).join("");
    syncScroll();
  };
  input.addEventListener(
    "input",
    () => {
      onChange?.(input.value);
      clearTimeout(highlightTimer);
      highlightTimer = setTimeout(refresh, 100);
      selection();
    },
    options,
  );
  input.addEventListener("scroll", syncScroll, options);
  input.addEventListener("click", selection, options);
  input.addEventListener("keyup", selection, options);
  input.addEventListener(
    "keydown",
    (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        onSave?.();
        return;
      }
      if (input.readOnly) return;
      if (event.key === "Tab") {
        event.preventDefault();
        input.setRangeText(
          "    ",
          input.selectionStart,
          input.selectionEnd,
          "end",
        );
        input.dispatchEvent(new Event("input", { bubbles: true }));
      } else if (event.key === "Enter") {
        event.preventDefault();
        const indentation = indentationAt(input.value, input.selectionStart);
        input.setRangeText(
          "\n" + indentation,
          input.selectionStart,
          input.selectionEnd,
          "end",
        );
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    },
    options,
  );
  return () => {
    clearTimeout(highlightTimer);
    controller.abort();
  };
}

export function diffViewer(operations, { context = 4, expanded = false } = {}) {
  const groups = expanded ? [operations] : hunks(operations, context);
  if (!groups.length)
    return '<div class="diff-empty">В этом файле нет изменений.</div>';
  return `<div class="diff-viewer">${groups.map((group, index) => `<div class="diff-hunk-label">${icon("diff", "", 12)} Фрагмент ${index + 1} <span>${group[0]?.oldLine ?? "—"} → ${group[0]?.newLine ?? "—"}</span></div>${group.map((row) => `<div class="diff-row ${row.type}"><span class="diff-line-number">${row.oldLine ?? ""}</span><span class="diff-line-number">${row.newLine ?? ""}</span><span class="diff-sign">${row.type === "insert" ? "+" : row.type === "delete" ? "−" : " "}</span><code>${highlight(row.text) || " "}</code></div>`).join("")}`).join("")}</div>`;
}

export function focusSourceLine(container, source, line, endLine = line) {
  const input = container.querySelector("#source-input");
  if (!input) return false;
  const lines = source.split("\n");
  const start = lines
    .slice(0, Math.max(0, line - 1))
    .reduce((sum, text) => sum + text.length + 1, 0);
  const end =
    lines.slice(0, endLine).reduce((sum, text) => sum + text.length + 1, 0) - 1;
  input.focus({ preventScroll: true });
  input.setSelectionRange(start, Math.max(start, end));
  const lineHeight =
    Number.parseFloat(getComputedStyle(input).lineHeight) || 21;
  input.scrollTop = Math.max(0, (line - 5) * lineHeight);
  input.dispatchEvent(new Event("scroll"));
  return true;
}
