// Audit §4 E2.2e.12 — port of upstream launch-command.test.mjs.
//
// All 6 tests in this file are currently skipped via `test.skip(...)`. They
// assert behavior of three macOS double-click wrapper scripts that CoCoder
// intentionally dropped during the CoBuilder extraction:
//
//   cocoder/Launch-Orchestrator.command
//   cocoder/ORCH DEBUGGER.command
//   cocoder/Stop-Orchestrator-Run.command
//
// Whether to restore those wrappers (so the CLI is double-clickable for
// non-terminal users) or retire that surface entirely (since
// `pnpm exec cocoder launch ...` is the documented invocation today) is a
// founder-level product decision tracked at:
//
//   cocoder/tickets/open/0001-cocoder-command-wrapper-decision.md
//
// When that ticket resolves, this file should either:
//   - have the .command files restored under cocoder/ and the skip markers
//     removed (decision "restore"), or
//   - have the wrapper-validity tests removed entirely and the file pruned
//     down to coverage that does not depend on the wrappers (decision
//     "retire"), or
//   - be deleted entirely if the decision is "retire and accept the lost
//     coverage".
//
// The port is preserved here (rather than dropped) so the test infrastructure
// is ready the moment the founder decision lands.

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(process.cwd(), '../..');
const launcher = path.join(repoRoot, 'cocoder/Launch-Orchestrator.command');
const debuggerLauncher = path.join(repoRoot, 'cocoder/ORCH DEBUGGER.command');
const stopper = path.join(repoRoot, 'cocoder/Stop-Orchestrator-Run.command');

test.skip('debugger double-click wrapper is valid zsh', async () => {
  const result = await execFileAsync('zsh', ['-n', debuggerLauncher], { cwd: repoRoot });
  assert.equal(result.stderr, '');
});

test.skip('debugger launcher always enables git authority without prompting', async () => {
  const source = await readFile(debuggerLauncher, 'utf8');
  assert.match(source, /COCODER_ORCH_DEBUGGER_GIT_WRITE/);
  assert.match(source, /COCODER_ORCH_DEBUGGER_GIT_WRITE="true"/);
  assert.match(source, /export COCODER_ORCH_DEBUGGER_GIT_WRITE/);
  assert.match(source, /Debugger git authority: ENABLED/);
  assert.doesNotMatch(source, /read "git_choice\?Git authority \[1\]: "/);
  assert.match(source, /Debugger git authority: disabled/);
});

test.skip('stopper double-click wrapper is valid zsh', async () => {
  const result = await execFileAsync('zsh', ['-n', stopper], { cwd: repoRoot });
  assert.equal(result.stderr, '');
});

test.skip('launcher offers explicit no-priority consults and no custom slug option', async () => {
  const source = await readFile(launcher, 'utf8');
  assert.match(source, /COCODER_ORCH_TERMINAL_COLUMNS:-120/);
  assert.match(source, /COCODER_ORCH_TERMINAL_ROWS:-40/);
  assert.match(source, /COCODER_ORCH_LAUNCHER_COLUMNS:-220/);
  assert.match(source, /COCODER_ORCH_LAUNCHER_ROWS:-45/);
  assert.match(source, /OSCAR-CONSULT/);
  assert.match(source, /IAN-CONSULT/);
  assert.match(source, /mode: no-priority-consult/);
  assert.match(source, /WARN rows launch with advisory startup warnings/);
  assert.match(source, /True blockers still fail before terminal attach/);
  assert.match(source, /next atom drift: Last updated/);
  assert.match(source, /Launch warning for/);
  assert.match(source, /carry this warning in the startup packet and lane prompts/);
  assert.match(source, /Oscar bootstrap is the default route/);
  assert.match(source, /claude-oscar-dynamic\.json/);
  assert.doesNotMatch(source, /Custom priority slug/);
  assert.doesNotMatch(source, /custom_slug/);
});

test.skip('debugger launcher lists numbered runs with priority context', async () => {
  const source = await readFile(debuggerLauncher, 'utf8');
  assert.match(source, /COCODER_ORCH_DEBUGGER_COLUMNS:-120/);
  assert.match(source, /COCODER_ORCH_DEBUGGER_ROWS:-40/);
  assert.match(source, /\[RUN\]/);
  assert.match(source, /Priority/);
  assert.doesNotMatch(source, /"Live"/);
  assert.doesNotMatch(source, /live_state"\)/);
  assert.doesNotMatch(source, /stale-run/);
  assert.match(source, /completedTtlMs = 5 \* 60 \* 60 \* 1000/);
  assert.match(source, /if \(isCompletedStatus && !isRecentCompleted\) continue/);
  assert.match(source, /if \(normalizedStatus === 'running' && !isRunningCandidate\) continue/);
  assert.match(source, /completedPriorities/);
  assert.match(source, /Running run-backed sessions:/);
  assert.match(source, /Completed run-backed sessions \(last 5 hours, newest per priority\):/);
  assert.match(source, /------------------------------------------------------------------------/);
  assert.match(source, /selectedPriority/);
  assert.match(source, /RUN_ENTRIES/);
  assert.match(source, /No running or recent completed run-backed orchestration sessions found/);
  assert.match(source, /A    Show other run artifacts/);
  assert.match(source, /N    Debug launch failure without a run\/session/);
  assert.match(source, /P    Run launch preflight debugger without a run\/session/);
  assert.match(source, /S    Audit orchestration repo state without a run\/session/);
  assert.match(source, /--no-session true/);
  assert.match(source, /Type a number from the list/);
  assert.doesNotMatch(source, /read -r run_id priority status route updated/);
});

test.skip('double-click wrapper prints structured launch failure before exiting nonzero', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'cocoder-launch-command-'));
  try {
    const fakeNode = path.join(tmp, 'node');
    await mkdir(tmp, { recursive: true });
    await writeFile(fakeNode, [
      '#!/usr/bin/env bash',
      'if [[ "$*" == *"packages/core/cli.mjs launch"* ]]; then',
      '  echo \'{"ok":false,"status":"non-ready","issues":[{"code":"priority-boundary-missing"}]}\'',
      '  exit 1',
      'fi',
      'exec "$REAL_NODE" "$@"',
      ''
    ].join('\n'));
    await chmod(fakeNode, 0o755);

    let error;
    try {
      await execFileAsync('zsh', [launcher, 'DOCS-REBUILD'], {
        cwd: repoRoot,
        env: {
          ...process.env,
          COCODER_ORCH_EXECUTE: 'false',
          REAL_NODE: process.execPath,
          PATH: `${tmp}:${process.env.PATH || ''}`
        }
      });
    } catch (caught) {
      error = caught;
    }

    assert.ok(error, 'wrapper should exit nonzero when launch is blocked');
    assert.match(error.stdout, /"ok":false/);
    assert.match(error.stdout, /priority-boundary-missing/);
    assert.match(error.stdout, /Launch blocked or failed before terminal attach/);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
