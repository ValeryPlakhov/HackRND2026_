import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.*;

interface Scorer { int score(int value); }
class InvalidValue extends Exception {
    InvalidValue(String message) { super(message); }
}
record Score(int value, String label) {}
enum Mode { SUM, MAX }

/** Compilable coverage sample for the case's required Java scope and bonuses. */
public class LanguageShowcase implements Scorer {
    private final int multiplier;
    static final String TITLE = "Проверка Java";
    public LanguageShowcase(int multiplier) { this.multiplier = multiplier; }
    @Override public int score(int value) { return value * multiplier; }

    static <T> Optional<T> first(List<T> values) {
        return values.isEmpty() ? Optional.empty() : Optional.ofNullable(values.get(0));
    }

    static int checked(int value) throws InvalidValue, IOException {
        if (value < 0) throw new InvalidValue("negative");
        if (value == 999) throw new IOException("reserved");
        return (int) Math.sqrt((double) value * value);
    }

    static String flow(int n) {
        int sum = 0;
        for (int i = 0; i <= n; i++) {
            if (i == 2) continue;
            if (i > 8) break;
            sum += i;
        }
        int cursor = 0;
        while (cursor < 2) cursor++;
        do { cursor--; } while (cursor > 0);
        switch (n % 3) {
            case 0: sum += 3; break;
            case 1: sum += 1; break;
            default: sum += 2;
        }
        String description = switch (n) { case 0 -> "zero"; default -> "other"; };
        try {
            sum += checked(n);
        } catch (InvalidValue | IOException e) {
            System.err.println(e.getClass().getSimpleName() + ":" + e.getMessage());
        } finally {
            sum += 1;
        }
        return description + ":" + sum;
    }

    public static void main(String[] args) {
        Scanner scanner = new Scanner(System.in, StandardCharsets.UTF_8);
        int n = scanner.hasNextInt() ? scanner.nextInt() : 0;
        List<Integer> values = new ArrayList<>(List.of(3, 1, 3, 2));
        Collection<Integer> collection = values;
        Iterable<Integer> iterable = collection;
        List<Integer> linked = new LinkedList<>(values);
        Set<Integer> hash = new HashSet<>(Set.of(3, 1));
        Set<Integer> tree = new TreeSet<>(hash);
        Map<String, Integer> map = new HashMap<>(Map.of("a", 1));
        Map<String, Integer> sorted = new TreeMap<>(map);
        Iterator<Integer> iterator = iterable.iterator();
        int total = 0;
        while (iterator.hasNext()) total += iterator.next();
        Collections.sort(linked, Comparator.naturalOrder());
        int[] numbers = {3, 2, 1};
        Arrays.sort(numbers);
        Integer wrapped = n;
        boolean condition = wrapped >= 0 && wrapped != 4;
        Scorer scorer = new LanguageShowcase(2);
        var scores = values.stream().map(x -> new Score(scorer.score(x), "оценка")).toList();
        try (Formatter formatter = new Formatter(System.out, Locale.ROOT)) {
            formatter.format("%s%n%s%n", TITLE, flow(n));
            formatter.format("%d %s %s %s %s %s%n", total, condition, tree, sorted, first(linked), scores);
        }
    }
}
