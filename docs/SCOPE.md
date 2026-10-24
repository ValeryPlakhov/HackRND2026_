# Матрица соответствия краткому брифу

IDE 3 добавляет настоящий выбор папки, вложенные проекты, вкладки, редактор и сохранение на диск. Java → блупринт использует javac AST; произвольный проект не сводится к ограниченной визуальной IR. Другие языки помечены Coming soon. Комплектная Java собирает стандартные проекты с пакетами; Maven/Gradle можно просматривать, но автоматическое разрешение зависимостей не реализовано. Подробности: DESKTOP.md.

Основной вход теперь — визуальный конструктор программ из блоков, без редактирования Java. Типизированная схема генерирует Main.java и запускает её реальной JVM. Прежняя Studio анализа существующих Java-проектов сохранена отдельно на expert.html; критерии таблицы ниже относятся к этому расширенному контуру. Новый пользовательский путь и его ограничения описаны в BUILDER.md.

| Критерий | Что демонстрировать | Проверка / граница |
|---|---|---|
| Java-монолит около 1000 строк | `LargeMonolith.java`, 1052 строки, 51 метод | Интеграционный тест 15: parse → optimize → compile → compare |
| Загрузка .java | Мультизагрузка UTF-8, файловые вкладки | Воспроизводимо в локальном интерфейсе; простые имена файлов |
| Разбор кода | Стандартный AST javac | Синтаксические ошибки с номером строки |
| Визуальная модель | Узлы методов/инструкций/условий/циклов | Структурная проекция; сложный exception flow не точный CFG |
| Двусторонняя синхронизация | Java auto-parse; узел → span edit → Java | Условие, инструкция, вставка/удаление; произвольная коммутация рёбер не поддержана |
| Пользовательские классы/интерфейсы | LanguageShowcase / Scorer / InvalidValue | Реальный javac, несколько top-level классов |
| Примитивы, обёртки, массивы | `int`, `boolean`, `double`, `Integer`, `int[]` | Компиляция и запуск showcase |
| Арифметика, логика, сравнение, cast | Showcase: `&&`, `!=`, `>=`, `(int)`, `(double)` | Тест 2 |
| if/else, switch, циклы | Граф `flow`, `countPairs` | for/foreach/while/do, switch statement и expression сохраняются |
| break/continue/return | Граф `flow` | Немеченые переходы; метки показаны непрозрачным блоком |
| Методы, конструкторы, поля, static | LanguageShowcase и все примеры | Компиляция поддерживает; граф показывает тела методов |
| try/catch/finally, throw | Showcase checked(), flow() | Граф структурный с консервативными exception edges |
| Object, String, Math, System | Showcase и PairAnalyzer | Стандартная библиотека JDK, без собственного эмулятора |
| System.in/out/err | Все тесты gate | stdout/stderr сравниваются раздельно и точно |
| Scanner, Formatter, format/printf | Showcase / PairAnalyzer | UTF-8 и кириллица проходят реальное выполнение |
| Коллекции java.util | List/Set/Map, ArrayList, LinkedList, HashSet/TreeSet, HashMap/TreeMap | Showcase выполняется на 4 входах |
| Iterable/Collection/Iterator | Showcase | Java type-check + выполнение |
| Collections/Arrays/Comparator/Optional | Showcase | Java type-check + выполнение |
| List.of/Set.of/Map.of | Showcase | Java type-check + выполнение |
| Проверяемые исключения и throws/catch | InvalidValue, IOException | javac проверяет обязательную обработку |
| Unchecked исключения | JVM поведение; неверные исходники отклоняются | Система не перехватывает пользовательские исключения в серверной JVM |
| record, enum, generics, lambda, Stream | Score, Mode, first<T>, scores | Бонусный scope компилируется и сохраняется |
| Дефекты и Big O | Диагноз с line/span, переход к графу | Правила эвристические, без ложного обещания полного статанализа |
| Оптимизация | Histogram, StringBuilder, int folding, constant branch, guard clause | Узкие AST-предикаты, source hash, overlap/stale validation, затем gate |
| Декомпозиция | Static method → helper-файл + delegate | Зависимости проверяются компиляцией; не произвольная нарезка монолита |
| Сохранение поведения | Реальные раздельные сборки и JVM | stdout + stderr + exitCode, не доказательство для всех входов |
| Исходный код и инструкция | src/, web/, README, launch scripts | Ноль библиотечных зависимостей, JDK 21 |
| Веб-демо/сборка | Localhost полная версия, Docker recipe, Sites обзор | Sites без живой JVM, честная метка; Docker не проверен здесь |
| Автотесты и результаты | tests/, docs/verification-summary.json, studio-reference-results.json | 108 unit + 22 базовых API + 36 Studio API = 166, настоящий javac/JVM |
| Архитектура, scope, ограничения | Этот файл и ARCHITECTURE.md | Полный дополнительный технический документ отсутствует |

## Расширение Studio 2

Добавлены whole-project analysis, граф вызовов и SCC, 20 дополнительных диагностик, доминаторы/достижимость/пути, lexical def/use, пять семейств hash-bound rewrite-планов, seeded inputs, mutation testing, ddmin контрпримера, inside-JVM benchmark, отменяемые jobs, SARIF, source-bound evidence manifest, история и восемь views. Big O композиционный (последовательные циклы max, вложенные multiply), с явными допущениями. Расширенный контракт см. ARCHITECTURE.md и TESTING.md.

Критерии в переданном PDF обозначены как проект: веса и финальную шкалу организаторы утверждают отдельно. Гарантии победы или получения призовых из этого не следуют.
