import { escapeHtml as e } from "../lib/core.mjs";
import { icon } from "../lib/icons.mjs";

export function button(label, action, options = {}) {
  const attributes = Object.entries(options.data ?? {})
    .map(([key, value]) => `data-${key}="${e(value)}"`)
    .join(" ");
  return `<button class="button ${options.variant ?? "secondary"} ${options.className ?? ""}" data-action="${e(action)}" ${attributes} ${options.disabled ? "disabled" : ""} ${options.title ? `title="${e(options.title)}"` : ""}>${options.icon ? icon(options.icon, "", options.size ?? 16) : ""}<span>${e(label)}</span>${options.trailing ? icon(options.trailing, "", 15) : ""}</button>`;
}

export function iconButton(name, action, title, data = {}) {
  const attributes = Object.entries(data)
    .map(([key, value]) => `data-${key}="${e(value)}"`)
    .join(" ");
  return `<button class="icon-button" data-action="${e(action)}" aria-label="${e(title)}" title="${e(title)}" ${attributes}>${icon(name)}</button>`;
}

export function badge(text, tone = "neutral", iconName = null) {
  return `<span class="badge ${tone}">${iconName ? icon(iconName, "", 12) : ""}${e(text)}</span>`;
}

export function sectionHeading(eyebrow, title, description = "", actions = "") {
  return `<div class="view-heading"><div><div class="eyebrow">${e(eyebrow)}</div><h1>${title}</h1>${description ? `<p>${e(description)}</p>` : ""}</div>${actions ? `<div class="view-heading-actions">${actions}</div>` : ""}</div>`;
}

export function panel(
  title,
  content,
  { icon: name = null, actions = "", className = "", eyebrow = "" } = {},
) {
  return `<section class="panel ${className}"><header class="panel-header"><div>${name ? icon(name, "panel-icon", 16) : ""}<span>${e(title)}</span>${eyebrow ? `<small>${e(eyebrow)}</small>` : ""}</div><div class="panel-header-actions">${actions}</div></header><div class="panel-body">${content}</div></section>`;
}

export function emptyState(name, title, description, action = "") {
  return `<div class="empty-state"><span class="empty-state-icon">${icon(name, "", 28)}</span><h3>${e(title)}</h3><p>${e(description)}</p>${action}</div>`;
}

export function metricCard(
  label,
  value,
  detail,
  { accent = false, trend = "", name = "chart", className = "" } = {},
) {
  return `<article class="metric-card ${accent ? "metric-accent" : ""} ${className}"><div class="metric-label">${e(label)}${icon(name, "", 14)}</div><div class="metric-value">${e(value)}</div><div class="metric-detail">${e(detail)}${trend ? `<span>${e(trend)}</span>` : ""}</div></article>`;
}

export function skeleton(count = 3, className = "") {
  return `<div class="skeleton-group ${className}">${Array.from({ length: count }, (_, index) => `<div class="skeleton" style="--skeleton-width:${95 - (index % 3) * 16}%"></div>`).join("")}</div>`;
}

export function severityIcon(severity) {
  return icon(
    severity === "error"
      ? "warning"
      : severity === "warning"
        ? "warning"
        : "info",
    `severity-${severity}`,
    15,
  );
}

export function statusPill(status, recorded = false) {
  const states = {
    unverified: ["Нужна проверка", "neutral", "shield"],
    passed: [
      recorded ? "Запись: PASS" : "Поведение совпало",
      "success",
      "circleCheck",
    ],
    failed: [
      recorded ? "Запись: FAIL" : "Найдено различие",
      "danger",
      "warning",
    ],
    running: ["Проверяем…", "accent", "clock"],
  };
  const [title, tone, name] = states[status] ?? states.unverified;
  return `<span class="gate-pill ${tone}">${icon(name, "", 14)}${e(title)}</span>`;
}

export function notice(message, tone = "info", name = "info") {
  return `<div class="notice ${tone}">${icon(name, "", 16)}<span>${e(message)}</span></div>`;
}

export function hashLabel(value, label = "SHA-256") {
  return `<span class="hash-label" title="${e(value ?? "Недоступно")}">${e(label)} <code>${e(value ? value.slice(0, 12) : "—")}</code></span>`;
}

export function selectableTabs(items, active, action, className = "") {
  return `<div class="segmented-tabs ${className}" role="tablist">${items.map((item) => `<button role="tab" aria-selected="${item.id === active}" class="${item.id === active ? "active" : ""}" data-action="${e(action)}" data-id="${e(item.id)}">${item.icon ? icon(item.icon, "", 14) : ""}${e(item.label)}${item.count != null ? `<small>${e(item.count)}</small>` : ""}</button>`).join("")}</div>`;
}

export function codeChip(text) {
  return `<code class="code-chip">${e(text)}</code>`;
}

export function resultLabel(result) {
  if (!result) return badge("Не выполнялось");
  return result.passed
    ? badge("PASS", "success", "check")
    : badge("FAIL", "danger", "close");
}

export function keyValueRows(rows) {
  return `<dl class="key-value-list">${rows.map(([key, value]) => `<div><dt>${e(key)}</dt><dd>${e(value)}</dd></div>`).join("")}</dl>`;
}

export function searchField(id, placeholder, value = "") {
  return `<label class="search-field">${icon("search", "", 15)}<input id="${e(id)}" type="search" placeholder="${e(placeholder)}" value="${e(value)}" aria-label="${e(placeholder)}"></label>`;
}
