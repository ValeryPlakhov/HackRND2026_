import com.sun.source.tree.*;
import com.sun.source.util.TreeScanner;
import java.util.*;
import javax.lang.model.element.Modifier;

/** Explainable AST rules. Findings are recommendations, never automatic semantic changes. */
public final class RuleCatalog {
  public record Rule(
      String id,
      String title,
      String category,
      String severity,
      String explanation,
      String recommendation,
      String confidence) {
    Map<String, Object> json() {
      return Digests.map(
          "id",
          id,
          "title",
          title,
          "category",
          category,
          "severity",
          severity,
          "explanation",
          explanation,
          "recommendation",
          recommendation,
          "confidence",
          confidence);
    }
  }

  private static final List<Rule> RULES =
      List.of(
          new Rule(
              "BP101",
              "Слишком общий обработчик",
              "reliability",
              "warning",
              "catch перехватывает Exception или Throwable и может скрыть ошибки другого"
                  + " происхождения.",
              "Разделите ожидаемые типы ошибок; изменение обработчиков проверьте на тестах.",
              "syntactic"),
          new Rule(
              "BP102",
              "Возврат из finally",
              "reliability",
              "error",
              "return в finally может подменить результат try и подавить исключение.",
              "Вынесите return из finally, если подавление результата не является требованием.",
              "syntactic"),
          new Rule(
              "BP103",
              "Слишком много параметров",
              "maintainability",
              "info",
              "У метода больше шести параметров, что усложняет вызовы и тестовые сценарии.",
              "Рассмотрите объект параметров либо разделение ответственности.",
              "heuristic"),
          new Rule(
              "BP104",
              "Глубокая вложенность",
              "maintainability",
              "warning",
              "Управляющая логика вложена минимум на четыре уровня.",
              "Guard clauses или выделение метода могут упростить чтение.",
              "heuristic"),
          new Rule(
              "BP105",
              "Константное условие",
              "maintainability",
              "info",
              "В if использован булев литерал; одна ветка заведомо не выбирается.",
              "Просмотрите предложение упрощения и подтвердите поведение.",
              "syntactic"),
          new Rule(
              "BP106",
              "Пустая ветка if",
              "maintainability",
              "info",
              "Выбранная ветка не содержит инструкций.",
              "Проверьте, не потерян ли код и нужен ли эффект вычисления условия.",
              "syntactic"),
          new Rule(
              "BP107",
              "Деление на нулевой литерал",
              "reliability",
              "error",
              "Операция деления или остатка использует целочисленный ноль справа.",
              "Обработайте нулевой делитель явно; числа с плавающей точкой имеют другую семантику.",
              "syntactic"),
          new Rule(
              "BP108",
              "Неограниченный цикл",
              "reliability",
              "warning",
              "У цикла буквальное условие true или отсутствует условие.",
              "Проверьте достижимость выхода и добавьте вход, который проверяет остановку.",
              "heuristic"),
          new Rule(
              "BP109",
              "Вывод внутри цикла",
              "performance",
              "info",
              "Консольный вызов в цикле может определять большую часть времени выполнения.",
              "Не удаляйте вывод автоматически: он входит в наблюдаемое поведение.",
              "syntactic"),
          new Rule(
              "BP110",
              "Форматирование внутри цикла",
              "performance",
              "info",
              "Форматирование строк создаёт дополнительные объекты на каждой итерации.",
              "Проверьте бенчмарк и возможность накопить вывод без изменения порядка.",
              "heuristic"),
          new Rule(
              "BP111",
              "Изменяемое публичное static-поле",
              "maintainability",
              "warning",
              "Публичное static-поле не объявлено final и доступно для изменения извне.",
              "Сократите доступность или определите явный API изменения состояния.",
              "syntactic"),
          new Rule(
              "BP112",
              "Конструктор String из литерала",
              "performance",
              "info",
              "new String от литерала создаёт отдельный объект.",
              "Замена литералом изменит identity; сначала проверьте, не используется ли сравнение"
                  + " ссылок.",
              "syntactic"),
          new Rule(
              "BP113",
              "Повтор соседних инструкций",
              "maintainability",
              "info",
              "Две соседние инструкции имеют одинаковый текст AST.",
              "Убедитесь, что это намеренное повторение. Побочные эффекты запрещают слепое"
                  + " удаление.",
              "heuristic"),
          new Rule(
              "BP114",
              "Switch без default",
              "reliability",
              "info",
              "У switch statement нет default-ветки.",
              "Проверьте допустимые значения. Для исчерпывающего enum это может быть осознанно.",
              "heuristic"),
          new Rule(
              "BP115",
              "Прямое завершение процесса",
              "testability",
              "info",
              "System.exit завершает JVM целиком; runner сравнивает код завершения как часть"
                  + " контракта.",
              "Для библиотечного метода предпочтительнее возвращать результат вызывающему коду.",
              "syntactic"),
          new Rule(
              "BP116",
              "Создание объекта в цикле",
              "performance",
              "info",
              "Конструктор вызывается на каждой итерации.",
              "Профилируйте выделения. Выносить объект можно только при сохранении состояния и"
                  + " identity.",
              "heuristic"),
          new Rule(
              "BP117",
              "Вложенный тернарный оператор",
              "maintainability",
              "info",
              "Ветвь тернарного выражения содержит ещё один тернарный оператор.",
              "Рассмотрите именованный метод или явный if для читаемости.",
              "syntactic"),
          new Rule(
              "BP118",
              "Смешаны ввод-вывод и вычисления",
              "maintainability",
              "info",
              "Метод содержит консольные операции и циклическую обработку данных.",
              "Выделите чистую вычислительную часть, чтобы измерять и тестировать её отдельно.",
              "heuristic"),
          new Rule(
              "BP119",
              "Пустой цикл",
              "reliability",
              "warning",
              "Тело цикла не содержит инструкций.",
              "Проверьте случайную точку с запятой; условие и шаг всё ещё могут иметь побочные"
                  + " эффекты.",
              "syntactic"),
          new Rule(
              "BP120",
              "Явный throw null",
              "reliability",
              "error",
              "throw null всегда приводит к NullPointerException.",
              "Если это не тестовый сценарий, создайте исключение с понятным сообщением.",
              "syntactic"),
          new Rule(
              "BP121",
              "Линейный поиск в коллекции внутри цикла",
              "performance",
              "warning",
              "contains/indexOf/remove(Object) у списка перебирает элементы; внутри цикла это"
                  + " O(n·m) вместо O(n + m).",
              "Постройте HashSet/HashMap до цикла или храните индекс по ключу. Если IDE предлагает"
                  + " автоматическое улучшение, проверьте его на тестах.",
              "type-lexical"),
          new Rule(
              "BP122",
              "Строки сравниваются через ==",
              "reliability",
              "error",
              "== сравнивает ссылки, а не текст: строка из ввода не равна литералу, даже если"
                  + " символы совпадают.",
              "Используйте equals или Objects.equals. Это меняет поведение — исправление ошибки"
                  + " должно быть видно в проверке.",
              "type-lexical"),
          new Rule(
              "BP123",
              "Объекты-обёртки сравниваются через ==",
              "reliability",
              "warning",
              "Integer/Long/Character через == совпадают только внутри кэша (обычно -128..127).",
              "Сравнивайте через equals или распакуйте значения в примитивы.",
              "type-lexical"),
          new Rule(
              "BP125",
              "Доступ по индексу к LinkedList в цикле",
              "performance",
              "warning",
              "LinkedList.get(i) проходит список от края: цикл по индексам становится O(n²).",
              "Итерируйтесь через for-each/Iterator или используйте ArrayList.",
              "type-lexical"),
          new Rule(
              "BP126",
              "Сортировка внутри цикла",
              "performance",
              "warning",
              "Сортировка на каждой итерации даёт O(k·n log n).",
              "Отсортируйте один раз после накопления данных или используйте TreeMap/PriorityQueue.",
              "syntactic"),
          new Rule(
              "BP127",
              "Удаление из начала ArrayList в цикле",
              "performance",
              "warning",
              "remove(0) сдвигает все элементы массива: очередь на ArrayList работает за O(n²).",
              "Используйте ArrayDeque или LinkedList для очереди.",
              "type-lexical"));

  private static final Map<String, Rule> BY_ID = new LinkedHashMap<>();

  static {
    RULES.forEach(rule -> BY_ID.put(rule.id, rule));
  }

  public static List<Object> catalog() {
    return RULES.stream().map(rule -> (Object) rule.json()).toList();
  }

  public static List<Object> analyze(JavaModel model) {
    List<Object> findings = new ArrayList<>();
    for (JavaModel.Method method : model.methods) {
      if (method.tree().getParameters().size() > 6)
        emit(findings, model, method, method.tree(), "BP103");
      new Scan(model, method, findings).scan(method.tree().getBody(), null);
    }
    new TreeScanner<Void, Void>() {
      @Override
      public Void visitClass(ClassTree tree, Void ignored) {
        for (Tree member : tree.getMembers()) {
          if (member instanceof VariableTree field) {
            Set<Modifier> flags = field.getModifiers().getFlags();
            if (flags.contains(Modifier.PUBLIC)
                && flags.contains(Modifier.STATIC)
                && !flags.contains(Modifier.FINAL)) emit(findings, model, null, field, "BP111");
          }
        }
        return super.visitClass(tree, ignored);
      }
    }.scan(model.unit, null);
    return findings;
  }

  private static void emit(
      List<Object> findings, JavaModel model, JavaModel.Method method, Tree tree, String ruleId) {
    Rule rule = BY_ID.get(ruleId);
    if (model.start(tree) < 0) return;
    Map<String, Object> finding = new LinkedHashMap<>(rule.json());
    finding.put("rule", rule.id);
    finding.put("detail", rule.explanation + " " + rule.recommendation);
    finding.put("line", model.line(tree));
    finding.put("start", model.start(tree));
    finding.put("end", model.end(tree));
    finding.put("methodId", method == null ? "" : method.id());
    finding.put("canOptimize", false);
    findings.add(finding);
  }

  private static boolean empty(StatementTree tree) {
    return tree instanceof EmptyStatementTree
        || tree instanceof BlockTree block && block.getStatements().isEmpty();
  }

  private static ExpressionTree unwrap(ExpressionTree expression) {
    while (expression instanceof ParenthesizedTree p) expression = p.getExpression();
    return expression;
  }

  private static final class Scan extends TreeScanner<Void, Void> {
    private final JavaModel model;
    private final JavaModel.Method method;
    private final List<Object> findings;
    private int nesting;
    private int loops;
    private boolean deepReported;
    private boolean io;
    private boolean hasLoop;
    private final Map<String, String> types = new HashMap<>();
    /** Names declared inside loop bodies: a fresh collection per iteration is not repeated work. */
    private final Set<String> loopLocals = new HashSet<>();

    Scan(JavaModel model, JavaModel.Method method, List<Object> findings) {
      this.model = model;
      this.method = method;
      this.findings = findings;
      for (Tree type : model.unit.getTypeDecls())
        if (type instanceof ClassTree c)
          for (Tree member : c.getMembers())
            if (member instanceof VariableTree field) declare(field);
      for (VariableTree parameter : method.tree().getParameters()) declare(parameter);
      new TreeScanner<Void, Void>() {
        int depth;

        public Void visitVariable(VariableTree x, Void v) {
          declare(x);
          if (depth > 0) loopLocals.add(x.getName().toString());
          return super.visitVariable(x, v);
        }

        Void body(Tree tree) {
          depth++;
          scan(tree, null);
          depth--;
          return null;
        }

        public Void visitForLoop(ForLoopTree x, Void v) {
          scan(x.getInitializer(), null);
          return body(x.getStatement());
        }

        public Void visitEnhancedForLoop(EnhancedForLoopTree x, Void v) {
          return body(x.getStatement());
        }

        public Void visitWhileLoop(WhileLoopTree x, Void v) {
          return body(x.getStatement());
        }

        public Void visitDoWhileLoop(DoWhileLoopTree x, Void v) {
          return body(x.getStatement());
        }
      }.scan(method.tree().getBody(), null);
    }

    private void declare(VariableTree variable) {
      String type = variable.getType() == null ? "var" : variable.getType().toString();
      if ((type.equals("var") || type.isEmpty())
          && variable.getInitializer() instanceof NewClassTree created)
        type = created.getIdentifier().toString();
      types.put(variable.getName().toString(), simpleType(type));
    }

    private static String simpleType(String type) {
      int generic = type.indexOf('<');
      String raw = generic < 0 ? type : type.substring(0, generic);
      return raw.substring(raw.lastIndexOf('.') + 1).trim();
    }

    private String typeOf(ExpressionTree expression) {
      ExpressionTree value = unwrap(expression);
      if (value instanceof IdentifierTree identifier) return types.get(identifier.getName().toString());
      if (value instanceof LiteralTree literal && literal.getValue() instanceof String) return "String";
      return null;
    }

    private static final Set<String> LISTS =
        Set.of("List", "ArrayList", "LinkedList", "Collection", "Vector", "CopyOnWriteArrayList");
    private static final Set<String> BOXES = Set.of("Integer", "Long", "Short", "Byte", "Character");

    void emit(Tree tree, String rule) {
      RuleCatalog.emit(findings, model, method, tree, rule);
    }

    void nested(Tree tree, boolean loop) {
      nesting++;
      if (loop) {
        loops++;
        hasLoop = true;
      }
      if (nesting >= 4 && !deepReported) {
        deepReported = true;
        emit(tree, "BP104");
      }
      scan(tree, null);
      if (loop) loops--;
      nesting--;
    }

    @Override
    public Void visitBlock(BlockTree tree, Void ignored) {
      List<? extends StatementTree> statements = tree.getStatements();
      for (int i = 1; i < statements.size(); i++) {
        if (statements.get(i).toString().equals(statements.get(i - 1).toString())
            && !(statements.get(i) instanceof EmptyStatementTree)) emit(statements.get(i), "BP113");
      }
      Void result = super.visitBlock(tree, ignored);
      if (tree == method.tree().getBody() && io && hasLoop) emit(tree, "BP118");
      return result;
    }

    @Override
    public Void visitIf(IfTree tree, Void ignored) {
      if (unwrap(tree.getCondition()) instanceof LiteralTree literal
          && literal.getValue() instanceof Boolean) emit(tree, "BP105");
      if (empty(tree.getThenStatement())) emit(tree, "BP106");
      scan(tree.getCondition(), null);
      nested(tree.getThenStatement(), false);
      if (tree.getElseStatement() != null) nested(tree.getElseStatement(), false);
      return null;
    }

    @Override
    public Void visitForLoop(ForLoopTree tree, Void ignored) {
      ExpressionTree condition = unwrap(tree.getCondition());
      if (condition == null
          || condition instanceof LiteralTree literal && Boolean.TRUE.equals(literal.getValue()))
        emit(tree, "BP108");
      if (empty(tree.getStatement())) emit(tree, "BP119");
      scan(tree.getInitializer(), null);
      scan(tree.getCondition(), null);
      scan(tree.getUpdate(), null);
      nested(tree.getStatement(), true);
      return null;
    }

    @Override
    public Void visitEnhancedForLoop(EnhancedForLoopTree tree, Void ignored) {
      if (empty(tree.getStatement())) emit(tree, "BP119");
      scan(tree.getExpression(), null);
      nested(tree.getStatement(), true);
      return null;
    }

    @Override
    public Void visitWhileLoop(WhileLoopTree tree, Void ignored) {
      if (unwrap(tree.getCondition()) instanceof LiteralTree literal
          && Boolean.TRUE.equals(literal.getValue())) emit(tree, "BP108");
      if (empty(tree.getStatement())) emit(tree, "BP119");
      scan(tree.getCondition(), null);
      nested(tree.getStatement(), true);
      return null;
    }

    @Override
    public Void visitDoWhileLoop(DoWhileLoopTree tree, Void ignored) {
      if (empty(tree.getStatement())) emit(tree, "BP119");
      scan(tree.getCondition(), null);
      nested(tree.getStatement(), true);
      return null;
    }

    @Override
    public Void visitCatch(CatchTree tree, Void ignored) {
      String type = tree.getParameter().getType().toString();
      if (Set.of("Exception", "Throwable", "java.lang.Exception", "java.lang.Throwable")
          .contains(type)) {
        emit(tree, "BP101");
      }
      nested(tree.getBlock(), false);
      return null;
    }

    @Override
    public Void visitTry(TryTree tree, Void ignored) {
      if (tree.getFinallyBlock() != null) {
        new TreeScanner<Void, Void>() {
          public Void visitReturn(ReturnTree ret, Void v) {
            emit(ret, "BP102");
            return null;
          }

          public Void visitLambdaExpression(LambdaExpressionTree t, Void v) {
            return null;
          }

          public Void visitClass(ClassTree t, Void v) {
            return null;
          }
        }.scan(tree.getFinallyBlock(), null);
      }
      return super.visitTry(tree, ignored);
    }

    @Override
    public Void visitBinary(BinaryTree tree, Void ignored) {
      ExpressionTree right = unwrap(tree.getRightOperand());
      if (Set.of(Tree.Kind.DIVIDE, Tree.Kind.REMAINDER).contains(tree.getKind())
          && right instanceof LiteralTree literal
          && literal.getValue() instanceof Integer value
          && value == 0) emit(tree, "BP107");
      if (tree.getKind() == Tree.Kind.EQUAL_TO || tree.getKind() == Tree.Kind.NOT_EQUAL_TO) {
        ExpressionTree left = unwrap(tree.getLeftOperand());
        boolean nullCheck =
            left.getKind() == Tree.Kind.NULL_LITERAL || right.getKind() == Tree.Kind.NULL_LITERAL;
        String a = typeOf(left);
        String b = typeOf(right);
        // Literal comparisons are STRING_IDENTITY in the base analyzer; this covers two variables.
        if (!nullCheck && "String".equals(a) && "String".equals(b)
            && !(left instanceof LiteralTree) && !(right instanceof LiteralTree)) emit(tree, "BP122");
        else if (!nullCheck && a != null && a.equals(b) && BOXES.contains(a)) emit(tree, "BP123");
      }
      return super.visitBinary(tree, ignored);
    }

    @Override
    public Void visitMethodInvocation(MethodInvocationTree tree, Void ignored) {
      String name = tree.getMethodSelect().toString();
      boolean console =
          name.startsWith("System.out.")
              || name.startsWith("System.err.")
              || name.startsWith("java.lang.System.out.")
              || name.startsWith("java.lang.System.err.");
      io |= console;
      if (console && loops > 0) emit(tree, "BP109");
      if (loops > 0 && (name.equals("String.format") || name.endsWith(".printf")))
        emit(tree, "BP110");
      if (name.equals("System.exit") || name.equals("java.lang.System.exit")) emit(tree, "BP115");
      if (loops > 0 && tree.getMethodSelect() instanceof MemberSelectTree select) {
        String member = select.getIdentifier().toString();
        String receiver = typeOf(select.getExpression());
        if (receiver != null && LISTS.contains(receiver)) {
          boolean byObject =
              member.equals("remove")
                  && tree.getArguments().size() == 1
                  && !"int".equals(typeOf(tree.getArguments().get(0)))
                  && !(unwrap(tree.getArguments().get(0)) instanceof LiteralTree);
          if (Set.of("contains", "indexOf", "lastIndexOf", "containsAll").contains(member) || byObject)
            emit(tree, "BP121");
          if (member.equals("get") && receiver.equals("LinkedList")) emit(tree, "BP125");
          if (member.equals("remove")
              && tree.getArguments().size() == 1
              && unwrap(tree.getArguments().get(0)) instanceof LiteralTree zero
              && Integer.valueOf(0).equals(zero.getValue())
              && !receiver.equals("LinkedList")) emit(tree, "BP127");
        }
        ExpressionTree sorted =
            name.equals("Collections.sort") || name.equals("Arrays.sort")
                ? (tree.getArguments().isEmpty() ? null : unwrap(tree.getArguments().get(0)))
                : receiver != null && LISTS.contains(receiver) ? select.getExpression() : null;
        if (member.equals("sort")
            && sorted instanceof IdentifierTree target
            && !loopLocals.contains(target.getName().toString())) emit(tree, "BP126");
      }
      return super.visitMethodInvocation(tree, ignored);
    }

    @Override
    public Void visitNewClass(NewClassTree tree, Void ignored) {
      if (loops > 0) emit(tree, "BP116");
      if (Set.of("String", "java.lang.String").contains(tree.getIdentifier().toString())
          && tree.getArguments().size() == 1
          && tree.getArguments().get(0).getKind() == Tree.Kind.STRING_LITERAL) emit(tree, "BP112");
      return super.visitNewClass(tree, ignored);
    }

    @Override
    public Void visitConditionalExpression(ConditionalExpressionTree tree, Void ignored) {
      if (tree.getTrueExpression() instanceof ConditionalExpressionTree
          || tree.getFalseExpression() instanceof ConditionalExpressionTree) emit(tree, "BP117");
      return super.visitConditionalExpression(tree, ignored);
    }

    @Override
    public Void visitSwitch(SwitchTree tree, Void ignored) {
      if (tree.getCases().stream().noneMatch(branch -> branch.getExpressions().isEmpty()))
        emit(tree, "BP114");
      return super.visitSwitch(tree, ignored);
    }

    @Override
    public Void visitThrow(ThrowTree tree, Void ignored) {
      if (tree.getExpression().getKind() == Tree.Kind.NULL_LITERAL) emit(tree, "BP120");
      return super.visitThrow(tree, ignored);
    }

    @Override
    public Void visitClass(ClassTree tree, Void ignored) {
      return null;
    }
  }
}
