import { delay } from "./core.mjs";

export class ApiError extends Error {
  constructor(message, status = 0, code = "REQUEST_FAILED") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export class StudioClient {
  constructor(base = "/api") {
    this.base = base;
    this.online = false;
    this.environment = null;
    this.controllers = new Map();
  }

  async request(route, data, { signal, timeout = 20000 } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort("timeout"), timeout);
    const abort = () => controller.abort(signal.reason);
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const response = await fetch(this.base + route, {
        method: data === undefined ? "GET" : "POST",
        headers:
          data === undefined ? {} : { "Content-Type": "application/json" },
        body: data === undefined ? undefined : JSON.stringify(data),
        signal: controller.signal,
      });
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json"))
        throw new ApiError(
          "JVM-сервер недоступен. Запустите локальную версию.",
          response.status,
          "NO_BACKEND",
        );
      const result = await response.json();
      if (!response.ok)
        throw new ApiError(
          result.error ?? `HTTP ${response.status}`,
          response.status,
        );
      return result;
    } catch (error) {
      if (controller.signal.aborted)
        throw new ApiError(
          "Запрос отменён или истекло время ожидания.",
          0,
          "ABORTED",
        );
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }

  async connect() {
    try {
      const health = await this.request("/health", undefined, {
        timeout: 1800,
      });
      const capabilities = await this.request("/capabilities", undefined, {
        timeout: 2500,
      });
      this.online = health.status === "ok";
      this.environment = capabilities.environment;
      return { ...health, ...capabilities };
    } catch {
      this.online = false;
      return null;
    }
  }

  analyze(files, signal) {
    return this.request("/project", { files }, { signal, timeout: 45000 });
  }

  detail(source, methodId, signal) {
    return this.request("/method", { source, methodId }, { signal });
  }

  plans(source) {
    return this.request("/plans", { source });
  }

  applyPlans(source, sourceHash, planIds) {
    return this.request("/plans/apply", { source, sourceHash, planIds });
  }

  edit(source, methodId, nodeId, action, code) {
    return this.request("/edit", { source, methodId, nodeId, action, code });
  }

  extract(files, fileName, methodId) {
    return this.request(
      "/extract",
      { files, fileName, methodId },
      { timeout: 45000 },
    );
  }

  generate(options) {
    return this.request("/inputs/generate", options);
  }

  /** Polls a server job; gives up (and cancels it) after `limitMs`, so the interface never waits forever. */
  async startJob(kind, request, onUpdate, { limitMs = kind === "run" ? 90_000 : 600_000 } = {}) {
    const submitted = await this.request("/jobs/submit", { kind, ...request });
    const controller = new AbortController();
    this.controllers.set(submitted.id, controller);
    onUpdate?.(submitted);
    const started = Date.now();
    try {
      let job = submitted;
      while (["queued", "running"].includes(job.state)) {
        if (Date.now() - started > limitMs) {
          this.request("/jobs/cancel", { id: submitted.id }).catch(() => {});
          throw new ApiError(
            `Сервер не ответил за ${Math.round(limitMs / 1000)} с: задание остановлено. Если это повторяется, перезапустите сервер и сообщите о проблеме.`,
            0,
            "TIMEOUT",
          );
        }
        await delay(650, controller.signal);
        job = await this.request(
          `/jobs/${encodeURIComponent(submitted.id)}`,
          undefined,
          {
            signal: controller.signal,
            timeout: 12000,
          },
        );
        onUpdate?.(job);
      }
      if (job.state === "failed")
        throw new ApiError(job.error ?? "Ошибка фонового задания");
      if (job.state === "cancelled")
        throw new ApiError("Задание отменено", 0, "CANCELLED");
      return job;
    } finally {
      this.controllers.delete(submitted.id);
    }
  }

  async cancelJob(id) {
    const result = await this.request("/jobs/cancel", { id });
    this.controllers.get(id)?.abort();
    return result;
  }

  evidence(original, candidate, jobId) {
    return this.request("/evidence", {
      original,
      candidate,
      ...(jobId ? { jobId } : {}),
    });
  }

  sarif(files) {
    return this.request("/sarif", { files }, { timeout: 45000 });
  }
}
