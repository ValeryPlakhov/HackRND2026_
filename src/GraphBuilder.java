import com.sun.source.tree.*;
import java.util.*;

/** Structured control-flow projection. Opaque syntax is retained as a source node. */
public final class GraphBuilder {
  final JavaModel model;
  final List<Map<String, Object>> nodes = new ArrayList<>(), edges = new ArrayList<>();
  int serial;
  String exit;

  GraphBuilder(JavaModel model) {
    this.model = model;
  }

  String node(Tree t, String kind, String label, int depth, Tree edit) {
    String id = "n" + (serial++);
    Map<String, Object> n = new LinkedHashMap<>();
    n.put("id", id);
    n.put("kind", kind);
    n.put("label", label);
    n.put("depth", depth);
    n.put("line", t == null ? 0 : model.line(t));
    n.put("start", t == null ? -1 : model.start(t));
    n.put("end", t == null ? -1 : model.end(t));
    n.put("code", t == null ? "" : model.text(t));
    n.put("editStart", edit == null ? -1 : model.start(edit));
    n.put("editEnd", edit == null ? -1 : model.end(edit));
    n.put("editCode", edit == null ? "" : model.text(edit));
    nodes.add(n);
    return id;
  }

  void edge(String a, String b, String label) {
    if (a != null && b != null) edges.add(Map.of("from", a, "to", b, "label", label));
  }

  Map<String, Object> build(JavaModel.Method method) {
    String end = node(null, "exit", "Завершение", 0, null);
    exit = end;
    String first = flow(method.tree().getBody(), end, null, null, 0);
    String entry = node(method.tree(), "entry", method.tree().getName().toString(), 0, null);
    edge(entry, first, "вход");
    // Traversal order is computed separately from construction order.
    Map<String, Map<String, Object>> byId = new HashMap<>();
    for (var n : nodes) byId.put((String) n.get("id"), n);
    List<String> order = new ArrayList<>();
    walk(entry, new HashSet<>(), order);
    for (var n : nodes) if (!order.contains(n.get("id"))) order.add((String) n.get("id"));
    List<Object> sorted = new ArrayList<>();
    for (String id : order) sorted.add(byId.get(id));
    return Map.of(
        "nodes",
        sorted,
        "edges",
        edges,
        "entry",
        entry,
        "exit",
        end,
        "exceptionEdges",
        "conservative");
  }

  void walk(String id, Set<String> seen, List<String> order) {
    if (id == null || !seen.add(id)) return;
    order.add(id);
    for (var e : edges) if (e.get("from").equals(id)) walk((String) e.get("to"), seen, order);
  }

  String sequence(
      List<? extends StatementTree> statements, String next, String br, String co, int d) {
    String cur = next;
    for (int i = statements.size() - 1; i >= 0; i--) cur = flow(statements.get(i), cur, br, co, d);
    return cur;
  }

  String flow(StatementTree t, String next, String br, String co, int d) {
    if (t == null) return next;
    if (t instanceof BlockTree b) return sequence(b.getStatements(), next, br, co, d);
    if (t instanceof IfTree v) {
      String n = node(t, "condition", v.getCondition().toString(), d, v.getCondition());
      edge(n, flow(v.getThenStatement(), next, br, co, d + 1), "да");
      edge(n, flow(v.getElseStatement(), next, br, co, d + 1), "нет");
      return n;
    }
    if (t instanceof ForLoopTree v) {
      String n =
          node(
              t,
              "loop",
              v.getCondition() == null ? "true" : v.getCondition().toString(),
              d,
              v.getCondition());
      String update = n;
      for (int i = v.getUpdate().size() - 1; i >= 0; i--)
        update = flow(v.getUpdate().get(i), update, next, n, d + 1);
      edge(n, flow(v.getStatement(), update, next, update, d + 1), "повтор");
      if (v.getCondition() != null) edge(n, next, "выход");
      return sequence(v.getInitializer(), n, next, update, d);
    }
    if (t instanceof EnhancedForLoopTree v) {
      String n = node(t, "loop", v.getVariable() + " : " + v.getExpression(), d, v.getExpression());
      edge(n, flow(v.getStatement(), n, next, n, d + 1), "элемент");
      edge(n, next, "конец");
      return n;
    }
    if (t instanceof WhileLoopTree v) {
      String n = node(t, "loop", v.getCondition().toString(), d, v.getCondition());
      edge(n, flow(v.getStatement(), n, next, n, d + 1), "да");
      edge(n, next, "нет");
      return n;
    }
    if (t instanceof DoWhileLoopTree v) {
      String n = node(t, "loop", v.getCondition().toString(), d, v.getCondition());
      String body = flow(v.getStatement(), n, next, n, d + 1);
      edge(n, body, "да");
      edge(n, next, "нет");
      return body;
    }
    if (t instanceof SwitchTree v) {
      String n = node(t, "switch", v.getExpression().toString(), d, v.getExpression());
      String fall = next;
      boolean hasDefault = false;
      List<? extends CaseTree> cases = v.getCases();
      for (int i = cases.size() - 1; i >= 0; i--) {
        CaseTree c = cases.get(i);
        String dest;
        if (c.getStatements() != null) dest = sequence(c.getStatements(), fall, next, co, d + 1);
        else if (c.getBody() instanceof StatementTree s) dest = flow(s, next, next, co, d + 1);
        else {
          dest = node(c, "operation", c.toString(), d + 1, null);
          edge(dest, next, "результат");
        }
        String label = c.getExpressions().isEmpty() ? "default" : c.getExpressions().toString();
        hasDefault |= label.equals("default");
        edge(n, dest, label);
        fall = dest;
      }
      if (!hasDefault) edge(n, next, "иначе");
      return n;
    }
    if (t instanceof TryTree v) {
      String fin = flow(v.getFinallyBlock(), next, br, co, d + 1);
      String n =
          node(t, "try", "try" + (v.getResources().isEmpty() ? "" : " (resources)"), d, null);
      edge(n, flow(v.getBlock(), fin, br, co, d + 1), "основной путь");
      for (CatchTree c : v.getCatches()) {
        String cn = node(c, "catch", c.getParameter().toString(), d + 1, null);
        edge(cn, flow(c.getBlock(), fin, br, co, d + 1), "обработчик");
        edge(n, cn, "возможно исключение");
      }
      return n;
    }
    if (t instanceof LabeledStatementTree v) {
      String n = node(t, "opaque", "Метка " + v.getLabel() + " (структурный блок)", d, t);
      edge(n, next, "далее");
      return n;
    }
    String kind =
        switch (t.getKind()) {
          case RETURN -> "return";
          case THROW -> "throw";
          case BREAK -> "break";
          case CONTINUE -> "continue";
          case VARIABLE -> "variable";
          default -> "operation";
        };
    String n = node(t, kind, model.text(t), d, t);
    if (t instanceof BreakTree b) {
      if (b.getLabel() == null) edge(n, br, "break");
    } else if (t instanceof ContinueTree c) {
      if (c.getLabel() == null) edge(n, co, "continue");
    } else if (t instanceof ReturnTree) edge(n, exit, "return");
    else if (!(t instanceof ThrowTree)) edge(n, next, "далее");
    return n;
  }
}
