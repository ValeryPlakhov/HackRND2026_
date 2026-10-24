"""Portable source archive; excludes runtimes, credentials, Git and build outputs."""
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parents[1]
output = root / 'output'
output.mkdir(exist_ok=True)
files = []
for folder in ['src', 'web', 'desktop', 'examples', 'tests', 'docs', '.github']:
    for p in (root / folder).rglob('*'):
        if not p.is_file() or '__pycache__' in p.parts or p.suffix in ['.zip', '.log']:
            continue
        files.append(p)
for name in ['README.md', '.gitignore', '.gitattributes', 'start.ps1', 'start.sh', 'start-local.cmd',
             'start-ide.cmd', 'Dockerfile', 'compose.yaml']:
    files.append(root / name)
target = output / 'Java-Blueprints-source.zip'
with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for p in sorted(files):
        archive.write(p, 'java-blueprints/' + p.relative_to(root).as_posix())
with zipfile.ZipFile(target) as archive:
    assert archive.testzip() is None
    names = archive.namelist()
    assert 'java-blueprints/src/BlueprintServer.java' in names
    assert 'java-blueprints/web/ide.html' in names
    assert 'java-blueprints/examples/shop-monolith/blueprints-tests.json' in names
    assert not any('.runtime/' in n or '/.git/' in n or '/output/' in n for n in names)
print(target, target.stat().st_size, 'bytes;', len(files), 'files; ZIP verified')
