import { clone } from "../lib/core.mjs";

export const SCHEMA = "blueprints.visual/1";
export const LIMITS = Object.freeze({
  nodes: 60,
  depth: 5,
  repeats: 1000,
  list: 256,
  history: 50,
});
export const TYPES = Object.freeze({
  input: {
    title: "Спросить",
    hint: "Число, текст или список",
    color: "blue",
    icon: "input",
  },
  calculate: {
    title: "Посчитать",
    hint: "Действия с числами",
    color: "amber",
    icon: "calculate",
  },
  print: {
    title: "Показать",
    hint: "Сообщение или ответ",
    color: "green",
    icon: "print",
  },
  condition: {
    title: "Если… то",
    hint: "Два возможных пути",
    color: "violet",
    icon: "condition",
  },
  foreach: {
    title: "Для каждого",
    hint: "Числа из списка",
    color: "peach",
    icon: "repeat",
  },
  value: {
    title: "Запомнить число",
    hint: "Значение на будущее",
    color: "blue",
    icon: "value",
  },
  change: {
    title: "Изменить число",
    hint: "Обновить уже сохранённое значение",
    color: "amber",
    icon: "calculate",
  },
  repeat: {
    title: "Повторить",
    hint: "Выполнить шаги несколько раз",
    color: "peach",
    icon: "repeat",
  },
  note: {
    title: "Заметка",
    hint: "Объяснение для себя и команды",
    color: "neutral",
    icon: "note",
  },
  stop: {
    title: "Завершить",
    hint: "Остановить программу на этом пути",
    color: "neutral",
    icon: "stop",
  },
});
export const ARITHMETIC = {
  "+": "плюс",
  "-": "минус",
  "*": "умножить на",
  "/": "разделить на",
  "%": "остаток от деления на",
};
export const COMPARISONS = {
  ">=": "не меньше",
  ">": "больше",
  "<=": "не больше",
  "<": "меньше",
  "==": "равно",
  "!=": "не равно",
};
let sequence = 0;
export const newId = () =>
  `b${Date.now().toString(36)}_${(++sequence).toString(36)}`;
export const literal = (value = 0, type = "number") => ({
  kind: "literal",
  type,
  value,
});
export const reference = (id = "") => ({ kind: "ref", id });
export const itemId = (node) => `${node.id}_item`;

export function walk(steps, visit, depth = 0) {
  for (const node of steps) {
    visit(node, depth);
    if (node.type === "condition") {
      walk(node.yes, visit, depth + 1);
      walk(node.no, visit, depth + 1);
    }
    if (["foreach", "repeat"].includes(node.type))
      walk(node.body, visit, depth + 1);
  }
}

export function emptyProject(title = "Моя первая программа") {
  return { schema: SCHEMA, title, steps: [], inputs: {} };
}

export function definitions(project) {
  const result = new Map();
  walk(project.steps, (node) => {
    if (["input", "value", "calculate"].includes(node.type))
      result.set(node.id, {
        id: node.id,
        name: String(node.config.name ?? ""),
        type: node.type === "input" ? node.config.dataType : "number",
        nodeId: node.id,
      });
    if (["foreach", "repeat"].includes(node.type))
      result.set(itemId(node), {
        id: itemId(node),
        name:
          node.config.itemName ||
          (node.type === "foreach" ? "Текущее число" : "Номер повтора"),
        type: "number",
        nodeId: node.id,
        readOnly: true,
      });
  });
  return result;
}

export function uniqueName(project, base) {
  const used = new Set(
    [...definitions(project).values()].map((item) => item.name),
  );
  let name = base,
    suffix = 2;
  while (used.has(name)) name = `${base} ${suffix++}`;
  return name;
}

export function createNode(type, project = emptyProject(), scope = new Map()) {
  if (!TYPES[type]) throw new Error("Такого блока пока нет");
  const first = [...scope.values()].find((value) => value.type === "number");
  const list = [...scope.values()].find((value) => value.type === "list");
  const node = { id: newId(), type, config: {} };
  const value = first ? reference(first.id) : literal(0);
  switch (type) {
    case "input":
      node.config = {
        name: uniqueName(project, "Число"),
        dataType: "number",
        example: "100",
      };
      break;
    case "value":
      node.config = { name: uniqueName(project, "Итого"), value: literal(0) };
      break;
    case "calculate":
      node.config = {
        name: uniqueName(project, "Результат"),
        left: value,
        operator: "+",
        right: literal(10),
      };
      break;
    case "change":
      node.config = {
        target:
          [...scope.values()].find(
            (item) => item.type === "number" && !item.readOnly,
          )?.id ?? "",
        operator: "+",
        value: literal(1),
      };
      break;
    case "print":
      node.config = {
        text: "Результат: ",
        value: first ? reference(first.id) : null,
      };
      break;
    case "condition":
      node.config = { left: value, operator: ">=", right: literal(100) };
      node.yes = [];
      node.no = [];
      break;
    case "foreach":
      node.config = {
        list: reference(list?.id ?? ""),
        itemName: uniqueName(project, "Текущее число"),
      };
      node.body = [];
      break;
    case "repeat":
      node.config = {
        times: literal(3),
        itemName: uniqueName(project, "Номер повтора"),
      };
      node.body = [];
      break;
    case "note":
      node.config = { text: "Что делает эта часть программы?" };
      break;
    case "stop":
      break;
  }
  return node;
}

export function locate(project, id) {
  let result = null;
  function search(steps, parentId = null, branch = "steps") {
    for (let index = 0; index < steps.length; index++) {
      const node = steps[index];
      if (node.id === id) {
        result = { node, array: steps, index, parentId, branch };
        return;
      }
      if (node.type === "condition") {
        search(node.yes, node.id, "yes");
        search(node.no, node.id, "no");
      }
      if (["foreach", "repeat"].includes(node.type))
        search(node.body, node.id, "body");
      if (result) return;
    }
  }
  search(project.steps);
  return result;
}

export function slot(project, parentId = null, branch = "steps") {
  if (!parentId && branch === "steps") return project.steps;
  const parent = locate(project, parentId)?.node;
  if (
    !parent ||
    !(
      (parent.type === "condition" && ["yes", "no"].includes(branch)) ||
      (["repeat", "foreach"].includes(parent.type) && branch === "body")
    )
  )
    throw new Error("Не удалось найти место для блока");
  return parent[branch];
}

export function assertStructure(project) {
  if (!project || project.schema !== SCHEMA || !Array.isArray(project.steps))
    throw new Error("Это не файл визуальной схемы Blueprints");
  if (typeof project.title !== "string" || project.title.length > 80)
    throw new Error("Название должно быть короче 80 символов");
  const ids = new Set(),
    seen = new WeakSet();
  let count = 0;
  function inspect(steps, depth) {
    if (!Array.isArray(steps) || depth > LIMITS.depth)
      throw new Error("Слишком много вложенных блоков: максимум 5 уровней");
    for (const node of steps) {
      if (!node || typeof node !== "object" || seen.has(node))
        throw new Error("В схеме обнаружена повторная ссылка");
      seen.add(node);
      if (!/^[a-z][a-z0-9_]{0,50}$/.test(node.id) || ids.has(node.id))
        throw new Error("У блоков должны быть разные идентификаторы");
      ids.add(node.id);
      if (++count > LIMITS.nodes)
        throw new Error("В одной схеме может быть до 60 блоков");
      if (
        !Object.hasOwn(TYPES, node.type) ||
        !node.config ||
        typeof node.config !== "object" ||
        Array.isArray(node.config)
      )
        throw new Error("Неизвестный или повреждённый блок");
      if (node.type === "condition") {
        inspect(node.yes, depth + 1);
        inspect(node.no, depth + 1);
      }
      if (["repeat", "foreach"].includes(node.type))
        inspect(node.body, depth + 1);
    }
  }
  inspect(project.steps, 0);
  if (JSON.stringify(project).length > 150000)
    throw new Error("Файл схемы слишком большой");
  return project;
}

export function operandType(operand, scope) {
  if (!operand || typeof operand !== "object") return null;
  if (operand.kind === "ref") return scope.get(operand.id)?.type ?? null;
  if (
    operand.kind === "literal" &&
    operand.type === "number" &&
    Number.isInteger(operand.value) &&
    operand.value >= -2147483648 &&
    operand.value <= 2147483647
  )
    return "number";
  if (
    operand.kind === "literal" &&
    operand.type === "text" &&
    typeof operand.value === "string" &&
    operand.value.length <= 2000
  )
    return "text";
  return null;
}

export function analyse(project) {
  assertStructure(project);
  const issues = [],
    scopes = new Map(),
    all = definitions(project),
    names = new Set();
  const issue = (node, message, field = "") =>
    issues.push({ nodeId: node.id, message, field });
  for (const definition of all.values()) {
    const node = locate(project, definition.nodeId).node;
    if (!definition.name.trim() || definition.name.length > 50)
      issue(node, "Дайте значению понятное имя: от 1 до 50 символов", "name");
    else if (names.has(definition.name.trim().toLowerCase()))
      issue(
        node,
        `Имя «${definition.name}» уже занято. Выберите другое`,
        "name",
      );
    names.add(definition.name.trim().toLowerCase());
  }
  function check(operand, scope, node, expected, field) {
    const type = operandType(operand, scope);
    if (!type)
      issue(
        node,
        operand?.kind === "ref"
          ? "Выберите значение из предыдущих шагов"
          : "Укажите целое число или текст",
        field,
      );
    else if (expected && type !== expected)
      issue(
        node,
        expected === "list" ? "Здесь нужен список чисел" : "Здесь нужно число",
        field,
      );
    return type;
  }
  function inspect(steps, inherited, depth = 0) {
    const scope = new Map(inherited);
    let stopped = false;
    for (const node of steps) {
      scopes.set(node.id, new Map(scope));
      const c = node.config;
      if (stopped && node.type !== "note")
        issue(
          node,
          "После завершения этот шаг не выполнится. Переместите его выше",
        );
      switch (node.type) {
        case "input":
          if (depth)
            issue(
              node,
              "Вопросы разместите в начале схемы, вне условий и повторов",
            );
          if (!["number", "text", "list"].includes(c.dataType))
            issue(
              node,
              "Выберите, что спросить: число, текст или список",
              "dataType",
            );
          break;
        case "value":
          check(c.value, scope, node, "number", "value");
          break;
        case "calculate":
          check(c.left, scope, node, "number", "left");
          check(c.right, scope, node, "number", "right");
          if (!Object.hasOwn(ARITHMETIC, c.operator))
            issue(node, "Выберите действие с числами", "operator");
          if (
            ["/", "%"].includes(c.operator) &&
            c.right?.kind === "literal" &&
            c.right.value === 0
          )
            issue(
              node,
              "На ноль делить нельзя. Измените второе число",
              "right",
            );
          break;
        case "change":
          if (
            scope.get(c.target)?.type !== "number" ||
            scope.get(c.target)?.readOnly
          )
            issue(
              node,
              "Выберите сохранённое число из предыдущих шагов",
              "target",
            );
          check(c.value, scope, node, "number", "value");
          if (!Object.hasOwn(ARITHMETIC, c.operator))
            issue(node, "Выберите действие с числами", "operator");
          if (
            ["/", "%"].includes(c.operator) &&
            c.value?.kind === "literal" &&
            c.value.value === 0
          )
            issue(node, "На ноль делить нельзя", "value");
          break;
        case "print":
          if (typeof c.text !== "string" || c.text.length > 2000)
            issue(node, "Сообщение должно быть короче 2000 символов", "text");
          if (c.value) check(c.value, scope, node, null, "value");
          break;
        case "condition": {
          const left = check(c.left, scope, node, null, "left");
          const right = check(c.right, scope, node, null, "right");
          if (left && right && (left !== right || left === "list"))
            issue(node, "Сравнивайте два числа или два текста");
          if (
            !Object.hasOwn(COMPARISONS, c.operator) ||
            (left === "text" && !["==", "!="].includes(c.operator))
          )
            issue(node, "Для текста доступны «равно» и «не равно»", "operator");
          inspect(node.yes, scope, depth + 1);
          inspect(node.no, scope, depth + 1);
          break;
        }
        case "foreach": {
          check(c.list, scope, node, "list", "list");
          const inner = new Map(scope);
          inner.set(itemId(node), all.get(itemId(node)));
          inspect(node.body, inner, depth + 1);
          break;
        }
        case "repeat": {
          check(c.times, scope, node, "number", "times");
          if (
            c.times?.kind === "literal" &&
            (c.times.value < 0 || c.times.value > LIMITS.repeats)
          )
            issue(node, "Укажите от 0 до 1000 повторений", "times");
          const inner = new Map(scope);
          inner.set(itemId(node), all.get(itemId(node)));
          inspect(node.body, inner, depth + 1);
          break;
        }
        case "note":
          if (typeof c.text !== "string" || c.text.length > 2000)
            issue(node, "Сократите заметку до 2000 символов", "text");
          break;
        case "stop":
          stopped = true;
          break;
      }
      if (["input", "value", "calculate"].includes(node.type))
        scope.set(node.id, all.get(node.id));
    }
  }
  inspect(project.steps, new Map());
  if (!project.steps.some((node) => node.type !== "note"))
    issues.push({
      nodeId: null,
      message: "Добавьте первый шаг или выберите готовый пример",
    });
  return {
    valid: issues.length === 0,
    issues,
    scopes,
    definitions: all,
    count: countNodes(project),
  };
}

export function countNodes(project) {
  let count = 0;
  walk(project.steps, () => count++);
  return count;
}

export function scopeForSlot(project, parentId, branch, index) {
  const result = analyse(project);
  const steps = slot(project, parentId, branch);
  if (steps[index]) return new Map(result.scopes.get(steps[index].id));
  const scope = parentId ? new Map(result.scopes.get(parentId)) : new Map();
  if (parentId) {
    const parent = locate(project, parentId).node;
    if (["foreach", "repeat"].includes(parent.type))
      scope.set(itemId(parent), result.definitions.get(itemId(parent)));
  }
  for (const node of steps.slice(0, index))
    if (["input", "value", "calculate"].includes(node.type))
      scope.set(node.id, result.definitions.get(node.id));
  return scope;
}

export class BlueprintStore {
  constructor(project = emptyProject()) {
    this.project = clone(assertStructure(project));
    this.undoStack = [];
    this.redoStack = [];
    this.revision = 0;
  }
  transact(edit) {
    const before = clone(this.project),
      next = clone(this.project);
    edit(next);
    assertStructure(next);
    if (JSON.stringify(before) === JSON.stringify(next)) return false;
    this.undoStack.push(before);
    this.undoStack = this.undoStack.slice(-LIMITS.history);
    this.redoStack = [];
    this.project = next;
    this.revision++;
    return true;
  }
  undo() {
    if (!this.undoStack.length) return false;
    this.redoStack.push(clone(this.project));
    this.project = this.undoStack.pop();
    this.revision++;
    return true;
  }
  redo() {
    if (!this.redoStack.length) return false;
    this.undoStack.push(clone(this.project));
    this.project = this.redoStack.pop();
    this.revision++;
    return true;
  }
  add(
    type,
    target = {
      parentId: null,
      branch: "steps",
      index: this.project.steps.length,
    },
  ) {
    let id;
    this.transact((project) => {
      const node = createNode(
        type,
        project,
        scopeForSlot(project, target.parentId, target.branch, target.index),
      );
      id = node.id;
      slot(project, target.parentId, target.branch).splice(
        target.index,
        0,
        node,
      );
    });
    return id;
  }
  remove(id) {
    return this.transact((project) => {
      const found = locate(project, id);
      if (!found) return;
      found.array.splice(found.index, 1);
    });
  }
  move(id, target) {
    return this.transact((project) => {
      const found = locate(project, id);
      if (!found) throw new Error("Блок не найден");
      const descendants = new Set();
      walk([found.node], (node) => descendants.add(node.id));
      if (descendants.has(target.parentId))
        throw new Error("Нельзя поместить блок внутрь самого себя");
      const destination = slot(project, target.parentId, target.branch);
      let index = Math.max(0, Math.min(destination.length, target.index));
      if (destination === found.array && found.index < index) index--;
      found.array.splice(found.index, 1);
      destination.splice(index, 0, found.node);
    });
  }
  update(id, edit) {
    return this.transact((project) => {
      const node = locate(project, id)?.node;
      if (!node) throw new Error("Блок не найден");
      edit(node);
    });
  }
  duplicate(id) {
    let copiedId;
    this.transact((project) => {
      const found = locate(project, id);
      if (!found) return;
      const copy = clone(found.node),
        ids = new Map();
      walk([copy], (node) => {
        const previous = node.id;
        node.id = newId();
        ids.set(previous, node.id);
        ids.set(`${previous}_item`, itemId(node));
      });
      function remap(value) {
        if (!value || typeof value !== "object") return;
        for (const [key, child] of Object.entries(value)) {
          if (
            ["id", "target"].includes(key) &&
            typeof child === "string" &&
            ids.has(child)
          )
            value[key] = ids.get(child);
          else remap(child);
        }
      }
      // IDs were already replaced; remap only configuration references.
      walk([copy], (node) => {
        remap(node.config);
        if (["input", "value", "calculate"].includes(node.type))
          node.config.name = uniqueName(project, `${node.config.name} — копия`);
        if (node.config.itemName)
          node.config.itemName = uniqueName(
            project,
            `${node.config.itemName} — копия`,
          );
      });
      copiedId = copy.id;
      found.array.splice(found.index + 1, 0, copy);
    });
    return copiedId;
  }
}
