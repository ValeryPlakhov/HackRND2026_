import { pinsOf, isCompact } from "./model.mjs";

export const HEADER = 30;
export const ROW = 24;

export function nodeWidth(node) {
  if (node.type === "reroute") return 18;
  if (isCompact(node)) return Math.max(96, Math.min(220, 40 + String(compactLabel(node)).length * 7.2));
  if (node.type === "code") return 300;
  if (node.type === "expr") return Math.max(150, Math.min(320, 40 + String(node.props.code).length * 7));
  return 220;
}

function compactLabel(node) {
  if (node.type === "get") return node.props.name;
  if (node.type === "literal") return node.props.value;
  if (node.type === "op") return node.props.op + "  ";
  return "";
}

export function codeLines(node) {
  return node.type === "code" ? Math.min(8, String(node.props.code ?? "").split("\n").length) : 0;
}

export function nodeHeight(node, graph) {
  if (node.type === "reroute") return 18;
  const pins = pinsOf(node, graph);
  const rows = Math.max(pins.inputs.length, pins.outputs.length, 1);
  if (isCompact(node)) return Math.max(34, 12 + rows * ROW);
  return HEADER + rows * ROW + 8 + codeLines(node) * 16 + (node.type === "expr" ? 4 : 0);
}

/** Pin anchor in world coordinates, matching the rows rendered by the editor. */
export function pinPosition(node, graph, pinId, direction) {
  const pins = pinsOf(node, graph);
  const list = direction === "in" ? pins.inputs : pins.outputs;
  const index = Math.max(0, list.findIndex((pin) => pin.id === pinId));
  const width = nodeWidth(node);
  if (node.type === "reroute") return { x: node.x + (direction === "in" ? 0 : width), y: node.y + 9 };
  const top = isCompact(node) ? 6 + ROW / 2 : HEADER + ROW / 2 + 2;
  return { x: node.x + (direction === "in" ? 0 : width), y: node.y + top + index * ROW };
}

const GAP_X = 70;
const GAP_Y = 26;

/**
 * Lays out an imported (tree-shaped) graph: the exec spine runs left to right, each statement's
 * data inputs fan in from the left beneath the spine, and branch/loop bodies hang below.
 */
export function autoLayout(graph) {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const execOut = new Map();
  const dataIn = new Map();
  for (const link of graph.links) {
    const from = nodes.get(link.from);
    const pin = from && pinsOf(from, graph).outputs.find((item) => item.id === link.fromPin);
    if (pin?.kind === "exec") execOut.set(link.from + ":" + link.fromPin, link.to);
    else (dataIn.get(link.to) ?? dataIn.set(link.to, []).get(link.to)).push(link);
  }
  const placed = new Set();

  // Data providers are placed in columns to the left of their consumer.
  function dataDepth(id, seen = new Set()) {
    if (seen.has(id)) return 0;
    seen.add(id);
    const sources = (dataIn.get(id) ?? []).map((link) => link.from).filter((from) => !placed.has(from));
    return sources.length ? 1 + Math.max(...sources.map((from) => dataDepth(from, seen))) : 0;
  }

  function placeData(consumer, right, top) {
    let y = top;
    for (const link of dataIn.get(consumer.id) ?? []) {
      const source = nodes.get(link.from);
      if (!source || placed.has(source.id) || source.type === "entry") continue;
      placed.add(source.id);
      const width = nodeWidth(source);
      source.x = right - width;
      source.y = y;
      const childBottom = placeData(source, source.x - 34, y);
      y = Math.max(y + nodeHeight(source, graph) + 10, childBottom);
    }
    return y;
  }

  function chain(id, x, y) {
    let cursor = x;
    let bottom = y;
    while (id && nodes.has(id) && !placed.has(id)) {
      const node = nodes.get(id);
      placed.add(id);
      const depth = dataDepth(id);
      node.x = cursor + depth * 150;
      node.y = y;
      const height = nodeHeight(node, graph);
      const dataBottom = placeData(node, node.x - 34, y + height + GAP_Y);
      bottom = Math.max(bottom, y + height, dataBottom);
      let right = node.x + nodeWidth(node);
      const subs = ["true", "body", "false"].filter((pin) => execOut.has(id + ":" + pin));
      let subY = Math.max(y + height + GAP_Y, dataBottom + GAP_Y);
      for (const pin of subs) {
        const result = chain(execOut.get(id + ":" + pin), node.x + nodeWidth(node) + GAP_X, subY);
        right = Math.max(right, result.right);
        subY = result.bottom + GAP_Y * 2;
        bottom = Math.max(bottom, result.bottom);
      }
      cursor = right + GAP_X;
      id = execOut.get(id + ":then");
    }
    return { right: cursor - GAP_X, bottom };
  }

  const entry = graph.nodes.find((node) => node.type === "entry");
  let bottom = 0;
  if (entry) bottom = chain(entry.id, 0, 0).bottom;
  // Anything unreachable from the entry is parked below the main graph.
  let x = 0;
  for (const node of graph.nodes) {
    if (placed.has(node.id)) continue;
    node.x = x;
    node.y = bottom + 80;
    x += nodeWidth(node) + 40;
  }
  return graph;
}
