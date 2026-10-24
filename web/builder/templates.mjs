import { emptyProject, literal, reference, itemId } from "./model.mjs";

const node = (id, type, config, children = {}) => ({
  id,
  type,
  config,
  ...children,
});
const input = (id, name, dataType, example) =>
  node(id, "input", { name, dataType, example });
const print = (id, text, variable = null) =>
  node(id, "print", { text, value: variable ? reference(variable) : null });

export const TEMPLATES = [
  {
    id: "hello",
    title: "Личное приветствие",
    subtitle: "Спросить имя и поздороваться",
    badge: "Для первого знакомства",
    icon: "hello",
    color: "blue",
    duration: "1 минута",
    description:
      "Самая простая программа: получает ответ и использует его в сообщении.",
    expected: "Привет, Анна",
    create() {
      return {
        ...emptyProject("Приветствие"),
        steps: [
          input("hello_name", "Как вас зовут?", "text", "Анна"),
          print("hello_result", "Привет, ", "hello_name"),
        ],
      };
    },
  },
  {
    id: "discount",
    title: "Скидка в магазине",
    subtitle: "Предложить скидку от суммы покупки",
    badge: "Условие",
    icon: "discount",
    color: "violet",
    duration: "2 минуты",
    description:
      "Если покупка от 1000 рублей, предложим скидку. Иначе подскажем, как её получить.",
    expected: "Вам доступна скидка 10%!",
    create() {
      return {
        ...emptyProject("Скидка в магазине"),
        steps: [
          input("shop_amount", "Сумма покупки, ₽", "number", "1500"),
          node(
            "shop_rule",
            "condition",
            {
              left: reference("shop_amount"),
              operator: ">=",
              right: literal(1000),
            },
            {
              yes: [print("shop_yes", "Вам доступна скидка 10%!")],
              no: [print("shop_no", "Для этой суммы скидка пока недоступна.")],
            },
          ),
        ],
      };
    },
  },
  {
    id: "sum",
    title: "Стоимость покупок",
    subtitle: "Сложить цены из списка",
    badge: "Повторение",
    icon: "basket",
    color: "peach",
    duration: "3 минуты",
    description:
      "Сохраним ноль, пройдём по всем ценам и добавим каждую к общей сумме.",
    expected: "Итого к оплате: 650",
    create() {
      const loop = node(
        "basket_loop",
        "foreach",
        { list: reference("basket_prices"), itemName: "Текущая цена" },
        { body: [] },
      );
      loop.body.push(
        node("basket_add", "change", {
          target: "basket_total",
          operator: "+",
          value: reference(itemId(loop)),
        }),
      );
      return {
        ...emptyProject("Стоимость покупок"),
        steps: [
          input("basket_prices", "Цены через пробел", "list", "100 250 300"),
          node("basket_total", "value", { name: "Итого", value: literal(0) }),
          loop,
          print("basket_answer", "Итого к оплате: ", "basket_total"),
        ],
      };
    },
  },
  {
    id: "delivery",
    title: "Доставка заказа",
    subtitle: "Рассчитать итоговую стоимость",
    badge: "Вычисление",
    icon: "delivery",
    color: "amber",
    duration: "2 минуты",
    description:
      "К стоимости заказа прибавим фиксированную доставку. Числа можно поменять в настройках блоков.",
    expected: "Заказ с доставкой: 1190",
    create() {
      return {
        ...emptyProject("Стоимость с доставкой"),
        steps: [
          input("delivery_price", "Стоимость заказа, ₽", "number", "1000"),
          node("delivery_calc", "calculate", {
            name: "С доставкой",
            left: reference("delivery_price"),
            operator: "+",
            right: literal(190),
          }),
          print("delivery_result", "Заказ с доставкой: ", "delivery_calc"),
        ],
      };
    },
  },
  {
    id: "repeat",
    title: "Три напоминания",
    subtitle: "Повторить одно действие",
    badge: "Счётчик",
    icon: "repeat",
    color: "green",
    duration: "2 минуты",
    description:
      "Вместо трёх одинаковых блоков используем повторение. На каждом шаге покажем его номер.",
    expected: "Напоминание № 1",
    create() {
      const loop = node(
        "reminder_loop",
        "repeat",
        { times: literal(3), itemName: "Номер напоминания" },
        { body: [] },
      );
      loop.body.push(print("reminder_message", "Напоминание № ", itemId(loop)));
      return { ...emptyProject("Три напоминания"), steps: [loop] };
    },
  },
];

export function templateById(id) {
  return TEMPLATES.find((item) => item.id === id);
}
export function templateAnswers(project) {
  const answers = {};
  for (const step of project.steps)
    if (step.type === "input") answers[step.id] = step.config.example ?? "";
  return answers;
}
