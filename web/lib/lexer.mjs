import { escapeHtml } from "./core.mjs";

const KEYWORDS = new Set(
  "abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public record return sealed short static strictfp super switch synchronized this throw throws transient try var void volatile while yield permits non-sealed".split(
    " ",
  ),
);
const TYPES = new Set([
  "String",
  "Object",
  "Integer",
  "Long",
  "Double",
  "Float",
  "Boolean",
  "Character",
  "List",
  "Map",
  "Set",
  "ArrayList",
  "HashMap",
  "HashSet",
  "Optional",
  "Scanner",
  "StringBuilder",
  "System",
  "Math",
  "Arrays",
  "Collections",
  "Formatter",
  "Comparator",
]);
const LITERALS = new Set(["true", "false", "null"]);

/** A display lexer, not the grammar authority. javac continues to own parsing. */
export function tokenize(source) {
  const tokens = [];
  let index = 0;
  const push = (type, start, end) =>
    tokens.push({ type, text: source.slice(start, end), start, end });
  while (index < source.length) {
    const start = index;
    const character = source[index];
    if (/\s/.test(character)) {
      while (index < source.length && /\s/.test(source[index])) index++;
      push("space", start, index);
      continue;
    }
    if (source.startsWith("//", index)) {
      const newline = source.indexOf("\n", index);
      index = newline < 0 ? source.length : newline;
      push("comment", start, index);
      continue;
    }
    if (source.startsWith("/*", index)) {
      const close = source.indexOf("*/", index + 2);
      index = close < 0 ? source.length : close + 2;
      push("comment", start, index);
      continue;
    }
    if (source.startsWith('"""', index)) {
      index += 3;
      while (index < source.length) {
        if (source.startsWith('"""', index) && source[index - 1] !== "\\") {
          index += 3;
          break;
        }
        index++;
      }
      push("string", start, index);
      continue;
    }
    if (character === '"' || character === "'") {
      const quote = character;
      index++;
      while (index < source.length) {
        if (source[index] === "\\") {
          index = Math.min(source.length, index + 2);
          continue;
        }
        if (source[index++] === quote) break;
      }
      push(quote === '"' ? "string" : "character", start, index);
      continue;
    }
    if (/[0-9]/.test(character)) {
      const match = source
        .slice(index)
        .match(
          /^(?:0[xX][\da-fA-F_]+(?:\.[\da-fA-F_]*)?(?:[pP][+-]?[\d_]+)?|0[bB][01_]+|[\d_]+(?:\.[\d_]*)?(?:[eE][+-]?[\d_]+)?)[fFdDlL]?/,
        );
      index += match?.[0].length ?? 1;
      push("number", start, index);
      continue;
    }
    if (/[\p{L}_$]/u.test(character)) {
      index++;
      while (index < source.length && /[\p{L}\p{N}_$]/u.test(source[index]))
        index++;
      const word = source.slice(start, index);
      let next = index;
      while (/\s/.test(source[next] ?? "") && next < source.length) next++;
      const type = LITERALS.has(word)
        ? "literal"
        : KEYWORDS.has(word)
          ? "keyword"
          : TYPES.has(word) || /^[A-Z]/.test(word)
            ? "type"
            : source[next] === "("
              ? "function"
              : "identifier";
      push(type, start, index);
      continue;
    }
    if (character === "@") {
      index++;
      while (index < source.length && /[\w.$]/.test(source[index])) index++;
      push("annotation", start, index);
      continue;
    }
    const operator = source
      .slice(index)
      .match(
        /^(?:>>>=|>>>|>>=|<<=|->|::|==|!=|<=|>=|&&|\|\||\+\+|--|\+=|-=|\*=|\/=|%=|<<|>>|[+\-*\/=<>!&|^~?:%])/,
      );
    if (operator) {
      index += operator[0].length;
      push("operator", start, index);
    } else {
      index++;
      push("punctuation", start, index);
    }
  }
  return tokens;
}

export function highlight(source) {
  return tokenize(String(source ?? ""))
    .map((token) =>
      token.type === "space"
        ? escapeHtml(token.text)
        : `<span class="syntax-${token.type}">${escapeHtml(token.text)}</span>`,
    )
    .join("");
}

export function codeLines(source) {
  return highlight(source).split("\n");
}

export function indentationAt(source, cursor) {
  const before = source.slice(0, cursor);
  const line = before.slice(before.lastIndexOf("\n") + 1);
  const indentation = line.match(/^\s*/)?.[0] ?? "";
  return indentation + (line.trimEnd().endsWith("{") ? "    " : "");
}

export function lineAt(source, cursor) {
  return source.slice(0, cursor).split("\n").length;
}

export function offsetAtLine(source, line) {
  const lines = source.split("\n");
  return lines
    .slice(0, Math.max(0, line - 1))
    .reduce((sum, text) => sum + text.length + 1, 0);
}

export function bracketPairs(source) {
  const stack = [];
  const pairs = [];
  const closing = { ")": "(", "]": "[", "}": "{" };
  for (const token of tokenize(source)) {
    if (token.type !== "punctuation") continue;
    if (["(", "[", "{"].includes(token.text)) stack.push(token);
    else if (closing[token.text]) {
      const open = stack.at(-1);
      if (open?.text === closing[token.text]) {
        stack.pop();
        pairs.push([open.start, token.start]);
      }
    }
  }
  return pairs;
}
