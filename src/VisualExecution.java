import java.util.*;

/** A single real compile/run for the visual builder; no interpreter runs in the server JVM. */
public final class VisualExecution {
  static Map<String, Object> run(Map<String, String> files, String input, JobService.Context context)
      throws Exception {
    if (input.length() > 32768) throw new IllegalArgumentException("Слишком длинные ответы");
    if (!Runner.SLOTS.tryAcquire()) throw new IllegalArgumentException("Сервис занят, повторите запуск");
    try {
      context.stage("Подготавливаем программу", 0, 2);
      try (Runner.Build build = Runner.compile(files)) {
        if (!Boolean.TRUE.equals(build.result().get("success")))
          return Digests.map("success", false, "phase", "compile", "compile", build.result(),
              "projectHash", Digests.project(files));
        context.stage("Выполняем вашу схему", 1, 2);
        Map<String, Object> execution = Runner.run(build, input);
        boolean success = ((Number) execution.get("exitCode")).intValue() == 0
            && !Boolean.TRUE.equals(execution.get("timedOut"))
            && !Boolean.TRUE.equals(execution.get("outputLimit"));
        context.stage("Готово", 2, 2);
        return Digests.map("success", success, "phase", "execute", "compile", build.result(),
            "execution", execution, "projectHash", Digests.project(files),
            "inputHash", Digests.sha256(input), "environment", Evidence.environment());
      }
    } finally { Runner.SLOTS.release(); }
  }
}
