"""Capture complete Studio examples from the real JVM API; never synthesize pass flags."""
import json
import time
from pathlib import Path
from test_api import post, ROOT

def get(route):
    import urllib.request
    with urllib.request.urlopen('http://localhost:8080/api/' + route, timeout=60) as response:
        return json.load(response)

def run_job(kind, **payload):
    submitted = post('jobs/submit', dict(kind=kind, **payload))
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        job = get('jobs/' + submitted['id'])
        if job['state'] == 'completed':
            return job['result']
        if job['state'] in ('failed', 'cancelled'):
            raise RuntimeError(job.get('error') or job['state'])
        time.sleep(0.1)
    raise TimeoutError('Demo job exceeded 180 seconds')

def stage(files):
    project = post('project', {'files':files})
    details = {}
    plans = {}
    for name, source in files.items():
        details[name] = {}
        plans[name] = post('plans', {'source':source})
        for method in project['files'][name]['methods']:
            details[name][method['id']] = post('method', {'source':source, 'methodId':method['id']})
    return {'files':files, 'project':project, 'details':details, 'plans':plans,
            'sarif':post('sarif', {'files':files})}

PAIR_INPUTS = ['0\n','1\n7\n','5\n1 2 1 2 1\n',
    '6\n-3 0 -3 2147483647 -2147483648 0\n','-1\n',
    '8\n4 4 4 4 4 4 4 4\n','4\n1 2\n','10\n0 1 2 3 4 5 6 7 8 9\n']
TITLES = ['Пустой набор','Один элемент','Повторяющиеся значения','Границы int',
          'Некорректный размер','Все элементы одинаковы','Неполный ввод','Различные значения']

def create_sample(filename, title, method_name, rule, inputs, benchmark=True):
    source = (ROOT/'examples'/filename).read_text(encoding='utf-8')
    files = {filename:source}
    before = stage(files)
    proposal = next(plan for plan in before['plans'][filename]['plans'] if plan['rule'] == rule)
    patched = post('plans/apply', {'source':source,
        'sourceHash':before['plans'][filename]['sourceHash'], 'planIds':[proposal['id']]})
    after_files = {filename:patched['source']}
    after = stage(after_files)
    report = run_job('compare', original=files, candidate=after_files, inputs=inputs)
    assert report['passed'], report
    result = {'title':title, 'primaryMethod':method_name, 'primaryPlanRule':rule,
        'before':before, 'after':after, 'report':report,
        'cases':[{'id':f'demo-{i}', 'name':TITLES[i] if i<len(TITLES) else f'Вход {i+1}',
                  'input':value,'category':'boundary' if i<5 else 'sample','enabled':True}
                 for i,value in enumerate(inputs)]}
    if benchmark:
        result['benchmark'] = run_job('benchmark', original=files,candidate=after_files,
            fileName=filename,methodName=method_name,sizes=[128,1024,4096],repetitions=5)
        method = next(m for m in before['project']['files'][filename]['methods'] if m['name']==method_name)
        result['mutations'] = run_job('mutation',files=files,fileName=filename,
            methodId=method['id'],inputs=inputs[:5],maximum=5)
        broken = {filename:source.replace('if (a == b)', 'if (a != b)')}
        result['reduction'] = run_job('minimize',original=files,candidate=broken,
            input='6\n7 3 7 -1 0 12\n',budget=16)
        assert result['reduction']['stillFails']
    return result

if __name__ == '__main__':
    samples = {}
    for identity, filename, title in [
        ('pairs','PairAnalyzer.java','Pair Analyzer'),
        ('monolith','LargeMonolith.java','Monolith / 1K'),
    ]:
        print('Capturing', identity, flush=True)
        samples[identity] = create_sample(filename,title,'countPairs','histogram-pairs',PAIR_INPUTS)
    print('Capturing text pipeline',flush=True)
    samples['text'] = create_sample('TextPipeline.java','Text Pipeline','join','string-builder',
        ['0\n','1\nhello\n','3\nПривет мир !\n','-1\n','4\na б c д\n'],False)
    document = {'schemaVersion':2,'environment':get('capabilities')['environment'],'samples':samples}
    destination=ROOT/'web/studio-demo.json'
    destination.write_text(json.dumps(document,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    (ROOT/'docs/studio-reference-results.json').write_text(json.dumps({
        key:{'passed':value['report']['passed'],'inputs':len(value['report']['tests']),
             'benchmark':value.get('benchmark',{}).get('comparison'),
             'mutationScore':value.get('mutations',{}).get('score'),
             'reduction':{k:value.get('reduction',{}).get(k) for k in ('beforeLength','afterLength','stillFails')}}
        for key,value in samples.items()},ensure_ascii=False,indent=2),encoding='utf-8')
    print('Saved',destination,destination.stat().st_size,'bytes')
