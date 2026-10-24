import { escapeHtml as e, clamp } from "../lib/core.mjs";
import {
  layoutGraph,
  fitViewport,
  zoomAt,
  nodeMatches,
  graphBounds,
} from "../lib/layout.mjs";
import { icon, nodeIcon } from "../lib/icons.mjs";

const labels = {
  entry: "МЕТОД",
  exit: "ЗАВЕРШЕНИЕ",
  condition: "УСЛОВИЕ",
  loop: "ЦИКЛ",
  variable: "ПЕРЕМЕННАЯ",
  operation: "ОПЕРАЦИЯ",
  return: "ВОЗВРАТ",
  throw: "ИСКЛЮЧЕНИЕ",
  switch: "ВЫБОР",
  try: "TRY",
  catch: "CATCH",
  break: "BREAK",
  continue: "CONTINUE",
  opaque: "JAVA BLOCK",
};

export function graphShell({ title = "Control flow", toolbar = true } = {}) {
  return `<div class="graph-workbench"><div class="graph-topline"><span class="graph-topline-caption"><span class="status-light"></span>${e(title)}<span class="graph-scope-label">STRUCTURAL AST</span></span>${toolbar ? `<div class="graph-topline-actions"><button class="icon-button" data-action="graph-direction" title="Сменить направление" aria-label="Сменить направление графа">${icon("split", "", 15)}</button><button class="icon-button" data-action="export-graph" title="Экспорт SVG" aria-label="Экспортировать граф">${icon("download", "", 15)}</button></div>` : ""}</div><div id="graph-viewport" class="graph-viewport" tabindex="0" aria-label="Интерактивный граф Java"><div class="graph-grid"></div><div id="graph-world" class="graph-world"><svg id="graph-connections" class="graph-connections" aria-hidden="true"></svg><div id="graph-node-layer" class="graph-node-layer"></div></div><div class="graph-watermark">BLUEPRINTS<span>PROGRAM STRUCTURE / LIVE AST</span></div></div><div class="graph-bottomline"><div class="graph-legend"><span class="legend-variable">Данные</span><span class="legend-condition">Ветвления</span><span class="legend-loop">Циклы</span><span class="legend-return">Выходы</span></div><div class="graph-zoom-control"><button data-action="graph-zoom-out" aria-label="Уменьшить граф">${icon("minus", "", 13)}</button><span id="graph-scale">100%</span><button data-action="graph-zoom-in" aria-label="Увеличить граф">${icon("plus", "", 13)}</button><button data-action="graph-fit" aria-label="Разместить граф в окне">${icon("fit", "", 14)}</button></div></div><div id="graph-minimap" class="graph-minimap" title="Миникарта графа"></div></div>`;
}

export class GraphWidget {
  constructor(container, graph, options = {}) {
    this.container = container;
    this.viewport = container.querySelector("#graph-viewport");
    this.world = container.querySelector("#graph-world");
    this.options = options;
    this.controller = new AbortController();
    this.positions = options.positions ?? {};
    this.layout = layoutGraph(graph, {
      direction: options.direction,
      positions: this.positions,
    });
    this.view = options.view ?? { x: 0, y: 0, scale: 0.8 };
    this.selected = options.selected ?? null;
    this.highlighted = null;
    this.drag = null;
    this.moved = false;
    this.render();
    this.bind();
    this.resizeObserver = new ResizeObserver(() => {
      if (!this.fitted && this.viewport.clientWidth > 0) {
        this.fit();
        this.fitted = true;
      }
    });
    this.resizeObserver.observe(this.viewport);
    if (!options.view) requestAnimationFrame(() => this.fit());
    else this.transform();
  }

  render() {
    const layer = this.container.querySelector("#graph-node-layer");
    layer.innerHTML = this.layout.nodes
      .map(
        (node, index) =>
          `<button class="flow-node kind-${e(node.kind)} ${node.id === this.selected ? "selected" : ""}" data-node="${e(node.id)}" style="left:${node.x}px;top:${node.y}px;width:${node.width}px;height:${node.height}px" aria-label="${e(labels[node.kind] ?? node.kind)}: ${e(node.label)}" title="${e(node.label)}"><span class="flow-node-header"><span>${icon(nodeIcon(node.kind), "", 12)}${e(labels[node.kind] ?? node.kind)}</span><span>${node.line ? "L" + node.line : String(index + 1).padStart(2, "0")}</span></span><code class="flow-node-code">${e(String(node.label).replace(/\s+/g, " "))}</code><i class="node-port port-in"></i><i class="node-port port-out"></i></button>`,
      )
      .join("");
    this.renderEdges();
    this.renderMinimap();
  }

  renderEdges() {
    const svg = this.container.querySelector("#graph-connections");
    svg.setAttribute(
      "width",
      String(
        Math.max(1000, this.layout.bounds.width + this.layout.bounds.x + 180),
      ),
    );
    svg.setAttribute(
      "height",
      String(
        Math.max(1000, this.layout.bounds.height + this.layout.bounds.y + 180),
      ),
    );
    svg.innerHTML = `<defs><marker id="flow-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 1 1 L 8 5 L 1 9" fill="none" stroke="currentColor" stroke-width="1.4"/></marker></defs>${this.layout.edges.map((edge) => `<g class="flow-edge ${edge.back ? "back-edge" : ""} ${String(edge.label).includes("исключение") ? "exception-edge" : ""}" data-edge-from="${e(edge.from)}" data-edge-to="${e(edge.to)}"><path d="${edge.path}" marker-end="url(#flow-arrow)"/>${!["далее", "вход", "return"].includes(edge.label) ? `<text x="${edge.labelX}" y="${edge.labelY}">${e(edge.label)}</text>` : ""}</g>`).join("")}`;
  }

  renderMinimap() {
    const target = this.container.querySelector("#graph-minimap");
    if (!target) return;
    const bounds = this.layout.bounds;
    const colors = {
      loop: "#a99af0",
      condition: "#d7b676",
      return: "#9ee2b4",
      entry: "#b5bbff",
    };
    target.innerHTML = `<svg viewBox="${bounds.x - 40} ${bounds.y - 20} ${bounds.width + 80} ${bounds.height + 40}" aria-hidden="true">${this.layout.nodes.map((node) => `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="9" fill="${colors[node.kind] ?? "#5d7396"}" opacity=".7"/>`).join("")}</svg>`;
    target.hidden = this.layout.nodes.length < 5;
  }

  bind() {
    const signal = this.controller.signal;
    this.viewport.addEventListener(
      "pointerdown",
      (event) => {
        if (event.button !== 0) return;
        const button = event.target.closest("[data-node]");
        const node = button
          ? this.layout.nodes.find((item) => item.id === button.dataset.node)
          : null;
        this.drag = {
          clientX: event.clientX,
          clientY: event.clientY,
          x: node?.x ?? this.view.x,
          y: node?.y ?? this.view.y,
          node,
          button,
        };
        this.moved = false;
        this.viewport.setPointerCapture(event.pointerId);
        this.viewport.classList.add("dragging");
      },
      { signal },
    );
    this.viewport.addEventListener(
      "pointermove",
      (event) => {
        if (!this.drag) return;
        const dx = event.clientX - this.drag.clientX;
        const dy = event.clientY - this.drag.clientY;
        if (Math.abs(dx) + Math.abs(dy) > 4) this.moved = true;
        if (!this.moved) return;
        if (this.drag.node) {
          const node = this.drag.node;
          node.x = this.drag.x + dx / this.view.scale;
          node.y = this.drag.y + dy / this.view.scale;
          this.positions[node.id] = { x: node.x, y: node.y };
          this.drag.button.style.left = node.x + "px";
          this.drag.button.style.top = node.y + "px";
          this.layout = layoutGraph(this.layout, {
            direction: this.options.direction,
            positions: this.positions,
          });
          this.renderEdges();
        } else {
          this.view.x = this.drag.x + dx;
          this.view.y = this.drag.y + dy;
          this.transform();
        }
      },
      { signal },
    );
    this.viewport.addEventListener(
      "pointerup",
      () => {
        const drag = this.drag;
        this.drag = null;
        this.viewport.classList.remove("dragging");
        if (!this.moved && drag?.node) this.select(drag.node.id);
        if (this.moved) this.renderMinimap();
        this.options.onView?.(this.view, this.positions);
      },
      { signal },
    );
    this.viewport.addEventListener(
      "pointercancel",
      () => {
        this.drag = null;
        this.viewport.classList.remove("dragging");
      },
      { signal },
    );
    this.viewport.addEventListener(
      "dblclick",
      (event) => {
        const button = event.target.closest("[data-node]");
        if (button)
          this.options.onEdit?.(
            this.layout.nodes.find((node) => node.id === button.dataset.node),
          );
        else this.fit();
      },
      { signal },
    );
    this.viewport.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        if (event.ctrlKey || event.metaKey) {
          const bounds = this.viewport.getBoundingClientRect();
          this.view = zoomAt(
            this.view,
            { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
            Math.exp(-event.deltaY * 0.005),
          );
        } else {
          this.view.x -= event.deltaX;
          this.view.y -= event.deltaY;
        }
        this.transform();
      },
      { signal, passive: false },
    );
    this.viewport.addEventListener(
      "keydown",
      (event) => {
        if (event.key.toLowerCase() === "f") {
          event.preventDefault();
          this.fit();
        }
        if (event.key === "+" || event.key === "=") this.zoom(1.15);
        if (event.key === "-") this.zoom(1 / 1.15);
        if (["ArrowDown", "ArrowUp"].includes(event.key)) {
          event.preventDefault();
          const current = this.layout.nodes.findIndex(
            (node) => node.id === this.selected,
          );
          const index = clamp(
            current + (event.key === "ArrowDown" ? 1 : -1),
            0,
            this.layout.nodes.length - 1,
          );
          this.select(this.layout.nodes[index].id);
          this.center(this.layout.nodes[index].id);
        }
      },
      { signal },
    );
  }

  transform() {
    this.world.style.transform = `translate(${this.view.x}px,${this.view.y}px) scale(${this.view.scale})`;
    const scale = this.container.querySelector("#graph-scale");
    if (scale) scale.textContent = Math.round(this.view.scale * 100) + "%";
    const grid = this.container.querySelector(".graph-grid");
    if (grid) {
      grid.style.backgroundPosition = `${this.view.x}px ${this.view.y}px`;
      grid.style.backgroundSize = `${24 * this.view.scale}px ${24 * this.view.scale}px`;
    }
  }

  fit(allowSmall = false) {
    this.view = fitViewport(
      this.layout.bounds,
      { width: this.viewport.clientWidth, height: this.viewport.clientHeight },
      24,
    );
    if (
      !allowSmall &&
      this.options.minimumFitScale &&
      this.view.scale < this.options.minimumFitScale
    ) {
      const entry =
        this.layout.nodes.find((node) => node.id === this.layout.entry) ??
        this.layout.nodes[0];
      this.view.scale = this.options.minimumFitScale;
      this.view.x =
        this.viewport.clientWidth / 2 -
        (entry.x + entry.width / 2) * this.view.scale;
      this.view.y = 24 - entry.y * this.view.scale;
    }
    this.transform();
  }

  zoom(factor) {
    this.view = zoomAt(
      this.view,
      { x: this.viewport.clientWidth / 2, y: this.viewport.clientHeight / 2 },
      factor,
    );
    this.transform();
  }

  center(id) {
    const node = this.layout.nodes.find((item) => item.id === id);
    if (!node) return;
    this.view.x =
      this.viewport.clientWidth / 2 -
      (node.x + node.width / 2) * this.view.scale;
    this.view.y =
      this.viewport.clientHeight / 2 -
      (node.y + node.height / 2) * this.view.scale;
    this.transform();
  }

  select(id) {
    this.selected = id;
    this.container
      .querySelectorAll("[data-node]")
      .forEach((node) =>
        node.classList.toggle("selected", node.dataset.node === id),
      );
    this.options.onSelect?.(this.layout.nodes.find((node) => node.id === id));
  }

  filter(query) {
    const matched = new Set(
      this.layout.nodes
        .filter((node) => nodeMatches(node, query))
        .map((node) => node.id),
    );
    this.container
      .querySelectorAll("[data-node]")
      .forEach((node) =>
        node.classList.toggle("search-dimmed", !matched.has(node.dataset.node)),
      );
    return matched.size;
  }

  highlight(ids) {
    this.highlighted = ids;
    this.container.querySelectorAll("[data-node]").forEach((node) => {
      node.classList.toggle(
        "slice-highlight",
        ids?.has(node.dataset.node) ?? false,
      );
      node.classList.toggle(
        "slice-dimmed",
        Boolean(ids) && !ids.has(node.dataset.node),
      );
    });
    this.container.querySelectorAll(".flow-edge").forEach((edge) => {
      edge.classList.toggle(
        "slice-edge",
        Boolean(
          ids?.has(edge.dataset.edgeFrom) && ids?.has(edge.dataset.edgeTo),
        ),
      );
    });
  }

  destroy() {
    this.controller.abort();
    this.resizeObserver.disconnect();
  }
}
