"""Black-box integration tests against the real JVM service. Python stdlib only."""
import json
import os
from pathlib import Path
import random
import unittest
import urllib.request
import urllib.error

ROOT = Path(__file__).resolve().parents[1]
BASE = os.environ.get('BLUEPRINTS_URL', 'http://localhost:8080')

def post(route, data):
    req = urllib.request.Request(BASE + '/api/' + route,
        data=json.dumps(data, ensure_ascii=False).encode('utf-8'),
        headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=180) as response:
        return json.load(response)

def compare(a, b, inputs):
    return post('compare', {'original': a, 'candidate': b, 'inputs': inputs})

def method(model, name):
    return next(m for m in model['methods'] if m['name'] == name)

PAIR = (ROOT / 'examples/pair-analyzer/src/PairAnalyzer.java').read_text(encoding='utf-8')
FILES = {'PairAnalyzer.java': PAIR}

class IntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.model = post('analyze', {'source': PAIR})
        cls.pairs = method(cls.model, 'countPairs')
        cls.optimized = post('optimize', {'source': PAIR, 'methodId': cls.pairs['id']})['source']

    def test_01_parser_and_utf16_source_positions(self):
        source = PAIR.replace('/** Demo:', '/** 🚀 Демо:')
        model = post('analyze', {'source': source})
        self.assertTrue(model['valid'])
        for m in model['methods']:
            for n in m['graph']['nodes']:
                if n['editStart'] >= 0:
                    actual = source.encode('utf-16-le')[n['editStart']*2:n['editEnd']*2].decode('utf-16-le')
                    self.assertEqual(actual, n['editCode'])

    def test_02_real_java_scope_compiles_and_runs(self):
        source = (ROOT / 'examples/language-showcase/src/LanguageShowcase.java').read_text(encoding='utf-8')
        model = post('analyze', {'source': source})
        self.assertTrue(model['valid'])
        kinds = {n['kind'] for m in model['methods'] for n in m['graph']['nodes']}
        self.assertTrue({'try','catch','loop','switch','throw','return','continue','break'} <= kinds)
        files = {'LanguageShowcase.java': source}
        result = compare(files, files, ['0\n','4\n','-1\n','999\n'])
        self.assertTrue(result['passed'], result)

    def test_03_diagnosis_is_anchored_to_real_method(self):
        finding = next(f for f in self.model['findings'] if f['rule'] == 'NESTED_LOOPS')
        self.assertEqual(finding['methodId'], self.pairs['id'])
        self.assertTrue(finding['canOptimize'])
        self.assertEqual(self.pairs['metrics']['loopDepth'], 2)

    def test_04_optimization_random_and_boundaries(self):
        rng = random.Random(75000)
        arrays = [[], [0], [7]*8, [-2147483648,2147483647,0,-1], list(range(20))]
        arrays += [[rng.randint(-5,5) for _ in range(rng.randint(0,80))] for _ in range(12)]
        inputs = [str(len(a))+'\n'+' '.join(map(str,a))+'\n' for a in arrays]
        result = compare(FILES, {'PairAnalyzer.java': self.optimized}, inputs)
        self.assertTrue(result['passed'], result)
        for a,t in zip(arrays,result['tests']):
            expected = sum(x == y for x in a for y in a)
            self.assertIn(f'Совпадающих пар: {expected}',t['candidate']['stdout'])

    def test_05_graph_condition_edit_changes_java_and_gate_rejects(self):
        target = method(self.model, 'classify')
        n = next(n for n in target['graph']['nodes'] if n['kind'] == 'condition')
        changed = post('edit', {'source':PAIR,'methodId':target['id'],'nodeId':n['id'],'code':'(n == 1)'})
        self.assertIn('if (n == 1)', changed['source'])
        result = compare(FILES, {'PairAnalyzer.java':changed['source']}, ['0\n'])
        self.assertFalse(result['passed'])

    def test_06_noop_node_roundtrip_keeps_exact_source(self):
        n = next(n for n in self.pairs['graph']['nodes'] if n['kind'] == 'condition')
        result = post('edit', {'source':PAIR,'methodId':self.pairs['id'],'nodeId':n['id'],'code':n['editCode']})
        self.assertEqual(result['source'], PAIR)

    def test_07_compile_failure_is_not_a_pass(self):
        result = compare(FILES, {'PairAnalyzer.java': PAIR.replace('int matches = 0;', 'int matches = missing;')}, ['0\n'])
        self.assertFalse(result['passed'])
        self.assertFalse(result['candidateBuild']['success'])

    def test_08_extraction_produces_two_compilable_files(self):
        model = post('analyze', {'source':self.optimized})
        result = post('extract', {'files':{'PairAnalyzer.java':self.optimized},'fileName':'PairAnalyzer.java','methodId':method(model,'countPairs')['id']})
        self.assertIn('BlueprintFunctions.java',result['files'])
        self.assertIn('BlueprintFunctions.countPairs(values)',result['files']['PairAnalyzer.java'])
        report = compare(FILES,result['files'],['0\n','5\n1 2 1 2 1\n','-1\n'])
        self.assertTrue(report['passed'],report)

    def test_09_extraction_qualifies_hidden_field_dependency(self):
        source = 'public class Field { static int x=3; static int f(int n) { return x+n; } public static void main(String[] a){ System.out.println(f(4)); } }'
        model = post('analyze', {'source':source})
        result = post('extract', {'files':{'Field.java':source},'fileName':'Field.java','methodId':method(model,'f')['id']})
        self.assertIn('Field.x', result['files']['BlueprintFunctions.java'])
        report = compare({'Field.java':source}, result['files'], [''])
        self.assertTrue(report['passed'], report)

    def test_09b_extraction_rejects_instance_dependency(self):
        source = 'public class Field { int x=3; int f(int n) { return x+n; } public static void main(String[] a){ System.out.println(new Field().f(4)); } }'
        model = post('analyze', {'source':source})
        with self.assertRaises(urllib.error.HTTPError) as caught:
            post('extract', {'files':{'Field.java':source},'fileName':'Field.java','methodId':method(model,'f')['id']})
        self.assertEqual(caught.exception.code,400)

    def test_10_infinite_loop_is_bounded_and_rejected(self):
        source = 'public class Forever { public static void main(String[] a){ while(true) {} } }'
        result = compare({'Forever.java':source},{'Forever.java':source},[''])
        self.assertFalse(result['passed'])
        self.assertTrue(result['tests'][0]['candidate']['timedOut'])

    def test_11_stderr_and_exit_code_are_compared(self):
        a = 'public class Err { public static void main(String[] a){ System.err.print("A"); System.exit(2); } }'
        b = a.replace('print("A")','print("B")')
        result = compare({'Err.java':a},{'Err.java':b},[''])
        self.assertFalse(result['passed'])
        self.assertEqual(result['tests'][0]['baseline']['exitCode'],2)

    def test_12_package_multi_class_main(self):
        source = 'package demo; class Helper { static int f(){return 9;} } public class Entry { public static void main(String... args){System.out.println(Helper.f());} }'
        result = compare({'Entry.java':source},{'Entry.java':source},[''])
        self.assertTrue(result['passed'],result)
        self.assertEqual(result['tests'][0]['candidate']['stdout'].strip(),'9')

    def test_13_syntax_errors_have_line_numbers(self):
        model = post('analyze', {'source':'class Bad { void f( { }'})
        self.assertFalse(model['valid'])
        self.assertTrue(any(d['line'] == 1 for d in model['diagnostics']))

    def test_14_unsafe_optimizer_pattern_is_rejected(self):
        source = PAIR.replace('matches++;','matches++; System.out.print("side effect");')
        model = post('analyze', {'source':source})
        self.assertFalse(any(f['canOptimize'] for f in model['findings']))
        with self.assertRaises(urllib.error.HTTPError):
            post('optimize', {'source':source,'methodId':method(model,'countPairs')['id']})

    def test_15_1000_line_monolith_roundtrip(self):
        source = (ROOT / 'examples/large-monolith/src/LargeMonolith.java').read_text(encoding='utf-8')
        self.assertGreaterEqual(len(source.splitlines()),1000)
        model = post('analyze', {'source':source})
        self.assertTrue(model['valid'])
        self.assertGreater(len(model['methods']),30)
        optimized = post('optimize', {'source':source,'methodId':method(model,'countPairs')['id']})['source']
        result = compare({'LargeMonolith.java':source},{'LargeMonolith.java':optimized},['0\n','5\n1 2 1 2 1\n'])
        self.assertTrue(result['passed'],result)

    def test_16_output_flood_is_bounded_and_rejected(self):
        source = 'public class Flood { public static void main(String[] a){while(true)System.out.println("x".repeat(4096));} }'
        result = compare({'Flood.java':source},{'Flood.java':source},[''])
        self.assertFalse(result['passed'])
        self.assertTrue(result['tests'][0]['candidate']['outputLimit'])
        self.assertLessEqual(len(result['tests'][0]['candidate']['stdout'].encode('utf-8')),65536)

    def test_17_source_path_traversal_is_rejected(self):
        with self.assertRaises(urllib.error.HTTPError) as caught:
            post('compile',{'files':{'../Escape.java':'class Escape {}'}})
        self.assertEqual(caught.exception.code,400)

    def test_18_empty_test_suite_cannot_pass(self):
        with self.assertRaises(urllib.error.HTTPError) as caught:
            compare(FILES,FILES,[])
        self.assertEqual(caught.exception.code,400)

    def test_19_graph_insert_and_delete_are_real_source_edits(self):
        target = method(self.model,'classify')
        n = next(n for n in target['graph']['nodes'] if n['kind']=='return')
        added = post('edit',{'source':PAIR,'methodId':target['id'],'nodeId':n['id'],'action':'before','code':'System.err.print("trace");'})
        self.assertIn('System.err.print("trace");',added['source'])
        model = added['model'];target = method(model,'classify')
        trace = next(n for n in target['graph']['nodes'] if n['kind']=='operation' and 'trace' in n['code'])
        deleted = post('edit',{'source':added['source'],'methodId':target['id'],'nodeId':trace['id'],'action':'delete'})
        result = compare(FILES,{'PairAnalyzer.java':deleted['source']},['0\n','1\n2\n'])
        self.assertTrue(result['passed'],result)

    def test_20_cors_rejects_foreign_origin(self):
        req=urllib.request.Request(BASE+'/api/analyze',data=b'{"source":"class A {}"}',headers={'Content-Type':'application/json','Origin':'https://evil.example'})
        with self.assertRaises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(req,timeout=10)
        self.assertEqual(caught.exception.code,403)

    def test_21_raw_output_bytes_are_compared_before_utf8_decoding(self):
        a='public class Bytes { public static void main(String[] a){System.out.write(128);System.out.flush();} }'
        b=a.replace('write(128)','write(129)')
        result=compare({'Bytes.java':a},{'Bytes.java':b},[''])
        self.assertFalse(result['passed'])
        self.assertNotEqual(result['tests'][0]['baseline']['stdoutSha256'],result['tests'][0]['candidate']['stdoutSha256'])

    def test_22_string_concat_warning_does_not_flag_integer_counter(self):
        optimized_model=post('analyze',{'source':self.optimized})
        self.assertFalse(any(f['rule']=='LOOP_ACCUMULATION' for f in optimized_model['findings']))
        source='class Concat { static String f(int n){String s="";for(int i=0;i<n;i++){s+=i;}return s;} }'
        model=post('analyze',{'source':source})
        self.assertTrue(any(f['rule']=='LOOP_ACCUMULATION' for f in model['findings']))

if __name__ == '__main__':
    suite=unittest.defaultTestLoader.loadTestsFromTestCase(IntegrationTests)
    result=unittest.TextTestRunner(verbosity=2).run(suite)
    (ROOT/'docs/test-summary.json').write_text(json.dumps({'tests':result.testsRun,'failures':len(result.failures),'errors':len(result.errors),'passed':result.wasSuccessful()},indent=2),encoding='utf-8')
    raise SystemExit(0 if result.wasSuccessful() else 1)
