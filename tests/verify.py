"""One command: compile, unit tests, real JVM API contracts, source audit. Python stdlib only."""
from pathlib import Path
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]

def executable(name):
    suffix = '.exe' if os.name == 'nt' else ''
    if name in ('java', 'javac'):
        homes = [Path(os.environ.get('JAVA_HOME', '/nonexistent'))]
        homes += list((ROOT / '.runtime').glob('jdk*'))
        for home in homes:
            candidate = home / 'bin' / (name + suffix)
            if candidate.is_file():
                return str(candidate)
    if name == 'node' and os.environ.get('NODE_BINARY'):
        return os.environ['NODE_BINARY']
    found = shutil.which(name)
    if not found:
        raise RuntimeError(f'{name} is required. See README.md.')
    return found

def run(arguments, env=None, log=None):
    result = subprocess.run(arguments, cwd=ROOT, env=env, text=True, encoding='utf-8',
                            errors='replace', stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    print(result.stdout, end='', flush=True)
    if log:
        (ROOT / 'docs' / log).write_text(result.stdout, encoding='utf-8')
    if result.returncode:
        raise RuntimeError(f'Check failed: {arguments[0]} (exit {result.returncode})')
    return result.stdout

def main():
    started = time.monotonic()
    (ROOT / 'build').mkdir(exist_ok=True)
    run([executable('javac'), '--release', '21', '-encoding', 'UTF-8', '-d', 'build',
         *[str(path) for path in sorted((ROOT / 'src').glob('*.java'))]])
    unit_output = run([executable('node'), '--test', '--test-reporter=tap',
                       *[str(path) for path in sorted((ROOT / 'tests/unit').glob('*.test.mjs'))]], log='unit-tests.log')
    unit = {key: int(re.search(rf'^# {key} (\d+)', unit_output, re.M).group(1)) for key in ('tests', 'pass', 'fail')}
    unit['passed'] = unit['tests'] == unit['pass'] and unit['fail'] == 0
    (ROOT / 'docs/unit-test-summary.json').write_text(json.dumps(unit, indent=2), encoding='utf-8')
    environment = {**os.environ, 'BLUEPRINTS_RUNNER': 'local', 'PORT': '18080',
                   'BLUEPRINTS_URL': 'http://localhost:18080', 'PYTHONIOENCODING': 'utf-8'}
    with (ROOT / 'docs/verification-server.log').open('w', encoding='utf-8') as log:
        server = subprocess.Popen([executable('java'), '-Xmx512m', '-cp', 'build', 'BlueprintServer'],
                                  cwd=ROOT, env=environment, stdout=log, stderr=log)
        try:
            for attempt in range(80):
                if server.poll() is not None:
                    raise RuntimeError('Verification server exited; see verification-server.log')
                try:
                    with urllib.request.urlopen(environment['BLUEPRINTS_URL'] + '/api/health', timeout=1) as response:
                        if json.load(response)['status'] == 'ok':
                            break
                except OSError:
                    time.sleep(0.1)
            else:
                raise RuntimeError('Verification server did not become ready')
            run([sys.executable, 'tests/test_api.py'], env=environment, log='integration.log')
            run([sys.executable, 'tests/test_studio_api.py'], env=environment, log='studio-integration.log')
            run([sys.executable, 'tests/test_ide_api.py'], env=environment, log='ide-integration.log')
        finally:
            server.terminate()
            try:
                server.wait(timeout=8)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait(timeout=8)
    run([sys.executable, 'tests/source_audit.py'])
    desktop = None
    if os.name == 'nt' and (ROOT / '.runtime/desktop-java/bin/java.exe').is_file():
        run([executable('node'), 'tests/desktop-runtime.mjs'], log='desktop-runtime.log')
        desktop = json.loads((ROOT / 'docs/desktop-runtime-summary.json').read_text(encoding='utf-8'))
    legacy = json.loads((ROOT / 'docs/test-summary.json').read_text())
    studio = json.loads((ROOT / 'docs/studio-test-summary.json').read_text())
    ide = json.loads((ROOT / 'docs/ide-test-summary.json').read_text())
    summary = {'passed': unit['passed'] and legacy['passed'] and studio['passed'] and ide['passed'],
               'tests': unit['tests'] + legacy['tests'] + studio['tests'] + ide['tests'] + (desktop['tests'] if desktop else 0),
               'unit': unit, 'api': legacy, 'studioApi': studio, 'ideApi': ide,
               'desktopRuntime': desktop,
               'durationSeconds': round(time.monotonic() - started, 2),
               'environment': {'python': sys.version.split()[0], 'platform': sys.platform,
                               'runner': 'trusted-local', 'dockerTested': False}}
    (ROOT / 'docs/verification-summary.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')
    assert summary['passed']
    print(f"VERIFIED {summary['tests']}/{summary['tests']} tests in {summary['durationSeconds']} seconds")

if __name__ == '__main__':
    main()
