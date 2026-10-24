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
    if (existing.containsKey(sibling(fileName, helper))
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
        sibling(fileName, helper),
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

  static String sibling(String fileName, String simple) {
    int slash = fileName.lastIndexOf('/');
    return (slash < 0 ? "" : fileName.substring(0, slash + 1)) + simple + ".java";
  }

  /**
   * Moves a group of independent static methods into a new top-level class and leaves delegates.
   * Candidates that depend on class state, nested types or methods outside the group are skipped;
   * the final javac run is the dependency check.
   */
  static Map<String, Object> decompose(
      JavaModel m, List<String> ids, String fileName, String className, Map<String, String> existing)
      throws Exception {
    if (!className.matches("[A-Z][A-Za-z0-9_]{0,60}"))
      throw new IllegalArgumentException("Имя класса: латиница с заглавной буквы, например OrderParser");
    String target = sibling(fileName, className);
    if (existing.containsKey(target)
        || existing.values().stream()
            .anyMatch(s -> s.matches("(?s).*\\b(class|interface|record|enum)\\s+" + className + "\\b.*")))
      throw new IllegalArgumentException("Класс " + className + " уже существует");
    Set<String> ownerNames = new HashSet<>();
    Set<String> nestedTypes = new HashSet<>();
    for (Tree type : m.unit.getTypeDecls())
      if (type instanceof ClassTree c) {
        for (Tree member : c.getMembers()) {
          if (member instanceof VariableTree v) ownerNames.add(v.getName().toString());
          if (member instanceof ClassTree nested) nestedTypes.add(nested.getSimpleName().toString());
        }
      }
    Map<String, JavaModel.Method> byName = new LinkedHashMap<>();
    for (JavaModel.Method method : m.methods) byName.putIfAbsent(method.tree().getName().toString(), method);
    List<JavaModel.Method> candidates = new ArrayList<>();
    List<Object> skipped = new ArrayList<>();
    for (String id : ids) {
      JavaModel.Method method;
      try {
        method = m.method(id);
      } catch (IllegalArgumentException missing) {
        continue;
      }
      MethodTree t = method.tree();
      Set<Modifier> flags = t.getModifiers().getFlags();
      String reason = null;
      if (t.getName().contentEquals("main")) reason = "точка входа остаётся на месте";
      else if (!flags.contains(Modifier.STATIC)) reason = "метод экземпляра использует состояние объекта";
      else if (t.getBody() == null
          || flags.contains(Modifier.SYNCHRONIZED)
          || flags.contains(Modifier.NATIVE)
          || !t.getModifiers().getAnnotations().isEmpty()) reason = "особые модификаторы или аннотации";
      else if (method.owner().contains(".")) reason = "метод вложенного класса";
      if (reason == null) {
        Set<String> used = new HashSet<>();
        new TreeScanner<Void, Void>() {
          public Void visitIdentifier(IdentifierTree x, Void v) {
            used.add(x.getName().toString());
            return null;
          }
        }.scan(t.getBody(), null);
        Set<String> locals = new HashSet<>();
        for (VariableTree p : t.getParameters()) locals.add(p.getName().toString());
        new TreeScanner<Void, Void>() {
          public Void visitVariable(VariableTree x, Void v) {
            locals.add(x.getName().toString());
            return super.visitVariable(x, v);
          }
        }.scan(t.getBody(), null);
        if (used.contains("this") || used.contains("super")) reason = "ссылка this/super";
        else if (used.stream().anyMatch(name -> ownerNames.contains(name) && !locals.contains(name)))
          reason = "читает поля исходного класса";
        else if (used.stream().anyMatch(nestedTypes::contains)) reason = "использует вложенные типы класса";
      }
      if (reason != null) skipped.add(Digests.map("methodId", id, "name", t.getName().toString(), "reason", reason));
      else candidates.add(method);
    }
    // Calls to methods of the original class that stay behind would no longer resolve.
    boolean changed = true;
    while (changed) {
      changed = false;
      Set<String> moving = new HashSet<>();
      for (JavaModel.Method c : candidates) moving.add(c.tree().getName().toString());
      for (Iterator<JavaModel.Method> it = candidates.iterator(); it.hasNext(); ) {
        JavaModel.Method c = it.next();
        Set<String> calls = new HashSet<>();
        new TreeScanner<Void, Void>() {
          public Void visitMethodInvocation(MethodInvocationTree x, Void v) {
            if (x.getMethodSelect() instanceof IdentifierTree id) calls.add(id.getName().toString());
            return super.visitMethodInvocation(x, v);
          }
        }.scan(c.tree().getBody(), null);
        String blocked =
            calls.stream().filter(name -> byName.containsKey(name) && !moving.contains(name)).findFirst().orElse(null);
        if (blocked != null) {
          it.remove();
          skipped.add(
              Digests.map(
                  "methodId", c.id(), "name", c.tree().getName().toString(),
                  "reason", "вызывает " + blocked + "(), который остаётся в исходном классе"));
          changed = true;
        }
      }
    }
    if (candidates.isEmpty())
      throw new IllegalArgumentException("Нет методов, которые можно перенести без изменения контекста");
    candidates.sort(Comparator.comparingInt(c -> m.start(c.tree())));
    String imports = String.join("\n", m.unit.getImports().stream().map(Object::toString).toList());
    String pkg = m.unit.getPackageName() == null ? "" : "package " + m.unit.getPackageName() + ";\n";
    StringBuilder helper = new StringBuilder();
    helper.append(pkg).append(imports).append(imports.isEmpty() ? "" : "\n").append("\n");
    helper.append("/** Выделено из ").append(Runner.simpleName(fileName)).append(" инструментом Blueprints. */\n");
    helper.append("final class ").append(className).append(" {\n    private ").append(className).append("() {}\n");
    String source = m.source;
    for (int i = candidates.size() - 1; i >= 0; i--) {
      MethodTree t = candidates.get(i).tree();
      String args = String.join(", ", t.getParameters().stream().map(p -> p.getName().toString()).toList());
      String delegate =
          "{\n        "
              + (t.getReturnType().toString().equals("void") ? "" : "return ")
              + className + "." + t.getName() + "(" + args + ");\n    }";
      source = replace(source, m.start(t.getBody()), m.end(t.getBody()), delegate);
    }
    for (JavaModel.Method c : candidates) {
      MethodTree t = c.tree();
      String original = m.text(t);
      int rel = m.start(t.getBody()) - m.start(t);
      String head = original.substring(0, rel).replaceFirst("\\b(public|private|protected)\\s+", "");
      helper.append("\n    ").append(head).append(m.text(t.getBody())).append("\n");
    }
    helper.append("}\n");
    Map<String, String> files = new LinkedHashMap<>(existing);
    files.put(fileName, source);
    files.put(target, helper.toString());
    var compiled = Runner.compileOnly(files);
    if (!Boolean.TRUE.equals(compiled.get("success")))
      throw new IllegalArgumentException(
          "После переноса проект не собирается, изменения не применены: " + compiled.get("diagnostics"));
    return Digests.map(
        "files", files,
        "created", target,
        "className", className,
        "moved", candidates.stream().map(c -> c.tree().getName().toString()).toList(),
        "skipped", skipped);
  }

  static String replace(String source, int start, int end, String replacement) {
    if (start < 0 || end < start || end > source.length())
      throw new IllegalArgumentException("Stale source positions");
    return source.substring(0, start) + replacement + source.substring(end);
  }
}
