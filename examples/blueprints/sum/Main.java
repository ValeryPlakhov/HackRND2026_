import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Generated from a Blueprints visual program. UTF-8 input: one answer per line. */
public class Main {
    private static final BufferedReader input = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
    private static String answer() throws IOException {
        String line = input.readLine();
        if (line == null) throw new IllegalArgumentException("Не хватает ответов на вопросы");
        return line;
    }
    private static int[] numbers(String text) {
        String trimmed = text.trim();
        if (trimmed.isEmpty()) return new int[0];
        String[] parts = trimmed.split("\\s+");
        if (parts.length > 256) throw new IllegalArgumentException("В списке допускается до 256 чисел");
        return Arrays.stream(parts).mapToInt(Integer::parseInt).toArray();
    }
    private static int repetitions(int count) {
        if (count < 0 || count > 1000) throw new IllegalArgumentException("Укажите от 0 до 1000 повторений");
        return count;
    }
    public static void main(String[] args) throws Exception {
        // block:basket_prices / input
        int[] v_basket_prices = numbers(answer());
        // block:basket_total / value
        int v_basket_total = 0;
        // block:basket_loop / foreach
        for (int v_basket_loop_item : v_basket_prices) {
            // block:basket_add / change
            v_basket_total = (v_basket_total + v_basket_loop_item);
        }
        // block:basket_answer / print
        System.out.println("Итого к оплате: " + String.valueOf(v_basket_total));
    }
}
