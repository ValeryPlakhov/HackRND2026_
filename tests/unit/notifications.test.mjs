// All messages live behind one bell: the panel lists them, the button shows what is unread.
import test from "node:test";
import assert from "node:assert/strict";
import { notifyPanelHtml, titleActions } from "../../web/ide/views.mjs";

test("the bell shows the unread count and turns red for warnings", () => {
  const quiet = titleActions({ name: "p" }, false, { unread: 0, error: false });
  assert.doesNotMatch(quiet, /ide-bell-count/);
  const loud = titleActions({ name: "p" }, false, { unread: 12, error: true });
  assert.match(loud, /has-error/);
  assert.match(loud, />9\+</);
  assert.match(loud, /data-action="notifications"/);
});

test("the panel lists newest messages with their kind and offers to clear", () => {
  const html = notifyPanelHtml([
    { kind: "warning", message: "Черновик <b>", time: Date.UTC(2026, 9, 25, 12, 5) },
    { kind: "info", message: "Открыт проект", time: Date.UTC(2026, 9, 25, 12, 0) },
  ]);
  assert.match(html, /notify-item warning/);
  assert.match(html, /Черновик &lt;b&gt;/);
  assert.match(html, /notifications-clear/);
  assert.match(notifyPanelHtml([]), /Пока ничего нет/);
  assert.doesNotMatch(notifyPanelHtml([]), /notifications-clear/);
});
