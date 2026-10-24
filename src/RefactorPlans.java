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
    }
    return List.copyOf(plans);
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
              "integer-fold"));
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
