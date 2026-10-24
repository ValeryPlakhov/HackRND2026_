"""Link a complete Java SE 21 image with compiler and local HTTP service."""
from pathlib import Path
import json
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
MODULES = 'java.se,jdk.compiler,jdk.httpserver,jdk.zipfs,jdk.unsupported,jdk.charsets,jdk.crypto.ec,jdk.localedata'

def prepare_runtime():
    jdk = next((ROOT / '.runtime').glob('jdk-*'))
    runtime = ROOT / '.runtime/desktop-java'
    current = ''
    if (runtime / 'bin/java.exe').exists():
        result = subprocess.run([str(runtime / 'bin/java.exe'), '--list-modules'], capture_output=True, text=True)
        current = result.stdout
    if not all(name + '@' in current for name in ['java.se', 'java.desktop', 'java.sql', 'java.xml', 'jdk.compiler', 'jdk.charsets']):
        resolved = runtime.resolve()
        allowed = (ROOT / '.runtime').resolve()
        if not resolved.is_relative_to(allowed) or resolved == allowed:
            raise RuntimeError('Runtime path escaped the project cache')
        print('Rebuilding verified runtime cache: ' + str(resolved), flush=True)
        if runtime.exists():
            shutil.rmtree(runtime)
        subprocess.run([str(jdk / 'bin/jlink.exe'), '--add-modules', MODULES,
                        '--strip-debug', '--no-header-files', '--no-man-pages', '--compress=zip-6',
                        '--output', str(runtime)], check=True)
    modules = subprocess.check_output([str(runtime / 'bin/java.exe'), '--list-modules'], text=True).splitlines()
    receipt = {'java': '21', 'rootModules': MODULES.split(','), 'modules': modules, 'fullJavaSe': True}
    (ROOT / 'docs/java-runtime.json').write_text(json.dumps(receipt, indent=2), encoding='utf-8')
    return runtime

if __name__ == '__main__':
    print(prepare_runtime())
