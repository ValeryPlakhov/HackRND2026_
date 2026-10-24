import java.util.*;

/** Seeded, schema-driven console inputs. No attempt to guess a program's input grammar. */
public final class InputCases {
  private InputCases() {}

  public static Map<String, Object> generate(Map<String, Object> request) {
    String schema = Json.str(request, "schema", "int-array");
    long seed = number(request, "seed", 75000);
    int count = bounded(request, "count", 12, 3, 30);
    int maximumLength = bounded(request, "maximumLength", 24, 1, 256);
    int minimum =
        (int)
            Math.max(
                Integer.MIN_VALUE, Math.min(Integer.MAX_VALUE, number(request, "minimum", -20)));
    int maximum =
        (int)
            Math.max(
                Integer.MIN_VALUE, Math.min(Integer.MAX_VALUE, number(request, "maximum", 20)));
    if (minimum > maximum) throw new IllegalArgumentException("Минимум больше максимума");
    SplittableRandom random = new SplittableRandom(seed);
    List<Object> cases = new ArrayList<>();
    switch (schema) {
      case "int-array" -> arrays(cases, count, maximumLength, minimum, maximum, random);
      case "single-int" -> integers(cases, count, minimum, maximum, random);
      case "text-line" -> text(cases, count, maximumLength, random);
      default -> throw new IllegalArgumentException("Неизвестная схема входа");
    }
    return Digests.map(
        "schema",
        schema,
        "seed",
        seed,
        "cases",
        cases,
        "inputs",
        cases.stream().map(item -> ((Map<?, ?>) item).get("input")).toList(),
        "note",
        "Входы соответствуют выбранной схеме. Совместимость схемы с загруженной программой"
            + " проверяет пользователь.");
  }

  private static void arrays(
      List<Object> output,
      int count,
      int length,
      int minimum,
      int maximum,
      SplittableRandom random) {
    addArray(output, "Пустой массив", new int[0], "boundary");
    addArray(output, "Один минимальный элемент", new int[] {minimum}, "boundary");
    addArray(output, "Один максимальный элемент", new int[] {maximum}, "boundary");
    int[] same = new int[Math.min(length, 12)];
    Arrays.fill(same, minimum <= 0 && maximum >= 0 ? 0 : minimum);
    if (output.size() < count) addArray(output, "Одинаковые элементы", same, "duplicates");
    int[] alternating = new int[Math.min(length, 16)];
    for (int i = 0; i < alternating.length; i++) alternating[i] = i % 2 == 0 ? minimum : maximum;
    if (output.size() < count) addArray(output, "Чередование границ", alternating, "boundary");
    int[] sorted = new int[Math.min(length, 20)];
    for (int i = 0; i < sorted.length; i++) sorted[i] = randomInt(random, minimum, maximum);
    Arrays.sort(sorted);
    if (output.size() < count) addArray(output, "Упорядоченный набор", sorted, "ordered");
    int[] reversed = sorted.clone();
    for (int i = 0; i < reversed.length / 2; i++) {
      int swap = reversed[i];
      reversed[i] = reversed[reversed.length - 1 - i];
      reversed[reversed.length - 1 - i] = swap;
    }
    if (output.size() < count) addArray(output, "Обратный порядок", reversed, "ordered");
    while (output.size() < count) {
      int[] values = new int[random.nextInt(length + 1)];
      for (int i = 0; i < values.length; i++) values[i] = randomInt(random, minimum, maximum);
      addArray(output, "Случайный набор " + (output.size() + 1), values, "random");
    }
  }

  private static void integers(
      List<Object> output, int count, int minimum, int maximum, SplittableRandom random) {
    add(output, "Минимум", minimum + "\n", "boundary");
    add(output, "Максимум", maximum + "\n", "boundary");
    add(output, "Середина", (minimum + ((long) maximum - minimum) / 2) + "\n", "boundary");
    while (output.size() < count)
      add(
          output,
          "Число " + (output.size() + 1),
          randomInt(random, minimum, maximum) + "\n",
          "random");
  }

  private static void text(List<Object> output, int count, int length, SplittableRandom random) {
    add(output, "Пустая строка", "\n", "boundary");
    add(output, "Кириллица", "Привет, мир!\n", "unicode");
    add(output, "Пробелы", "  a  b  \n", "whitespace");
    String alphabet = "abcXYZ0123456789 абвгд";
    while (output.size() < count) {
      int size = random.nextInt(length + 1);
      StringBuilder value = new StringBuilder();
      for (int i = 0; i < size; i++)
        value.append(alphabet.charAt(random.nextInt(alphabet.length())));
      add(output, "Строка " + (output.size() + 1), value + "\n", "random");
    }
  }

  private static int randomInt(SplittableRandom random, int minimum, int maximum) {
    return (int) (minimum + random.nextLong((long) maximum - minimum + 1));
  }

  private static void addArray(List<Object> output, String name, int[] values, String category) {
    StringJoiner tokens = new StringJoiner(" ");
    for (int value : values) tokens.add(Integer.toString(value));
    add(output, name, values.length + "\n" + tokens + "\n", category);
  }

  private static void add(List<Object> output, String name, String input, String category) {
    output.add(
        Digests.map(
            "id",
            "case-" + (output.size() + 1),
            "name",
            name,
            "input",
            input,
            "category",
            category,
            "enabled",
            true));
  }

  static long number(Map<String, Object> request, String key, long fallback) {
    Object value = request.get(key);
    return value instanceof Number number ? number.longValue() : fallback;
  }

  static int bounded(
      Map<String, Object> request, String key, int fallback, int minimum, int maximum) {
    long value = number(request, key, fallback);
    if (value < minimum || value > maximum)
      throw new IllegalArgumentException(key + ": ожидается " + minimum + ".." + maximum);
    return (int) value;
  }
}
