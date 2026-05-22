#!/usr/bin/env node
import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

const roots = ['cli.mjs', 'lib', 'checks', 'quinn', 'scripts'];
const files = [];

for (const root of roots) {
  await collect(path.resolve(root));
}

for (const file of files.sort()) {
  await check(file);
}

async function collect(target) {
  const entries = await readdir(target, { withFileTypes: true }).catch(() => []);
  if (entries.length === 0 && target.endsWith('.mjs')) {
    files.push(target);
    return;
  }
  for (const entry of entries) {
    const filePath = path.join(target, entry.name);
    if (entry.isDirectory()) await collect(filePath);
    else if (entry.isFile() && entry.name.endsWith('.mjs')) files.push(filePath);
  }
}

async function check(file) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--check', file], { stdio: 'inherit' });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`node --check failed for ${file}`));
    });
  });
}
