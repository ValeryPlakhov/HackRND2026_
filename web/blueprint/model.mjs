/**
 * Node graph in the spirit of Unreal Blueprints: white exec pins carry control flow,
 * coloured data pins carry values. The graph of a method is the source of Java for its body.
 */

/** Value colours by type, tuned to the IDE palette (flow ports use the neutral flow colour). */
export const PIN_COLORS = {
  exec: "#53607a",
  boolean: "#c0485a",
  int: "#1f8f8a",
  long: "#177571",
  short: "#177571",
  byte: "#177571",
  double: "#5d9a2e",
  float: "#5d9a2e",
  char: "#3f86c7",
  String: "#b5489c",
  object: "#3767df",
  array: "#c27c16",
  any: "#8a94a8",
};

const NUMERIC = new Set(["int", "long", "short", "byte", "double", "float", "char"]);
const COMPARISON = new Set(["==", "!=", "<", "<=", ">", ">="]);
const LOGICAL = new Set(["&&", "||", "!"]);

export function typeColor(type = "any") {
  const base = String(type).replace(/<.*$/, "");
  if (base.endsWith("[]")) return PIN_COLORS.array;
  if (PIN_COLORS[base]) return PIN_COLORS[base];
  if (/^(Integer|Long|Short|Byte)$/.test(base)) return PIN_COLORS.int;
  if (/^(Double|Float)$/.test(base)) return PIN_COLORS.double;
  if (base === "Boolean") return PIN_COLORS.boolean;
  if (base === "Character") return PIN_COLORS.char;
  return base === "any" || !base ? PIN_COLORS.any : PIN_COLORS.object;
}

const exec = (id, label = "") => ({ id, label, kind: "exec", type: "exec" });
const data = (id, label, type = "any") => ({ id, label, kind: "data", type });

/** Catalogue for the palette: what a user can place on the canvas. */
export const CATALOG = [
  { group: "Поток", type: "branch", title: "if (условие)", props: {} },
  { group: "Поток", type: "while", title: "while (условие)", props: {} },
  { group: "Поток", type: "for", title: "for (init; условие; шаг)", props: { init: "int i = 0", update: "i++" } },
  { group: "Поток", type: "foreach", title: "for (Тип x : коллекция)", props: { name: "item", type: "int" } },
  { group: "Поток", type: "return", title: "return", props: {} },
  { group: "Поток", type: "break", title: "break", props: {} },
  { group: "Поток", type: "continue", title: "continue", props: {} },
  { group: "Поток", type: "throw", title: "throw", props: {} },
  { group: "Переменные", type: "set", title: "Объявление: Тип x = …", props: { name: "value", type: "int", declare: true } },
  { group: "Переменные", type: "set", title: "Присваивание: x = …", props: { name: "value", type: "int", declare: false } },
  { group: "Переменные", type: "get", title: "Чтение переменной", props: { name: "value", type: "int" } },
  { group: "Значения", type: "literal", title: "Число: 0", props: { value: "0", type: "int" } },
  { group: "Значения", type: "literal", title: "Строка: \"…\"", props: { value: '"текст"', type: "String" } },
  { group: "Значения", type: "literal", title: "boolean: true / false", props: { value: "true", type: "boolean" } },
  { group: "Значения", type: "expr", title: "Выражение Java", props: { code: "0", type: "any" } },
  ...["+", "-", "*", "/", "%"].map((op) => ({ group: "Математика", type: "op", title: `a ${op} b`, props: { op } })),
  ...["==", "!=", "<", "<=", ">", ">="].map((op) => ({ group: "Сравнение", type: "op", title: `a ${op} b`, props: { op } })),
  { group: "Логика", type: "op", title: "a && b", props: { op: "&&" } },
  { group: "Логика", type: "op", title: "a || b", props: { op: "||" } },
  { group: "Логика", type: "op", title: "!a", props: { op: "!", unary: true } },
  { group: "Логика", type: "select", title: "c ? a : b", props: {} },
  { group: "Ввод-вывод", type: "call", title: "System.out.println(…)", props: { target: "System.out", name: "println", argc: 1, pure: false } },
  { group: "Ввод-вывод", type: "call", title: "System.out.print(…)", props: { target: "System.out", name: "print", argc: 1, pure: false } },
  { group: "Ввод-вывод", type: "call", title: "Scanner.nextInt()", props: { target: "input", name: "nextInt", argc: 0, pure: true, returnType: "int" } },
  { group: "Ввод-вывод", type: "call", title: "Scanner.nextLine()", props: { target: "input", name: "nextLine", argc: 0, pure: true, returnType: "String" } },
  { group: "Ввод-вывод", type: "code", title: "new Scanner(System.in)", props: { code: "java.util.Scanner input = new java.util.Scanner(System.in);" } },
  { group: "Методы", type: "call", title: "Вызов метода: инструкция", props: { target: "", name: "method", argc: 0, pure: false } },
  { group: "Методы", type: "call", title: "Вызов метода: значение", props: { target: "", name: "method", argc: 0, pure: true } },
  { group: "Методы", type: "call", title: "Math.max(a, b)", props: { target: "Math", name: "max", argc: 2, pure: true, returnType: "int" } },
  { group: "Объекты", type: "member", title: "x.поле", props: { name: "length", type: "int" } },
  { group: "Объекты", type: "index", title: "a[i]", props: {} },
  { group: "Объекты", type: "cast", title: "(Тип) x", props: { type: "int" } },
  { group: "Java", type: "code", title: "Произвольный код Java", props: { code: "// код" } },
];

/** Pins of a node, computed from its type and properties. */
export function pinsOf(node, graph) {
  const p = node.props ?? {};
  switch (node.type) {
    case "entry":
      return {
        inputs: [],
        outputs: [exec("then"), ...(graph?.method?.params ?? []).map((param) => data("p:" + param.name, param.name, param.type))],
      };
    case "return":
      return {
        inputs: [exec("in"), ...(graph?.method?.returnType && graph.method.returnType !== "void" ? [data("value", "Значение", graph.method.returnType)] : [])],
        outputs: [],
      };
    case "set":
      return {
        inputs: [exec("in"), ...(["++", "--"].includes(p.assignOp) ? [] : [data("value", p.assignOp && p.assignOp !== "=" ? p.assignOp : "Значение", p.type)])],
        outputs: [exec("then")],
      };
    case "get":
      return { inputs: [], outputs: [data("value", "", p.type)] };
    case "literal":
      return { inputs: [], outputs: [data("value", "", p.type)] };
    case "expr":
      return { inputs: [], outputs: [data("value", "", p.type ?? "any")] };
    case "op": {
      const type = COMPARISON.has(p.op) || LOGICAL.has(p.op) ? "boolean" : (p.type ?? "any");
      return {
        inputs: p.unary ? [data("a", "", LOGICAL.has(p.op) ? "boolean" : "any")] : [data("a", "", LOGICAL.has(p.op) ? "boolean" : "any"), data("b", "", LOGICAL.has(p.op) ? "boolean" : "any")],
        outputs: [data("value", "", type)],
      };
    }
    case "select":
      return { inputs: [data("condition", "Условие", "boolean"), data("a", "Если да"), data("b", "Если нет")], outputs: [data("value", "")] };
    case "branch":
      return { inputs: [exec("in"), data("condition", "условие", "boolean")], outputs: [exec("true", "true"), exec("false", "false"), exec("then", "дальше")] };
    case "while":
      return { inputs: [exec("in"), data("condition", "условие", "boolean")], outputs: [exec("body", "тело"), exec("then", "дальше")] };
    case "for":
      return { inputs: [exec("in"), data("condition", "условие", "boolean")], outputs: [exec("body", "тело"), exec("then", "дальше")] };
    case "foreach":
      return { inputs: [exec("in"), data("collection", "коллекция", "array")], outputs: [exec("body", "тело"), exec("then", "дальше")] };
    case "call": {
      const args = Array.from({ length: Number(p.argc ?? 0) }, (_, i) => data("a" + i, "арг " + (i + 1)));
      return {
        inputs: [...(p.pure ? [] : [exec("in")]), ...(p.targetPin ? [data("target", "Объект", "object")] : []), ...args],
        outputs: [...(p.pure ? [] : [exec("then")]), ...(p.pure || (p.returnType && p.returnType !== "void") ? [data("value", "", p.returnType ?? "any")] : [])],
      };
    }
    case "member":
      return { inputs: [data("target", "Объект", "object")], outputs: [data("value", "", p.type ?? "any")] };
    case "index":
      return { inputs: [data("array", "Массив", "array"), data("index", "Индекс", "int")], outputs: [data("value", "", p.type ?? "any")] };
    case "cast":
      return { inputs: [data("value", "", "any")], outputs: [data("value", "", p.type)] };
    case "throw":
      return { inputs: [exec("in"), data("value", "Исключение", "object")], outputs: [] };
    case "break":
    case "continue":
      return { inputs: [exec("in")], outputs: [] };
    case "code":
      return { inputs: [exec("in")], outputs: [exec("then")] };
    case "reroute":
      return p.kind === "exec"
        ? { inputs: [exec("in")], outputs: [exec("then")] }
        : { inputs: [data("a", "", p.type ?? "any")], outputs: [data("value", "", p.type ?? "any")] };
    default:
      return { inputs: [], outputs: [] };
  }
}

export function nodeTitle(node, graph) {
  const p = node.props ?? {};
  switch (node.type) {
    case "entry":
      return `${graph?.method?.returnType ?? "void"} ${graph?.method?.name ?? "method"}(${(graph?.method?.params ?? []).map((x) => `${x.type} ${x.name}`).join(", ")})`;
    case "return":
      return "return";
    case "set":
      return p.declare ? `${p.type} ${p.name}` : ["++", "--"].includes(p.assignOp) ? `${p.name}${p.assignOp}` : `${p.name} ${p.assignOp && p.assignOp !== "=" ? p.assignOp : "="}`;
    case "get":
      return p.name;
    case "literal":
      return p.value;
    case "expr":
      return p.code;
    case "op":
      return p.unary ? `${p.op}a` : `a ${p.op} b`;
    case "select":
      return "c ? a : b";
    case "branch":
      return "if";
    case "while":
      return "while";
    case "for":
      return `for (${p.init ?? ""}; …; ${p.update ?? ""})`;
    case "foreach":
      return `for (${p.type} ${p.name} : …)`;
    case "call":
      return `${p.target && !p.targetPin ? p.target + "." : ""}${p.name}()`;
    case "member":
      return `.${p.name}`;
    case "index":
      return "a[i]";
    case "cast":
      return `(${p.type})`;
    case "throw":
      return "throw";
    case "break":
      return "break";
    case "continue":
      return "continue";
    case "code":
      return "Java";
    case "reroute":
      return "";
    default:
      return node.type;
  }
}

/** Header colour by node role, like Unreal's function/event/macro headers. */
export function nodeCategory(node) {
  return (
    {
      entry: "event",
      return: "event",
      branch: "flow",
      while: "flow",
      for: "flow",
      foreach: "flow",
      break: "flow",
      continue: "flow",
      throw: "flow",
      set: "variable",
      get: "variable",
      call: node.props?.pure ? "pure" : "function",
      code: "code",
      expr: "pure",
      literal: "value",
    }[node.type] ?? "pure"
  );
}

export function isCompact(node) {
  return ["get", "literal", "op", "reroute"].includes(node.type);
}

let counter = 0;
export function newId(graph) {
  const used = new Set(graph.nodes.map((node) => node.id));
  let id;
  do id = "u" + Date.now().toString(36) + (counter++).toString(36);
  while (used.has(id));
  return id;
}

export function linkKey(link) {
  return `${link.from}:${link.fromPin}->${link.to}:${link.toPin}`;
}

const NUMERIC_ORDER = ["byte", "short", "char", "int", "long", "float", "double"];
const BOXED = { Integer: "int", Long: "long", Short: "short", Byte: "byte", Character: "char", Double: "double", Float: "float", Boolean: "boolean" };

/**
 * Whether a value of type `from` may feed an input of type `to`. Unknown or reference types are
 * accepted (javac decides later); clear primitive mismatches are rejected at wiring time.
 */
export function assignable(from = "any", to = "any") {
  const a = BOXED[from] ?? from;
  const b = BOXED[to] ?? to;
  if (a === "any" || b === "any" || a === b) return true;
  if (a === "boolean" || b === "boolean") return a === b || b === "object" || to === "Object";
  if (NUMERIC_ORDER.includes(a) && NUMERIC_ORDER.includes(b)) return NUMERIC_ORDER.indexOf(a) <= NUMERIC_ORDER.indexOf(b);
  if (a === "String") return b === "String" || b === "object" || b === "Object" || b === "CharSequence";
  if (b === "String") return a === "object" || a === "Object";
  if (NUMERIC_ORDER.includes(a) && b === "array") return false;
  return true;
}

/** Exec outputs and data inputs accept a single wire; data outputs fan out freely. */
export function connect(graph, from, fromPin, to, toPin) {
  const source = graph.nodes.find((node) => node.id === from);
  const target = graph.nodes.find((node) => node.id === to);
  if (!source || !target || from === to) return false;
  const out = pinsOf(source, graph).outputs.find((pin) => pin.id === fromPin);
  const input = pinsOf(target, graph).inputs.find((pin) => pin.id === toPin);
  if (!out || !input || out.kind !== input.kind) return false;
  if (out.kind === "data" && !assignable(out.type, input.type)) return false;
  graph.links = graph.links.filter((link) =>
    out.kind === "exec"
      ? !(link.from === from && link.fromPin === fromPin)
      : !(link.to === to && link.toPin === toPin),
  );
  graph.links.push({ from, fromPin, to, toPin });
  return true;
}

export function disconnectPin(graph, nodeId, pinId) {
  const before = graph.links.length;
  graph.links = graph.links.filter(
    (link) => !(link.from === nodeId && link.fromPin === pinId) && !(link.to === nodeId && link.toPin === pinId),
  );
  return before !== graph.links.length;
}

export function removeNode(graph, nodeId) {
  if (graph.nodes.find((node) => node.id === nodeId)?.type === "entry") return false;
  graph.nodes = graph.nodes.filter((node) => node.id !== nodeId);
  graph.links = graph.links.filter((link) => link.from !== nodeId && link.to !== nodeId);
  return true;
}

/** Variables known to the method: parameters, declared locals and loop variables. */
export function variablesOf(graph) {
  const result = new Map();
  for (const param of graph.method?.params ?? []) result.set(param.name, { name: param.name, type: param.type, scope: "параметр" });
  for (const node of graph.nodes) {
    if (node.type === "set" && node.props.declare) result.set(node.props.name, { name: node.props.name, type: node.props.type, scope: "локальная" });
    if (node.type === "foreach") result.set(node.props.name, { name: node.props.name, type: node.props.type, scope: "цикл" });
  }
  for (const field of graph.fields ?? []) if (!result.has(field.name)) result.set(field.name, { name: field.name, type: field.type, scope: "поле" });
  for (const entry of result.values()) {
    entry.reads = graph.nodes.filter((node) => node.type === "get" && node.props.name === entry.name).length;
    entry.writes = graph.nodes.filter((node) => node.type === "set" && node.props.name === entry.name).length;
  }
  return [...result.values()];
}

export function cloneGraph(graph) {
  return JSON.parse(JSON.stringify(graph));
}

export { NUMERIC };
