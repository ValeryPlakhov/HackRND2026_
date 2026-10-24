import { escapeHtml as e } from "../lib/core.mjs";
import { icon } from "../lib/icons.mjs";
import { graphShell } from "../components/graph.mjs";
import {
  sectionHeading,
  button,
  badge,
  metricCard,
  panel,
  notice,
  emptyState,
} from "../components/primitives.mjs";

const RESPONSIBILITIES = {
  input: ["Ввод и разбор", "terminal"],
  output: ["Форматирование результата", "code"],
  validation: ["Валидация", "shield"],
  computation: ["Вычисления", "chart"],
  utility: ["Вспомогательная логика", "layers"],
};

export function architectureGraph(project, maximum = 24) {
  const methods = [...(project?.methods ?? [])]
    .sort((a, b) => b.fanIn + b.fanOut - (a.fanIn + a.fanOut))
    .slice(0, maximum);
  const included = new Set(methods.map((method) => method.id));
  const nodes = methods.map((method) => ({
    id: method.id,
    kind:
      method.responsibility === "input"
        ? "entry"
        : method.responsibility === "output"
          ? "return"
          : "operation",
    label: `${method.owner}.${method.name}()`,
    line: method.line,
    fileName: method.fileName,
    methodId: method.methodId,
  }));
  const seen = new Set();
  const edges = [];
  for (const call of project?.calls ?? []) {
    for (const target of call.targets ?? []) {
      if (!included.has(call.from) || !included.has(target)) continue;
      const key = call.from + "->" + target;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({
        from: call.from,
        to: target,
        label: call.resolution === "ambiguous" ? "кандидат" : "вызов",
      });
    }
  }
  return {
    nodes,
    edges,
    entry:
      nodes.find((node) => node.label.endsWith(".main()"))?.id ?? nodes[0]?.id,
  };
}

export function renderArchitecture(workspace) {
  const project = workspace.state.project;
  if (!project)
    return emptyState(
      "layers",
      "Архитектура появится после анализа",
      "Загрузите Java-проект и выполните разбор.",
    );
  const internalCalls = project.calls.filter(
    (call) => call.targets.length > 0,
  ).length;
  const cyclicMethods = new Set(project.cycles.flat());
  const modules = project.modules
    .map((module) => {
      const [title, name] = RESPONSIBILITIES[module.id] ?? [
        module.id,
        "layers",
      ];
      const methods = module.methods
        .map((id) => project.methods.find((method) => method.id === id))
        .filter(Boolean);
      return `<article class="module-card"><div style="display:flex;justify-content:space-between;align-items:center">${icon(name, "text-purple", 21)}${badge("REVIEW REQUIRED", "warning")}</div><h3>${e(module.suggestedClass)}.java</h3><p>${e(title)} · ${module.lines} lines · ${methods.length} methods</p>${methods
        .slice(0, 7)
        .map(
          (method) =>
            `<button class="module-method" data-action="open-method" data-file="${e(method.fileName)}" data-method="${e(method.methodId)}">${e(method.name)}() <span class="muted">L${method.line}</span></button>`,
        )
        .join(
          "",
        )}${methods.length > 7 ? `<small class="muted text-tiny">и ещё ${methods.length - 7} методов</small>` : ""}<div style="margin-top:13px">${badge(`${module.extractableCandidates} static candidates`, "accent")}</div></article>`;
    })
    .join("");
  return (
    sectionHeading(
      "RECONSTRUCT THE BIG PICTURE",
      "Архитектура, видимая из кода.",
      "Лексический граф вызовов и предложения по группировке ответственности.",
      button("Обновить проект", "analyze", { icon: "layers" }),
    ) +
    `<div class="metrics-grid">${metricCard("Внутренние вызовы", internalCalls, "разрешены по имени и арности", { name: "git" })}${metricCard("Циклы зависимостей", project.cycles.length, `${cyclicMethods.size} методов в компонентах`, { name: "loop" })}${metricCard("Ответственности", project.modules.length, "группы для архитектурного ревью", { name: "layers" })}${metricCard("Внешние вызовы", project.calls.length - internalCalls, "или неразрешённая диспетчеризация", { name: "external" })}</div>` +
    notice(
      "Граф не выполняет symbol resolution всех перегрузок и динамической диспетчеризации. Показаны до 24 наиболее связанных методов.",
      "info",
      "info",
    ) +
    `<div id="architecture-graph-slot" class="architecture-graph-slot">${graphShell({ title: "Project call graph" })}</div>` +
    (project.cycles.length
      ? panel(
          "Циклические зависимости",
          project.cycles
            .map(
              (cycle) =>
                `<div class="cycle-warning">${cycle.map((id) => e(project.methods.find((method) => method.id === id)?.name ?? id)).join(" → ")} → …</div>`,
            )
            .join(""),
          { icon: "loop" },
        ) + '<div style="height:18px"></div>'
      : "") +
    `<div class="section-label" style="margin:24px 0 14px">RESPONSIBILITY MAP<span>ARCHITECTURE HINTS</span></div><div class="module-grid">${modules}</div>`
  );
}
