# Соответствие кейсу

Матрица сопоставляет требования брифа с тем, что делает Blueprints IDE 4, и с местом, где это проверяется. Все проверки выполняются настоящим `javac` и отдельными JVM; ссылки на тесты ведут в `tests/`.

## Пользовательский путь

| Требование | Реализация | Где проверяется |
|---|---|---|
| Монолит ≈1000 строк | `examples/shop-monolith` — 878 строк, 79 методов, 15 типов в одном файле; `examples/large-monolith` — 1052 строки, 51 метод | `test_ide_api.py` 04–07, 16; `test_api.py` 15 |
| Загрузить `.java` | Открытие папки проекта (пакеты, вложенные каталоги, до 300 файлов) или встроенного примера | `test_ide_api.py` 01–03, 11 |
| Разобрать код | `JavacTask.parse` + позиции UTF-16 для точных правок | `test_api.py` 01 |
| Построить граф | Блупринт метода: entry/exit, инструкции, if, switch, циклы, try/catch/finally, return/break/continue/throw | `test_api.py` 02, `layout.test.mjs` |
| Исследовать и править, синхронизация в обе стороны | Код → блупринт: автоматический разбор после паузы. Блупринт → код: изменить, вставить до/после, удалить блок; правка проверяется парсером и попадает в редактор | `test_api.py` 19, `ide.test.mjs` |
| Собрать Java | Обычные `.java` в папке проекта, Ctrl+S, история версий, запуск F5 | `test_ide_api.py` |
| Запустить и сравнить | Эталон (снимок при открытии или зафиксированный вручную) против текущей версии: stdout, stderr без номеров строк стека, код завершения | `test_ide_api.py` 05, 06, 09, 10, 12, 14, 16; `test_api.py` 16, 21 |

## Диагностика дефектов и Big O

| Что видит пользователь | Реализация |
|---|---|
| Строка кода и узел графа | Клик по находке открывает файл в режиме «Вместе», выбирает метод и центрирует помеченный блок |
| Объяснение проблемы | 31 правило: 5 базовых (вложенные циклы, накопление строки, `==` для строк, пустой catch, длинный метод) и 26 из каталога BP101–BP127: поиск в списке внутри цикла, `get(i)` у LinkedList, сортировка в цикле, `remove(0)` у ArrayList, `==` для обёрток, return из finally и другие |
| Оценка сложности | Big O каждого метода: последовательные участки — максимум, вложенные циклы — произведение, литеральные границы — константа. «Почему O(n²)» показывает строки-источники и допущения |
| Вариант исправления с эффектом | У находок с автоулучшением есть кнопка «Показать улучшение»: план с diff, O(до) → O(после), памятью и условиями применимости |

Диагноз проверяемый: применённое исправление сразу проходит проверку поведения.

## Оптимизация и декомпозиция

| Требование | Реализация |
|---|---|
| Оптимизация | 7 AST-преобразований: `histogram-pairs` (O(n²) → O(n)), `contains-to-set` (O(n·m) → O(n+m)), `dedupe-set` (O(n²) → O(n)), `string-builder` (O(total²) → O(total)), `integer-fold`, `constant-branch`, `guard-clause`. Каждое привязано к хешу исходника и отклоняется, если код изменился или изменения пересекаются |
| Автоматически выделить ответственности | Анализ группирует методы по ответственности: ввод, вывод, вычисления, проверки, вспомогательное. «Выделить» переносит группу в новый класс рядом с монолитом; в монолите остаются делегаты |
| Quality gate | После переноса `javac` собирает проект. Методы, которые не собираются, остаются на месте с объяснением. Затем запускается проверка поведения |

Пример: монолит магазина раскладывается на `ShopReports`, `ShopCalculations`, `ShopRules`, `ShopSupport`, монолит сокращается с 878 до ~510 строк, проверка проходит на всех 6 входах (`test_ide_api.py` 06).

## Обязательная поддержка Java

Примеры компилируются и выполняются на тестах в `test_ide_api.py` 12. Для каждого пункта указан файл, где он встречается.

| Раздел брифа | Конструкции | Пример |
|---|---|---|
| 1. Язык и `java.lang` | Классы, интерфейсы (с default-методом), наследование | shop: `Identifiable`, `DiscountPolicy`, `ShopException` → `OutOfStockException` |
| | Примитивы, обёртки, массивы | shop: `int`, `long`, `double`, `Integer`, `Long`, `int[]`, `String[]`; showcase: `boolean`, `Integer` |
| | Арифметика, логика, сравнение, приведение | shop: `%`, `/`, `&&`, `||`, тернарный оператор; showcase: `(int)`, `(double)` |
| | if/else, switch, циклы, break/continue/return | shop: switch с метками `case:` и со стрелками `->`, for, for-each, while; showcase: do-while и switch-выражение |
| | Методы, конструкторы, поля, static | shop: везде |
| | try/catch/finally, throw | shop: `main`, `addCustomer`, `printSummary` |
| | Object, String, Math, System | shop: переопределены `equals`/`hashCode`/`toString`, `Math.max/min/abs`, `String.join/format` |
| 2. Консольный ввод-вывод | System.in/out/err, Scanner, Formatter, String.format, printf, StandardCharsets и кириллица | shop: `main`, `printReport`, `printSummary`, `formatMoney` |
| 3. Коллекции `java.util` | Collection, Iterable, List, Set, Map, ArrayList, LinkedList, HashSet, TreeSet, HashMap/LinkedHashMap, TreeMap, EnumMap | shop + showcase |
| | Iterator, Collections, Arrays, Comparator, Optional | shop: `audit`, `Customer.orderIds`, `median`, `printTop`, `findCustomer` |
| | List.of, Set.of, Map.of | shop: `POLICIES`, `COMMANDS`, `TIER_TITLES` |
| 4. Исключения | Проверяемые и непроверяемые, throws и обязательный catch, собственные через наследование | shop: `ShopException`, `UnknownEntityException`, `OutOfStockException`, `IOException` в `checksum`, `IllegalArgumentException`, `NumberFormatException` |

### Бонусный уровень

| Возможность | Пример |
|---|---|
| record, enum | shop: `LineTotal`, `Category` с полем и конструктором, `Tier`, `OrderStatus` |
| Дженерики | shop: `Map<Category, List<Product>>`, `Function<Long, String>`; showcase: `static <T> Optional<T> first(List<T>)` |
| Лямбды и `java.util.function` | shop: `Comparator.comparing`, `Function`, `computeIfAbsent`, ссылки на методы |
| Stream API и Collectors | shop: `printTop` (`groupingBy`, `summingLong`, `sorted`, `limit`), `printSummary` |

Вне рамок брифа и не заявляется: многопоточность, рефлексия, файловый ввод-вывод, сеть, `java.time`. Такой код открывается и анализируется, но блупринт показывает только структуру.

## Сдача решения

| Пункт брифа | Где |
|---|---|
| 01 Исходный код | Репозиторий: `src/` (движок на Java), `web/` (интерфейс IDE), инструкция запуска в README |
| 02 Веб-демо | Воспроизводимая сборка: `start.ps1 -TrustedLocal` → `http://localhost:8080`; `docker compose up --build` |
| 03 Проверка поведения | `python tests/verify.py`, результат в `docs/verification-summary.json` |
| 04 Описание решения | README, [ARCHITECTURE.md](ARCHITECTURE.md), этот файл, [DEMO.md](DEMO.md) |
