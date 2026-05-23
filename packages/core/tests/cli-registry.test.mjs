import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { promisify } from 'node:util';
import { HELP_TEXT, helpListedCommands } from '../cli/help.mjs';
import { commandRegistry, registeredCommandNames } from '../cli/registry.mjs';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const baselineHelpPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures/cli-help-baseline.txt'
);

test('commandRegistry includes every help-listed primary command', () => {
  const listed = helpListedCommands();
  for (const name of listed) {
    assert.equal(commandRegistry.has(name), true, `missing registry entry for ${name}`);
  }
});

test('registeredCommandNames covers every registry handler key', () => {
  assert.deepEqual(new Set(registeredCommandNames), new Set(commandRegistry.keys()));
});

test('prepare-debug alias resolves to prepare-debugger handler', () => {
  assert.equal(commandRegistry.get('prepare-debug'), commandRegistry.get('prepare-debugger'));
});

test('help text matches tracked CLI help baseline byte-for-byte', async () => {
  const baseline = await readFile(baselineHelpPath, 'utf8');
  assert.equal(`${HELP_TEXT}\n`, baseline);
});

test('core cli --help matches tracked CLI help baseline byte-for-byte', async () => {
  const baseline = await readFile(baselineHelpPath, 'utf8');
  const cliPath = path.join(repoRoot, 'packages/core/cli.mjs');
  const { stdout } = await execFileAsync(process.execPath, [cliPath, '--help'], {
    cwd: repoRoot,
    maxBuffer: 1024 * 1024
  });
  assert.equal(stdout, baseline);
});
