/** Small shared utilities. No framework runtime or remote scripts are required. */
export function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );
}

export function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function stableFiles(files) {
  return JSON.stringify(
    Object.keys(files)
      .sort()
      .map((name) => [name, files[name]]),
  );
}

export async function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

export function debounce(callback, milliseconds = 600) {
  let timer;
  function scheduled(...arguments_) {
    clearTimeout(timer);
    timer = setTimeout(() => callback(...arguments_), milliseconds);
  }
  scheduled.cancel = () => clearTimeout(timer);
  return scheduled;
}

export function delay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted)
      return reject(new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

export function uniqueId(prefix = "id") {
  const random =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}

export function formatInteger(value) {
  return new Intl.NumberFormat("ru-RU").format(Number(value || 0));
}

export function shorten(value, length = 12) {
  const text = String(value ?? "");
  return text.length > length ? text.slice(0, length) + "…" : text;
}

export function relativeTime(timestamp, now = Date.now()) {
  const seconds = Math.max(
    0,
    Math.floor((now - new Date(timestamp).getTime()) / 1000),
  );
  if (seconds < 5) return "только что";
  if (seconds < 60) return `${seconds} с назад`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} мин назад`;
  return new Date(timestamp).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function downloadFile(name, content, type = "application/octet-stream") {
  const blob =
    content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function findClosestAction(event) {
  return event.target instanceof Element
    ? event.target.closest("[data-action]")
    : null;
}

export function validateFileName(name) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*\.java$/.test(name);
}

export function getSelectedInputs(cases) {
  return cases
    .filter((item) => item.enabled !== false)
    .map((item) => item.input);
}

export class EventBus {
  #listeners = new Map();

  on(event, listener) {
    const listeners = this.#listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(event, listeners);
    return () => listeners.delete(listener);
  }

  emit(event, detail) {
    for (const listener of this.#listeners.get(event) ?? []) listener(detail);
    for (const listener of this.#listeners.get("*") ?? [])
      listener({ event, detail });
  }

  clear() {
    this.#listeners.clear();
  }
}
