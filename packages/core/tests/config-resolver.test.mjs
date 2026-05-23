import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { deepMerge, resolveConfig } from '../lib/config.mjs';
import { planWorkspaceMerge } from '../lib/init-merge.mjs';
import { resolvePathToken, tokenizePath, workspaceIdentity } from '../lib/paths.mjs';

test('config resolver honors documented load order with workspace-private override winning', async () => {
  const root = await fixtureRoot();
  const workspace = path.join(root, 'workspaces', 'app');
  await writeStructured(path.join(root, 'templates/install-local/config.example.yaml'), [
    'version: "0.1"',
    'defaults:',
    '  adapter: codex',
    '  profile: base',
    'oz:',
    '  port: 7878'
  ].join('\n'));
  await writeStructured(path.join(root, 'local/config.yaml'), [
    'defaults:',
    '  adapter: claude',
    'oz:',
    '  port: 49000'
  ].join('\n'));
  await writeStructured(path.join(workspace, 'cocoder/config.yaml'), [
    'defaults:',
    '  profile: workspace',
    'theme:',
    '  mode: dark'
  ].join('\n'));
  await writeStructured(path.join(workspace, 'cocoder/local/overrides.json'), JSON.stringify({
    defaults: { adapter: 'grok' },
    theme: { accent: 'fusion' }
  }, null, 2));

  const result = await resolveConfig({ cocoderHome: root, workspaceRoot: workspace });
  assert.equal(result.config.defaults.adapter, 'grok');
  assert.equal(result.config.defaults.profile, 'workspace');
  assert.equal(result.config.oz.port, 49000);
  assert.equal(result.config.theme.mode, 'dark');
  assert.equal(result.config.theme.accent, 'fusion');
  assert.equal(result.loaded.length, 4);
});

test('array merge semantics replace by default and append only when explicit', () => {
  assert.deepEqual(deepMerge({ lanes: ['oscar'] }, { lanes: ['bob'] }), { lanes: ['bob'] });
  assert.deepEqual(deepMerge({ lanes: ['oscar'] }, { lanes: { __merge: 'append', items: ['bob'] } }), { lanes: ['oscar', 'bob'] });
});

test('git pull survival fixture leaves cocoder/local bytes unchanged', async () => {
  const root = await fixtureRoot();
  const workspace = path.join(root, 'workspaces', 'app');
  const localOverride = path.join(workspace, 'cocoder/local/overrides.json');
  await writeStructured(path.join(workspace, 'cocoder/PRIORITIES.md'), '# User edited priorities\n');
  await writeStructured(localOverride, JSON.stringify({ defaults: { adapter: 'local-only' } }, null, 2));
  const before = await readFile(localOverride, 'utf8');

  await writeStructured(path.join(workspace, 'cocoder/PRIORITIES.md'), '# Simulated tracked update\n');
  await writeStructured(path.join(workspace, 'cocoder/standards/raci.md'), '# New tracked file\n');

  const after = await readFile(localOverride, 'utf8');
  assert.equal(after, before);
});

test('multi-machine registry resolves same workspace identity under different roots', async () => {
  const machineA = await fixtureRoot();
  const machineB = await fixtureRoot();
  const registryEntry = { id: 'sample-app', path: '${root:nas}/SampleApp' };
  const rootsA = { nas: path.join(machineA, 'NAS A') };
  const rootsB = { nas: path.join(machineB, 'NAS B') };

  assert.equal(workspaceIdentity(registryEntry), 'sample-app');
  assert.equal(workspaceIdentity({ ...registryEntry, path: '${root:nas}/different/absolute/root' }), 'sample-app');
  assert.equal(await resolvePathToken(registryEntry.path, { cocoderHome: machineA, roots: rootsA }), path.join(machineA, 'NAS A', 'SampleApp'));
  assert.equal(await resolvePathToken(registryEntry.path, { cocoderHome: machineB, roots: rootsB }), path.join(machineB, 'NAS B', 'SampleApp'));

  const tokenized = await tokenizePath(path.join(machineA, 'NAS A', 'SampleApp'), { cocoderHome: machineA, roots: rootsA });
  assert.equal(tokenized.path, '${root:nas}/SampleApp');
  assert.equal(tokenized.warning, null);
});

test('init merge planner adds new tracked files and preserves user edits', async () => {
  // Template and workspace live in independent tmpdirs (neither nested inside
  // a CoCoder install) so the ADR-0006 nested-workspace belt does not fire.
  const templateRoot = await mkdtemp(path.join(os.tmpdir(), 'cocoder-tpl-'));
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'cocoder-ws-'));
  await writeStructured(path.join(templateRoot, 'cocoder/PRIORITIES.md'), '# Template priorities\n');
  await writeStructured(path.join(templateRoot, 'cocoder/standards/raci.md'), '# RACI\n');
  await writeStructured(path.join(templateRoot, 'cocoder/local/config.example.yaml'), 'version: "0.1"\n');
  await writeStructured(path.join(workspaceRoot, 'cocoder/PRIORITIES.md'), '# User edited priorities\n');

  const plan = await planWorkspaceMerge({ templateDir: templateRoot, workspaceRoot });
  assert.deepEqual(plan.add, ['cocoder/standards/raci.md']);
  assert.deepEqual(plan.preserve, ['cocoder/PRIORITIES.md']);
  assert.equal(plan.actions.some((action) => action.relativePath.startsWith('cocoder/local/')), false);
});

async function fixtureRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cocoder-core-'));
  await mkdir(path.join(root, 'cocoder'), { recursive: true });
  await writeFile(path.join(root, 'ARCHITECTURE.md'), '# Test\n');
  await writeFile(path.join(root, 'cocoder/AGENTS.md'), '# Test\n');
  return root;
}

async function writeStructured(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${content.replace(/\n?$/, '\n')}`);
}
