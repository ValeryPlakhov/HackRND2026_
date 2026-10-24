"""Launch the real Windows binary and wait for renderer, preload IPC and bundled JVM."""
from pathlib import Path
import json
import os
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]

def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else 'portable'
    binaries = {
        'development': [ROOT / '.runtime/electron/unpacked/electron.exe', ROOT / 'desktop'],
        'portable': [ROOT / 'output/desktop/BlueprintsIDE/BlueprintsIDE.exe'],
        'single-exe': [ROOT / 'output/desktop/Blueprints-IDE-3.exe'],
    }
    arguments = [str(item) for item in binaries[mode]]
    report = ROOT / 'docs' / f'desktop-smoke-{mode}.json'
    report.unlink(missing_ok=True)
    profile = ROOT / 'tmp' / ('electron-smoke-' + mode)
    profile.mkdir(parents=True, exist_ok=True)
    arguments += ['--smoke-test', '--user-data-dir=' + str(profile)]
    environment = {**os.environ, 'BLUEPRINTS_SMOKE_REPORT': str(report), 'BLUEPRINTS_SMOKE_PROFILE': str(profile)}
    environment.pop('ELECTRON_RUN_AS_NODE', None)
    startup = subprocess.STARTUPINFO()
    startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    startup.wShowWindow = 0
    started = time.monotonic()
    process = subprocess.Popen(arguments, cwd=ROOT, env=environment, startupinfo=startup,
                               stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    try:
        output, _ = process.communicate(timeout=120)
    except subprocess.TimeoutExpired:
        process.kill()
        output, _ = process.communicate()
        raise RuntimeError('Desktop smoke test timed out: ' + output.decode('utf-8', 'replace')[-4000:])
    text = output.decode('utf-8', 'replace')
    (ROOT / 'docs' / f'desktop-smoke-{mode}.log').write_text(text, encoding='utf-8')
    if process.returncode != 0 or not report.exists():
        raise RuntimeError(f'Desktop smoke failed ({process.returncode}): {text[-6000:]}')
    result = json.loads(report.read_text(encoding='utf-8'))
    assert result['passed'] is True
    result['mode'] = mode
    result['durationSeconds'] = round(time.monotonic() - started, 2)
    result['binary'] = str(binaries[mode][0].relative_to(ROOT))
    report.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(result, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()
