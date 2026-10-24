import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../../..');
const roots = [path.join(root, 'backend')];
const skipDirs = new Set(['node_modules', 'build', '.git']);

function findTestFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (skipDirs.has(entry.name)) continue;
      files.push(...findTestFiles(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.test.ts')) {
      files.push(path.relative(root, fullPath));
    }
  }

  return files;
}

const files = roots.flatMap((dir) => findTestFiles(dir));

if (files.length === 0) {
  console.error('Nenhum arquivo de teste encontrado');
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [
    '--import',
    'tsx',
    '--import',
    './backend/src/test/preload.ts',
    '--test',
    '--test-concurrency=1',
    ...files,
  ],
  { cwd: root, stdio: 'inherit' },
);

process.exit(result.status ?? 1);
