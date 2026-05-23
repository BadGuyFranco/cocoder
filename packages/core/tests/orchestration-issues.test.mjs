import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { composeLaunchDryRun } from '../lib/composition.mjs';
import { launchRun } from '../lib/launch.mjs';
import {
  blockingPriorityBoundaryIssues,
  routePriorityIssue
} from '../lib/orchestration-issues.mjs';
import {
  compactTimestamp,
  getLane,
  parseBooleanFlag,
  safeName
} from '../lib/lib-utils.mjs';

const repoRoot = path.resolve(process.cwd(), '../..');
const contractsDir = path.join(repoRoot, 'packages/core/contracts');

test('routePriorityIssue returns canonical {code, severity, detail} shape', () => {
  assert.equal(routePriorityIssue({ id: 'route-a', supportedPriorityOwners: [] }, 'any'), null);
  assert.equal(routePriorityIssue({ id: 'route-a', supportedPriorityOwners: ['*'] }, 'any'), null);
  assert.equal(routePriorityIssue({ id: 'route-a', supportedPriorityOwners: ['foo'] }, 'foo'), null);

  const issue = routePriorityIssue({ id: 'route-a', supportedPriorityOwners: ['foo'] }, 'bar');
  assert.deepEqual(issue, {
    code: 'priority-owner-not-supported',
    severity: 'block',
    detail: 'route route-a does not list bar in supportedPriorityOwners'
  });
});

test('blockingPriorityBoundaryIssues filters missing-boundary warnings', () => {
  assert.deepEqual(blockingPriorityBoundaryIssues(null), []);
  assert.deepEqual(blockingPriorityBoundaryIssues({ ok: true }), []);
  assert.deepEqual(
    blockingPriorityBoundaryIssues({
      ok: false,
      issues: [
        { code: 'priority-boundary-missing', detail: 'warn' },
        { code: 'priority-boundary-block', detail: 'block' }
      ]
    }),
    [{ code: 'priority-boundary-block', detail: 'block' }]
  );
});

test('parseBooleanFlag covers the value matrix', () => {
  assert.equal(parseBooleanFlag(true), true);
  assert.equal(parseBooleanFlag('true'), true);
  assert.equal(parseBooleanFlag('1'), true);
  assert.equal(parseBooleanFlag(false), false);
  assert.equal(parseBooleanFlag('false'), false);
  assert.equal(parseBooleanFlag('0'), false);
  assert.equal(parseBooleanFlag(undefined), false);
  assert.equal(parseBooleanFlag(null), false);
  assert.equal(parseBooleanFlag(undefined, true), true);
  assert.equal(parseBooleanFlag('maybe', true), true);
});

test('lib-utils helpers behave consistently', () => {
  assert.equal(safeName('lane/foo bar'), 'lane-foo-bar');
  assert.deepEqual(getLane({ oscar: { persona: 'oscar' } }, 'oscar'), { persona: 'oscar' });
  assert.equal(compactTimestamp('2026-05-23T12:34:56.789Z'), '20260523T123456Z');
});

test('compose-launch and launch share routePriorityIssue severity via canonical helper', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'cocoder-orchestration-issues-'));
  try {
    const routesDir = path.join(tmp, 'routes');
    await mkdir(routesDir, { recursive: true });
    const routePath = path.join(routesDir, 'limited.route.json');
    const baseRoute = JSON.parse(await readFile(path.join(repoRoot, 'cocoder/routes/dogfood-port-tests.json'), 'utf8'));
    baseRoute.supportedPriorityOwners = ['v0.1-foundation'];
    await writeFile(routePath, `${JSON.stringify(baseRoute, null, 2)}\n`);

    const priorityFile = path.join(repoRoot, 'cocoder/PRIORITIES.md');
    const sessionLogFile = path.join(repoRoot, 'cocoder/SESSION_LOG.md');
    const adaptersDir = path.join(repoRoot, 'packages/core/adapters');
    const profilePath = path.join(repoRoot, 'cocoder/profiles/cocoder-dogfood.profile.json');
    const boundariesDir = path.join(repoRoot, 'cocoder/priority-boundaries');

    const composeResult = await composeLaunchDryRun({
      profilePath,
      routePath,
      adaptersDir,
      contractsDir,
      priorityFile,
      prioritySlug: 'NOT-A-SUPPORTED-OWNER',
      priorityBoundariesDir: boundariesDir,
      sessionLogFile,
      sessionLineLimit: 5
    });

    const runsDir = path.join(tmp, 'runs');
    await mkdir(runsDir, { recursive: true });
    const launchResult = await launchRun({
      profilePath,
      routePath,
      adaptersDir,
      contractsDir,
      priorityFile,
      prioritySlug: 'NOT-A-SUPPORTED-OWNER',
      priorityBoundariesDir: boundariesDir,
      sessionLogFile,
      sessionLineLimit: 5,
      runsDir,
      execute: false,
      runId: 'run-issue-shape-test',
      cwd: repoRoot
    });

    const expected = routePriorityIssue(baseRoute, 'NOT-A-SUPPORTED-OWNER');
    const composeIssue = composeResult.issues.find((item) => item.code === 'priority-owner-not-supported');
    const launchIssue = launchResult.issues.find((item) => item.code === 'priority-owner-not-supported');
    assert.deepEqual(composeIssue, expected);
    assert.deepEqual(launchIssue, expected);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
