/**
 * Graph → Java. Exec wires become statements in order; data wires become expressions,
 * re-evaluated at each use like pure nodes in Unreal Blueprints.
 */

const PRECEDENCE = {
  "||": 3, "&&": 4, "|": 5, "^": 6, "&": 7, "==": 8, "!=": 8,
  "<": 9, "<=": 9, ">": 9, ">=": 9, "instanceof": 9, "<<": 10, ">>": 10, ">>>": 10,
  "+": 11, "-": 11, "*": 12, "/": 12, "%": 12,
};

const DEFAULTS = { int: "0", long: "0L", short: "0", byte: "0", double: "0.0", float: "0f", char: "'\\0'", boolean: "false", String: '""' };

export class CodegenError extends Error {
  constructor(message, nodeId) {
    super(message);
    this.nodeId = nodeId;
  }
}

export function generate(graph, { indent = "        " } = {}) {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const outgoing = new Map();
  const incoming = new Map();
  for (const link of graph.links) {
    outgoing.set(link.from + ":" + link.fromPin, link);
    incoming.set(link.to + ":" + link.toPin, link);
  }
  const problems = [];
  const next = (id, pin) => outgoing.get(id + ":" + pin)?.to ?? null;

  function input(node, pin, type) {
    const link = incoming.get(node.id + ":" + pin);
    if (!link) {
      problems.push({ nodeId: node.id, message: `Не подключён вход «${pin}»` });
      return { code: DEFAULTS[type] ?? "null", precedence: 20 };
    }
    return value(nodes.get(link.from), link.fromPin, new Set());
  }

  function value(node, pin, seen) {
    if (!node) return { code: "null", precedence: 20 };
    if (seen.has(node.id)) throw new CodegenError("Цикл в проводах данных", node.id);
    seen.add(node.id);
    const p = node.props ?? {};
    const sub = (name) => {
      const link = incoming.get(node.id + ":" + name);
      if (!link) {
        problems.push({ nodeId: node.id, message: `Не подключён вход «${name}»` });
        return { code: "null", precedence: 20 };
      }
      return value(nodes.get(link.from), link.fromPin, new Set(seen));
    };
    const wrap = (child, minimum, right = false) =>
      child.precedence < minimum || (right && child.precedence === minimum) ? `(${child.code})` : child.code;
    switch (node.type) {
      case "entry":
        return { code: pin.replace(/^p:/, ""), precedence: 20 };
      case "get":
        return { code: p.name, precedence: 20 };
      case "literal":
      case "expr":
        return { code: String(p.value ?? p.code), precedence: node.type === "literal" ? 20 : (p.precedence ?? 1) };
      case "op": {
        if (p.unary) {
          const a = sub("a");
          return { code: `${p.op}${wrap(a, 14)}`, precedence: 14 };
        }
        const level = PRECEDENCE[p.op] ?? 1;
        return { code: `${wrap(sub("a"), level)} ${p.op} ${wrap(sub("b"), level, true)}`, precedence: level };
      }
      case "select":
        return { code: `${wrap(sub("condition"), 3)} ? ${wrap(sub("a"), 3)} : ${wrap(sub("b"), 2)}`, precedence: 2 };
      case "call":
        return { code: callCode(node, sub), precedence: 16 };
      case "member":
        return { code: `${wrap(sub("target"), 16)}.${p.name}`, precedence: 16 };
      case "index":
        return { code: `${wrap(sub("array"), 16)}[${sub("index").code}]`, precedence: 16 };
      case "cast":
        return { code: `(${p.type}) ${wrap(sub("value"), 14)}`, precedence: 14 };
      case "reroute":
        return sub("a");
      default:
        throw new CodegenError(`Узел «${node.type}» не даёт значения`, node.id);
    }
  }

  function callCode(node, sub) {
    const p = node.props ?? {};
    const args = Array.from({ length: Number(p.argc ?? 0) }, (_, i) => sub("a" + i).code).join(", ");
    const target = p.targetPin ? `${sub("target").code}.` : p.target ? `${p.target}.` : "";
    return `${target}${p.name}(${args})`;
  }

  const visiting = new Set();

  function chain(id, depth) {
    const lines = [];
    const pad = indent + "    ".repeat(depth);
    const path = [];
    while (id) {
      if (visiting.has(id)) throw new CodegenError("Exec-провода образуют цикл: используйте узел цикла", id);
      visiting.add(id);
      path.push(id);
      const node = nodes.get(id);
      if (!node) break;
      const p = node.props ?? {};
      const sub = (pin, type) => input(node, pin, type).code;
      const block = (pin) => {
        const inner = chain(next(node.id, pin), depth + 1);
        return inner.length ? inner : [];
      };
      switch (node.type) {
        case "set":
          if (["++", "--"].includes(p.assignOp)) lines.push(`${pad}${p.name}${p.assignOp};`);
          else if (p.declare && !incoming.has(node.id + ":value")) lines.push(`${pad}${p.type} ${p.name};`);
          else lines.push(`${pad}${p.declare ? p.type + " " : ""}${p.name} ${p.assignOp && !p.declare ? p.assignOp : "="} ${sub("value", p.type)};`);
          break;
        case "call":
          lines.push(`${pad}${callCode(node, (pin) => input(node, pin))};`);
          break;
        case "return":
          if (p.implicit && depth === 0) break;
          lines.push(`${pad}return${graph.method?.returnType && graph.method.returnType !== "void" ? " " + sub("value", graph.method.returnType) : ""};`);
          break;
        case "throw":
          lines.push(`${pad}throw ${sub("value")};`);
          break;
        case "break":
        case "continue":
          lines.push(`${pad}${node.type};`);
          break;
        case "branch": {
          lines.push(`${pad}if (${sub("condition", "boolean")}) {`, ...block("true"));
          const otherwise = block("false");
          if (otherwise.length) lines.push(`${pad}} else {`, ...otherwise);
          lines.push(`${pad}}`);
          break;
        }
        case "while":
          lines.push(`${pad}while (${sub("condition", "boolean")}) {`, ...block("body"), `${pad}}`);
          break;
        case "for": {
          const condition = incoming.has(node.id + ":condition") ? sub("condition", "boolean") : "";
          lines.push(`${pad}for (${p.init ?? ""}; ${condition}; ${p.update ?? ""}) {`, ...block("body"), `${pad}}`);
          break;
        }
        case "foreach":
          lines.push(`${pad}for (${p.type} ${p.name} : ${sub("collection")}) {`, ...block("body"), `${pad}}`);
          break;
        case "code":
          for (const line of reindent(String(p.code ?? ""), pad)) lines.push(line);
          break;
        case "entry":
        case "reroute":
          break;
        default:
          throw new CodegenError(`Узел «${node.type}» нельзя подключать к exec-проводу`, node.id);
      }
      if (["return", "throw", "break", "continue"].includes(node.type)) break;
      id = next(node.id, "then");
    }
    for (const done of path) visiting.delete(done);
    return lines;
  }

  const entry = graph.nodes.find((node) => node.type === "entry");
  if (!entry) throw new CodegenError("В графе нет узла начала метода");
  const lines = chain(next(entry.id, "then"), 0);
  return { code: lines.join("\n"), problems };
}

/** Keeps the relative indentation of a raw Java fragment under a new base indentation. */
export function reindent(text, pad) {
  const rows = text.replace(/\r\n?/g, "\n").split("\n");
  while (rows.length && !rows.at(-1).trim()) rows.pop();
  const widths = rows.filter((row) => row.trim()).map((row) => row.match(/^\s*/)[0].length);
  // The first line of an AST fragment starts at the statement, later lines keep source indentation.
  const rest = widths.slice(1);
  const base = rest.length ? Math.min(...rest) : 0;
  return rows.map((row, index) => {
    if (!row.trim()) return "";
    if (index === 0) return pad + row.trim();
    const cut = row.slice(Math.min(base, row.match(/^\s*/)[0].length));
    return pad + cut;
  });
}

/** Full method declaration around a generated body, used when a method is created from blocks. */
export function methodSource(graph, body, indent = "    ") {
  const m = graph.method;
  const params = (m.params ?? []).map((param) => `${param.type} ${param.name}`).join(", ");
  return `${indent}${m.modifiers ?? "static"} ${m.returnType ?? "void"} ${m.name}(${params}) {\n${body}${body ? "\n" : ""}${indent}}`;
}
