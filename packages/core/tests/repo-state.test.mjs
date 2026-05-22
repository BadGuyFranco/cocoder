import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { auditAddLaneOrchestrationState } from '../lib/repo-state.mjs';

const execFileAsync = promisify(execFile);

test('add-lanes repo audit warns on unstaged orchestration dirt and blocks staged orchestration dirt', async () => {
  const fixture = await createGitFixture();
  try {
    await writeFile(path.join(fixture.repo, 'packages/core/cli.mjs'), 'unstaged change\n');
    const unstaged = await auditAddLaneOrchestrationState({ repoRoot: fixture.repo });
    assert.equal(unstaged.ok, true, JSON.stringify(unstaged.issues, null, 2));
    assert.equal(unstaged.warnings[0].code, 'dirty-durable-orchestration-state');
    assert.deepEqual(unstaged.dirtyFiles, ['packages/core/cli.mjs']);

    await git(fixture.repo, ['add', '--', 'packages/core/cli.mjs']);
    const staged = await auditAddLaneOrchestrationState({ repoRoot: fixture.repo });
    assert.equal(staged.ok, false);
    assert.equal(staged.issues[0].code, 'staged-durable-orchestration-state');
    assert.deepEqual(staged.stagedFiles, ['packages/core/cli.mjs']);
  } finally {
    await fixture.cleanup();
  }
});

async function createGitFixture() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'cocoder-repo-state-'));
  const repo = path.join(tmp, 'repo');
  await mkdir(path.join(repo, 'packages/core'), { recursive: true });
  await writeFile(path.join(repo, 'packages/core/cli.mjs'), 'base\n');
  await git(repo, ['init']);
  await git(repo, ['config', 'user.email', 'repo-state@example.test']);
  await git(repo, ['config', 'user.name', 'Repo State Test']);
  await git(repo, ['add', '--', '.']);
  await git(repo, ['commit', '-m', 'initial']);
  return {
    repo,
    cleanup: () => rm(tmp, { recursive: true, force: true })
  };
}

async function git(repo, args) {
  const result = await execFileAsync('git', ['-C', repo, ...args], { maxBuffer: 1024 * 1024 });
  return result.stdout;
}
