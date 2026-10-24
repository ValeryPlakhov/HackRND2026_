import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeGraph,
  reachable,
  shortestPath,
  stronglyConnected,
  layoutGraph,
  fitViewport,
  zoomAt,
  screenToWorld,
  worldToScreen,
  visibleNodes,
  nodeMatches,
  flowSlice,
} from "../../web/lib/layout.mjs";

const graph = {
  nodes: [
    { id: "entry", kind: "entry", start: 0 },
    { id: "loop", kind: "loop", start: 5, depth: 0 },
    { id: "body", kind: "operation", start: 10, depth: 1 },
    { id: "exit", kind: "exit", start: -1 },
  ],
  edges: [
    { from: "entry", to: "loop", label: "in" },
    { from: "loop", to: "body", label: "yes" },
    { from: "body", to: "loop", label: "back" },
    { from: "loop", to: "exit", label: "no" },
  ],
  entry: "entry",
  exit: "exit",
};

test("normalization removes dangling edges and preserves input", () => {
  const input = {
    ...graph,
    edges: [...graph.edges, { from: "entry", to: "missing" }],
  };
  const normalized = normalizeGraph(input);
  assert.equal(normalized.edges.length, 4);
  normalized.nodes[0].kind = "changed";
  assert.equal(graph.nodes[0].kind, "entry");
});

test("reachability terminates on cycles", () => {
  assert.deepEqual([...reachable(graph, "entry")].sort(), [
    "body",
    "entry",
    "exit",
    "loop",
  ]);
  assert.deepEqual([...reachable(graph, "missing")], []);
});

test("reverse reachability follows incoming edges", () => {
  assert.equal(reachable(graph, "exit", true).size, 4);
});

test("shortest path ignores repeated cycle traversals", () => {
  assert.deepEqual(shortestPath(graph, "entry", "exit"), [
    "entry",
    "loop",
    "exit",
  ]);
  assert.deepEqual(shortestPath(graph, "exit", "entry"), []);
});

test("SCC detects the loop body component", () => {
  const components = stronglyConnected(graph).map((component) =>
    [...component].sort(),
  );
  assert.ok(
    components.some(
      (component) => JSON.stringify(component) === '["body","loop"]',
    ),
  );
});

test("source layout orders entry first and exit last", () => {
  const layout = layoutGraph(graph);
  assert.equal(layout.nodes[0].id, "entry");
  assert.equal(layout.nodes.at(-1).id, "exit");
  assert.ok(
    layout.nodes.every(
      (node) => Number.isFinite(node.x) && Number.isFinite(node.y),
    ),
  );
  assert.ok(layout.edges.every((edge) => edge.path.startsWith("M")));
  assert.equal(layout.edges.find((edge) => edge.from === "body").back, true);
});

test("manual graph positions override layout without changing source fields", () => {
  const layout = layoutGraph(graph, {
    positions: { body: { x: 777, y: 222 } },
  });
  assert.equal(layout.nodes.find((node) => node.id === "body").x, 777);
  assert.equal(layout.nodes.find((node) => node.id === "body").start, 10);
});

test("call graph DAG layout supports horizontal direction", () => {
  const input = {
    nodes: [{ id: "a" }, { id: "b" }, { id: "c" }],
    edges: [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
    ],
  };
  const layout = layoutGraph(input, { direction: "horizontal" });
  assert.ok(layout.nodes[0].x < layout.nodes[1].x);
  assert.ok(layout.nodes[1].x < layout.nodes[2].x);
});

test("fit viewport stays finite for empty and tiny graphs", () => {
  const layout = layoutGraph({ nodes: [], edges: [] });
  const view = fitViewport(layout.bounds, { width: 500, height: 300 });
  assert.ok(view.scale >= 0.15 && view.scale <= 1.1);
  assert.ok(Number.isFinite(view.x) && Number.isFinite(view.y));
});

test("zoom keeps the anchor at the same world coordinate", () => {
  const view = { x: 31, y: -19, scale: 0.8 };
  const point = { x: 180, y: 240 };
  const original = screenToWorld(point, view);
  const zoomed = screenToWorld(point, zoomAt(view, point, 1.4));
  assert.ok(Math.abs(original.x - zoomed.x) < 1e-9);
  assert.ok(Math.abs(original.y - zoomed.y) < 1e-9);
});

test("world/screen coordinate transforms roundtrip", () => {
  const view = { x: 50, y: -100, scale: 0.6 };
  const point = { x: 1000, y: 2000 };
  const transformed = screenToWorld(worldToScreen(point, view), view);
  assert.ok(Math.abs(transformed.x - point.x) < 1e-9);
  assert.ok(Math.abs(transformed.y - point.y) < 1e-9);
});

test("visibility excludes distant nodes", () => {
  const nodes = [
    { x: 0, y: 0, width: 30, height: 30 },
    { x: 2000, y: 2000, width: 30, height: 30 },
  ];
  assert.equal(
    visibleNodes(
      nodes,
      { x: 0, y: 0, scale: 1 },
      { width: 500, height: 300 },
      0,
    ).length,
    1,
  );
});

test("node search covers kind, source and line", () => {
  const node = {
    kind: "loop",
    label: "int value",
    code: "for (...){}",
    line: 17,
  };
  assert.equal(nodeMatches(node, "LOOP"), true);
  assert.equal(nodeMatches(node, "17"), true);
  assert.equal(nodeMatches(node, "absent"), false);
});

test("variable slice highlights lines from real data-flow events", () => {
  const detail = {
    graph: {
      nodes: [
        { id: "a", line: 3 },
        { id: "b", line: 5 },
      ],
    },
    dataFlow: { events: [{ name: "x", line: 5 }] },
  };
  assert.deepEqual([...flowSlice(detail, "x")], ["b"]);
  assert.equal(flowSlice(null, "x").size, 0);
});
