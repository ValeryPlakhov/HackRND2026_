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
        // block:reminder_loop / repeat
        int bound_reminder_loop = repetitions(3);
        for (int v_reminder_loop_item = 1; v_reminder_loop_item <= bound_reminder_loop; v_reminder_loop_item++) {
            // block:reminder_message / print
            System.out.println("Напоминание № " + String.valueOf(v_reminder_loop_item));
        }
    }
}
