import { escapeHtml as e, nodeLabel } from "./core.mjs";

export function graphToSvg(layout) {
  const bounds = layout.bounds;
  const width = Math.ceil(bounds.width + 100);
  const height = Math.ceil(bounds.height + 140);
  const colors = {
    entry: "#eaf0ff",
    exit: "#e7f4ed",
    condition: "#fff4d9",
    loop: "#f0eaff",
    return: "#e7f4ed",
    variable: "#eaf4fe",
  };
  const dx = 50 - bounds.x;
  const dy = 90 - bounds.y;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#f9fafc"/><text x="30" y="34" font-family="Segoe UI, sans-serif" font-size="16" fill="#25314a">Blueprints IDE · Java</text><defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M1 1L8 5L1 9" fill="none" stroke="#8796ac" stroke-width="1.5"/></marker></defs><g transform="translate(${dx} ${dy})">${layout.edges.map((edge) => `<path d="${e(edge.path)}" fill="none" stroke="#8796ac" stroke-width="1.5" marker-end="url(#arrow)"/><text x="${edge.labelX}" y="${edge.labelY}" font-family="Segoe UI, sans-serif" font-size="11" text-anchor="middle" fill="#64718a">${e(edge.label === "далее" ? "" : edge.label)}</text>`).join("")}${layout.nodes
    .map(
      (node) =>
        `<g><rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="10" fill="${colors[node.kind] ?? "#ffffff"}" stroke="#c8d3e3"/><text x="${node.x + 14}" y="${node.y + 22}" font-family="Segoe UI, sans-serif" font-size="10" fill="#56647d">${e(nodeLabel(node.kind))}</text><text x="${node.x + 14}" y="${node.y + 48}" font-family="Consolas, monospace" font-size="12" fill="#25314a">${e(
          String(node.label)
            .replace(/\s+/g, " ")
            .slice(0, Math.max(16, Math.floor(node.width / 7) - 3)),
        )}</text></g>`,
    )
    .join("")}</g></svg>`;
}
