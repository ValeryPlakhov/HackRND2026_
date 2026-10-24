import com.sun.source.tree.*;
import com.sun.source.util.TreeScanner;
import java.util.*;

/** A compositional estimate with visible assumptions, rather than an exact complexity claim. */
public final class ComplexityAnalysis {
  public record Cost(int power, int logarithms, boolean unknown) implements Comparable<Cost> {
    static Cost constant() {
      return new Cost(0, 0, false);
    }

    static Cost linear() {
      return new Cost(1, 0, false);
    }

    static Cost logarithmic() {
      return new Cost(0, 1, false);
    }

    static Cost opaque() {
      return new Cost(0, 0, true);
    }

    Cost times(Cost other) {
      return new Cost(power + other.power, logarithms + other.logarithms, unknown || other.unknown);
    }

    Cost maximum(Cost other) {
      Cost larger = compareTo(other) >= 0 ? this : other;
      return new Cost(larger.power, larger.logarithms, unknown || other.unknown);
    }

    public int compareTo(Cost other) {
      int polynomial = Integer.compare(power, other.power);
      return polynomial == 0 ? Integer.compare(logarithms, other.logarithms) : polynomial;
    }

    String display() {
      if (unknown) return "Неизвестно";
      if (power == 0 && logarithms == 0) return "O(1)";
      String n = power == 0 ? "" : power == 1 ? "n" : "n^" + power;
      String log = logarithms == 0 ? "" : logarithms == 1 ? "log n" : "(log n)^" + logarithms;
      return "O(" + n + (!n.isEmpty() && !log.isEmpty() ? " · " : "") + log + ")";
    }
  }

  private final JavaModel model;
  private final JavaModel.Method method;
  private final List<Object> reasoning = new ArrayList<>();
  private final Set<String> caveats = new LinkedHashSet<>();
  private int cognitive;
  private int cyclomatic = 1;
  private int maximumNesting;
  private boolean recursive;

  public ComplexityAnalysis(JavaModel model, JavaModel.Method method) {
    this.model = model;
    this.method = method;
  }

  public Map<String, Object> describe() {
    Cost cost = statement(method.tree().getBody(), 0);
    detectCalls();
    if (recursive) cost = new Cost(cost.power, cost.logarithms, true);
    caveats.add(
        "Переменная n обозначает условный размер входа; разные циклы могут зависеть от разных"
            + " размеров.");
    caveats.add("Стоимость вызовов, выделений памяти и размера результата отдельно не доказана.");
    return Digests.map(
        "time",
        cost.display(),
        "polynomial",
        cost.power,
        "logarithmic",
        cost.logarithms,
        "unknown",
        cost.unknown,
        "cognitive",
        cognitive,
        "cyclomatic",
        cyclomatic,
        "maximumNesting",
        maximumNesting,
        "reasoning",
        reasoning,
        "assumptions",
        new ArrayList<>(caveats),
        "confidence",
        "structural-estimate");
  }

  private void explain(Tree tree, String category, Cost own, String reason) {
    reasoning.add(
        Digests.map(
            "line",
            model.line(tree),
            "start",
            model.start(tree),
            "category",
            category,
            "cost",
            own.display(),
            "reason",
            reason));
  }

  private Cost statement(StatementTree tree, int nesting) {
    if (tree == null) return Cost.constant();
    maximumNesting = Math.max(maximumNesting, nesting);
    if (tree instanceof BlockTree block) {
      Cost total = Cost.constant();
      for (StatementTree child : block.getStatements()) {
        total = total.maximum(statement(child, nesting));
      }
      return total;
    }
    if (tree instanceof IfTree branch) {
      cognitive += 1 + nesting;
      cyclomatic++;
      return statement(branch.getThenStatement(), nesting + 1)
          .maximum(statement(branch.getElseStatement(), nesting + 1));
    }
    if (tree instanceof ForLoopTree loop) {
      cognitive += 1 + nesting;
      cyclomatic++;
      Cost iterations = forIterations(loop);
      return iterations.times(statement(loop.getStatement(), nesting + 1));
    }
    if (tree instanceof EnhancedForLoopTree loop) {
      cognitive += 1 + nesting;
      cyclomatic++;
      explain(
          loop,
          "iteration",
          Cost.linear(),
          "foreach: один проход по коллекции; предполагается линейное число элементов.");
      return Cost.linear().times(statement(loop.getStatement(), nesting + 1));
    }
    if (tree instanceof WhileLoopTree loop) {
      cognitive += 1 + nesting;
      cyclomatic++;
      Cost iterations = whileIterations(loop.getCondition(), loop.getStatement(), loop);
      return iterations.times(statement(loop.getStatement(), nesting + 1));
    }
    if (tree instanceof DoWhileLoopTree loop) {
      cognitive += 1 + nesting;
      cyclomatic++;
      Cost iterations = whileIterations(loop.getCondition(), loop.getStatement(), loop);
      return iterations.times(statement(loop.getStatement(), nesting + 1));
    }
    if (tree instanceof SwitchTree selection) {
      cognitive += 1 + nesting;
      Cost maximum = Cost.constant();
      for (CaseTree branch : selection.getCases()) {
        cyclomatic++;
        if (branch.getStatements() != null) {
          for (StatementTree child : branch.getStatements()) {
            maximum = maximum.maximum(statement(child, nesting + 1));
          }
        } else if (branch.getBody() instanceof StatementTree child) {
          maximum = maximum.maximum(statement(child, nesting + 1));
        }
      }
      return maximum;
    }
    if (tree instanceof TryTree guarded) {
      Cost maximum = statement(guarded.getBlock(), nesting);
      for (CatchTree handler : guarded.getCatches()) {
        cognitive += 1 + nesting;
        cyclomatic++;
        maximum = maximum.maximum(statement(handler.getBlock(), nesting + 1));
      }
      return maximum.maximum(statement(guarded.getFinallyBlock(), nesting));
    }
    if (tree instanceof LabeledStatementTree labeled) {
      caveats.add("Меченые переходы требуют отдельного анализа числа итераций.");
      return statement(labeled.getStatement(), nesting);
    }
    return Cost.constant();
  }

  private Cost forIterations(ForLoopTree loop) {
    ExpressionTree condition = unwrap(loop.getCondition());
    boolean fixedBound =
        condition instanceof BinaryTree binary
            && (unwrap(binary.getRightOperand()) instanceof LiteralTree)
            && loop.getInitializer().stream()
                .allMatch(
                    initial ->
                        initial instanceof VariableTree v
                            && v.getInitializer() instanceof LiteralTree);
    if (fixedBound && !loop.getUpdate().isEmpty()) {
      explain(
          loop,
          "bounded-loop",
          Cost.constant(),
          "Начальная точка и правая граница - литералы; предполагается завершающийся счётчик.");
      caveats.add(
          "Константная граница не доказывает завершаемость при переполнении или нестандартном"
              + " шаге.");
      return Cost.constant();
    }
    boolean logarithmic =
        loop.getUpdate().stream().anyMatch(update -> geometric(update.getExpression()));
    if (logarithmic) {
      explain(
          loop,
          "geometric-loop",
          Cost.logarithmic(),
          "Обнаружен мультипликативный шаг по константе больше 1. Предполагается монотонное"
              + " приближение к границе без overflow.");
      caveats.add(
          "Геометрический шаг оценивается как log n только при положительном диапазоне и корректном"
              + " направлении изменения.");
      return Cost.logarithmic();
    }
    if (condition == null
        || condition instanceof LiteralTree literal && Boolean.TRUE.equals(literal.getValue())) {
      explain(
          loop,
          "unbounded-loop",
          Cost.opaque(),
          "У цикла нет условной границы. Выходы break требуют анализа достижимости и данных.");
      return Cost.opaque();
    }
    explain(
        loop,
        "counter-loop",
        Cost.linear(),
        "Счётный цикл: линейное число итераций принято как допущение, а не выведено из типов.");
    return Cost.linear();
  }

  private Cost whileIterations(ExpressionTree condition, StatementTree body, Tree original) {
    ExpressionTree normalized = unwrap(condition);
    if (normalized instanceof LiteralTree literal && Boolean.TRUE.equals(literal.getValue())) {
      explain(
          original,
          "unbounded-loop",
          Cost.opaque(),
          "while(true): без отдельного доказательства break граница неизвестна.");
      return Cost.opaque();
    }
    final boolean[] geometric = {false};
    new TreeScanner<Void, Void>() {
      public Void visitExpressionStatement(ExpressionStatementTree tree, Void ignored) {
        geometric[0] |= ComplexityAnalysis.geometric(tree.getExpression());
        return super.visitExpressionStatement(tree, ignored);
      }

      public Void visitClass(ClassTree tree, Void ignored) {
        return null;
      }

      public Void visitLambdaExpression(LambdaExpressionTree tree, Void ignored) {
        return null;
      }
    }.scan(body, null);
    Cost cost = geometric[0] ? Cost.logarithmic() : Cost.linear();
    explain(
        original,
        "conditional-loop",
        cost,
        geometric[0]
            ? "В теле найден геометрический шаг; связь с условием и монотонность остаются"
                  + " предположениями."
            : "while/do: принято линейное число итераций; реальные границы требуют data-flow"
                  + " анализа.");
    return cost;
  }

  private static boolean geometric(ExpressionTree expression) {
    if (expression instanceof CompoundAssignmentTree assignment
        && Set.of(
                Tree.Kind.MULTIPLY_ASSIGNMENT,
                Tree.Kind.DIVIDE_ASSIGNMENT,
                Tree.Kind.RIGHT_SHIFT_ASSIGNMENT)
            .contains(assignment.getKind())
        && assignment.getExpression() instanceof LiteralTree literal
        && literal.getValue() instanceof Number number) {
      return assignment.getKind() == Tree.Kind.RIGHT_SHIFT_ASSIGNMENT
          ? number.intValue() > 0
          : number.doubleValue() > 1;
    }
    return false;
  }

  private void detectCalls() {
    new TreeScanner<Void, Void>() {
      public Void visitMethodInvocation(MethodInvocationTree call, Void ignored) {
        if (call.getMethodSelect() instanceof IdentifierTree name
            && name.getName().contentEquals(method.tree().getName())) {
          recursive = true;
          caveats.add(
              "Обнаружен одноимённый локальный вызов: возможна рекурсия. Итоговая оценка не"
                  + " учитывает рекуррентное соотношение.");
        }
        return super.visitMethodInvocation(call, ignored);
      }

      public Void visitClass(ClassTree tree, Void ignored) {
        return null;
      }
    }.scan(method.tree().getBody(), null);
  }

  private static ExpressionTree unwrap(ExpressionTree expression) {
    while (expression instanceof ParenthesizedTree parenthesized)
      expression = parenthesized.getExpression();
    return expression;
  }
}
