import { analyse, itemId } from "./model.mjs";

export const javaName = (id) => `v_${id}`;
export function javaString(value) {
  return (
    '"' +
    String(value).replace(
      /[\\"\n\r\t\b\f\x00-\x1f]/g,
      (character) =>
        ({
          "\\": "\\\\",
          '"': '\\"',
          "\n": "\\n",
          "\r": "\\r",
          "\t": "\\t",
          "\b": "\\b",
          "\f": "\\f",
        })[character] ??
        `\\${character.charCodeAt(0).toString(8).padStart(3, "0")}`,
    ) +
    '"'
  );
}

/** Structured visual IR -> ordinary Java. No user text is treated as an expression. */
export function compileBlueprint(project) {
  const analysis = analyse(project);
  if (!analysis.valid) {
    const error = new Error(analysis.issues[0].message);
    error.issues = analysis.issues;
    throw error;
  }
  const lines = [],
    spans = {},
    inputs = [];
  let indent = 0;
  const emit = (value) => lines.push("    ".repeat(indent) + value);
  const expression = (operand) =>
    operand.kind === "ref"
      ? javaName(operand.id)
      : operand.type === "text"
        ? javaString(operand.value)
        : String(operand.value);
  emit("import java.io.*;");
  emit("import java.nio.charset.StandardCharsets;");
  emit("import java.util.*;");
  emit("");
  emit(
    "/** Generated from a Blueprints visual program. UTF-8 input: one answer per line. */",
  );
  emit("public class Main {");
  indent++;
  emit(
    "private static final BufferedReader input = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));",
  );
  emit("private static String answer() throws IOException {");
  indent++;
  emit("String line = input.readLine();");
  emit(
    'if (line == null) throw new IllegalArgumentException("Не хватает ответов на вопросы");',
  );
  emit("return line;");
  indent--;
  emit("}");
  emit("private static int[] numbers(String text) {");
  indent++;
  emit("String trimmed = text.trim();");
  emit("if (trimmed.isEmpty()) return new int[0];");
  emit('String[] parts = trimmed.split("\\\\s+");');
  emit(
    'if (parts.length > 256) throw new IllegalArgumentException("В списке допускается до 256 чисел");',
  );
  emit("return Arrays.stream(parts).mapToInt(Integer::parseInt).toArray();");
  indent--;
  emit("}");
  emit("private static int repetitions(int count) {");
  indent++;
  emit(
    'if (count < 0 || count > 1000) throw new IllegalArgumentException("Укажите от 0 до 1000 повторений");',
  );
  emit("return count;");
  indent--;
  emit("}");
  emit("public static void main(String[] args) throws Exception {");
  indent++;
  function render(steps) {
    for (const node of steps) {
      const c = node.config,
        start = lines.length + 1;
      emit(`// block:${node.id} / ${node.type}`);
      switch (node.type) {
        case "input": {
          inputs.push({
            id: node.id,
            label: c.name,
            type: c.dataType,
            example: c.example ?? "",
          });
          const initial = {
            number: "Integer.parseInt(answer().trim())",
            text: "answer()",
            list: "numbers(answer())",
          }[c.dataType];
          const type = { number: "int", text: "String", list: "int[]" }[
            c.dataType
          ];
          emit(`${type} ${javaName(node.id)} = ${initial};`);
          break;
        }
        case "value":
          emit(`int ${javaName(node.id)} = ${expression(c.value)};`);
          break;
        case "calculate":
          emit(
            `int ${javaName(node.id)} = (${expression(c.left)} ${c.operator} ${expression(c.right)});`,
          );
          break;
        case "change":
          emit(
            `${javaName(c.target)} = (${javaName(c.target)} ${c.operator} ${expression(c.value)});`,
          );
          break;
        case "print": {
          const value = c.value
            ? analysis.scopes.get(node.id).get(c.value.id)?.type === "list"
              ? `Arrays.toString(${expression(c.value)})`
              : expression(c.value)
            : null;
          emit(
            `System.out.println(${javaString(c.text)}${value ? " + String.valueOf(" + value + ")" : ""});`,
          );
          break;
        }
        case "condition": {
          const leftType =
            c.left.kind === "ref"
              ? analysis.scopes.get(node.id).get(c.left.id)?.type
              : c.left.type;
          const condition =
            leftType === "text"
              ? `${c.operator === "!=" ? "!" : ""}Objects.equals(${expression(c.left)}, ${expression(c.right)})`
              : `${expression(c.left)} ${c.operator} ${expression(c.right)}`;
          emit(`if (${condition}) {`);
          indent++;
          render(node.yes);
          indent--;
          emit("} else {");
          indent++;
          render(node.no);
          indent--;
          emit("}");
          break;
        }
        case "foreach":
          emit(`for (int ${javaName(itemId(node))} : ${expression(c.list)}) {`);
          indent++;
          render(node.body);
          indent--;
          emit("}");
          break;
        case "repeat": {
          const bound = `bound_${node.id}`,
            counter = javaName(itemId(node));
          emit(`int ${bound} = repetitions(${expression(c.times)});`);
          emit(
            `for (int ${counter} = 1; ${counter} <= ${bound}; ${counter}++) {`,
          );
          indent++;
          render(node.body);
          indent--;
          emit("}");
          break;
        }
        case "note":
          for (const line of c.text.split(/\r?\n/))
            emit("// " + line.replace(/\\/g, "＼"));
          break;
        case "stop":
          emit("return;");
          break;
      }
      spans[node.id] = { start, end: lines.length };
    }
  }
  render(project.steps);
  indent--;
  emit("}");
  indent--;
  emit("}");
  return {
    source: lines.join("\n") + "\n",
    fileName: "Main.java",
    spans,
    inputs,
  };
}

export function sourceBlockForLine(compiled, line) {
  return (
    Object.entries(compiled.spans)
      .filter(([, span]) => line >= span.start && line <= span.end)
      .sort(
        (a, b) => a[1].end - a[1].start - (b[1].end - b[1].start),
      )[0]?.[0] ?? null
  );
}
