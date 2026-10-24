/** Deterministic fuzzy ranking and a compact query language used across the studio. */
export function fuzzyScore(text, query) {
  const haystack = String(text).toLocaleLowerCase("ru-RU");
  const needle = String(query).toLocaleLowerCase("ru-RU").trim();
  if (!needle) return 1;
  if (haystack === needle) return 1000;
  const substring = haystack.indexOf(needle);
  if (substring >= 0)
    return 600 - substring * 2 - (haystack.length - needle.length) * 0.1;
  let position = 0;
  let score = 0;
  let previous = -2;
  for (const character of needle) {
    const found = haystack.indexOf(character, position);
    if (found < 0) return -1;
    score += found === previous + 1 ? 18 : 5;
    if (found === 0 || /[\s._/$#-]/.test(haystack[found - 1])) score += 14;
    score -= (found - position) * 0.7;
    previous = found;
    position = found + 1;
  }
  return score - haystack.length * 0.05;
}

export function parseQuery(query) {
  const parts = String(query).match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
  const filters = {};
  const words = [];
  for (const part of parts) {
    const match = part.match(/^(file|kind|severity|method|rule|line):(.+)$/i);
    if (match) filters[match[1].toLowerCase()] = match[2].replace(/^"|"$/g, "");
    else words.push(part.replace(/^"|"$/g, ""));
  }
  return { text: words.join(" "), filters };
}

export function matchesFilters(item, filters) {
  for (const [key, expected] of Object.entries(filters)) {
    if (key === "line") {
      const range = expected.split("-").map(Number);
      const line = Number(item.line ?? 0);
      if (line < range[0] || line > (range[1] ?? range[0])) return false;
    } else {
      const field = { file: "fileName", method: "name" }[key] ?? key;
      if (
        !String(item[field] ?? "")
          .toLowerCase()
          .includes(expected.toLowerCase())
      )
        return false;
    }
  }
  return true;
}

export function searchItems(items, query, maximum = 30) {
  const parsed = parseQuery(query);
  return items
    .filter((item) => matchesFilters(item, parsed.filters))
    .map((item, index) => ({
      item,
      index,
      score: fuzzyScore(
        [item.title, item.name, item.fileName, item.detail, item.rule]
          .filter(Boolean)
          .join(" "),
        parsed.text,
      ),
    }))
    .filter((match) => match.score >= 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, maximum)
    .map((match) => match.item);
}

export function projectSearchItems(project) {
  const files = Object.keys(project?.files ?? {}).map((fileName) => ({
    id: `file:${fileName}`,
    kind: "file",
    title: fileName,
    fileName,
  }));
  const methods = (project?.methods ?? []).map((method) => ({
    ...method,
    kind: "method",
    title: `${method.owner}.${method.name}()`,
  }));
  const findings = (project?.findings ?? []).map((finding, index) => ({
    ...finding,
    id: `finding:${index}`,
    kind: "finding",
  }));
  return [...files, ...methods, ...findings];
}

export class CommandRegistry {
  constructor(commands = []) {
    this.commands = new Map();
    commands.forEach((command) => this.register(command));
  }
  register(command) {
    if (!command.id || !command.title)
      throw new Error("Команда должна иметь id и title");
    this.commands.set(command.id, { category: "Действия", ...command });
  }
  list(query = "") {
    return searchItems(
      [...this.commands.values()].map((command) => ({
        ...command,
        name: command.keywords ?? "",
      })),
      query,
      15,
    );
  }
  async execute(id, context) {
    const command = this.commands.get(id);
    if (!command) throw new Error("Команда не найдена");
    if (command.enabled && !command.enabled(context))
      throw new Error("Команда недоступна в текущем состоянии");
    return command.run(context);
  }
}
