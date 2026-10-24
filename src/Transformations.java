import com.sun.source.tree.*;
import com.sun.source.util.TreeScanner;
import java.util.*;
import javax.lang.model.element.Modifier;

public final class Transformations {
  /** Deliberately narrow AST pattern: int pair counter over a primitive int[]. */
  static String pattern(JavaModel.Method m) {
    MethodTree t = m.tree();
    if (!t.getModifiers().getFlags().contains(Modifier.STATIC)
        || !String.valueOf(t.getReturnType()).equals("int")
        || t.getParameters().size() != 1
        || !t.getParameters().get(0).getType().toString().equals("int[]")
        || t.getBody() == null) return null;
    try {
      var s = t.getBody().getStatements();
      if (s.size() != 3) return null;
      if (!(s.get(0) instanceof VariableTree count)
          || !count.getType().toString().equals("int")
          || !(count.getInitializer() instanceof LiteralTree lit)
          || !Integer.valueOf(0).equals(lit.getValue())) return null;
      if (!(s.get(1) instanceof EnhancedForLoopTree outer)
          || !(outer.getExpression() instanceof IdentifierTree)
          || !outer
              .getExpression()
              .toString()
              .equals(t.getParameters().get(0).getName().toString())) return null;
      StatementTree a = single(outer.getStatement());
      if (!(a instanceof EnhancedForLoopTree inner)
          || !inner.getExpression().toString().equals(outer.getExpression().toString())
          || !outer.getVariable().getType().toString().equals("int")
          || !inner.getVariable().getType().toString().equals("int")) return null;
      if (!(single(inner.getStatement()) instanceof IfTree test) || test.getElseStatement() != null)
        return null;
      ExpressionTree c = test.getCondition();
      while (c instanceof ParenthesizedTree p) c = p.getExpression();
      if (!(c instanceof BinaryTree b)
          || b.getKind() != Tree.Kind.EQUAL_TO
          || !b.getLeftOperand().toString().equals(outer.getVariable().getName().toString())
          || !b.getRightOperand().toString().equals(inner.getVariable().getName().toString()))
        return null;
      if (!(single(test.getThenStatement()) instanceof ExpressionStatementTree e)
          || !(e.getExpression() instanceof UnaryTree u)
          || (u.getKind() != Tree.Kind.POSTFIX_INCREMENT
              && u.getKind() != Tree.Kind.PREFIX_INCREMENT)
          || !u.getExpression().toString().equals(count.getName().toString())) return null;
      if (!(s.get(2) instanceof ReturnTree ret)
          || !ret.getExpression().toString().equals(count.getName().toString())) return null;
      return t.getParameters().get(0).getName().toString();
    } catch (RuntimeException e) {
      return null;
    }
  }

  static StatementTree single(StatementTree t) {
    while (t instanceof BlockTree b && b.getStatements().size() == 1) t = b.getStatements().get(0);
    return t;
  }

  static boolean canOptimize(JavaModel m, JavaModel.Method method) {
    return pattern(method) != null;
  }

  static Map<String, Object> optimize(JavaModel m, String id) {
    var method = m.method(id);
    String param = pattern(method);
    if (param == null)
      throw new IllegalArgumentException(
          "Нет безопасного шаблона. Автозамена доступна только для чистого подсчёта упорядоченных"
              + " равных пар int[].");
    // All int arithmetic intentionally stays int: overflow matches Java's modular semantics.
    String body =
        "{\n"
            + "        java.util.Map<Integer, Integer> bpFrequency = new java.util.HashMap<>();\n"
            + "        for (int bpValue : "
            + param
            + ") {\n"
            + "            bpFrequency.merge(bpValue, 1, Integer::sum);\n"
            + "        }\n"
            + "        int bpMatches = 0;\n"
            + "        for (int bpCount : bpFrequency.values()) {\n"
            + "            bpMatches += bpCount * bpCount;\n"
            + "        }\n"
            + "        return bpMatches;\n"
            + "    }";
    String result =
        replace(m.source, m.start(method.tree().getBody()), m.end(method.tree().getBody()), body);
    return Map.of(
        "source",
        result,
        "description",
        "Число упорядоченных равных пар = сумма квадратов частот. Среднее время O(n), память O(k)."
            + " Самопары и int overflow сохранены. Подтвердите на входах через quality gate.",
        "before",
        "O(n^2)",
        "after",
        "O(n), expected");
  }

  static String edit(JavaModel m, Map<String, Object> request) throws Exception {
    var method = m.method(Json.str(request, "methodId", ""));
    String id = Json.str(request, "nodeId", "");
    @SuppressWarnings("unchecked")
    var ns = (List<Map<String, Object>>) new GraphBuilder(m).build(method).get("nodes");
    var n =
        ns.stream()
            .filter(x -> id.equals(x.get("id")))
            .findFirst()
            .orElseThrow(() -> new IllegalArgumentException("Unknown node"));
    int a = (int) n.get("editStart"), b = (int) n.get("editEnd");
    if (a < 0 || b < a)
      throw new IllegalArgumentException("Этот структурный узел не редактируется напрямую");
    String action = Json.str(request, "action", "replace"), code = Json.str(request, "code", "");
    if (action.equals("delete")) {
      String kind = (String) n.get("kind");
      if (!Set.of("operation", "variable", "return", "throw").contains(kind))
        throw new IllegalArgumentException("Удалять можно только узел инструкции");
      code = ";";
    } else if (action.equals("before") || action.equals("after")) {
      if (!Set.of("operation", "variable", "return", "throw", "break", "continue")
          .contains(n.get("kind")))
        throw new IllegalArgumentException("Вставка доступна рядом с инструкцией");
      String original = m.source.substring(a, b);
      code =
          action.equals("before")
              ? "{\n" + code + "\n" + original + "\n}"
              : "{\n" + original + "\n" + code + "\n}";
      if (n.get("kind").equals("variable"))
        throw new IllegalArgumentException(
            "Вставка у объявления меняет область видимости. Используйте редактор Java.");
    } else if (!action.equals("replace")) throw new IllegalArgumentException("Unknown edit action");
    String result = replace(m.source, a, b, code);
    try (JavaModel checked = new JavaModel(result)) {
      if (!checked.valid())
        throw new IllegalArgumentException(
            "Правка не принята: " + Json.stringify(checked.diagnostics));
    }
    return result;
  }

  static Map<String, String> extract(
      JavaModel m, String id, String fileName, Map<String, String> existing) throws Exception {
    var method = m.method(id);
    MethodTree t = method.tree();
    Set<Modifier> flags = t.getModifiers().getFlags();
    if (!flags.contains(Modifier.STATIC)
        || flags.contains(Modifier.SYNCHRONIZED)
        || flags.contains(Modifier.NATIVE)
        || t.getBody() == null
        || !t.getModifiers().getAnnotations().isEmpty())
      throw new IllegalArgumentException(
          "Выберите независимый static-метод без synchronized/native и аннотаций");
    final boolean[] unsafe = {false};
    new TreeScanner<Void, Void>() {
      public Void visitMethodInvocation(MethodInvocationTree x, Void v) {
        String call = x.getMethodSelect().toString();
        if (call.equals(t.getName().toString()) || call.endsWith("." + t.getName()))
          unsafe[0] = true;
        return super.visitMethodInvocation(x, v);
      }

      public Void visitIdentifier(IdentifierTree x, Void v) {
        if (Set.of("this", "super").contains(x.getName().toString())) unsafe[0] = true;
        return null;
      }
    }.scan(t.getBody(), null);
    if (unsafe[0])
      throw new IllegalArgumentException(
          "Рекурсивный метод или ссылка this/super не переносится автоматически");
    String helper = "BlueprintFunctions";
    if (existing.containsKey(helper + ".java")
        || m.source.matches("(?s).*\\b(class|interface|record|enum)\\s+" + helper + "\\b.*"))
      throw new IllegalArgumentException("Имя BlueprintFunctions уже занято");
    String args =
        String.join(", ", t.getParameters().stream().map(p -> p.getName().toString()).toList());
    String delegate =
        "{\n        "
            + (t.getReturnType().toString().equals("void") ? "" : "return ")
            + helper
            + "."
            + t.getName()
            + "("
            + args
            + ");\n    }";
    String original = m.text(t);
    int rel = m.start(t.getBody()) - m.start(t);
    String head = original.substring(0, rel).replaceFirst("\\b(public|private|protected)\\s+", "");
    String imports = String.join("\n", m.unit.getImports().stream().map(Object::toString).toList());
    String pkg =
        m.unit.getPackageName() == null ? "" : "package " + m.unit.getPackageName() + ";\n";
    Map<String, String> files = new LinkedHashMap<>(existing);
    files.put(fileName, replace(m.source, m.start(t.getBody()), m.end(t.getBody()), delegate));
    files.put(
        helper + ".java",
        pkg
            + imports
            + "\n\nfinal class "
            + helper
            + " {\n    private "
            + helper
            + "() {}\n    "
            + head
            + m.text(t.getBody())
            + "\n}\n");
    // Compilation is a dependency check, not a proof of behavioral equivalence.
    var compiled = Runner.compileOnly(files);
    if (!Boolean.TRUE.equals(compiled.get("success")))
      throw new IllegalArgumentException(
          "Метод зависит от контекста класса и не переносится: " + compiled.get("diagnostics"));
    return files;
  }

  static String replace(String source, int start, int end, String replacement) {
    if (start < 0 || end < start || end > source.length())
      throw new IllegalArgumentException("Stale source positions");
    return source.substring(0, start) + replacement + source.substring(end);
  }
}
