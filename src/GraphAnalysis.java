import java.util.*;

/** Algorithms over the declared structural graph; no claims about runtime coverage. */
public final class GraphAnalysis {
  private final List<String> vertices = new ArrayList<>();
  private final Map<String, List<String>> outgoing = new LinkedHashMap<>();
  private final Map<String, List<String>> incoming = new LinkedHashMap<>();
  private final Map<String, Map<String, Object>> nodes = new LinkedHashMap<>();
  private final String entry;
  private final String exit;

  @SuppressWarnings("unchecked")
  public GraphAnalysis(Map<String, Object> graph) {
    entry = String.valueOf(graph.get("entry"));
    exit = String.valueOf(graph.get("exit"));
    for (Map<String, Object> node : (List<Map<String, Object>>) graph.get("nodes")) {
      String id = String.valueOf(node.get("id"));
      vertices.add(id);
      nodes.put(id, node);
      outgoing.put(id, new ArrayList<>());
      incoming.put(id, new ArrayList<>());
    }
    for (Map<String, Object> edge : (List<Map<String, Object>>) graph.get("edges")) {
      String from = String.valueOf(edge.get("from"));
      String to = String.valueOf(edge.get("to"));
      if (outgoing.containsKey(from) && outgoing.containsKey(to)) {
        outgoing.get(from).add(to);
        incoming.get(to).add(from);
      }
    }
  }

  public Set<String> reachable(String start) {
    Set<String> seen = new LinkedHashSet<>();
    Deque<String> queue = new ArrayDeque<>();
    if (outgoing.containsKey(start)) queue.add(start);
    while (!queue.isEmpty()) {
      String id = queue.removeFirst();
      if (seen.add(id)) queue.addAll(outgoing.get(id));
    }
    return seen;
  }

  public List<List<String>> components() {
    Map<String, Integer> indices = new HashMap<>();
    Map<String, Integer> low = new HashMap<>();
    Deque<String> stack = new ArrayDeque<>();
    Set<String> active = new HashSet<>();
    List<List<String>> components = new ArrayList<>();
    int[] serial = {0};
    for (String vertex : vertices) {
      if (!indices.containsKey(vertex)) {
        strongConnect(vertex, indices, low, stack, active, components, serial);
      }
    }
    return components;
  }

  private void strongConnect(
      String vertex,
      Map<String, Integer> indices,
      Map<String, Integer> low,
      Deque<String> stack,
      Set<String> active,
      List<List<String>> components,
      int[] serial) {
    indices.put(vertex, serial[0]);
    low.put(vertex, serial[0]++);
    stack.push(vertex);
    active.add(vertex);
    for (String target : outgoing.get(vertex)) {
      if (!indices.containsKey(target)) {
        strongConnect(target, indices, low, stack, active, components, serial);
        low.put(vertex, Math.min(low.get(vertex), low.get(target)));
      } else if (active.contains(target)) {
        low.put(vertex, Math.min(low.get(vertex), indices.get(target)));
      }
    }
    if (low.get(vertex).equals(indices.get(vertex))) {
      List<String> component = new ArrayList<>();
      String member;
      do {
        member = stack.pop();
        active.remove(member);
        component.add(member);
      } while (!member.equals(vertex));
      components.add(component);
    }
  }

  public Map<String, Set<String>> dominators() {
    Set<String> live = reachable(entry);
    Map<String, Set<String>> dom = new LinkedHashMap<>();
    for (String vertex : live) {
      dom.put(
          vertex,
          vertex.equals(entry) ? new LinkedHashSet<>(Set.of(entry)) : new LinkedHashSet<>(live));
    }
    boolean changed;
    int rounds = 0;
    do {
      changed = false;
      for (String vertex : live) {
        if (vertex.equals(entry)) continue;
        Set<String> next = null;
        for (String predecessor : incoming.get(vertex)) {
          if (!live.contains(predecessor)) continue;
          if (next == null) next = new LinkedHashSet<>(dom.get(predecessor));
          else next.retainAll(dom.get(predecessor));
        }
        if (next == null) next = new LinkedHashSet<>();
        next.add(vertex);
        if (!next.equals(dom.get(vertex))) {
          dom.put(vertex, next);
          changed = true;
        }
      }
    } while (changed && ++rounds <= vertices.size() + 1);
    return dom;
  }

  public List<String> shortestPath(String from, String to) {
    if (!outgoing.containsKey(from) || !outgoing.containsKey(to)) return List.of();
    Map<String, String> previous = new LinkedHashMap<>();
    Deque<String> queue = new ArrayDeque<>();
    previous.put(from, null);
    queue.add(from);
    while (!queue.isEmpty()) {
      String vertex = queue.removeFirst();
      if (vertex.equals(to)) {
        LinkedList<String> result = new LinkedList<>();
        for (String cursor = to; cursor != null; cursor = previous.get(cursor)) {
          result.addFirst(cursor);
        }
        return result;
      }
      for (String target : outgoing.get(vertex)) {
        if (!previous.containsKey(target)) {
          previous.put(target, vertex);
          queue.addLast(target);
        }
      }
    }
    return List.of();
  }

  public List<List<String>> boundedPaths(int limit, int maximumVisits) {
    List<List<String>> paths = new ArrayList<>();
    enumerate(
        entry,
        new ArrayList<>(),
        new HashMap<>(),
        paths,
        Math.max(1, Math.min(limit, 32)),
        Math.max(1, Math.min(maximumVisits, 2)));
    return paths;
  }

  private void enumerate(
      String vertex,
      List<String> path,
      Map<String, Integer> visits,
      List<List<String>> paths,
      int limit,
      int maximumVisits) {
    if (paths.size() >= limit || path.size() > Math.min(160, vertices.size() * 2 + 1)) return;
    int visited = visits.getOrDefault(vertex, 0);
    if (visited >= maximumVisits) return;
    visits.put(vertex, visited + 1);
    path.add(vertex);
    if (vertex.equals(exit) || outgoing.get(vertex).isEmpty()) {
      paths.add(List.copyOf(path));
    } else {
      for (String target : outgoing.get(vertex)) {
        enumerate(target, path, visits, paths, limit, maximumVisits);
        if (paths.size() >= limit) break;
      }
    }
    path.remove(path.size() - 1);
    visits.put(vertex, visited);
  }

  public Map<String, Object> describe() {
    Set<String> live = reachable(entry);
    List<String> unreachable = vertices.stream().filter(v -> !live.contains(v)).toList();
    List<List<String>> scc = components();
    List<List<String>> loops =
        scc.stream()
            .filter(
                component ->
                    component.size() > 1
                        || outgoing.get(component.get(0)).contains(component.get(0)))
            .toList();
    long branchNodes = outgoing.values().stream().filter(v -> v.size() > 1).count();
    long edges = outgoing.values().stream().mapToLong(List::size).sum();
    Map<String, Object> dominatorResult = new LinkedHashMap<>();
    dominators().forEach((key, value) -> dominatorResult.put(key, new ArrayList<>(value)));
    return Digests.map(
        "vertices",
        vertices.size(),
        "edges",
        edges,
        "reachable",
        new ArrayList<>(live),
        "unreachable",
        unreachable,
        "loopComponents",
        loops,
        "branchNodes",
        branchNodes,
        "dominators",
        dominatorResult,
        "shortestPath",
        shortestPath(entry, exit),
        "paths",
        boundedPaths(12, 1),
        "scope",
        "structural",
        "note",
        "Маршруты и доминаторы относятся к структурному графу, а не к измеренному покрытию."
            + " Исключительные переходы приблизительны.");
  }

  public static List<List<String>> stronglyConnected(Map<String, List<String>> adjacency) {
    List<Object> nodes = new ArrayList<>();
    List<Object> edges = new ArrayList<>();
    Set<String> all = new LinkedHashSet<>(adjacency.keySet());
    adjacency.values().forEach(all::addAll);
    all.forEach(v -> nodes.add(Map.of("id", v)));
    adjacency.forEach(
        (from, targets) -> targets.forEach(to -> edges.add(Map.of("from", from, "to", to))));
    return new GraphAnalysis(
            Digests.map(
                "nodes",
                nodes,
                "edges",
                edges,
                "entry",
                all.stream().findFirst().orElse(""),
                "exit",
                ""))
        .components();
  }
}
