// Small, runnable examples for the browser preview. Excluded from source-size claims.
export const DEMO_FILES = {
  "src/Main.java": `public class Main {
    public static void main(String[] args) {
        int[] prices = {1200, 850, 600};
        int total = Pricing.total(prices);
        int payable = Pricing.withDiscount(total);
        System.out.println("Сумма заказа: " + total);
        System.out.println("К оплате: " + payable);
    }
}
`,
  "src/Pricing.java": `/** Расчёт стоимости заказа. */
public class Pricing {
    public static int total(int[] prices) {
        int result = 0;
        for (int price : prices) {
            result += price;
        }
        return result;
    }

    public static int withDiscount(int amount) {
        if (amount >= 2000) {
            return amount * 90 / 100;
        }
        return amount;
    }
}
`,
  "README.md":
    "# Магазин · пример Java-проекта\n\nОткройте Pricing.java: каждый метод станет схемой.\n\nЗаказы от 2000 получают скидку 10%.\nЗапустите Main: ожидаемая сумма 2650, к оплате 2385.\n\nСвою папку откройте через «Открыть папку»: изменения сохраняются в неё.\nЭтот пример живёт только в памяти страницы.\n",
  ".gitignore": "build/\n*.class\n",
};
