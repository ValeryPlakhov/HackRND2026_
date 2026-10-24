import java.time.Instant;
import java.util.*;

/** Exports source-bound evidence. Hashes provide integrity identities, not signatures or proofs. */
public final class Evidence {
  private Evidence() {}

  public static Map<String, Object> report(
      Map<String, String> original,
      Map<String, String> candidate,
      List<String> inputs,
      Map<String, Object> result) {
    Map<String, Object> evidence = new LinkedHashMap<>(result);
    evidence.put("schemaVersion", "2.0");
    evidence.put("createdAt", Instant.now().toString());
    evidence.put("baselineHash", Digests.project(original));
    evidence.put("candidateHash", Digests.project(candidate));
    evidence.put("inputsHash", Digests.sha256(Json.stringify(inputs)));
    evidence.put("environment", environment());
    return evidence;
  }

  public static Map<String, Object> bundle(
      Map<String, String> original,
      Map<String, String> candidate,
      Map<String, Object> completedJob) {
    Object rawResult = completedJob == null ? null : completedJob.get("result");
    Map<?, ?> result = rawResult instanceof Map<?, ?> map ? map : Map.of();
    boolean bound =
        completedJob != null
            && "completed".equals(completedJob.get("state"))
            && "compare".equals(completedJob.get("kind"))
            && Digests.project(original).equals(result.get("baselineHash"))
            && Digests.project(candidate).equals(result.get("candidateHash"));
    List<Object> sourceManifest = new ArrayList<>();
    original.forEach(
        (file, source) ->
            sourceManifest.add(
                Digests.map(
                    "path",
                    "baseline/" + file,
                    "sha256",
                    Digests.sha256(source),
                    "bytes",
                    source.getBytes(java.nio.charset.StandardCharsets.UTF_8).length)));
    candidate.forEach(
        (file, source) ->
            sourceManifest.add(
                Digests.map(
                    "path",
                    "candidate/" + file,
                    "sha256",
                    Digests.sha256(source),
                    "bytes",
                    source.getBytes(java.nio.charset.StandardCharsets.UTF_8).length)));
    return Digests.map(
        "schemaVersion",
        "2.0",
        "createdAt",
        Instant.now().toString(),
        "status",
        bound ? "source-bound-run" : "unverified-export",
        "passed",
        bound && Boolean.TRUE.equals(result.get("passed")),
        "baselineHash",
        Digests.project(original),
        "candidateHash",
        Digests.project(candidate),
        "manifest",
        sourceManifest,
        "job",
        bound ? completedJob : null,
        "environment",
        environment(),
        "note",
        "SHA-256 идентифицирует содержимое, но не является подписью. source-bound-run означает"
            + " завершённый запуск текущего сервера для этих исходников, не математическое"
            + " доказательство эквивалентности.");
  }

  public static Map<String, Object> environment() {
    return Digests.map(
        "java",
        System.getProperty("java.version"),
        "vendor",
        System.getProperty("java.vendor"),
        "os",
        System.getProperty("os.name"),
        "architecture",
        System.getProperty("os.arch"),
        "runner",
        Runner.MODE,
        "heapMiB",
        96,
        "outputLimitBytes",
        Runner.OUTPUT_LIMIT,
        "runTimeoutMs",
        Runner.MODE.equals("docker") ? 7000 : 2500,
        "encoding",
        "UTF-8",
        "compilerRelease",
        21);
  }

  @SuppressWarnings("unchecked")
  public static Map<String, Object> sarif(Map<String, Object> analysis) {
    List<Object> results = new ArrayList<>();
    Set<String> seenRules = new LinkedHashSet<>();
    List<Object> rules = new ArrayList<>();
    for (Object item : (List<Object>) analysis.getOrDefault("findings", List.of())) {
      Map<String, Object> finding = (Map<String, Object>) item;
      String rule = String.valueOf(finding.getOrDefault("rule", "BLUEPRINTS"));
      if (seenRules.add(rule))
        rules.add(
            Digests.map(
                "id",
                rule,
                "shortDescription",
                Map.of("text", String.valueOf(finding.get("title")))));
      int line = Math.max(1, ((Number) finding.getOrDefault("line", 1)).intValue());
      String severity = String.valueOf(finding.getOrDefault("severity", "info"));
      String level =
          severity.equals("error") ? "error" : severity.equals("warning") ? "warning" : "note";
      results.add(
          Digests.map(
              "ruleId",
              rule,
              "level",
              level,
              "message",
              Map.of("text", String.valueOf(finding.get("detail"))),
              "locations",
              List.of(
                  Map.of(
                      "physicalLocation",
                      Digests.map(
                          "artifactLocation",
                              Map.of(
                                  "uri",
                                  String.valueOf(finding.getOrDefault("fileName", "Input.java"))),
                          "region", Map.of("startLine", line)))),
              "properties",
              Digests.map("confidence", finding.getOrDefault("confidence", "heuristic"))));
    }
    return Digests.map(
        "version",
        "2.1.0",
        "$schema",
        "https://json.schemastore.org/sarif-2.1.0.json",
        "runs",
        List.of(
            Digests.map(
                "tool",
                Map.of(
                    "driver",
                    Digests.map(
                        "name", "Java Blueprints Studio", "version", "2.0.0", "rules", rules)),
                "results",
                results)));
  }
}
