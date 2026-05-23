import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { launchRun } from '../lib/launch.mjs';

const REPO_ROOT_TOKEN = '__REPO_ROOT__';
const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '../../..');
const fixtureDir = path.join(testDir, 'fixtures/persona-identity');

function hydrate(text, root) {
  return text.replaceAll(REPO_ROOT_TOKEN, root);
}

async function loadFixturePrompt() {
  return hydrate(await readFile(path.join(fixtureDir, 'bob-dogfood.expected-prompt.md'), 'utf8'), repoRoot);
}

async function loadFixtureContext() {
  return JSON.parse(await readFile(path.join(fixtureDir, 'bob-dogfood.expected-context.json'), 'utf8'));
}

async function renderBobPromptViaLaunch(context, overrides = {}) {
  const runsDir = path.join(repoRoot, 'local/workspaces/cocoder-dogfood-fixture/runs');
  const runId = overrides.runId || context.runId;
  await rm(path.join(runsDir, runId), { recursive: true, force: true });
  const result = await launchRun({
    profilePath: path.join(repoRoot, context.profilePath),
    routePath: path.join(repoRoot, context.routePath),
    adaptersDir: path.join(repoRoot, 'packages/core/adapters'),
    contractsDir: path.join(repoRoot, 'packages/core/contracts'),
    priorityFile: path.join(repoRoot, context.priorityFile),
    prioritySlug: overrides.prioritySlug || context.prioritySlug,
    priorityBoundariesDir: path.join(repoRoot, context.priorityBoundariesDir),
    sessionLogFile: path.join(repoRoot, context.sessionLogFile),
    sessionLineLimit: context.sessionLineLimit,
    runsDir,
    runId,
    cwd: repoRoot,
    execute: false,
    allowConcurrentPriorityRun: true
  });
  return result;
}

test('launchRun bob prompt matches persona-identity fixture byte-for-byte', async () => {
  const context = await loadFixtureContext();
  const expected = await loadFixturePrompt();
  const result = await renderBobPromptViaLaunch(context);
  assert.equal(result.ok, true, JSON.stringify(result, null, 2));
  const rendered = await readFile(result.sessions.find((item) => item.lane === 'bob').promptPath, 'utf8');
  assert.equal(rendered, expected);
});

test('negative control: one-character priority slug produces different bob prompt', async () => {
  const context = await loadFixtureContext();
  const expected = await loadFixturePrompt();
  const result = await renderBobPromptViaLaunch(context, {
    runId: 'run-fixture-persona-identity-negative',
    prioritySlug: 'v0.1-foundatioX'
  });

  if (result.ok) {
    const rendered = await readFile(result.sessions.find((item) => item.lane === 'bob').promptPath, 'utf8');
    assert.notEqual(rendered, expected);
    return;
  }

  assert.notEqual(result.ok, true, 'expected either different prompt or blocked launch for mutated slug');
});

test('fixture context records manifest version and dogfood route metadata', async () => {
  const context = await loadFixtureContext();
  assert.equal(context.prioritySlug, 'v0.1-foundation');
  assert.equal(context.routeId, 'dogfood-port-tests');
  assert.equal(context.profileId, 'cocoder-dogfood');
  assert.equal(context.manifestVersion, 1);
  assert.equal(context.lane, 'bob');
});
