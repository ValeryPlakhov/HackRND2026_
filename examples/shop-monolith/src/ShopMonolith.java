import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.function.Function;
import java.util.stream.Collectors;

/*
 * Учебный монолит интернет-магазина для Blueprints IDE.
 *
 * Программа читает команды из stdin, ведёт склад, клиентов и заказы, а в конце печатает отчёты.
 * Всё намеренно лежит в одном файле: разбор ввода, бизнес-правила, вычисления и вывод перемешаны,
 * а несколько методов написаны «как получилось» — их находит анализ IDE.
 *
 * Формат команд (по одной на строку, поля через ';'):
 *   PRODUCT sku;название;категория;цена_в_копейках;остаток
 *   CUSTOMER id;имя;уровень            (BASIC, SILVER, GOLD)
 *   ORDER номер;id_клиента;sku:кол-во,sku:кол-во
 *   PAY номер;сумма_в_копейках
 *   CANCEL номер
 *   RESTOCK sku;кол-во
 *   RETURN номер;sku;кол-во
 *   REPORT | STATS | TOP n | AUDIT
 */

interface Identifiable {
    String id();
}

interface DiscountPolicy {
    long discount(Customer customer, long subtotal);

    default String describe() {
        return getClass().getSimpleName();
    }
}

enum Category {
    ELECTRONICS(20),
    BOOKS(10),
    FOOD(10),
    CLOTHES(20),
    OTHER(20);

    final int vatPercent;

    Category(int vatPercent) {
        this.vatPercent = vatPercent;
    }

    static Category parse(String text) {
        for (Category category : values()) {
            if (category.name().equalsIgnoreCase(text.trim())) {
                return category;
            }
        }
        return OTHER;
    }
}

enum Tier {
    BASIC, SILVER, GOLD
}

enum OrderStatus {
    NEW, PAID, CANCELLED, PARTIALLY_RETURNED
}

class ShopException extends Exception {
    ShopException(String message) {
        super(message);
    }
}

class UnknownEntityException extends ShopException {
    UnknownEntityException(String kind, String id) {
        super(kind + " не найден: " + id);
    }
}

class OutOfStockException extends ShopException {
    final String sku;
    final int requested;
    final int available;

    OutOfStockException(String sku, int requested, int available) {
        super("Недостаточно товара " + sku + ": запрошено " + requested + ", доступно " + available);
        this.sku = sku;
        this.requested = requested;
        this.available = available;
    }
}

record LineTotal(String sku, int quantity, long amount) {
}

class Product implements Identifiable, Comparable<Product> {
    private final String sku;
    private final String name;
    private final Category category;
    private final long priceCents;
    private int stock;
    private int sold;

    Product(String sku, String name, Category category, long priceCents, int stock) {
        if (priceCents < 0) {
            throw new IllegalArgumentException("Цена не может быть отрицательной: " + sku);
        }
        this.sku = sku;
        this.name = name;
        this.category = category;
        this.priceCents = priceCents;
        this.stock = stock;
    }

    @Override
    public String id() {
        return sku;
    }

    String name() {
        return name;
    }

    Category category() {
        return category;
    }

    long priceCents() {
        return priceCents;
    }

    int stock() {
        return stock;
    }

    int sold() {
        return sold;
    }

    void reserve(int quantity) throws OutOfStockException {
        if (quantity > stock) {
            throw new OutOfStockException(sku, quantity, stock);
        }
        stock -= quantity;
        sold += quantity;
    }

    void release(int quantity) {
        stock += quantity;
        sold = Math.max(0, sold - quantity);
    }

    void restock(int quantity) {
        stock += quantity;
    }

    @Override
    public int compareTo(Product other) {
        return sku.compareTo(other.sku);
    }

    @Override
    public boolean equals(Object other) {
        return other instanceof Product product && product.sku.equals(sku);
    }

    @Override
    public int hashCode() {
        return sku.hashCode();
    }

    @Override
    public String toString() {
        return sku + " " + name;
    }
}

class Customer implements Identifiable {
    private final String id;
    private final String name;
    private Tier tier;
    private long spentCents;
    private final List<String> orderIds = new ArrayList<>();

    Customer(String id, String name, Tier tier) {
        this.id = id;
        this.name = name;
        this.tier = tier;
    }

    @Override
    public String id() {
        return id;
    }

    String name() {
        return name;
    }

    Tier tier() {
        return tier;
    }

    long spentCents() {
        return spentCents;
    }

    List<String> orderIds() {
        return Collections.unmodifiableList(orderIds);
    }

    void addOrder(String orderId) {
        orderIds.add(orderId);
    }

    void addSpent(long cents) {
        spentCents += cents;
        if (spentCents >= 5_000_000 && tier != Tier.GOLD) {
            tier = Tier.GOLD;
        } else if (spentCents >= 1_000_000 && tier == Tier.BASIC) {
            tier = Tier.SILVER;
        }
    }

    void refund(long cents) {
        spentCents = Math.max(0, spentCents - cents);
    }
}

class OrderLine {
    final Product product;
    int quantity;
    int returned;

    OrderLine(Product product, int quantity) {
        this.product = product;
        this.quantity = quantity;
    }

    long amount() {
        return product.priceCents() * (quantity - returned);
    }
}

class Order implements Identifiable {
    private final String id;
    private final Customer customer;
    private final List<OrderLine> lines = new ArrayList<>();
    private OrderStatus status = OrderStatus.NEW;
    private long discountCents;
    private long paidCents;

    Order(String id, Customer customer) {
        this.id = id;
        this.customer = customer;
    }

    @Override
    public String id() {
        return id;
    }

    Customer customer() {
        return customer;
    }

    List<OrderLine> lines() {
        return lines;
    }

    OrderStatus status() {
        return status;
    }

    void status(OrderStatus status) {
        this.status = status;
    }

    long discountCents() {
        return discountCents;
    }

    void discountCents(long value) {
        discountCents = value;
    }

    long paidCents() {
        return paidCents;
    }

    void pay(long cents) {
        paidCents += cents;
    }

    long subtotal() {
        long total = 0;
        for (OrderLine line : lines) {
            total += line.amount();
        }
        return total;
    }

    long total() {
        return Math.max(0, subtotal() - discountCents);
    }
}

class TierDiscount implements DiscountPolicy {
    @Override
    public long discount(Customer customer, long subtotal) {
        switch (customer.tier()) {
            case GOLD:
                return subtotal * 10 / 100;
            case SILVER:
                return subtotal * 5 / 100;
            default:
                return 0;
        }
    }
}

class VolumeDiscount implements DiscountPolicy {
    @Override
    public long discount(Customer customer, long subtotal) {
        if (subtotal >= 1_000_000) {
            return 50_000;
        }
        if (subtotal >= 300_000) {
            return 10_000;
        }
        return 0;
    }

    @Override
    public String describe() {
        return "Скидка за объём";
    }
}

public class ShopMonolith {
    static final Map<String, Product> PRODUCTS = new TreeMap<>();
    static final Map<String, Customer> CUSTOMERS = new LinkedHashMap<>();
    static final Map<String, Order> ORDERS = new LinkedHashMap<>();
    static final LinkedList<String> EVENTS = new LinkedList<>();
    static final List<DiscountPolicy> POLICIES = List.of(new TierDiscount(), new VolumeDiscount());
    static final Set<String> COMMANDS =
            Set.of("PRODUCT", "CUSTOMER", "ORDER", "PAY", "CANCEL", "RESTOCK", "RETURN", "REPORT", "STATS", "TOP", "AUDIT");
    static final Map<Tier, String> TIER_TITLES = Map.of(Tier.BASIC, "обычный", Tier.SILVER, "серебряный", Tier.GOLD, "золотой");
    static int errors = 0;
    static int processed = 0;

    public static void main(String[] args) {
        Scanner input = new Scanner(System.in, StandardCharsets.UTF_8);
        int lineNumber = 0;
        while (input.hasNextLine()) {
            String line = input.nextLine().trim();
            lineNumber++;
            if (line.isEmpty() || line.startsWith("#")) {
                continue;
            }
            if (line.equalsIgnoreCase("END")) {
                break;
            }
            try {
                execute(line);
                processed++;
            } catch (ShopException e) {
                errors++;
                System.err.println("Строка " + lineNumber + ": " + e.getMessage());
            } catch (NumberFormatException e) {
                errors++;
                System.err.println("Строка " + lineNumber + ": ожидалось число (" + e.getMessage() + ")");
            } catch (IllegalArgumentException e) {
                errors++;
                System.err.println("Строка " + lineNumber + ": " + e.getMessage());
            } finally {
                if (EVENTS.size() > 200) {
                    EVENTS.removeFirst();
                }
            }
        }
        if (processed == 0 && errors == 0) {
            System.out.println("Команд нет. Пример: PRODUCT A1;Ноутбук;ELECTRONICS;8999000;5");
            return;
        }
        printSummary();
    }

    static void execute(String line) throws ShopException {
        int space = line.indexOf(' ');
        String command = (space < 0 ? line : line.substring(0, space)).toUpperCase(Locale.ROOT);
        String rest = space < 0 ? "" : line.substring(space + 1).trim();
        if (!COMMANDS.contains(command)) {
            throw new ShopException("Неизвестная команда " + command);
        }
        String[] fields = rest.isEmpty() ? new String[0] : rest.split(";");
        switch (command) {
            case "PRODUCT" -> addProduct(fields);
            case "CUSTOMER" -> addCustomer(fields);
            case "ORDER" -> placeOrder(fields);
            case "PAY" -> pay(fields);
            case "CANCEL" -> cancel(fields);
            case "RESTOCK" -> restock(fields);
            case "RETURN" -> returnItems(fields);
            case "REPORT" -> printReport();
            case "STATS" -> printStats();
            case "TOP" -> printTop(fields.length == 0 ? 3 : Integer.parseInt(fields[0].trim()));
            case "AUDIT" -> audit();
            default -> throw new ShopException("Команда не поддерживается: " + command);
        }
    }

    static void require(String[] fields, int count, String usage) throws ShopException {
        if (fields.length < count) {
            throw new ShopException("Недостаточно полей. Формат: " + usage);
        }
    }

    static void addProduct(String[] fields) throws ShopException {
        require(fields, 5, "PRODUCT sku;название;категория;цена;остаток");
        String sku = normalizeSku(fields[0]);
        if (PRODUCTS.containsKey(sku)) {
            throw new ShopException("Товар уже существует: " + sku);
        }
        long price = Long.parseLong(fields[3].trim());
        int stock = Integer.parseInt(fields[4].trim());
        if (stock < 0) {
            throw new IllegalArgumentException("Остаток не может быть отрицательным");
        }
        Product product = new Product(sku, fields[1].trim(), Category.parse(fields[2]), price, stock);
        PRODUCTS.put(sku, product);
        log("Товар " + product + " · " + formatMoney(price) + " · остаток " + stock);
    }

    static void addCustomer(String[] fields) throws ShopException {
        require(fields, 3, "CUSTOMER id;имя;уровень");
        String id = fields[0].trim();
        Tier tier;
        try {
            tier = Tier.valueOf(fields[2].trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            tier = Tier.BASIC;
        }
        Customer customer = new Customer(id, fields[1].trim(), tier);
        CUSTOMERS.put(id, customer);
        log("Клиент " + id + " (" + TIER_TITLES.get(tier) + ")");
    }

    static void placeOrder(String[] fields) throws ShopException {
        require(fields, 3, "ORDER номер;клиент;sku:кол-во,...");
        String orderId = fields[0].trim();
        if (ORDERS.containsKey(orderId)) {
            throw new ShopException("Заказ уже существует: " + orderId);
        }
        Customer customer = findCustomer(fields[1].trim())
                .orElseThrow(() -> new UnknownEntityException("Клиент", fields[1].trim()));
        Map<String, Integer> requested = parseItems(fields[2]);
        if (requested.isEmpty()) {
            throw new ShopException("Заказ без товаров: " + orderId);
        }
        // Сначала проверяем все позиции, чтобы не зарезервировать заказ частично.
        for (Map.Entry<String, Integer> entry : requested.entrySet()) {
            Product product = PRODUCTS.get(entry.getKey());
            if (product == null) {
                throw new UnknownEntityException("Товар", entry.getKey());
            }
            if (product.stock() < entry.getValue()) {
                throw new OutOfStockException(entry.getKey(), entry.getValue(), product.stock());
            }
        }
        Order order = new Order(orderId, customer);
        for (Map.Entry<String, Integer> entry : requested.entrySet()) {
            Product product = PRODUCTS.get(entry.getKey());
            product.reserve(entry.getValue());
            order.lines().add(new OrderLine(product, entry.getValue()));
        }
        order.discountCents(bestDiscount(customer, order.subtotal()));
        ORDERS.put(orderId, order);
        customer.addOrder(orderId);
        log("Заказ " + orderId + " на " + formatMoney(order.total()));
        System.out.printf("Заказ %s принят: %d поз., к оплате %s%n", orderId, order.lines().size(), formatMoney(order.total()));
    }

    static Map<String, Integer> parseItems(String text) {
        Map<String, Integer> items = new LinkedHashMap<>();
        for (String part : text.split(",")) {
            String item = part.trim();
            if (item.isEmpty()) {
                continue;
            }
            String[] pair = item.split(":");
            String sku = normalizeSku(pair[0]);
            int quantity = pair.length > 1 ? Integer.parseInt(pair[1].trim()) : 1;
            if (quantity <= 0) {
                throw new IllegalArgumentException("Количество должно быть положительным: " + item);
            }
            items.merge(sku, quantity, Integer::sum);
        }
        return items;
    }

    static long bestDiscount(Customer customer, long subtotal) {
        long best = 0;
        for (DiscountPolicy policy : POLICIES) {
            best = Math.max(best, policy.discount(customer, subtotal));
        }
        return Math.min(best, subtotal);
    }

    static void pay(String[] fields) throws ShopException {
        require(fields, 2, "PAY номер;сумма");
        Order order = order(fields[0].trim());
        if (order.status() == OrderStatus.CANCELLED) {
            throw new ShopException("Заказ отменён: " + order.id());
        }
        long amount = Long.parseLong(fields[1].trim());
        if (amount <= 0) {
            throw new IllegalArgumentException("Сумма оплаты должна быть положительной");
        }
        order.pay(amount);
        long due = order.total() - order.paidCents();
        if (due <= 0) {
            order.status(OrderStatus.PAID);
            order.customer().addSpent(order.total());
            System.out.println("Заказ " + order.id() + " оплачен" + (due < 0 ? ", сдача " + formatMoney(-due) : ""));
        } else {
            System.out.println("Заказ " + order.id() + ": осталось оплатить " + formatMoney(due));
        }
        log("Оплата " + order.id() + " " + formatMoney(amount));
    }

    static void cancel(String[] fields) throws ShopException {
        require(fields, 1, "CANCEL номер");
        Order order = order(fields[0].trim());
        if (order.status() == OrderStatus.CANCELLED) {
            System.out.println("Заказ " + order.id() + " уже отменён");
            return;
        }
        for (OrderLine line : order.lines()) {
            line.product.release(line.quantity - line.returned);
        }
        if (order.status() == OrderStatus.PAID) {
            order.customer().refund(order.total());
        }
        order.status(OrderStatus.CANCELLED);
        System.out.println("Заказ " + order.id() + " отменён, товары возвращены на склад");
        log("Отмена " + order.id());
    }

    static void restock(String[] fields) throws ShopException {
        require(fields, 2, "RESTOCK sku;кол-во");
        Product product = product(fields[0]);
        int quantity = Integer.parseInt(fields[1].trim());
        if (quantity <= 0) {
            throw new IllegalArgumentException("Поставка должна быть положительной");
        }
        product.restock(quantity);
        log("Поставка " + product.id() + " +" + quantity);
    }

    static void returnItems(String[] fields) throws ShopException {
        require(fields, 3, "RETURN номер;sku;кол-во");
        Order order = order(fields[0].trim());
        String sku = normalizeSku(fields[1]);
        int quantity = Integer.parseInt(fields[2].trim());
        OrderLine target = null;
        for (OrderLine line : order.lines()) {
            if (line.product.id().equals(sku)) {
                target = line;
                break;
            }
        }
        if (target == null) {
            throw new UnknownEntityException("Позиция заказа", sku);
        }
        int returnable = target.quantity - target.returned;
        if (quantity > returnable) {
            throw new ShopException("Можно вернуть не больше " + returnable + " шт. " + sku);
        }
        long before = order.total();
        target.returned += quantity;
        target.product.release(quantity);
        order.discountCents(bestDiscount(order.customer(), order.subtotal()));
        long refund = before - order.total();
        if (order.status() == OrderStatus.PAID) {
            order.customer().refund(refund);
            order.status(OrderStatus.PARTIALLY_RETURNED);
        }
        System.out.println("Возврат " + quantity + " шт. " + sku + " по заказу " + order.id() + ": " + formatMoney(refund));
        log("Возврат " + order.id() + " " + sku);
    }

    static Optional<Customer> findCustomer(String id) {
        return Optional.ofNullable(CUSTOMERS.get(id));
    }

    static Order order(String id) throws UnknownEntityException {
        Order order = ORDERS.get(id);
        if (order == null) {
            throw new UnknownEntityException("Заказ", id);
        }
        return order;
    }

    static Product product(String sku) throws UnknownEntityException {
        Product product = PRODUCTS.get(normalizeSku(sku));
        if (product == null) {
            throw new UnknownEntityException("Товар", sku);
        }
        return product;
    }

    static String normalizeSku(String raw) {
        return raw.trim().toUpperCase(Locale.ROOT);
    }

    static void log(String event) {
        EVENTS.add(event);
    }

    // ---------------------------------------------------------------- отчёты

    static void printReport() {
        System.out.println("=== Склад ===");
        Map<Category, List<Product>> byCategory = new TreeMap<>();
        for (Product product : PRODUCTS.values()) {
            byCategory.computeIfAbsent(product.category(), key -> new ArrayList<>()).add(product);
        }
        for (Map.Entry<Category, List<Product>> entry : byCategory.entrySet()) {
            List<Product> products = entry.getValue();
            products.sort(Comparator.comparing(Product::name));
            System.out.println(entry.getKey() + " (НДС " + entry.getKey().vatPercent + "%):");
            for (Product product : products) {
                String flag = product.stock() == 0 ? " [нет в наличии]" : product.stock() < 3 ? " [мало]" : "";
                System.out.printf("  %-6s %-22s %12s  остаток %3d  продано %3d%s%n",
                        product.id(), product.name(), formatMoney(product.priceCents()), product.stock(), product.sold(), flag);
            }
        }
        System.out.println("=== Заказы ===");
        for (Order order : ORDERS.values()) {
            System.out.println(describeOrder(order));
        }
    }

    static String describeOrder(Order order) {
        String[] skus = new String[order.lines().size()];
        for (int i = 0; i < skus.length; i++) {
            skus[i] = order.lines().get(i).product.id() + " ";
        }
        String status = statusTitle(order.status());
        return String.format("  %-5s %-10s %-22s %12s  [%s]", order.id(), order.customer().id(), joinSkus(skus).trim(),
                formatMoney(order.total()), status);
    }

    static String statusTitle(OrderStatus status) {
        switch (status) {
            case NEW:
                return "ожидает оплаты";
            case PAID:
                return "оплачен";
            case CANCELLED:
                return "отменён";
            case PARTIALLY_RETURNED:
                return "частичный возврат";
        }
        return status.name();
    }

    static String joinSkus(String[] skus) {
        String result = "";
        for (String sku : skus) {
            result += sku;
        }
        return result;
    }

    static void printStats() {
        System.out.println("=== Статистика ===");
        long revenue = 0;
        int paidOrders = 0;
        int cancelled = 0;
        List<Integer> quantities = new ArrayList<>();
        for (Order order : ORDERS.values()) {
            if (order.status() == OrderStatus.CANCELLED) {
                cancelled++;
                continue;
            }
            if (order.status() == OrderStatus.PAID || order.status() == OrderStatus.PARTIALLY_RETURNED) {
                revenue += order.total();
                paidOrders++;
            }
            for (OrderLine line : order.lines()) {
                quantities.add(line.quantity - line.returned);
            }
        }
        int[] values = new int[quantities.size()];
        for (int i = 0; i < values.length; i++) {
            values[i] = quantities.get(i);
        }
        long average = paidOrders == 0 ? 0 : revenue / paidOrders;
        System.out.println("Выручка: " + formatMoney(revenue));
        System.out.println("Оплаченных заказов: " + paidOrders + ", отменённых: " + cancelled);
        System.out.println("Средний чек: " + formatMoney(average));
        System.out.println("Пар позиций с одинаковым количеством: " + countRepeatedQuantities(values));
        System.out.println("Медиана количества: " + median(values));
        System.out.println("Уникальных покупателей: " + countDistinctBuyers());
        System.out.println("Товаров на исходе: " + lowStock(3).size());
        int secondsPerDay = 24 * 60 * 60;
        System.out.println("Событий в журнале: " + EVENTS.size() + " (окно хранения " + secondsPerDay + " с)");
    }

    static int countRepeatedQuantities(int[] values) {
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

    static double median(int[] values) {
        if (values.length == 0) {
            return 0;
        }
        int[] copy = Arrays.copyOf(values, values.length);
        Arrays.sort(copy);
        int middle = copy.length / 2;
        if (copy.length % 2 == 1) {
            return copy[middle];
        } else {
            return (copy[middle - 1] + copy[middle]) / 2.0;
        }
    }

    static int countDistinctBuyers() {
        List<String> buyers = new ArrayList<>();
        for (Order order : ORDERS.values()) {
            if (order.status() == OrderStatus.CANCELLED) {
                continue;
            }
            String id = order.customer().id();
            if (!buyers.contains(id)) {
                buyers.add(id);
            }
        }
        return buyers.size();
    }

    static List<Product> lowStock(int threshold) {
        List<Product> result = new ArrayList<>();
        for (Product product : PRODUCTS.values()) {
            if (product.stock() < threshold) {
                result.add(product);
            }
        }
        return result;
    }

    static void printTop(int limit) {
        if (limit <= 0) {
            throw new IllegalArgumentException("TOP: укажите положительное число");
        }
        System.out.println("=== Топ-" + limit + " товаров по продажам ===");
        List<Product> ranked = new ArrayList<>(PRODUCTS.values());
        ranked.sort(Comparator.comparingInt(Product::sold).reversed().thenComparing(Comparator.naturalOrder()));
        int position = 0;
        for (Product product : ranked) {
            if (product.sold() == 0) {
                break;
            }
            position++;
            System.out.printf("%d. %s — %d шт., %s%n", position, product.name(), product.sold(),
                    formatMoney(product.sold() * product.priceCents()));
            if (position == limit) {
                break;
            }
        }
        if (position == 0) {
            System.out.println("Продаж пока нет");
        }
        Map<String, Long> byCustomer = ORDERS.values().stream()
                .filter(order -> order.status() != OrderStatus.CANCELLED)
                .collect(Collectors.groupingBy(order -> order.customer().name(), TreeMap::new,
                        Collectors.summingLong(Order::total)));
        byCustomer.entrySet().stream()
                .sorted(Map.Entry.<String, Long>comparingByValue().reversed().thenComparing(Map.Entry.comparingByKey()))
                .limit(limit)
                .forEach(entry -> System.out.println("   покупатель " + entry.getKey() + ": " + formatMoney(entry.getValue())));
    }

    static void audit() {
        System.out.println("=== Аудит ===");
        int problems = 0;
        Iterator<Order> iterator = ORDERS.values().iterator();
        while (iterator.hasNext()) {
            Order order = iterator.next();
            if (order.status() == OrderStatus.NEW && order.paidCents() > 0) {
                System.out.println("Заказ " + order.id() + " оплачен частично: " + formatMoney(order.paidCents()));
                problems++;
            }
            for (OrderLine line : order.lines()) {
                if (line.returned > line.quantity) {
                    System.out.println("Заказ " + order.id() + ": возвращено больше, чем куплено");
                    problems++;
                }
            }
        }
        Set<String> sortedSkus = new TreeSet<>(PRODUCTS.keySet());
        Set<String> sold = new HashSet<>();
        for (Order order : ORDERS.values()) {
            for (OrderLine line : order.lines()) {
                sold.add(line.product.id());
            }
        }
        List<String> neverSold = new ArrayList<>();
        for (String sku : sortedSkus) {
            if (!sold.contains(sku)) {
                neverSold.add(sku);
            }
        }
        if (false) {
            System.err.println("DEBUG audit: " + neverSold);
        }
        System.out.println("Не продавались: " + (neverSold.isEmpty() ? "—" : String.join(", ", neverSold)));
        for (Customer customer : CUSTOMERS.values()) {
            String grade = customer.spentCents() > 5_000_000 ? "VIP" : customer.spentCents() > 1_000_000 ? "постоянный" : "новый";
            System.out.printf("Клиент %-8s %-12s %-10s заказов %d, потрачено %s%n", customer.id(), customer.name(),
                    TIER_TITLES.get(customer.tier()), customer.orderIds().size(), formatMoney(customer.spentCents()) + " · " + grade);
        }
        System.out.println(problems == 0 ? "Нарушений не найдено" : "Нарушений: " + problems);
    }

    static void printSummary() {
        System.out.println("=== Итог ===");
        System.out.println("Обработано команд: " + processed + ", ошибок: " + errors);
        Formatter formatter = new Formatter(new StringBuilder(), Locale.ROOT);
        formatter.format("Товаров: %d, клиентов: %d, заказов: %d", PRODUCTS.size(), CUSTOMERS.size(), ORDERS.size());
        System.out.println(formatter);
        formatter.close();
        Map<OrderStatus, Long> statuses = new EnumMap<>(OrderStatus.class);
        for (Order order : ORDERS.values()) {
            statuses.merge(order.status(), 1L, Long::sum);
        }
        statuses.forEach((status, count) -> System.out.println("  " + statusTitle(status) + ": " + count));
        Function<Long, String> money = ShopMonolith::formatMoney;
        long stockValue = PRODUCTS.values().stream().mapToLong(product -> product.priceCents() * product.stock()).sum();
        System.out.println("Стоимость склада: " + money.apply(stockValue));
        System.out.println("Последнее событие: " + (EVENTS.isEmpty() ? "—" : EVENTS.getLast()));
        try {
            System.out.println("Контрольная сумма: " + checksum());
        } catch (IOException e) {
            System.err.println("Контрольная сумма недоступна: " + e.getMessage());
        }
    }

    static long checksum() throws IOException {
        if (ORDERS.size() > 10_000) {
            throw new IOException("слишком много заказов для контрольной суммы");
        }
        long hash = 17;
        for (Order order : ORDERS.values()) {
            hash = hash * 31 + order.id().hashCode();
            hash = hash * 31 + order.total();
            hash = hash * 31 + order.status().ordinal();
        }
        return Math.abs(hash % 1_000_000_007L);
    }

    static String formatMoney(long cents) {
        long rubles = Math.abs(cents) / 100;
        long kopecks = Math.abs(cents) % 100;
        String sign = cents < 0 ? "-" : "";
        return String.format(Locale.ROOT, "%s%,d.%02d ₽", sign, rubles, kopecks).replace(',', ' ');
    }
}
