"""IDE contracts against the real JVM service: project paths, entry points, decomposition, gate."""
import json
import os
from pathlib import Path
import time
import unittest
import urllib.request
import urllib.error

ROOT = Path(__file__).resolve().parents[1]
BASE = os.environ.get('BLUEPRINTS_URL', 'http://localhost:8080')
SHOP = ROOT / 'examples/shop-monolith'


def post(route, data):
    req = urllib.request.Request(BASE + '/api/' + route,
                                 data=json.dumps(data, ensure_ascii=False).encode('utf-8'),
                                 headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=180) as response:
        return json.load(response)


def get(route):
    with urllib.request.urlopen(BASE + '/api/' + route, timeout=60) as response:
        return json.load(response)


def job(kind, payload):
    submitted = post('jobs/submit', {'kind': kind, **payload})
    deadline = time.monotonic() + 240
    while time.monotonic() < deadline:
        state = get('jobs/' + submitted['id'])
        if state['state'] not in ('queued', 'running'):
            return state
        time.sleep(0.4)
    raise AssertionError('job did not finish')


def shop_files():
    return {'src/ShopMonolith.java': (SHOP / 'src/ShopMonolith.java').read_text(encoding='utf-8')}


def shop_inputs():
    tests = json.loads((SHOP / 'blueprints-tests.json').read_text(encoding='utf-8'))
    return [case['input'] for case in tests['cases']]


PACKAGES = {
    'src/app/Main.java': 'package app;\nimport app.util.Calc;\nimport java.util.Scanner;\n'
                         'public class Main { public static void main(String[] a) {'
                         ' Scanner s = new Scanner(System.in); int n = s.nextInt();'
                         ' System.out.println("Итого: " + Calc.twice(n)); } }\n',
    'src/app/util/Calc.java': 'package app.util;\npublic class Calc { public static int twice(int x) { return x * 2; } }\n',
    'src/app/Tool.java': 'package app;\npublic class Tool { public static void main(String[] a) { System.out.println("tool"); } }\n',
}


class IdeApiTests(unittest.TestCase):
    def test_01_package_project_compiles_and_runs_from_relative_paths(self):
        result = job('compare', {'original': PACKAGES, 'candidate': PACKAGES, 'inputs': ['21\n'], 'mainClass': 'app.Main'})
        self.assertEqual(result['state'], 'completed', result)
        self.assertTrue(result['result']['passed'])
        self.assertEqual(result['result']['tests'][0]['baseline']['stdout'].strip(), 'Итого: 42')

    def test_02_run_configuration_selects_the_entry_point(self):
        result = job('compare', {'original': PACKAGES, 'candidate': PACKAGES, 'inputs': [''], 'mainClass': 'app.Tool'})
        self.assertEqual(result['result']['tests'][0]['baseline']['stdout'].strip(), 'tool')
        simple = job('compare', {'original': PACKAGES, 'candidate': PACKAGES, 'inputs': ['1\n'], 'mainClass': 'Main'})
        self.assertEqual(simple['result']['tests'][0]['baseline']['stdout'].strip(), 'Итого: 2')

    def test_03_paths_outside_the_project_are_rejected(self):
        for name in ['../x/A.java', 'C:/x/A.java', 'src//A.java', 'src/../A.java', 'src/A.txt']:
            with self.assertRaises(urllib.error.HTTPError) as caught:
                post('compile', {'files': {name: 'class A {}'}})
            self.assertEqual(caught.exception.code, 400, name)

    def test_04_project_analysis_reports_paths_methods_and_modules(self):
        project = post('project', {'files': shop_files()})
        self.assertGreaterEqual(project['stats']['methods'], 70)
        self.assertTrue(all(f['fileName'] == 'src/ShopMonolith.java' for f in project['findings']))
        rules = {f['rule'] for f in project['findings']}
        self.assertIn('NESTED_LOOPS', rules)
        self.assertTrue({'output', 'computation'} <= {m['id'] for m in project['modules']})
        hot = {m['name']: m['complexity'] for m in project['methods']}
        self.assertEqual(hot['countRepeatedQuantities'], 'O(n^2)')

    def test_05_optimisation_plan_preserves_shop_behaviour(self):
        files = shop_files()
        source = files['src/ShopMonolith.java']
        plans = post('plans', {'source': source})
        plan = next(p for p in plans['plans'] if p['rule'] == 'histogram-pairs')
        applied = post('plans/apply', {'source': source, 'sourceHash': plans['sourceHash'], 'planIds': [plan['id']]})
        self.assertNotEqual(applied['source'], source)
        result = job('compare', {'original': files, 'candidate': {'src/ShopMonolith.java': applied['source']},
                                 'inputs': shop_inputs(), 'mainClass': 'ShopMonolith'})
        self.assertTrue(result['result']['passed'], [t['passed'] for t in result['result']['tests']])

    def test_06_responsibility_decomposition_creates_a_class_and_keeps_behaviour(self):
        files = shop_files()
        project = post('project', {'files': files})
        module = next(m for m in project['modules'] if m['id'] == 'output')
        ids = [item.split('::', 1)[1] for item in module['methods']]
        result = post('decompose', {'files': files, 'fileName': 'src/ShopMonolith.java', 'methodIds': ids, 'className': 'ShopReports'})
        self.assertEqual(result['created'], 'src/ShopReports.java')
        self.assertIn('final class ShopReports', result['files']['src/ShopReports.java'])
        self.assertIn('ShopReports.printReport()', result['files']['src/ShopMonolith.java'])
        self.assertGreaterEqual(len(result['moved']), 5)
        gate = job('compare', {'original': files, 'candidate': result['files'], 'inputs': shop_inputs(), 'mainClass': 'ShopMonolith'})
        self.assertTrue(gate['result']['passed'])

    def test_07_decomposition_explains_skipped_methods(self):
        files = shop_files()
        model = post('analyze', {'source': files['src/ShopMonolith.java']})
        ids = [m['id'] for m in model['methods'] if m['name'] in ('main', 'subtotal', 'parse', 'formatMoney')]
        result = post('decompose', {'files': files, 'fileName': 'src/ShopMonolith.java', 'methodIds': ids, 'className': 'Money'})
        self.assertEqual(result['moved'], ['formatMoney'])
        reasons = {item['name']: item['reason'] for item in result['skipped']}
        self.assertIn('точка входа', reasons['main'])
        self.assertIn('экземпляра', reasons['subtotal'])
        self.assertIn('enum', reasons['parse'])

    def test_08_decomposition_rejects_bad_or_taken_class_names(self):
        files = shop_files()
        model = post('analyze', {'source': files['src/ShopMonolith.java']})
        ids = [m['id'] for m in model['methods'] if m['name'] == 'formatMoney']
        for name in ['lowercase', 'Product', 'Bad-Name']:
            with self.assertRaises(urllib.error.HTTPError) as caught:
                post('decompose', {'files': files, 'fileName': 'src/ShopMonolith.java', 'methodIds': ids, 'className': name})
            self.assertEqual(caught.exception.code, 400, name)

    def test_09_stack_frame_line_numbers_do_not_fail_the_gate(self):
        a = 'public class Boom { public static void main(String[] a) { int[] x = new int[1]; System.out.println(x[2]); } }'
        b = 'public class Boom {\n\n\n  public static void main(String[] a) {\n    int[] x = new int[1];\n    System.out.println(x[2]);\n  }\n}'
        result = job('compare', {'original': {'Boom.java': a}, 'candidate': {'Boom.java': b}, 'inputs': ['']})
        test = result['result']['tests'][0]
        self.assertNotEqual(test['baseline']['stderr'], test['candidate']['stderr'])
        self.assertTrue(result['result']['passed'])

    def test_10_a_different_exception_message_still_fails_the_gate(self):
        a = 'public class Boom { public static void main(String[] a) { throw new IllegalStateException("one"); } }'
        b = a.replace('"one"', '"two"')
        result = job('compare', {'original': {'Boom.java': a}, 'candidate': {'Boom.java': b}, 'inputs': ['']})
        self.assertFalse(result['result']['passed'])

    def test_11_bundled_examples_are_served_for_the_browser_preview(self):
        example = get('examples/shop-monolith')
        self.assertIn('src/ShopMonolith.java', example['files'])
        self.assertIn('blueprints-tests.json', example['files'])
        with self.assertRaises(urllib.error.HTTPError) as caught:
            get('examples/..%2Fsrc')
        self.assertEqual(caught.exception.code, 400)

    def test_12_every_bundled_example_passes_its_own_tests(self):
        for folder in sorted((ROOT / 'examples').iterdir()):
            tests = json.loads((folder / 'blueprints-tests.json').read_text(encoding='utf-8'))
            files = {path.relative_to(folder).as_posix(): path.read_text(encoding='utf-8')
                     for path in (folder / 'src').rglob('*.java')}
            result = job('compare', {'original': files, 'candidate': files,
                                     'inputs': [case['input'] for case in tests['cases']],
                                     'mainClass': tests.get('mainClass', '')})
            self.assertEqual(result['state'], 'completed', folder.name)
            self.assertTrue(result['result']['passed'], folder.name)


LOOKUP = '''import java.util.*;
public class Lookup {
    public static void main(String[] args) {
        Scanner in = new Scanner(System.in);
        List<String> banned = new ArrayList<>(List.of("spam", "ads", "x"));
        List<String> words = new ArrayList<>();
        while (in.hasNext()) words.add(in.next());
        int hits = 0;
        for (String word : words) {
            if (banned.contains(word)) {
                hits++;
            }
        }
        List<Integer> unique = new ArrayList<>();
        for (String word : words) {
            Integer length = word.length();
            if (!unique.contains(length)) {
                unique.add(length);
            }
        }
        LinkedList<String> queue = new LinkedList<>(words);
        for (int i = 0; i < queue.size(); i++) {
            String head = queue.get(i);
            String last = queue.getLast();
            if (head == "stop") System.out.println("stop at " + i);
            if (head == last) System.out.println("last at " + i);
        }
        try { Integer.parseInt("x"); } catch (NumberFormatException e) { }
        System.out.println(hits + " " + unique);
    }
}
'''


class CollectionRulesTests(unittest.TestCase):
    def test_13_real_world_defects_are_reported(self):
        project = post('project', {'files': {'Lookup.java': LOOKUP}})
        rules = {(f['rule'], f['line']) for f in project['findings']}
        self.assertIn(('BP121', 10), rules)
        self.assertIn(('BP121', 17), rules)
        self.assertIn(('BP125', 23), rules)
        self.assertIn(('STRING_IDENTITY', 25), rules)
        self.assertIn(('BP122', 26), rules)
        self.assertIn(('EMPTY_CATCH', 28), rules)
        self.assertNotIn(('BP122', 25), rules)
        fixable = {f['line'] for f in project['findings'] if f['rule'] == 'BP121' and f['canOptimize']}
        self.assertEqual(fixable, {10, 17})

    def test_14_collection_plans_rewrite_lookups_and_keep_behaviour(self):
        plans = post('plans', {'source': LOOKUP})
        chosen = [p for p in plans['plans'] if p['rule'] in ('dedupe-set', 'contains-to-set')]
        self.assertEqual({p['rule'] for p in chosen}, {'dedupe-set', 'contains-to-set'})
        applied = post('plans/apply', {'source': LOOKUP, 'sourceHash': plans['sourceHash'], 'planIds': [p['id'] for p in chosen]})
        self.assertIn('bannedSet.contains(word)', applied['source'])
        self.assertIn('if (uniqueSeen.add(length))', applied['source'])
        result = job('compare', {'original': {'Lookup.java': LOOKUP}, 'candidate': {'Lookup.java': applied['source']},
                                 'inputs': ['spam a bb ads ccc a stop\n', '', 'x x x y\n']})
        self.assertTrue(result['result']['passed'])

    def test_15_collection_plans_refuse_lists_that_change_or_escape(self):
        source = '''import java.util.*;
class Unsafe {
    static int f(List<String> items, List<String> seen) {
        int n = 0;
        for (String item : items) {
            if (seen.contains(item)) n++;
            seen.add(item);
        }
        List<String> mine = new ArrayList<>();
        for (String item : items) {
            if (!mine.contains(item)) mine.add(item);
        }
        Collections.reverse(mine);
        return n + mine.size();
    }
}
'''
        plans = post('plans', {'source': source})
        self.assertFalse([p for p in plans['plans'] if p['rule'] in ('dedupe-set', 'contains-to-set')])

    def test_16_every_optimisation_of_the_shop_example_keeps_behaviour(self):
        files = shop_files()
        source = files['src/ShopMonolith.java']
        plans = post('plans', {'source': source})
        self.assertTrue({'histogram-pairs', 'dedupe-set', 'string-builder'} <= {p['rule'] for p in plans['plans']})
        applied = post('plans/apply', {'source': source, 'sourceHash': plans['sourceHash'], 'planIds': [p['id'] for p in plans['plans']]})
        result = job('compare', {'original': files, 'candidate': {'src/ShopMonolith.java': applied['source']},
                                 'inputs': shop_inputs(), 'mainClass': 'ShopMonolith'})
        self.assertTrue(result['result']['passed'], [t['passed'] for t in result['result']['tests']])


NESTED = '''import java.util.*;
public class Catalog {
    static class Item {
        final String name; final int price;
        Item(String name, int price) { this.name = name; this.price = price; }
    }
    static final List<Item> ITEMS = new ArrayList<>();
    public static void main(String[] args) {
        Scanner in = new Scanner(System.in);
        while (in.hasNext()) ITEMS.add(new Item(in.next(), in.hasNextInt() ? in.nextInt() : 0));
        System.out.println(total(ITEMS) + " " + cheapest(ITEMS).name);
    }
    static int total(List<Item> items) {
        int sum = 0;
        for (Item item : items) sum += item.price;
        return sum;
    }
    static Item cheapest(List<Item> items) {
        Item best = new Item("-", Integer.MAX_VALUE);
        for (Item item : items) if (item.price < best.price) best = item;
        return best;
    }
}
'''


class SignatureTests(unittest.TestCase):
    def test_17_nested_types_in_signatures_are_qualified_on_move(self):
        files = {'Catalog.java': NESTED}
        model = post('analyze', {'source': NESTED})
        ids = [m['id'] for m in model['methods'] if m['name'] in ('total', 'cheapest')]
        result = post('decompose', {'files': files, 'fileName': 'Catalog.java', 'methodIds': ids, 'className': 'Pricing'})
        self.assertEqual(sorted(result['moved']), ['cheapest', 'total'])
        helper = result['files']['Pricing.java']
        self.assertIn('static int total(List<Catalog.Item> items)', helper)
        self.assertIn('static Catalog.Item cheapest(List<Catalog.Item> items)', helper)
        gate = job('compare', {'original': files, 'candidate': result['files'], 'inputs': ['tea 30 cake 120 bun 15\n', '']})
        self.assertTrue(gate['result']['passed'])


if __name__ == '__main__':
    loader = unittest.defaultTestLoader
    suite = unittest.TestSuite([loader.loadTestsFromTestCase(case) for case in (IdeApiTests, CollectionRulesTests, SignatureTests)])
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    (ROOT / 'docs/ide-test-summary.json').write_text(json.dumps({'tests': result.testsRun, 'failures': len(result.failures), 'errors': len(result.errors), 'passed': result.wasSuccessful()}, indent=2), encoding='utf-8')
    raise SystemExit(0 if result.wasSuccessful() else 1)
