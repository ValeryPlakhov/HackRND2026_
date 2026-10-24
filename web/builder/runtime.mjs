import { analyse, itemId, LIMITS } from "./model.mjs";

export class BlueprintError extends Error {
  constructor(message, nodeId = null) {
    super(message);
    this.name = "BlueprintError";
    this.nodeId = nodeId;
  }
}

export function parseInteger(raw, nodeId = null) {
  const value = String(raw).trim();
  if (!/^[+-]?\d+$/.test(value))
    throw new BlueprintError("Введите целое число, например 125", nodeId);
  const number = Number(value);
  if (!Number.isInteger(number) || number < -2147483648 || number > 2147483647)
    throw new BlueprintError(
      "Число должно быть от −2 147 483 648 до 2 147 483 647",
      nodeId,
    );
  return number;
}

export function parseAnswer(raw, definition) {
  const text = String(raw ?? "");
  if (text.length > 4000 || /[\r\n\0]/.test(text))
    throw new BlueprintError(
      "Один ответ должен помещаться в одну строку до 4000 символов",
      definition.id,
    );
  if (definition.type === "text") return text;
  if (definition.type === "number") return parseInteger(text, definition.id);
  const parts = text.trim() ? text.trim().split(/\s+/) : [];
  if (parts.length > LIMITS.list)
    throw new BlueprintError("В списке может быть до 256 чисел", definition.id);
  return parts.map((part) => parseInteger(part, definition.id));
}

export function arithmetic(operator, left, right, nodeId) {
  switch (operator) {
    case "+":
      return (left + right) | 0;
    case "-":
      return (left - right) | 0;
    case "*":
      return Math.imul(left, right);
    case "/":
      if (!right)
        throw new BlueprintError(
          "На ноль делить нельзя. Измените входные данные",
          nodeId,
        );
      return Math.trunc(left / right) | 0;
    case "%":
      if (!right)
        throw new BlueprintError(
          "Нельзя найти остаток при делении на ноль",
          nodeId,
        );
      return left % right | 0;
    default:
      throw new BlueprintError("Выберите действие с числами", nodeId);
  }
}

export const formatValue = (value) =>
  Array.isArray(value) ? `[${value.join(", ")}]` : String(value);

/** Teaching trace of the visual model; the UI distinguishes this from actual JVM execution. */
export function simulate(project, answers = {}) {
  const analysis = analyse(project);
  if (!analysis.valid)
    throw new BlueprintError(
      analysis.issues[0].message,
      analysis.issues[0].nodeId,
    );
  const values = new Map(),
    output = [],
    trace = [];
  let steps = 0,
    stopped = false;
  const resolve = (operand) =>
    operand.kind === "literal" ? operand.value : values.get(operand.id);
  const event = (node, message) => {
    if (++steps > 10000)
      throw new BlueprintError(
        "Слишком много действий за один запуск. Уменьшите число повторений",
        node.id,
      );
    if (trace.length < 500)
      trace.push({
        nodeId: node.id,
        message,
        output: output.join("\n") + (output.length ? "\n" : ""),
        values: Object.fromEntries(values),
      });
  };
  function execute(nodes) {
    for (const node of nodes) {
      if (stopped) return;
      const c = node.config;
      switch (node.type) {
        case "input": {
          const value = parseAnswer(answers[node.id], {
            id: node.id,
            type: c.dataType,
          });
          values.set(node.id, value);
          event(node, `Получили «${c.name}»: ${formatValue(value)}`);
          break;
        }
        case "value":
          values.set(node.id, resolve(c.value));
          event(node, `Запомнили «${c.name}»: ${resolve(c.value)}`);
          break;
        case "calculate": {
          const value = arithmetic(
            c.operator,
            resolve(c.left),
            resolve(c.right),
            node.id,
          );
          values.set(node.id, value);
          event(node, `Посчитали «${c.name}»: ${value}`);
          break;
        }
        case "change": {
          const value = arithmetic(
            c.operator,
            values.get(c.target),
            resolve(c.value),
            node.id,
          );
          values.set(c.target, value);
          event(
            node,
            `Теперь «${analysis.definitions.get(c.target).name}»: ${value}`,
          );
          break;
        }
        case "print": {
          const line = c.text + (c.value ? formatValue(resolve(c.value)) : "");
          output.push(line);
          if (output.join("\n").length > 64000)
            throw new BlueprintError(
              "Результат слишком длинный. Уменьшите количество сообщений",
              node.id,
            );
          event(node, `Показали: ${line}`);
          break;
        }
        case "condition": {
          const a = resolve(c.left),
            b = resolve(c.right);
          const condition = {
            ">=": () => a >= b,
            ">": () => a > b,
            "<=": () => a <= b,
            "<": () => a < b,
            "==": () => a === b,
            "!=": () => a !== b,
          }[c.operator]();
          event(
            node,
            `Условие ${condition ? "выполнено → путь «Да»" : "не выполнено → путь «Нет»"}`,
          );
          execute(condition ? node.yes : node.no);
          break;
        }
        case "foreach": {
          const list = resolve(c.list);
          event(node, `Повторяем для ${list.length} чисел`);
          for (let index = 0; index < list.length && !stopped; index++) {
            values.set(itemId(node), list[index]);
            event(node, `Число ${index + 1} из ${list.length}: ${list[index]}`);
            execute(node.body);
          }
          values.delete(itemId(node));
          break;
        }
        case "repeat": {
          const count = resolve(c.times);
          if (count < 0 || count > LIMITS.repeats)
            throw new BlueprintError(
              "Укажите от 0 до 1000 повторений",
              node.id,
            );
          event(node, `Повторяем ${count} раз`);
          for (let index = 1; index <= count && !stopped; index++) {
            values.set(itemId(node), index);
            event(node, `Повтор ${index} из ${count}`);
            execute(node.body);
          }
          values.delete(itemId(node));
          break;
        }
        case "note":
          break;
        case "stop":
          event(node, "Программа завершена");
          stopped = true;
          break;
      }
    }
  }
  execute(project.steps);
  return {
    stdout: output.join("\n") + (output.length ? "\n" : ""),
    trace,
    values: Object.fromEntries(values),
    truncatedTrace: steps > trace.length,
    steps,
  };
}

export function inputText(compiled, answers) {
  const text =
    compiled.inputs
      .map((input) => {
        parseAnswer(answers[input.id], input);
        return String(answers[input.id] ?? "");
      })
      .join("\n") + (compiled.inputs.length ? "\n" : "");
  if (text.length > 32768)
    throw new BlueprintError(
      "Все ответы вместе должны быть короче 32 тысяч символов",
    );
  return text;
}
