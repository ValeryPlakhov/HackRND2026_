import { escapeHtml as e, relativeTime } from "../lib/core.mjs";
import { projectDiff } from "../lib/diff.mjs";
import {
  sectionHeading,
  button,
  badge,
  emptyState,
  notice,
} from "../components/primitives.mjs";

export function renderHistory(workspace) {
  const snapshots = [...workspace.state.snapshots].reverse();
  const content = snapshots
    .map((snapshot, index) => {
      const previous = snapshots[index + 1];
      const changes = previous
        ? projectDiff(previous.files, snapshot.files)
        : [];
      const additions = changes.reduce((sum, file) => sum + file.additions, 0);
      const deletions = changes.reduce((sum, file) => sum + file.deletions, 0);
      const lines = Object.values(snapshot.files).reduce(
        (sum, source) => sum + source.split("\n").length,
        0,
      );
      return `<article class="snapshot-card"><div class="snapshot-top"><div><div class="eyebrow">CHECKPOINT ${String(snapshots.length - index).padStart(2, "0")}</div><h3 style="margin-top:7px">${e(snapshot.label)}</h3><span class="muted text-tiny">${e(relativeTime(snapshot.createdAt))} · ${e(new Date(snapshot.createdAt).toLocaleString("ru-RU"))}</span></div>${badge(snapshot.gate === "passed" ? "PASS на момент снимка" : "Snapshot", snapshot.gate === "passed" ? "success" : "accent")}</div><div class="snapshot-meta"><span>${Object.keys(snapshot.files).length} файлов</span><span>${lines} строк</span>${previous ? `<span class="text-green">+${additions}</span><span class="text-red">−${deletions}</span>` : ""}</div><div style="display:flex;gap:7px">${button("Восстановить", "restore-snapshot", { icon: "history", className: "small", data: { id: snapshot.id } })}${button("Скачать снимок", "export-snapshot", { icon: "download", variant: "ghost", className: "small", data: { id: snapshot.id } })}</div></article>`;
    })
    .join("");
  return (
    sectionHeading(
      "KEEP THE REASON, NOT JUST THE RESULT",
      "История ваших решений.",
      "Снимки исходников сохраняются локально. Восстановление версии всегда требует нового quality gate.",
      button("Создать checkpoint", "checkpoint", {
        icon: "bookmark",
        variant: "primary",
      }),
    ) +
    notice(
      "Снимки не заменяют Git. В браузере хранится до 24 checkpoints, на диск сохраняются последние 12; при нехватке места сохраняются только 3.",
      "info",
      "git",
    ) +
    '<div style="height:25px"></div>' +
    (snapshots.length
      ? `<div class="history-timeline">${content}</div>`
      : emptyState(
          "history",
          "Первый снимок ещё впереди",
          "Сохраните проект сочетанием Ctrl S или примените преобразование.",
        ))
  );
}
