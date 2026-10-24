"""Package official Electron + linked Java + authored IDE into portable Windows artifacts."""
from pathlib import Path
import hashlib
import json
import os
import shutil
import subprocess
import sys
import zipfile
from prepare_desktop_runtime import prepare_runtime

ROOT = Path(__file__).resolve().parents[1]
RELEASE = ROOT / 'output' / 'desktop'
APP = RELEASE / 'BlueprintsIDE'

def run(args):
    subprocess.run([str(arg) for arg in args], cwd=ROOT, check=True)

def safe_reset(folder):
    resolved = folder.resolve()
    if not resolved.is_relative_to(RELEASE.resolve()) or resolved == RELEASE.resolve():
        raise RuntimeError('Refusing to remove a folder outside the release directory')
    if folder.exists():
        shutil.rmtree(folder)

def copy_tree(source, destination):
    shutil.copytree(source, destination, dirs_exist_ok=True,
                    ignore=shutil.ignore_patterns('__pycache__', '*.log', '*.zip', '*.tar.gz', '.DS_Store'))

def main():
    if os.name != 'nt':
        raise RuntimeError('This release builder targets Windows x64')
    RELEASE.mkdir(parents=True, exist_ok=True)
    run([sys.executable, ROOT / 'tests/build_icon.py'])
    electron = ROOT / '.runtime/electron/unpacked'
    if not (electron / 'electron.exe').is_file():
        run([sys.executable, ROOT / 'tests/download_electron.py'])
    jdk = next((ROOT / '.runtime').glob('jdk-*'))
    runtime = prepare_runtime()
    (ROOT / 'build').mkdir(exist_ok=True)
    run([jdk / 'bin/javac.exe', '--release', '21', '-encoding', 'UTF-8', '-d', ROOT / 'build', *sorted((ROOT / 'src').glob('*.java'))])
    safe_reset(APP)
    copy_tree(electron, APP)
    (APP / 'electron.exe').rename(APP / 'BlueprintsIDE.exe')
    destination = APP / 'resources/app'
    copy_tree(ROOT / 'desktop', destination)
    (destination / 'Launcher.cs').unlink(missing_ok=True)
    copy_tree(ROOT / 'web', destination / 'engine/web')
    run([sys.executable, ROOT / 'tests/package_solution.py', '--embedded'])
    shutil.copy2(ROOT / 'tmp/Blueprints-app-source.zip', destination / 'engine/web/java-blueprints-source.zip')
    copy_tree(ROOT / 'build', destination / 'engine/build')
    copy_tree(runtime, destination / 'engine/runtime')
    copy_tree(ROOT / 'examples', APP / 'examples')
    shutil.copy2(ROOT / 'docs/electron-runtime.json', APP / 'electron-runtime.json')
    instructions = ('Blueprints IDE 3 — Windows 10/11 x64\n\n'
                    '1. Откройте BlueprintsIDE.exe. Java уже включена.\n'
                    '2. Нажмите «Открыть папку» и выберите Java-проект.\n'
                    '3. Откройте .java файл, выберите метод и читайте блупринт.\n'
                    '4. Для запуска сохраните изменения и нажмите F5.\n\n'
                    'Обычные Java-проекты до 300 файлов компилируются встроенным javac.\n'
                    'Maven/Gradle можно просматривать; зависимости автоматически не загружаются.\n'
                    'Выполняйте только программы, которым доверяете: локальный запуск не является песочницей.\n'
                    'Другие языки: Coming soon. Интернет для работы IDE не нужен.\n'
                    'EXE не подписан коммерческим сертификатом. Сверяйте SHA256SUMS.txt.\n')
    (APP / 'ПРОЧТИ-МЕНЯ.txt').write_text(instructions, encoding='utf-8-sig')
    license_dir = APP / 'licenses'
    license_dir.mkdir(exist_ok=True)
    for name in ['LICENSE', 'LICENSES.chromium.html']:
        if (electron / name).exists():
            shutil.copy2(electron / name, license_dir / name)
    copy_tree(runtime / 'legal', license_dir / 'java')
    archive = RELEASE / 'Blueprints-IDE-3-Windows-x64.zip'
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zipped:
        for file in sorted(APP.rglob('*')):
            if file.is_file():
                zipped.write(file, file.relative_to(APP).as_posix())
    with zipfile.ZipFile(archive) as zipped:
        if zipped.testzip() is not None:
            raise RuntimeError('Portable archive integrity check failed')
        assert 'BlueprintsIDE.exe' in zipped.namelist()
        assert 'resources/app/engine/runtime/bin/javac.exe' in zipped.namelist()
    compiler = Path(os.environ.get('WINDIR', r'C:\Windows')) / 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
    executable = RELEASE / 'Blueprints-IDE-3.exe'
    run([compiler, '/nologo', '/target:winexe', '/platform:x64', '/optimize+',
         '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll',
         '/reference:System.IO.Compression.dll', '/reference:System.IO.Compression.FileSystem.dll',
         f'/resource:{archive},BlueprintsPayload', f'/win32icon:{ROOT / "desktop/assets/blueprints.ico"}', f'/out:{executable}', ROOT / 'desktop/Launcher.cs'])
    records = []
    for file in [archive, executable]:
        with file.open('rb') as stream:
            digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        records.append({'file': file.name, 'bytes': file.stat().st_size, 'sha256': digest})
    (RELEASE / 'SHA256SUMS.txt').write_text(''.join(f"{item['sha256']}  {item['file']}\n" for item in records), encoding='ascii')
    summary = {'version': '3.0.0', 'platform': 'Windows 10/11 x64', 'java': '21.0.12.1+1',
               'electron': json.loads((ROOT / 'docs/electron-runtime.json').read_text())['version'],
               'codeSigned': False, 'artifacts': records,
               'runtimeBundled': True, 'automaticDependencyDownload': False}
    (ROOT / 'docs/desktop-release.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)

if __name__ == '__main__':
    main()
