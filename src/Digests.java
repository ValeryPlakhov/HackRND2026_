import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;

/** Canonical content identities used by plans, reports and reproducible exports. */
public final class Digests {
  private Digests() {}

  public static String sha256(String value) {
    try {
      return HexFormat.of()
          .formatHex(
              MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
    } catch (java.security.NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
  }

  public static String project(Map<String, String> files) {
    StringBuilder canonical = new StringBuilder();
    new TreeMap<>(files)
        .forEach(
            (name, content) ->
                canonical
                    .append(name.length())
                    .append(':')
                    .append(name)
                    .append(':')
                    .append(content.length())
                    .append(':')
                    .append(content)
                    .append('\n'));
    return sha256(canonical.toString());
  }

  public static Map<String, Object> map(Object... pairs) {
    if (pairs.length % 2 != 0) throw new IllegalArgumentException("Expected key/value pairs");
    Map<String, Object> result = new LinkedHashMap<>();
    for (int i = 0; i < pairs.length; i += 2) result.put(String.valueOf(pairs[i]), pairs[i + 1]);
    return result;
  }

  public static void requireSource(String source, String expected) {
    if (expected == null || !expected.equals(sha256(source))) {
      throw new IllegalArgumentException(
          "STALE_SOURCE: исходник изменился. Перестройте анализ и предложение.");
    }
  }
}
