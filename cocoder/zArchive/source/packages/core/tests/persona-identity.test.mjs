import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { renderLanePrompt } from '../lib/launch.mjs';

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

async function loadFixtureLaunchPlan() {
  const raw = await readFile(path.join(fixtureDir, 'bob-dogfood.launch-plan.json'), 'utf8');
  return JSON.parse(hydrate(raw, repoRoot));
}

async function loadFixtureContext() {
  return JSON.parse(await readFile(path.join(fixtureDir, 'bob-dogfood.expected-context.json'), 'utf8'));
}

test('renderLanePrompt matches bob dogfood persona-identity fixture byte-for-byte', async () => {
  const context = await loadFixtureContext();
  const launchPlan = await loadFixtureLaunchPlan();
  const expected = await loadFixturePrompt();
  const session = launchPlan.sessions.find((item) => item.lane === context.lane);
  assert.ok(session, 'fixture launch plan must include bob session');

  const rendered = await renderLanePrompt(launchPlan, session);
  assert.equal(rendered, expected);
});

test('negative control: one-character priority slug in display label fails byte comparison', async () => {
  const launchPlan = await loadFixtureLaunchPlan();
  const expected = await loadFixturePrompt();
  const session = launchPlan.sessions.find((item) => item.lane === 'bob');
  const rendered = await renderLanePrompt(launchPlan, session);
  const mutated = expected.replace('v0.1-foundation', 'v0.1-foundatioX');
  assert.notEqual(rendered, mutated);
});

test('fixture context records manifest version and dogfood route metadata', async () => {
  const context = await loadFixtureContext();
  assert.equal(context.prioritySlug, 'v0.1-foundation');
  assert.equal(context.routeId, 'dogfood-port-tests');
  assert.equal(context.profileId, 'cocoder-dogfood');
  assert.equal(context.manifestVersion, 1);
  assert.equal(context.lane, 'bob');
});
