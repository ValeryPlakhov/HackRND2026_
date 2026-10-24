import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;

/** Each version gets a separate class directory and JVM. No code runs in the server JVM. */
public final class Runner {
  static final int OUTPUT_LIMIT = 64 * 1024;
  static final long RUN_TIMEOUT_MS = 5000;
  static final int MAX_FILES = 300;
  static final Semaphore SLOTS = new Semaphore(2);
  static final String MODE = System.getenv().getOrDefault("BLUEPRINTS_RUNNER", "disabled");
  /** Entry point requested by the IDE run configuration; empty means the first main found. */
  private static final ThreadLocal<String> MAIN = ThreadLocal.withInitial(() -> "");

  static record Build(Path directory, String mainClass, Map<String, Object> result)
      implements AutoCloseable {
    public void close() throws IOException {
      remove(directory);
    }
  }

  static <T> T withMain(String mainClass, Callable<T> work) throws Exception {
    String previous = MAIN.get();
    MAIN.set(mainClass == null ? "" : mainClass.trim());
    try {
      return work.call();
    } finally {
      MAIN.set(previous);
    }
  }

  /** Project-relative paths such as src/app/Main.java; no traversal, drives or empty segments. */
  static boolean validPath(String name) {
    if (!name.endsWith(".java") || name.length() > 400) return false;
    String[] parts = name.split("/", -1);
    for (int i = 0; i < parts.length; i++) {
      String part = parts[i];
      if (i == parts.length - 1) {
        if (!part.matches("[A-Za-z_$][A-Za-z0-9_$]*\\.java")) return false;
      } else if (!part.matches("[A-Za-z0-9_$][A-Za-z0-9_$.\\-]*") || part.equals("..")) return false;
    }
    return true;
  }

  static Map<String, String> sources(Object value) {
    if (!(value instanceof Map<?, ?> m) || m.isEmpty() || m.size() > MAX_FILES)
      throw new IllegalArgumentException("Нужны от 1 до " + MAX_FILES + " Java-файлов");
    Map<String, String> out = new LinkedHashMap<>();
    long total = 0;
    for (var e : m.entrySet()) {
      String name = String.valueOf(e.getKey());
      if (!validPath(name))
        throw new IllegalArgumentException("Недопустимый путь Java-файла: " + name);
      String code = String.valueOf(e.getValue());
      total += code.length();
      out.put(name, code);
    }
    if (total > 8_000_000) throw new IllegalArgumentException("Project too large");
    return out;
  }

  static String simpleName(String path) {
    return path.substring(path.lastIndexOf('/') + 1);
  }

  static Build compile(Map<String, String> files) throws Exception {
    Path root = Files.createTempDirectory("blueprints-");
    Path output = Files.createDirectory(root.resolve("classes"));
    Path sourceRoot = Files.createDirectory(root.resolve("src"));
    List<String> args =
        new ArrayList<>(
            List.of(
                executable("javac"),
                "-J-Xmx192m",
                "-proc:none",
                "-encoding",
                "UTF-8",
                "--release",
                "21",
                "-d",
                output.toString()));
    String main = "";
    List<String> mains = new ArrayList<>();
    List<String> sourceList = new ArrayList<>();
    try {
      for (var e : files.entrySet()) {
        Path p = sourceRoot.resolve(e.getKey()).normalize();
        if (!p.startsWith(sourceRoot)) throw new IllegalArgumentException("Path escapes project");
        Files.createDirectories(p.getParent());
        Files.writeString(p, e.getValue(), StandardCharsets.UTF_8);
        sourceList.add("\"" + p.toString().replace('\\', '/') + "\"");
        if (!e.getValue().contains("main") || e.getValue().length() > 250_000) continue;
        try (JavaModel m = new JavaModel(e.getValue())) {
          for (var method : m.methods)
            if (method.tree().getName().contentEquals("main")
                && method
                    .tree()
                    .getModifiers()
                    .getFlags()
                    .contains(javax.lang.model.element.Modifier.STATIC)
                && method
                    .tree()
                    .getModifiers()
                    .getFlags()
                    .contains(javax.lang.model.element.Modifier.PUBLIC)
                && method.tree().getReturnType() != null
                && method.tree().getReturnType().toString().equals("void")
                && method.tree().getParameters().size() == 1
                && Set.of("String[]", "java.lang.String[]")
                    .contains(method.tree().getParameters().get(0).getType().toString())) {
              String pkg = m.unit.getPackageName() == null ? "" : m.unit.getPackageName() + ".";
              mains.add(pkg + method.owner().replace('.', '$'));
            }
        }
      }
      String requested = MAIN.get();
      if (!requested.isEmpty())
        main =
            mains.stream()
                .filter(
                    name ->
                        name.equals(requested)
                            || name.endsWith("." + requested)
                            || name.equals(requested.replace('.', '$')))
                .findFirst()
                .orElse(mains.isEmpty() ? "" : mains.get(0));
      else if (!mains.isEmpty())
        main =
            mains.stream()
                .filter(name -> name.equals("Main") || name.endsWith(".Main"))
                .findFirst()
                .orElse(mains.get(0));
      // An argument file keeps large projects below the Windows command-line limit.
      Path list = root.resolve("sources.txt");
      Files.write(list, sourceList, StandardCharsets.UTF_8);
      args.add("@" + list);
      Map<String, Object> p = process(args, root, "", 30_000);
      boolean ok =
          ((Number) p.get("exitCode")).intValue() == 0
              && !Boolean.TRUE.equals(p.get("timedOut"))
              && !Boolean.TRUE.equals(p.get("outputLimit"));
      return new Build(
          root,
          main,
          Map.of(
              "success",
              ok,
              "diagnostics",
              p.get("stderr"),
              "stdout",
              p.get("stdout"),
              "timeMs",
              p.get("timeMs")));
    } catch (Exception e) {
      remove(root);
      throw e;
    }
  }

  static String executable(String name) {
    String ext = System.getProperty("os.name").toLowerCase().contains("win") ? ".exe" : "";
    return Path.of(System.getProperty("java.home"), "bin", name + ext).toString();
  }

  static Map<String, Object> compileOnly(Map<String, String> files) throws Exception {
    try (Build b = compile(files)) {
      return b.result;
    }
  }

  static Map<String, Object> run(Build b, String input) throws Exception {
    if (!Boolean.TRUE.equals(b.result.get("success")))
      throw new IllegalArgumentException("Compilation failed");
    if (b.mainClass.isEmpty())
      throw new IllegalArgumentException("public static void main(String[] args) not found");
    if (!MODE.equals("local") && !MODE.equals("docker"))
      throw new IllegalArgumentException(
          "Запуск отключён. Используйте start.ps1 -TrustedLocal для своих файлов или"
              + " BLUEPRINTS_RUNNER=docker.");
    List<String> cmd;
    if (MODE.equals("docker")) {
      // --rm + explicit cleanup covers a killed docker CLI and timeout.
      String container = "bp-" + UUID.randomUUID();
      cmd =
          List.of(
              "docker",
              "run",
              "--name",
              container,
              "--rm",
              "-i",
              "--network=none",
              "--memory=192m",
              "--memory-swap=192m",
              "--cpus=0.5",
              "--pids-limit=32",
              "--read-only",
              "--cap-drop=ALL",
              "--security-opt=no-new-privileges",
              "--user=65534:65534",
              "--tmpfs",
              "/tmp:rw,noexec,nosuid,size=16m",
              "-v",
              b.directory.resolve("classes").toAbsolutePath() + ":/app:ro",
              "eclipse-temurin:21-jre",
              "java",
              "-Xmx96m",
              "-Xss512k",
              "-Dfile.encoding=UTF-8",
              "-cp",
              "/app",
              b.mainClass);
      try {
        return process(cmd, b.directory, input, 7000);
      } finally {
        try {
          Process clean = new ProcessBuilder("docker", "rm", "-f", container).start();
          clean.waitFor(3, TimeUnit.SECONDS);
          clean.destroyForcibly();
        } catch (IOException ignored) {
        }
      }
    }
    cmd =
        List.of(
            executable("java"),
            "-Xmx96m",
            "-Xss512k",
            "-Dfile.encoding=UTF-8",
            "-Dstdout.encoding=UTF-8",
            "-Dstderr.encoding=UTF-8",
            "-Duser.language=en",
            "-Duser.country=US",
            "-cp",
            b.directory.resolve("classes").toString(),
            b.mainClass);
    return process(cmd, b.directory, input, RUN_TIMEOUT_MS);
  }

  static Map<String, Object> compare(
      Map<String, String> original, Map<String, String> candidate, List<String> inputs)
      throws Exception {
    if (inputs.isEmpty() || inputs.size() > 30)
      throw new IllegalArgumentException("Use 1..30 input cases");
    for (String s : inputs)
      if (s.length() > 32_768) throw new IllegalArgumentException("Input too large");
    if (!SLOTS.tryAcquire()) throw new IllegalArgumentException("Runner занят, повторите позже");
    try (Build a = compile(original);
        Build b = compile(candidate)) {
      Map<String, Object> out = new LinkedHashMap<>();
      out.put("baselineBuild", a.result);
      out.put("candidateBuild", b.result);
      List<Object> tests = new ArrayList<>();
      boolean pass =
          Boolean.TRUE.equals(a.result.get("success"))
              && Boolean.TRUE.equals(b.result.get("success"));
      if (pass)
        for (int i = 0; i < inputs.size(); i++) {
          var x = run(a, inputs.get(i));
          var y = run(b, inputs.get(i));
          boolean same =
              Objects.equals(x.get("stdoutSha256"), y.get("stdoutSha256"))
                  && Objects.equals(x.get("stderrSha256"), y.get("stderrSha256"))
                  && Objects.equals(x.get("exitCode"), y.get("exitCode"))
                  && !Boolean.TRUE.equals(x.get("timedOut"))
                  && !Boolean.TRUE.equals(y.get("timedOut"))
                  && !Boolean.TRUE.equals(x.get("outputLimit"))
                  && !Boolean.TRUE.equals(y.get("outputLimit"));
          pass &= same;
          tests.add(
              Map.of(
                  "name",
                  "Вход " + (i + 1),
                  "input",
                  inputs.get(i),
                  "passed",
                  same,
                  "baseline",
                  x,
                  "candidate",
                  y));
        }
      out.put("passed", pass);
      out.put("tests", tests);
      out.put("runner", MODE);
      out.put(
          "contract",
          "Exact UTF-8 stdout + stderr + exitCode. Timeout/output overflow always fail. Finite"
              + " tests are evidence, not a proof for all inputs.");
      return out;
    } finally {
      SLOTS.release();
    }
  }

  static Map<String, Object> process(List<String> args, Path cwd, String input, long timeout)
      throws Exception {
    long start = System.nanoTime();
    ProcessBuilder pb = new ProcessBuilder(args).directory(cwd.toFile());
    // Do not leak tokens, Java agents, or user classpaths to submitted programs.
    String path = System.getenv("PATH"), systemRoot = System.getenv("SystemRoot");
    pb.environment().clear();
    if (path != null) pb.environment().put("PATH", path);
    if (systemRoot != null) pb.environment().put("SystemRoot", systemRoot);
    pb.environment().put("LANG", "C.UTF-8");
    Process p = pb.start();
    Capture out = new Capture(p.getInputStream(), p), err = new Capture(p.getErrorStream(), p);
    Thread a = Thread.ofPlatform().daemon().start(out), b = Thread.ofPlatform().daemon().start(err);
    Thread writer =
        Thread.ofPlatform()
            .daemon()
            .start(
                () -> {
                  try (OutputStream os = p.getOutputStream()) {
                    os.write(input.getBytes(StandardCharsets.UTF_8));
                  } catch (IOException ignored) {
                  }
                });
    boolean done;
    try {
      done = p.waitFor(timeout, TimeUnit.MILLISECONDS);
    } catch (InterruptedException interrupted) {
      p.descendants().forEach(ProcessHandle::destroyForcibly);
      p.destroyForcibly();
      a.interrupt();
      b.interrupt();
      writer.interrupt();
      try {
        p.waitFor(1, TimeUnit.SECONDS);
      } catch (InterruptedException ignored) {
      }
      throw interrupted;
    }
    if (!done) {
      p.descendants().forEach(ProcessHandle::destroyForcibly);
      p.destroyForcibly();
      p.waitFor(1, TimeUnit.SECONDS);
    }
    a.join(1000);
    b.join(1000);
    writer.join(100);
    return Map.of(
        "stdout",
        out.text(),
        "stderr",
        err.text(),
        "stdoutSha256",
        digest(out.bytes()),
        "stderrSha256",
        digest(err.bytes()),
        "exitCode",
        done ? p.exitValue() : -1,
        "timedOut",
        !done,
        "outputLimit",
        out.overflow || err.overflow,
        "timeMs",
        (System.nanoTime() - start) / 1_000_000);
  }

  static final class Capture implements Runnable {
    final InputStream in;
    final Process process;
    final ByteArrayOutputStream buffer = new ByteArrayOutputStream();
    volatile boolean overflow;

    Capture(InputStream in, Process p) {
      this.in = in;
      process = p;
    }

    public void run() {
      try (in) {
        byte[] bytes = new byte[4096];
        int n;
        while ((n = in.read(bytes)) != -1) {
          int keep = Math.min(n, OUTPUT_LIMIT - buffer.size());
          synchronized (buffer) {
            if (keep > 0) buffer.write(bytes, 0, keep);
          }
          if (keep < n) {
            overflow = true;
            process.descendants().forEach(ProcessHandle::destroyForcibly);
            process.destroyForcibly();
            break;
          }
        }
      } catch (IOException ignored) {
      }
    }

    String text() {
      synchronized (buffer) {
        return buffer.toString(StandardCharsets.UTF_8);
      }
    }

    byte[] bytes() {
      synchronized (buffer) {
        return buffer.toByteArray();
      }
    }
  }

  static String digest(byte[] bytes) throws Exception {
    return HexFormat.of()
        .formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(bytes));
  }

  static void remove(Path root) throws IOException {
    if (root == null || !Files.exists(root)) return;
    try (var paths = Files.walk(root)) {
      for (Path p : paths.sorted(Comparator.reverseOrder()).toList()) Files.deleteIfExists(p);
    }
  }
}
