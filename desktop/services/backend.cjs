"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function locateEngine(appDirectory) {
  const packaged = path.join(appDirectory, "engine");
  try {
    await fs.access(path.join(packaged, "runtime", "bin", "java.exe"));
    return { root: packaged, javaHome: path.join(packaged, "runtime") };
  } catch {}
  const root = path.resolve(appDirectory, "..");
  const candidates = await fs.readdir(path.join(root, ".runtime"));
  const jdk = candidates.find((name) => name.startsWith("jdk-"));
  if (!jdk)
    throw new Error("Java runtime отсутствует. Выполните desktop/build.ps1.");
  return { root, javaHome: path.join(root, ".runtime", jdk) };
}

class Backend {
  constructor(engine) {
    this.engine = engine;
    this.process = null;
    this.output = "";
    this.url = null;
  }

  async start() {
    const port = await freePort();
    this.url = `http://127.0.0.1:${port}`;
    this.process = spawn(
      path.join(this.engine.javaHome, "bin", "java.exe"),
      ["-Xmx512m", "-Dfile.encoding=UTF-8", "-cp", "build", "BlueprintServer"],
      {
        cwd: this.engine.root,
        windowsHide: true,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          PORT: String(port),
          BIND_HOST: "127.0.0.1",
          BLUEPRINTS_RUNNER: "local",
          JAVA_HOME: this.engine.javaHome,
          JAVA_TOOL_OPTIONS: "",
          JDK_JAVA_OPTIONS: "",
          _JAVA_OPTIONS: "",
        },
      },
    );
    let failure = null;
    this.process.on("error", (error) => {
      failure = error;
    });
    for (const stream of [this.process.stdout, this.process.stderr])
      stream.on("data", (bytes) => {
        this.output = (this.output + bytes.toString("utf8")).slice(-16000);
      });
    this.process.on("exit", (code) => {
      failure = new Error(`Java service exited (${code}). ${this.output}`);
    });
    for (let attempt = 0; attempt < 120; attempt++) {
      if (failure) throw failure;
      try {
        const response = await fetch(this.url + "/api/health", {
          signal: AbortSignal.timeout(700),
        });
        if (response.ok && (await response.json()).status === "ok")
          return { url: this.url };
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    this.stop();
    throw new Error("Java service did not become ready. " + this.output);
  }

  stop() {
    this.process?.kill();
    this.process = null;
  }
}

module.exports = { Backend, locateEngine, freePort };
