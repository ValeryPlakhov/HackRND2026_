import com.sun.source.tree.*;
import com.sun.source.util.TreeScanner;
import java.util.*;

/** Whole-project lexical call graph, hotspots, module hints and dependency cycles. */
public final class ProjectAnalysis {
  private final Map<String, String> files;
  private final List<Map<String, Object>> methods = new ArrayList<>();
  private final List<Map<String, Object>> calls = new ArrayList<>();
  private final List<Object> findings = new ArrayList<>();
  private final Map<String, Map<String, Object>> models = new LinkedHashMap<>();
  private final Map<String, List<String>> bySimpleName = new HashMap<>();
  private final Map<String, List<String>> dependencies = new LinkedHashMap<>();

  public ProjectAnalysis(Map<String, String> files) {
    this.files = new LinkedHashMap<>(files);
  }

  public Map<String, Object> describe() throws Exception {
    long started = System.nanoTime();
    for (Map.Entry<String, String> file : files.entrySet())
      readFile(file.getKey(), file.getValue());
    resolveCalls();
    List<List<String>> components = GraphAnalysis.stronglyConnected(dependencies);
    List<List<String>> cycles =
        components.stream()
            .filter(
                component ->
                    component.size() > 1
                        || !component.isEmpty()
                            && dependencies
                                .getOrDefault(component.get(0), List.of())
                                .contains(component.get(0)))
            .toList();
    List<Object> hotspots =
        methods.stream()
            .sorted(
                Comparator.comparingDouble(
                        (Map<String, Object> method) -> ((Number) method.get("risk")).doubleValue())
                    .reversed())
            .limit(12)
            .map(method -> (Object) method)
            .toList();
    int totalLines =
        files.values().stream().mapToInt(source -> (int) source.lines().count()).sum();
    int branches =
        methods.stream()
            .mapToInt(method -> ((Number) method.get("cyclomatic")).intValue() - 1)
            .sum();
    long errors =
        models.values().stream().filter(model -> !Boolean.TRUE.equals(model.get("valid"))).count();
    Map<String, Object> result =
        Digests.map(
            "schemaVersion",
            "2.0",
            "projectHash",
            Digests.project(files),
            "files",
            models,
            "methods",
            methods,
            "calls",
            calls,
            "findings",
            findings,
            "hotspots",
            hotspots,
            "dependencies",
            dependencies,
            "cycles",
            cycles,
            "modules",
            modules(),
            "stats",
            Digests.map(
                "files",
                files.size(),
                "methods",
                methods.size(),
                "lines",
                totalLines,
                "branches",
                branches,
                "findings",
                findings.size(),
                "syntaxErrorFiles",
                errors),
            "analysisMs",
            (System.nanoTime() - started) / 1_000_000,
            "scope",
            "lexical-project-analysis",
            "limitations",
            List.of(
                "Call graph разрешает локальные вызовы по имени и арности. Динамическая"
                    + " диспетчеризация и перегрузки могут давать несколько кандидатов.",
                "Module hints группируют ответственности по синтаксическим признакам. Это"
                    + " предложения, не автоматическая архитектурная нарезка.",
                "Оценка риска помогает сортировать ревью и не является вероятностью дефекта."));
    return result;
  }

  @SuppressWarnings("unchecked")
  private void readFile(String fileName, String source) throws Exception {
    try (JavaModel model = new JavaModel(source)) {
      Map<String, Object> description = model.describe();
      description.put("sourceHash", Digests.sha256(source));
      List<Object> extended = RuleCatalog.analyze(model);
      List<Object> allFindings = new ArrayList<>((List<Object>) description.get("findings"));
      allFindings.addAll(extended);
      description.put("findings", allFindings);
      models.put(fileName, description);
      List<RefactorPlans.Plan> plans =
          model.valid() ? new RefactorPlans(model).collect() : List.of();
      for (Object item : allFindings) {
        Map<String, Object> finding = new LinkedHashMap<>((Map<String, Object>) item);
        finding.put("fileName", fileName);
        int start = ((Number) finding.getOrDefault("start", -1)).intValue();
        int end = ((Number) finding.getOrDefault("end", -1)).intValue();
        // A finding is fixable when a rewrite plan touches its span (plans stay narrow).
        boolean methodWide =
            Set.of("LONG_METHOD", "BP103", "BP104", "BP118").contains(finding.get("rule"));
        if (start >= 0
            && !methodWide
            && plans.stream().anyMatch(plan -> plan.start() < Math.max(end, start + 1) && start < plan.end()))
          finding.put("canOptimize", true);
        findings.add(finding);
      }
      for (JavaModel.Method method : model.methods) {
        MethodTree tree = method.tree();
        String globalId = fileName + "::" + method.id();
        Map<String, Object> metrics = Analyzer.metrics(tree);
        Map<String, Object> detailed = new ComplexityAnalysis(model, method).describe();
        int lines = model.text(tree).split("\n", -1).length;
        int decisionCount = ((Number) metrics.get("cyclomatic")).intValue();
        int cognitive = ((Number) detailed.get("cognitive")).intValue();
        double risk =
            Math.round((decisionCount * 2.0 + cognitive * 1.5 + lines * 0.15) * 10) / 10.0;
        Map<String, Object> summary =
            Digests.map(
                "id",
                globalId,
                "methodId",
                method.id(),
                "fileName",
                fileName,
                "name",
                tree.getName().toString(),
                "owner",
                method.owner(),
                "arity",
                tree.getParameters().size(),
                "line",
                model.line(tree),
                "lines",
                lines,
                "complexity",
                detailed.get("time"),
                "cyclomatic",
                decisionCount,
                "cognitive",
                cognitive,
                "risk",
                risk,
                "responsibility",
                responsibility(tree),
                "static",
                tree.getModifiers().getFlags().contains(javax.lang.model.element.Modifier.STATIC));
        methods.add(summary);
        bySimpleName
            .computeIfAbsent(
                tree.getName() + "/" + tree.getParameters().size(), key -> new ArrayList<>())
            .add(globalId);
        dependencies.put(globalId, new ArrayList<>());
        new TreeScanner<Void, Void>() {
          public Void visitMethodInvocation(MethodInvocationTree call, Void ignored) {
            String select = call.getMethodSelect().toString();
            String name =
                call.getMethodSelect() instanceof MemberSelectTree member
                    ? member.getIdentifier().toString()
                    : select;
            calls.add(
                Digests.map(
                    "from",
                    globalId,
                    "name",
                    name,
                    "select",
                    select,
                    "arity",
                    call.getArguments().size(),
                    "line",
                    model.line(call),
                    "fileName",
                    fileName,
                    "qualified",
                    call.getMethodSelect() instanceof MemberSelectTree));
            return super.visitMethodInvocation(call, ignored);
          }

          public Void visitClass(ClassTree nested, Void ignored) {
            return null;
          }
        }.scan(tree.getBody(), null);
      }
    }
  }

  private void resolveCalls() {
    for (Map<String, Object> call : calls) {
      String key = call.get("name") + "/" + call.get("arity");
      List<String> candidates = bySimpleName.getOrDefault(key, List.of());
      String select = String.valueOf(call.get("select"));
      String from = String.valueOf(call.get("from"));
      Map<String, Object> caller =
          methods.stream()
              .filter(method -> from.equals(method.get("id")))
              .findFirst()
              .orElseThrow();
      List<String> resolved =
          candidates.stream()
              .filter(
                  candidate -> {
                    Map<String, Object> target =
                        methods.stream()
                            .filter(method -> candidate.equals(method.get("id")))
                            .findFirst()
                            .orElseThrow();
                    if (!Boolean.TRUE.equals(call.get("qualified"))) {
                      return Objects.equals(target.get("owner"), caller.get("owner"))
                          && Objects.equals(target.get("fileName"), caller.get("fileName"));
                    }
                    String receiver = select.substring(0, Math.max(0, select.lastIndexOf('.')));
                    return receiver.equals(target.get("owner"))
                        || receiver.equals("this")
                            && Objects.equals(target.get("owner"), caller.get("owner"));
                  })
              .toList();
      call.put("targets", resolved);
      call.put(
          "resolution",
          resolved.size() == 1
              ? "lexical"
              : resolved.isEmpty() ? "external-or-unresolved" : "ambiguous");
      dependencies.get(from).addAll(resolved);
    }
    for (Map<String, Object> method : methods) {
      String id = String.valueOf(method.get("id"));
      method.put("fanOut", new LinkedHashSet<>(dependencies.get(id)).size());
      method.put(
          "fanIn", dependencies.values().stream().filter(targets -> targets.contains(id)).count());
    }
  }

  private static String responsibility(MethodTree method) {
    String code = method.toString();
    if (code.contains("Scanner") || code.contains("System.in")) return "input";
    if (code.contains("System.out") || code.contains("System.err") || code.contains("Formatter"))
      return "output";
    if (code.contains("throw ")
        || code.contains("isValid")
        || method.getName().toString().matches("(?i).*(valid|check|verify).*")) return "validation";
    if (code.contains("for (") || code.contains("while (") || code.contains(".stream()"))
      return "computation";
    return "utility";
  }

  private List<Object> modules() {
    Map<String, List<Map<String, Object>>> grouped = new LinkedHashMap<>();
    for (Map<String, Object> method : methods) {
      grouped
          .computeIfAbsent(String.valueOf(method.get("responsibility")), key -> new ArrayList<>())
          .add(method);
    }
    Map<String, String> titles =
        Map.of(
            "input",
            "InputParser",
            "output",
            "ResultFormatter",
            "validation",
            "ValidationService",
            "computation",
            "ComputationEngine",
            "utility",
            "DomainUtilities");
    List<Object> modules = new ArrayList<>();
    grouped.forEach(
        (responsibility, group) ->
            modules.add(
                Digests.map(
                    "id",
                    responsibility,
                    "suggestedClass",
                    titles.get(responsibility),
                    "methods",
                    group.stream().map(method -> method.get("id")).toList(),
                    "lines",
                    group.stream()
                        .mapToInt(method -> ((Number) method.get("lines")).intValue())
                        .sum(),
                    "extractableCandidates",
                    group.stream()
                        .filter(method -> Boolean.TRUE.equals(method.get("static")))
                        .count(),
                    "status",
                    "review-required")));
    return modules;
  }
}
