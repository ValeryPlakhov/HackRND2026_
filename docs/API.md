# HTTP API v2

Base http://localhost:8080/api. POST JSON, Content-Type application/json, до 2MB. files — карта {filename: source}, пути проверяются. Host/Origin ограничены localhost. Ошибки JSON/error с неуспешным HTTP-статусом. Не публичный authenticated service.

| Метод / маршрут | Поля | Результат |
|---|---|---|
| GET /health | — | Java version, runner |
| GET /capabilities | — | Features, environment |
| GET /rules | — | 20 BP101–BP120; 5 базовых выдаёт analyze |
| POST /analyze | source | Модель, методы, графы, диагностика |
| POST /project | files | Methods/calls/findings/hotspots/cycles/modules/stats/hash |
| POST /method | source, methodId | Graph, graphAnalysis, complexity, dataFlow |
| POST /edit | source, methodId, nodeId, action?, code? | action=replace (default), delete, insertBefore, insertAfter; точные примеры в test_api.py |
| POST /optimize | source, methodId | Histogram rewrite |
| POST /extract | files, fileName, methodId | Helper + delegate после compile |
| POST /compile | files | javac result |
| POST /plans | source | Hash-bound proposals |
| POST /plans/apply | source, sourceHash, planIds | Recompute + stale/overlap validation |
| POST /inputs/generate | schema, seed, count, ... | Детерминированные stdin |
| POST /mutants | source, methodId | Предложения AST-мутаций |
| POST /sarif | files | SARIF 2.1.0 |

methodId берётся из модели. Синтаксическая модель не доказывает успешный type-check проекта. Полные проверяемые payload-примеры: test_api.py, test_studio_api.py.

POST /jobs/submit возвращает id; GET /jobs/{id} до completed/failed/cancelled. GET /jobs — ограниченная история. POST /jobs/cancel {id} отменяет. completed.result содержит результат; failed.error — ошибку. История в памяти.

| kind | Дополнительные поля | Пределы |
|---|---|---|
| run | files, input | Одна компиляция + один запуск, compile/runtime status и hashes; используется конструктором |
| compare | original, candidate, inputs | До 30 stdin |
| benchmark | original, candidate, fileName, methodName, sizes, repetitions | Static int method(int[]), n≤10000, 3–9 samples |
| mutation | files, fileName, methodId, inputs, maximum | До 8 мутантов / 8 входов |
| minimize | original, candidate, input, budget | n+n int, n≤256, 2–40 попыток |

POST /compare остаётся синхронным для совместимости. Результат: passed/tests с outputs, hashes, exitCode и limit flags. v2 compare job добавляет source/input hashes и environment.

POST /evidence {original,candidate,jobId?} выдаёт manifest; verified только для завершённого compare с соответствующими source hashes. SHA-256 не подпись и не универсальное доказательство.
