"""Portable source archive; excludes runtimes, credentials, Git and recursive zips."""
from pathlib import Path
import shutil
import zipfile
import sys

root=Path(__file__).resolve().parents[1]
output=root/'output'
output.mkdir(exist_ok=True)
files=[]
embedded = '--embedded' in sys.argv
for folder in ['src','web','desktop','examples','tests','docs','.github']:
    for p in (root/folder).rglob('*'):
        if not p.is_file() or '__pycache__' in p.parts or p.suffix in ['.zip','.log']:
            continue
        if embedded and (p.name == 'desktop-release.json' or p.name.startswith('desktop-smoke-')):
            continue
        files.append(p)
for name in ['README.md','README-BUILDER.md','README-EXPERT.md','.gitignore','.gitattributes','start.ps1','start.sh','start-local.cmd','start-ide.cmd','Dockerfile','compose.yaml']:
    files.append(root/name)
files.append(output/'pdf/Java-Blueprints-solution.pdf')
target=(root/'tmp/Blueprints-app-source.zip') if embedded else output/'Java-Blueprints-complete.zip'
target.parent.mkdir(exist_ok=True, parents=True)
with zipfile.ZipFile(target,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
    for p in sorted(files):archive.write(p,'java-blueprints/'+p.relative_to(root).as_posix())
with zipfile.ZipFile(target) as archive:
    assert archive.testzip() is None
    assert 'java-blueprints/src/BlueprintServer.java' in archive.namelist()
    assert not any('.runtime/' in n or '/.git/' in n for n in archive.namelist())
    assert archive.read('java-blueprints/output/pdf/Java-Blueprints-solution.pdf') == (output/'pdf/Java-Blueprints-solution.pdf').read_bytes()
    assert 'java-blueprints/.github/workflows/verify.yml' in archive.namelist()
    assert 'java-blueprints/docs/verification-summary.json' in archive.namelist()
if not embedded:
    shutil.copyfile(target,root/'web/java-blueprints-source.zip')
print(target, target.stat().st_size,'bytes;',len(files),'files; ZIP verified')
