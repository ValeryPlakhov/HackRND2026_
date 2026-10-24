import {
  escapeHtml as e,
  $,
  $$,
  rankItems,
  basename,
  dirname,
} from "./core.mjs";
import { glyph } from "./views.mjs";

export class CommandPalette {
  constructor(dialog, onSelect) {
    this.dialog = dialog;
    this.onSelect = onSelect;
    this.items = [];
    this.filtered = [];
    this.index = 0;
    this.mode = "commands";
    this.controller = null;
  }

  open(items, mode = "commands") {
    this.close();
    this.items = items;
    this.mode = mode;
    this.index = 0;
    this.controller = new AbortController();
    const signal = this.controller.signal;
    this.dialog.className = "palette-dialog";
    this.dialog.innerHTML = `<div class="command-palette"><div class="palette-input-wrap">${glyph(mode === "files" ? "file" : "search", 20)}<input id="palette-query" aria-label="${mode === "files" ? "Имя файла" : "Команда"}" placeholder="${mode === "files" ? "Найти файл по имени или пути…" : "Что хотите сделать?"}" autocomplete="off"/><kbd>Esc</kbd></div><div id="palette-results" role="listbox" aria-label="Результаты"></div><footer><span>↑ ↓ Выбрать</span><span>↵ Выполнить</span><b>${mode === "files" ? "ФАЙЛЫ ПРОЕКТА" : "ПАЛИТРА КОМАНД"}</b></footer></div>`;
    this.dialog.showModal();
    const query = $("#palette-query", this.dialog);
    query.addEventListener(
      "input",
      () => {
        this.index = 0;
        this.filter(query.value);
      },
      { signal },
    );
    query.addEventListener(
      "keydown",
      (event) => {
        if (["ArrowDown", "ArrowUp"].includes(event.key)) {
          event.preventDefault();
          this.index =
            (this.index +
              (event.key === "ArrowDown" ? 1 : -1) +
              this.filtered.length) %
            Math.max(1, this.filtered.length);
          this.render();
        }
        if (event.key === "Enter") {
          event.preventDefault();
          this.select(this.index);
        }
      },
      { signal },
    );
    this.dialog.addEventListener(
      "click",
      (event) => {
        const row = event.target.closest("[data-palette-index]");
        if (row) this.select(Number(row.dataset.paletteIndex));
      },
      { signal },
    );
    this.dialog.addEventListener("cancel", () => this.close(), { signal });
    this.filter("");
    query.focus();
  }

  filter(query) {
    this.filtered = rankItems(this.items, query, (item) =>
      this.mode === "files"
        ? item.path
        : item.label + " " + (item.detail ?? ""),
    ).slice(0, 80);
    this.render();
  }

  render() {
    $("#palette-results", this.dialog).innerHTML = this.filtered.length
      ? this.filtered
          .map(
            (item, index) =>
              `<button role="option" aria-selected="${index === this.index}" data-palette-index="${index}" class="palette-result ${index === this.index ? "active" : ""}"><span class="palette-result-icon ${item.language ?? ""}">${glyph(item.icon ?? (item.language === "java" ? "code" : "file"), 17)}</span><span><b>${e(this.mode === "files" ? basename(item.path) : item.label)}</b><small>${e(this.mode === "files" ? dirname(item.path) : item.detail)}</small></span>${item.shortcut ? `<kbd>${e(item.shortcut)}</kbd>` : ""}</button>`,
          )
          .join("")
      : '<p class="palette-empty">Ничего не найдено. Попробуйте другой запрос.</p>';
    $("[aria-selected=true]", this.dialog)?.scrollIntoView({
      block: "nearest",
    });
  }

  select(index) {
    const item = this.filtered[index];
    if (!item) return;
    this.close();
    this.onSelect(item, this.mode);
  }

  close() {
    this.controller?.abort();
    this.controller = null;
    if (this.dialog.open) this.dialog.close();
  }
}
