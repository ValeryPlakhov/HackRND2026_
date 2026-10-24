"""Cyrillic vector handout, based only on verified local reports. ReportLab authoring tool."""
from pathlib import Path
import json
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor
from reportlab.lib.utils import simpleSplit, ImageReader

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/pdf'
OUT.mkdir(parents=True, exist_ok=True)
for name, filename in [('UI', 'segoeui.ttf'), ('Bold', 'seguisb.ttf'), ('Code', 'consola.ttf')]:
    pdfmetrics.registerFont(TTFont(name, str(Path('C:/Windows/Fonts') / filename)))
summary = json.loads((ROOT / 'docs/verification-summary.json').read_text())
audit = json.loads((ROOT / 'docs/source-audit.json').read_text())
reference = json.loads((ROOT / 'docs/studio-reference-results.json').read_text())
assert summary['passed'] and all(result['passed'] for result in reference.values())
W, H = 1280, 720
BG, PANEL, BORDER = '#0c1119', '#151c27', '#303b4c'
TEXT, MUTED, LIME, VIOLET = '#eef2e7', '#a4afc0', '#b6f36d', '#b5a6f5'
pdf = canvas.Canvas(str(OUT / 'Java-Blueprints-solution.pdf'), pagesize=(W, H))
pdf.setTitle('Blueprints IDE 3 - Java, которую видно')
pdf.setAuthor('Java Blueprints Studio')
page = 0

def text(x, y, value, size=18, color=None, font='UI'):
    pdf.setFillColor(HexColor(color or TEXT))
    pdf.setFont(font, size)
    pdf.drawString(x, H-y, str(value))

def paragraph(x, y, value, width, size=17, color=None, font='UI', leading=None):
    for row in simpleSplit(str(value), font, size, width):
        text(x, y, row, size, color or MUTED, font)
        y += leading or size * 1.55
    return y

def box(x, y, width, height, fill=None, stroke=None):
    pdf.setFillColor(HexColor(fill or PANEL))
    pdf.setStrokeColor(HexColor(stroke or BORDER))
    pdf.roundRect(x, H-y-height, width, height, 12, fill=1, stroke=1)

def start(kicker, title, subtitle=''):
    global page
    page += 1
    pdf.setFillColor(HexColor(BG))
    pdf.rect(0, 0, W, H, fill=1, stroke=0)
    text(56, 42, 'blueprints / IDE 3', 13, LIME, 'Bold')
    text(991, 42, 'AXENIX / JAVA CASE', 11, MUTED)
    text(56, 96, kicker, 11, VIOLET, 'Bold')
    text(56, 149, title, 35, TEXT, 'Bold')
    paragraph(58, 187, subtitle, 1150, 17)
    pdf.setStrokeColor(HexColor(BORDER))
    pdf.line(56, 50, 1224, 50)
    text(56, 696, 'UNDERSTAND / REFACTOR / VERIFY     -     JDK 21 / UTF-8 / REAL JVM', 10, MUTED)
    text(1152, 696, f'{page:02d} / 16', 10, MUTED)

def end():
    pdf.showPage()

def card(x, y, title, detail, width=565, height=157):
    box(x, y, width, height)
    text(x+24, y+40, title, 21, TEXT, 'Bold')
    bottom = paragraph(x+24, y+77, detail, width-48, 16)
    assert bottom <= y+height+5, (title, bottom)

def code(x, y, source, size=17):
    for row in source.splitlines():
        text(x, y, row, size, '#c5d8f3', 'Code')
        y += size*1.6

engineering_colors = BG, PANEL, BORDER, TEXT, MUTED, LIME, VIOLET
BG, PANEL, BORDER = '#f6f8fc', '#ffffff', '#dce4ef'
TEXT, MUTED, LIME, VIOLET = '#25314a', '#73809a', '#3767df', '#5d7cab'
start('DESKTOP IDE / WINDOWS X64', 'Ваш Java-проект. В блупринтах.', 'Один EXE с Java runtime. Нативный выбор папки, привычный редактор и визуальная логика существующего проекта.')
text(58, 292, 'Открыть папку. Понять. Изменить. Запустить.', 31, LIME, 'Bold')
paragraph(58, 347, 'Пакеты и вложенные папки остаются обычной Java. javac строит методы и граф; правки блоков возвращаются в исходник. История и проверка хеша защищают сохранение.', 1100, 22)
for x, title, body in [(58, '01 / Папка проекта', 'Windows folder picker, дерево, вкладки и недавние проекты.'), (454, '02 / Java + блупринт', 'Методы, объяснения блоков, подсветка кода и переход к строке.'), (850, '03 / Реальная JVM', 'Комплектная Java 21, main, stdin, ошибки и остановка.')]:
    card(x, 476, title, body, 372, 150)
end()
start('DESKTOP IDE / ПРОВЕРЕННЫЙ СЦЕНАРИЙ', 'Правка блока меняет настоящую программу.', 'Неверный синтаксис отклонён. Порог скидки изменён с 2000 на 3000: реальный запуск возвращает 2650 вместо 2385.')
image = ImageReader(str(ROOT / 'docs/assets/ide-run.png'))
pdf.drawImage(image, 58, 78, width=1164, height=430, preserveAspectRatio=True, anchor='c')
paragraph(58, 657, 'Windows 10/11 x64. Другие языки: Coming soon. Maven/Gradle открываются; зависимости не загружаются автоматически.', 1160, 13)
end()
BG, PANEL, BORDER = '#f7f9f5', '#ffffff', '#dce6d7'
TEXT, MUTED, LIME, VIOLET = '#263a31', '#75816d', '#27664c', '#658c59'
start('VISUAL BUILDER / ОСНОВНОЙ СЦЕНАРИЙ', 'Программы из понятных блоков.', 'Человек выражает логику задачи. Java создаётся автоматически, а результат проверяется настоящей JVM.')
text(58, 294, 'Собрать. Настроить. Попробовать.', 34, LIME, 'Bold')
paragraph(58, 345, 'Шесть основных действий, обычные поля и ветки «Да / Нет». Код и инженерные метрики открываются отдельно и не нужны для первого запуска.', 1080, 23)
for x, title, body in [(58, '01 / Выбрать задачу', 'Приветствие, скидка, доставка, список покупок или чистый лист.'), (454, '02 / Собрать схему', 'Блоки, условия и повторы. Плюс добавляет шаг в нужное место.'), (850, '03 / Получить ответ', 'Понятная форма, реальная Java и пошаговое объяснение модели.')]:
    card(x, 470, title, body, 372, 160)
end()
start('VISUAL BUILDER / ИНТЕРФЕЙС', 'Сначала задача. Код - по желанию.', 'Главная страница теперь открывает конструктор. Прежние инструменты анализа остаются в расширенной Studio.')
image = ImageReader(str(ROOT / 'docs/assets/builder-overview.png'))
pdf.drawImage(image, 58, 78, width=1164, height=426, preserveAspectRatio=True, anchor='c')
text(58, 642, 'Типизированная схема -> проверка ссылок и scope -> Main.java -> javac + JVM.', 17, LIME, 'Bold')
end()
BG, PANEL, BORDER, TEXT, MUTED, LIME, VIOLET = engineering_colors

start('ENGINEERING / 01', 'Java. Видеть. Менять. Проверять.', 'Расширенная Studio для Java-монолита: связанная модель, объяснимый патч и проверяемый результат.')
text(58, 297, 'Изменение должно выдержать проверку.', 33, LIME, 'Bold')
paragraph(58, 346, 'Настоящий javac AST связывает код и граф. Отдельные JVM проверяют обе версии. Лаборатории помогают оценить скорость, силу тестов и причину расхождения.', 1050, 23)
for x, value, label in [(58, str(audit['product']['nonempty']), 'непустых строк продукта'), (454, str(summary['tests']), 'автоматических тестов / PASS'), (850, '0', 'сторонних библиотек Java-ядра')]:
    box(x, 492, 372, 125)
    text(x+24, 548, value, 39, LIME, 'Bold')
    text(x+24, 585, label, 15, MUTED)
end()

start('02 / WORKSPACE', 'Инструмент для review и живой защиты.', 'Скриншот локальной Studio после настоящего применения плана и запуска монолита на восьми входах.')
image = ImageReader(str(ROOT / 'docs/assets/quality-gate.png'))
pdf.drawImage(image, 320, H-630, width=595, height=420, preserveAspectRatio=True, anchor='c')
text(58, 301, '8 связанных экранов', 22, LIME, 'Bold')
paragraph(58, 343, 'Source + canvas\nDiff и планы\nTest Lab\nАрхитектура\nМетрики\nИстория\nРежим защиты', 238, 17)
paragraph(952, 307, 'Проверенный результат относится к хешам baseline/candidate. После правки он становится устаревшим.', 270, 20)
paragraph(952, 483, 'Тема, навигация, minimap, checkpoints и Ctrl+K - часть рабочего процесса.', 270, 17)
end()

start('03 / ARCHITECTURE', 'Один источник истины - Java-текст.', 'Граф не интерпретирует Java самостоятельно. Смысл программы задают стандартный компилятор и JVM.')
for x, title, body in [(58, '01 / javac AST', 'UTF-16 source spans; методы, инструкции и контрольный поток.'), (454, '02 / Analysis + plans', 'CFG, вызовы, данные, 25 правил, diff и source-bound предложения.'), (850, '03 / Runner + evidence', 'Раздельные сборки, отдельные JVM, raw byte compare и manifest.')]:
    card(x, 280, title, body, 372, 205)
box(58, 535, 1164, 90)
paragraph(82, 572, 'Span edit -> новый исходник -> повторный AST. Нетронутые символы и комментарии сохраняются. Планы проверяются сервером заново; stale hash и overlap отклоняются.', 1110, 18)
end()

start('04 / REFACTOR PLANS', 'Сначала обоснование. Затем изменение.', 'Пять узких семейств преобразований с диапазонами, before/after, source hash и обязательным gate.')
cards = [('Histogram pairs', 'Двойной чистый обход int[] -> индекс частот. Среднее O(n), память O(k).'), ('StringBuilder', 'Поддерживаемый String(String[]) accumulator -> builder; null сохраняется как текст.'), ('Int folding / constant branch', 'Int overflow и shifts сохраняются; деление на ноль не сворачивается.'), ('Guard clause', 'Поддерживаемый terminal return/throw убирает else, сохраняя блоки scope.')]
for i, (title, body) in enumerate(cards):
    card(58+(i%2)*599, 265+(i//2)*180, title, body)
text(59, 647, 'Static extraction отдельно: независимый метод -> helper + delegate с проверкой компиляции.', 16, LIME)
end()

start('05 / THE OPTIMIZATION', 'Вложенный поиск превращается в индекс.', 'Чистый шаблон считает упорядоченные равные пары, включая самопары. Для частоты f получается f * f.')
box(58, 268, 550, 280)
text(82, 309, 'BEFORE / O(n²)', 16, VIOLET, 'Bold')
code(82, 354, 'int matches = 0;\nfor (int a : values) {\n  for (int b : values) {\n    if (a == b) matches++;\n  }\n}\nreturn matches;', 17)
box(637, 268, 585, 280)
text(661, 309, 'AFTER / O(n), EXPECTED', 16, LIME, 'Bold')
code(661, 354, 'Map<Integer,Integer> f = new HashMap<>();\nfor (int x : values)\n  f.merge(x, 1, Integer::sum);\nint result = 0;\nfor (int n : f.values()) result += n*n;\nreturn result;', 16)
paragraph(58, 597, 'Сохраняется int overflow; меняется расход памяти. OutOfMemoryError не гарантирован одинаковым. Наличие побочных эффектов отклоняет точный шаблон.', 1150, 18)
end()

start('06 / TEST LAB', 'Проверяем изменение и сами тесты.', 'Длинные операции выполняются как ограниченные задачи: стадии, результат, отмена и защита от поздних ответов.')
for i, (title, body) in enumerate([('Differential gate', 'Две сборки и JVM. Raw stdout + stderr + exitCode. Timeout/flood всегда FAIL.'), ('Mutation testing', 'AST-операторы меняются, варианты компилируются. Killed / survived / invalid.'), ('Counterexample reduction', 'Бюджетный ddmin для n+n int; финальный вход повторно подтверждает расхождение.'), ('Seeded input generation', 'Границы, повторы, случайные и сортированные массивы; воспроизводимый seed.')]):
    card(58+(i%2)*599, 265+(i//2)*180, title, body)
text(58, 647, 'На демопроекте: 8/8 gate, 100% среди выбранных valid mutants, контрпример 6 -> 1 элемент.', 16, LIME)
end()

start('07 / MEASUREMENTS', 'Малые данные тоже имеют значение.', 'Реальные локальные медианы countPairs; 3 warmup, вызов внутри JVM, clone и process startup вне таймера.')
headers = ['N', 'Baseline, мкс', 'Candidate, мкс', 'Отношение']
xs = [82, 320, 625, 951]
box(58, 264, 1164, 285)
for x, label in zip(xs, headers):
    text(x, 307, label, 16, VIOLET, 'Bold')
for index, point in enumerate(reference['monolith']['benchmark']):
    values = [point['size'], f"{point['baselineNs']/1000:.1f}", f"{point['candidateNs']/1000:.1f}", f"{point['speedup']:.2f}x"]
    for x, value in zip(xs, values):
        text(x, 370+index*68, value, 25, LIME if x == 951 else TEXT, 'Code')
paragraph(58, 593, 'На малом n HashMap может проиграть из-за накладных расходов. Harness не JMH: JIT, GC и среда влияют на замеры. Полные samples и environment сохранены в studio-demo.json.', 1150, 18)
end()

start('08 / ANALYSIS', 'Структура проекта становится видимой.', 'У каждого статического вывода есть источник и граница применимости.')
for i, (title, body) in enumerate([('Graph intelligence', 'Достижимость, Tarjan SCC, доминаторы, shortest/bounded structural paths.'), ('Project architecture', 'Вызовы, циклы, fan-in/out и hotspots. Лексическое разрешение, не полный dispatch.'), ('Data flow + complexity', 'Чтения/записи по именам, композиционный Big O. Не SSA и не alias analysis.'), ('Explainable diagnostics', '5 базовых + 20 дополнительных правил, line/span, severity и SARIF 2.1.0.')]):
    card(58+(i%2)*599, 265+(i//2)*180, title, body)
text(58, 647, 'Структурный путь не означает выполнимость условий. Exceptional flow моделируется консервативно.', 16, LIME)
end()

start('09 / EVIDENCE', 'Review можно забрать с собой.', 'Автономный комплект связывает изменение, входы и результат; повторная проверка не зависит от UI.')
box(58, 268, 550, 343)
code(82, 311, 'evidence.zip\n  baseline/*.java\n  candidate/*.java\n  inputs.json\n  behavior-report.json\n  evidence-manifest.json\n  benchmark.json / mutation-report.json\n  changes.patch\n  report.html', 18)
paragraph(658, 301, 'Verified manifest выдаётся только для завершённого compare job с соответствующими hashes исходников. Произвольный клиентский отчёт не становится verified.', 535, 21)
paragraph(658, 478, 'Дополнительно: граф SVG / Mermaid / DOT, диагностика SARIF. SHA-256 идентифицирует содержимое, но не является цифровой подписью.', 535, 19)
end()

start('10 / VERIFICATION', f"{summary['tests']} тестов. Настоящий compiler и JVM.", 'Одна команда python tests/verify.py компилирует, поднимает отдельный сервер, проверяет и останавливает его.')
for x, count, title, body in [(58, str(summary['unit']['tests']), 'UNIT', 'Визуальные блоки, scope, Java generation, trace, diff, lexer/XSS, ZIP и storage.'), (454, '22', 'BASE API', 'Java scope, UTF-16, edits, extraction, raw bytes, timeout/flood, Origin.'), (850, '42', 'STUDIO + BUILDER API', 'Планы, labs, jobs, evidence и реальные запуски программ из блоков.')]:
    box(x, 270, 372, 294)
    text(x+24, 342, count, 50, LIME, 'Bold')
    text(x+24, 390, title, 13, VIOLET, 'Bold')
    paragraph(x+24, 436, body, 320, 18)
paragraph(58, 603, 'Дополнительно 7 интеграционных проверок настольного runtime: пакеты, Unicode, stdin, main, отмена, flood и timeout. Удалённый CI recipe включён; Docker и удалённый CI здесь не проверялись.', 1150, 17)
end()

start('11 / SOURCE AUDIT', 'Объём можно пересчитать.', 'UTF-8 splitlines; непустые строки включают комментарии. Объём сам по себе не является метрикой качества.')
box(58, 265, 1164, 310)
text(82, 306, 'Язык', 17, VIOLET, 'Bold')
text(645, 306, 'Строки', 17, VIOLET, 'Bold')
text(949, 306, 'Непустые', 17, VIOLET, 'Bold')
for index, (language, values) in enumerate(audit['languages'].items()):
    y = 353+index*43
    text(82, y, language, 20)
    text(645, y, values['physical'], 20, TEXT, 'Code')
    text(949, y, values['nonempty'], 20, LIME, 'Code')
paragraph(58, 615, 'Исключены runtime, зависимости, build/dist, JSON, примеры, дубли, документация и SVG. Продукт отдельно от тестов: '+str(audit['product']['nonempty'])+' непустых строк. Команда: python tests/source_audit.py.', 1150, 17)
end()

start('12 / RUN & DEFEND', 'Готово к локальной демонстрации.', 'Сначала показать изменение и последствия. Затем архитектуру, тесты и честные технические границы.')
box(58, 267, 1164, 107)
code(82, 311, '.\\start.ps1 -TrustedLocal\nhttp://localhost:8080', 20)
paragraph(58, 426, '1. Монолит -> canvas -> объяснимый diff -> apply + 8/8 gate.\n2. Benchmark -> mutation score -> намеренная ошибка -> меньший контрпример.\n3. Checkpoint -> extraction -> architecture -> evidence ZIP.', 1120, 21)
paragraph(58, 567, 'Границы: trusted local не sandbox; граф структурный, не полный exceptional CFG; конечные тесты не доказывают все входы. На Site - помеченные записи; произвольная Java - локально.', 1140, 18)
text(58, 644, 'http://localhost:8080  /  расширенная Studio: /expert.html', 17, LIME, 'Code')
end()

assert page == 16
pdf.save()
print(OUT / 'Java-Blueprints-solution.pdf')
