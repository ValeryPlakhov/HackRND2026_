import {
  escapeHtml as e,
  $,
  $$,
  positionAt,
  offsetAt,
  debounce,
  clamp,
} from "./core.mjs";
import { highlight, bracketPairs } from "../lib/lexer.mjs";
import {
  indentSelection,
  insertNewline,
  toggleComment,
  duplicateLine,
  moveLines,
  wrapPair,
  findInDocument,
  wordAt,
  sortSelectedLines,
  trimTrailingWhitespace,
} from "./editor-actions.mjs";
import { JAVA_SNIPPETS, JAVA_COMPLETIONS } from "./language.mjs";

export function editorShell() {
  return `<section class="ide-editor" aria-label="Редактор исходного кода">
    <div class="editor-find" hidden><div class="editor-find-row"><input id="editor-query" aria-label="Найти в файле" placeholder="Найти в файле" autocomplete="off"/><span id="editor-match-count">0/0</span><button data-editor="previous" aria-label="Предыдущее совпадение">↑</button><button data-editor="next" aria-label="Следующее совпадение">↓</button><button data-editor="case" title="Учитывать регистр" aria-pressed="false">Aa</button><button data-editor="replace-toggle" title="Показать замену">⇄</button><button data-editor="find-close" aria-label="Закрыть поиск">×</button></div><div class="editor-replace-row" hidden><input id="editor-replacement" aria-label="Заменить на" placeholder="Заменить на"/><button data-editor="replace">Одно</button><button data-editor="replace-all">Все</button></div></div>
    <div class="editor-scroll-area"><div class="editor-gutter" aria-hidden="true"><div class="editor-line-numbers"></div></div><div class="editor-text-area"><div class="editor-active-line" aria-hidden="true"></div><pre class="editor-highlight" aria-hidden="true"></pre><textarea id="ide-source" class="editor-input" aria-label="Исходный код" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" wrap="off"></textarea></div><div class="editor-completions" role="listbox" aria-label="Подсказки Java" hidden></div></div>
    <div class="editor-readonly" hidden>Только чтение · оригинальные файлы не изменяются в веб-предпросмотре</div>
  </section>`;
}

export class SourceEditor {
  constructor(container, options = {}) {
    this.container = container;
    this.options = options;
    this.input = $(".editor-input", container);
    this.pre = $(".editor-highlight", container);
    this.numbers = $(".editor-line-numbers", container);
    this.findBar = $(".editor-find", container);
    this.query = $("#editor-query", container);
    this.completions = $(".editor-completions", container);
    this.document = null;
    this.settings = { fontSize: 14, tabSize: 4, wordWrap: false };
    this.matches = [];
    this.matchIndex = -1;
    this.caseSensitive = false;
    this.completionItems = [];
    this.completionIndex = 0;
    this.controller = new AbortController();
    this.paintSoon = debounce(() => this.paint(), 70);
    this.bind();
  }

  bind() {
    const signal = this.controller.signal;
    this.input.addEventListener(
      "input",
      () => {
        if (!this.document) return;
        this.document.update(this.input.value, this.selection(), {
          coalesce: true,
        });
        this.paintSoon();
        this.updatePosition();
        this.updateFind(false);
        this.hideCompletions();
        this.options.onChange?.(this.document);
      },
      { signal },
    );
    this.input.addEventListener("scroll", () => this.syncScroll(), {
      signal,
      passive: true,
    });
    for (const event of ["click", "keyup", "select"])
      this.input.addEventListener(event, () => this.updatePosition(), {
        signal,
      });
    this.input.addEventListener("keydown", (event) => this.keydown(event), {
      signal,
    });
    this.input.addEventListener("blur", () => this.capture(), { signal });
    this.query.addEventListener("input", () => this.updateFind(true), {
      signal,
    });
    this.query.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          this.navigateMatch(event.shiftKey ? -1 : 1);
        }
        if (event.key === "Escape") {
          event.preventDefault();
          this.closeFind();
        }
      },
      { signal },
    );
    this.container.addEventListener(
      "click",
      (event) => {
        const button = event.target.closest("[data-editor]");
        if (button) this.action(button.dataset.editor);
        const completion = event.target.closest("[data-completion]");
        if (completion)
          this.applyCompletion(Number(completion.dataset.completion));
      },
      { signal },
    );
    this.input.addEventListener("paste", () => this.hideCompletions(), {
      signal,
    });
  }

  setDocument(document) {
    this.capture();
    this.document = document;
    this.hideCompletions();
    this.input.value = document?.content ?? "";
    this.input.readOnly = !document || document.readOnly;
    $(".editor-readonly", this.container).hidden = !document?.readOnly;
    if (document) {
      this.input.setSelectionRange(
        document.selection.start,
        document.selection.end,
        document.selection.direction,
      );
      this.input.scrollTop = document.scroll.top;
      this.input.scrollLeft = document.scroll.left;
    }
    this.paint();
    this.updateFind(false);
    this.updatePosition();
    this.syncScroll();
  }

  setSettings(settings) {
    this.settings = { ...this.settings, ...settings };
    this.container.style.setProperty(
      "--editor-font-size",
      this.settings.fontSize + "px",
    );
    this.container.style.setProperty(
      "--editor-tab-size",
      this.settings.tabSize,
    );
    this.input.wrap = settings.wordWrap ? "soft" : "off";
    this.container.classList.toggle("word-wrap", settings.wordWrap === true);
    this.container.classList.toggle(
      "show-whitespace",
      settings.showWhitespace === true,
    );
    this.paint();
  }

  selection() {
    return {
      start: this.input.selectionStart,
      end: this.input.selectionEnd,
      direction: this.input.selectionDirection,
    };
  }

  capture() {
    if (!this.document) return;
    this.document.selection = this.selection();
    this.document.scroll = {
      top: this.input.scrollTop,
      left: this.input.scrollLeft,
    };
  }

  paint() {
    this.paintSoon.cancel();
    const source = this.input.value;
    const rich = this.document?.language === "java" && source.length <= 250000;
    this.pre.innerHTML = (rich ? highlight(source) : e(source)) + "\n";
    const count = source.split("\n").length;
    const errors = new Map(
      (this.document?.diagnostics ?? []).map((item) => [item.line, item]),
    );
    this.numbers.innerHTML = Array.from({ length: count }, (_, index) => {
      const diagnostic = errors.get(index + 1);
      return `<span data-line="${index + 1}" class="${diagnostic ? "line-diagnostic " + (diagnostic.severity === "ERROR" ? "error" : "warning") : ""}" title="${e(diagnostic?.message ?? "")}">${index + 1}</span>`;
    }).join("");
    this.syncScroll();
  }

  syncScroll() {
    this.pre.style.transform = `translate(${-this.input.scrollLeft}px, ${-this.input.scrollTop}px)`;
    this.numbers.style.transform = `translateY(${-this.input.scrollTop}px)`;
    if (this.document)
      this.document.scroll = {
        top: this.input.scrollTop,
        left: this.input.scrollLeft,
      };
    this.updateActiveLine();
  }

  updateActiveLine() {
    const position = positionAt(this.input.value, this.input.selectionStart);
    const height = parseFloat(getComputedStyle(this.input).lineHeight) || 22;
    const top = 18 + (position.line - 1) * height - this.input.scrollTop;
    const line = $(".editor-active-line", this.container);
    line.style.transform = `translateY(${top}px)`;
    line.style.height = height + "px";
    line.hidden = this.settings.wordWrap === true;
    $$("[data-line]", this.numbers).forEach((element) =>
      element.classList.toggle(
        "current",
        Number(element.dataset.line) === position.line,
      ),
    );
  }

  updatePosition() {
    this.capture();
    this.updateActiveLine();
    if (this.document)
      this.options.onPosition?.(
        this.document.position,
        this.input.selectionEnd - this.input.selectionStart,
      );
  }

  refresh() {
    if (!this.document) return;
    this.input.value = this.document.content;
    this.input.setSelectionRange(
      this.document.selection.start,
      this.document.selection.end,
      this.document.selection.direction,
    );
    this.paint();
    this.updatePosition();
    this.options.onChange?.(this.document);
  }

  apply(result) {
    if (!this.document || !result) return;
    this.document.update(result.content, result.selection);
    this.refresh();
    this.input.focus();
  }

  replace(start, end, value) {
    this.document?.replace(start, end, value);
    this.refresh();
    this.input.focus();
  }

  goTo(line, column = 1, length = 0) {
    if (!this.document) return;
    const offset = offsetAt(this.document.content, line, column);
    this.input.setSelectionRange(offset, offset + length);
    const height = parseFloat(getComputedStyle(this.input).lineHeight) || 22;
    this.input.scrollTop = Math.max(
      0,
      (line - 1) * height - this.input.clientHeight / 3,
    );
    this.input.focus();
    this.updatePosition();
    this.syncScroll();
  }

  selectSpan(start, end) {
    if (!this.document || start < 0) return;
    const position = positionAt(this.document.content, start);
    this.goTo(position.line, position.column, Math.max(0, end - start));
  }

  keydown(event) {
    if (!this.document) return;
    const control = event.ctrlKey || event.metaKey;
    if (!this.completions.hidden) {
      if (["ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        this.completionIndex =
          (this.completionIndex +
            (event.key === "ArrowDown" ? 1 : -1) +
            this.completionItems.length) %
          this.completionItems.length;
        this.renderCompletions();
        return;
      }
      if (["Enter", "Tab"].includes(event.key)) {
        event.preventDefault();
        this.applyCompletion(this.completionIndex);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        this.hideCompletions();
        return;
      }
    }
    if (control && event.key.toLocaleLowerCase() === "f") {
      event.preventDefault();
      event.stopPropagation();
      this.openFind();
      return;
    }
    if (control && event.key.toLocaleLowerCase() === "h") {
      event.preventDefault();
      this.openFind(true);
      return;
    }
    if (event.key === "Escape") {
      this.closeFind();
      this.hideCompletions();
      return;
    }
    if (this.document.readOnly) return;
    const source = this.document.content;
    const selection = this.selection();
    if (
      !control &&
      !event.altKey &&
      selection.start === selection.end &&
      [")", "]", "}", '"', "'"].includes(event.key) &&
      source[selection.start] === event.key
    ) {
      event.preventDefault();
      this.input.setSelectionRange(selection.start + 1, selection.start + 1);
      this.updatePosition();
      return;
    }
    let result = null;
    if (event.key === "Tab")
      result = indentSelection(
        source,
        selection,
        this.settings.tabSize,
        event.shiftKey,
      );
    else if (event.key === "Enter" && !control && !event.altKey)
      result = insertNewline(source, selection, this.settings.tabSize, "LF");
    else if (control && event.key === "/")
      result = toggleComment(source, selection);
    else if (event.altKey && event.shiftKey && event.key === "ArrowDown")
      result = duplicateLine(source, selection);
    else if (
      event.altKey &&
      !event.shiftKey &&
      ["ArrowDown", "ArrowUp"].includes(event.key)
    )
      result = moveLines(source, selection, event.key === "ArrowDown" ? 1 : -1);
    else if (control && event.key.toLocaleLowerCase() === "z") {
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) this.document.redoEdit();
      else this.document.undoEdit();
      this.refresh();
      return;
    } else if (control && event.key.toLocaleLowerCase() === "y") {
      event.preventDefault();
      this.document.redoEdit();
      this.refresh();
      return;
    } else if (control && event.code === "Space") {
      event.preventDefault();
      this.showCompletions();
      return;
    } else if (
      !control &&
      !event.altKey &&
      ["(", "[", "{", '"', "'"].includes(event.key) &&
      this.document.language === "java"
    )
      result = wrapPair(source, selection, event.key);
    if (result) {
      event.preventDefault();
      this.apply(result);
    }
  }

  openFind(replace = false) {
    this.findBar.hidden = false;
    $(".editor-replace-row", this.container).hidden = !replace;
    const selected = this.input.value.slice(
      this.input.selectionStart,
      this.input.selectionEnd,
    );
    if (selected && !selected.includes("\n")) this.query.value = selected;
    this.updateFind(false);
    this.query.focus();
    this.query.select();
  }

  closeFind() {
    if (this.findBar.hidden) return;
    this.findBar.hidden = true;
    this.input.focus();
  }

  updateFind(select = false) {
    this.matches = findInDocument(this.input.value, this.query.value, {
      caseSensitive: this.caseSensitive,
    });
    if (!this.matches.length) this.matchIndex = -1;
    else
      this.matchIndex = clamp(
        this.matchIndex < 0 ? 0 : this.matchIndex,
        0,
        this.matches.length - 1,
      );
    $("#editor-match-count", this.container).textContent =
      `${this.matchIndex + 1}/${this.matches.length}${this.matches.length >= 5000 ? "+" : ""}`;
    if (select && this.matches.length) this.selectMatch(false);
  }

  navigateMatch(delta) {
    if (!this.matches.length) return;
    this.matchIndex =
      (this.matchIndex + delta + this.matches.length) % this.matches.length;
    this.selectMatch(false);
    $("#editor-match-count", this.container).textContent =
      `${this.matchIndex + 1}/${this.matches.length}`;
  }

  selectMatch(focus = true) {
    const match = this.matches[this.matchIndex];
    if (!match) return;
    this.goTo(match.line, match.column, match.end - match.start);
    if (!focus) this.query.focus();
  }

  action(name) {
    switch (name) {
      case "find-close":
        this.closeFind();
        break;
      case "next":
        this.navigateMatch(1);
        break;
      case "previous":
        this.navigateMatch(-1);
        break;
      case "case":
        this.caseSensitive = !this.caseSensitive;
        $("[data-editor=case]", this.container).setAttribute(
          "aria-pressed",
          String(this.caseSensitive),
        );
        this.updateFind(true);
        break;
      case "replace-toggle":
        $(".editor-replace-row", this.container).hidden = !$(
          ".editor-replace-row",
          this.container,
        ).hidden;
        break;
      case "replace": {
        const match = this.matches[this.matchIndex];
        if (!match || this.document.readOnly) break;
        this.replace(
          match.start,
          match.end,
          $("#editor-replacement", this.container).value,
        );
        this.updateFind(true);
        break;
      }
      case "replace-all": {
        if (!this.matches.length || this.document.readOnly) break;
        let content = this.document.content;
        const replacement = $("#editor-replacement", this.container).value;
        for (const match of [...this.matches].reverse())
          content =
            content.slice(0, match.start) +
            replacement +
            content.slice(match.end);
        this.document.update(content);
        this.refresh();
        this.updateFind(false);
        break;
      }
    }
  }

  showCompletions() {
    if (this.document?.language !== "java") return;
    const word = wordAt(this.document.content, this.input.selectionStart);
    const prefix = this.document.content
      .slice(word.start, this.input.selectionStart)
      .toLocaleLowerCase();
    const localWords = [
      ...new Set(this.document.content.match(/[A-Za-z_$][\w$]{2,}/g) ?? []),
    ].map((label) => ({
      label,
      insert: label,
      detail: "Из текущего файла",
      kind: "word",
    }));
    const seen = new Set();
    this.completionItems = [
      ...JAVA_SNIPPETS,
      ...JAVA_COMPLETIONS,
      ...localWords,
    ]
      .filter((item) => {
        if (
          seen.has(item.label) ||
          (prefix && !item.label.toLocaleLowerCase().startsWith(prefix))
        )
          return false;
        seen.add(item.label);
        return true;
      })
      .slice(0, 24);
    this.completionWord = word;
    this.completionIndex = 0;
    this.completions.hidden = !this.completionItems.length;
    this.renderCompletions();
  }

  renderCompletions() {
    this.completions.innerHTML = this.completionItems
      .map(
        (item, index) =>
          `<button role="option" aria-selected="${index === this.completionIndex}" data-completion="${index}" class="${index === this.completionIndex ? "active" : ""}"><span>${e(item.label)}</span><small>${e(item.detail)}</small></button>`,
      )
      .join("");
    const position = positionAt(this.input.value, this.input.selectionStart);
    const fontSize = this.settings.fontSize;
    const height = parseFloat(getComputedStyle(this.input).lineHeight) || 22;
    const left = Math.min(
      this.input.clientWidth - 300,
      20 + (position.column - 1) * fontSize * 0.61 - this.input.scrollLeft,
    );
    const top = Math.min(
      this.input.clientHeight - 200,
      40 + (position.line - 1) * height - this.input.scrollTop,
    );
    this.completions.style.left = Math.max(64, left + 58) + "px";
    this.completions.style.top = Math.max(15, top) + "px";
    $("[aria-selected=true]", this.completions)?.scrollIntoView({
      block: "nearest",
    });
  }

  applyCompletion(index) {
    const item = this.completionItems[index];
    if (!item || !this.document) return;
    const start = this.completionWord.start;
    const end = this.input.selectionStart;
    const indentation =
      this.document.content
        .slice(this.document.content.lastIndexOf("\n", start - 1) + 1, start)
        .match(/^\s*/)?.[0] ?? "";
    const raw = item.insert
      .replaceAll("\n", "\n" + indentation)
      .replaceAll("\t", " ".repeat(this.settings.tabSize));
    const marker = raw.indexOf("$0");
    const value = raw.replaceAll("$0", "");
    this.replace(start, end, value);
    if (marker >= 0)
      this.input.setSelectionRange(start + marker, start + marker);
    this.hideCompletions();
    this.updatePosition();
  }

  hideCompletions() {
    this.completions.hidden = true;
    this.completionItems = [];
  }

  command(name) {
    if (!this.document || this.document.readOnly) return;
    if (name === "comment")
      this.apply(toggleComment(this.document.content, this.selection()));
    if (name === "duplicate-line")
      this.apply(duplicateLine(this.document.content, this.selection()));
    if (name === "sort-lines")
      this.apply(sortSelectedLines(this.document.content, this.selection()));
    if (name === "trim-whitespace")
      this.apply({
        content: trimTrailingWhitespace(this.document.content),
        selection: this.selection(),
      });
    if (name === "undo") {
      this.document.undoEdit();
      this.refresh();
    }
    if (name === "redo") {
      this.document.redoEdit();
      this.refresh();
    }
    if (name === "complete") this.showCompletions();
    if (name === "bracket") {
      const cursor = this.input.selectionStart;
      const pair = bracketPairs(this.document.content).find(
        (pair) => pair.includes(cursor) || pair.includes(cursor - 1),
      );
      if (pair) {
        const target =
          pair[0] === cursor || pair[0] === cursor - 1 ? pair[1] : pair[0];
        this.selectSpan(target, target + 1);
      }
    }
  }

  destroy() {
    this.capture();
    this.paintSoon.cancel();
    this.controller.abort();
  }
}
