import com.sun.source.tree.*;
import java.util.*;
import javax.lang.model.element.Modifier;

/** Measures method time inside a warmed JVM; compilation and JVM startup are excluded. */
public final class BenchmarkLab {
  private static final String HARNESS = "BlueprintBenchmarkHarness";

  public static Map<String, Object> run(
      Map<String, String> original,
      Map<String, String> candidate,
      String fileName,
      String methodName,
      List<Integer> sizes,
      int repetitions,
      JobService.Context context)
      throws Exception {
    if (sizes.isEmpty()
        || sizes.size() > 5
        || sizes.stream().anyMatch(size -> size < 1 || size > 10000)) {
      throw new IllegalArgumentException("Бенчмарк: 1..5 размеров в диапазоне 1..10000");
    }
    if (repetitions < 3 || repetitions > 9)
      throw new IllegalArgumentException("Повторов должно быть 3..9");
    if (!original.containsKey(fileName) || !candidate.containsKey(fileName))
      throw new IllegalArgumentException("Нужен один и тот же файл в обеих версиях");
    if (original.containsKey(HARNESS + ".java") || candidate.containsKey(HARNESS + ".java"))
      throw new IllegalArgumentException("Имя harness уже занято");
    if (!Runner.SLOTS.tryAcquire()) throw new IllegalArgumentException("Runner занят");
    try {
      if (context != null) context.stage("Разогрев и замер эталона", 0, 2);
      Map<String, Object> before = measure(original, fileName, methodName, sizes, repetitions);
      if (context != null) context.stage("Разогрев и замер кандидата", 1, 2);
      Map<String, Object> after = measure(candidate, fileName, methodName, sizes, repetitions);
      List<Object> comparison = new ArrayList<>();
      List<?> left = (List<?>) before.get("measurements");
      List<?> right = (List<?>) after.get("measurements");
      for (int i = 0; i < left.size(); i++) {
        Map<?, ?> a = (Map<?, ?>) left.get(i);
        Map<?, ?> b = (Map<?, ?>) right.get(i);
        double baselineNs = ((Number) a.get("medianNs")).doubleValue();
        double candidateNs = ((Number) b.get("medianNs")).doubleValue();
        comparison.add(
            Digests.map(
                "size",
                sizes.get(i),
                "baselineNs",
                baselineNs,
                "candidateNs",
                candidateNs,
                "speedup",
                candidateNs == 0 ? null : baselineNs / candidateNs,
                "sameResult",
                Objects.equals(a.get("result"), b.get("result"))));
      }
      return Digests.map(
          "baseline",
          before,
          "candidate",
          after,
          "comparison",
          comparison,
          "methodName",
          methodName,
          "repetitions",
          repetitions,
          "warmups",
          3,
          "baselineHash",
          Digests.project(original),
          "candidateHash",
          Digests.project(candidate),
          "clock",
          "System.nanoTime inside submitted JVM",
          "note",
          "Ориентировочный микробенчмарк, не JMH. Перед каждым измерением массив клонируется вне"
              + " таймера. Разогрев 3 вызова, медиана по повторам. JIT, GC и среда влияют на"
              + " результат; изменение Big O из замеров не доказывается.");
    } finally {
      Runner.SLOTS.release();
    }
  }

  @SuppressWarnings("unchecked")
  private static Map<String, Object> measure(
      Map<String, String> files,
      String fileName,
      String methodName,
      List<Integer> sizes,
      int repetitions)
      throws Exception {
    String packageName;
    String owner;
    try (JavaModel model = new JavaModel(files.get(fileName))) {
      List<JavaModel.Method> candidates =
          model.methods.stream()
              .filter(
                  method ->
                      method.tree().getName().contentEquals(methodName) && eligible(method.tree()))
              .toList();
      if (candidates.size() != 1)
        throw new IllegalArgumentException(
            "Выберите доступный static int method(int[]). Приватные методы и неоднозначные"
                + " перегрузки не измеряются.");
      owner = candidates.get(0).owner();
      packageName =
          model.unit.getPackageName() == null ? "" : model.unit.getPackageName().toString();
    }
    String source = harness(packageName, owner, methodName, sizes, repetitions);
    Map<String, String> project = new LinkedHashMap<>(files);
    project.put(HARNESS + ".java", source);
    try (Runner.Build built = Runner.compile(project)) {
      if (!Boolean.TRUE.equals(built.result().get("success"))) {
        throw new IllegalArgumentException(
            "Harness не компилируется: " + built.result().get("diagnostics"));
      }
      Runner.Build target =
          new Runner.Build(
              built.directory(),
              packageName.isEmpty() ? HARNESS : packageName + "." + HARNESS,
              built.result());
      Map<String, Object> run = Runner.run(target, "");
      if (((Number) run.get("exitCode")).intValue() != 0
          || Boolean.TRUE.equals(run.get("timedOut"))
          || Boolean.TRUE.equals(run.get("outputLimit"))) {
        throw new IllegalArgumentException(
            "Измерение не завершилось в лимитах: " + run.get("stderr"));
      }
      Map<String, Object> parsed;
      try {
        parsed = Json.object(String.valueOf(run.get("stdout")).strip());
      } catch (IllegalArgumentException error) {
        throw new IllegalArgumentException(
            "Метод печатает в stdout или нарушает протокол harness. Выделите чистую вычислительную"
                + " функцию.");
      }
      parsed.put("processTimeMs", run.get("timeMs"));
      return parsed;
    }
  }

  private static boolean eligible(MethodTree method) {
    Set<Modifier> modifiers = method.getModifiers().getFlags();
    return modifiers.contains(Modifier.STATIC)
        && !modifiers.contains(Modifier.PRIVATE)
        && !modifiers.contains(Modifier.SYNCHRONIZED)
        && method.getBody() != null
        && "int".equals(String.valueOf(method.getReturnType()))
        && method.getParameters().size() == 1
        && "int[]".equals(method.getParameters().get(0).getType().toString());
  }

  private static String harness(
      String pkg, String owner, String method, List<Integer> sizes, int repetitions) {
    String sizeList = String.join(",", sizes.stream().map(String::valueOf).toList());
    String call = owner + "." + method;
    return (pkg.isEmpty() ? "" : "package " + pkg + ";\n")
        + """
final class BlueprintBenchmarkHarness {
  static volatile int sink;
  public static void main(String[] ignored) throws Exception {
    int[] sizes = new int[]{%s};
    java.util.Random random = new java.util.Random(75000L);
    java.lang.StringBuilder json = new java.lang.StringBuilder("{")
        .append((char) 34).append("measurements").append((char) 34).append(":[");
    for (int index = 0; index < sizes.length; index++) {
      int size = sizes[index];
      int[] input = new int[size];
      for (int i = 0; i < size; i++) input[i] = random.nextInt(64) - 32;
      for (int warmup = 0; warmup < 3; warmup++) sink = %s(input.clone());
      long[] samples = new long[%d];
      int result = 0;
      for (int repeat = 0; repeat < samples.length; repeat++) {
        int[] values = input.clone();
        long start = java.lang.System.nanoTime();
        result = %s(values);
        samples[repeat] = java.lang.System.nanoTime() - start;
        sink = result;
      }
      long[] sorted = samples.clone();
      java.util.Arrays.sort(sorted);
      if (index > 0) json.append(',');
      json.append('{').append((char) 34).append("size").append((char) 34).append(':').append(size)
          .append(',').append((char) 34).append("medianNs").append((char) 34).append(':').append(sorted[sorted.length / 2])
          .append(',').append((char) 34).append("minimumNs").append((char) 34).append(':').append(sorted[0])
          .append(',').append((char) 34).append("maximumNs").append((char) 34).append(':').append(sorted[sorted.length - 1])
          .append(',').append((char) 34).append("result").append((char) 34).append(':').append(result)
          .append(',').append((char) 34).append("samples").append((char) 34).append(':').append(java.util.Arrays.toString(samples)).append('}');
    }
    java.lang.System.out.println(json.append("]}"));
  }
}
"""
            .formatted(sizeList, call, repetitions, call);
  }
}
