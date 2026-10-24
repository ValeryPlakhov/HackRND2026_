import java.util.*;

/** Budgeted delta debugging for stdin encoded as n followed by n integer tokens. */
public final class CounterexampleLab {
  private final Runner.Build baseline;
  private final Runner.Build candidate;
  private final int budget;
  private final JobService.Context context;
  private final List<Object> trace = new ArrayList<>();
  private int attempts;
  private Map<String, Object> lastBaseline;
  private Map<String, Object> lastCandidate;

  private CounterexampleLab(
      Runner.Build baseline, Runner.Build candidate, int budget, JobService.Context context) {
    this.baseline = baseline;
    this.candidate = candidate;
    this.budget = budget;
    this.context = context;
  }

  public static Map<String, Object> minimize(
      Map<String, String> original,
      Map<String, String> changed,
      String input,
      int budget,
      JobService.Context context)
      throws Exception {
    List<Integer> values = parse(input);
    if (budget < 2 || budget > 40)
      throw new IllegalArgumentException("Бюджет уменьшения: 2..40 попыток");
    if (!Runner.SLOTS.tryAcquire()) throw new IllegalArgumentException("Runner занят");
    try (Runner.Build baseline = Runner.compile(original);
        Runner.Build candidate = Runner.compile(changed)) {
      if (!Boolean.TRUE.equals(baseline.result().get("success"))
          || !Boolean.TRUE.equals(candidate.result().get("success"))) {
        throw new IllegalArgumentException("Для уменьшения обе версии должны компилироваться");
      }
      CounterexampleLab lab = new CounterexampleLab(baseline, candidate, budget, context);
      if (!lab.fails(values, "Проверка исходного контрпримера"))
        throw new IllegalArgumentException("Этот вход не различает программы");
      List<Integer> current = new ArrayList<>(values);
      int granularity = 2;
      while (!current.isEmpty() && lab.attempts < budget) {
        int chunk = (int) Math.ceil(current.size() / (double) granularity);
        boolean reduced = false;
        for (int start = 0; start < current.size() && lab.attempts < budget; start += chunk) {
          List<Integer> proposed = new ArrayList<>(current);
          proposed.subList(start, Math.min(current.size(), start + chunk)).clear();
          if (lab.fails(
              proposed, "Удаление блока из " + (current.size() - proposed.size()) + " элементов")) {
            current = proposed;
            granularity = Math.max(2, granularity - 1);
            reduced = true;
            break;
          }
        }
        if (!reduced) {
          if (granularity >= current.size()) break;
          granularity = Math.min(current.size(), granularity * 2);
        }
      }
      for (int index = 0; index < current.size() && lab.attempts < budget; index++) {
        int originalValue = current.get(index);
        for (int simpler : new int[] {0, 1, -1}) {
          if (Math.abs((long) simpler) >= Math.abs((long) originalValue) || lab.attempts >= budget)
            continue;
          List<Integer> proposed = new ArrayList<>(current);
          proposed.set(index, simpler);
          if (lab.fails(proposed, "Упрощение значения " + originalValue + " → " + simpler)) {
            current = proposed;
            break;
          }
        }
      }
      // Refresh the displayed evidence for the retained input, rather than the last rejected
      // attempt.
      Map<String, Object> finalBaseline = Runner.run(baseline, encode(current));
      Map<String, Object> finalCandidate = Runner.run(candidate, encode(current));
      return Digests.map(
          "originalInput",
          input,
          "minimalInput",
          encode(current),
          "beforeLength",
          values.size(),
          "afterLength",
          current.size(),
          "attempts",
          lab.attempts,
          "budget",
          budget,
          "budgetExhausted",
          lab.attempts >= budget,
          "trace",
          lab.trace,
          "baseline",
          finalBaseline,
          "candidate",
          finalCandidate,
          "stillFails",
          !MutationLab.equivalent(finalBaseline, finalCandidate),
          "note",
          "Уменьшение эвристическое и ограничено бюджетом. Глобальная минимальность не"
              + " гарантируется. Схема: n, затем n целых чисел.");
    } finally {
      Runner.SLOTS.release();
    }
  }

  private boolean fails(List<Integer> values, String operation) throws Exception {
    if (context != null) context.stage(operation, attempts, budget);
    attempts++;
    String input = encode(values);
    lastBaseline = Runner.run(baseline, input);
    lastCandidate = Runner.run(candidate, input);
    boolean bounded =
        !Boolean.TRUE.equals(lastBaseline.get("timedOut"))
            && !Boolean.TRUE.equals(lastCandidate.get("timedOut"))
            && !Boolean.TRUE.equals(lastBaseline.get("outputLimit"))
            && !Boolean.TRUE.equals(lastCandidate.get("outputLimit"));
    if (!bounded && attempts == 1)
      throw new IllegalArgumentException(
          "Таймаут/лимит вывода нельзя использовать как исходный контрпример для уменьшения");
    boolean failed = bounded && !MutationLab.equivalent(lastBaseline, lastCandidate);
    trace.add(
        Digests.map(
            "attempt",
            attempts,
            "operation",
            operation,
            "length",
            values.size(),
            "retained",
            failed,
            "input",
            input));
    return failed;
  }

  static List<Integer> parse(String input) {
    String[] tokens = input.strip().split("\\s+");
    try {
      int count = Integer.parseInt(tokens[0]);
      if (count < 0 || count > 256 || tokens.length != count + 1) throw new NumberFormatException();
      List<Integer> values = new ArrayList<>();
      for (int i = 1; i < tokens.length; i++) values.add(Integer.parseInt(tokens[i]));
      return values;
    } catch (NumberFormatException | ArrayIndexOutOfBoundsException error) {
      throw new IllegalArgumentException(
          "Контрпример должен иметь формат n и ровно n целых чисел, n ≤ 256");
    }
  }

  static String encode(List<Integer> values) {
    return values.size()
        + "\n"
        + String.join(" ", values.stream().map(String::valueOf).toList())
        + "\n";
  }
}
