"""Fetch a pinned official Electron archive and verify upstream SHA-256."""
from pathlib import Path
import hashlib
import json
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
VERSION = '45.0.0'
NAME = f'electron-v{VERSION}-win32-x64.zip'
BASE = f'https://github.com/electron/electron/releases/download/v{VERSION}/'

def fetch(url, destination):
    request = urllib.request.Request(url, headers={'User-Agent': 'Blueprints-IDE-build/3.0'})
    with urllib.request.urlopen(request, timeout=120) as source, destination.open('wb') as target:
        while chunk := source.read(1024 * 1024):
            target.write(chunk)

def main():
    cache = ROOT / '.runtime' / 'electron'
    cache.mkdir(parents=True, exist_ok=True)
    sums = cache / 'SHASUMS256.txt'
    fetch(BASE + 'SHASUMS256.txt', sums)
    expected = next(line.split()[0] for line in sums.read_text().splitlines()
                    if line.split()[-1].lstrip('*') == NAME)
    archive = cache / NAME
    if not archive.exists() or hashlib.file_digest(archive.open('rb'), 'sha256').hexdigest() != expected:
        fetch(BASE + NAME, archive)
    actual = hashlib.file_digest(archive.open('rb'), 'sha256').hexdigest()
    if actual != expected:
        raise RuntimeError('Electron archive checksum mismatch')
    target = cache / 'unpacked'
    target.mkdir(exist_ok=True)
    with zipfile.ZipFile(archive) as zipped:
        for member in zipped.infolist():
            resolved = (target / member.filename).resolve()
            if not resolved.is_relative_to(target.resolve()):
                raise RuntimeError('Unsafe archive path')
        zipped.extractall(target)
    receipt = {'version': VERSION, 'platform': 'win32-x64', 'url': BASE + NAME,
               'sha256': actual, 'verifiedAgainst': BASE + 'SHASUMS256.txt'}
    (ROOT / 'docs' / 'electron-runtime.json').write_text(json.dumps(receipt, indent=2), encoding='utf-8')
    print(json.dumps(receipt), flush=True)

if __name__ == '__main__':
    main()
