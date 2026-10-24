import com.sun.source.tree.*;
import java.util.*;

/**
 * Java method → node graph with exec and data pins (see web/blueprint/model.mjs).
 * Constructs without a dedicated node become "code"/"expr" nodes holding their exact source,
 * so generating Java from an imported graph never changes behaviour.
 */
public final class BlueprintImport {
  private final JavaModel model;
  private final List<Map<String, Object>> nodes = new ArrayList<>();
  private final List<Map<String, Object>> links = new ArrayList<>();
  private final Map<String, String> variables = new LinkedHashMap<>();
  private final Map<String, String> fields = new LinkedHashMap<>();
  private int serial;

  private record Cursor(String node, String pin) {}

  BlueprintImport(JavaModel model) {
    this.model = model;
  }

  Map<String, Object> build(JavaModel.Method method) {
    MethodTree tree = method.tree();
    // Only the owner's own fields are in scope unqualified; enum constants are not variables.
    String owner = method.owner().contains(".") ? method.owner().substring(method.owner().lastIndexOf('.') + 1) : method.owner();
    new com.sun.source.util.TreeScanner<Void, Void>() {
      public Void visitClass(ClassTree c, Void v) {
        if (c.getSimpleName().contentEquals(owner))
          for (Tree member : c.getMembers())
            if (member instanceof VariableTree field
                && !(c.getKind() == Tree.Kind.ENUM && field.getType() != null && field.getType().toString().equals(c.getSimpleName().toString())))
              fields.put(field.getName().toString(), field.getType().toString());
        return super.visitClass(c, v);
      }
    }.scan(model.unit, null);
    variables.putAll(fields);
    List<Object> params = new ArrayList<>();
    for (VariableTree parameter : tree.getParameters()) {
      variables.put(parameter.getName().toString(), parameter.getType().toString());
      params.add(Digests.map("name", parameter.getName().toString(), "type", parameter.getType().toString()));
    }
    new com.sun.source.util.TreeScanner<Void, Void>() {
      public Void visitVariable(VariableTree x, Void v) {
        variables.put(x.getName().toString(), x.getType() == null ? "var" : x.getType().toString());
        return super.visitVariable(x, v);
      }
    }.scan(tree.getBody(), null);
    String entry = node("entry", Map.of(), tree);
    Cursor end = tree.getBody() == null ? null : block(tree.getBody().getStatements(), new Cursor(entry, "then"));
    String returnType = tree.getReturnType() == null ? "void" : tree.getReturnType().toString();
    if (end != null && returnType.equals("void") && !nodes.isEmpty()) {
      // An explicit end node keeps the exec line readable; it generates no code for void methods.
      String finish = node("return", Map.of("implicit", true), null);
      link(end.node(), end.pin(), finish, "in");
    }
    String modifiers =
        String.join(" ", tree.getModifiers().getFlags().stream().map(Object::toString).toList());
    return Digests.map(
        "version", 1,
        "methodId", method.id(),
        "method",
            Digests.map(
                "name", tree.getName().toString(),
                "owner", method.owner(),
                "returnType", returnType,
                "params", params,
                "modifiers", modifiers,
                "static", tree.getModifiers().getFlags().contains(javax.lang.model.element.Modifier.STATIC)),
        "bodyStart", tree.getBody() == null ? -1 : model.start(tree.getBody()),
        "bodyEnd", tree.getBody() == null ? -1 : model.end(tree.getBody()),
        "fields",
            fields.entrySet().stream()
                .map(e -> (Object) Digests.map("name", e.getKey(), "type", e.getValue()))
                .toList(),
        "nodes", nodes,
        "links", links);
  }

  private String node(String type, Map<String, Object> props, Tree tree) {
    String id = "n" + (serial++);
    Map<String, Object> node = new LinkedHashMap<>();
    node.put("id", id);
    node.put("type", type);
    node.put("props", new LinkedHashMap<>(props));
    node.put("line", tree == null ? 0 : model.line(tree));
    node.put("start", tree == null ? -1 : model.start(tree));
    node.put("end", tree == null ? -1 : model.end(tree));
    nodes.add(node);
    return id;
  }

  private void link(String from, String fromPin, String to, String toPin) {
    links.add(Digests.map("from", from, "fromPin", fromPin, "to", to, "toPin", toPin));
  }

  private String attach(Cursor cursor, String id) {
    if (cursor != null) link(cursor.node(), cursor.pin(), id, "in");
    return id;
  }

  private Cursor block(List<? extends StatementTree> statements, Cursor cursor) {
    for (StatementTree statement : statements) {
      if (cursor == null) break;
      cursor = statement(statement, cursor);
    }
    return cursor;
  }

  private Cursor body(StatementTree statement, Cursor cursor) {
    if (statement instanceof BlockTree block) return block(block.getStatements(), cursor);
    return statement(statement, cursor);
  }

  private String text(Tree tree) {
    String value = model.text(tree).strip();
    return value.endsWith(";") ? value.substring(0, value.length() - 1).strip() : value;
  }

  private Cursor code(StatementTree statement, Cursor cursor) {
    String id = attach(cursor, node("code", Map.of("code", model.text(statement).strip()), statement));
    return new Cursor(id, "then");
  }

  private Cursor statement(StatementTree statement, Cursor cursor) {
    if (statement instanceof BlockTree block) {
      boolean declares = block.getStatements().stream().anyMatch(s -> s instanceof VariableTree);
      return declares ? code(statement, cursor) : block(block.getStatements(), cursor);
    }
    if (statement instanceof VariableTree variable) {
      if (variable.getType() == null || variable.getType().toString().equals("var")
          && variable.getInitializer() == null) return code(statement, cursor);
      Map<String, Object> props =
          Digests.map(
              "name", variable.getName().toString(),
              "type", variable.getType().toString(),
              "declare", true);
      if (!variable.getModifiers().getFlags().isEmpty()) return code(statement, cursor);
      String id = attach(cursor, node("set", props, statement));
      if (variable.getInitializer() != null) value(variable.getInitializer(), id, "value");
      return new Cursor(id, "then");
    }
    if (statement instanceof ExpressionStatementTree expression) {
      ExpressionTree e = expression.getExpression();
      if (e instanceof AssignmentTree assignment
          && assignment.getVariable() instanceof IdentifierTree target
          && variables.containsKey(target.getName().toString())) {
        String name = target.getName().toString();
        String id =
            attach(cursor, node("set", Digests.map("name", name, "type", variables.get(name), "declare", false, "assignOp", "="), statement));
        value(assignment.getExpression(), id, "value");
        return new Cursor(id, "then");
      }
      if (e instanceof CompoundAssignmentTree compound
          && compound.getVariable() instanceof IdentifierTree target
          && variables.containsKey(target.getName().toString())
          && OPS.containsKey(compound.getKind())) {
        String name = target.getName().toString();
        String id =
            attach(
                cursor,
                node("set", Digests.map("name", name, "type", variables.get(name), "declare", false, "assignOp", OPS.get(compound.getKind())), statement));
        value(compound.getExpression(), id, "value");
        return new Cursor(id, "then");
      }
      if (e instanceof UnaryTree unary
          && unary.getExpression() instanceof IdentifierTree target
          && variables.containsKey(target.getName().toString())
          && Set.of(Tree.Kind.POSTFIX_INCREMENT, Tree.Kind.PREFIX_INCREMENT, Tree.Kind.POSTFIX_DECREMENT, Tree.Kind.PREFIX_DECREMENT)
              .contains(unary.getKind())) {
        String name = target.getName().toString();
        boolean up = unary.getKind() == Tree.Kind.POSTFIX_INCREMENT || unary.getKind() == Tree.Kind.PREFIX_INCREMENT;
        String id =
            attach(cursor, node("set", Digests.map("name", name, "type", variables.get(name), "declare", false, "assignOp", up ? "++" : "--"), statement));
        return new Cursor(id, "then");
      }
      if (e instanceof MethodInvocationTree call && call.getTypeArguments().isEmpty()) {
        String id = call(call, false, statement);
        attach(cursor, id);
        return new Cursor(id, "then");
      }
      return code(statement, cursor);
    }
    if (statement instanceof IfTree branch) {
      String id = attach(cursor, node("branch", Map.of(), statement));
      value(branch.getCondition(), id, "condition");
      body(branch.getThenStatement(), new Cursor(id, "true"));
      if (branch.getElseStatement() != null) body(branch.getElseStatement(), new Cursor(id, "false"));
      return new Cursor(id, "then");
    }
    if (statement instanceof WhileLoopTree loop) {
      String id = attach(cursor, node("while", Map.of(), statement));
      value(loop.getCondition(), id, "condition");
      body(loop.getStatement(), new Cursor(id, "body"));
      return new Cursor(id, "then");
    }
    if (statement instanceof ForLoopTree loop) {
      if (loop.getInitializer().size() > 1) return code(statement, cursor);
      String init = loop.getInitializer().isEmpty() ? "" : text(loop.getInitializer().get(0));
      String update =
          String.join(", ", loop.getUpdate().stream().map(u -> text(u.getExpression())).toList());
      String id = attach(cursor, node("for", Digests.map("init", init, "update", update), statement));
      if (loop.getCondition() != null) value(loop.getCondition(), id, "condition");
      body(loop.getStatement(), new Cursor(id, "body"));
      return new Cursor(id, "then");
    }
    if (statement instanceof EnhancedForLoopTree loop) {
      VariableTree variable = loop.getVariable();
      if (!variable.getModifiers().getFlags().isEmpty()) return code(statement, cursor);
      String id =
          attach(
              cursor,
              node("foreach", Digests.map("name", variable.getName().toString(), "type", variable.getType().toString()), statement));
      value(loop.getExpression(), id, "collection");
      body(loop.getStatement(), new Cursor(id, "body"));
      return new Cursor(id, "then");
    }
    if (statement instanceof ReturnTree ret) {
      String id = attach(cursor, node("return", Map.of(), statement));
      if (ret.getExpression() != null) value(ret.getExpression(), id, "value");
      return null;
    }
    if (statement instanceof ThrowTree thrown) {
      String id = attach(cursor, node("throw", Map.of(), statement));
      value(thrown.getExpression(), id, "value");
      return null;
    }
    if (statement instanceof BreakTree br && br.getLabel() == null) {
      attach(cursor, node("break", Map.of(), statement));
      return null;
    }
    if (statement instanceof ContinueTree co && co.getLabel() == null) {
      attach(cursor, node("continue", Map.of(), statement));
      return null;
    }
    return code(statement, cursor);
  }

  private static final Map<Tree.Kind, String> OPS = new EnumMap<>(Tree.Kind.class);

  static {
    Object[][] table = {
      {Tree.Kind.PLUS, "+"}, {Tree.Kind.MINUS, "-"}, {Tree.Kind.MULTIPLY, "*"}, {Tree.Kind.DIVIDE, "/"},
      {Tree.Kind.REMAINDER, "%"}, {Tree.Kind.EQUAL_TO, "=="}, {Tree.Kind.NOT_EQUAL_TO, "!="},
      {Tree.Kind.LESS_THAN, "<"}, {Tree.Kind.LESS_THAN_EQUAL, "<="}, {Tree.Kind.GREATER_THAN, ">"},
      {Tree.Kind.GREATER_THAN_EQUAL, ">="}, {Tree.Kind.CONDITIONAL_AND, "&&"}, {Tree.Kind.CONDITIONAL_OR, "||"},
      {Tree.Kind.AND, "&"}, {Tree.Kind.OR, "|"}, {Tree.Kind.XOR, "^"}, {Tree.Kind.LEFT_SHIFT, "<<"},
      {Tree.Kind.RIGHT_SHIFT, ">>"}, {Tree.Kind.UNSIGNED_RIGHT_SHIFT, ">>>"},
      {Tree.Kind.PLUS_ASSIGNMENT, "+="}, {Tree.Kind.MINUS_ASSIGNMENT, "-="}, {Tree.Kind.MULTIPLY_ASSIGNMENT, "*="},
      {Tree.Kind.DIVIDE_ASSIGNMENT, "/="}, {Tree.Kind.REMAINDER_ASSIGNMENT, "%="}, {Tree.Kind.AND_ASSIGNMENT, "&="},
      {Tree.Kind.OR_ASSIGNMENT, "|="}, {Tree.Kind.XOR_ASSIGNMENT, "^="}, {Tree.Kind.LEFT_SHIFT_ASSIGNMENT, "<<="},
      {Tree.Kind.RIGHT_SHIFT_ASSIGNMENT, ">>="}, {Tree.Kind.UNSIGNED_RIGHT_SHIFT_ASSIGNMENT, ">>>="},
      {Tree.Kind.LOGICAL_COMPLEMENT, "!"}, {Tree.Kind.UNARY_MINUS, "-"}, {Tree.Kind.UNARY_PLUS, "+"},
      {Tree.Kind.BITWISE_COMPLEMENT, "~"},
    };
    for (Object[] row : table) OPS.put((Tree.Kind) row[0], (String) row[1]);
  }

  private static final Map<String, Integer> PRECEDENCE =
      Map.ofEntries(
          Map.entry("||", 3), Map.entry("&&", 4), Map.entry("|", 5), Map.entry("^", 6), Map.entry("&", 7),
          Map.entry("==", 8), Map.entry("!=", 8), Map.entry("<", 9), Map.entry("<=", 9), Map.entry(">", 9),
          Map.entry(">=", 9), Map.entry("<<", 10), Map.entry(">>", 10), Map.entry(">>>", 10),
          Map.entry("+", 11), Map.entry("-", 11), Map.entry("*", 12), Map.entry("/", 12), Map.entry("%", 12));

  /** Builds the data subgraph of an expression and wires it into (target, pin). */
  private void value(ExpressionTree expression, String target, String pin) {
    String[] source = expression(expression);
    link(source[0], source[1], target, pin);
  }

  private String[] raw(ExpressionTree e) {
    // Precedence lets the generator decide where parentheses are needed around raw text.
    int precedence =
        e instanceof IdentifierTree || e instanceof LiteralTree || e instanceof MemberSelectTree
                || e instanceof MethodInvocationTree || e instanceof NewClassTree
                || e instanceof ArrayAccessTree
            ? 20
            : e instanceof AssignmentTree || e instanceof CompoundAssignmentTree || e instanceof LambdaExpressionTree
                ? 1
                : e instanceof InstanceOfTree ? 9 : e instanceof UnaryTree ? 14 : 2;
    return new String[] {node("expr", Digests.map("code", model.text(e).strip(), "precedence", precedence), e), "value"};
  }

  private String[] expression(ExpressionTree e) {
    if (e instanceof ParenthesizedTree p) return expression(p.getExpression());
    if (e instanceof LiteralTree literal)
      return new String[] {node("literal", Digests.map("value", model.text(e).strip(), "type", literalType(literal)), e), "value"};
    if (e instanceof IdentifierTree id) {
      String name = id.getName().toString();
      if (variables.containsKey(name))
        return new String[] {node("get", Digests.map("name", name, "type", variables.get(name)), e), "value"};
      return raw(e);
    }
    if (e instanceof BinaryTree binary && OPS.containsKey(binary.getKind())) {
      String id = node("op", Digests.map("op", OPS.get(binary.getKind())), e);
      value(binary.getLeftOperand(), id, "a");
      value(binary.getRightOperand(), id, "b");
      return new String[] {id, "value"};
    }
    if (e instanceof UnaryTree unary
        && Set.of(Tree.Kind.LOGICAL_COMPLEMENT, Tree.Kind.UNARY_MINUS, Tree.Kind.UNARY_PLUS, Tree.Kind.BITWISE_COMPLEMENT)
            .contains(unary.getKind())) {
      String id = node("op", Digests.map("op", OPS.get(unary.getKind()), "unary", true), e);
      value(unary.getExpression(), id, "a");
      return new String[] {id, "value"};
    }
    if (e instanceof ConditionalExpressionTree conditional) {
      String id = node("select", Map.of(), e);
      value(conditional.getCondition(), id, "condition");
      value(conditional.getTrueExpression(), id, "a");
      value(conditional.getFalseExpression(), id, "b");
      return new String[] {id, "value"};
    }
    if (e instanceof MethodInvocationTree call && call.getTypeArguments().isEmpty())
      return new String[] {call(call, true, e), "value"};
    if (e instanceof MemberSelectTree select && !qualifiedName(select.getExpression())) {
      String id = node("member", Digests.map("name", select.getIdentifier().toString(), "type", "any"), e);
      value(select.getExpression(), id, "target");
      return new String[] {id, "value"};
    }
    if (e instanceof ArrayAccessTree access) {
      String id = node("index", Digests.map("type", "any"), e);
      value(access.getExpression(), id, "array");
      value(access.getIndex(), id, "index");
      return new String[] {id, "value"};
    }
    if (e instanceof TypeCastTree cast) {
      String id = node("cast", Digests.map("type", cast.getType().toString()), e);
      value(cast.getExpression(), id, "value");
      return new String[] {id, "value"};
    }
    return raw(e);
  }

  /** System.out, Math, java.util.List: names of types and packages rather than values. */
  private boolean qualifiedName(ExpressionTree e) {
    if (e instanceof IdentifierTree id) return !variables.containsKey(id.getName().toString());
    if (e instanceof MemberSelectTree select) return qualifiedName(select.getExpression());
    return false;
  }

  private String call(MethodInvocationTree call, boolean pure, Tree anchor) {
    ExpressionTree select = call.getMethodSelect();
    Map<String, Object> props = new LinkedHashMap<>();
    String name;
    ExpressionTree target = null;
    if (select instanceof MemberSelectTree member) {
      name = member.getIdentifier().toString();
      if (qualifiedName(member.getExpression())) props.put("target", model.text(member.getExpression()).strip());
      else target = member.getExpression();
    } else name = select.toString();
    props.put("name", name);
    props.put("argc", call.getArguments().size());
    props.put("pure", pure);
    if (target != null) props.put("targetPin", true);
    String id = node("call", props, anchor);
    if (target != null) value(target, id, "target");
    for (int i = 0; i < call.getArguments().size(); i++) value(call.getArguments().get(i), id, "a" + i);
    return id;
  }

  private static String literalType(LiteralTree literal) {
    return switch (literal.getKind()) {
      case INT_LITERAL -> "int";
      case LONG_LITERAL -> "long";
      case FLOAT_LITERAL -> "float";
      case DOUBLE_LITERAL -> "double";
      case BOOLEAN_LITERAL -> "boolean";
      case CHAR_LITERAL -> "char";
      case STRING_LITERAL -> "String";
      default -> "object";
    };
  }
}
