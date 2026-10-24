"""Format the real reference measurements without hiding slowdowns."""
from pathlib import Path
import json

root = Path(__file__).resolve().parents[1]
results = json.loads((root / 'docs/studio-reference-results.json').read_text(encoding='utf-8'))
rows = ['# Реальные демонстрационные результаты', '',
        'Источник: `studio-reference-results.json`; samples, параметры и environment — `web/studio-demo.json`.', '',
        'Повторить: живой trusted-local сервер и `python tests/prepare_studio_demo.py`.', '',
        '## Differential gate', '', '| Пример | Совпало | Mutation score | Reducer |', '|---|---:|---:|---|']
for name, result in results.items():
    reduction = result['reduction']
    reduced = f"{reduction['beforeLength']} → {reduction['afterLength']} элементов; stillFails" if reduction['stillFails'] else 'не применим'
    score = f"{result['mutationScore']:.0f}% выбранных valid mutants" if result['mutationScore'] is not None else 'не записан'
    rows.append(f"| {name} | {result['inputs']}/{result['inputs']} | {score} | {reduced} |")
rows += ['', '## Метод countPairs: baseline / histogram', '',
         'Три warmup, медианы по пяти samples; вызов внутри JVM. Clone массива и startup вне таймера.', '',
         '| Пример | n | Baseline, мкс | Candidate, мкс | Baseline / candidate |', '|---|---:|---:|---:|---:|']
for name, result in results.items():
    for point in result['benchmark'] or []:
        rows.append(f"| {name} | {point['size']} | {point['baselineNs']/1000:.1f} | {point['candidateNs']/1000:.1f} | {point['speedup']:.2f}× |")
rows += ['', 'Отношение <1 означает замедление. На малом n HashMap может проигрывать из-за boxing/allocations; на больших входах частотный индекс выигрывает у вложенных циклов.', '',
         'Это собственный harness, не JMH. Порядок baseline/candidate, JIT, GC, планировщик и нагрузка влияют на значения. Пять samples одного запуска не дают публикационной статистики; ускорение не обещается на другой машине. Big O не выводится из этих замеров.', '',
         'Mutation score не line coverage и относится к небольшому выбранному набору мутантов/входов. Reducer ограничен бюджетом и протоколом n+n int; глобальный минимум не доказан. Text Pipeline имеет другую сигнатуру, int[] benchmark/reducer для него не записаны.']
(root / 'docs/BENCHMARKS.md').write_text('\n'.join(rows) + '\n', encoding='utf-8')
print('Updated docs/BENCHMARKS.md from actual recorded measurements')
