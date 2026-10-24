import com.sun.source.tree.*;
import com.sun.source.util.TreeScanner;
import java.util.*;

/** Lexical definition/use projection. Branch joins are conservative and explicitly labeled. */
public final class DataFlowAnalysis {
  private final JavaModel model;
  private final JavaModel.Method method;
  private final List<Map<String, Object>> events = new ArrayList<>();
  private final Map<String, Map<String, Object>> declarations = new LinkedHashMap<>();

  public DataFlowAnalysis(JavaModel model, JavaModel.Method method) {
    this.model = model;
    this.method = method;
  }

  public Map<String, Object> describe() {
    for (VariableTree parameter : method.tree().getParameters()) {
      declarations.put(parameter.getName().toString(), variable(parameter, "parameter"));
    }
    new Scanner().scan(method.tree().getBody(), null);
    Map<String, Set<Integer>> reads = new LinkedHashMap<>();
    Map<String, Set<Integer>> writes = new LinkedHashMap<>();
    List<Object> edges = new ArrayList<>();
    Map<String, List<Map<String, Object>>> available = new HashMap<>();
    for (Map<String, Object> event : events) {
      String name = String.valueOf(event.get("name"));
      String kind = String.valueOf(event.get("kind"));
      int line = (int) event.get("line");
      if (kind.equals("read")) {
        reads.computeIfAbsent(name, key -> new LinkedHashSet<>()).add(line);
        for (Map<String, Object> definition : available.getOrDefault(name, List.of())) {
          edges.add(
              Digests.map(
                  "name",
                  name,
                  "fromLine",
                  definition.get("line"),
                  "toLine",
                  line,
                  "fromStart",
                  definition.get("start"),
                  "toStart",
                  event.get("start")));
        }
      } else {
        writes.computeIfAbsent(name, key -> new LinkedHashSet<>()).add(line);
        available.computeIfAbsent(name, key -> new ArrayList<>()).add(event);
      }
    }
    List<Object> variables = new ArrayList<>();
    declarations.forEach(
        (name, declaration) -> {
          Map<String, Object> variable = new LinkedHashMap<>(declaration);
          variable.put("readLines", new ArrayList<>(reads.getOrDefault(name, Set.of())));
          variable.put("writeLines", new ArrayList<>(writes.getOrDefault(name, Set.of())));
          variable.put("readCount", reads.getOrDefault(name, Set.of()).size());
          variable.put("writeCount", writes.getOrDefault(name, Set.of()).size());
          variable.put("unused", reads.getOrDefault(name, Set.of()).isEmpty());
          variables.add(variable);
        });
    return Digests.map(
        "variables",
        variables,
        "events",
        events,
        "edges",
        edges,
        "scope",
        "lexical-conservative",
        "note",
        "Связи def-use лексические: все предшествующие записи считаются возможными. Нет SSA, alias"
            + " analysis и точного межпроцедурного анализа.");
  }

  private Map<String, Object> variable(VariableTree tree, String role) {
    return Digests.map(
        "name",
        tree.getName().toString(),
        "type",
        String.valueOf(tree.getType()),
        "line",
        model.line(tree),
        "start",
        model.start(tree),
        "role",
        role);
  }

  private void event(String name, String kind, Tree tree) {
    if (!declarations.containsKey(name)) return;
    events.add(
        Digests.map(
            "name", name, "kind", kind, "line", model.line(tree), "start", model.start(tree)));
  }

  private final class Scanner extends TreeScanner<Void, Void> {
    @Override
    public Void visitVariable(VariableTree tree, Void ignored) {
      if (tree.getInitializer() != null) scan(tree.getInitializer(), null);
      declarations.put(tree.getName().toString(), variable(tree, "local"));
      if (tree.getInitializer() != null) event(tree.getName().toString(), "write", tree);
      return null;
    }

    @Override
    public Void visitIdentifier(IdentifierTree tree, Void ignored) {
      event(tree.getName().toString(), "read", tree);
      return null;
    }

    @Override
    public Void visitAssignment(AssignmentTree tree, Void ignored) {
      scan(tree.getExpression(), null);
      if (tree.getVariable() instanceof IdentifierTree identifier) {
        event(identifier.getName().toString(), "write", tree);
      } else {
        scan(tree.getVariable(), null);
      }
      return null;
    }

    @Override
    public Void visitCompoundAssignment(CompoundAssignmentTree tree, Void ignored) {
      scan(tree.getVariable(), null);
      scan(tree.getExpression(), null);
      if (tree.getVariable() instanceof IdentifierTree identifier) {
        event(identifier.getName().toString(), "write", tree);
      }
      return null;
    }

    @Override
    public Void visitUnary(UnaryTree tree, Void ignored) {
      scan(tree.getExpression(), null);
      if (Set.of(
                  Tree.Kind.POSTFIX_INCREMENT,
                  Tree.Kind.PREFIX_INCREMENT,
                  Tree.Kind.POSTFIX_DECREMENT,
                  Tree.Kind.PREFIX_DECREMENT)
              .contains(tree.getKind())
          && tree.getExpression() instanceof IdentifierTree identifier) {
        event(identifier.getName().toString(), "write", tree);
      }
      return null;
    }

    @Override
    public Void visitMemberSelect(MemberSelectTree tree, Void ignored) {
      scan(tree.getExpression(), null);
      return null;
    }

    @Override
    public Void visitClass(ClassTree tree, Void ignored) {
      return null;
    }

    @Override
    public Void visitLambdaExpression(LambdaExpressionTree tree, Void ignored) {
      return null;
    }
  }
}
