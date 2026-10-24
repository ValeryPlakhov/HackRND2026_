import { escapeHtml } from "./core.mjs";
import { unifiedDiff } from "./diff.mjs";

const CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++)
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function field(size, write) {
  const bytes = new Uint8Array(size);
  write(new DataView(bytes.buffer));
  return bytes;
}

/** UTF-8, uncompressed ZIP; portable and auditable without loading CDN libraries. */
export function zipBytes(files) {
  const encoder = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    if (
      !name ||
      name.startsWith("/") ||
      /[\\\0:]/.test(name) ||
      name.split("/").some((part) => !part || part === ".." || part === ".")
    )
      throw new Error("Unsafe archive path");
    const filename = encoder.encode(name);
    const bytes =
      typeof content === "string" ? encoder.encode(content) : content;
    const checksum = crc32(bytes);
    parts.push(
      field(30, (view) => {
        view.setUint32(0, 0x04034b50, true);
        view.setUint16(4, 20, true);
        view.setUint16(6, 0x800, true);
        view.setUint32(14, checksum, true);
        view.setUint32(18, bytes.length, true);
        view.setUint32(22, bytes.length, true);
        view.setUint16(26, filename.length, true);
      }),
      filename,
      bytes,
    );
    central.push(
      field(46, (view) => {
        view.setUint32(0, 0x02014b50, true);
        view.setUint16(4, 20, true);
        view.setUint16(6, 20, true);
        view.setUint16(8, 0x800, true);
        view.setUint32(16, checksum, true);
        view.setUint32(20, bytes.length, true);
        view.setUint32(24, bytes.length, true);
        view.setUint16(28, filename.length, true);
        view.setUint32(42, offset, true);
      }),
      filename,
    );
    offset += 30 + filename.length + bytes.length;
  }
  const centralLength = central.reduce((sum, part) => sum + part.length, 0);
  const count = Object.keys(files).length;
  parts.push(
    ...central,
    field(22, (view) => {
      view.setUint32(0, 0x06054b50, true);
      view.setUint16(8, count, true);
      view.setUint16(10, count, true);
      view.setUint32(12, centralLength, true);
      view.setUint32(16, offset, true);
    }),
  );
  const result = new Uint8Array(offset + centralLength + 22);
  let position = 0;
  for (const part of parts) {
    result.set(part, position);
    position += part.length;
  }
  return result;
}

export function projectArchive(state, evidence = null) {
  const files = {};
  for (const [name, source] of Object.entries(state.files))
    files[`candidate/${name}`] = source;
  for (const [name, source] of Object.entries(state.baseline))
    files[`baseline/${name}`] = source;
  files["inputs.json"] = JSON.stringify(state.cases, null, 2);
  files["behavior-report.json"] = JSON.stringify(
    state.report ?? { status: "unverified" },
    null,
    2,
  );
  files["evidence-manifest.json"] = JSON.stringify(
    evidence ?? { status: "unverified-export" },
    null,
    2,
  );
  files["analysis.json"] = JSON.stringify(state.project, null, 2);
  files["benchmark.json"] = JSON.stringify(state.benchmark, null, 2);
  files["mutation-report.json"] = JSON.stringify(state.mutations, null, 2);
  files["changes.patch"] = Object.keys({ ...state.baseline, ...state.files })
    .sort()
    .map((name) =>
      unifiedDiff(name, state.baseline[name] ?? "", state.files[name] ?? ""),
    )
    .join("\n");
  files["report.html"] = standaloneReport(state, evidence);
  files["README.txt"] = [
    "Java Blueprints Studio / evidence bundle",
    "candidate/ contains the modified Java sources; baseline/ contains the original sources.",
    "Compile separately with JDK 21: javac -encoding UTF-8 --release 21 *.java",
    "The report describes finite console test runs. It is not a universal equivalence proof.",
    "SHA-256 values identify content and are not digital signatures.",
  ].join("\n");
  return zipBytes(files);
}

function xml(value) {
  return escapeHtml(value).replace(/&#39;/g, "&apos;");
}

export function graphSvg(layout, title = "Java Blueprints graph") {
  const bounds = layout.bounds;
  const colors = {
    condition: "#d9b56e",
    loop: "#ad9af7",
    return: "#8bdaab",
    entry: "#a3a6ff",
    exit: "#8bdaab",
    variable: "#70b4df",
  };
  const edges = layout.edges
    .map(
      (edge) =>
        `<path d="${edge.path}" fill="none" stroke="#5e7190" stroke-width="1.5" marker-end="url(#arrow)"/>`,
    )
    .join("");
  const nodes = layout.nodes
    .map((node) => {
      const color = colors[node.kind] ?? "#96a8c1";
      const label = String(node.label).replace(/\s+/g, " ");
      return `<g><rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="10" fill="#151d2b" stroke="${color}"/><text x="${node.x + 14}" y="${node.y + 24}" fill="${color}" font-size="10">${xml(node.kind.toUpperCase())} ${node.line ? "· L" + node.line : ""}</text><text x="${node.x + 14}" y="${node.y + 49}" fill="#e1e9f5" font-size="11" font-family="Consolas,monospace">${xml(label.length > 36 ? label.slice(0, 35) + "…" : label)}</text><title>${xml(label)}</title></g>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bounds.x} ${bounds.y} ${bounds.width + 80} ${bounds.height}" width="${bounds.width + 80}" height="${bounds.height}"><title>${xml(title)}</title><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6" fill="none" stroke="#5e7190"/></marker></defs><rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width + 80}" height="${bounds.height}" fill="#0d121c"/>${edges}${nodes}</svg>`;
}

export function graphMermaid(graph) {
  const ids = new Map(graph.nodes.map((node, index) => [node.id, `n${index}`]));
  const safe = (value) =>
    String(value).replace(/["<>]/g, "").replace(/\n/g, " ").slice(0, 100);
  return [
    "flowchart TD",
    ...graph.nodes.map(
      (node) => `  ${ids.get(node.id)}["${safe(node.label)}"]`,
    ),
    ...graph.edges.map(
      (edge) =>
        `  ${ids.get(edge.from)} -->|"${safe(edge.label)}"| ${ids.get(edge.to)}`,
    ),
  ].join("\n");
}

export function graphDot(graph) {
  const quote = (value) => JSON.stringify(String(value));
  return [
    "digraph Blueprints {",
    '  graph [rankdir="TB"];',
    '  node [shape="box", fontname="Consolas"];',
    ...graph.nodes.map(
      (node) => `  ${quote(node.id)} [label=${quote(node.label)}];`,
    ),
    ...graph.edges.map(
      (edge) =>
        `  ${quote(edge.from)} -> ${quote(edge.to)} [label=${quote(edge.label)}];`,
    ),
    "}",
  ].join("\n");
}

export function standaloneReport(state, evidence) {
  const report = state.report;
  const tests = report?.tests ?? [];
  const status = report ? (report.passed ? "PASS" : "FAIL") : "UNVERIFIED";
  const rows = tests
    .map(
      (test, index) =>
        `<tr><td>${index + 1}</td><td>${test.passed ? "PASS" : "FAIL"}</td><td><pre>${escapeHtml(test.input)}</pre></td><td><pre>${escapeHtml(test.baseline.stdout)}</pre></td><td><pre>${escapeHtml(test.candidate.stdout)}</pre></td></tr>`,
    )
    .join("");
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${escapeHtml(state.name)} / Evidence</title><style>body{font:15px/1.7 system-ui,sans-serif;max-width:1100px;margin:auto;padding:48px;color:#202a38;background:#f6f8fc}header{border-bottom:2px solid #202a38;padding-bottom:25px}h1{font-size:38px;letter-spacing:-1px}small{color:#68768a}strong{padding:7px 12px;background:#dfead5;border-radius:6px}table{width:100%;border-collapse:collapse;font-size:12px}td,th{text-align:left;padding:12px;border-bottom:1px solid #d6dde8;vertical-align:top}pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:0}code{font-size:12px;word-break:break-all}.note{padding:20px;border:1px solid #ccd5e4;border-radius:8px;margin:28px 0}@media print{body{padding:0;background:white}tr{break-inside:avoid}}</style></head><body><header><small>JAVA BLUEPRINTS STUDIO / REPRODUCIBLE EVIDENCE</small><h1>${escapeHtml(state.name)}</h1><strong>${status}</strong> <small>${tests.filter((test) => test.passed).length}/${tests.length} inputs</small></header><div class="note">Наблюдаемое поведение: исходные байты stdout + stderr + exitCode. Конечные тесты не доказывают эквивалентность на всех входах. ${report?.recorded ? "Показан записанный демонстрационный прогон." : ""}</div><h2>Source identities</h2><p>Baseline: <code>${escapeHtml(evidence?.baselineHash ?? report?.baselineHash ?? "unavailable")}</code><br>Candidate: <code>${escapeHtml(evidence?.candidateHash ?? report?.candidateHash ?? "unavailable")}</code></p><h2>Tests</h2><table><thead><tr><th>#</th><th>Status</th><th>stdin</th><th>Baseline stdout</th><th>Candidate stdout</th></tr></thead><tbody>${rows}</tbody></table><h2>Environment</h2><pre>${escapeHtml(JSON.stringify(evidence?.environment ?? report?.environment ?? {}, null, 2))}</pre><p><small>Integrity hashes are content identifiers, not digital signatures.</small></p></body></html>`;
}
