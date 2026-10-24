import { uniqueId } from "./core.mjs";

export function parseConsoleCases(text) {
  return String(text)
    .split(/^---\s*$/m)
    .map((input, index) => ({
      id: uniqueId("case"),
      name: `Вход ${index + 1}`,
      input: input.replace(/^\r?\n/, ""),
      category: "manual",
      enabled: true,
    }));
}

export function serializeConsoleCases(cases) {
  return cases
    .map((item) => (item.input.endsWith("\n") ? item.input : item.input + "\n"))
    .join("---\n");
}

export function validateCases(cases) {
  const errors = [];
  if (!cases.length) errors.push("Добавьте хотя бы один вход");
  if (cases.length > 30) errors.push("Допустимо максимум 30 входов");
  if (!cases.some((item) => item.enabled !== false))
    errors.push("Включите хотя бы один вход");
  cases.forEach((item, index) => {
    if (typeof item.input !== "string")
      errors.push(`Вход ${index + 1}: ожидается строка`);
    else if (item.input.length > 32768)
      errors.push(`Вход ${index + 1}: больше 32768 символов`);
  });
  return errors;
}

export function arraySchema(input) {
  if (!String(input).trim()) return null;
  const tokens = String(input).trim().split(/\s+/);
  const length = Number(tokens[0]);
  if (
    !Number.isInteger(length) ||
    length < 0 ||
    length > 256 ||
    tokens.length !== length + 1
  )
    return null;
  const values = tokens.slice(1).map(Number);
  return values.every(
    (value) =>
      Number.isInteger(value) && value >= -2147483648 && value <= 2147483647,
  )
    ? values
    : null;
}

export function inputPreview(input, maximum = 58) {
  const compact = String(input).replace(/\s+/g, " ").trim();
  if (!compact) return "пустой stdin";
  return compact.length > maximum ? compact.slice(0, maximum) + "…" : compact;
}

export function importCaseJson(text) {
  const parsed = JSON.parse(text);
  const list = Array.isArray(parsed) ? parsed : (parsed.cases ?? parsed.inputs);
  if (!Array.isArray(list))
    throw new Error("JSON должен содержать массив inputs или cases");
  const cases = list.map((item, index) =>
    typeof item === "string"
      ? {
          id: uniqueId("case"),
          name: `Вход ${index + 1}`,
          input: item,
          enabled: true,
          category: "imported",
        }
      : {
          id: uniqueId("case"),
          name: item.name ?? `Вход ${index + 1}`,
          input: item.input,
          enabled: item.enabled !== false,
          category: item.category ?? "imported",
        },
  );
  const errors = validateCases(cases);
  if (errors.length) throw new Error(errors.join(". "));
  return cases;
}

export function mergeCases(current, generated) {
  const seen = new Set(current.map((item) => item.input));
  return [
    ...current,
    ...generated.filter((item) => {
      if (seen.has(item.input)) return false;
      seen.add(item.input);
      return true;
    }),
  ].slice(0, 30);
}

export function caseStatistics(cases) {
  return {
    total: cases.length,
    enabled: cases.filter((item) => item.enabled !== false).length,
    characters: cases.reduce((sum, item) => sum + item.input.length, 0),
    generated: cases.filter((item) => item.category !== "manual").length,
    compatibleArrays: cases.filter((item) => arraySchema(item.input) !== null)
      .length,
  };
}
