# Настольная Blueprints IDE

## Поставка

`Blueprints-IDE-3.exe` — самораспаковывающийся Windows x64 файл. При первом запуске распаковывает комплект в `%LOCALAPPDATA%/BlueprintsIDE/portable/3.0.0-<payload-hash>`, затем открывает IDE. Повторный запуск использует кэш. Установки в Program Files, автозапуска, телеметрии и автоматических обновлений нет. Настройки и история хранятся в пользовательских данных приложения. Проекты остаются в выбранных папках.

ZIP содержит `BlueprintsIDE.exe`, Chromium/Electron, Java 21, frontend и Java-сервис. Его нужно распаковать целиком. EXE не имеет коммерческой подписи. SHA-256 готовых файлов находится рядом с ними. Сборка предназначена для Windows 10/11 x64; проверена в текущей Windows-среде, не на каждой конфигурации компьютера.

## Существующий проект → блупринт

1. **Открыть папку** вызывает системный folder picker.
2. Сервис получает канонический корень и выдаёт случайный идентификатор workspace. Renderer передаёт этот идентификатор и относительные пути.
3. Дерево раскрывается по запросу. Общий индекс — до 10 000 файлов, глубина — 32. Build outputs, `.git` и зависимости исключаются.
4. Java-файл читается как UTF-8. Редактор хранит логические LF; на диске сохраняет выбранные LF/CRLF и UTF-8 BOM.
5. Исходник отправляется локальному javac parser. AST использует UTF-16 диапазоны, как JavaScript.
6. Каждый метод получает структурный граф. Пакеты, классы и исходники остаются обычной Java; проект не преобразуется в ограниченную модель начинающего конструктора.

`pom.xml` и Gradle распознаются как метаданные. Скрипты не выполняются автоматически, зависимости не загружаются. Лексический обзор classes/main используется для навигации и не заменяет разрешение символов Java.

## Сохранение

При чтении вычисляется SHA-256 исходных байтов. Сохранение требует совпадения `expectedHash`. Запись идёт во временный файл в той же папке, с flush и rename; перед заменой выполняется повторная проверка. Это уменьшает риск потери изменений, но не является общей транзакцией с другими редакторами.

Watcher перечитывает чистые вкладки; для изменённых показывает предупреждение и diff. **Принять с диска** заменяет редактор внешней версией. **Оставить мою** обновляет базу конфликта: сохранение остаётся явным действием. После внешнего удаления текст остаётся для экспорта.

История хранит до 20 предыдущих версий каждого файла, до 2 МиБ на версию. Восстановление меняет редактор; запись на диск выполняется через Ctrl+S. История не заменяет Git и резервное копирование.

Массовая замена показывает diff и связывает каждый файл с хешем. Применение последовательное: при конфликте останавливается и сообщает число уже сохранённых файлов. Общей атомарной транзакции на весь проект нет.

## Реальная Java

F5 сохраняет открытые изменённые вкладки. Сервис создаёт временный snapshot Java-исходников и запускает комплектный `javac --release 21 -proc:none`. Папка проекта не получает `.class`. Отдельная JVM запускает main с cwd исходного проекта и заданным stdin.

Если main несколько, укажите полное имя в **Параметрах запуска**, например `com.example.Main`. Обзор предлагает найденные entry points. Обнаружение main — эвристика; необычную форму объявления можно указать вручную.

| Ограничение | Значение |
|---|---:|
| Одновременных задач IDE | 1 |
| Java-файлов для сборки | 300 |
| Исходников | 8 МиБ |
| Компиляция | 30 с, heap 384 МиБ |
| Выполнение | 10 с, heap 128 МиБ |
| stdout + stderr | 256 КиБ |
| stdin | 32 768 символов |
| История задач | 30 |

Потоки UTF-8 сохраняют незавершённые многобайтовые символы между chunks. Ошибки javac превращаются в переходы к файлу и строке. Отмена завершает активный процесс JVM. После правки прошлый вывод помечается устаревшим. Лимиты не являются sandbox: код может обращаться к файлам и сети с правами пользователя.

## Устройство

```text
Windows launcher
  └─ Electron main
       ├─ folder dialog / rooted filesystem / history / tasks
       ├─ Java HTTP service · случайный loopback-порт
       └─ sandboxed renderer
            ├─ Java editor + blueprint canvas
            └─ narrow contextBridge
```

Node integration выключен; context isolation, sandbox и web security включены. IPC проверяет отправителя, главный frame, origin и `/ide.html`. Мост не предоставляет произвольные fs/exec/ipcRenderer. Пути проверяются на traversal, Windows device names, NTFS streams и symlinks. Git работает без shell, только для чтения; внешние diff drivers отключены.

Запросы разрешений и новые окна блокируются. Конструктор и Studio открываются отдельными окнами без Node и preload. Java проверяет Host и Origin и слушает 127.0.0.1. При закрытии IDE сервис завершается. Текст в открытом README или исходнике является данными, не инструкциями приложения.

Упаковка: [официальная manual distribution Electron](https://www.electronjs.org/docs/latest/tutorial/application-distribution). Renderer: [официальные рекомендации Electron](https://www.electronjs.org/docs/latest/tutorial/security). Версия и upstream SHA-256 фиксируются в `electron-runtime.json`.

## Сборка и проверка

```powershell
python tests/download_electron.py
python tests/build_desktop.py
python tests/test_desktop_smoke.py development
python tests/test_desktop_smoke.py portable
python tests/test_desktop_smoke.py single-exe
```

Нужны Windows x64, Python 3.11+, JDK 21 в `.runtime/jdk-*` и системный .NET Framework compiler. jlink создаёт `.runtime/desktop-java`. Официальный Electron сверяется с upstream SHASUMS256. Java компилируется заново; копируются authored code, frontend, classes и runtime, сохраняются лицензии, ZIP проверяется, затем C# launcher получает embedded payload. Публикации нет.

Smoke-тест запускает настоящий EXE со скрытым окном и ждёт подтверждения renderer через preload IPC после подключения Java. Runtime-тесты отдельно проверяют Java-пакеты, Unicode-пути, stdin, diagnostics, выбор main, отмену, flood и timeout. Системный folder picker автоматически не прокликан: native UI automation в этой среде недоступна; его вызов Electron и rooted workspace-сервис проверены отдельно.

## Исходники

```text
desktop/main.cjs                  окна, меню, IPC, жизненный цикл
desktop/preload.cjs               узкий мост
desktop/services/workspace.cjs    корень, файлы, дерево, watcher
desktop/services/persistence.cjs  настройки, сессии, история
desktop/services/tasks.cjs        snapshot, javac, java, limits
desktop/services/search.cjs       поиск и replace preview
desktop/services/git.cjs          чтение Git
desktop/services/backend.cjs      JVM и loopback service
desktop/services/project-info.cjs навигационный индекс
desktop/Launcher.cs              single-file launcher
web/ide/                         документы, редактор, canvas, UI
```

Новые файлы IDE считаются отдельно в `ide-source-delta.json`. Electron, Java runtime, сборка, JSON, примеры и копии исключены. Физические и непустые строки включают комментарии; размер кода не является метрикой качества.
