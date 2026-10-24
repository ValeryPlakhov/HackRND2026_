import com.sun.source.tree.*;
import com.sun.source.util.*;
import java.net.URI;
import java.util.*;
import javax.lang.model.element.Modifier;
import javax.tools.*;

/** javac is the grammar authority. Source spans are UTF-16, same as browser strings. */
public final class JavaModel implements AutoCloseable {
  public final String source;
  public final CompilationUnitTree unit;
  public final SourcePositions positions;
  public final List<Method> methods = new ArrayList<>();
  public final List<Map<String, Object>> diagnostics = new ArrayList<>();
  private final StandardJavaFileManager files;

  public record Method(String id, String owner, MethodTree tree) {}

  public JavaModel(String source) throws Exception {
    if (source.length() > 250_000)
      throw new IllegalArgumentException("Source limit is 250000 characters");
    this.source = source;
    JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
    if (compiler == null) throw new IllegalStateException("JDK 21 required");
    DiagnosticCollector<JavaFileObject> dc = new DiagnosticCollector<>();
    files =
        compiler.getStandardFileManager(dc, Locale.ROOT, java.nio.charset.StandardCharsets.UTF_8);
    JavaFileObject input =
        new SimpleJavaFileObject(URI.create("string:///Input.java"), JavaFileObject.Kind.SOURCE) {
          public CharSequence getCharContent(boolean ignored) {
            return source;
          }
        };
    JavacTask task =
        (JavacTask)
            compiler.getTask(
                null, files, dc, List.of("-proc:none", "--release", "21"), null, List.of(input));
    unit = task.parse().iterator().next();
    positions = Trees.instance(task).getSourcePositions();
    for (Diagnostic<?> d : dc.getDiagnostics())
      diagnostics.add(
          Map.of(
              "severity",
              d.getKind().name(),
              "line",
              d.getLineNumber(),
              "column",
              d.getColumnNumber(),
              "message",
              d.getMessage(Locale.ROOT)));
    new TreeScanner<Void, String>() {
      public Void visitClass(ClassTree t, String parent) {
        String n = parent == null ? t.getSimpleName().toString() : parent + "." + t.getSimpleName();
        return super.visitClass(t, n);
      }

      public Void visitMethod(MethodTree t, String owner) {
        if (start(t) >= 0)
          methods.add(
              new Method(
                  (owner == null ? "" : owner) + "#" + t.getName() + "@" + start(t),
                  owner == null ? "" : owner,
                  t));
        return super.visitMethod(t, owner);
      }
    }.scan(unit, null);
  }

  public int start(Tree t) {
    return (int) positions.getStartPosition(unit, t);
  }

  public int end(Tree t) {
    return (int) positions.getEndPosition(unit, t);
  }

  public int line(Tree t) {
    return (int) unit.getLineMap().getLineNumber(Math.max(0, start(t)));
  }

  public String text(Tree t) {
    int a = start(t), b = end(t);
    return a >= 0 && b >= a && b <= source.length() ? source.substring(a, b) : t.toString();
  }

  public boolean valid() {
    return diagnostics.stream().noneMatch(d -> d.get("severity").equals("ERROR"));
  }

  public Method method(String id) {
    return methods.stream()
        .filter(m -> m.id.equals(id))
        .findFirst()
        .orElseThrow(() -> new IllegalArgumentException("Method no longer exists; rebuild graph"));
  }

  public Map<String, Object> describe() {
    List<Object> ms = new ArrayList<>();
    for (Method m : methods) {
      MethodTree t = m.tree;
      Map<String, Object> x = new LinkedHashMap<>();
      x.put("id", m.id);
      x.put("name", t.getName().toString());
      x.put("owner", m.owner);
      x.put(
          "signature",
          (t.getReturnType() == null ? "" : t.getReturnType() + " ")
              + t.getName()
              + "("
              + String.join(", ", t.getParameters().stream().map(Object::toString).toList())
              + ")");
      x.put("line", line(t));
      x.put("start", start(t));
      x.put("end", end(t));
      x.put("lines", source.substring(Math.max(0, start(t)), Math.max(0, end(t))).lines().count());
      x.put("static", t.getModifiers().getFlags().contains(Modifier.STATIC));
      x.put("graph", new GraphBuilder(this).build(m));
      x.put("metrics", Analyzer.metrics(t));
      ms.add(x);
    }
    String packageName = unit.getPackageName() == null ? "" : unit.getPackageName().toString();
    List<Object> classes = new ArrayList<>();
    for (Tree t : unit.getTypeDecls())
      if (t instanceof ClassTree c)
        classes.add(
            Map.of(
                "name", c.getSimpleName().toString(), "kind", c.getKind().name(), "line", line(c)));
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("valid", valid());
    out.put("diagnostics", diagnostics);
    out.put("methods", ms);
    out.put("classes", classes);
    out.put("package", packageName);
    out.put("findings", Analyzer.findings(this));
    out.put("lines", source.lines().count());
    out.put(
        "note",
        "Граф try/catch показывает консервативные связи исключений. Big O - структурная оценка,"
            + " стоимость вызовов и границы циклов могут быть неизвестны.");
    return out;
  }

  public void close() throws Exception {
    files.close();
  }
}
