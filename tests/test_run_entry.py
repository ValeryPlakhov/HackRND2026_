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
        self.assertEqual(state['state'], 'failed')
        self.assertIn('Нечего запускать', state.get('error', ''))

    def test_comparison_works_without_main(self):
        files = {'Sum.java': 'import java.util.*;\nclass Sum { void go() { Scanner s = new Scanner(System.in); int n = s.nextInt(), t = 0; for (int i = 0; i < n; i++) t += s.nextInt(); System.out.println(t); } }'}
        state = job('compare', {'original': files, 'candidate': files, 'inputs': ['3\n1 2 3\n', '0\n']})
        self.assertTrue(state['result']['passed'], state)


if __name__ == '__main__':
    raise SystemExit(0 if unittest.main(exit=False, verbosity=2).result.wasSuccessful() else 1)
