import com.sun.source.tree.*;
import com.sun.source.util.TreeScanner;
import java.util.*;
import javax.lang.model.element.Modifier;

/** Recomputable, content-addressed rewrite plans. Application rejects stale source and overlaps. */
public final class RefactorPlans {
  public record Plan(
      String id,
      String rule,
      String title,
      String description,
      String methodId,
      int start,
      int end,
      int line,
      String before,
      String after,
      String timeBefore,
      String timeAfter,
      String memoryAfter,
      String rationale) {
    Map<String, Object> json() {
      return Digests.map(
          "id",
          id,
          "rule",
          rule,
          "title",
          title,
          "description",
          description,
          "methodId",
          methodId,
          "start",
          start,
          "end",
          end,
          "line",
          line,
          "before",
          before,
          "after",
          after,
          "timeBefore",
          timeBefore,
          "timeAfter",
          timeAfter,
          "memoryAfter",
          memoryAfter,
          "rationale",
          rationale,
          "status",
          "proposed",
          "requiresGate",
          true);
    }
  }

  private final JavaModel model;
  private final List<Plan> plans = new ArrayList<>();

  public RefactorPlans(JavaModel model) {
    this.model = model;
  }

  public List<Plan> collect() {
    for (JavaModel.Method method : model.methods) {
      if (Transformations.canOptimize(model, method)) {
        Map<String, Object> transformed = Transformations.optimize(model, method.id());
        int bodyStart = model.start(method.tree().getBody());
        int bodyEnd = model.end(method.tree().getBody());
        String source = String.valueOf(transformed.get("source"));
        int suffix = model.source.length() - bodyEnd;
        String body = source.substring(bodyStart, source.length() - suffix);
        add(
            method,
            method.tree().getBody(),
            "histogram-pairs",
            "Индекс частот вместо парного обхода",
            body,
            "O(n²)",
            "O(n), expected",
            "O(k)",
            "Каждое значение с частотой f даёт f² упорядоченных пар. Сохраняется int overflow.",
            "Подходит для чистого счётчика равных пар int[]. Меняется профиль памяти;"
                + " OutOfMemoryError не эквивалентен.");
      }
      String builderBody = stringBuilderBody(method);
      if (builderBody != null) {
        add(
            method,
            method.tree().getBody(),
            "string-builder",
            "Линейное накопление строки",
            builderBody,
            "O(total²), upper estimate",
            "O(total), amortized",
            "O(total)",
            "Чистый String-аккумулятор заменяется на StringBuilder. append(String) сохраняет"
                + " преобразование null в текст null.",
            "Применимо только к методу String(String[]) с тремя инструкциями: пустая строка,"
                + " foreach += элемент, return.");
      }
      new TreeScanner<Void, Void>() {
        public Void visitIf(IfTree tree, Void ignored) {
          ExpressionTree condition = unwrap(tree.getCondition());
          if (condition instanceof LiteralTree literal
              && literal.getValue() instanceof Boolean selected) {
            StatementTree retained = selected ? tree.getThenStatement() : tree.getElseStatement();
            add(
                method,
                tree,
                "constant-branch",
                "Убрать константную ветвь",
                retained == null ? ";" : model.text(retained),
                "unchanged",
                "unchanged",
                "unchanged",
                "Булев литерал не имеет побочных эффектов. Выбранная ветвь сохраняется с исходной"
                    + " областью видимости.",
                "Убирается только ветвь, которая никогда не выбирается при буквальном true/false.");
            return null;
          }
          if (tree.getThenStatement() instanceof BlockTree thenBlock
              && tree.getElseStatement() instanceof BlockTree elseBlock
              && terminal(thenBlock)) {
            String replacement =
                "{\n    if "
                    + model.text(tree.getCondition())
                    + " "
                    + model.text(thenBlock)
                    + "\n    "
                    + model.text(elseBlock)
                    + "\n}";
            add(
                method,
                tree,
                "guard-clause",
                "Упростить else после return/throw",
                replacement,
                "unchanged",
                "unchanged",
                "unchanged",
                "Если then завершается return/throw, исполнение else возможно только после ложного"
                    + " условия. Внешний блок сохраняет одну инструкцию для родителя.",
                "Сохраняются отдельные блоки ветвей и однократное вычисление условия. Стек и номера"
                    + " строк могут измениться.");
          }
          return super.visitIf(tree, ignored);
        }

        public Void visitBinary(BinaryTree tree, Void ignored) {
          Integer left = integer(tree.getLeftOperand());
          Integer right = integer(tree.getRightOperand());
          if (left != null && right != null) {
            Integer result = fold(tree.getKind(), left, right);
            if (result != null) {
              add(
                  method,
                  tree,
                  "integer-fold",
                  "Свернуть целочисленную константу",
                  "(" + result + ")",
                  "O(1)",
                  "O(1)",
                  "O(1)",
                  "Операция вычислена в Java int с теми же правилами overflow и маскирования shift"
                      + " distance.",
                  "Нулевой делитель не сворачивается. Числа long/float/double и выражения с"
                      + " вызовами не затрагиваются.");
              return null;
            }
          }
          return super.visitBinary(tree, ignored);
        }

        public Void visitClass(ClassTree tree, Void ignored) {
          return null;
        }

        public Void visitLambdaExpression(LambdaExpressionTree tree, Void ignored) {
          return null;
        }
      }.scan(method.tree().getBody(), null);
      dedupePlans(method);
      containsInLoopPlans(method);
    }
    return List.copyOf(plans);
  }

  // ---------------------------------------------------------------- collection plans

  private static final Set<String> VALUE_TYPES =
      Set.of(
          "String", "Integer", "Long", "Short", "Byte", "Character", "Boolean", "Double", "Float",
          "java.lang.String", "java.lang.Integer", "java.lang.Long", "UUID", "BigInteger",
          "BigDecimal", "LocalDate");
  private static final Set<String> READ_ONLY =
      Set.of(
          "size", "get", "isEmpty", "iterator", "stream", "forEach", "toString", "toArray",
          "indexOf", "lastIndexOf", "contains", "getFirst", "getLast", "subList", "hashCode");

  /** Types whose equals and hashCode agree, so a HashSet answers like List.contains. */
  private Set<String> hashableTypes() {
    Set<String> types = new HashSet<>(VALUE_TYPES);
    for (Tree type : model.unit.getTypeDecls())
      if (type instanceof ClassTree c) {
        String name = c.getSimpleName().toString();
        if (c.getKind() == Tree.Kind.RECORD || c.getKind() == Tree.Kind.ENUM) types.add(name);
        boolean equals = false;
        boolean hash = false;
        for (Tree member : c.getMembers())
          if (member instanceof MethodTree m) {
            if (m.getName().contentEquals("equals") && m.getParameters().size() == 1) equals = true;
            if (m.getName().contentEquals("hashCode") && m.getParameters().isEmpty()) hash = true;
          }
        if (equals && hash) types.add(name);
      }
    return types;
  }

  private record ListVariable(VariableTree declaration, String element, boolean fresh) {}

  /** Local lists and parameters of a method with a hash-safe element type. */
  private Map<String, ListVariable> lists(JavaModel.Method method) {
    Set<String> hashable = hashableTypes();
    Map<String, ListVariable> lists = new HashMap<>();
    List<VariableTree> variables = new ArrayList<>(method.tree().getParameters());
    new TreeScanner<Void, Void>() {
      public Void visitVariable(VariableTree x, Void v) {
        variables.add(x);
        return super.visitVariable(x, v);
      }

      public Void visitClass(ClassTree x, Void v) {
        return null;
      }

      public Void visitLambdaExpression(LambdaExpressionTree x, Void v) {
        return null;
      }
    }.scan(method.tree().getBody(), null);
    Set<String> seen = new HashSet<>();
    for (VariableTree variable : variables) {
      String name = variable.getName().toString();
      if (!seen.add(name)) {
        lists.remove(name); // shadowed or redeclared names are ambiguous for a lexical rewrite
        continue;
      }
      if (!(variable.getType() instanceof ParameterizedTypeTree type)) continue;
      String raw = type.getType().toString();
      if (!Set.of("List", "ArrayList", "LinkedList", "Collection", "java.util.List").contains(raw)
          || type.getTypeArguments().size() != 1) continue;
      String element = type.getTypeArguments().get(0).toString();
      if (!hashable.contains(element)) continue;
      boolean fresh =
          variable.getInitializer() instanceof NewClassTree created
              && created.getArguments().isEmpty()
              && Set.of("ArrayList", "LinkedList")
                  .contains(created.getIdentifier().toString().replaceAll("<.*", ""));
      lists.put(name, new ListVariable(variable, element, fresh));
    }
    return lists;
  }

  private static String receiver(MethodInvocationTree call) {
    return call.getMethodSelect() instanceof MemberSelectTree select
            && select.getExpression() instanceof IdentifierTree id
        ? id.getName().toString()
        : null;
  }

  private static String member(MethodInvocationTree call) {
    return call.getMethodSelect() instanceof MemberSelectTree select
        ? select.getIdentifier().toString()
        : "";
  }

  private Set<String> names(Tree tree) {
    Set<String> names = new HashSet<>();
    new TreeScanner<Void, Void>() {
      public Void visitIdentifier(IdentifierTree x, Void v) {
        names.add(x.getName().toString());
        return null;
      }

      public Void visitVariable(VariableTree x, Void v) {
        names.add(x.getName().toString());
        return super.visitVariable(x, v);
      }
    }.scan(tree, null);
    return names;
  }

  private static String fresh(String base, Set<String> taken) {
    String name = base;
    for (int i = 2; taken.contains(name); i++) name = base + i;
    return name;
  }

  /** if (!list.contains(x)) list.add(x); over a local list: a HashSet answers membership in O(1). */
  private void dedupePlans(JavaModel.Method method) {
    Map<String, ListVariable> lists = lists(method);
    if (lists.isEmpty()) return;
    Map<String, List<IfTree>> guards = new HashMap<>();
    Map<String, Boolean> safe = new HashMap<>();
    Set<Tree> guardedAdds = Collections.newSetFromMap(new IdentityHashMap<>());
    Set<Tree> guardedContains = Collections.newSetFromMap(new IdentityHashMap<>());
    new TreeScanner<Void, Void>() {
      public Void visitIf(IfTree tree, Void v) {
        ExpressionTree condition = unwrap(tree.getCondition());
        if (tree.getElseStatement() == null
            && condition instanceof UnaryTree not
            && not.getKind() == Tree.Kind.LOGICAL_COMPLEMENT
            && unwrap(not.getExpression()) instanceof MethodInvocationTree contains
            && member(contains).equals("contains")
            && contains.getArguments().size() == 1
            && lists.containsKey(receiver(contains))
            && Transformations.single(tree.getThenStatement())
                instanceof ExpressionStatementTree statement
            && statement.getExpression() instanceof MethodInvocationTree add
            && member(add).equals("add")
            && receiver(contains).equals(receiver(add))
            && add.getArguments().size() == 1
            && add.getArguments().get(0).toString().equals(contains.getArguments().get(0).toString())) {
          guards.computeIfAbsent(receiver(contains), key -> new ArrayList<>()).add(tree);
          guardedAdds.add(add);
          guardedContains.add(contains);
        }
        return super.visitIf(tree, v);
      }
    }.scan(method.tree().getBody(), null);
    if (guards.isEmpty()) return;
    // Every other use must leave membership unchanged, otherwise the set would drift from the list.
    new TreeScanner<Void, Void>() {
      public Void visitMethodInvocation(MethodInvocationTree call, Void v) {
        String target = receiver(call);
        if (target != null && guards.containsKey(target)
            && !guardedAdds.contains(call) && !guardedContains.contains(call)
            && !READ_ONLY.contains(member(call))) safe.put(target, false);
        for (ExpressionTree argument : call.getArguments())
          if (unwrap(argument) instanceof IdentifierTree id && guards.containsKey(id.getName().toString()))
            safe.put(id.getName().toString(), false);
        return super.visitMethodInvocation(call, v);
      }

      public Void visitAssignment(AssignmentTree x, Void v) {
        if (x.getVariable() instanceof IdentifierTree id && guards.containsKey(id.getName().toString()))
          safe.put(id.getName().toString(), false);
        return super.visitAssignment(x, v);
      }

      public Void visitLambdaExpression(LambdaExpressionTree x, Void v) {
        for (String name : names(x)) if (guards.containsKey(name)) safe.put(name, false);
        return null;
      }
    }.scan(method.tree().getBody(), null);
    Set<String> taken = names(method.tree());
    for (Map.Entry<String, List<IfTree>> entry : guards.entrySet()) {
      String list = entry.getKey();
      ListVariable variable = lists.get(list);
      if (Boolean.FALSE.equals(safe.get(list)) || !variable.fresh()) continue;
      String set = fresh(list + "Seen", taken);
      int start = model.start(variable.declaration());
      int end = entry.getValue().stream().mapToInt(model::end).max().orElse(-1);
      if (start < 0 || end <= start) continue;
      StringBuilder rewritten = new StringBuilder(model.source.substring(start, end));
      List<IfTree> ordered = new ArrayList<>(entry.getValue());
      ordered.sort((a, b) -> Integer.compare(model.start(b), model.start(a)));
      for (IfTree guard : ordered) {
        ExpressionTree condition = unwrap(guard.getCondition());
        MethodInvocationTree contains =
            (MethodInvocationTree) unwrap(((UnaryTree) condition).getExpression());
        rewritten.replace(
            model.start(condition) - start,
            model.end(condition) - start,
            set + ".add(" + model.text(contains.getArguments().get(0)) + ")");
      }
      int declared = model.source.indexOf(';', model.end(variable.declaration()) - 1) + 1;
      String indent = indentation(start);
      rewritten.insert(
          declared - start,
          "\n" + indent + "java.util.Set<" + variable.element() + "> " + set + " = new java.util.HashSet<>();");
      add(
          method,
          start,
          end,
          variable.declaration(),
          "dedupe-set",
          "Проверка уникальности через HashSet",
          rewritten.toString(),
          "O(n²)",
          "O(n), expected",
          "O(n)",
          "Список " + list + " наполняется только через проверку !contains → add. Параллельный"
              + " HashSet отвечает на тот же вопрос за O(1); порядок и содержимое списка не меняются.",
          "Тип элементов " + variable.element() + " согласует equals и hashCode; список локальный,"
              + " не передаётся в другие методы и не изменяется иначе.");
    }
  }

  private String indentation(int offset) {
    int lineStart = model.source.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
    int index = lineStart;
    while (index < offset && Character.isWhitespace(model.source.charAt(index))) index++;
    return model.source.substring(lineStart, index);
  }

  /** list.contains(x) inside a loop that never changes the list: build a HashSet once. */
  private void containsInLoopPlans(JavaModel.Method method) {
    Map<String, ListVariable> lists = lists(method);
    if (lists.isEmpty()) return;
    Set<String> taken = names(method.tree());
    new TreeScanner<Void, Void>() {
      void loop(StatementTree loop, StatementTree body) {
        Map<String, List<MethodInvocationTree>> lookups = new LinkedHashMap<>();
        Set<String> modified = new HashSet<>();
        new TreeScanner<Void, Void>() {
          public Void visitMethodInvocation(MethodInvocationTree call, Void v) {
            String target = receiver(call);
            if (target != null && lists.containsKey(target)) {
              if (member(call).equals("contains") && call.getArguments().size() == 1)
                lookups.computeIfAbsent(target, key -> new ArrayList<>()).add(call);
              else if (!READ_ONLY.contains(member(call))) modified.add(target);
            }
            for (ExpressionTree argument : call.getArguments())
              if (unwrap(argument) instanceof IdentifierTree id) modified.add(id.getName().toString());
            return super.visitMethodInvocation(call, v);
          }

          public Void visitAssignment(AssignmentTree x, Void v) {
            if (x.getVariable() instanceof IdentifierTree id) modified.add(id.getName().toString());
            return super.visitAssignment(x, v);
          }

          public Void visitLambdaExpression(LambdaExpressionTree x, Void v) {
            modified.addAll(names(x));
            return null;
          }

          public Void visitClass(ClassTree x, Void v) {
            return null;
          }
        }.scan(body, null);
        int start = model.start(loop);
        int end = model.end(loop);
        if (start < 0 || end <= start) return;
        String before = model.source.substring(model.source.lastIndexOf('\n', start - 1) + 1, start);
        if (!before.isBlank()) return; // labelled or inline loops keep their exact shape
        for (Map.Entry<String, List<MethodInvocationTree>> entry : lookups.entrySet()) {
          String list = entry.getKey();
          if (modified.contains(list)) continue;
          ListVariable variable = lists.get(list);
          if (model.start(variable.declaration()) > start) continue;
          String set = fresh(list + "Set", taken);
          StringBuilder text = new StringBuilder(model.source.substring(start, end));
          List<MethodInvocationTree> calls = new ArrayList<>(entry.getValue());
          calls.sort((a, b) -> Integer.compare(model.start(b), model.start(a)));
          for (MethodInvocationTree call : calls) {
            ExpressionTree select = ((MemberSelectTree) call.getMethodSelect()).getExpression();
            text.replace(model.start(select) - start, model.end(select) - start, set);
          }
          String indent = indentation(start);
          String replacement =
              "java.util.Set<" + variable.element() + "> " + set + " = new java.util.HashSet<>(" + list
                  + ");\n" + indent + text;
          add(
              method,
              start,
              end,
              loop,
              "contains-to-set",
              "HashSet для поиска в цикле",
              replacement,
              "O(n·m)",
              "O(n + m), expected",
              "O(m)",
              "Список " + list + " не меняется внутри цикла, поэтому его можно один раз скопировать в"
                  + " HashSet и проверять принадлежность за O(1).",
              "Тип " + variable.element() + " согласует equals и hashCode; цикл не изменяет список и не"
                  + " передаёт его в другие методы. Новая переменная объявляется перед циклом.");
          return; // one lookup set per loop keeps plans non-overlapping
        }
      }

      public Void visitEnhancedForLoop(EnhancedForLoopTree x, Void v) {
        loop(x, x.getStatement());
        return super.visitEnhancedForLoop(x, v);
      }

      public Void visitForLoop(ForLoopTree x, Void v) {
        loop(x, x.getStatement());
        return super.visitForLoop(x, v);
      }

      public Void visitWhileLoop(WhileLoopTree x, Void v) {
        loop(x, x.getStatement());
        return super.visitWhileLoop(x, v);
      }

      public Void visitClass(ClassTree x, Void v) {
        return null;
      }

      public Void visitLambdaExpression(LambdaExpressionTree x, Void v) {
        return null;
      }
    }.scan(method.tree().getBody(), null);
  }

  private void add(
      JavaModel.Method method,
      int start,
      int end,
      Tree anchor,
      String rule,
      String title,
      String replacement,
      String beforeCost,
      String afterCost,
      String memory,
      String rationale,
      String description) {
    for (Plan plan : plans) if (start < plan.end() && plan.start() < end) return;
    String id =
        Digests.sha256(model.source + "\n" + rule + ":" + start + ":" + replacement).substring(0, 20);
    plans.add(
        new Plan(
            id, rule, title, description, method.id(), start, end, model.line(anchor),
            model.source.substring(start, end), replacement, beforeCost, afterCost, memory,
            rationale));
  }

  private void add(
      JavaModel.Method method,
      Tree tree,
      String rule,
      String title,
      String replacement,
      String beforeCost,
      String afterCost,
      String memory,
      String rationale,
      String description) {
    int start = model.start(tree);
    int end = model.end(tree);
    if (start < 0 || end < start) return;
    String id =
        Digests.sha256(model.source + "\n" + rule + ":" + start + ":" + replacement)
            .substring(0, 20);
    plans.add(
        new Plan(
            id,
            rule,
            title,
            description,
            method.id(),
            start,
            end,
            model.line(tree),
            model.text(tree),
            replacement,
            beforeCost,
            afterCost,
            memory,
            rationale));
  }

  private static boolean terminal(BlockTree block) {
    List<? extends StatementTree> statements = block.getStatements();
    if (statements.isEmpty()) return false;
    StatementTree last = statements.get(statements.size() - 1);
    return last instanceof ReturnTree || last instanceof ThrowTree;
  }

  private String stringBuilderBody(JavaModel.Method method) {
    MethodTree tree = method.tree();
    if (!tree.getModifiers().getFlags().contains(Modifier.STATIC)
        || !Set.of("String", "java.lang.String").contains(String.valueOf(tree.getReturnType()))
        || tree.getParameters().size() != 1
        || tree.getBody() == null
        || !Set.of("String[]", "java.lang.String[]")
            .contains(tree.getParameters().get(0).getType().toString())) return null;
    List<? extends StatementTree> statements = tree.getBody().getStatements();
    if (statements.size() != 3
        || !(statements.get(0) instanceof VariableTree accumulator)
        || !Set.of("String", "java.lang.String").contains(accumulator.getType().toString())
        || !(accumulator.getInitializer() instanceof LiteralTree initial)
        || !"".equals(initial.getValue())
        || !(statements.get(1) instanceof EnhancedForLoopTree loop)
        || !Set.of("String", "java.lang.String").contains(loop.getVariable().getType().toString())
        || !loop.getExpression().toString().equals(tree.getParameters().get(0).getName().toString())
        || !(Transformations.single(loop.getStatement())
            instanceof ExpressionStatementTree instruction)
        || !(instruction.getExpression() instanceof CompoundAssignmentTree concatenation)
        || concatenation.getKind() != Tree.Kind.PLUS_ASSIGNMENT
        || !concatenation.getVariable().toString().equals(accumulator.getName().toString())
        || !concatenation.getExpression().toString().equals(loop.getVariable().getName().toString())
        || !(statements.get(2) instanceof ReturnTree returned)
        || !returned.getExpression().toString().equals(accumulator.getName().toString()))
      return null;
    String name = "bpTextBuilder";
    while (name.equals(tree.getParameters().get(0).getName().toString())
        || name.equals(loop.getVariable().getName().toString())) name += "_";
    return "{\n    java.lang.StringBuilder "
        + name
        + " = new java.lang.StringBuilder();\n"
        + "    for (java.lang.String "
        + loop.getVariable().getName()
        + " : "
        + loop.getExpression()
        + ") {\n"
        + "        "
        + name
        + ".append("
        + loop.getVariable().getName()
        + ");\n"
        + "    }\n    return "
        + name
        + ".toString();\n}";
  }

  static Integer integer(ExpressionTree expression) {
    expression = unwrap(expression);
    if (expression instanceof LiteralTree literal && literal.getValue() instanceof Integer value)
      return value;
    if (expression instanceof UnaryTree unary) {
      Integer value = integer(unary.getExpression());
      if (value != null) {
        if (unary.getKind() == Tree.Kind.UNARY_MINUS) return -value;
        if (unary.getKind() == Tree.Kind.UNARY_PLUS) return value;
        if (unary.getKind() == Tree.Kind.BITWISE_COMPLEMENT) return ~value;
      }
    }
    return null;
  }

  static Integer fold(Tree.Kind kind, int a, int b) {
    return switch (kind) {
      case PLUS -> a + b;
      case MINUS -> a - b;
      case MULTIPLY -> a * b;
      case DIVIDE -> b == 0 ? null : a / b;
      case REMAINDER -> b == 0 ? null : a % b;
      case LEFT_SHIFT -> a << b;
      case RIGHT_SHIFT -> a >> b;
      case UNSIGNED_RIGHT_SHIFT -> a >>> b;
      case AND -> a & b;
      case OR -> a | b;
      case XOR -> a ^ b;
      default -> null;
    };
  }

  private static ExpressionTree unwrap(ExpressionTree expression) {
    while (expression instanceof ParenthesizedTree parenthesized)
      expression = parenthesized.getExpression();
    return expression;
  }

  public static Map<String, Object> preview(String source) throws Exception {
    try (JavaModel model = new JavaModel(source)) {
      if (!model.valid())
        return Digests.map(
            "sourceHash",
            Digests.sha256(source),
            "plans",
            List.of(),
            "diagnostics",
            model.diagnostics);
      List<Plan> plans = new RefactorPlans(model).collect();
      return Digests.map(
          "sourceHash",
          Digests.sha256(source),
          "plans",
          plans.stream().map(plan -> (Object) plan.json()).toList(),
          "rules",
          List.of(
              "histogram-pairs",
              "string-builder",
              "constant-branch",
              "guard-clause",
              "integer-fold",
              "dedupe-set",
              "contains-to-set"));
    }
  }

  public static Map<String, Object> apply(String source, String sourceHash, List<String> ids)
      throws Exception {
    Digests.requireSource(source, sourceHash);
    if (ids.isEmpty() || ids.size() > 24)
      throw new IllegalArgumentException("Выберите от 1 до 24 предложений");
    try (JavaModel model = new JavaModel(source)) {
      List<Plan> all = new RefactorPlans(model).collect();
      Set<String> requested = new LinkedHashSet<>(ids);
      List<Plan> selected =
          all.stream()
              .filter(plan -> requested.contains(plan.id))
              .sorted(Comparator.comparingInt(Plan::start))
              .toList();
      if (selected.size() != requested.size())
        throw new IllegalArgumentException("Предложение не найдено в текущей версии");
      for (int i = 1; i < selected.size(); i++) {
        if (selected.get(i).start < selected.get(i - 1).end) {
          throw new IllegalArgumentException(
              "OVERLAPPING_PLANS: предложения изменяют один диапазон. Применяйте по очереди.");
        }
      }
      String result = source;
      for (int i = selected.size() - 1; i >= 0; i--) {
        Plan plan = selected.get(i);
        result = Transformations.replace(result, plan.start, plan.end, plan.after);
      }
      try (JavaModel after = new JavaModel(result)) {
        if (!after.valid())
          throw new IllegalArgumentException("Патч не прошёл синтаксическую проверку");
      }
      return Digests.map(
          "source",
          result,
          "sourceHash",
          Digests.sha256(result),
          "applied",
          selected.stream().map(plan -> (Object) plan.json()).toList(),
          "requiresGate",
          true,
          "status",
          "candidate");
    }
  }
}
