/** Bounded Myers line diff with a deterministic coarse fallback for very large edits. */
export function splitLines(text) {
  return String(text ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n");
}

export function diffLines(before, after, maximumDistance = 180) {
  const left = splitLines(before);
  const right = splitLines(after);
  let prefix = 0;
  while (
    prefix < left.length &&
    prefix < right.length &&
    left[prefix] === right[prefix]
  )
    prefix++;
  let suffix = 0;
  while (
    suffix < left.length - prefix &&
    suffix < right.length - prefix &&
    left[left.length - 1 - suffix] === right[right.length - 1 - suffix]
  )
    suffix++;
  const a = left.slice(prefix, left.length - suffix);
  const b = right.slice(prefix, right.length - suffix);
  const operations = [];
  for (let i = 0; i < prefix; i++)
    operations.push({ type: "equal", text: left[i] });
  operations.push(...myers(a, b, maximumDistance));
  for (let i = left.length - suffix; i < left.length; i++)
    operations.push({ type: "equal", text: left[i] });
  let oldLine = 1;
  let newLine = 1;
  return operations.map((operation) => ({
    ...operation,
    oldLine: operation.type === "insert" ? null : oldLine++,
    newLine: operation.type === "delete" ? null : newLine++,
  }));
}

function myers(a, b, maximumDistance) {
  if (!a.length) return b.map((text) => ({ type: "insert", text }));
  if (!b.length) return a.map((text) => ({ type: "delete", text }));
  const maximum = Math.min(a.length + b.length, maximumDistance);
  const frontier = new Map([[1, 0]]);
  const trace = [];
  for (let distance = 0; distance <= maximum; distance++) {
    trace.push(new Map(frontier));
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      const down = frontier.get(diagonal + 1) ?? -Infinity;
      const across = frontier.get(diagonal - 1) ?? -Infinity;
      let x =
        diagonal === -distance || (diagonal !== distance && across < down)
          ? Math.max(0, down)
          : Math.max(0, across + 1);
      let y = x - diagonal;
      while (x < a.length && y < b.length && a[x] === b[y]) {
        x++;
        y++;
      }
      frontier.set(diagonal, x);
      if (x >= a.length && y >= b.length) return backtrack(trace, a, b);
    }
  }
  return [
    ...a.map((text) => ({ type: "delete", text })),
    ...b.map((text) => ({ type: "insert", text })),
  ];
}

function backtrack(trace, a, b) {
  let x = a.length;
  let y = b.length;
  const operations = [];
  for (let distance = trace.length - 1; distance >= 0; distance--) {
    const frontier = trace[distance];
    const diagonal = x - y;
    const across = frontier.get(diagonal - 1) ?? -Infinity;
    const down = frontier.get(diagonal + 1) ?? -Infinity;
    const previousDiagonal =
      diagonal === -distance || (diagonal !== distance && across < down)
        ? diagonal + 1
        : diagonal - 1;
    const previousX = Math.max(0, frontier.get(previousDiagonal) ?? 0);
    const previousY = previousX - previousDiagonal;
    while (x > previousX && y > previousY) {
      operations.push({ type: "equal", text: a[x - 1] });
      x--;
      y--;
    }
    if (distance === 0) break;
    if (x === previousX) {
      operations.push({ type: "insert", text: b[y - 1] });
      y--;
    } else {
      operations.push({ type: "delete", text: a[x - 1] });
      x--;
    }
  }
  return operations.reverse();
}

export function changeStatistics(operations) {
  return operations.reduce(
    (statistics, operation) => {
      if (operation.type === "insert") statistics.additions++;
      if (operation.type === "delete") statistics.deletions++;
      if (operation.type !== "equal") statistics.changes++;
      return statistics;
    },
    { additions: 0, deletions: 0, changes: 0 },
  );
}

export function hunks(operations, context = 3) {
  const intervals = [];
  for (let i = 0; i < operations.length; i++) {
    if (operations[i].type === "equal") continue;
    const start = Math.max(0, i - context);
    const end = Math.min(operations.length, i + context + 1);
    const previous = intervals.at(-1);
    if (previous && start <= previous.end) previous.end = end;
    else intervals.push({ start, end });
  }
  return intervals.map(({ start, end }) => operations.slice(start, end));
}

export function unifiedDiff(name, before, after, context = 3) {
  const operations = diffLines(before, after);
  const groups = hunks(operations, context);
  if (!groups.length) return "";
  const lines = [`--- a/${name}`, `+++ b/${name}`];
  for (const group of groups) {
    const oldRows = group.filter((row) => row.oldLine != null);
    const newRows = group.filter((row) => row.newLine != null);
    lines.push(
      `@@ -${oldRows[0]?.oldLine ?? 0},${oldRows.length} +${newRows[0]?.newLine ?? 0},${newRows.length} @@`,
    );
    for (const row of group)
      lines.push(
        (row.type === "insert" ? "+" : row.type === "delete" ? "-" : " ") +
          row.text,
      );
  }
  return lines.join("\n") + "\n";
}

export function projectDiff(baseline, candidate) {
  const names = [
    ...new Set([...Object.keys(baseline), ...Object.keys(candidate)]),
  ].sort();
  return names
    .filter((name) => baseline[name] !== candidate[name])
    .map((name) => {
      const operations = diffLines(baseline[name] ?? "", candidate[name] ?? "");
      return {
        name,
        status: !Object.hasOwn(baseline, name)
          ? "added"
          : !Object.hasOwn(candidate, name)
            ? "deleted"
            : "modified",
        operations,
        ...changeStatistics(operations),
      };
    });
}

export function reconstruct(operations, side) {
  return operations
    .filter((operation) =>
      side === "before"
        ? operation.type !== "insert"
        : operation.type !== "delete",
    )
    .map((operation) => operation.text)
    .join("\n");
}
