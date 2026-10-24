"""Studio v2 integration contract. All Java executions use the real compiler and JVM."""
import io
import json
import time
import unittest
import urllib.error
import urllib.request
from test_api import post, compare, method, PAIR, FILES, ROOT, BASE


def get(route):
    with urllib.request.urlopen(BASE + '/api/' + route, timeout=90) as response:
        return json.load(response)


def await_job(job, timeout=90):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        snapshot = get('jobs/' + job['id'])
        if snapshot['state'] not in ('queued', 'running'):
            return snapshot
        time.sleep(0.06)
    raise TimeoutError('Asynchronous job did not reach a terminal state')


def job(kind, **payload):
    result = await_job(post('jobs/submit', {'kind':kind, **payload}))
    if result['state'] != 'completed':
        raise AssertionError(result)
    return result


class StudioContracts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.project = post('project', {'files':FILES})
        cls.model = cls.project['files']['PairAnalyzer.java']
        cls.pairs = method(cls.model, 'countPairs')
        cls.plans = post('plans', {'source':PAIR})
        cls.plan = next(p for p in cls.plans['plans'] if p['rule']=='histogram-pairs')
        cls.after = post('plans/apply', {'source':PAIR,
            'sourceHash':cls.plans['sourceHash'], 'planIds':[cls.plan['id']]})['source']

    def assert_bad_request(self, route, payload, contains=None):
        with self.assertRaises(urllib.error.HTTPError) as caught:
            post(route, payload)
        self.assertEqual(caught.exception.code, 400)
        message = json.load(caught.exception)['error']
        if contains:
            self.assertIn(contains, message)
        return message

    def test_01_capabilities_are_connected_to_real_endpoints(self):
        capabilities = get('capabilities')
        self.assertEqual(capabilities['version'], '2.0.0')
        self.assertIn('counterexample-reduction', capabilities['features'])
        self.assertEqual(capabilities['environment']['compilerRelease'], 21)
        self.assertEqual(capabilities['environment']['encoding'], 'UTF-8')

    def test_02_catalog_has_unique_explained_rules(self):
        rules = get('rules')['rules']
        self.assertEqual(len(rules), 26)
        self.assertEqual(len({r['id'] for r in rules}), len(rules))
        for rule in rules:
            with self.subTest(rule=rule['id']):
                self.assertTrue(rule['explanation'])
                self.assertTrue(rule['recommendation'])
                self.assertIn(rule['severity'], ('info','warning','error'))

    def test_03_project_identity_is_order_independent(self):
        a = {'A.java':'class A {}', 'B.java':'class B {}'}
        b = dict(reversed(list(a.items())))
        self.assertEqual(post('project', {'files':a})['projectHash'],
                         post('project', {'files':b})['projectHash'])
        b['B.java'] = 'class B { int changed; }'
        self.assertNotEqual(post('project', {'files':a})['projectHash'],
                            post('project', {'files':b})['projectHash'])

    def test_04_project_call_graph_resolves_local_calls(self):
        calls = [c for c in self.project['calls'] if c['name']=='countPairs']
        self.assertEqual(len(calls), 1)
        self.assertEqual(len(calls[0]['targets']), 1)
        self.assertTrue(calls[0]['targets'][0].endswith(self.pairs['id']))
        self.assertGreaterEqual(self.project['stats']['branches'], 3)

    def test_05_external_same_name_is_not_local_recursion(self):
        source='class A { static int f(int n){return B.f(n);} } class B { static int f(int n){return n;} }'
        p=post('project',{'files':{'A.java':source}})
        a=next(m for m in p['methods'] if m['owner']=='A')
        self.assertNotEqual(a['complexity'],'Неизвестно')
        self.assertEqual(len(p['calls'][0]['targets']),1)
        self.assertIn('B#f',p['calls'][0]['targets'][0])

    def test_06_recursive_components_are_detected(self):
        source='class Cycle { static int f(int n){return g(n);} static int g(int n){return f(n);} }'
        project=post('project',{'files':{'Cycle.java':source}})
        self.assertEqual(len(project['cycles']),1)
        self.assertEqual(len(project['cycles'][0]),2)

    def test_07_method_graph_dominators_and_paths(self):
        detail=post('method',{'source':PAIR,'methodId':method(self.model,'classify')['id']})
        graph=detail['graph']
        analysis=detail['graphAnalysis']
        self.assertEqual(analysis['scope'],'structural')
        self.assertTrue(analysis['paths'])
        for vertex in analysis['reachable']:
            self.assertIn(graph['entry'],analysis['dominators'][vertex])
        for path in analysis['paths']:
            self.assertEqual(path[0],graph['entry'])

    def test_08_def_use_reports_counter_reads_and_writes(self):
        detail=post('method',{'source':PAIR,'methodId':self.pairs['id']})
        matches=next(v for v in detail['dataFlow']['variables'] if v['name']=='matches')
        self.assertGreater(matches['readCount'],0)
        self.assertGreater(matches['writeCount'],0)
        self.assertFalse(matches['unused'])
        self.assertTrue(any(e['name']=='matches' for e in detail['dataFlow']['edges']))

    def test_09_geometric_loop_has_explained_log_estimate(self):
        source='class Log { static int f(int n){int sum=0;for(int i=1;i<n;i*=2){sum++;}return sum;} }'
        model=post('analyze',{'source':source})
        detail=post('method',{'source':source,'methodId':method(model,'f')['id']})
        self.assertIn('log',detail['complexity']['time'])
        self.assertTrue(detail['complexity']['reasoning'])
        self.assertTrue(detail['complexity']['assumptions'])

    def test_10_sequential_loops_do_not_multiply(self):
        source='class Linear { static int f(int n){int s=0;for(int i=0;i<n;i++)s++;for(int j=0;j<n;j++)s++;return s;} }'
        model=post('analyze',{'source':source})
        detail=post('method',{'source':source,'methodId':method(model,'f')['id']})
        self.assertEqual(detail['complexity']['polynomial'],1)
        self.assertEqual(detail['complexity']['time'],'O(n)')

    def test_11_recursion_is_explicitly_unknown(self):
        source='class Rec { static int f(int n){return n==0?0:f(n-1);} }'
        model=post('analyze',{'source':source})
        detail=post('method',{'source':source,'methodId':method(model,'f')['id']})
        self.assertTrue(detail['complexity']['unknown'])

    def test_12_refactor_plan_is_source_bound_and_gate_required(self):
        self.assertEqual(len(self.plans['sourceHash']),64)
        self.assertTrue(self.plan['requiresGate'])
        self.assertIn('f²',self.plan['rationale'])
        self.assertNotEqual(self.plan['before'],self.plan['after'])
        self.assertTrue(compare(FILES,{'PairAnalyzer.java':self.after},['0\n','4\n1 2 1 2\n'])['passed'])

    def test_13_stale_plan_is_rejected(self):
        self.assert_bad_request('plans/apply',{'source':PAIR+'\n',
            'sourceHash':self.plans['sourceHash'],'planIds':[self.plan['id']]},'STALE_SOURCE')

    def test_14_unknown_plan_is_rejected(self):
        self.assert_bad_request('plans/apply',{'source':PAIR,
            'sourceHash':self.plans['sourceHash'],'planIds':['invented']})

    def test_15_overlapping_plans_are_rejected(self):
        source='class Overlap { static int f(int n){if(n>0){return 1+2;}else{return 3;}} }'
        plans=post('plans',{'source':source})
        self.assertGreaterEqual(len(plans['plans']),2)
        self.assert_bad_request('plans/apply',{'source':source,'sourceHash':plans['sourceHash'],
            'planIds':[p['id'] for p in plans['plans']]},'OVERLAPPING_PLANS')

    def test_16_string_builder_preserves_null_element_text(self):
        source='''public class Join {
            static String join(String[] values){String s="";for(String v:values){s+=v;}return s;}
            public static void main(String[] a){System.out.print(join(new String[]{"а",null,"b"}));}
        }'''
        plans=post('plans',{'source':source})
        plan=next(p for p in plans['plans'] if p['rule']=='string-builder')
        after=post('plans/apply',{'source':source,'sourceHash':plans['sourceHash'],'planIds':[plan['id']]})['source']
        result=compare({'Join.java':source},{'Join.java':after},[''])
        self.assertTrue(result['passed'],result)
        self.assertEqual(result['tests'][0]['candidate']['stdout'],'аnullb')

    def test_17_constant_folding_retains_int_overflow(self):
        source='public class Fold { public static void main(String[] a){System.out.print(2147483647 + 1);} }'
        plans=post('plans',{'source':source})
        fold=next(p for p in plans['plans'] if p['rule']=='integer-fold')
        self.assertEqual(fold['after'],'(-2147483648)')
        after=post('plans/apply',{'source':source,'sourceHash':plans['sourceHash'],'planIds':[fold['id']]})['source']
        self.assertTrue(compare({'Fold.java':source},{'Fold.java':after},[''])['passed'])

    def test_18_zero_divisor_is_not_folded(self):
        plans=post('plans',{'source':'class Zero { int f(){return 3 / 0;} }'})
        self.assertFalse(any(p['rule']=='integer-fold' for p in plans['plans']))

    def test_19_constant_branch_and_guard_clause_compile(self):
        samples=[
            'public class Branch {public static void main(String[] a){if(true){System.out.print("A");}else{System.out.print("B");}}}',
            'public class Branch {static int f(int n){if(n>0){return 2;}else{return 3;}}public static void main(String[] a){System.out.print(f(1)+f(0));}}'
        ]
        for source in samples:
            with self.subTest(source=source):
                plans=post('plans',{'source':source})
                selected=next(p for p in plans['plans'] if p['rule'] in ('constant-branch','guard-clause'))
                after=post('plans/apply',{'source':source,'sourceHash':plans['sourceHash'],'planIds':[selected['id']]})['source']
                self.assertTrue(compare({'Branch.java':source},{'Branch.java':after},[''])['passed'])

    def test_20_rule_engine_catches_control_flow_risks(self):
        source='''class Risk {
            public static int exposed;
            int f(int n){try{return n;}catch(Exception e){return 0;}finally{return 3;}}
            int g(){throw null;}
        }'''
        project=post('project',{'files':{'Risk.java':source}})
        rules={f['rule'] for f in project['findings']}
        self.assertTrue({'BP101','BP102','BP111','BP120'} <= rules)

    def test_21_sarif_has_locations_and_rule_descriptions(self):
        sarif=post('sarif',{'files':FILES})
        self.assertEqual(sarif['version'],'2.1.0')
        run=sarif['runs'][0]
        self.assertTrue(run['tool']['driver']['rules'])
        self.assertTrue(run['results'])
        for result in run['results']:
            location=result['locations'][0]['physicalLocation']
            self.assertEqual(location['artifactLocation']['uri'],'PairAnalyzer.java')
            self.assertGreaterEqual(location['region']['startLine'],1)

    def test_22_seeded_generator_is_reproducible(self):
        spec={'schema':'int-array','seed':75000,'count':12,'maximumLength':20,'minimum':-7,'maximum':7}
        a=post('inputs/generate',spec)
        b=post('inputs/generate',spec)
        self.assertEqual(a['inputs'],b['inputs'])
        self.assertEqual(a['seed'],75000)
        for text in a['inputs']:
            tokens=text.split()
            self.assertEqual(int(tokens[0]),len(tokens)-1)
            self.assertTrue(all(-7<=int(v)<=7 for v in tokens[1:]))

    def test_23_generator_handles_entire_int_domain(self):
        result=post('inputs/generate',{'minimum':-2147483648,'maximum':2147483647,'count':8})
        self.assertEqual(len(result['inputs']),8)
        self.assertIn('-2147483648',result['inputs'][1])
        self.assertIn('2147483647',result['inputs'][2])

    def test_24_generator_validates_limits_and_schema(self):
        for spec in ({'count':31},{'count':2},{'maximumLength':10000},{'minimum':5,'maximum':1},{'schema':'unknown'}):
            with self.subTest(spec=spec):
                self.assert_bad_request('inputs/generate',spec)

    def test_25_async_comparison_has_events_and_source_hashes(self):
        completed=job('compare',original=FILES,candidate={'PairAnalyzer.java':self.after},inputs=['0\n','3\n1 1 2\n'])
        self.assertTrue(completed['result']['passed'])
        self.assertTrue(completed['events'])
        self.assertNotEqual(completed['result']['baselineHash'],completed['result']['candidateHash'])
        evidence=post('evidence',{'original':FILES,'candidate':{'PairAnalyzer.java':self.after},'jobId':completed['id']})
        self.assertEqual(evidence['status'],'source-bound-run')
        self.assertTrue(evidence['passed'])

    def test_26_evidence_cannot_bind_another_candidate(self):
        completed=job('compare',original=FILES,candidate=FILES,inputs=['0\n'])
        evidence=post('evidence',{'original':FILES,'candidate':{'PairAnalyzer.java':self.after},'jobId':completed['id']})
        self.assertEqual(evidence['status'],'unverified-export')
        self.assertFalse(evidence['passed'])

    def test_27_export_without_job_never_claims_verified(self):
        evidence=post('evidence',{'original':FILES,'candidate':FILES})
        self.assertFalse(evidence['passed'])
        self.assertEqual(evidence['status'],'unverified-export')
        self.assertEqual(len(evidence['manifest']),2)

    def test_28_mutation_proposals_have_real_spans(self):
        proposed=post('mutants',{'source':PAIR,'methodId':self.pairs['id']})
        self.assertGreaterEqual(len(proposed['mutants']),3)
        source_bytes=PAIR.encode('utf-16-le')
        for mutant in proposed['mutants']:
            self.assertEqual(source_bytes[mutant['start']*2:mutant['end']*2].decode('utf-16-le'),mutant['before'])
            self.assertNotEqual(mutant['before'],mutant['after'])

    def test_29_mutation_score_comes_from_execution(self):
        completed=job('mutation',files=FILES,fileName='PairAnalyzer.java',methodId=self.pairs['id'],inputs=['0\n','1\n7\n'],maximum=3)
        result=completed['result']
        self.assertEqual(len(result['mutants']),3)
        self.assertGreater(result['killed'],0)
        self.assertEqual(result['killed']+result['survived']+result['invalid'],3)
        self.assertTrue(all(m['status'] in ('killed','survived','invalid') for m in result['mutants']))

    def test_30_reducer_keeps_real_divergence(self):
        changed={'PairAnalyzer.java':PAIR.replace('if (a == b)','if (a != b)')}
        completed=job('minimize',original=FILES,candidate=changed,input='6\n7 3 7 -1 0 12\n',budget=12)
        result=completed['result']
        self.assertTrue(result['stillFails'])
        self.assertLess(result['afterLength'],result['beforeLength'])
        self.assertGreaterEqual(result['afterLength'],1)
        self.assertLessEqual(result['attempts'],12)
        self.assertNotEqual(result['baseline']['stdoutSha256'],result['candidate']['stdoutSha256'])

    def test_31_reducer_rejects_non_failing_or_wrong_schema(self):
        wrong=await_job(post('jobs/submit',{'kind':'minimize','original':FILES,'candidate':FILES,'input':'2\n1\n','budget':4}))
        self.assertEqual(wrong['state'],'failed')
        same=await_job(post('jobs/submit',{'kind':'minimize','original':FILES,'candidate':FILES,'input':'1\n1\n','budget':4}))
        self.assertEqual(same['state'],'failed')

    def test_32_benchmark_excludes_startup_and_returns_real_samples(self):
        completed=job('benchmark',original=FILES,candidate={'PairAnalyzer.java':self.after},fileName='PairAnalyzer.java',methodName='countPairs',sizes=[32,128],repetitions=3)
        result=completed['result']
        self.assertEqual(len(result['comparison']),2)
        self.assertEqual(result['warmups'],3)
        self.assertIn('inside',result['clock'])
        for measurement in result['baseline']['measurements']:
            self.assertEqual(len(measurement['samples']),3)
            self.assertGreater(measurement['medianNs'],0)
        self.assertTrue(all(p['sameResult'] for p in result['comparison']))

    def test_33_benchmark_refuses_wrong_signature(self):
        result=await_job(post('jobs/submit',{'kind':'benchmark','original':FILES,'candidate':FILES,
            'fileName':'PairAnalyzer.java','methodName':'classify','sizes':[32],'repetitions':3}))
        self.assertEqual(result['state'],'failed')

    def test_34_job_cancellation_reaches_terminal_state(self):
        source='public class Wait {public static void main(String[] a){while(true){}}}'
        submitted=post('jobs/submit',{'kind':'compare','original':{'Wait.java':source},'candidate':{'Wait.java':source},'inputs':['']})
        cancelled=post('jobs/cancel',{'id':submitted['id']})
        self.assertEqual(cancelled['state'],'cancelled')
        self.assertTrue(get('jobs/'+submitted['id'])['cancelled'])

    def test_35_unknown_job_and_kind_are_rejected(self):
        self.assert_bad_request('jobs/submit',{'kind':'shell'})
        self.assert_bad_request('jobs/cancel',{'id':'not-a-job'})

    def test_36_json_numbers_remain_integral_and_strict(self):
        raw_cases=['{"count":01}','{"count":+1}','{"seed":1e999}']
        for raw in raw_cases:
            request=urllib.request.Request(BASE+'/api/inputs/generate',data=raw.encode(),headers={'Content-Type':'application/json'})
            with self.subTest(raw=raw):
                with self.assertRaises(urllib.error.HTTPError) as caught:
                    urllib.request.urlopen(request,timeout=10)
                self.assertEqual(caught.exception.code,400)


if __name__ == '__main__':
    stream=io.StringIO()
    suite=unittest.defaultTestLoader.loadTestsFromTestCase(StudioContracts)
    result=unittest.TextTestRunner(stream=stream,verbosity=2).run(suite)
    output=stream.getvalue()
    print(output,end='')
    (ROOT/'docs/studio-integration.log').write_text(output,encoding='utf-8')
    (ROOT/'docs/studio-test-summary.json').write_text(json.dumps({
        'tests':result.testsRun,'failures':len(result.failures),'errors':len(result.errors),
        'passed':result.wasSuccessful()},indent=2),encoding='utf-8')
    raise SystemExit(0 if result.wasSuccessful() else 1)
