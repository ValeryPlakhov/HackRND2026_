# Комплект для сдачи

| Пункт брифа | Что передаётся |
|---|---|
| 01 Исходный код | Этот репозиторий. Инструкция запуска — в [README](../README.md) |
| 02 Веб-демо / воспроизводимая сборка | `Blueprints-IDE-4-Windows-x64.zip` (распаковать, запустить `BlueprintsIDE.exe`) или один файл `Blueprints-IDE-4.exe`; веб-версия из исходников: `.\start.ps1 -TrustedLocal` → `http://localhost:8080` |
| 03 Проверка поведения | `python tests/verify.py`; последний результат — [verification-summary.json](verification-summary.json) |
| 04 Описание решения | [ARCHITECTURE.md](ARCHITECTURE.md) — архитектура; [SCOPE.md](SCOPE.md) — поддержанный scope и соответствие кейсу; ограничения — в README и ARCHITECTURE |

## Сборка Windows-версии

```powershell
python tests/build_desktop.py
python tests/test_desktop_smoke.py portable
python tests/test_desktop_smoke.py single-exe
```

Скрипт скачивает официальный Electron 45 один раз и сверяет SHA-256 с опубликованным `SHASUMS256.txt`. Затем он собирает урезанный Java 21 runtime через `jlink` из локального JDK, компилирует движок и упаковывает всё в `output/desktop/`:

- `BlueprintsIDE/` — переносимая папка;
- `Blueprints-IDE-4-Windows-x64.zip` — та же папка архивом;
- `Blueprints-IDE-4.exe` — самораспаковывающийся запуск одним файлом;
- `SHA256SUMS.txt` — контрольные суммы.

Каталог `output/desktop/` не хранится в git: артефакты пересобираются этой командой.

EXE не подписан коммерческим сертификатом, поэтому Windows SmartScreen может предупредить о неизвестном издателе («Подробнее → Выполнить в любом случае»).
