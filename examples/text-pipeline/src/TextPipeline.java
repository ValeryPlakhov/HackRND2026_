import java.nio.charset.StandardCharsets;
import java.util.Scanner;

/** A deliberately pure string accumulation candidate for the StringBuilder rule. */
public class TextPipeline {
    public static void main(String[] args) {
        Scanner input = new Scanner(System.in, StandardCharsets.UTF_8);
        int count = input.hasNextInt() ? input.nextInt() : 0;
        if (count < 0 || count > 1000) {
            System.err.println("Некорректное число слов");
            return;
        }
        String[] words = new String[count];
        for (int i = 0; i < count; i++) {
            words[i] = input.hasNext() ? input.next() : "";
        }
        System.out.println(join(words));
    }

    static String join(String[] words) {
        String result = "";
        for (String word : words) {
            result += word;
        }
        return result;
    }
}
