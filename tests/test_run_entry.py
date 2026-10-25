"""Running code without main(String[]): bare statements, a method without parameters, the open file first."""
import json
import os
import time
import unittest
import urllib.request

BASE = os.environ.get('BLUEPRINTS_URL', 'http://localhost:8080')


def post(route, data):
    request = urllib.request.Request(BASE + '/api/' + route, data=json.dumps(data).encode('utf-8'),
                                     headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.load(response)


def job(kind, payload):
    submitted = post('jobs/submit', {'kind': kind, **payload})
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        with urllib.request.urlopen(f"{BASE}/api/jobs/{submitted['id']}", timeout=60) as response:
            state = json.load(response)
        if state['state'] not in ('queued', 'running'):
            return state
        time.sleep(0.3)
    raise AssertionError('job did not finish')


def run(files, data='', **extra):
    state = job('run', {'files': files, 'input': data, **extra})
    result = state.get('result') or {}
    return state, result.get('execution') or {}, result.get('compile') or {}


class RunWithoutMain(unittest.TestCase):
    def test_bare_statements_run(self):
        state, execution, build = run({'Snippet.java': 'int x = 2 + 3;\nSystem.out.println("x=" + x);'})
        self.assertEqual(state['state'], 'completed', state)
        self.assertEqual(execution['stdout'].strip(), 'x=5')

    def test_method_without_parameters_runs(self):
        state, execution, build = run({'Calc.java': 'public class Calc { void greet() { System.out.println("hi"); } }'})
        self.assertEqual(execution['stdout'].strip(), 'hi')
        self.assertEqual(build['entryPoint'], 'Calc.greet()')

    def test_return_value_is_printed(self):
        state, execution, build = run({'Answer.java': 'class Answer { static int value() { return 42; } }'})
        self.assertEqual(execution['stdout'].strip(), '42')

    def test_open_file_is_preferred(self):
        files = {'A.java': 'class A { static void run() { System.out.println("A"); } }',
                 'B.java': 'class B { static void run() { System.out.println("B"); } }'}
        state, execution, build = run(files, entryFile='B.java')
        self.assertEqual(execution['stdout'].strip(), 'B')

    def test_standard_main_still_wins(self):
        files = {'App.java': 'public class App { public static void main(String[] a) { System.out.println("main"); } void other() {} }'}
        state, execution, build = run(files)
        self.assertEqual(execution['stdout'].strip(), 'main')

    def test_keyboard_input_reaches_the_method(self):
        source = 'import java.util.*;\npublic class Hello { void go() { int n = new Scanner(System.in).nextInt(); System.out.println(n < 10 ? "привет" : "много"); } }'
        state, execution, build = run({'Hello.java': source}, '5\n')
        self.assertEqual(execution['stdout'].strip(), 'привет')

    def test_nothing_to_run_is_explained(self):
        state, execution, build = run({'Calc.java': 'class Calc { int add(int a, int b) { return a + b; } }'})
        self.assertEqual(state['result']['phase'], 'entry')
        self.assertIn('Нечего запускать', build['mainError'])

    def test_library_offers_choices_instead_of_guessing(self):
        shapes = '\n'.join([
            'package lib;',
            'public class Shapes {',
            '  private final int size;',
            '  public Shapes(int size) { this.size = size; }',
            '  int area() { return size * size; }',
            '  public static String hello() { return "hello"; }',
            '  static class Unit { int one() { return 1; } }',
            '  public String toString() { return "s"; }',
            '}'])
        files = {'lib/Shapes.java': shapes, 'lib/More.java': 'package lib;\nclass More { static int two() { return 2; } }'}
        state, execution, build = run(files)
        self.assertEqual(state['result']['phase'], 'entry')
        choices = build['entryCandidates']
        self.assertIn('lib.Shapes#hello', choices)
        self.assertIn('lib.Shapes$Unit#one', choices)
        self.assertNotIn('lib.Shapes#area', choices, 'needs a constructor argument')
        self.assertFalse(any(name.endswith('#toString') for name in choices))
        state, execution, build = run(files, mainClass='lib.Shapes$Unit#one')
        self.assertEqual(execution['stdout'].strip(), '1')
        self.assertEqual(build['entryPoint'], 'lib.Shapes.Unit.one()')

    def test_long_literals_do_not_break_the_build(self):
        literal = 'x' * 20000
        source = 'public class Big { static String s = "' + literal + '"; /* ' + literal + ' */ public static void main(String[] a) { System.out.println(s.length()); } }'
        state, execution, build = run({'Big.java': source})
        self.assertEqual(execution['stdout'].strip(), '20000')

    def test_comparison_works_without_main(self):
        files = {'Sum.java': 'import java.util.*;\nclass Sum { void go() { Scanner s = new Scanner(System.in); int n = s.nextInt(), t = 0; for (int i = 0; i < n; i++) t += s.nextInt(); System.out.println(t); } }'}
        state = job('compare', {'original': files, 'candidate': files, 'inputs': ['3\n1 2 3\n', '0\n']})
        self.assertTrue(state['result']['passed'], state)



def rules(source):
    report = post('project', {'files': {'R.java': source}})
    return [(finding['rule'], finding['severity']) for finding in report['findings']]


class RuleNoise(unittest.TestCase):
    """Senior code is not flagged for idioms; what is flagged uses an honest severity."""

    def test_explained_empty_catch_is_not_reported(self):
        quiet = 'class R { void f() { try { g(); } catch (Exception ignored) { } } void g() throws Exception {} }'
        commented = 'class R { void f() { try { g(); } catch (Exception e) { /* optional */ } } void g() throws Exception {} }'
        silent = 'class R { void f() { try { g(); } catch (RuntimeException e) { } } void g() {} }'
        self.assertNotIn('EMPTY_CATCH', [rule for rule, _ in rules(quiet)])
        self.assertNotIn('EMPTY_CATCH', [rule for rule, _ in rules(commented)])
        self.assertIn('EMPTY_CATCH', [rule for rule, _ in rules(silent)])

    def test_generic_catch_that_rethrows_or_sits_in_main_is_fine(self):
        rethrow = 'class R { void f() { try { g(); } catch (Exception e) { throw new IllegalStateException(e); } } void g() throws Exception {} }'
        entry = 'class R { public static void main(String[] a) { try { g(); } catch (Exception e) { System.err.println(e); } } static void g() throws Exception {} }'
        plain = 'class R { void f() { try { g(); } catch (Exception e) { System.out.println(e); } } void g() throws Exception {} }'
        self.assertNotIn('BP101', [rule for rule, _ in rules(rethrow)])
        self.assertNotIn('BP101', [rule for rule, _ in rules(entry)])
        self.assertIn(('BP101', 'info'), rules(plain))

    def test_while_true_with_break_is_an_idiom(self):
        loop = 'class R { int f(java.util.Scanner s) { while (true) { int x = s.nextInt(); if (x < 0) break; } return 0; } }'
        endless = 'class R { void f() { int x = 0; while (true) { x++; } } }'
        self.assertNotIn('BP108', [rule for rule, _ in rules(loop)])
        self.assertIn('BP108', [rule for rule, _ in rules(endless)])

    def test_nested_loops_are_a_hint_not_a_risk(self):
        source = 'class R { int f(int[] a) { int c = 0; for (int i = 0; i < a.length; i++) for (int j = 0; j < a.length; j++) c++; return c; } }'
        self.assertIn(('NESTED_LOOPS', 'info'), rules(source))

if __name__ == '__main__':
    raise SystemExit(0 if unittest.main(exit=False, verbosity=2).result.wasSuccessful() else 1)
