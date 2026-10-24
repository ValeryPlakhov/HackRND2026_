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
    // Helper names must not collide with anything in the file (parameters, fields, types).
    String frequency = fresh(m.source, "bpFrequency");
    String value = fresh(m.source, "bpValue");
    String matches = fresh(m.source, "bpMatches");
    String count = fresh(m.source, "bpCount");
    // All int arithmetic intentionally stays int: overflow matches Java's modular semantics.
    String body =
        "{\n"
            + "        java.util.Map<Integer, Integer> " + frequency + " = new java.util.HashMap<>();\n"
            + "        for (int " + value + " : " + param + ") {\n"
            + "            " + frequency + ".merge(" + value + ", 1, Integer::sum);\n"
            + "        }\n"
            + "        int " + matches + " = 0;\n"
            + "        for (int " + count + " : " + frequency + ".values()) {\n"
            + "            " + matches + " += " + count + " * " + count + ";\n"
            + "        }\n"
            + "        return " + matches + ";\n"
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

  /** A name that does not occur as an identifier anywhere in the source. */
  static String fresh(String source, String base) {
    String name = base;
    for (int i = 2; java.util.regex.Pattern.compile("\\b" + java.util.regex.Pattern.quote(name) + "\\b").matcher(source).find(); i++)
      name = base + i;
    return name;
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
    Map<String, ClassTree> owners = new HashMap<>();
    for (Tree type : m.unit.getTypeDecls())
      if (type instanceof ClassTree c) owners.put(c.getSimpleName().toString(), c);
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
      ClassTree owner = owners.get(method.owner());
      String reason = null;
      if (t.getName().contentEquals("main")) reason = "точка входа остаётся на месте";
      else if (owner == null) reason = "метод вложенного класса";
      else if (owner.getKind() != Tree.Kind.CLASS) reason = "метод enum, интерфейса или record";
      else if (!flags.contains(Modifier.STATIC)) reason = "метод экземпляра использует состояние объекта";
      else if (t.getBody() == null
          || flags.contains(Modifier.SYNCHRONIZED)
          || flags.contains(Modifier.NATIVE)
          || !t.getModifiers().getAnnotations().isEmpty()) reason = "особые модификаторы или аннотации";
      if (reason == null) {
        Map<String, Set<Modifier>> values = ownerMembers(owner, false);
        Map<String, Set<Modifier>> methods = ownerMembers(owner, true);
        Set<String> names = identifiers(t.getBody(), false);
        Set<String> calls = identifiers(t.getBody(), true);
        Set<String> locals = locals(t);
        if (names.contains("this") || names.contains("super")) reason = "ссылка this/super";
        // Names are compared as strings, not resolved symbols. Where that could change what a name
        // binds to after the move, the method stays put instead of risking a silent rebinding.
        for (String name : names) {
          if (reason != null) break;
          if (values.containsKey(name) && locals.contains(name))
            reason = "локальная переменная " + name + " совпадает с полем класса: перенос мог бы изменить привязку имени";
          else if (owner.getExtendsClause() != null
              && !values.containsKey(name)
              && !locals.contains(name)
              && Character.isLowerCase(name.charAt(0)))
            reason = "класс наследует члены, а имя " + name + " не разрешено в самом классе";
        }
        for (String name : calls) {
          if (reason != null) break;
          if (owner.getExtendsClause() != null && !methods.containsKey(name))
            reason = "класс наследует члены, а метод " + name + "() не объявлен в самом классе";
        }
        for (String name : names) {
          if (reason != null) break;
          Set<Modifier> modifiers = values.get(name);
          if (modifiers == null || locals.contains(name)) continue;
          if (modifiers.contains(Modifier.PRIVATE)) reason = "использует private-поле " + name;
          else if (!modifiers.contains(Modifier.STATIC)) reason = "использует поле экземпляра " + name;
        }
        for (String name : calls) {
          if (reason != null) break;
          Set<Modifier> modifiers = methods.get(name);
          if (modifiers == null) continue;
          if (modifiers.contains(Modifier.PRIVATE)) reason = "вызывает private-метод " + name + "()";
          else if (!modifiers.contains(Modifier.STATIC)) reason = "вызывает метод экземпляра " + name + "()";
        }
      }
      if (reason != null) skipped.add(Digests.map("methodId", id, "name", t.getName().toString(), "reason", reason));
      else candidates.add(method);
    }
    candidates.sort(Comparator.comparingInt(c -> m.start(c.tree())));
    // javac is the final dependency check; methods named in its diagnostics are left in place.
    for (int round = 0; round < 4; round++) {
      if (candidates.isEmpty())
        throw new IllegalArgumentException("Нет методов, которые можно перенести без изменения контекста");
      Map<JavaModel.Method, int[]> lines = new LinkedHashMap<>();
      Map<String, String> files =
          moveMethods(m, owners, candidates, fileName, className, target, existing, lines);
      var compiled = Runner.compileOnly(files);
      if (Boolean.TRUE.equals(compiled.get("success")))
        return Digests.map(
            "files", files,
            "created", target,
            "className", className,
            "moved", candidates.stream().map(c -> c.tree().getName().toString()).toList(),
            "skipped", skipped);
      String diagnostics = String.valueOf(compiled.get("diagnostics"));
      java.util.regex.Matcher matcher =
          java.util.regex.Pattern.compile(java.util.regex.Pattern.quote(className + ".java") + ":(\\d+):")
              .matcher(diagnostics);
      Set<JavaModel.Method> failing = new LinkedHashSet<>();
      while (matcher.find()) {
        int line = Integer.parseInt(matcher.group(1));
        lines.forEach(
            (method, range) -> {
              if (line >= range[0] && line <= range[1]) failing.add(method);
            });
      }
      if (failing.isEmpty())
        throw new IllegalArgumentException(
            "После переноса проект не собирается, изменения не применены: " + diagnostics);
      for (JavaModel.Method method : failing) {
        candidates.remove(method);
        skipped.add(
            Digests.map(
                "methodId", method.id(), "name", method.tree().getName().toString(),
                "reason", "javac: зависит от контекста исходного класса"));
      }
    }
    throw new IllegalArgumentException("Не удалось выделить класс без ошибок компиляции");
  }

  /**
   * Members of a class by simple name: fields and nested types, or methods. Java keeps the two
   * namespaces apart, so a local variable may share a name with a method. Overloads merge.
   */
  private static Map<String, Set<Modifier>> ownerMembers(ClassTree owner, boolean methods) {
    Map<String, Set<Modifier>> members = new HashMap<>();
    for (Tree member : owner.getMembers()) {
      String name = null;
      Set<Modifier> flags = null;
      if (!methods && member instanceof VariableTree v) {
        name = v.getName().toString();
        flags = v.getModifiers().getFlags();
      } else if (!methods && member instanceof ClassTree c) {
        name = c.getSimpleName().toString();
        flags = EnumSet.of(Modifier.STATIC);
        flags.addAll(c.getModifiers().getFlags());
      } else if (methods
          && member instanceof MethodTree method
          && !method.getName().contentEquals("<init>")) {
        name = method.getName().toString();
        flags = method.getModifiers().getFlags();
      }
      if (name == null) continue;
      Set<Modifier> merged = members.computeIfAbsent(name, key -> EnumSet.of(Modifier.STATIC));
      if (!flags.contains(Modifier.STATIC)) merged.remove(Modifier.STATIC);
      if (flags.contains(Modifier.PRIVATE)) merged.add(Modifier.PRIVATE);
    }
    return members;
  }

  /** Simple names used in a body: either as method-call targets or as values and types. */
  private static Set<String> identifiers(Tree body, boolean calls) {
    Set<String> used = new HashSet<>();
    Set<Tree> selects = Collections.newSetFromMap(new IdentityHashMap<>());
    new TreeScanner<Void, Void>() {
      public Void visitMethodInvocation(MethodInvocationTree x, Void v) {
        selects.add(x.getMethodSelect());
        return super.visitMethodInvocation(x, v);
      }

      public Void visitIdentifier(IdentifierTree x, Void v) {
        if (selects.contains(x) == calls) used.add(x.getName().toString());
        return null;
      }
    }.scan(body, null);
    return used;
  }

  private static Set<String> locals(MethodTree method) {
    Set<String> locals = new HashSet<>();
    for (VariableTree p : method.getParameters()) locals.add(p.getName().toString());
    new TreeScanner<Void, Void>() {
      public Void visitVariable(VariableTree x, Void v) {
        locals.add(x.getName().toString());
        return super.visitVariable(x, v);
      }

      public Void visitClass(ClassTree x, Void v) {
        return null;
      }
    }.scan(method.getBody(), null);
    return locals;
  }

  /** Body text where members that stay behind are qualified with the original class name. */
  /** Text of [base, base + text) with members that stay behind qualified by the original class. */
  private static String qualified(
      JavaModel m,
      List<? extends Tree> scopes,
      int base,
      String text,
      String owner,
      Set<String> values,
      Set<String> methods) {
    int limit = base + text.length();
    List<int[]> spots = new ArrayList<>();
    Set<Tree> labels = Collections.newSetFromMap(new IdentityHashMap<>());
    Set<Tree> selects = Collections.newSetFromMap(new IdentityHashMap<>());
    TreeScanner<Void, Void> scanner =
        new TreeScanner<>() {
          public Void visitCase(CaseTree x, Void v) {
            labels.addAll(x.getExpressions());
            return super.visitCase(x, v);
          }

          public Void visitMethodInvocation(MethodInvocationTree x, Void v) {
            selects.add(x.getMethodSelect());
            return super.visitMethodInvocation(x, v);
          }

          public Void visitIdentifier(IdentifierTree x, Void v) {
            String name = x.getName().toString();
            boolean call = selects.contains(x);
            if (!labels.contains(x) && (call ? methods.contains(name) : values.contains(name))) {
              int start = m.start(x);
              if (start >= base && start < limit)
                spots.add(new int[] {start - base, m.end(x) - base});
            }
            return null;
          }
        };
    for (Tree scope : scopes) if (scope != null) scanner.scan(scope, null);
    spots.sort((a, b) -> Integer.compare(b[0], a[0]));
    for (int[] spot : spots)
      text = text.substring(0, spot[0]) + owner + "." + text.substring(spot[0]);
    return text;
  }

  private static Map<String, String> moveMethods(
      JavaModel m,
      Map<String, ClassTree> owners,
      List<JavaModel.Method> candidates,
      String fileName,
      String className,
      String target,
      Map<String, String> existing,
      Map<JavaModel.Method, int[]> lines) {
    Set<String> moving = new HashSet<>();
    for (JavaModel.Method c : candidates) moving.add(c.owner() + "#" + c.tree().getName());
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
      ClassTree owner = owners.get(c.owner());
      Set<String> values = new HashSet<>(ownerMembers(owner, false).keySet());
      values.removeAll(locals(t));
      Set<String> methods = new HashSet<>();
      for (String name : ownerMembers(owner, true).keySet())
        if (!moving.contains(c.owner() + "#" + name)) methods.add(name);
      String original = m.text(t);
      int rel = m.start(t.getBody()) - m.start(t);
      // Signatures may name nested types of the original class, so they are qualified too.
      List<Tree> signature = new ArrayList<>();
      signature.add(t.getReturnType());
      signature.addAll(t.getTypeParameters());
      for (VariableTree parameter : t.getParameters()) signature.add(parameter.getType());
      signature.addAll(t.getThrows());
      String head =
          qualified(m, signature, m.start(t), original.substring(0, rel), c.owner(), values, Set.of())
              .replaceFirst("\\b(public|private|protected)\\s+", "");
      String body =
          qualified(
              m, List.of(t.getBody()), m.start(t.getBody()), m.text(t.getBody()), c.owner(), values, methods);
      int first = (int) helper.chars().filter(ch -> ch == '\n').count() + 2;
      helper.append("\n    ").append(head).append(body).append("\n");
      int last = (int) helper.chars().filter(ch -> ch == '\n').count();
      lines.put(c, new int[] {first, last});
    }
    helper.append("}\n");
    Map<String, String> files = new LinkedHashMap<>(existing);
    files.put(fileName, source);
    files.put(target, helper.toString());
    return files;
  }

  static String replace(String source, int start, int end, String replacement) {
    if (start < 0 || end < start || end > source.length())
      throw new IllegalArgumentException("Stale source positions");
    return source.substring(0, start) + replacement + source.substring(end);
  }
}
