import java.util.*;

/** Small dependency-free JSON codec. Rejects duplicate keys and trailing data. */
public final class Json {
  private Json() {}

  public static Object parse(String text) {
    Parser p = new Parser(text);
    Object v = p.value();
    p.ws();
    if (p.i != text.length()) throw new IllegalArgumentException("Trailing JSON");
    return v;
  }

  @SuppressWarnings("unchecked")
  public static Map<String, Object> object(String text) {
    Object v = parse(text);
    if (!(v instanceof Map)) throw new IllegalArgumentException("Expected JSON object");
    return (Map<String, Object>) v;
  }

  public static String str(Map<String, Object> m, String k, String fallback) {
    Object v = m.get(k);
    return v == null ? fallback : String.valueOf(v);
  }

  public static String stringify(Object v) {
    if (v == null) return "null";
    if (v instanceof String s) {
      StringBuilder b = new StringBuilder("\"");
      for (char c : s.toCharArray())
        switch (c) {
          case '"' -> b.append("\\\"");
          case '\\' -> b.append("\\\\");
          case '\n' -> b.append("\\n");
          case '\r' -> b.append("\\r");
          case '\t' -> b.append("\\t");
          default -> {
            if (c < 32) b.append(String.format("\\u%04x", (int) c));
            else b.append(c);
          }
        }
      return b.append('"').toString();
    }
    if (v instanceof Number || v instanceof Boolean) return v.toString();
    if (v instanceof Map<?, ?> m) {
      StringJoiner j = new StringJoiner(",", "{", "}");
      m.forEach((k, x) -> j.add(stringify(String.valueOf(k)) + ":" + stringify(x)));
      return j.toString();
    }
    if (v instanceof Iterable<?> list) {
      StringJoiner j = new StringJoiner(",", "[", "]");
      for (Object x : list) j.add(stringify(x));
      return j.toString();
    }
    throw new IllegalArgumentException("Unsupported JSON type: " + v.getClass());
  }

  static final class Parser {
    final String s;
    int i;

    Parser(String s) {
      this.s = s;
    }

    void ws() {
      while (i < s.length() && Character.isWhitespace(s.charAt(i))) i++;
    }

    char take() {
      if (i >= s.length()) throw new IllegalArgumentException("Unexpected JSON end");
      return s.charAt(i++);
    }

    Object value() {
      ws();
      if (i >= s.length()) throw new IllegalArgumentException("Missing value");
      char c = s.charAt(i);
      if (c == '"') return string();
      if (c == '{') return map();
      if (c == '[') return list();
      for (String k : List.of("true", "false", "null"))
        if (s.startsWith(k, i)) {
          i += k.length();
          return k.equals("null") ? null : k.equals("true");
        }
      int start = i;
      while (i < s.length() && "-+0123456789.eE".indexOf(s.charAt(i)) >= 0) i++;
      if (start == i) throw new IllegalArgumentException("Invalid JSON at " + i);
      String n = s.substring(start, i);
      try {
        if (!n.matches("-?(0|[1-9][0-9]*)(\\.[0-9]+)?([eE][+-]?[0-9]+)?"))
          throw new NumberFormatException();
        if (n.contains(".") || n.contains("e") || n.contains("E")) {
          double value = Double.parseDouble(n);
          if (!Double.isFinite(value)) throw new NumberFormatException();
          return value;
        }
        return Long.valueOf(n);
      } catch (NumberFormatException e) {
        throw new IllegalArgumentException("Invalid number");
      }
    }

    String string() {
      if (take() != '"') throw new IllegalArgumentException("Expected string");
      StringBuilder b = new StringBuilder();
      while (true) {
        char c = take();
        if (c == '"') return b.toString();
        if (c < 32) throw new IllegalArgumentException("Control character in string");
        if (c == '\\') {
          char e = take();
          switch (e) {
            case '"', '\\', '/' -> b.append(e);
            case 'b' -> b.append('\b');
            case 'f' -> b.append('\f');
            case 'n' -> b.append('\n');
            case 'r' -> b.append('\r');
            case 't' -> b.append('\t');
            case 'u' -> {
              if (i + 4 > s.length()) throw new IllegalArgumentException("Unicode escape");
              b.append((char) Integer.parseInt(s.substring(i, i + 4), 16));
              i += 4;
            }
            default -> throw new IllegalArgumentException("Invalid escape");
          }
        } else b.append(c);
      }
    }

    Map<String, Object> map() {
      take();
      Map<String, Object> m = new LinkedHashMap<>();
      ws();
      if (i < s.length() && s.charAt(i) == '}') {
        i++;
        return m;
      }
      while (true) {
        ws();
        String k = string();
        ws();
        if (take() != ':') throw new IllegalArgumentException("Expected colon");
        if (m.containsKey(k)) throw new IllegalArgumentException("Duplicate key");
        m.put(k, value());
        ws();
        char c = take();
        if (c == '}') return m;
        if (c != ',') throw new IllegalArgumentException("Expected comma");
      }
    }

    List<Object> list() {
      take();
      List<Object> a = new ArrayList<>();
      ws();
      if (i < s.length() && s.charAt(i) == ']') {
        i++;
        return a;
      }
      while (true) {
        a.add(value());
        ws();
        char c = take();
        if (c == ']') return a;
        if (c != ',') throw new IllegalArgumentException("Expected comma");
      }
    }
  }
}
