import {
  CATALOG,
  pinsOf,
  nodeTitle,
  nodeCategory,
  isCompact,
  typeColor,
  connect,
  disconnectPin,
  removeNode,
  variablesOf,
  newId,
  cloneGraph,
  assignable,
} from "./model.mjs";
import { nodeWidth, nodeHeight, pinPosition, codeLines } from "./layout.mjs";
import { portPresentation, NODE_HELP } from "./presentation.mjs";
import { icon } from "../lib/icons.mjs";

const e = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const ASSIGN_OPS = ["=", "+=", "-=", "*=", "/=", "%=", "++", "--"];
const BINARY_OPS = ["+", "-", "*", "/", "%", "==", "!=", "<", "<=", ">", ">=", "&&", "||", "&", "|", "^", "<<", ">>", ">>>"];
const TYPES = ["int", "long", "double", "boolean", "char", "String", "int[]", "String[]", "List<Integer>", "List<String>", "var"];

/**
 * Block editor: drag blocks, drag wires between pins, select a wire to delete it or add a bend,
 * add blocks from a searchable palette, edit block properties, see every use of a variable.
 */
export class BlueprintEditor {
  constructor(container, graph, options = {}) {
    this.container = container;
    this.options = options;
    this.graph = graph;
    this.view = options.view ?? { x: 40, y: 40, scale: 1 };
    this.selected = new Set();
    this.selectedLink = null;
    this.marks = new Map();
    this.notes = new Map();
    this.highlight = null;
    this.drag = null;
    this.history = [];
    this.future = [];
    this.controller = new AbortController();
    container.innerHTML = `<div class="bp-root">
      <div class="bp-canvas" tabindex="0" aria-label="Редактор блоков">
        <div class="bp-world"><svg class="bp-wires" width="1" height="1"></svg><div class="bp-nodes"></div></div>
        <div class="bp-hud"><button data-bp="add-node" class="bp-add" aria-label="Добавить блок" title="Добавить блок">${icon("plus","",17)}</button><button data-bp="fit" aria-label="Вписать схему" title="Вписать схему (F)">${icon("fit","",17)}</button><button data-bp="zoom-out" aria-label="Уменьшить схему" title="Уменьшить">−</button><span class="bp-scale"></span><button data-bp="zoom-in" aria-label="Увеличить схему" title="Увеличить">+</button><button data-bp="layout" aria-label="Упорядочить блоки" title="Упорядочить">${icon("nodes","",17)}</button><button data-bp="undo" aria-label="Отменить изменение (Ctrl+Z)" title="Отменить">↶</button><button data-bp="redo" aria-label="Повторить изменение (Ctrl+Y)" title="Повторить">↷</button></div>
        <div class="bp-palette" hidden><input class="bp-search" placeholder="Найти блок…" autocomplete="off"/><div class="bp-palette-list"></div></div>
      </div>
      <aside class="bp-details" hidden></aside>
    </div>`;
    this.root = container.querySelector(".bp-root");
    this.canvas = container.querySelector(".bp-canvas");
    this.world = container.querySelector(".bp-world");
    this.svg = container.querySelector(".bp-wires");
    this.layer = container.querySelector(".bp-nodes");
    this.palette = container.querySelector(".bp-palette");
    this.details = container.querySelector(".bp-details");
    this.bind();
    this.render();
    if (!options.view) requestAnimationFrame(() => this.fit());
  }

  // ---------- public API ----------

  setGraph(graph) {
    this.graph = graph;
    this.selected.clear();
    this.render();
  }

  select(id) {
    this.selected = new Set(id ? [id] : []);
    const picked = this.node(id);
    this.highlight = picked && ["get", "set", "foreach"].includes(picked.type) ? picked.props.name : null;
    if (this.selectedLink) {
      this.selectedLink = null;
      this.renderWires();
    }
    this.applyHighlight();
    this.refreshSelection();
    this.showDetails();
    this.options.onSelect?.(this.node(id) ?? null);
  }

  /** Selects a block and brings it into view, without notifying (used when the code caret moves). */
  highlightNode(id) {
    const node = this.node(id);
    if (!node) return;
    this.selected = new Set([id]);
    this.refreshSelection();
    const rect = this.canvas.getBoundingClientRect();
    const scale = this.view.scale;
    const x = this.view.x + node.x * scale;
    const y = this.view.y + node.y * scale;
    if (x < 0 || y < 0 || x + nodeWidth(node) * scale > rect.width || y + nodeHeight(node, this.graph) * scale > rect.height) this.center(id);
  }

  center(id) {
    const node = this.node(id);
    if (!node) return;
    const rect = this.canvas.getBoundingClientRect();
    this.view.x = rect.width / 2 - (node.x + nodeWidth(node) / 2) * this.view.scale;
    this.view.y = rect.height / 2 - (node.y + nodeHeight(node, this.graph) / 2) * this.view.scale;
    this.transform();
  }

  fit() {
    const nodes = this.graph.nodes;
    if (!nodes.length) return;
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width) return;
    const minX = Math.min(...nodes.map((n) => n.x)) - 40;
    const minY = Math.min(...nodes.map((n) => n.y)) - 40;
    const maxX = Math.max(...nodes.map((n) => n.x + nodeWidth(n))) + 40;
    const maxY = Math.max(...nodes.map((n) => n.y + nodeHeight(n, this.graph))) + 40;
    const availableHeight = Math.max(100, rect.height - 30);
    const scale = Math.max(0.2, Math.min(1.1, rect.width / (maxX - minX), availableHeight / (maxY - minY)));
    // Long methods would shrink to dots; start readable at the entry instead.
    const readable = 0.85;
    this.view.scale = Math.max(scale, readable);
    this.view.x = scale >= readable ? (rect.width - (maxX - minX) * this.view.scale) / 2 - minX * this.view.scale : 30 - minX * this.view.scale;
    this.view.y = 30 + (scale >= readable ? (availableHeight - (maxY - minY) * this.view.scale) / 2 - minY * this.view.scale : -minY * this.view.scale);
    this.transform();
  }

  zoom(factor, cx, cy) {
    const rect = this.canvas.getBoundingClientRect();
    cx ??= rect.width / 2;
    cy ??= rect.height / 2;
    const scale = Math.max(0.3, Math.min(2.5, this.view.scale * factor));
    this.view.x = cx - ((cx - this.view.x) * scale) / this.view.scale;
    this.view.y = cy - ((cy - this.view.y) * scale) / this.view.scale;
    this.view.scale = scale;
    this.transform();
  }

  /** Map(nodeId → "error" | "warning" | "info") from diagnostics. */
  mark(marks) {
    this.marks = marks ?? new Map();
    this.layer.querySelectorAll(".bp-node").forEach((el) => {
      el.dataset.finding = this.marks.get(el.dataset.id) ?? "";
    });
  }

  setNotes(notes) {
    this.notes = notes ?? new Map();
    this.showDetails();
  }

  /** Messages are handed to the host (one notification centre); the canvas shows none of its own. */
  setStatus(text, kind = "") {
    this.options.onStatus?.(text ?? "", kind);
  }

  destroy() {
    this.controller.abort();
  }

  // ---------- rendering ----------

  node(id) {
    return this.graph.nodes.find((node) => node.id === id);
  }

  transform() {
    this.world.style.transform = `translate(${this.view.x}px, ${this.view.y}px) scale(${this.view.scale})`;
    this.container.querySelector(".bp-scale").textContent = Math.round(this.view.scale * 100) + "%";
    this.canvas.style.backgroundSize = `${24 * this.view.scale}px ${24 * this.view.scale}px, ${120 * this.view.scale}px ${120 * this.view.scale}px`;
    this.canvas.style.backgroundPosition = `${this.view.x}px ${this.view.y}px`;
    this.options.onView?.(this.view);
  }

  render() {
    const connected = new Set();
    for (const link of this.graph.links) {
      connected.add(link.from + ":out:" + link.fromPin);
      connected.add(link.to + ":in:" + link.toPin);
    }
    this.layer.innerHTML = this.graph.nodes.map((node) => this.nodeHtml(node, connected)).join("");
    this.renderWires();
    this.transform();
    this.refreshSelection();
    this.mark(this.marks);
    this.applyHighlight();
  }

  nodeHtml(node, connected) {
    const pins = pinsOf(node, this.graph);
    const width = nodeWidth(node);
    const pin = (item, direction) => {
      const on = connected.has(node.id + ":" + direction + ":" + item.id);
      const face = portPresentation(node, item, direction);
      const description = `${direction === "in" ? "Вход" : "Выход"}: ${face.label} · ${face.type}${on ? " · подключён" : " · не подключён"}`;
      return `<div class="bp-pin-row ${direction}"><span class="bp-pin ${item.kind} ${on ? "on" : ""}" data-node="${e(node.id)}" data-pin="${e(item.id)}" data-dir="${direction}" style="--c:${face.color}" role="img" aria-label="${e(description)}" title="${e(description)}"></span><span class="bp-pin-label" title="${e(description)}">${e(face.label)}${item.kind === "data" ? `<small>${e(face.type)}</small>` : ""}</span></div>`;
    };
    const category = nodeCategory(node);
    const style = `left:${node.x}px;top:${node.y}px;width:${width}px;min-height:${nodeHeight(node, this.graph)}px`;
    if (node.type === "reroute")
      return `<div class="bp-node bp-reroute" data-id="${e(node.id)}" style="${style}">${pins.inputs.map((p) => pin(p, "in")).join("")}${pins.outputs.map((p) => pin(p, "out")).join("")}</div>`;
    if (isCompact(node)) {
      const label = node.type === "op" ? node.props.op : nodeTitle(node, this.graph);
      return `<div class="bp-node bp-compact cat-${category} type-${node.type}" data-id="${e(node.id)}" style="${style}" title="${e(nodeTitle(node, this.graph))}"><div class="bp-col in">${pins.inputs.map((p) => pin(p, "in")).join("")}</div><div class="bp-compact-label">${e(label)}</div><div class="bp-col out">${pins.outputs.map((p) => pin(p, "out")).join("")}</div></div>`;
    }
    const rows = Math.max(pins.inputs.length, pins.outputs.length);
    const body = Array.from({ length: rows }, (_, i) => `<div class="bp-row">${pins.inputs[i] ? pin(pins.inputs[i], "in") : "<span></span>"}${pins.outputs[i] ? pin(pins.outputs[i], "out") : "<span></span>"}</div>`).join("");
    const code = node.type === "code" ? `<pre class="bp-code">${e(String(node.props.code).split("\n").slice(0, codeLines(node)).join("\n"))}</pre>` : "";
    const subtitle = node.type === "call" && node.props.target && !node.props.targetPin ? node.props.target : "";
    return `<div class="bp-node cat-${category} type-${node.type}" data-id="${e(node.id)}" style="${style}"><div class="bp-header"><span class="bp-badge">${e(BADGES[category] ?? "·")}</span><b>${e(nodeTitle(node, this.graph))}</b>${subtitle ? `<small>${e(subtitle)}</small>` : ""}${node.line ? `<i>L${node.line}</i>` : ""}</div><div class="bp-body">${body}${code}</div></div>`;
  }

  renderWires() {
    const nodes = new Map(this.graph.nodes.map((node) => [node.id, node]));
    const maxX = Math.max(2000, ...this.graph.nodes.map((n) => n.x + 600));
    const maxY = Math.max(2000, ...this.graph.nodes.map((n) => n.y + 600));
    const minX = Math.min(0, ...this.graph.nodes.map((n) => n.x - 600));
    const minY = Math.min(0, ...this.graph.nodes.map((n) => n.y - 600));
    this.svg.setAttribute("width", maxX - minX);
    this.svg.setAttribute("height", maxY - minY);
    this.svg.style.left = minX + "px";
    this.svg.style.top = minY + "px";
    this.svg.setAttribute("viewBox", `${minX} ${minY} ${maxX - minX} ${maxY - minY}`);
    this.svg.innerHTML = this.graph.links
      .map((link, index) => {
        const from = nodes.get(link.from);
        const to = nodes.get(link.to);
        if (!from || !to) return "";
        const out = pinsOf(from, this.graph).outputs.find((p) => p.id === link.fromPin);
        const a = pinPosition(from, this.graph, link.fromPin, "out");
        const b = pinPosition(to, this.graph, link.toPin, "in");
        const execWire = out?.kind === "exec";
        const color = execWire ? "currentColor" : typeColor(out?.type);
        const d = curve(a, b);
        return `<path class="bp-wire-hit" data-link="${index}" d="${d}"/><path class="bp-wire ${execWire ? "exec" : "data"} ${link === this.selectedLink ? "selected" : ""}" data-link="${index}" data-from="${e(link.from)}" data-to="${e(link.to)}" d="${d}" stroke="${color}" ${execWire ? 'marker-end="url(#bp-flow-arrow)"' : ""}/>`;
      })
      .join("") + `<path class="bp-wire ghost" d=""/>`;
    this.svg.insertAdjacentHTML("afterbegin", '<defs><marker id="bp-flow-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path class="bp-arrow" d="M0 0 L8 4 L0 8 z"/></marker></defs>');
    this.renderLinkHandle();
  }

  /** The × in the middle of the selected wire: one obvious way to remove a connection. */
  renderLinkHandle() {
    this.layer.querySelector(".bp-wire-cut")?.remove();
    const index = this.graph.links.indexOf(this.selectedLink);
    if (index < 0) return;
    const path = this.svg.querySelector(`.bp-wire[data-link="${index}"]`);
    if (!path?.getTotalLength) return;
    const point = path.getPointAtLength(path.getTotalLength() / 2);
    this.layer.insertAdjacentHTML("beforeend", `<button class="bp-wire-cut" data-bp="cut-wire" title="Удалить связь (Delete)" style="left:${Math.round(point.x)}px;top:${Math.round(point.y)}px">×</button>`);
  }

  selectLink(link) {
    this.selected.clear();
    this.highlight = null;
    this.selectedLink = link;
    this.refreshSelection();
    this.showDetails();
    this.applyHighlight();
    this.renderWires();
  }

  cutSelectedLink() {
    const index = this.graph.links.indexOf(this.selectedLink);
    if (index < 0) return false;
    this.checkpoint();
    this.graph.links.splice(index, 1);
    this.selectedLink = null;
    this.setStatus("");
    this.render();
    this.changed();
    return true;
  }

  refreshSelection() {
    this.layer.querySelectorAll(".bp-node").forEach((el) => el.classList.toggle("selected", this.selected.has(el.dataset.id)));
  }

  applyHighlight() {
    const name = this.highlight;
    const hits = new Set(
      name ? this.graph.nodes.filter((n) => (n.type === "get" || n.type === "set" || n.type === "foreach") && n.props.name === name).map((n) => n.id) : [],
    );
    this.root.classList.toggle("bp-highlighting", Boolean(name));
    this.layer.querySelectorAll(".bp-node").forEach((el) => el.classList.toggle("hit", hits.has(el.dataset.id)));
    this.svg.querySelectorAll(".bp-wire").forEach((el) => el.classList.toggle("hit", hits.has(el.dataset.from) || hits.has(el.dataset.to)));
  }

  // ---------- details panel ----------

  showDetails() {
    const id = this.selected.size === 1 ? [...this.selected][0] : null;
    const node = this.node(id);
    if (!node || node.type === "reroute") {
      this.details.hidden = true;
      return;
    }
    const p = node.props;
    const field = (key, label, value, type = "text") => `<label>${e(label)}<input data-prop="${key}" type="${type}" value="${e(value ?? "")}" ${type === "checkbox" && value ? "checked" : ""}/></label>`;
    const select = (key, label, options, value) => `<label>${e(label)}<select data-prop="${key}">${options.map((o) => `<option ${o === value ? "selected" : ""}>${e(o)}</option>`).join("")}</select></label>`;
    const typeField = (key, label, value) => `<label>${e(label)}<input data-prop="${key}" list="bp-types" value="${e(value ?? "")}"/></label>`;
    const area = (key, label, value) => `<label>${e(label)}<textarea data-prop="${key}" rows="6" spellcheck="false">${e(value ?? "")}</textarea></label>`;
    const forms = {
      set: () => field("name", "Переменная", p.name) + typeField("type", "Тип", p.type) + field("declare", "Объявить новую", p.declare, "checkbox") + (p.declare ? "" : select("assignOp", "Операция", ASSIGN_OPS, p.assignOp ?? "=")),
      get: () => field("name", "Переменная", p.name) + typeField("type", "Тип", p.type),
      literal: () => field("value", "Значение (как в Java)", p.value) + typeField("type", "Тип", p.type),
      expr: () => area("code", "Выражение Java", p.code),
      code: () => area("code", "Инструкции Java", p.code),
      op: () => select("op", "Оператор", p.unary ? ["!", "-", "~"] : BINARY_OPS, p.op),
      call: () => field("target", "Объект или класс (System.out, Math…)", p.target) + field("name", "Метод", p.name) + field("argc", "Аргументов", p.argc, "number") + field("pure", "Значение (без exec-пинов)", p.pure, "checkbox") + field("targetPin", "Объект через пин", p.targetPin, "checkbox") + typeField("returnType", "Тип результата", p.returnType),
      for: () => field("init", "Инициализация", p.init) + field("update", "Шаг", p.update),
      foreach: () => field("name", "Переменная элемента", p.name) + typeField("type", "Тип элемента", p.type),
      member: () => field("name", "Поле", p.name),
      cast: () => typeField("type", "К типу", p.type),
    };
    const notes = this.notes.get(node.id) ?? "";
    const pins = pinsOf(node, this.graph);
    const ports = [["in", pins.inputs], ["out", pins.outputs]].map(([direction, list]) => list.length ? `<h4>${direction === "in" ? "← Входы" : "Выходы →"}</h4>${list.map((pin) => {
      const face = portPresentation(node, pin, direction);
      return `<label class="bp-port-setting"><span>${e(pin.id)} · ${e(face.type)}</span><div><input data-port="${e(direction + ":" + pin.id)}" data-appearance="label" aria-label="Подпись ${direction === "in" ? "входа" : "выхода"} ${e(pin.id)}" value="${e(face.label)}" maxlength="36"/><input type="color" data-port="${e(direction + ":" + pin.id)}" data-appearance="color" value="${e(face.color)}" aria-label="Цвет порта ${e(pin.id)}"/></div></label>`;
    }).join("")}` : "").join("");
    this.details.hidden = false;
    this.details.innerHTML = `<div class="bp-details-head"><b>${e(nodeTitle(node, this.graph))}</b><button data-bp="close-details" title="Закрыть">×</button></div><p class="bp-side-hint">${e(NODE_HELP[node.type] || "Выберите свойства блока. Изменение логики обновит Java-код.")}</p><datalist id="bp-types">${TYPES.map((t) => `<option value="${e(t)}">`).join("")}</datalist><form class="bp-form">${(forms[node.type] ?? (() => '<p class="bp-side-hint">У этого блока нет настроек логики.</p>'))()}</form><details class="bp-port-settings"><summary>Подписи входов и выходов</summary><p>Только оформление. Java-типы и назначение связей сохраняются.</p>${ports}<button data-bp="reset-ports">Сбросить оформление</button></details>${notes}<div class="bp-details-actions">${node.start >= 0 && this.options.onOpenLine ? '<button data-bp="open-line">К строке кода</button>' : ""}${node.type !== "entry" ? '<button data-bp="duplicate">Дублировать</button><button data-bp="delete" class="danger">Удалить</button>' : ""}</div>`;
  }

  updateProp(input) {
    const node = this.node([...this.selected][0]);
    if (!node) return;
    const key = input.dataset.prop;
    let value = input.type === "checkbox" ? input.checked : input.value;
    if (input.type === "number") value = Math.max(0, Math.min(12, Number(value) || 0));
    this.checkpoint();
    node.props[key] = value;
    if (key === "declare" && value) delete node.props.assignOp;
    // Pins may appear or disappear; drop wires that no longer have an endpoint.
    const pins = pinsOf(node, this.graph);
    this.graph.links = this.graph.links.filter(
      (link) =>
        (link.from !== node.id || pins.outputs.some((p) => p.id === link.fromPin)) &&
        (link.to !== node.id || pins.inputs.some((p) => p.id === link.toPin)),
    );
    this.render();
    if (["declare", "pure", "targetPin", "assignOp", "argc"].includes(key)) this.showDetails();
    this.changed();
  }

  // ---------- editing ----------

  checkpoint() {
    this.history.push(JSON.stringify({ nodes: this.graph.nodes, links: this.graph.links }));
    if (this.history.length > 80) this.history.shift();
    this.future = [];
  }

  undo(redo = false) {
    const from = redo ? this.future : this.history;
    const to = redo ? this.history : this.future;
    if (!from.length) return;
    to.push(JSON.stringify({ nodes: this.graph.nodes, links: this.graph.links }));
    const state = JSON.parse(from.pop());
    this.graph.nodes = state.nodes;
    this.graph.links = state.links;
    this.selected.clear();
    this.render();
    this.showDetails();
    this.changed();
  }

  changed(structural = true) {
    this.options.onChange?.(this.graph, { structural });
  }

  addNode(spec, x, y) {
    this.checkpoint();
    const node = { id: newId(this.graph), type: spec.type, props: JSON.parse(JSON.stringify(spec.props ?? {})), x: Math.round(x), y: Math.round(y), line: 0, start: -1, end: -1 };
    this.graph.nodes.push(node);
    return node;
  }

  worldPoint(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: (clientX - rect.left - this.view.x) / this.view.scale, y: (clientY - rect.top - this.view.y) / this.view.scale };
  }

  openPalette(clientX, clientY, pending = null) {
    const rect = this.canvas.getBoundingClientRect();
    this.paletteState = { world: this.worldPoint(clientX, clientY), pending };
    this.palette.hidden = false;
    this.palette.style.left = Math.min(clientX - rect.left, rect.width - 290) + "px";
    this.palette.style.top = Math.min(clientY - rect.top, rect.height - 340) + "px";
    const input = this.palette.querySelector(".bp-search");
    input.value = "";
    this.renderPalette("");
    requestAnimationFrame(() => input.focus());
  }

  paletteItems(query) {
    const pending = this.paletteState?.pending;
    const q = query.trim().toLowerCase();
    const items = [
      ...CATALOG,
      ...variablesOf(this.graph).flatMap((v) => [
        { group: "Переменные метода", type: "get", title: `Прочитать ${v.name}`, props: { name: v.name, type: v.type } },
        { group: "Переменные метода", type: "set", title: `Записать ${v.name}`, props: { name: v.name, type: v.type, declare: false, assignOp: "=" } },
      ]),
    ];
    return items.filter((item) => {
      if (q && !(item.title + " " + item.group).toLowerCase().includes(q)) return false;
      if (!pending) return true;
      const pins = pinsOf({ type: item.type, props: item.props }, this.graph);
      const list = pending.direction === "out" ? pins.inputs : pins.outputs;
      return list.some((pin) => pin.kind === pending.kind);
    });
  }

  renderPalette(query) {
    const items = this.paletteItems(query);
    this.paletteList = items;
    let group = "";
    this.palette.querySelector(".bp-palette-list").innerHTML =
      items
        .map((item, index) => {
          const header = item.group !== group ? `<div class="bp-palette-group">${e(item.group)}</div>` : "";
          group = item.group;
          return `${header}<button data-bp="palette-pick" data-index="${index}" class="${index === 0 ? "first" : ""}">${e(item.title)}</button>`;
        })
        .join("") || '<p class="bp-side-hint">Ничего не найдено</p>';
  }

  pickPalette(index) {
    const spec = this.paletteList?.[index];
    if (!spec || !this.paletteState) return;
    const { world, pending } = this.paletteState;
    const node = this.addNode(spec, world.x, world.y - 14);
    if (pending) {
      const pins = pinsOf(node, this.graph);
      if (pending.direction === "out") {
        const target = pins.inputs.find((pin) => pin.kind === pending.kind);
        if (target) connect(this.graph, pending.node, pending.pin, node.id, target.id);
      } else {
        const source = pins.outputs.find((pin) => pin.kind === pending.kind);
        node.x -= nodeWidth(node) + 20;
        if (source) connect(this.graph, node.id, source.id, pending.node, pending.pin);
      }
    }
    this.closePalette();
    this.render();
    this.select(node.id);
    this.changed();
  }

  closePalette() {
    this.palette.hidden = true;
    this.paletteState = null;
  }

  deleteSelected() {
    if (!this.selected.size) return;
    this.checkpoint();
    for (const id of this.selected) removeNode(this.graph, id);
    this.selected.clear();
    this.render();
    this.showDetails();
    this.changed();
  }

  duplicateSelected() {
    if (!this.selected.size) return;
    this.checkpoint();
    const copies = new Map();
    for (const id of this.selected) {
      const node = this.node(id);
      if (!node || node.type === "entry") continue;
      const copy = { ...JSON.parse(JSON.stringify(node)), id: newId(this.graph), x: node.x + 40, y: node.y + 40, start: -1, end: -1, line: 0 };
      this.graph.nodes.push(copy);
      copies.set(id, copy.id);
    }
    // Wires between duplicated nodes are duplicated too.
    for (const link of [...this.graph.links])
      if (copies.has(link.from) && copies.has(link.to))
        this.graph.links.push({ ...link, from: copies.get(link.from), to: copies.get(link.to) });
    this.selected = new Set(copies.values());
    this.render();
    this.changed();
  }

  insertReroute(linkIndex, clientX, clientY) {
    const link = this.graph.links[linkIndex];
    if (!link) return;
    const from = this.node(link.from);
    const out = pinsOf(from, this.graph).outputs.find((p) => p.id === link.fromPin);
    this.checkpoint();
    const point = this.worldPoint(clientX, clientY);
    const knot = { id: newId(this.graph), type: "reroute", props: { kind: out.kind, type: out.type }, x: Math.round(point.x - 9), y: Math.round(point.y - 9), start: -1, end: -1, line: 0 };
    this.graph.nodes.push(knot);
    this.graph.links.splice(linkIndex, 1);
    this.graph.links.push(
      { from: link.from, fromPin: link.fromPin, to: knot.id, toPin: out.kind === "exec" ? "in" : "a" },
      { from: knot.id, fromPin: out.kind === "exec" ? "then" : "value", to: link.to, toPin: link.toPin },
    );
    this.render();
    this.changed();
  }

  // ---------- interaction ----------

  bind() {
    const signal = this.controller.signal;
    const canvas = this.canvas;
    canvas.addEventListener(
      "pointerdown",
      (event) => {
        if (!this.palette.hidden && !event.target.closest(".bp-palette")) this.closePalette();
        if (event.target.closest(".bp-palette, .bp-hud, .bp-wire-cut")) return;
        const hit = event.target.closest(".bp-wire-hit");
        if (hit && event.button === 0) {
          event.preventDefault();
          canvas.focus({ preventScroll: true });
          return this.selectLink(this.graph.links[Number(hit.dataset.link)]);
        }
        const pinEl = event.target.closest(".bp-pin");
        const nodeEl = event.target.closest(".bp-node");
        canvas.focus({ preventScroll: true });
        if (pinEl && event.button === 0) {
          event.preventDefault();
          const { node, pin, dir } = pinEl.dataset;
          if (event.altKey) {
            this.checkpoint();
            if (disconnectPin(this.graph, node, pin)) {
              this.render();
              this.changed();
            }
            return;
          }
          const source = this.node(node);
          const kind = (dir === "out" ? pinsOf(source, this.graph).outputs : pinsOf(source, this.graph).inputs).find((p) => p.id === pin)?.kind;
          // Grabbing a connected input picks up its wire so it can be moved to another pin.
          const existing = dir === "in" ? this.graph.links.find((l) => l.to === node && l.toPin === pin) : null;
          if (existing) {
            this.checkpoint();
            this.graph.links = this.graph.links.filter((l) => l !== existing);
            this.render();
            this.drag = { type: "wire", node: existing.from, pin: existing.fromPin, direction: "out", kind, moved: true, detached: true };
          } else this.drag = { type: "wire", node, pin, direction: dir, kind };
          capture(canvas, event.pointerId);
          return;
        }
        if (nodeEl && event.button === 0) {
          const id = nodeEl.dataset.id;
          if (event.shiftKey || event.ctrlKey) {
            this.selected.has(id) ? this.selected.delete(id) : this.selected.add(id);
            this.refreshSelection();
          } else if (!this.selected.has(id)) this.select(id);
          if (event.target.closest("input, textarea, select")) return;
          this.drag = { type: "move", x: event.clientX, y: event.clientY, origin: [...this.selected].map((n) => ({ id: n, x: this.node(n).x, y: this.node(n).y })), moved: false };
          capture(canvas, event.pointerId);
          return;
        }
        if (event.button === 0 || event.button === 1 || event.button === 2) {
          this.drag = { type: "pan", x: event.clientX, y: event.clientY, vx: this.view.x, vy: this.view.y, moved: false, button: event.button };
          capture(canvas, event.pointerId);
        }
      },
      { signal },
    );
    canvas.addEventListener(
      "pointermove",
      (event) => {
        const drag = this.drag;
        if (!drag) return;
        if (drag.type === "pan") {
          if (Math.abs(event.clientX - drag.x) + Math.abs(event.clientY - drag.y) > 3) drag.moved = true;
          this.view.x = drag.vx + event.clientX - drag.x;
          this.view.y = drag.vy + event.clientY - drag.y;
          this.transform();
        } else if (drag.type === "move") {
          const dx = (event.clientX - drag.x) / this.view.scale;
          const dy = (event.clientY - drag.y) / this.view.scale;
          if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 2) {
            drag.moved = true;
            this.checkpoint();
          }
          for (const item of drag.origin) {
            const node = this.node(item.id);
            node.x = Math.round(item.x + dx);
            node.y = Math.round(item.y + dy);
            const el = this.layer.querySelector(`[data-id="${CSS.escape(item.id)}"]`);
            if (el) {
              el.style.left = node.x + "px";
              el.style.top = node.y + "px";
            }
          }
          this.renderWires();
          this.applyHighlight();
        } else if (drag.type === "wire") {
          drag.moved = true;
          const node = this.node(drag.node);
          const a = pinPosition(node, this.graph, drag.pin, drag.direction);
          const b = this.worldPoint(event.clientX, event.clientY);
          const ghost = this.svg.querySelector(".ghost");
          ghost.setAttribute("d", drag.direction === "out" ? curve(a, b) : curve(b, a));
          this.layer.querySelectorAll(".bp-pin").forEach((pin) => pin.classList.toggle("candidate", this.compatible(drag, pin)));
        }
      },
      { signal },
    );
    canvas.addEventListener(
      "pointerup",
      (event) => {
        const drag = this.drag;
        this.drag = null;
        if (!drag) return;
        if (drag.type === "move" && drag.moved) this.changed(false);
        if (drag.type === "pan" && !drag.moved && drag.button === 0 && !event.target.closest(".bp-node")) this.select(null);
        if (drag.type === "pan" && !drag.moved && drag.button === 2) this.openPalette(event.clientX, event.clientY);
        if (drag.type === "wire") {
          this.layer.querySelectorAll(".bp-pin.candidate").forEach((pin) => pin.classList.remove("candidate"));
          this.svg.querySelector(".ghost")?.setAttribute("d", "");
          const target = document.elementFromPoint(event.clientX, event.clientY)?.closest(".bp-pin");
          if (target && this.compatible(drag, target)) {
            if (!drag.detached) this.checkpoint();
            const t = target.dataset;
            const ok = drag.direction === "out" ? connect(this.graph, drag.node, drag.pin, t.node, t.pin) : connect(this.graph, t.node, t.pin, drag.node, drag.pin);
            this.render();
            const source = this.node(drag.direction === "out" ? drag.node : t.node);
            const fanOut = this.graph.links.filter((l) => l.from === source?.id && l.fromPin === "value").length;
            if (ok && source?.type === "call" && fanOut > 1)
              this.setStatus(`Вызов ${source.props.name}() подключён к ${fanOut} входам и выполнится ${fanOut} раза. Чтобы вызвать один раз, сохраните результат в переменную (блок «Объявление»).`, "error");
            if (ok || drag.detached) this.changed();
          } else if (drag.moved && !target) {
            if (drag.detached) {
              this.render();
              this.changed();
            } else this.openPalette(event.clientX, event.clientY, drag);
          }
        }
      },
      { signal },
    );
    canvas.addEventListener("contextmenu", (event) => event.preventDefault(), { signal });
    canvas.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        const rect = canvas.getBoundingClientRect();
        this.zoom(event.deltaY < 0 ? 1.1 : 1 / 1.1, event.clientX - rect.left, event.clientY - rect.top);
      },
      { signal, passive: false },
    );
    canvas.addEventListener(
      "dblclick",
      (event) => {
        const wire = event.target.closest(".bp-wire-hit");
        if (wire) this.insertReroute(Number(wire.dataset.link), event.clientX, event.clientY);
      },
      { signal },
    );
    canvas.addEventListener(
      "keydown",
      (event) => {
        if (event.target.closest("input, textarea, select")) {
          if (event.key === "Escape") this.closePalette();
          if (event.key === "Enter" && event.target.classList.contains("bp-search")) this.pickPalette(0);
          return;
        }
        const control = event.ctrlKey || event.metaKey;
        if (event.key === "Delete" || event.key === "Backspace") this.selectedLink ? this.cutSelectedLink() : this.deleteSelected();
        else if (control && event.key.toLowerCase() === "d") this.duplicateSelected();
        else if (control && event.key.toLowerCase() === "z") this.undo(event.shiftKey);
        else if (control && event.key.toLowerCase() === "y") this.undo(true);
        else if (event.key.toLowerCase() === "f") this.fit();
        else if (event.key === "Escape") this.closePalette();
        else return;
        event.preventDefault();
        event.stopPropagation();
      },
      { signal },
    );
    this.palette.querySelector(".bp-search").addEventListener("input", (event) => this.renderPalette(event.target.value), { signal });
    this.root.addEventListener(
      "click",
      (event) => {
        const button = event.target.closest("[data-bp]");
        if (button) {
          event.preventDefault();
          event.stopPropagation();
          if (button.dataset.bp === "reset-ports") {
            const node = this.node([...this.selected][0]);
            if (node) { delete node.appearance; this.render(); this.showDetails(); this.changed(false); }
            return;
          }
          this.command(button.dataset.bp, button);
          return;
        }

      },
      { signal },
    );
    this.details.addEventListener(
      "change",
      (event) => {
        if (event.target.dataset.appearance) {
          const node = this.node([...this.selected][0]);
          if (!node) return;
          node.appearance ??= { ports: {} };
          node.appearance.ports ??= {};
          const port = node.appearance.ports[event.target.dataset.port] ??= {};
          port[event.target.dataset.appearance] = event.target.value.slice(0, 36);
          this.render();
          this.changed(false);
          return;
        }
        if (event.target.dataset.prop) this.updateProp(event.target);
      },
      { signal },
    );
    this.details.addEventListener("submit", (event) => event.preventDefault(), { signal });
  }

  compatible(drag, pinEl) {
    const t = pinEl.dataset;
    if (t.node === drag.node || t.dir === drag.direction) return false;
    const node = this.node(t.node);
    const pin = (t.dir === "in" ? pinsOf(node, this.graph).inputs : pinsOf(node, this.graph).outputs).find((p) => p.id === t.pin);
    if (pin?.kind !== drag.kind) return false;
    if (pin.kind !== "data") return true;
    const other = this.node(drag.node);
    const own = (drag.direction === "out" ? pinsOf(other, this.graph).outputs : pinsOf(other, this.graph).inputs).find((p) => p.id === drag.pin);
    return drag.direction === "out" ? assignable(own?.type, pin.type) : assignable(pin.type, own?.type);
  }

  command(name, element) {
    const rect = this.canvas.getBoundingClientRect();
    const center = this.worldPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    switch (name) {
      case "fit":
        return this.fit();
      case "zoom-in":
        return this.zoom(1.2);
      case "zoom-out":
        return this.zoom(1 / 1.2);
      case "undo":
        return this.undo();
      case "redo":
        return this.undo(true);
      case "layout":
        this.checkpoint();
        this.options.onLayout?.(this.graph);
        this.render();
        this.fit();
        return this.changed(false);
      case "cut-wire":
        return this.cutSelectedLink();
      case "add-node":
        return this.openPalette(rect.left + 24, rect.top + rect.height - 360);
      case "palette-pick":
        return this.pickPalette(Number(element.dataset.index));
      case "close-details":
        return this.select(null);
      case "delete":
        return this.deleteSelected();
      case "duplicate":
        return this.duplicateSelected();
      case "open-line": {
        const node = this.node([...this.selected][0]);
        if (node) this.options.onOpenLine?.(node);
        return;
      }
    }
  }
}

function capture(element, pointerId) {
  try {
    element.setPointerCapture(pointerId);
  } catch {
    // Synthetic or already released pointers cannot be captured; dragging still works.
  }
}

/**
 * Orthogonal wire with rounded corners: out to the right, a vertical run, in from the left.
 * When the target lies behind the source the wire detours around both ends.
 */
function curve(a, b) {
  const corner = (x1, y1, x2, y2, x3, y3) => {
    const r = Math.min(8, Math.abs(x2 - x1) / 2 || 8, Math.abs(y3 - y2) / 2 || 8, Math.abs(x3 - x2) / 2 || 8, Math.abs(y2 - y1) / 2 || 8);
    const sx = Math.sign(x2 - x1) || Math.sign(x3 - x2);
    const sy = Math.sign(y3 - y2) || Math.sign(y2 - y1);
    if (y1 === y2 && x2 === x3) return `L ${x2 - sx * r} ${y2} Q ${x2} ${y2} ${x2} ${y2 + sy * r}`;
    if (x1 === x2 && y2 === y3) return `L ${x2} ${y2 - sy * r} Q ${x2} ${y2} ${x2 + Math.sign(x3 - x2) * r} ${y2}`;
    return `L ${x2} ${y2}`;
  };
  if (Math.abs(a.y - b.y) < 1) return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
  if (b.x - a.x >= 28) {
    const mid = Math.round(a.x + (b.x - a.x) / 2);
    return `M ${a.x} ${a.y} ${corner(a.x, a.y, mid, a.y, mid, b.y)} ${corner(mid, a.y, mid, b.y, b.x, b.y)} L ${b.x} ${b.y}`;
  }
  const out = a.x + 18;
  const back = b.x - 18;
  const midY = Math.round(a.y + (b.y - a.y) / 2);
  return `M ${a.x} ${a.y} ${corner(a.x, a.y, out, a.y, out, midY)} ${corner(out, a.y, out, midY, back, midY)} ${corner(out, midY, back, midY, back, b.y)} ${corner(back, midY, back, b.y, b.x, b.y)} L ${b.x} ${b.y}`;
}

const BADGES = { event: "▸", flow: "◇", variable: "x", function: "ƒ", pure: "=", value: "#", code: "{}" };

export { cloneGraph };
