# Реальные демонстрационные результаты

Источник: `studio-reference-results.json`; samples, параметры и environment — `web/studio-demo.json`.

Повторить: живой trusted-local сервер и `python tests/prepare_studio_demo.py`.

## Differential gate

| Пример | Совпало | Mutation score | Reducer |
|---|---:|---:|---|
| pairs | 8/8 | 100% выбранных valid mutants | 6 → 1 элементов; stillFails |
| monolith | 8/8 | 100% выбранных valid mutants | 6 → 1 элементов; stillFails |
| text | 5/5 | не записан | не применим |

## Метод countPairs: baseline / histogram

Три warmup, медианы по пяти samples; вызов внутри JVM. Clone массива и startup вне таймера.

| Пример | n | Baseline, мкс | Candidate, мкс | Baseline / candidate |
|---|---:|---:|---:|---:|
| pairs | 128 | 55.6 | 71.7 | 0.78× |
| pairs | 1024 | 334.4 | 158.7 | 2.11× |
| pairs | 4096 | 4806.8 | 387.3 | 12.41× |
| monolith | 128 | 48.2 | 71.2 | 0.68× |
| monolith | 1024 | 305.0 | 132.1 | 2.31× |
| monolith | 4096 | 4728.5 | 405.6 | 11.66× |

Отношение <1 означает замедление. На малом n HashMap может проигрывать из-за boxing/allocations; на больших входах частотный индекс выигрывает у вложенных циклов.

Это собственный harness, не JMH. Порядок baseline/candidate, JIT, GC, планировщик и нагрузка влияют на значения. Пять samples одного запуска не дают публикационной статистики; ускорение не обещается на другой машине. Big O не выводится из этих замеров.

Mutation score не line coverage и относится к небольшому выбранному набору мутантов/входов. Reducer ограничен бюджетом и протоколом n+n int; глобальный минимум не доказан. Text Pipeline имеет другую сигнатуру, int[] benchmark/reducer для него не записаны.
