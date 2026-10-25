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
  /** File open in the editor when the user pressed Run: its methods are preferred as entry points. */
  private static final ThreadLocal<String> ENTRY = ThreadLocal.withInitial(() -> "");
  /** Generated class that calls the chosen method when the project has no main(String[]). */
  static final String LAUNCHER = "BlueprintsRun__";

  static record Build(Path directory, String mainClass, Map<String, Object> result)
      implements AutoCloseable {
    public void close() throws IOException {
      remove(directory);
    }
  }

  /** {@code spec} is a class name, optionally followed by a line "@path/File.java" naming the open file. */
  static <T> T withMain(String spec, Callable<T> work) throws Exception {
    String previous = MAIN.get();
    String previousEntry = ENTRY.get();
    String value = spec == null ? "" : spec;
    int at = value.indexOf("\n@");
    MAIN.set((at < 0 ? value : value.substring(0, at)).trim());
    ENTRY.set(at < 0 ? "" : value.substring(at + 2).trim());
    try {
      return work.call();
    } finally {
      MAIN.set(previous);
      ENTRY.set(previousEntry);
    }
  }

  private static final java.util.regex.Pattern TYPE =
      java.util.regex.Pattern.compile("\\b(class|interface|enum|record)\\s+[A-Za-z_$]");
  private static final java.util.regex.Pattern METHOD =
      java.util.regex.Pattern.compile(
          "(?m)^\\s*(?:(?:public|private|protected|static|final|synchronized)\\s+)*[\\w<>\\[\\],.? ]+\\s+[A-Za-z_$][\\w$]*\\s*\\([^;{]*\\)\\s*(?:throws [\\w., ]+)?\\{");

  /**
   * Strips comments, string, text-block and char literals so that words inside them are not taken
   * for code. A single linear pass: regular expressions with alternation recurse per character and
   * overflow the stack on long literals.
   */
  static String codeOnly(String source) {
    StringBuilder out = new StringBuilder(source.length());
    int n = source.length();
    for (int i = 0; i < n; ) {
      char c = source.charAt(i);
      char next = i + 1 < n ? source.charAt(i + 1) : 0;
      if (c == '/' && next == '/') {
        while (i < n && source.charAt(i) != '\n') i++;
        out.append(' ');
      } else if (c == '/' && next == '*') {
        int close = source.indexOf("*/", i + 2);
        i = close < 0 ? n : close + 2;
        out.append(' ');
      } else if (c == '"' && source.startsWith("\"\"\"", i)) {
        int j = i + 3;
        while (j < n && !source.startsWith("\"\"\"", j)) j += source.charAt(j) == '\\' ? 2 : 1;
        i = Math.min(n, j + 3);
        out.append("\"\"");
      } else if (c == '"' || c == '\'') {
        int j = i + 1;
        while (j < n && source.charAt(j) != c && source.charAt(j) != '\n') j += source.charAt(j) == '\\' ? 2 : 1;
        i = Math.min(n, j + 1);
        out.append(c).append(c);
      } else {
        out.append(c);
        i++;
      }
    }
    return out.toString();
  }

  /**
   * A file without any class can still be run: statements become the body of main, a set of
   * methods becomes a class. The wrapper is added on existing lines, so line numbers do not move.
   */
  static String wrapLoose(String path, String source) {
    String code = codeOnly(source);
    if (TYPE.matcher(code).find() || code.isBlank()) return source;
    String name = simpleName(path).replace(".java", "");
    String[] lines = source.split("\n", -1);
    int first = 0;
    while (first < lines.length
        && (lines[first].isBlank()
            || lines[first].trim().startsWith("import ")
            || lines[first].trim().startsWith("package ")
            || lines[first].trim().startsWith("//")))
      first++;
    if (first == lines.length) return source;
    boolean methods = METHOD.matcher(code).find();
    String open =
        methods
            ? "public class " + name + " { "
            : "public class " + name + " { public static void main(String[] args) throws Exception { ";
    lines[first] = open + lines[first];
    lines[lines.length - 1] = lines[lines.length - 1] + (methods ? "\n}" : "\n} }");
    return String.join("\n", lines);
  }

  record Candidate(String file, String type, String name, boolean isStatic, boolean args, boolean topLevel) {
    String label() {
      return type.replace('$', '.') + "." + name + "()";
    }

    String key() {
      return type + "#" + name;
    }
  }

  /** Methods every object has: never offered as a program to run. */
  static final Set<String> OBJECT_METHODS =
      Set.of("hashCode", "toString", "getClass", "clone", "finalize", "notify", "notifyAll", "wait");

  /** Marks which classes can be created with no arguments (named as JavaModel names owners). */
  static void creatable(com.sun.source.tree.ClassTree type, String parent, Map<String, Boolean> out) {
    String name = parent.isEmpty() ? type.getSimpleName().toString() : parent + "." + type.getSimpleName();
    var flags = type.getModifiers().getFlags();
    boolean anyConstructor = false, noArgConstructor = false;
    for (var member : type.getMembers()) {
      if (member instanceof com.sun.source.tree.MethodTree constructor && constructor.getName().contentEquals("<init>")) {
        anyConstructor = true;
        if (constructor.getParameters().isEmpty()) noArgConstructor = true;
      }
      if (member instanceof com.sun.source.tree.ClassTree inner) creatable(inner, name, out);
    }
    out.put(
        name,
        type.getKind() == com.sun.source.tree.Tree.Kind.CLASS
            && !flags.contains(javax.lang.model.element.Modifier.ABSTRACT)
            && (parent.isEmpty() || flags.contains(javax.lang.model.element.Modifier.STATIC))
            && (!anyConstructor || noArgConstructor));
  }

  static String launcher(Candidate target) {
    return "public class " + LAUNCHER + " {\n"
        + "  public static void main(String[] args) throws Throwable {\n"
        + "    Class<?> type = Class.forName(\"" + target.type() + "\");\n"
        + "    java.lang.reflect.Method method = null;\n"
        + "    for (java.lang.reflect.Method m : type.getDeclaredMethods())\n"
        + "      if (m.getName().equals(\"" + target.name() + "\") && (m.getParameterCount() == 0"
        + " || (m.getParameterCount() == 1 && m.getParameterTypes()[0] == String[].class))) { method = m; break; }\n"
        + "    method.setAccessible(true);\n"
        + "    Object self = null;\n"
        + "    if (!java.lang.reflect.Modifier.isStatic(method.getModifiers())) {\n"
        + "      java.lang.reflect.Constructor<?> c = type.getDeclaredConstructor();\n"
        + "      c.setAccessible(true);\n"
        + "      self = c.newInstance();\n"
        + "    }\n"
        + "    Object result;\n"
        + "    try {\n"
        + "      result = method.getParameterCount() == 0 ? method.invoke(self) : method.invoke(self, (Object) args);\n"
        + "    } catch (java.lang.reflect.InvocationTargetException e) {\n"
        + "      throw e.getCause();\n"
        + "    }\n"
        + "    if (method.getReturnType() != void.class) System.out.println(result);\n"
        + "  }\n"
        + "}\n";
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
    List<Candidate> loose = new ArrayList<>();
    try {
      for (var original : files.entrySet()) {
        var e = Map.entry(original.getKey(), wrapLoose(original.getKey(), original.getValue()));
        Path p = sourceRoot.resolve(e.getKey()).normalize();
        if (!p.startsWith(sourceRoot)) throw new IllegalArgumentException("Path escapes project");
        Files.createDirectories(p.getParent());
        Files.writeString(p, e.getValue(), StandardCharsets.UTF_8);
        sourceList.add("\"" + p.toString().replace('\\', '/') + "\"");
        if (e.getValue().length() > 250_000) continue;
        try (JavaModel m = new JavaModel(e.getValue())) {
          if (!m.valid()) continue;
          String prefix = m.unit.getPackageName() == null ? "" : m.unit.getPackageName() + ".";
          Map<String, Boolean> creatable = new HashMap<>();
          for (var type : m.unit.getTypeDecls())
            if (type instanceof com.sun.source.tree.ClassTree declared) creatable(declared, "", creatable);
          for (var method : m.methods) {
            var tree = method.tree();
            var flags = tree.getModifiers().getFlags();
            boolean noArgs = tree.getParameters().isEmpty();
            boolean stringArgs =
                tree.getParameters().size() == 1
                    && Set.of("String[]", "java.lang.String[]", "String...")
                        .contains(tree.getParameters().get(0).getType().toString());
            boolean isStatic = flags.contains(javax.lang.model.element.Modifier.STATIC);
            String owner = method.owner();
            if (tree.getReturnType() == null || flags.contains(javax.lang.model.element.Modifier.ABSTRACT)
                || !(noArgs || (stringArgs && tree.getName().contentEquals("main")))
                || tree.getName().toString().startsWith("<")
                || OBJECT_METHODS.contains(tree.getName().toString())
                || owner.isEmpty() || owner.endsWith(".") || owner.contains("..")
                // An instance method needs an object: only classes that can be created without arguments.
                || (!isStatic && !creatable.getOrDefault(owner, false)))
              continue;
            loose.add(
                new Candidate(
                    e.getKey(),
                    prefix + method.owner().replace('.', '$'),
                    tree.getName().toString(),
                    flags.contains(javax.lang.model.element.Modifier.STATIC),
                    stringArgs,
                    !method.owner().contains(".")));
          }
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
      // An explicit entry point must exist and be unambiguous; without one, only an obvious choice
      // is taken. The reason is kept so that running (not compiling) reports it.
      String requested = MAIN.get();
      String mainError = "";
      Candidate chosen = null;
      if (requested.contains("#")) {
        chosen = loose.stream().filter(c -> c.key().equals(requested) || c.label().equals(requested)).findFirst().orElse(null);
        if (chosen == null) mainError = "Метод " + requested.replace('#', '.') + "() не найден или требует параметры.";
      } else if (!requested.isEmpty()) {
        List<String> matches =
            mains.stream()
                .filter(
                    name ->
                        name.equals(requested)
                            || name.equals(requested.replace('.', '$'))
                            || name.endsWith("." + requested))
                .toList();
        if (matches.size() == 1) main = matches.get(0);
        else if (matches.contains(requested)) main = requested;
        else
          mainError =
              (matches.isEmpty() ? "Класс с main не найден: " : "Неоднозначный main: ")
                  + requested + ". Доступны: " + (mains.isEmpty() ? "нет" : String.join(", ", mains));
      } else if (mains.size() == 1) main = mains.get(0);
      else if (!mains.isEmpty()) {
        List<String> named = mains.stream().filter(name -> name.equals("Main") || name.endsWith(".Main")).toList();
        if (named.size() == 1) main = named.get(0);
        else {
          String entryFile = ENTRY.get();
          List<String> inEntry =
              mains.stream()
                  .filter(name -> !entryFile.isEmpty() && entryFile.endsWith(name.substring(name.lastIndexOf('.') + 1).replaceAll("\\$.*", "") + ".java"))
                  .toList();
          if (inEntry.size() == 1) main = inEntry.get(0);
          else mainError = "Несколько классов с main: " + String.join(", ", mains) + ". Укажите главный класс в параметрах запуска.";
        }
      }
      // No main(String[]): run what the user clearly means — a main of another shape, or a method
      // without parameters, preferring the file open in the editor. A small generated class calls it.
      String entryPoint = main.isEmpty() ? "" : main + ".main";
      // A requested class without main(String[]) still runs its own method; another class never does.
      List<Candidate> pool =
          requested.isEmpty()
              ? loose
              : loose.stream()
                  .filter(c -> c.type().equals(requested) || c.type().equals(requested.replace('.', '$'))
                      || c.type().endsWith("." + requested) || c.type().endsWith("$" + requested))
                  .toList();
      String entryFile = ENTRY.get();
      Comparator<Candidate> order =
          Comparator.comparing((Candidate c) -> !c.file().equals(entryFile))
              .thenComparing(c -> !c.topLevel())
              .thenComparing(c -> !c.name().equals("main"))
              .thenComparing(c -> !Set.of("run", "start", "execute", "solve", "demo").contains(c.name()))
              .thenComparing(Candidate::label);
      List<String> choices = loose.stream().sorted(order).limit(40).map(c -> c.key()).toList();
      if (main.isEmpty() && chosen == null && (requested.isEmpty() ? mainError.isEmpty() : !pool.isEmpty() && mains.isEmpty() && !requested.contains("#"))) {
        mainError = "";
        // Only an obvious choice is taken by itself: another shape of main, or a run()/start()-like
        // method, or the only method without parameters of the open file's class. A library's getter
        // is never run behind the user's back — the console offers the list instead.
        List<Candidate> obvious =
            pool.stream()
                .filter(c -> c.name().equals("main")
                    || (c.topLevel() && Set.of("run", "start", "execute", "solve", "demo").contains(c.name())))
                .sorted(order)
                .toList();
        List<Candidate> openClass =
            pool.stream().filter(c -> c.topLevel() && c.file().equals(entryFile)).toList();
        chosen = !obvious.isEmpty() ? obvious.get(0) : openClass.size() == 1 ? openClass.get(0) : pool.size() == 1 ? pool.get(0) : null;
        if (chosen == null)
          mainError =
              loose.isEmpty()
                  ? "Нечего запускать: нет ни main, ни метода без параметров. Добавьте метод без параметров (например, void run()) или напишите инструкции прямо в файле."
                  : "В проекте нет main — похоже, это библиотека. Выберите метод для запуска или создайте файл запуска.";
      }
      if (chosen != null) {
        Path generated = sourceRoot.resolve(LAUNCHER + ".java");
        Files.writeString(generated, launcher(chosen), StandardCharsets.UTF_8);
        sourceList.add("\"" + generated.toString().replace('\\', '/') + "\"");
        main = LAUNCHER;
        mainError = "";
        entryPoint = chosen.label();
      }
      // An argument file keeps large projects below the Windows command-line limit.
      Path list = root.resolve("sources.txt");
      Files.write(list, sourceList, StandardCharsets.UTF_8);
      args.add("@" + list);
      Map<String, Object> p = new LinkedHashMap<>(process(args, root, "", 30_000));
      String prefix = sourceRoot.toString();
      p.put(
          "stderr",
          String.valueOf(p.get("stderr"))
              .replace(prefix + java.io.File.separator, "")
              .replace(prefix.replace('\\', '/') + "/", "")
              .replace(prefix, ""));
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
              p.get("timeMs"),
              "mainClass",
              main,
              "entryPoint",
              entryPoint,
              "entryCandidates",
              choices,
              "mainError",
              mainError));
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
      throw new IllegalArgumentException(
          String.valueOf(b.result.getOrDefault("mainError", "")).isEmpty()
              ? "Нечего запускать: нет ни main, ни метода без параметров"
              : String.valueOf(b.result.get("mainError")));
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
        Map<String, Object> outcome = new LinkedHashMap<>(process(cmd, b.directory, input, 7000));
        // docker run reports its own failures as 125-127; the program never started then.
        int code = ((Number) outcome.get("exitCode")).intValue();
        boolean infrastructure = code == 125 || code == 126 || code == 127;
        outcome.put("started", !infrastructure);
        outcome.put("infrastructureError", infrastructure);
        return outcome;
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
            "-Djava.awt.headless=true",
            "-cp",
            b.directory.resolve("classes").toString(),
            b.mainClass);
    Map<String, Object> outcome = new LinkedHashMap<>(process(cmd, b.directory, input, RUN_TIMEOUT_MS));
    outcome.put("started", true);
    outcome.put("infrastructureError", false);
    return outcome;
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
      boolean inconclusive = false;
      if (pass)
        for (int i = 0; i < inputs.size(); i++) {
          var x = run(a, inputs.get(i));
          var y = run(b, inputs.get(i));
          boolean same = sameBehavior(x, y);
          inconclusive |= Boolean.TRUE.equals(x.get("infrastructureError")) || Boolean.TRUE.equals(y.get("infrastructureError"));
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
      out.put("passed", pass && !inconclusive);
      out.put("inconclusive", inconclusive);
      out.put("mainClass", a.mainClass);
      out.put("comparison", COMPARISON_POLICY);
      out.put("tests", tests);
      out.put("runner", MODE);
      out.put(
          "contract",
          "Exact UTF-8 stdout + exitCode; stderr without stack-frame lines (source line numbers"
              + " move during refactoring). Timeout/output overflow always fail. Finite tests are"
              + " evidence, not a proof for all inputs.");
      return out;
    } finally {
      SLOTS.release();
    }
  }

  static final String COMPARISON_POLICY =
      "stdout: exact bytes; stderr: exact bytes including line endings, except JVM stack-frame"
          + " lines (TAB at pkg.Class.method(File.java:N) and TAB ... N more), whose line numbers move"
          + " in refactoring; exit code; both runs must start and finish within limits";

  private static final java.util.regex.Pattern FRAME =
      java.util.regex.Pattern.compile(
          "\\tat [^\\s()]+\\((?:[^()\\r\\n]+\\.java:\\d+|[^()\\r\\n]+\\.java|Native Method|Unknown Source)\\)(?:\\r?\\n)?"
              + "|\\t\\.\\.\\. \\d+ (?:more|common frames omitted)(?:\\r?\\n)?");

  /** Raw stderr bytes with only genuine JVM frame lines removed; line endings are preserved. */
  static String stderrSignature(byte[] bytes) throws Exception {
    String latin = new String(bytes, StandardCharsets.ISO_8859_1);
    StringBuilder kept = new StringBuilder();
    java.util.regex.Matcher lines = java.util.regex.Pattern.compile("[^\n]*(?:\n|$)").matcher(latin);
    while (lines.find()) {
      String line = lines.group();
      if (line.isEmpty()) continue;
      if (!FRAME.matcher(line).matches()) kept.append(line);
    }
    return digest(kept.toString().getBytes(StandardCharsets.ISO_8859_1));
  }

  static boolean sameBehavior(Map<String, Object> x, Map<String, Object> y) {
    return Boolean.TRUE.equals(x.getOrDefault("started", true))
        && Boolean.TRUE.equals(y.getOrDefault("started", true))
        && Objects.equals(x.get("stdoutSha256"), y.get("stdoutSha256"))
        && Objects.equals(x.get("stderrSignature"), y.get("stderrSignature"))
        && Objects.equals(x.get("exitCode"), y.get("exitCode"))
        && !Boolean.TRUE.equals(x.get("timedOut"))
        && !Boolean.TRUE.equals(y.get("timedOut"))
        && !Boolean.TRUE.equals(x.get("outputLimit"))
        && !Boolean.TRUE.equals(y.get("outputLimit"));
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
        "stderrSignature",
        stderrSignature(err.bytes()),
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
