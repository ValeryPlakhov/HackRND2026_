import com.sun.source.tree.*;
import com.sun.source.util.TreeScanner;
import java.util.*;

/** Mutations evaluate how well the supplied console tests detect real source changes. */
public final class MutationLab {
  public record Mutant(
      String id,
      String operator,
      String title,
      int start,
      int end,
      int line,
      String before,
      String after) {
    Map<String, Object> json() {
      return Digests.map(
          "id",
          id,
          "operator",
          operator,
          "title",
          title,
          "start",
          start,
          "end",
          end,
          "line",
          line,
          "before",
          before,
          "after",
          after);
    }
  }

  public static List<Mutant> propose(JavaModel model, JavaModel.Method method) {
    List<Mutant> mutants = new ArrayList<>();
    new TreeScanner<Void, Void>() {
      private void add(Tree tree, String operator, String title, String after) {
        if (mutants.size() >= 40 || model.start(tree) < 0) return;
        String id =
            Digests.sha256(model.source + ":" + model.start(tree) + ":" + after).substring(0, 16);
        mutants.add(
            new Mutant(
                id,
                operator,
                title,
                model.start(tree),
                model.end(tree),
                model.line(tree),
                model.text(tree),
                after));
      }

      @Override
      public Void visitBinary(BinaryTree tree, Void ignored) {
        String replacement =
            switch (tree.getKind()) {
              case EQUAL_TO -> "!=";
              case NOT_EQUAL_TO -> "==";
              case LESS_THAN -> "<=";
              case LESS_THAN_EQUAL -> "<";
              case GREATER_THAN -> ">=";
              case GREATER_THAN_EQUAL -> ">";
              case PLUS -> "-";
              case MINUS -> "+";
              case MULTIPLY -> "+";
              case CONDITIONAL_AND -> "||";
              case CONDITIONAL_OR -> "&&";
              default -> null;
            };
        if (replacement != null)
          add(
              tree,
              "binary-operator",
              "Заменить оператор на " + replacement,
              "(("
                  + model.text(tree.getLeftOperand())
                  + ") "
                  + replacement
                  + " ("
                  + model.text(tree.getRightOperand())
                  + "))");
        return super.visitBinary(tree, ignored);
      }

      @Override
      public Void visitLiteral(LiteralTree tree, Void ignored) {
        if (tree.getValue() instanceof Boolean value) {
          add(tree, "boolean-literal", "Инвертировать boolean", Boolean.toString(!value));
        } else if (tree.getValue() instanceof Integer value) {
          add(tree, "integer-boundary", "Сдвинуть целую константу на 1", "(" + (value + 1) + ")");
        }
        return null;
      }

      @Override
      public Void visitUnary(UnaryTree tree, Void ignored) {
        if (tree.getKind() == Tree.Kind.POSTFIX_INCREMENT) {
          add(
              tree,
              "counter-direction",
              "Заменить increment на decrement",
              model.text(tree.getExpression()) + "--");
        } else if (tree.getKind() == Tree.Kind.PREFIX_INCREMENT) {
          add(
              tree,
              "counter-direction",
              "Заменить increment на decrement",
              "--" + model.text(tree.getExpression()));
        }
        return super.visitUnary(tree, ignored);
      }

      @Override
      public Void visitClass(ClassTree tree, Void ignored) {
        return null;
      }

      @Override
      public Void visitLambdaExpression(LambdaExpressionTree tree, Void ignored) {
        return null;
      }
    }.scan(method.tree().getBody(), null);
    return mutants;
  }

  public static Map<String, Object> proposals(String source, String methodId) throws Exception {
    try (JavaModel model = new JavaModel(source)) {
      return Digests.map(
          "sourceHash",
          Digests.sha256(source),
          "mutants",
          propose(model, model.method(methodId)).stream()
              .map(mutant -> (Object) mutant.json())
              .toList());
    }
  }

  public static Map<String, Object> run(
      Map<String, String> files,
      String fileName,
      String methodId,
      List<String> inputs,
      int maximum,
      JobService.Context context)
      throws Exception {
    if (!files.containsKey(fileName)) throw new IllegalArgumentException("Файл не найден");
    if (inputs.isEmpty() || inputs.size() > 8)
      throw new IllegalArgumentException("Mutation lab: нужно 1..8 входов");
    maximum = Math.max(1, Math.min(8, maximum));
    List<Mutant> selected;
    try (JavaModel model = new JavaModel(files.get(fileName))) {
      selected = propose(model, model.method(methodId)).stream().limit(maximum).toList();
    }
    if (!Runner.SLOTS.tryAcquire()) throw new IllegalArgumentException("Runner занят");
    List<Object> results = new ArrayList<>();
    int killed = 0;
    int survived = 0;
    int invalid = 0;
    try (Runner.Build baseline = Runner.compile(files)) {
      if (!Boolean.TRUE.equals(baseline.result().get("success")))
        throw new IllegalArgumentException("Эталон не компилируется");
      List<Map<String, Object>> baselineOutputs = new ArrayList<>();
      for (String input : inputs) {
        Map<String, Object> output = Runner.run(baseline, input);
        if (Boolean.TRUE.equals(output.get("timedOut"))
            || Boolean.TRUE.equals(output.get("outputLimit"))) {
          throw new IllegalArgumentException(
              "Эталон превышает лимиты; mutation score не вычисляется");
        }
        baselineOutputs.add(output);
      }
      for (int i = 0; i < selected.size(); i++) {
        Mutant mutant = selected.get(i);
        if (context != null)
          context.stage("Мутант " + (i + 1) + " / " + selected.size(), i, selected.size());
        Map<String, String> changed = new LinkedHashMap<>(files);
        changed.put(
            fileName,
            Transformations.replace(files.get(fileName), mutant.start, mutant.end, mutant.after));
        Map<String, Object> result = new LinkedHashMap<>(mutant.json());
        try (Runner.Build candidate = Runner.compile(changed)) {
          if (!Boolean.TRUE.equals(candidate.result().get("success"))) {
            invalid++;
            result.put("status", "invalid");
            result.put("diagnostics", candidate.result().get("diagnostics"));
          } else {
            int firstFailure = -1;
            for (int j = 0; j < inputs.size(); j++) {
              Map<String, Object> output = Runner.run(candidate, inputs.get(j));
              if (!equivalent(baselineOutputs.get(j), output)) {
                firstFailure = j;
                break;
              }
            }
            if (firstFailure >= 0) {
              killed++;
              result.put("status", "killed");
              result.put("killedBy", firstFailure);
            } else {
              survived++;
              result.put("status", "survived");
              result.put(
                  "recommendation",
                  "Добавьте вход, различающий исходный и изменённый оператор. Мутант также может"
                      + " быть эквивалентным.");
            }
          }
        }
        results.add(result);
      }
    } finally {
      Runner.SLOTS.release();
    }
    int denominator = killed + survived;
    return Digests.map(
        "mutants",
        results,
        "killed",
        killed,
        "survived",
        survived,
        "invalid",
        invalid,
        "score",
        denominator == 0 ? null : Math.round(1000.0 * killed / denominator) / 10.0,
        "projectHash",
        Digests.project(files),
        "inputs",
        inputs,
        "note",
        "Score = killed / (killed + survived). Invalid mutants исключены. Survived не доказывает"
            + " слабость тестов: возможны эквивалентные мутации.");
  }

  static boolean equivalent(Map<String, Object> first, Map<String, Object> second) {
    return Objects.equals(first.get("stdoutSha256"), second.get("stdoutSha256"))
        && Objects.equals(first.get("stderrSha256"), second.get("stderrSha256"))
        && Objects.equals(first.get("exitCode"), second.get("exitCode"))
        && !Boolean.TRUE.equals(first.get("timedOut"))
        && !Boolean.TRUE.equals(second.get("timedOut"))
        && !Boolean.TRUE.equals(first.get("outputLimit"))
        && !Boolean.TRUE.equals(second.get("outputLimit"));
  }
}
