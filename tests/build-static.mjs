import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'dist');
if (dirname(output) !== root || !output.endsWith('dist')) throw new Error('Unsafe output directory');
rmSync(output, { recursive: true, force: true });
function copyTree(source, destination) {
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.isDirectory()) copyTree(resolve(source, entry.name), resolve(destination, entry.name));
    else if (entry.isFile()) copyFileSync(resolve(source, entry.name), resolve(destination, entry.name));
  }
}
copyTree(resolve(root, 'web'), output);
console.log('Static overview copied to dist/; JVM application remains in src/ and web/.');
