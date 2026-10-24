# HTTP API движка

Движок слушает `127.0.0.1` (в EXE — случайный порт, в веб-версии — 8080). Запросы `POST` с `Content-Type: application/json`, тело до 16 МБ. Заголовки Host и Origin должны указывать на localhost. Ошибки возвращаются как `{"error": "..."}` со статусом 4xx/5xx.

`files` — карта `{"путь/внутри/проекта.java": "исходник"}`, до 300 файлов. Путь состоит из сегментов `[A-Za-z0-9_$.-]`, без `..`, дисков и пустых сегментов; имя файла — Java-идентификатор с `.java`.

## Разбор и правки

| Маршрут | Поля | Результат |
|---|---|---|
| `GET /api/health` | — | Версия Java, режим запуска |
| `GET /api/capabilities` | — | Возможности и окружение |
| `POST /api/analyze` | `source` | Модель файла: классы, методы с графами и метриками, синтаксические ошибки, базовые находки |
| `POST /api/method` | `source`, `methodId` | Граф, анализ графа (достижимость, доминаторы, пути), сложность с обоснованием, def-use |
| `POST /api/edit` | `source`, `methodId`, `nodeId`, `action` (`replace`, `before`, `after`, `delete`), `code` | Новый исходник и модель; правка проверяется парсером |
| `POST /api/compile` | `files`, `mainClass?` | Результат `javac` |

## Анализ и улучшения

| Маршрут | Поля | Результат |
|---|---|---|
| `POST /api/project` | `files` | Методы, вызовы, находки (с `canOptimize`), hotspots, циклы зависимостей, ответственности, статистика |
| `GET /api/rules` | — | Каталог правил BP101–BP127 |
| `POST /api/plans` | `source` | Планы оптимизации, привязанные к `sourceHash` |
| `POST /api/plans/apply` | `source`, `sourceHash`, `planIds` | Новый исходник; устаревшие и пересекающиеся планы отклоняются |
| `POST /api/decompose` | `files`, `fileName`, `methodIds`, `className` | Все файлы проекта после переноса, путь нового класса, перенесённые и пропущенные методы с причинами |
| `POST /api/extract` | `files`, `fileName`, `methodId` | Перенос одного метода в `BlueprintFunctions` (совместимость) |
| `POST /api/sarif` | `files` | Находки в формате SARIF 2.1.0 |

## Проверка поведения

`POST /api/jobs/submit` с полем `kind` возвращает задание; его состояние читается через `GET /api/jobs/{id}`, пока оно не станет `completed`, `failed` или `cancelled`. Отмена — `POST /api/jobs/cancel {id}`. Во всех заданиях можно передать `mainClass`: полное или простое имя класса с `main`.

| `kind` | Поля | Результат |
|---|---|---|
| `compare` | `original`, `candidate`, `inputs` (1–30 stdin) | `passed`, сборки обеих версий, по каждому входу stdout/stderr/exitCode/время/хеши, хеши версий |
| `run` | `files`, `input` | Одна сборка и один запуск |
| `mutation` | `files`, `fileName`, `methodId`, `inputs`, `maximum` | Мутанты метода: убит, выжил или невалиден; score |
| `benchmark` | `original`, `candidate`, `fileName`, `methodName`, `sizes`, `repetitions` | Медианы для `static int f(int[])` до и после, совпадение результатов |
| `minimize` | `original`, `candidate`, `input`, `budget` | Уменьшенный вход, на котором версии различаются, и след шагов |

`POST /api/compare` — синхронный вариант `compare` для совместимости. `POST /api/evidence {original, candidate, jobId?}` выдаёт манифест доказательств; он помечается verified только для завершённого `compare` с совпадающими хешами исходников.

## Прочее

| Маршрут | Назначение |
|---|---|
| `POST /api/inputs/generate` | Детерминированные входы: `schema` (`int-array`, `single-int`, `text-line`), `seed`, `count`, границы |
| `GET /api/examples/{name}` | Файлы встроенного примера для веб-версии |

Полные рабочие примеры запросов — в `tests/test_api.py`, `tests/test_studio_api.py`, `tests/test_ide_api.py`.
