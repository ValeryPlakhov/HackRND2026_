import { typeColor } from "./model.mjs";

const FLOW_LABELS = { in: "Выполнить", then: "Дальше", true: "Да · true", false: "Нет · false", body: "Тело цикла", done: "После цикла", next: "Дальше" };
export function portPresentation(node, pin, direction) {
  const custom = node.appearance?.ports?.[`${direction}:${pin.id}`] ?? {};
  const fallback = pin.kind === "exec" ? FLOW_LABELS[pin.id] || pin.label || "Порядок" : pin.label || (direction === "in" ? "Значение" : "Результат");
  return {
    label: String(custom.label || fallback).slice(0, 36),
    type: pin.kind === "exec" ? "порядок" : pin.type || "any",
    color: /^#[0-9a-f]{6}$/i.test(custom.color ?? "") ? custom.color : pin.kind === "exec" ? "#53607a" : typeColor(pin.type),
  };
}

export const NODE_HELP = {
  entry: "Начало метода. Параметры Java доступны как выходные значения.",
  branch: "Проверяет boolean-условие. Выполняется ветка true или false.",
  for: "Цикл: инициализация → проверка условия → тело → шаг.",
  while: "Проверяет условие перед каждой итерацией. Выход «После цикла» продолжает метод.",
  foreach: "Обходит элементы массива или коллекции по одному.",
  return: "Завершает метод и возвращает результат, если он предусмотрен сигнатурой.",
  call: "Вызывает Java-метод. Параметры поступают на входы, результат выходит справа.",
  get: "Читает текущее значение переменной.",
  set: "Объявляет переменную или записывает в неё новое значение.",
  code: "Сохранённый фрагмент Java. Его внутренние шаги не представлены отдельными портами.",
  expr: "Java-выражение, которое вычисляет значение.",
  literal: "Постоянное значение Java указанного типа.",
  op: "Операция над входными значениями. Результат доступен справа.",
};
