import {
  Signal,
  basename,
  normalizeEol,
  positionAt,
  offsetAt,
} from "./core.mjs";

/** The entry point, otherwise the richest blueprint: more useful than the first declaration. */
function defaultMethod(methods = []) {
  return (
    methods.find((method) => method.name === "main") ??
    [...methods].sort(
      (a, b) => (b.graph?.nodes?.length ?? 0) - (a.graph?.nodes?.length ?? 0),
    )[0]
  );
}

export class TextDocument {
  constructor(file) {
    this.path = file.path;
    this.language = file.language;
    this.content = normalizeEol(file.content.replace(/^\ufeff/, ""), "LF");
    this.savedContent = this.content;
    this.hash = file.hash;
    this.eol = file.eol ?? (file.content.includes("\r\n") ? "CRLF" : "LF");
    this.bom = file.bom === true;
    this.savedEol = this.eol;
    this.savedBom = this.bom;
    this.readOnly = file.readOnly === true;
    this.modifiedAt = file.modifiedAt;
    this.revision = 0;
    this.savedRevision = 0;
    this.external = null;
    this.missing = false;
    this.selection = { start: 0, end: 0, direction: "none" };
    this.scroll = { top: 0, left: 0 };
    this.model = null;
    this.modelRevision = -1;
    this.methodId = null;
    this.selectedNode = null;
    this.analysisError = null;
    this.diagnostics = [];
    this.changed = new Signal();
    this.undo = [];
    this.redo = [];
    this.lastEditAt = 0;
  }

  get name() {
    return basename(this.path);
  }
  get dirty() {
    return (
      this.content !== this.savedContent ||
      this.eol !== this.savedEol ||
      this.bom !== this.savedBom
    );
  }
  get position() {
    return positionAt(this.content, this.selection.start);
  }
  get currentModel() {
    return this.modelRevision === this.revision ? this.model : null;
  }

  update(content, selection = this.selection, options = {}) {
    content = normalizeEol(content, "LF");
    if (this.readOnly && !options.force)
      throw new Error("Файл открыт только для чтения");
    if (content === this.content) {
      this.selection = { ...selection };
      return false;
    }
    const now = Date.now();
    if (!options.noHistory) {
      const previous = this.undo.at(-1);
      if (
        !options.coalesce ||
        now - this.lastEditAt > 650 ||
        previous?.kind !== "typing"
      ) {
        this.undo.push({
          content: this.content,
          selection: { ...this.selection },
          kind: options.coalesce ? "typing" : "edit",
        });
        if (this.undo.length > 100) this.undo.shift();
      }
      this.redo = [];
    }
    this.content = content;
    this.selection = { ...selection };
    this.revision++;
    this.analysisError = null;
    this.lastEditAt = now;
    this.changed.emit({
      document: this,
      kind: "content",
      revision: this.revision,
    });
    return true;
  }

  replace(start, end, value) {
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end < start ||
      end > this.content.length
    )
      throw new Error("Неверный диапазон изменения");
    const result =
      this.content.slice(0, start) + value + this.content.slice(end);
    const caret = start + value.length;
    return this.update(result, { start: caret, end: caret, direction: "none" });
  }

  undoEdit() {
    const entry = this.undo.pop();
    if (!entry) return false;
    this.redo.push({
      content: this.content,
      selection: { ...this.selection },
      kind: "edit",
    });
    this.update(entry.content, entry.selection, { noHistory: true });
    this.lastEditAt = 0;
    return true;
  }

  redoEdit() {
    const entry = this.redo.pop();
    if (!entry) return false;
    this.undo.push({
      content: this.content,
      selection: { ...this.selection },
      kind: "edit",
    });
    this.update(entry.content, entry.selection, { noHistory: true });
    this.lastEditAt = 0;
    return true;
  }

  saved(result, snapshot) {
    this.hash = result.hash;
    this.savedContent = snapshot;
    this.savedEol = this.eol;
    this.savedBom = this.bom;
    this.modifiedAt = result.modifiedAt;
    this.savedRevision = this.revision;
    this.external = null;
    this.missing = false;
    this.changed.emit({ document: this, kind: "saved" });
  }

  acceptExternal(file) {
    this.hash = file.hash;
    this.savedContent = normalizeEol(file.content, "LF");
    this.eol = file.eol;
    this.bom = file.bom;
    this.savedEol = this.eol;
    this.savedBom = this.bom;
    this.modifiedAt = file.modifiedAt;
    this.external = null;
    this.missing = false;
    this.update(file.content, this.selection, { force: true });
    this.changed.emit({ document: this, kind: "reloaded" });
  }

  rebaseExternal(file) {
    this.hash = file.hash;
    this.savedContent = normalizeEol(file.content, "LF");
    this.bom = file.bom;
    this.external = null;
    this.missing = false;
    this.changed.emit({ document: this, kind: "rebased" });
  }

  markExternal(file) {
    if (file.hash === this.hash) return false;
    this.external = file;
    this.changed.emit({ document: this, kind: "external" });
    return true;
  }

  applyModel(model, revision) {
    if (revision !== this.revision) return false;
    const prior = this.model?.methods?.find(
      (method) => method.id === this.methodId,
    );
    this.model = model;
    this.modelRevision = revision;
    this.diagnostics = model.diagnostics ?? [];
    if (!model.methods?.some((method) => method.id === this.methodId)) {
      this.methodId =
        model.methods?.find(
          (method) =>
            method.name === prior?.name && method.owner === prior?.owner,
        )?.id ??
        defaultMethod(model.methods)?.id ??
        null;
    }
    this.changed.emit({ document: this, kind: "analysis" });
    return true;
  }

  selectedMethod() {
    return (
      this.currentModel?.methods?.find(
        (method) => method.id === this.methodId,
      ) ?? null
    );
  }
  goTo(line, column = 1) {
    const offset = offsetAt(this.content, line, column);
    this.selection = { start: offset, end: offset, direction: "none" };
    return offset;
  }
  setEol(eol) {
    if (!["LF", "CRLF"].includes(eol)) return;
    this.eol = eol;
    this.changed.emit({ document: this, kind: "metadata" });
  }
}

export class DocumentStore {
  constructor() {
    this.documents = new Map();
    this.tabs = [];
    this.activePath = null;
    this.changed = new Signal();
    this.subscriptions = new Map();
    this.closed = [];
  }

  get active() {
    return this.documents.get(this.activePath) ?? null;
  }
  get dirty() {
    return [...this.documents.values()].filter((document) => document.dirty);
  }
  get hasDirty() {
    return this.dirty.length > 0;
  }

  open(file) {
    let document = this.documents.get(file.path);
    if (!document) {
      document = new TextDocument(file);
      this.documents.set(file.path, document);
      this.tabs.push(file.path);
      this.subscriptions.set(
        file.path,
        document.changed.subscribe((event) => this.changed.emit(event)),
      );
    }
    this.activate(file.path);
    return document;
  }

  activate(file) {
    if (!this.documents.has(file)) return false;
    this.activePath = file;
    this.changed.emit({ kind: "active", document: this.active });
    return true;
  }

  close(file) {
    const document = this.documents.get(file);
    if (!document) return false;
    const index = this.tabs.indexOf(file);
    this.closed.unshift(file);
    this.closed = this.closed.slice(0, 10);
    this.subscriptions.get(file)?.();
    this.subscriptions.delete(file);
    this.documents.delete(file);
    this.tabs = this.tabs.filter((path) => path !== file);
    if (this.activePath === file)
      this.activePath =
        this.tabs[Math.min(index, this.tabs.length - 1)] ?? null;
    this.changed.emit({ kind: "closed", document: this.active });
    return true;
  }

  rename(from, to) {
    const matches = [...this.documents.keys()].filter(
      (path) => path === from || path.startsWith(from + "/"),
    );
    for (const file of matches) {
      const destination = to + file.slice(from.length);
      const document = this.documents.get(file);
      this.subscriptions.get(file)?.();
      this.subscriptions.delete(file);
      this.documents.delete(file);
      document.path = destination;
      this.documents.set(destination, document);
      this.subscriptions.set(
        destination,
        document.changed.subscribe((event) => this.changed.emit(event)),
      );
      this.tabs = this.tabs.map((path) => (path === file ? destination : path));
      if (this.activePath === file) this.activePath = destination;
    }
    this.changed.emit({ kind: "renamed", document: this.active });
  }

  reorder(from, to) {
    const index = this.tabs.indexOf(from);
    const destination = this.tabs.indexOf(to);
    if (index < 0 || destination < 0) return;
    this.tabs.splice(index, 1);
    this.tabs.splice(destination, 0, from);
    this.changed.emit({ kind: "tabs", document: this.active });
  }

  cycle(delta) {
    if (!this.tabs.length) return;
    const index = this.tabs.indexOf(this.activePath);
    this.activate(
      this.tabs[(index + delta + this.tabs.length) % this.tabs.length],
    );
  }

  clear() {
    for (const unsubscribe of this.subscriptions.values()) unsubscribe();
    this.subscriptions.clear();
    this.documents.clear();
    this.tabs = [];
    this.activePath = null;
    this.closed = [];
    this.changed.emit({ kind: "clear", document: null });
  }

  serialize(expanded = []) {
    return {
      tabs: [...this.tabs],
      active: this.activePath,
      expanded: [...expanded],
    };
  }
}
