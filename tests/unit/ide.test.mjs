import test from "node:test";
import assert from "node:assert/strict";
import { TextDocument, DocumentStore } from "../../web/ide/documents.mjs";
import {
  fuzzyScore,
  rankItems,
  positionAt,
  offsetAt,
  normalizeEol,
  safeRelative,
  escapeHtml,
} from "../../web/ide/core.mjs";
import {
  indentSelection,
  insertNewline,
  toggleComment,
  duplicateLine,
  moveLines,
  wrapPair,
  findInDocument,
  wordAt,
  trimTrailingWhitespace,
  sortSelectedLines,
} from "../../web/ide/editor-actions.mjs";
import { availableCommands, shortcutCommand } from "../../web/ide/commands.mjs";
import { LANGUAGES, JAVA_FILE_TEMPLATES } from "../../web/ide/language.mjs";
import { graphToSvg } from "../../web/ide/graph-export.mjs";
import { IdeApplication } from "../../web/ide/app.mjs";
import { SourceEditor } from "../../web/ide/editor.mjs";

const file = (path = "Main.java", content = "class Main {}") => ({
  path,
  content,
  hash: "hash-1",
  language: "java",
  eol: "LF",
  bom: false,
});
const selection = (start, end = start) => ({ start, end, direction: "none" });

test("IDE document preserves unsaved edits when an older save completes", () => {
  const document = new TextDocument(file());
  document.update("class Main { int a; }");
  const saved = document.content;
  document.update("class Main { int b; }");
  document.saved({ hash: "hash-2" }, saved);
  assert.equal(document.content, "class Main { int b; }");
  assert.equal(document.dirty, true);
  assert.equal(document.hash, "hash-2");
});

test("IDE undo across save correctly returns to clean state", () => {
  const document = new TextDocument(file());
  document.update("a");
  document.saved({ hash: "2" }, "a");
  document.update("b");
  document.undoEdit();
  assert.equal(document.content, "a");
  assert.equal(document.dirty, false);
  document.redoEdit();
  assert.equal(document.content, "b");
});

test("IDE coalesced typing keeps the original undo boundary", () => {
  const document = new TextDocument(file("A.java", ""));
  document.update("a", selection(1), { coalesce: true });
  document.update("ab", selection(2), { coalesce: true });
  document.update("abc", selection(3), { coalesce: true });
  document.undoEdit();
  assert.equal(document.content, "");
  document.redoEdit();
  assert.equal(document.content, "abc");
});

test("IDE source model never attaches to a newer edit", () => {
  const document = new TextDocument(file());
  const revision = document.revision;
  document.update("class Main { }");
  assert.equal(
    document.applyModel({ valid: true, methods: [] }, revision),
    false,
  );
  assert.equal(document.currentModel, null);
});

test("IDE method selection survives source span changes by owner and name", () => {
  const document = new TextDocument(file());
  document.applyModel(
    { methods: [{ id: "old", name: "price", owner: "Shop" }], diagnostics: [] },
    0,
  );
  document.methodId = "old";
  document.update("// comment\nclass Main {}");
  document.applyModel(
    { methods: [{ id: "new", name: "price", owner: "Shop" }] },
    1,
  );
  assert.equal(document.methodId, "new");
});

test("IDE text uses LF offsets while retaining CRLF disk metadata", () => {
  const document = new TextDocument({
    ...file("A.java", "a\r\nb\r\n"),
    eol: "CRLF",
    bom: true,
  });
  assert.equal(document.content, "a\nb\n");
  assert.equal(document.dirty, false);
  document.goTo(2, 1);
  assert.equal(document.selection.start, 2);
  assert.equal(normalizeEol(document.content, document.eol), "a\r\nb\r\n");
  document.setEol("LF");
  assert.equal(document.dirty, true);
});

test("IDE external changes are preserved until a deliberate resolution", () => {
  const document = new TextDocument(file("A.java", "original"));
  document.update("mine");
  document.markExternal({ ...file("A.java", "theirs"), hash: "external" });
  assert.equal(document.content, "mine");
  assert.equal(document.hash, "hash-1");
  document.rebaseExternal(document.external);
  assert.equal(document.hash, "external");
  assert.equal(document.content, "mine");
  assert.equal(document.dirty, true);
});

test("IDE read-only documents reject changes but allow external reload", () => {
  const document = new TextDocument({ ...file(), readOnly: true });
  assert.throws(() => document.update("changed"), /чтения/);
  document.acceptExternal({ ...file("Main.java", "external"), hash: "2" });
  assert.equal(document.content, "external");
  assert.equal(document.dirty, false);
});

test("IDE invalid edits cannot replace outside document ranges", () => {
  const document = new TextDocument(file());
  assert.throws(() => document.replace(-1, 0, "x"));
  assert.throws(() => document.replace(0, 1000, "x"));
});

test("IDE tab close selects nearest remaining file", () => {
  const store = new DocumentStore();
  store.open(file("A.java"));
  store.open(file("B.java"));
  store.open(file("C.java"));
  store.activate("B.java");
  store.close("B.java");
  assert.equal(store.activePath, "C.java");
  store.close("C.java");
  assert.equal(store.activePath, "A.java");
});

test("IDE folder rename updates all open descendants and subscriptions", () => {
  const store = new DocumentStore();
  store.open(file("src/A.java"));
  store.open(file("src/deep/B.java"));
  store.rename("src", "code");
  assert.deepEqual(store.tabs, ["code/A.java", "code/deep/B.java"]);
  assert.equal(store.activePath, "code/deep/B.java");
  store.active.update("changed");
  assert.equal(store.hasDirty, true);
});

test("IDE tab order is independent of document contents", () => {
  const store = new DocumentStore();
  store.open(file("A.java", "A"));
  store.open(file("B.java", "B"));
  store.reorder("A.java", "B.java");
  assert.deepEqual(store.tabs, ["B.java", "A.java"]);
  assert.equal(store.documents.get("A.java").content, "A");
  store.cycle(1);
  assert.equal(store.activePath, "A.java");
});

test("IDE clearing a workspace removes dirty and closed state", () => {
  const store = new DocumentStore();
  store.open(file());
  store.active.update("changed");
  store.clear();
  assert.equal(store.hasDirty, false);
  assert.equal(store.active, null);
  assert.equal(store.tabs.length, 0);
});

test("IDE fuzzy quick-open favors exact path segments", () => {
  const ranked = rankItems(
    [
      { path: "src/Pricing.java" },
      { path: "src/PrintQueue.java" },
      { path: "README.md" },
    ],
    "Pricing",
    (item) => item.path,
  );
  assert.equal(ranked[0].path, "src/Pricing.java");
  assert.equal(fuzzyScore("xyz", "Main.java"), -Infinity);
});

test("IDE UTF-16 offsets agree around supplementary Unicode characters", () => {
  const source = "😀x\nцена";
  assert.deepEqual(positionAt(source, 4), { line: 2, column: 1, offset: 4 });
  assert.equal(offsetAt(source, 2, 3), 6);
});

test("IDE go-to clamps line and column to document boundaries", () => {
  assert.equal(offsetAt("a\nb", 999, 999), 3);
  assert.equal(offsetAt("a\nb", -3, -1), 0);
});

test("IDE indentation respects tab stops at a caret", () => {
  const result = indentSelection("abc", selection(3), 4);
  assert.equal(result.content, "abc ");
  assert.equal(result.selection.start, 4);
});

test("IDE block indentation excludes a selection ending at the next line", () => {
  const result = indentSelection("a\nb\nc", selection(0, 4), 2);
  assert.equal(result.content, "  a\n  b\nc");
});

test("IDE outdent removes a tab or at most the configured spaces", () => {
  assert.equal(
    indentSelection("\ta\n  b", selection(0, 6), 4, true).content,
    "a\nb",
  );
});

test("IDE Enter creates a balanced indented block", () => {
  const result = insertNewline("if (ok) {}", selection(9), 4);
  assert.equal(result.content, "if (ok) {\n    \n}");
  assert.equal(result.selection.start, 14);
});

test("IDE line comments preserve indentation and round-trip", () => {
  const source = "  first();\n  second();";
  const commented = toggleComment(source, selection(0, source.length));
  assert.equal(commented.content, "  // first();\n  // second();");
  assert.equal(
    toggleComment(commented.content, commented.selection).content,
    source,
  );
});

test("IDE moving lines keeps selected text in the same logical block", () => {
  const result = moveLines("a\nb\nc", selection(2, 3), -1);
  assert.equal(result.content, "b\na\nc");
  assert.equal(result.selection.start, 0);
  assert.equal(moveLines("a\nb", selection(0), -1).content, "a\nb");
});

test("IDE duplicate last line without newline produces a separate line", () => {
  assert.equal(duplicateLine("last", selection(2)).content, "last\nlast");
});

test("IDE pair insertion wraps a selection without losing text", () => {
  const result = wrapPair("value", selection(0, 5), "(");
  assert.equal(result.content, "(value)");
  assert.deepEqual(result.selection, selection(1, 6));
});

test("IDE text search is literal and supports Unicode word boundaries", () => {
  assert.equal(findInDocument("a.b aXb", "a.b").length, 1);
  assert.equal(
    findInDocument("цена цены цена2 Цена", "цена", { wholeWord: true }).length,
    2,
  );
  assert.equal(
    findInDocument("Aa aa", "aa", { caseSensitive: true }).length,
    1,
  );
});

test("IDE empty search cannot loop indefinitely", () =>
  assert.deepEqual(findInDocument("abc", ""), []));
test("IDE local word extraction stops at punctuation", () =>
  assert.deepEqual(wordAt("item.price()", 8), {
    start: 5,
    end: 10,
    text: "price",
  }));
test("IDE whitespace cleanup preserves newline style", () =>
  assert.equal(trimTrailingWhitespace("a  \r\nb\t\r\n"), "a\r\nb\r\n"));
test("IDE sort lines leaves text outside selected lines unchanged", () =>
  assert.equal(
    sortSelectedLines("z\nb\na\nx", selection(2, 5)).content,
    "z\na\nb\nx",
  ));

test("IDE command availability does not offer Java actions for another language", () => {
  const commands = availableCommands({
    project: {},
    document: { language: "python" },
  });
  assert.equal(
    commands.some((item) => item.id === "analyse"),
    false,
  );
  assert.equal(
    commands.some((item) => item.id === "save"),
    true,
  );
});

test("IDE shortcuts distinguish project search from editor search", () => {
  const event = {
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    shiftKey: true,
    key: "F",
  };
  assert.equal(shortcutCommand(event), "search");
  assert.equal(shortcutCommand({ ...event, shiftKey: false }), null);
  assert.equal(
    shortcutCommand({ ...event, key: "F5", ctrlKey: false }),
    "stop",
  );
});

test("IDE only Java has an enabled blueprint provider", () => {
  assert.deepEqual(
    LANGUAGES.filter((item) => item.available).map((item) => item.id),
    ["java"],
  );
  assert.ok(LANGUAGES.length >= 8);
});

test("IDE Java file templates use the selected class name", () => {
  for (const template of JAVA_FILE_TEMPLATES.filter(
    (item) => item.id !== "text",
  ))
    assert.match(template.create("Order"), /\bOrder\b/);
});

test("IDE source paths reject traversal and Windows streams", () => {
  for (const path of [
    "../Main.java",
    "C:/Main.java",
    "/etc/passwd",
    "Main.java:evil",
    "src//Main.java",
    "src/../Main.java",
  ])
    assert.throws(() => safeRelative(path));
  assert.equal(safeRelative("src\\Main.java"), "src/Main.java");
});

test("IDE SVG graph export escapes hostile source code", () => {
  const svg = graphToSvg({
    bounds: { x: 0, y: 0, width: 100, height: 100 },
    nodes: [
      {
        x: 0,
        y: 0,
        width: 100,
        height: 60,
        kind: "operation",
        label: '<script>"x"</script>',
      },
    ],
    edges: [],
  });
  assert.equal(svg.includes("<script>"), false);
  assert.ok(svg.includes("&lt;script&gt;"));
  assert.equal(escapeHtml('<img src=x onerror="x">').includes("<"), false);
});

test("IDE cancelling the folder picker restores native dirty-file protection", async () => {
  const states = [];
  const application = new IdeApplication(null, {
    dirty: async (value) => states.push(value),
  });
  application.documents.open(file());
  application.documents.active.update("unsaved");
  application.guardSwitch = async () => {
    states.push(false);
    return true;
  };
  await application.switchProject(async () => ({ cancelled: true }));
  assert.deepEqual(states, [false, true]);
  assert.equal(application.documents.active.content, "unsaved");
});

test("IDE failed folder opening also restores close-window protection", async () => {
  const states = [];
  const application = new IdeApplication(null, {
    dirty: async (value) => states.push(value),
  });
  application.documents.open(file());
  application.documents.active.update("unsaved");
  application.guardSwitch = async () => true;
  await assert.rejects(() =>
    application.switchProject(async () => {
      throw new Error("access denied");
    }),
  );
  assert.deepEqual(states, [true]);
});

test("IDE typing an existing closing bracket moves over it without duplication", () => {
  const editor = Object.create(SourceEditor.prototype);
  editor.document = new TextDocument(file("Main.java", "call()"));
  editor.completions = { hidden: true };
  editor.input = {
    selectionStart: 5,
    selectionEnd: 5,
    selectionDirection: "none",
    setSelectionRange(start, end) {
      this.selectionStart = start;
      this.selectionEnd = end;
    },
  };
  editor.updatePosition = () => {};
  let prevented = false;
  editor.keydown({
    key: ")",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(editor.input.selectionStart, 6);
  assert.equal(editor.document.content, "call()");
});
