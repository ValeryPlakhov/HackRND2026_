// Java → node graph → Java for every method of every bundled example, then a behaviour gate.
// Usage: node tests/blueprint_roundtrip.mjs [http://localhost:8080]
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { generate } from "../web/blueprint/codegen.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const base = (process.argv[2] ?? process.env.BLUEPRINTS_URL ?? "http://localhost:8080") + "/api";

async function post(route, body) {
  const response = await fetch(base + route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(`${route}: ${result.error}`);
  return result;
}

async function job(kind, body) {
  let state = await post("/jobs/submit", { kind, ...body });
  while (["queued", "running"].includes(state.state)) {
    await new Promise((r) => setTimeout(r, 400));
    state = await (await fetch(`${base}/jobs/${state.id}`)).json();
  }
  return state;
}

function javaFiles(folder) {
  const out = [];
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const full = resolve(folder, entry.name);
    if (entry.isDirectory()) out.push(...javaFiles(full));
    else if (entry.name.endsWith(".java")) out.push(full);
  }
  return out;
}

/** Regenerates every method body of a source from its imported graph. */
export async function regenerate(source) {
  const model = await post("/analyze", { source });
  let result = source;
  const stats = { methods: 0, nodes: 0, code: 0 };
  // Bodies are replaced from the end so earlier offsets stay valid.
  const methods = [...model.methods].sort((a, b) => b.start - a.start);
  for (const method of methods) {
    const graph = await post("/blueprint", { source, methodId: method.id });
    if (graph.bodyStart < 0) continue;
    const indent = (source.slice(source.lastIndexOf("\n", graph.bodyStart) + 1).match(/^\s*/)?.[0] ?? "    ") + "    ";
    const { code } = generate(graph, { indent });
    const closing = indent.slice(4);
    result = result.slice(0, graph.bodyStart) + "{\n" + code + (code ? "\n" : "") + closing + "}" + result.slice(graph.bodyEnd);
    stats.methods++;
    stats.nodes += graph.nodes.length;
    stats.code += graph.nodes.filter((node) => node.type === "code" || node.type === "expr").length;
  }
  return { source: result, stats };
}

const report = [];
let passed = true;
for (const project of readdirSync(resolve(root, "examples"))) {
  const folder = resolve(root, "examples", project);
  const tests = JSON.parse(readFileSync(resolve(folder, "blueprints-tests.json"), "utf8"));
  const original = {};
  const candidate = {};
  const totals = { methods: 0, nodes: 0, code: 0 };
  for (const file of javaFiles(resolve(folder, "src"))) {
    const name = relative(folder, file).replaceAll("\\", "/");
    original[name] = readFileSync(file, "utf8");
    const { source, stats } = await regenerate(original[name]);
    candidate[name] = source;
    for (const key of Object.keys(totals)) totals[key] += stats[key];
  }
  const gate = await job("compare", { original, candidate, inputs: tests.cases.map((c) => c.input), mainClass: tests.mainClass ?? "" });
  const ok = gate.state === "completed" && gate.result.passed;
  passed &&= ok;
  report.push({ project, ...totals, passed: ok, error: ok ? null : gate.error ?? gate.result?.candidateBuild?.diagnostics?.slice(0, 800) ?? gate.result?.tests?.find((t) => !t.passed) });
  console.log(`${ok ? "PASS" : "FAIL"} ${project}: ${totals.methods} методов, ${totals.nodes} узлов, из них Java-код/выражение ${totals.code}`);
  if (!ok) console.log(JSON.stringify(report.at(-1).error, null, 2).slice(0, 2000));
}
// Audit counterexamples (F02, F18): the same program before and after a round-trip.
const probes = [
  { name: "double-negation", source: "public class P { static int f(int x) { return -(-x); } public static void main(String[] a) { System.out.println(f(4)); } }" },
  { name: "ternary-receiver", source: 'public class P { static String f(boolean c) { String a = "yes"; String b = "no"; return (c ? a : b).toUpperCase(); } public static void main(String[] a) { System.out.println(f(true) + f(false)); } }' },
  { name: "unary-mix", source: "public class P { static int f(int x) { int y = - -x; int z = -(+x); return -(x - 1) + (int) -(double) y + z; } public static void main(String[] a) { System.out.println(f(7)); } }" },
  { name: "comments", source: "public class P {\n  static int f(int x) {\n    // Business rule: keep this explanation\n    int y = x * 2;\n    /* second note */\n    return y;\n    // trailing note\n  }\n  public static void main(String[] a) { System.out.println(f(3)); }\n}\n", keep: ["// Business rule: keep this explanation", "/* second note */", "// trailing note"] },
];
for (const probe of probes) {
  const { source } = await regenerate(probe.source);
  const gate = await job("compare", { original: { "P.java": probe.source }, candidate: { "P.java": source }, inputs: [""] });
  const kept = (probe.keep ?? []).every((text) => source.includes(text));
  const ok = gate.state === "completed" && gate.result.passed && kept;
  passed &&= ok;
  report.push({ project: "probe:" + probe.name, passed: ok, error: ok ? null : { kept, source, tests: gate.result?.tests } });
  console.log(`${ok ? "PASS" : "FAIL"} probe ${probe.name}`);
  if (!ok) console.log(source);
}
writeFileSync(resolve(root, "docs/blueprint-roundtrip.json"), JSON.stringify({ passed, projects: report }, null, 2));
process.exit(passed ? 0 : 1);
