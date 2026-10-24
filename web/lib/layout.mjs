import { clamp } from "./core.mjs";

export const NODE_WIDTH = 286;
export const NODE_HEIGHT = 76;

export function normalizeGraph(graph) {
  const nodes = (graph?.nodes ?? []).map((node) => ({ ...node }));
  const ids = new Set(nodes.map((node) => node.id));
  const edges = (graph?.edges ?? [])
    .filter((edge) => ids.has(edge.from) && ids.has(edge.to))
    .map((edge, index) => ({ ...edge, id: edge.id ?? `edge-${index}` }));
  return {
    nodes,
    edges,
    entry: graph?.entry ?? nodes[0]?.id,
    exit: graph?.exit,
  };
}

export function adjacency(graph, reverse = false) {
  const result = new Map(graph.nodes.map((node) => [node.id, []]));
  for (const edge of graph.edges) {
    const from = reverse ? edge.to : edge.from;
    const to = reverse ? edge.from : edge.to;
    result.get(from)?.push(to);
  }
  return result;
}

export function reachable(graph, start, reverse = false) {
  const links = adjacency(graph, reverse);
  if (!links.has(start)) return new Set();
  const seen = new Set();
  const queue = [start];
  for (let index = 0; index < queue.length; index++) {
    const node = queue[index];
    if (seen.has(node)) continue;
    seen.add(node);
    queue.push(...links.get(node));
  }
  return seen;
}

export function shortestPath(graph, from, to) {
  const links = adjacency(graph);
  if (!links.has(from) || !links.has(to)) return [];
  const previous = new Map([[from, null]]);
  const queue = [from];
  for (let index = 0; index < queue.length; index++) {
    const node = queue[index];
    if (node === to) {
      const path = [];
      for (let cursor = to; cursor != null; cursor = previous.get(cursor))
        path.unshift(cursor);
      return path;
    }
    for (const target of links.get(node)) {
      if (previous.has(target)) continue;
      previous.set(target, node);
      queue.push(target);
    }
  }
  return [];
}

export function stronglyConnected(graph) {
  const links = adjacency(graph);
  const index = new Map();
  const low = new Map();
  const stack = [];
  const onStack = new Set();
  const components = [];
  let serial = 0;
  function visit(vertex) {
    index.set(vertex, serial);
    low.set(vertex, serial++);
    stack.push(vertex);
    onStack.add(vertex);
    for (const target of links.get(vertex)) {
      if (!index.has(target)) {
        visit(target);
        low.set(vertex, Math.min(low.get(vertex), low.get(target)));
      } else if (onStack.has(target)) {
        low.set(vertex, Math.min(low.get(vertex), index.get(target)));
      }
    }
    if (low.get(vertex) === index.get(vertex)) {
      const component = [];
      let member;
      do {
        member = stack.pop();
        onStack.delete(member);
        component.push(member);
      } while (member !== vertex);
      components.push(component);
    }
  }
  for (const node of graph.nodes) if (!index.has(node.id)) visit(node.id);
  return components;
}

function graphRanks(graph) {
  const components = stronglyConnected(graph);
  const membership = new Map();
  components.forEach((component, index) =>
    component.forEach((id) => membership.set(id, index)),
  );
  const links = components.map(() => new Set());
  const incoming = components.map(() => 0);
  for (const edge of graph.edges) {
    const from = membership.get(edge.from);
    const to = membership.get(edge.to);
    if (from !== to && !links[from].has(to)) {
      links[from].add(to);
      incoming[to]++;
    }
  }
  const queue = incoming
    .map((value, index) => (value === 0 ? index : -1))
    .filter((index) => index >= 0);
  const rank = components.map(() => 0);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const component = queue[cursor];
    for (const target of links[component]) {
      rank[target] = Math.max(rank[target], rank[component] + 1);
      if (--incoming[target] === 0) queue.push(target);
    }
  }
  return { components, membership, rank };
}

export function layoutGraph(input, options = {}) {
  const graph = normalizeGraph(input);
  const direction = options.direction ?? "vertical";
  const positions = new Map();
  const width = options.nodeWidth ?? NODE_WIDTH;
  const height = options.nodeHeight ?? NODE_HEIGHT;
  const gap = options.gap ?? 42;
  const sourceOrdered = graph.nodes.some((node) => Number(node.start) >= 0);
  let arranged;
  if (sourceOrdered) {
    arranged = [...graph.nodes].sort((a, b) => {
      if (a.id === graph.entry) return -1;
      if (b.id === graph.entry) return 1;
      if (a.id === graph.exit) return 1;
      if (b.id === graph.exit) return -1;
      return (a.start ?? 0) - (b.start ?? 0);
    });
    arranged.forEach((node, index) => {
      const depth = clamp(Number(node.depth ?? 0), 0, 5);
      const x = 80 + depth * 62;
      const y = 54 + index * (height + gap);
      positions.set(
        node.id,
        direction === "horizontal"
          ? { x: y, y: x, width, height }
          : { x, y, width, height },
      );
    });
  } else {
    const ranks = graphRanks(graph);
    const lanes = new Map();
    arranged = [...graph.nodes];
    for (const node of arranged) {
      const component = ranks.membership.get(node.id);
      const rank = ranks.rank[component];
      const lane = lanes.get(rank) ?? 0;
      lanes.set(rank, lane + 1);
      const primary = 50 + rank * (height + 74);
      const secondary = 55 + lane * (width + 50);
      positions.set(
        node.id,
        direction === "horizontal"
          ? { x: primary * 2.4, y: secondary * 0.55, width, height }
          : { x: secondary, y: primary, width, height },
      );
    }
  }
  for (const [id, custom] of Object.entries(options.positions ?? {})) {
    if (positions.has(id))
      positions.set(id, { ...positions.get(id), ...custom });
  }
  const nodes = arranged.map((node) => ({
    ...node,
    ...positions.get(node.id),
  }));
  const edges = graph.edges.map((edge, index) => ({
    ...edge,
    ...routeEdge(
      positions.get(edge.from),
      positions.get(edge.to),
      direction,
      index,
    ),
  }));
  const bounds = graphBounds(nodes, 80);
  return { ...graph, nodes, edges, positions, bounds, direction };
}

export function routeEdge(from, to, direction = "vertical", index = 0) {
  if (!from || !to) return { path: "", labelX: 0, labelY: 0, back: false };
  if (direction === "horizontal") {
    const startX = from.x + from.width;
    const startY = from.y + from.height / 2;
    const endX = to.x;
    const endY = to.y + to.height / 2;
    const back = endX <= startX;
    if (back) {
      const lane =
        Math.max(from.y + from.height, to.y + to.height) +
        40 +
        (index % 4) * 16;
      return {
        path: `M${startX},${startY} C${startX + 45},${lane} ${endX - 45},${lane} ${endX},${endY}`,
        labelX: (startX + endX) / 2,
        labelY: lane - 8,
        back,
      };
    }
    const middle = (startX + endX) / 2;
    return {
      path: `M${startX},${startY} C${middle},${startY} ${middle},${endY} ${endX},${endY}`,
      labelX: middle + 4,
      labelY: (startY + endY) / 2 - 8,
      back,
    };
  }
  const startX = from.x + from.width / 2;
  const startY = from.y + from.height;
  const endX = to.x + to.width / 2;
  const endY = to.y;
  const back = endY <= startY;
  if (back) {
    const lane =
      Math.max(from.x + from.width, to.x + to.width) + 42 + (index % 3) * 18;
    return {
      path: `M${from.x + from.width},${from.y + from.height / 2} C${lane},${from.y + from.height / 2} ${lane},${to.y + to.height / 2} ${to.x + to.width},${to.y + to.height / 2}`,
      labelX: lane - 12,
      labelY: (from.y + to.y) / 2 + from.height / 2,
      back,
    };
  }
  const middle = (startY + endY) / 2;
  return {
    path: `M${startX},${startY} C${startX},${middle} ${endX},${middle} ${endX},${endY}`,
    labelX: (startX + endX) / 2 + 9,
    labelY: middle - 6,
    back,
  };
}

export function graphBounds(nodes, padding = 40) {
  if (!nodes.length) return { x: 0, y: 0, width: 400, height: 300 };
  const minimumX = Math.min(...nodes.map((node) => node.x));
  const minimumY = Math.min(...nodes.map((node) => node.y));
  const maximumX = Math.max(...nodes.map((node) => node.x + node.width));
  const maximumY = Math.max(...nodes.map((node) => node.y + node.height));
  return {
    x: minimumX - padding,
    y: minimumY - padding,
    width: maximumX - minimumX + padding * 2,
    height: maximumY - minimumY + padding * 2,
  };
}

export function fitViewport(bounds, viewport, padding = 40) {
  const scale = clamp(
    Math.min(
      (viewport.width - padding * 2) / Math.max(1, bounds.width),
      (viewport.height - padding * 2) / Math.max(1, bounds.height),
    ),
    0.15,
    1.1,
  );
  return {
    scale,
    x: (viewport.width - bounds.width * scale) / 2 - bounds.x * scale,
    y: (viewport.height - bounds.height * scale) / 2 - bounds.y * scale,
  };
}

export function zoomAt(view, point, factor) {
  const scale = clamp(view.scale * factor, 0.15, 2.5);
  const worldX = (point.x - view.x) / view.scale;
  const worldY = (point.y - view.y) / view.scale;
  return { scale, x: point.x - worldX * scale, y: point.y - worldY * scale };
}

export function screenToWorld(point, view) {
  return {
    x: (point.x - view.x) / view.scale,
    y: (point.y - view.y) / view.scale,
  };
}

export function worldToScreen(point, view) {
  return { x: point.x * view.scale + view.x, y: point.y * view.scale + view.y };
}

export function visibleNodes(nodes, view, viewport, margin = 120) {
  return nodes.filter((node) => {
    const topLeft = worldToScreen(node, view);
    return (
      topLeft.x + node.width * view.scale >= -margin &&
      topLeft.y + node.height * view.scale >= -margin &&
      topLeft.x <= viewport.width + margin &&
      topLeft.y <= viewport.height + margin
    );
  });
}

export function nodeMatches(node, query) {
  if (!query.trim()) return true;
  return `${node.kind} ${node.label} ${node.code} ${node.line}`
    .toLocaleLowerCase("ru-RU")
    .includes(query.toLocaleLowerCase("ru-RU").trim());
}

export function flowSlice(detail, variable) {
  const data = detail?.dataFlow;
  if (!data) return new Set();
  const lines = new Set(
    data.events
      .filter((event) => event.name === variable)
      .map((event) => event.line),
  );
  return new Set(
    detail.graph.nodes
      .filter((node) => lines.has(node.line))
      .map((node) => node.id),
  );
}
