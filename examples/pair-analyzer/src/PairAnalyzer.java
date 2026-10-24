import java.nio.charset.StandardCharsets;
import java.util.*;

/** Demo: counts ordered equal pairs, including each element paired with itself. */
public class PairAnalyzer {
    public static void main(String[] args) {
        Scanner input = new Scanner(System.in, StandardCharsets.UTF_8);
        int n = input.hasNextInt() ? input.nextInt() : 0;
        if (n < 0 || n > 100000) {
            System.err.println("Некорректный размер");
            return;
        }
        int[] values = new int[n];
        for (int i = 0; i < n; i++) {
            values[i] = input.hasNextInt() ? input.nextInt() : 0;
        }
        System.out.printf("Совпадающих пар: %d%n", countPairs(values));
        System.out.println("Категория: " + classify(n));
    }

    static int countPairs(int[] values) {
        int matches = 0;
        for (int a : values) {
            for (int b : values) {
                if (a == b) {
                    matches++;
                }
            }
        }
        return matches;
    }

    static String classify(int n) {
        if (n == 0) {
            return "пустой набор";
        }
        if (n < 10) {
            return "малый набор";
        }
        return "большой набор";
    }
}
