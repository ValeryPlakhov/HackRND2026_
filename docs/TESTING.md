# Проверка

`python tests/verify.py`: JDK 21+, Node 22+, Python 3.10+, без pip/npm-пакетов. Скрипт компилирует сервис, создаёт сервер на loopback:18080, запускает тесты и останавливает его в finally. Уже работающий сервер на 8080 не затрагивается. Два verify одновременно на одном порту не поддерживаются.

| Слой | Тестов | Что защищает |
|---|---:|---|
| Unit | 201 | Инвалидация evidence, undo/redo, stale revision, storage, diff + 300 seeded sequences, lexer/XSS, layout/graphs, поиск/команды, ZIP/CRC/paths, inputs/metrics |
| Базовые HTTP/JVM | 22 | Java scope, UTF-16, round trip, оптимизация, extraction, правки графа, compile errors, timeout/flood, stdout/stderr/exitCode/raw bytes, Origin/traversal |
| Studio HTTP/JVM | 36 | Project/calls/SCC, complexity/data flow, правила, 5 rewrites, stale/overlap, генератор, jobs/cancel, manifest/SARIF, benchmark, mutants, reducer, строгий JSON |
| Builder HTTP/JVM | 6 | 12 сгенерированных программ, ошибки компиляции/выполнения, timeout/flood, source/input hashes |
| Desktop runtime | 7 | Java-пакеты, Unicode, stdin, main, diagnostics, отмена, flood, timeout |
| **Всего** | **272** | Настоящий компилятор и JVM, без mock-runner |

Результаты: verification-summary.json, unit-test-summary.json, test-summary.json, studio-test-summary.json. Логи создаются локально, не включены в Git. NODE_BINARY позволяет выбрать путь к Node.

Отдельно: `node --test tests/unit/*.test.mjs`; при работающем сервере `python tests/test_api.py`, `python tests/test_studio_api.py`. BLUEPRINTS_URL меняет адрес сервиса. `python tests/source_audit.py` считает строки, исключает generated/deps/fixtures/docs.

prepare_studio_demo.py записывает реальные модели, методы, планы, reports, samples и среду для трёх примеров. Это генератор артефакта, не дополнительный unit test. Assert проверяет compare и сохраняющееся расхождение reducer.

Новые 33 unit-теста посвящены визуальному IR, генератору Java, типам, scope и модели исполнения. Новый Builder API запускает сгенерированные программы реальной JVM.

В браузере отдельно проверяются загрузка монолита, просмотр патча, apply + 8/8 gate, benchmark, canvas, архитектура, история, экспорт и команды. Сценарий DEMO.md и скриншоты docs/assets. Browser-действия не добавляются к числу автоматических тестов.

GitHub Actions recipe запускает тот же verify.py на Ubuntu/JDK21/Node22/Python3.12. Удалённый CI и Docker здесь не запускались. Фактические результаты относятся к Windows trusted-local + реальной JVM.

Нет заявленного процента line coverage. Mutation score относится к выбранным valid mutants, gate — к конечным stdin. Время и произвольные внешние побочные эффекты не сравниваются. Компиляционная ошибка/timeout/flood/пустая suite/несоответствующий hash не могут стать PASS.

IDE: 60 новых unit-проверок плюс 7 runtime-проверок. Отдельно: tests/test_desktop_smoke.py development / portable / single-exe. Они проверяют настоящий запуск renderer, preload IPC и Java-сервиса. Native folder picker автоматически не прокликан: эта среда не предоставляет native UI automation. Подробности: IDE-QA.md и DESKTOP.md.
