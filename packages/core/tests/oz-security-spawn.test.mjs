import assert from 'node:assert/strict';
import { chmod, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { launchCocoderSubprocess } from 'oz-daemon';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const ozDaemonSrcDir = path.join(repoRoot, 'packages/oz-daemon/src');

const FORBIDDEN_PATTERNS = [
  { label: 'shell: true', pattern: /shell\s*:\s*true/ },
  { label: 'bash -lc', pattern: /\bbash\s+-lc\b/ },
  { label: 'bash -c', pattern: /\bbash\s+-c\b/ },
  { label: 'exec(', pattern: /\bexec\s*\(/ },
  { label: 'execSync(', pattern: /\bexecSync\s*\(/ },
  { label: 'spawn(`', pattern: /\bspawn\s*\(\s*`/ },
  { label: 'exec(`', pattern: /\bexec\s*\(\s*`/ },
  { label: 'execSync(`', pattern: /\bexecSync\s*\(\s*`/ }
];

async function listSourceFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listSourceFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.ts')) files.push(fullPath);
  }
  return files;
}

async function assertNoForbiddenShellPatterns() {
  const files = await listSourceFiles(ozDaemonSrcDir);
  const violations = [];
  for (const filePath of files) {
    const content = await readFile(filePath, 'utf8');
    const lines = content.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      for (const rule of FORBIDDEN_PATTERNS) {
        if (rule.pattern.test(line)) {
          violations.push(`${path.relative(repoRoot, filePath)}:${index + 1} forbids ${rule.label} → ${line.trim()}`);
        }
      }
    }
  }
  assert.equal(violations.length, 0, violations.join('\n'));
}

test('C-S7: oz-daemon source forbids shell-string subprocess patterns', async () => {
  await assertNoForbiddenShellPatterns();
});

test('C-S7: launcher passes workspace paths with spaces via argv without shell mangling', async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'cocoder-oz-spawn-'));
  const mockBin = path.join(tmpDir, 'mock-cocoder.mjs');
  await writeFile(
    mockBin,
    [
      '#!/usr/bin/env node',
      'process.stdout.write(JSON.stringify(process.argv.slice(2)));'
    ].join('\n')
  );
  await chmod(mockBin, 0o755);

  const workspacePath = path.join(tmpDir, 'my workspace', 'Sample App');
  const expectedArgv = ['launch', '--workspace-root', workspacePath, '--priority-slug', 'v0.1-foundation'];

  const argv = await launchCocoderSubprocess({
    cocoderBin: process.execPath,
    args: [mockBin, ...expectedArgv]
  });

  assert.deepEqual(argv, expectedArgv);
});
