import com.sun.net.httpserver.HttpExchange;
import java.util.*;

/** Version-two endpoints, kept separate from the stable v1 compiler and editor API. */
public final class StudioApi {
  static final JobService JOBS = new JobService();
  private static final Set<String> POSTS =
      Set.of(
          "/api/project",
          "/api/method",
          "/api/plans",
          "/api/plans/apply",
          "/api/inputs/generate",
          "/api/mutants",
          "/api/jobs/submit",
          "/api/jobs/cancel",
          "/api/evidence",
          "/api/sarif");

  static boolean supports(String route) {
    return POSTS.contains(route);
  }

  static boolean read(HttpExchange exchange) throws Exception {
    if (!exchange.getRequestMethod().equals("GET")) return false;
    String route = exchange.getRequestURI().getPath();
    if (route.equals("/api/capabilities")) {
      BlueprintServer.reply(
          exchange,
          200,
          Digests.map(
              "version",
              "2.0.0",
              "features",
              List.of(
                  "ast",
                  "structured-graph",
                  "project-callgraph",
                  "data-flow",
                  "refactor-plans",
                  "differential-testing",
                  "seeded-inputs",
                  "mutation-testing",
                  "counterexample-reduction",
                  "method-benchmark",
                  "sarif",
                  "evidence-manifest",
                  "cancellable-jobs"),
              "environment",
              Evidence.environment(),
              "rules",
              RuleCatalog.catalog().size() + 5));
      return true;
    }
    if (route.startsWith("/api/examples/")) {
      BlueprintServer.reply(exchange, 200, example(route.substring("/api/examples/".length())));
      return true;
    }
    if (route.equals("/api/rules")) {
      BlueprintServer.reply(exchange, 200, Map.of("rules", RuleCatalog.catalog()));
      return true;
    }
    if (route.equals("/api/jobs")) {
      BlueprintServer.reply(exchange, 200, Map.of("jobs", JOBS.list()));
      return true;
    }
    if (route.startsWith("/api/jobs/")) {
      BlueprintServer.reply(exchange, 200, JOBS.get(route.substring("/api/jobs/".length())));
      return true;
    }
    return false;
  }

  static Object post(String route, Map<String, Object> request) throws Exception {
    return switch (route) {
      case "/api/project" -> new ProjectAnalysis(Runner.sources(request.get("files"))).describe();
      case "/api/method" -> method(request);
      case "/api/plans" -> RefactorPlans.preview(Json.str(request, "source", ""));
      case "/api/plans/apply" ->
          RefactorPlans.apply(
              Json.str(request, "source", ""),
              Json.str(request, "sourceHash", ""),
              strings(request.get("planIds"), 24));
      case "/api/inputs/generate" -> InputCases.generate(request);
      case "/api/mutants" ->
          MutationLab.proposals(Json.str(request, "source", ""), Json.str(request, "methodId", ""));
      case "/api/jobs/submit" -> submit(request);
      case "/api/jobs/cancel" -> JOBS.cancel(Json.str(request, "id", ""));
      case "/api/evidence" ->
          Evidence.bundle(
              Runner.sources(request.get("original")),
              Runner.sources(request.get("candidate")),
              request.containsKey("jobId") ? JOBS.get(Json.str(request, "jobId", "")) : null);
      case "/api/sarif" ->
          Evidence.sarif(new ProjectAnalysis(Runner.sources(request.get("files"))).describe());
      default -> throw new IllegalArgumentException("Unknown studio API route");
    };
  }

  private static Map<String, Object> method(Map<String, Object> request) throws Exception {
    try (JavaModel model = new JavaModel(Json.str(request, "source", ""))) {
      JavaModel.Method method = model.method(Json.str(request, "methodId", ""));
      Map<String, Object> graph = new GraphBuilder(model).build(method);
      return Digests.map(
          "sourceHash",
          Digests.sha256(model.source),
          "methodId",
          method.id(),
          "graph",
          graph,
          "graphAnalysis",
          new GraphAnalysis(graph).describe(),
          "complexity",
          new ComplexityAnalysis(model, method).describe(),
          "dataFlow",
          new DataFlowAnalysis(model, method).describe());
    }
  }

  private static Map<String, Object> submit(Map<String, Object> request) {
    String kind = Json.str(request, "kind", "compare");
    Map<String, String> original =
        request.containsKey("original") ? Runner.sources(request.get("original")) : null;
    Map<String, String> candidate =
        request.containsKey("candidate") ? Runner.sources(request.get("candidate")) : null;
    Map<String, String> files =
        request.containsKey("files") ? Runner.sources(request.get("files")) : null;
    List<String> inputs =
        request.containsKey("inputs") ? strings(request.get("inputs"), 30) : List.of();
    String mainClass = Json.str(request, "mainClass", "");
    if (mainClass.length() > 300) throw new IllegalArgumentException("Слишком длинное имя класса");
    return submit(kind, request, original, candidate, files, inputs, mainClass);
  }

  private static Map<String, Object> submit(
      String kind,
      Map<String, Object> request,
      Map<String, String> original,
      Map<String, String> candidate,
      Map<String, String> files,
      List<String> inputs,
      String mainClass) {
    return switch (kind) {
      case "run" -> {
        if (files == null) throw new IllegalArgumentException("Нужны файлы программы");
        String input = Json.str(request, "input", "");
        if (input.length() > 32768) throw new IllegalArgumentException("Слишком длинные ответы");
        yield JOBS.submit(kind, withMain(mainClass, context -> VisualExecution.run(files, input, context)));
      }
      case "compare" -> {
        if (original == null || candidate == null)
          throw new IllegalArgumentException("Нужны обе версии проекта");
        yield JOBS.submit(
            kind,
            withMain(
            mainClass,
            context -> {
              context.stage("Компиляция и дифференциальные запуски", 0, 1);
              return Evidence.report(
                  original, candidate, inputs, Runner.compare(original, candidate, inputs));
            }));
      }
      case "mutation" -> {
        if (files == null) throw new IllegalArgumentException("Нужны файлы проекта");
        yield JOBS.submit(
            kind,
            withMain(
            mainClass,
            context ->
                MutationLab.run(
                    files,
                    Json.str(request, "fileName", ""),
                    Json.str(request, "methodId", ""),
                    inputs,
                    InputCases.bounded(request, "maximum", 5, 1, 8),
                    context)));
      }
      case "minimize" -> {
        if (original == null || candidate == null)
          throw new IllegalArgumentException("Нужны обе версии проекта");
        yield JOBS.submit(
            kind,
            withMain(
            mainClass,
            context ->
                CounterexampleLab.minimize(
                    original,
                    candidate,
                    Json.str(request, "input", ""),
                    InputCases.bounded(request, "budget", 16, 2, 40),
                    context)));
      }
      case "benchmark" -> {
        if (original == null || candidate == null)
          throw new IllegalArgumentException("Нужны обе версии проекта");
        List<Integer> sizes =
            strings(request.getOrDefault("sizes", List.of("128", "512", "2048")), 5).stream()
                .map(Integer::parseInt)
                .toList();
        yield JOBS.submit(
            kind,
            withMain(
            mainClass,
            context ->
                BenchmarkLab.run(
                    original,
                    candidate,
                    Json.str(request, "fileName", ""),
                    Json.str(request, "methodName", ""),
                    sizes,
                    InputCases.bounded(request, "repetitions", 5, 3, 9),
                    context)));
      }
      default -> throw new IllegalArgumentException("Unknown job kind");
    };
  }

  /** Bundled example projects for the browser preview; the desktop app copies them via IPC. */
  static Map<String, Object> example(String name) throws java.io.IOException {
    if (!name.matches("[a-z0-9-]{1,60}")) throw new IllegalArgumentException("Unknown example");
    java.nio.file.Path root =
        java.nio.file.Path.of(System.getProperty("blueprints.examples", "examples"))
            .toAbsolutePath()
            .normalize();
    java.nio.file.Path folder = root.resolve(name).normalize();
    if (!folder.startsWith(root) || !java.nio.file.Files.isDirectory(folder))
      throw new IllegalArgumentException("Example not found");
    Map<String, Object> files = new TreeMap<>();
    long total = 0;
    try (var paths = java.nio.file.Files.walk(folder, 6)) {
      for (java.nio.file.Path path : paths.filter(java.nio.file.Files::isRegularFile).toList()) {
        String relative = folder.relativize(path).toString().replace('\\', '/');
        if (!relative.matches("[A-Za-z0-9_./\\-]+\\.(java|json|md|txt)") || files.size() >= 60)
          continue;
        String content = java.nio.file.Files.readString(path, java.nio.charset.StandardCharsets.UTF_8);
        total += content.length();
        if (total > 4_000_000) break;
        files.put(relative, content);
      }
    }
    return Digests.map("name", name, "files", files);
  }

  private static JobService.Work withMain(String mainClass, JobService.Work work) {
    return context -> Runner.withMain(mainClass, () -> work.run(context));
  }

  static List<String> strings(Object value, int maximum) {
    if (!(value instanceof List<?> list) || list.size() > maximum)
      throw new IllegalArgumentException("Ожидается массив длиной до " + maximum);
    List<String> result = list.stream().map(String::valueOf).toList();
    if (result.stream().anyMatch(text -> text.length() > 32768))
      throw new IllegalArgumentException("Слишком большой элемент массива");
    return result;
  }
}
