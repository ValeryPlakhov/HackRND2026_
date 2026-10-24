"""Counterexamples from the independent audit (FINDINGS F06–F12), kept as regressions."""
import json
import os
from pathlib import Path
import time
import unittest
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
BASE = os.environ.get('BLUEPRINTS_URL', 'http://localhost:8080')


def post(route, data):
    req = urllib.request.Request(BASE + '/api/' + route, data=json.dumps(data, ensure_ascii=False).encode('utf-8'),
                                 headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=180) as response:
        return json.load(response)


def job(kind, payload):
    submitted = post('jobs/submit', {'kind': kind, **payload})
    deadline = time.monotonic() + 240
    while time.monotonic() < deadline:
        with urllib.request.urlopen(f"{BASE}/api/jobs/{submitted['id']}", timeout=60) as response:
            state = json.load(response)
        if state['state'] not in ('queued', 'running'):
            return state
        time.sleep(0.3)
    raise AssertionError('job did not finish')


def program(name, body, extra=''):
    return {f'{name}.java': f'import java.util.*;\n{extra}\npublic class {name} {{\n{body}\n}}\n'}


def compare(a, b, inputs=('',), **extra):
    return job('compare', {'original': a, 'candidate': b, 'inputs': list(inputs), **extra})


def rules(source):
    return {p['rule'] for p in post('plans', {'source': source})['plans']}


class ComparisonRegressions(unittest.TestCase):
    """F10: stderr differences must never pass."""

    def check(self, first, second, expected):
        a = program('Err', f'public static void main(String[] a) {{ {first} }}')
        b = program('Err', f'public static void main(String[] a) {{ {second} }}')
        result = compare(a, b)
        self.assertEqual(result['result']['passed'], expected, result['result']['tests'][0])

    def test_f10_user_text_that_looks_like_a_frame_is_compared(self):
        self.check('System.err.println(" at before");', 'System.err.println(" at after");', False)

    def test_f10_line_endings_are_compared(self):
        self.check('System.err.print("error");', 'System.err.println("error");', False)

    def test_f10_raw_bytes_are_compared(self):
        self.check('System.err.write(128); System.err.flush();', 'System.err.write(129); System.err.flush();', False)

    def test_f10_identical_streams_still_pass(self):
        self.check('System.err.println("same");', 'System.err.println("same");', True)

    def test_f10_only_genuine_jvm_frames_ignore_line_numbers(self):
        a = {'Boom.java': 'public class Boom { public static void main(String[] a) { int[] x = new int[1]; System.out.println(x[2]); } }'}
        b = {'Boom.java': 'public class Boom {\n\n\n  public static void main(String[] a) {\n    int[] x = new int[1];\n    System.out.println(x[2]);\n  }\n}'}
        result = compare(a, b)
        self.assertTrue(result['result']['passed'])
        self.assertIn('stack-frame', result['result']['comparison'])


class EntryPointRegressions(unittest.TestCase):
    """F12: a missing or ambiguous entry point is an error, never a silent substitute."""

    TWO = {
        'Main.java': 'public class Main { public static void main(String[] a) { System.out.println("main"); } }',
        'Tool.java': 'public class Tool { public static void main(String[] a) { System.out.println("tool"); } }',
    }

    def test_f12_unknown_main_fails_instead_of_running_another_class(self):
        result = compare(self.TWO, self.TWO, mainClass='MissingEntryPoint')
        self.assertEqual(result['state'], 'failed')
        self.assertIn('MissingEntryPoint', result['error'])

    def test_f12_ambiguous_main_without_choice_fails(self):
        files = {'A.java': 'public class A { public static void main(String[] a) {} }',
                 'B.java': 'public class B { public static void main(String[] a) {} }'}
        result = compare(files, files)
        self.assertEqual(result['state'], 'failed')
        self.assertIn('Несколько классов с main', result['error'])

    def test_f12_explicit_main_is_used_and_reported(self):
        result = compare(self.TWO, self.TWO, mainClass='Tool')
        self.assertEqual(result['result']['tests'][0]['baseline']['stdout'].strip(), 'tool')
        self.assertEqual(result['result']['mainClass'], 'Tool')

    def test_f12_sync_compare_honours_main(self):
        result = post('compare', {'original': self.TWO, 'candidate': self.TWO, 'inputs': [''], 'mainClass': 'Tool'})
        self.assertEqual(result['tests'][0]['baseline']['stdout'].strip(), 'tool')

    def test_f11_runs_report_that_the_program_started(self):
        files = program('Ok', 'public static void main(String[] a) { System.out.println(1); }')
        result = compare(files, files)
        self.assertTrue(result['result']['tests'][0]['baseline']['started'])
        self.assertFalse(result['result']['inconclusive'])


class CollectionPlanRegressions(unittest.TestCase):
    """F06/F07: collection rewrites are offered only where their preconditions are proven."""

    def test_f06_list_mutated_in_loop_condition(self):
        src = program('P', '''static int f() {
        List<String> list = new ArrayList<>(List.of("x", "x", "y"));
        int n = 0;
        while (list.remove("x")) {
            if (list.contains("x")) n++;
        }
        return n;
    }''')['P.java']
        self.assertNotIn('contains-to-set', rules(src))

    def test_f06_alias_mutated_inside_loop(self):
        src = program('P', '''static int f(String[] items) {
        List<String> list = new ArrayList<>();
        List<String> alias = list;
        int n = 0;
        for (String item : items) {
            if (list.contains(item)) n++;
            alias.add(item);
        }
        return n;
    }''')['P.java']
        self.assertNotIn('contains-to-set', rules(src))

    def test_f06_parameter_list_may_be_null_or_shared(self):
        src = program('P', '''static int f(List<String> list, int k) {
        int n = 0;
        for (int i = 0; i < k; i++) {
            if (list.contains("a")) n++;
        }
        return n;
    }''')['P.java']
        self.assertNotIn('contains-to-set', rules(src))

    def test_f06_user_types_with_mutable_hash_are_not_indexed(self):
        src = program('P', '''static int f(Key[] keys) {
        List<Key> list = new ArrayList<>();
        int n = 0;
        for (Key k : keys) {
            if (list.contains(k)) n++;
        }
        return n;
    }''', 'class Key { int v; public boolean equals(Object o) { return o instanceof Key k && k.v == v; } public int hashCode() { return v; } }')['P.java']
        self.assertNotIn('contains-to-set', rules(src))

    def test_f07_value_with_side_effects_is_not_deduplicated(self):
        src = program('P', '''static int c = 0;
    static String next() { return "v" + (c++ % 2); }
    static int f() {
        List<String> list = new ArrayList<>();
        for (int i = 0; i < 3; i++) {
            if (!list.contains(next())) list.add(next());
        }
        return list.size();
    }''')['P.java']
        self.assertNotIn('dedupe-set', rules(src))

    def test_f07_list_with_alias_is_not_deduplicated(self):
        src = program('P', '''static int f(String[] items) {
        List<String> list = new ArrayList<>();
        List<String> alias = list;
        alias.add("a");
        for (String item : items) {
            if (!list.contains(item)) list.add(item);
        }
        return list.size();
    }''')['P.java']
        self.assertNotIn('dedupe-set', rules(src))

    def test_safe_cases_are_still_optimised_and_keep_behaviour(self):
        name = 'Safe'
        files = program(name, '''public static void main(String[] args) {
        Scanner in = new Scanner(System.in);
        List<String> words = new ArrayList<>();
        while (in.hasNext()) words.add(in.next());
        List<String> seen = new ArrayList<>();
        for (String word : words) {
            if (!seen.contains(word)) seen.add(word);
        }
        System.out.println(seen);
    }''')
        source = files[f'{name}.java']
        plans = post('plans', {'source': source})
        chosen = [p['id'] for p in plans['plans'] if p['rule'] == 'dedupe-set']
        self.assertEqual(len(chosen), 1)
        applied = post('plans/apply', {'source': source, 'sourceHash': plans['sourceHash'], 'planIds': chosen})
        result = compare(files, {f'{name}.java': applied['source']}, ['b a b c a\n', '', 'x\n'])
        self.assertTrue(result['result']['passed'])


class NamingRegressions(unittest.TestCase):
    def test_f08_generated_names_do_not_collide(self):
        files = program('Pairs', '''public static void main(String[] a) {
        System.out.println(count(new int[] {1, 2, 1, 2, 1}));
    }
    static int count(int[] bpValue) {
        int matches = 0;
        for (int x : bpValue) {
            for (int y : bpValue) {
                if (x == y) {
                    matches++;
                }
            }
        }
        return matches;
    }''')
        source = files['Pairs.java']
        plans = post('plans', {'source': source})
        plan = next(p for p in plans['plans'] if p['rule'] == 'histogram-pairs')
        applied = post('plans/apply', {'source': source, 'sourceHash': plans['sourceHash'], 'planIds': [plan['id']]})
        result = compare(files, {'Pairs.java': applied['source']})
        self.assertTrue(result['result']['candidateBuild']['success'], result['result']['candidateBuild'])
        self.assertTrue(result['result']['passed'])

    SHADOW = '''import static java.lang.Math.PI;
public class Geo {
    static double PI = 3;
    public static void main(String[] a) {
        System.out.println(area());
    }
    static double area() {
        {
            double PI = 5;
            System.out.print(PI + ";");
        }
        return PI;
    }
    static double plain() {
        return PI;
    }
}
'''

    def test_f09_name_shadowed_by_a_local_keeps_the_method_in_place(self):
        files = {'Geo.java': self.SHADOW}
        model = post('analyze', {'source': self.SHADOW})
        ids = [m['id'] for m in model['methods'] if m['name'] in ('area', 'plain')]
        result = post('decompose', {'files': files, 'fileName': 'Geo.java', 'methodIds': ids, 'className': 'GeoMath'})
        self.assertEqual(result['moved'], ['plain'])
        self.assertIn('привязку', next(s['reason'] for s in result['skipped'] if s['name'] == 'area'))
        gate = compare(files, result['files'])
        self.assertTrue(gate['result']['passed'], gate['result']['tests'][0])

    def test_f09_legacy_extract_keeps_field_binding(self):
        source = self.SHADOW.replace('System.out.println(area());', 'System.out.println(plain());')
        files = {'Geo.java': source}
        model = post('analyze', {'source': source})
        method_id = next(m['id'] for m in model['methods'] if m['name'] == 'plain')
        result = post('extract', {'files': files, 'fileName': 'Geo.java', 'methodId': method_id})
        gate = compare(files, result['files'])
        self.assertEqual(gate['result']['tests'][0]['candidate']['stdout'].strip(), '3.0')
        self.assertTrue(gate['result']['passed'])


if __name__ == '__main__':
    loader = unittest.defaultTestLoader
    suite = unittest.TestSuite([loader.loadTestsFromTestCase(case) for case in
                                (ComparisonRegressions, EntryPointRegressions, CollectionPlanRegressions, NamingRegressions)])
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    (ROOT / 'docs/audit-test-summary.json').write_text(json.dumps({'tests': result.testsRun, 'failures': len(result.failures), 'errors': len(result.errors), 'passed': result.wasSuccessful()}, indent=2), encoding='utf-8')
    raise SystemExit(0 if result.wasSuccessful() else 1)
