export const LANGUAGES = [
  {
    id: "java",
    name: "Java",
    extension: ".java",
    color: "#d39147",
    available: true,
    description:
      "Открывайте проекты, читайте и редактируйте блупринты, запускайте Java 21.",
  },
  {
    id: "python",
    name: "Python",
    extension: ".py",
    color: "#4b82b1",
    available: false,
    description: "Визуальные сценарии, функции и обработка данных.",
  },
  {
    id: "javascript",
    name: "JavaScript",
    extension: ".js",
    color: "#bea33f",
    available: false,
    description: "События, условия и функции в виде связанного графа.",
  },
  {
    id: "typescript",
    name: "TypeScript",
    extension: ".ts",
    color: "#477bb8",
    available: false,
    description: "Блупринты с типами и интерфейсами.",
  },
  {
    id: "kotlin",
    name: "Kotlin",
    extension: ".kt",
    color: "#9172c8",
    available: false,
    description: "Визуальное представление Kotlin-проектов.",
  },
  {
    id: "csharp",
    name: "C#",
    extension: ".cs",
    color: "#7c61a8",
    available: false,
    description: "Блупринты для приложений .NET.",
  },
  {
    id: "cpp",
    name: "C++",
    extension: ".cpp",
    color: "#658cba",
    available: false,
    description: "Функции и управление потоком в C++.",
  },
  {
    id: "go",
    name: "Go",
    extension: ".go",
    color: "#4f9ca7",
    available: false,
    description: "Наглядные функции и обработка ошибок.",
  },
  {
    id: "rust",
    name: "Rust",
    extension: ".rs",
    color: "#ad795d",
    available: false,
    description: "Визуальные функции, ветвления и сопоставление вариантов.",
  },
];

export const JAVA_SNIPPETS = [
  {
    label: "sout",
    detail: "Вывести строку",
    kind: "snippet",
    insert: "System.out.println($0);",
  },
  {
    label: "serr",
    detail: "Вывести ошибку",
    kind: "snippet",
    insert: "System.err.println($0);",
  },
  {
    label: "main",
    detail: "Точка входа",
    kind: "snippet",
    insert: "public static void main(String[] args) {\n\t$0\n}",
  },
  {
    label: "if",
    detail: "Условие",
    kind: "snippet",
    insert: "if ($0) {\n\t\n}",
  },
  {
    label: "ifelse",
    detail: "Условие с двумя ветками",
    kind: "snippet",
    insert: "if ($0) {\n\t\n} else {\n\t\n}",
  },
  {
    label: "fori",
    detail: "Цикл со счётчиком",
    kind: "snippet",
    insert: "for (int i = 0; i < $0; i++) {\n\t\n}",
  },
  {
    label: "foreach",
    detail: "Перебрать элементы",
    kind: "snippet",
    insert: "for (var item : $0) {\n\t\n}",
  },
  {
    label: "while",
    detail: "Повторять пока",
    kind: "snippet",
    insert: "while ($0) {\n\t\n}",
  },
  {
    label: "trycatch",
    detail: "Обработать исключение",
    kind: "snippet",
    insert:
      "try {\n\t$0\n} catch (Exception error) {\n\tSystem.err.println(error.getMessage());\n}",
  },
  {
    label: "method",
    detail: "Создать метод",
    kind: "snippet",
    insert: "public static void $0() {\n\t\n}",
  },
  {
    label: "scanner",
    detail: "Читать стандартный ввод",
    kind: "snippet",
    insert: "var scanner = new java.util.Scanner(System.in);\n$0",
  },
  {
    label: "list",
    detail: "Список значений",
    kind: "snippet",
    insert: "var values = new java.util.ArrayList<String>();\n$0",
  },
  {
    label: "map",
    detail: "Словарь значений",
    kind: "snippet",
    insert: "var values = new java.util.HashMap<String, Integer>();\n$0",
  },
  {
    label: "record",
    detail: "Тип данных record",
    kind: "snippet",
    insert: "public record $0(String name, int value) {}",
  },
  {
    label: "switch",
    detail: "Выбор варианта",
    kind: "snippet",
    insert:
      "switch ($0) {\n\tcase 1 -> System.out.println(1);\n\tdefault -> System.out.println(0);\n}",
  },
  {
    label: "guard",
    detail: "Проверить аргумент",
    kind: "snippet",
    insert:
      'if ($0 == null) {\n\tthrow new IllegalArgumentException("Значение обязательно");\n}',
  },
  {
    label: "builder",
    detail: "Собрать строку",
    kind: "snippet",
    insert: "var result = new StringBuilder();\n$0",
  },
  {
    label: "readline",
    detail: "Прочитать строку UTF-8",
    kind: "snippet",
    insert:
      "var reader = new java.io.BufferedReader(new java.io.InputStreamReader(System.in, java.nio.charset.StandardCharsets.UTF_8));\nString line = reader.readLine();\n$0",
  },
];

export const JAVA_COMPLETIONS = [
  ..."abstract assert boolean break byte case catch char class continue default do double else enum extends final finally float for if implements import instanceof int interface long native new package private protected public record return sealed short static super switch synchronized this throw throws try var void volatile while yield permits"
    .split(" ")
    .map((label) => ({
      label,
      insert: label,
      detail: "Ключевое слово Java",
      kind: "keyword",
    })),
  ...[
    "String",
    "System",
    "Math",
    "Integer",
    "Long",
    "Double",
    "Boolean",
    "Object",
    "Exception",
    "IllegalArgumentException",
    "StringBuilder",
    "ArrayList",
    "HashMap",
    "HashSet",
    "List",
    "Map",
    "Set",
    "Optional",
    "Arrays",
    "Collections",
    "Scanner",
  ].map((label) => ({
    label,
    insert: label,
    detail: "Тип Java · импорт при необходимости вручную",
    kind: "type",
  })),
];

export const JAVA_FILE_TEMPLATES = [
  {
    id: "class",
    label: "Java-класс",
    description: "Обычный класс с конструктором",
    create: (name) =>
      `public class ${name} {\n    public ${name}() {\n    }\n}\n`,
  },
  {
    id: "main",
    label: "Исполняемый класс",
    description: "Класс с точкой входа main",
    create: (name) =>
      `public class ${name} {\n    public static void main(String[] args) {\n        System.out.println("Hello, Blueprints!");\n    }\n}\n`,
  },
  {
    id: "interface",
    label: "Интерфейс",
    description: "Контракт для нескольких реализаций",
    create: (name) => `public interface ${name} {\n    void execute();\n}\n`,
  },
  {
    id: "record",
    label: "Record",
    description: "Неизменяемые данные Java 21",
    create: (name) => `public record ${name}(String name, int value) {\n}\n`,
  },
  {
    id: "enum",
    label: "Enum",
    description: "Набор допустимых значений",
    create: (name) => `public enum ${name} {\n    FIRST,\n    SECOND\n}\n`,
  },
  {
    id: "text",
    label: "Текстовый файл",
    description: "Пустой файл без шаблона",
    create: () => "",
  },
];

export const SHORTCUTS = [
  ["Ctrl + O", "Открыть папку проекта"],
  ["Ctrl + S", "Сохранить текущий файл"],
  ["Ctrl + Shift + S", "Сохранить все файлы"],
  ["Ctrl + P", "Быстро открыть файл"],
  ["Ctrl + Shift + P", "Палитра команд"],
  ["Ctrl + Shift + F", "Поиск по проекту"],
  ["Ctrl + F", "Найти в текущем файле"],
  ["Ctrl + H", "Найти и заменить в файле"],
  ["Ctrl + G", "Перейти к строке"],
  ["Ctrl + /", "Закомментировать строки"],
  ["Ctrl + Space", "Шаблоны и подсказки Java"],
  ["Alt + ↑ / ↓", "Переместить строку"],
  ["Alt + Shift + ↓", "Дублировать строку"],
  ["Ctrl + W", "Закрыть вкладку"],
  ["Ctrl + Tab", "Следующая вкладка"],
  ["Ctrl + Shift + T", "Вернуть закрытую вкладку"],
  ["F5", "Сохранить и запустить Java-проект"],
  ["Shift + F5", "Остановить задачу"],
  ["Ctrl + F9", "Проверить сборку"],
  ["Ctrl + B", "Скрыть или показать дерево файлов"],
  ["Ctrl + J", "Скрыть или показать нижнюю панель"],
  ["Ctrl + ,", "Настройки IDE"],
];
