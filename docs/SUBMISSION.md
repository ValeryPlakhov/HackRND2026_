# Комплект для передачи

Актуальная версия: **Blueprints IDE 3**, только локально. Windows EXE с комплектной Java, выбором папки и чтением существующего Java-проекта в блупринтах. Конструктор без кода и инженерная Studio сохранены.

| Артефакт | Содержимое |
|---|---|
| output/desktop/Blueprints-IDE-3.exe | Один файл запуска Windows 10/11 x64 |
| output/desktop/Blueprints-IDE-3-Windows-x64.zip | Переносимая папка IDE, runtime, примеры, лицензии |
| output/desktop/SHA256SUMS.txt | Контрольные суммы релиза |
| output/Java-Blueprints-complete.zip | Авторские исходники desktop/src/web, тесты, документация, примеры, CI recipe и PDF |
| output/pdf/Java-Blueprints-solution.pdf | 16 страниц для защиты: IDE, конструктор и Java Studio |
| docs/verification-summary.json | 272 автоматических теста |
| docs/desktop-runtime-summary.json | Реальные компиляция и запуск с комплектной Java |
| docs/desktop-smoke-*.json | Запуск настоящего Electron/EXE |
| docs/ide-source-delta.json | Более 10 000 новых непустых строк продукта без зависимостей и тестов |

EXE не подписан коммерческим сертификатом. Полный отладчик JVM и автоматическая загрузка Maven/Gradle dependencies не реализованы. Другие языки — Coming soon. Пользовательские проекты не отправляются в облако.

Сборка: python tests/build_desktop.py. Исходный архив: python tests/package_solution.py. Старый удалённый Site не обновлялся. Отправка организаторам не выполнялась; упомянутый в кейсе дополнительный техдок не предоставлен.
