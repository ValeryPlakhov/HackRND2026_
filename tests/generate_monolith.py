from pathlib import Path

root=Path(__file__).resolve().parents[1]
pair=(root/'examples/pair-analyzer/src/PairAnalyzer.java').read_text(encoding='utf-8').replace('public class PairAnalyzer','public class LargeMonolith')
pair=pair.replace('System.out.println("Категория: " + classify(n));','System.out.println("Категория: " + classify(n));\n        int checksum = 0;\n'+''.join(f'        checksum += metric{i:02d}(values);\n' for i in range(48))+'        System.out.println("Контрольная сумма: " + checksum);')
methods=[]
for i in range(48):
    methods.append(f'''
    // Statistic {i:02d}: deterministic primitive arithmetic with branch coverage.
    static int metric{i:02d}(int[] values) {{
        int total = {i};
        int minimum = Integer.MAX_VALUE;
        int maximum = Integer.MIN_VALUE;
        for (int value : values) {{
            minimum = Math.min(minimum, value);
            maximum = Math.max(maximum, value);
            if ((value & 1) == {i%2}) {{
                total += value * {i+1};
            }} else {{
                total -= value;
            }}
        }}
        if (values.length == 0) {{
            return total;
        }}
        return total + maximum - minimum;
    }}
''')
source=pair.rstrip()[:-1]+''.join(methods)+'}\n'
(root/'examples/large-monolith/src/LargeMonolith.java').write_text(source,encoding='utf-8')
print('Generated',len(source.splitlines()),'lines,',48,'active statistic methods')
