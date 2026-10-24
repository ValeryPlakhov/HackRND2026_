"""Visual programs are generated without Java editing, then compiled/run on the real JVM."""
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import unittest
from test_api import ROOT, post
from test_studio_api import await_job


class BuilderContracts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        node = os.environ.get('NODE_BINARY') or shutil.which('node')
        emitted = subprocess.check_output([node, str(ROOT/'tests/emit_builder_cases.mjs')], cwd=ROOT, encoding='utf-8')
        cls.cases = json.loads(emitted)

    def run_source(self, source, input=''):
        snapshot = await_job(post('jobs/submit', {'kind': 'run', 'files': {'Main.java': source}, 'input': input}))
        self.assertEqual(snapshot['state'], 'completed', snapshot)
        return snapshot['result']

    def assert_case(self, case):
        result = self.run_source(case['source'], case['input'])
        self.assertTrue(result['success'], result)
        self.assertEqual(result['execution']['stdout'].replace('\r\n', '\n'), case['expected'])
        self.assertEqual(result['execution']['exitCode'], 0)
        self.assertEqual(len(result['projectHash']), 64)
        self.assertEqual(len(result['inputHash']), 64)

    def test_01_all_visual_templates_match_their_model_on_real_java(self):
        for case in self.cases:
            with self.subTest(name=case['name']):
                self.assert_case(case)

    def test_02_bad_compilation_is_not_a_successful_run(self):
        result = self.run_source('public class Main { bad syntax }')
        self.assertFalse(result['success'])
        self.assertEqual(result['phase'], 'compile')
        self.assertFalse(result['compile']['success'])

    def test_03_runtime_failure_is_reported_with_actual_exit_code(self):
        result = self.run_source('public class Main { public static void main(String[] a){System.err.println("bad");System.exit(7);} }')
        self.assertFalse(result['success'])
        self.assertEqual(result['execution']['exitCode'], 7)
        self.assertIn('bad', result['execution']['stderr'])

    def test_04_timeout_does_not_become_a_successful_run(self):
        result = self.run_source('public class Main { public static void main(String[] a){while(true){}} }')
        self.assertFalse(result['success'])
        self.assertTrue(result['execution']['timedOut'])

    def test_05_output_limit_does_not_become_a_successful_run(self):
        result = self.run_source('public class Main { public static void main(String[] a){for(int i=0;i<100000;i++)System.out.print("xxxxxxxxxx");} }')
        self.assertFalse(result['success'])
        self.assertTrue(result['execution']['outputLimit'])

    def test_06_stdin_is_bound_to_the_result_hash(self):
        source = next(case['source'] for case in self.cases if case['name'].startswith('hello'))
        first = self.run_source(source, 'Анна\n')
        second = self.run_source(source, 'Борис\n')
        self.assertEqual(first['projectHash'], second['projectHash'])
        self.assertNotEqual(first['inputHash'], second['inputHash'])
        self.assertNotEqual(first['execution']['stdout'], second['execution']['stdout'])


if __name__ == '__main__':
    stream = io.StringIO()
    result = unittest.TextTestRunner(stream=stream, verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(BuilderContracts))
    output = stream.getvalue()
    print(output, end='')
    (ROOT/'docs/builder-integration.log').write_text(output, encoding='utf-8')
    (ROOT/'docs/builder-test-summary.json').write_text(json.dumps({'tests':result.testsRun, 'failures':len(result.failures), 'errors':len(result.errors), 'passed':result.wasSuccessful()}, indent=2), encoding='utf-8')
    raise SystemExit(0 if result.wasSuccessful() else 1)
