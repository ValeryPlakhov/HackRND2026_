import com.sun.source.tree.*;
import com.sun.source.util.TreeScanner;
import java.util.*;

public final class Analyzer {
  static final class Complexity extends TreeScanner<Void, Integer> {
    int depth, decisions, calls;
    boolean recursive;
    String method;

    Complexity(String name) {
      method = name;
    }

    void loop(StatementTree body, int d) {
      depth = Math.max(depth, d + 1);
      scan(body, d + 1);
    }

    public Void visitForLoop(ForLoopTree t, Integer d) {
      decisions++;
      loop(t.getStatement(), d);
      return null;
    }

    public Void visitEnhancedForLoop(EnhancedForLoopTree t, Integer d) {
      decisions++;
      loop(t.getStatement(), d);
      return null;
    }

    public Void visitWhileLoop(WhileLoopTree t, Integer d) {
      decisions++;
      loop(t.getStatement(), d);
      return null;
    }

    public Void visitDoWhileLoop(DoWhileLoopTree t, Integer d) {
      decisions++;
      loop(t.getStatement(), d);
      return null;
    }

    public Void visitIf(IfTree t, Integer d) {
      decisions++;
      return super.visitIf(t, d);
    }

    public Void visitCase(CaseTree t, Integer d) {
      decisions++;
      return super.visitCase(t, d);
    }

    public Void visitCatch(CatchTree t, Integer d) {
      decisions++;
      return super.visitCatch(t, d);
    }

    public Void visitMethodInvocation(MethodInvocationTree t, Integer d) {
      calls++;
      String s = t.getMethodSelect().toString();
      if (s.equals(method) || s.equals("this." + method)) recursive = true;
      return super.visitMethodInvocation(t, d);
    }

    public Void visitClass(ClassTree t, Integer d) {
      return null;
    }

    public Void visitLambdaExpression(LambdaExpressionTree t, Integer d) {
      return null;
    }
  }

  static Map<String, Object> metrics(MethodTree method) {
    Complexity c = new Complexity(method.getName().toString());
    c.scan(method.getBody(), 0);
    String o =
        c.recursive
            ? "неизвестно"
            : c.depth == 0 ? "O(1)" : c.depth == 1 ? "O(n)" : "O(n^" + c.depth + ")";
    return Map.of(
        "complexity",
        o,
        "loopDepth",
        c.depth,
        "cyclomatic",
        1 + c.decisions,
        "calls",
        c.calls,
        "confidence",
        "heuristic",
        "assumptions",
        "Каждый цикл условно линейный; вызовы, фактические границы и размер вывода не учтены."
            + " Рекурсия требует отдельного анализа.");
  }

  static List<Object> findings(JavaModel m) {
    List<Object> out = new ArrayList<>();
    for (var method : m.methods) {
      MethodTree t = method.tree();
      Map<String, Object> metrics = metrics(t);
      int depth = (int) metrics.get("loopDepth");
      if (depth >= 2)
        add(
            out,
            "NESTED_LOOPS",
            "info",
            "Вложенный цикл: оценка " + metrics.get("complexity"),
            "Проверьте повторный обход данных. Индекс по ключу может убрать вложенный поиск;"
                + " семантику и порядок обработки нужно сохранить.",
            m,
            t,
            method.id(),
            Transformations.canOptimize(m, method));
      // SonarQube S138 uses 75 lines as the default limit.
      if (m.text(t).lines().count() > 75)
        add(
            out,
            "LONG_METHOD",
            "info",
            "Длинный метод",
            "Разделите ввод, вычисления и вывод. Перенос независимого static-метода доступен через"
                + " декомпозицию.",
            m,
            t,
            method.id(),
            false);
      new TreeScanner<Void, Integer>() {
        int loops;
        Map<String, String> types = new HashMap<>();

        {
          for (VariableTree p : t.getParameters())
            types.put(p.getName().toString(), p.getType().toString());
        }

        public Void visitBlock(BlockTree x, Integer d) {
          Map<String, String> saved = new HashMap<>(types);
          super.visitBlock(x, d);
          types = saved;
          return null;
        }

        public Void visitVariable(VariableTree x, Integer d) {
          types.put(x.getName().toString(), x.getType() == null ? "" : x.getType().toString());
          return super.visitVariable(x, d);
        }

        public Void visitForLoop(ForLoopTree x, Integer d) {
          loops++;
          super.visitForLoop(x, d);
          loops--;
          return null;
        }

        public Void visitEnhancedForLoop(EnhancedForLoopTree x, Integer d) {
          loops++;
          super.visitEnhancedForLoop(x, d);
          loops--;
          return null;
        }

        public Void visitWhileLoop(WhileLoopTree x, Integer d) {
          loops++;
          super.visitWhileLoop(x, d);
          loops--;
          return null;
        }

        public Void visitDoWhileLoop(DoWhileLoopTree x, Integer d) {
          loops++;
          super.visitDoWhileLoop(x, d);
          loops--;
          return null;
        }

        public Void visitCompoundAssignment(CompoundAssignmentTree x, Integer d) {
          String type = types.getOrDefault(x.getVariable().toString(), "");
          if (loops > 0
              && x.getKind() == Tree.Kind.PLUS_ASSIGNMENT
              && Set.of("String", "java.lang.String").contains(type))
            add(
                out,
                "LOOP_ACCUMULATION",
                "info",
                "Конкатенация строки в цикле",
                "Переменная явно объявлена как String. Повторное += может копировать накопленный"
                    + " префикс на каждой итерации. Рассмотрите StringBuilder; проверьте порядок"
                    + " вычислений и поведение на тестах.",
                m,
                x,
                method.id(),
                false);
          return super.visitCompoundAssignment(x, d);
        }

        public Void visitCatch(CatchTree x, Integer d) {
          // An empty catch is deliberate when the variable says so (ignored, expected — the
          // IntelliJ convention) or a comment explains it (SonarQube S108 accepts a comment).
          String variable = x.getParameter().getName().toString();
          String block = m.text(x.getBlock());
          boolean explained =
              Set.of("ignored", "ignore", "expected", "unused", "_").contains(variable)
                  || block.contains("//")
                  || block.contains("/*");
          if (x.getBlock().getStatements().isEmpty() && !explained)
            add(
                out,
                "EMPTY_CATCH",
                "warning",
                "Пустой catch: исключение игнорируется",
                "Пустой catch скрывает ошибки. Изменение обработки исключений меняет поведение и"
                    + " требует отдельного решения.",
                m,
                x,
                method.id(),
                false);
          return super.visitCatch(x, d);
        }

        public Void visitBinary(BinaryTree x, Integer d) {
          if ((x.getKind() == Tree.Kind.EQUAL_TO || x.getKind() == Tree.Kind.NOT_EQUAL_TO)
              && (x.getLeftOperand().getKind() == Tree.Kind.STRING_LITERAL
                  || x.getRightOperand().getKind() == Tree.Kind.STRING_LITERAL))
            add(
                out,
                "STRING_IDENTITY",
                "warning",
                "Сравнение ссылки со строковым литералом",
                "== сравнивает ссылки. Если нужна проверка содержимого, используйте equals;"
                    + " исправление изменит результат и должно быть осознанным.",
                m,
                x,
                method.id(),
                false);
          return super.visitBinary(x, d);
        }

        public Void visitClass(ClassTree x, Integer d) {
          return null;
        }
      }.scan(t.getBody(), 0);
    }
    return out;
  }

  static void add(
      List<Object> out,
      String rule,
      String severity,
      String title,
      String detail,
      JavaModel m,
      Tree t,
      String method,
      boolean fix) {
    out.add(
        Map.of(
            "rule",
            rule,
            "severity",
            severity,
            "title",
            title,
            "detail",
            detail,
            "line",
            m.line(t),
            "start",
            m.start(t),
            "end",
            m.end(t),
            "methodId",
            method,
            "canOptimize",
            fix));
  }
}
