#!/usr/bin/env node
import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const filter = process.argv[2];
const coreDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testsDir = path.join(coreDir, 'tests');
const files = filter === 'config-resolver'
  ? [path.join(testsDir, 'config-resolver.test.mjs')]
  : (await readdir(testsDir)).filter((file) => file.endsWith('.test.mjs')).sort().map((file) => path.join(testsDir, file));

const child = spawn(process.execPath, ['--test', ...files], { cwd: coreDir, stdio: 'inherit' });
child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});
