import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const repoRoot = path.resolve(process.cwd(), '../..');
const promptFixtureRoot = await mkdtemp(path.join(repoRoot, 'packages/core/tests/.tmp-launch-prompts-'));
await writePromptFixture(promptFixtureRoot);
process.chdir(promptFixtureRoot);
test.after(async () => {
  process.chdir(repoRoot);
  await rm(promptFixtureRoot, { recursive: true, force: true });
});
const contractsDir = path.join(repoRoot, 'packages/core/contracts');
const execFileAsync = promisify(execFile);
const { processRunContinuation } = await import('../lib/continuation.mjs');
const { finalizeRunStatusFromResults } = await import('../lib/ledger.mjs');
const { addLanesToRun, launchRun, sendMessageToLane, stopRunSessions } = await import('../lib/launch.mjs');

function spawnWithInput(command, args, { cwd, input }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `${command} exited ${code}`));
    });
    child.stdin.end(input);
  });
}

test('launch writes run prompts and helper scripts without tmux unless execute is true', async () => {
  const fixture = await createLaunchFixture();
  try {
    const result = await launchRun(await fixture.options({ execute: false, runId: 'run-launch-dry' }));
    assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
    assert.equal(result.executed, false);
    assert.equal(result.status, 'ready');
    assert.ok(result.helperScripts.oscar.endsWith('send-to-oscar.sh'));
    assert.ok(result.helperScripts.bob.endsWith('send-to-bob.sh'));
    assert.ok(result.completionWatchScripts.oscar.endsWith('watch-oscar-completion.sh'));
    assert.ok(result.completionWatchScripts.bob.endsWith('watch-bob-completion.sh'));
    assert.ok(result.startWatchersScript.endsWith('start-watchers.sh'));

    const launchPlan = JSON.parse(await readFile(path.join(result.runDir, 'launch.json'), 'utf8'));
    const startupPacket = JSON.parse(await readFile(path.join(result.runDir, 'startup-packet.json'), 'utf8'));
    const events = (await readFile(path.join(result.runDir, 'events.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(launchPlan.sessions.length, 2);
    const bobHelper = await readFile(result.helperScripts.bob, 'utf8');
    assert.match(bobHelper, /Usage: \$\(basename "\$0"\) \\"message\\" \| --stdin/);
    assert.match(bobHelper, /if \[ "\$1" = "--stdin" \]; then/);
    assert.match(bobHelper, /send-message --run-dir .* --lane 'bob' --stdin/);
    assert.match(bobHelper, /send-message --run-dir .* --lane 'bob' --message "\$\*"/);
    // 2026-05-27: a no-arg invocation with piped/heredoc stdin (not a TTY) must
    // route to --stdin without the explicit flag (dogfood-surfaced dispatch
    // friction). The `$# -lt 1` block guards the TTY case with usage, otherwise
    // dispatches stdin.
    assert.match(bobHelper, /if \[ "\$#" -lt 1 \]; then\n {2}if \[ -t 0 \]; then[\s\S]*--lane 'bob' --stdin\n {2}exit 0/);
    assert.equal(events[0].type, 'run.created');
    assert.equal(events[0].creationContext.command, 'launch');
    assert.equal(events[0].creationContext.execute, false);
    assert.equal(events[0].creationContext.deferStart, false);
    assert.equal(events[0].creationContext.socketName, 'cocoder-orchestration');
    assert.deepEqual(startupPacket.writeBoundaries, ['docs/']);
    assert.deepEqual(startupPacket.resolvedWriteBoundary.excludedWriteBoundaries, ['packages/core/']);
    assert.equal(launchPlan.sessions[0].wrapperPath.endsWith('launch.sh'), true);
    assert.equal(launchPlan.sessions[0].displayLabel, 'Oscar | Claude Opus | DOCS-REBUILD | dry');
    assert.equal(result.sessions[1].displayLabel, 'Bob | Codex GPT-5.5 | DOCS-REBUILD | dry');
    assert.equal(launchPlan.sessions[0].sessionName, 'orch-oscar-run-launch-dry');
    assert.equal(result.sessions[1].sessionName, 'orch-bob-run-launch-dry');
    assert.equal(launchPlan.sessions[0].width, 120);
    assert.equal(launchPlan.sessions[0].height, 40);
    assert.equal(startupPacket.recentSessionContext.strategy, 'newest-session-entries');
    assert.equal(startupPacket.modelRoles.planning.primary[0].label, 'Claude Opus 4.7');
    assert.equal(startupPacket.modelRoles.planning.audit[0].adapter, 'codex');
    assert.equal(startupPacket.modelRoles.research.primary[0].adapter, 'codex');
    assert.match(startupPacket.recentSessionContext.excerpt, /## 2026-05-19/);
    assert.doesNotMatch(startupPacket.recentSessionContext.excerpt, /stale tail/);
    assert.equal(launchPlan.sessions[0].startupMode, 'lead');
    assert.equal(launchPlan.sessions[1].startupMode, 'wait-for-lead-dispatch');
    assert.equal(result.sessions[1].startupMode, 'wait-for-lead-dispatch');
    const oscarPrompt = await readFile(path.join(result.runDir, 'jobs', 'oscar', 'prompt.md'), 'utf8');
    const bobPrompt = await readFile(path.join(result.runDir, 'jobs', 'bob', 'prompt.md'), 'utf8');
    assert.match(oscarPrompt, /Launch guard: Do not invoke Skill\(\.\.\.\) commands or slash skills during orchestration launch/);
    assert.match(bobPrompt, /Launch guard: Do not invoke Skill\(\.\.\.\) commands or slash skills during orchestration launch/);
    assert.match(oscarPrompt, /startup_mode: lead/);
    assert.match(oscarPrompt, /startup_mode is lead/);
    assert.match(oscarPrompt, /## Lane Result Artifact Contract/);
    assert.match(oscarPrompt, /after either file exists, the runtime refuses further `send-message` dispatches to this lane/);
    assert.match(oscarPrompt, /`routeAvailable` must be a JSON boolean/);
    assert.match(oscarPrompt, /never strings like `"yes"` or `"no"`/);
    assert.match(oscarPrompt, /Do not include upstream packet-authoring/);
    assert.match(oscarPrompt, /## Model Role Policy/);
    assert.match(oscarPrompt, /planning primary: claude opus-4\.7 \(Claude Opus 4\.7\)/);
    assert.match(oscarPrompt, /planning audit: codex gpt-5\.5 \(Codex GPT-5\.5\)/);
    assert.match(oscarPrompt, /research primary: codex gpt-5\.5 \(Codex GPT-5\.5\)/);
    assert.match(oscarPrompt, /Do not silently substitute one role for another/);
    assert.match(oscarPrompt, /planning, research, audit, and synthesis roles do not satisfy builder subagent roles/);
    assert.match(oscarPrompt, /do not restate or override that lane's result identity fields/);
    assert.match(oscarPrompt, /Codex YELLOW review gates are verifier work, not Bob implementation work/);
    assert.match(oscarPrompt, /Never ask Bob to run `codex-review\.sh` when Bob's adapter is `codex`/);
    assert.match(oscarPrompt, /Architecture-invariant atoms cannot close on Bob PASS alone/);
    assert.match(oscarPrompt, /Independent verification means a verifier path that is not Bob and not a Bob-invoked helper/);
    assert.match(bobPrompt, /startup_mode: wait-for-lead-dispatch/);
    assert.match(bobPrompt, /load this prompt and the startup packet for orientation only, then wait for a concrete dispatch from lane oscar/);
    assert.match(bobPrompt, /Do not plan, inspect target files, run verification commands, edit files, or infer a phase from the startup packet alone/);
    assert.match(bobPrompt, /Do not mutate ignored dependency, build, or cache artifacts such as `node_modules\/`, `dist\/`, `\.turbo\/`/);
    assert.match(bobPrompt, /Verification must be reproducible from tracked manifests, lockfiles, and declared commands/);
    assert.match(bobPrompt, /result identity fields in this launch prompt are authoritative/);
    assert.match(bobPrompt, /If a later dispatch message conflicts with them, use this launch prompt/);
    assert.match(oscarPrompt, /prompt-fragment: shared\/startup-packet\.md; order: 1; persona: oscar/);
    assert.match(oscarPrompt, /Plain-English Finding:/);
    assert.match(oscarPrompt, /Session Wrap Fragment/);
    assert.match(bobPrompt, /prompt-fragment: personas\/bob\.md; order: 7; persona: bob/);
    assert.match(bobPrompt, /Do not invoke legacy persona slash skills or `Skill\(\.\.\.\)` commands/);
    assert.match(oscarPrompt, /Completion Watchers/);
    assert.match(oscarPrompt, /startup_packet:/);
    assertFragmentOrder(oscarPrompt, [
      'shared/startup-packet.md',
      'shared/write-boundaries.md',
      'shared/result-contract.md',
      'shared/closeout.md',
      'shared/private-playbook-boundary.md',
      'shared/evidence-classes.md',
      'shared/session-wrap.md',
      'personas/oscar.md'
    ]);
    assertFragmentOrder(bobPrompt, [
      'shared/startup-packet.md',
      'shared/write-boundaries.md',
      'shared/result-contract.md',
      'shared/closeout.md',
      'shared/private-playbook-boundary.md',
      'shared/evidence-classes.md',
      'personas/bob.md'
    ]);
    const oscarWrapper = await readFile(path.join(result.runDir, 'jobs', 'oscar', 'launch.sh'), 'utf8');
    assert.match(oscarWrapper, /BOOTSTRAP=.*Do not invoke Skill\(\.\.\.\) commands or slash skills during orchestration launch/);
    assert.match(oscarWrapper, /BOOTSTRAP=.*Read and follow this CoCoder orchestration launch prompt exactly/);
    assert.match(oscarWrapper, /exec claude -- "\$BOOTSTRAP"/);
    assert.doesNotMatch(oscarWrapper, /cat .*prompt\.md/);
    const bobWrapper = await readFile(path.join(result.runDir, 'jobs', 'bob', 'launch.sh'), 'utf8');
    assert.match(bobWrapper, /exec codex --ask-for-approval never --sandbox workspace-write "\$BOOTSTRAP"/);
    const watcher = await readFile(path.join(result.runDir, 'watch-bob-completion.sh'), 'utf8');
    assert.match(watcher, /node "\$CLI" send-message --run-dir "\$RUN_DIR" --lane "\$LEAD"/);
    assert.match(watcher, /record-supersession/);
    assert.match(watcher, /finalize-run-status/);
    assert.doesNotMatch(watcher, /all launched lanes wrote PASS results/);
    assert.match(watcher, /stable lane result pair/);
    assert.match(watcher, /MARKDOWN_RESULT=/);
    assert.match(watcher, /STABLE_SECONDS=/);
    assert.match(watcher, /notified_lead=0/);
    assert.match(watcher, /--repo-root/);
    assert.doesNotMatch(watcher, /--process-continuation true/);
    assert.doesNotMatch(watcher, /--stop-terminal-sessions true/);
    assert.match(watcher, /is_terminal_finalize/);
    assert.match(watcher, /is_non_running_finalize/);
    assert.match(watcher, /accept\/fresh-run-continuation\/founder-decision/);
    assert.match(watcher, /do not move, rename, archive, overwrite, or clear them to send another packet/);
    assert.match(watcher, /\[ -s "\$RESULT" \] && \[ -s "\$MARKDOWN_RESULT" \]/);
    const leadWatcher = await readFile(path.join(result.runDir, 'watch-oscar-completion.sh'), 'utf8');
    assert.doesNotMatch(leadWatcher, /send-message --run-dir/);
    assert.match(leadWatcher, /finalize-run-status/);
    assert.doesNotMatch(leadWatcher, /--process-continuation true/);
    assert.doesNotMatch(leadWatcher, /--stop-terminal-sessions true/);
    const startWatchers = await readFile(result.startWatchersScript, 'utf8');
    assert.match(startWatchers, /is_terminal_run/);
    assert.match(startWatchers, /Run is terminal; not starting completion watchers/);
    assert.match(startWatchers, /watchers\/bob\.pid/);
    assert.match(startWatchers, /kill -0 "\$\(cat "\$PID_FILE"\)"/);
  } finally {
    await fixture.cleanup();
  }
});

test('launch --attach iterm writes a visible split-pane attach script for all lanes', async () => {
  const fixture = await createLaunchFixture();
  try {
    const transport = recordingTransport();
    const result = await launchRun(await fixture.options({
      execute: true,
      attach: 'iterm',
      runId: 'run-launch-attach-iterm',
      transport,
      socketName: 'cocoder-test',
      tmuxBin: '/bin/tmux'
    }));
    assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
    assert.equal(result.executed, true);
    assert.ok(result.attachLaunchScript && result.attachLaunchScript.endsWith('attach-launch.sh'), 'attachLaunchScript path returned');
    const script = await readFile(result.attachLaunchScript, 'utf8');
    // Opens a fresh terminal window (null target → create-window branch) and
    // attaches one pane per lane to its tmux session on the configured socket.
    assert.match(script, /tell application "iTerm"/);
    assert.match(script, /create window with default profile command/);
    assert.match(script, /SOCKET_ARGS=\('-L' 'cocoder-test'\)/);
    // session names truncate the runId tail, so match the stable orch-<lane>- prefix
    assert.match(script, /attach -t orch-oscar-/);
    assert.match(script, /attach -t orch-bob-/);
  } finally {
    await fixture.cleanup();
  }
});

test('launch without --attach writes no attach-launch script', async () => {
  const fixture = await createLaunchFixture();
  try {
    const transport = recordingTransport();
    const result = await launchRun(await fixture.options({
      execute: true,
      runId: 'run-launch-no-attach',
      transport,
      socketName: 'cocoder-test',
      tmuxBin: '/bin/tmux'
    }));
    assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
    assert.equal(result.attachLaunchScript ?? null, null);
  } finally {
    await fixture.cleanup();
  }
});

test('launch can explicitly allow teammate lanes to start autonomously', async () => {
  const fixture = await createLaunchFixture({ allowAutonomousTeammateStart: true });
  try {
    const result = await launchRun(await fixture.options({ execute: false, runId: 'run-launch-autonomous-teammate' }));
    assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
    const launchPlan = JSON.parse(await readFile(path.join(result.runDir, 'launch.json'), 'utf8'));
    assert.equal(launchPlan.sessions.find((session) => session.lane === 'bob').startupMode, 'autonomous');
    const bobPrompt = await readFile(path.join(result.runDir, 'jobs', 'bob', 'prompt.md'), 'utf8');
    assert.match(bobPrompt, /startup_mode: autonomous/);
    assert.match(bobPrompt, /this route allows this lane to proceed from the generated launch prompt and startup packet/);
  } finally {
    await fixture.cleanup();
  }
});

test('bootstrap topology route launches Oscar only before validated lane addition', async () => {
  const fixture = await createLaunchFixture({ dynamicTopology: true });
  try {
    const result = await launchRun(await fixture.options({ execute: false, runId: 'run-bootstrap-topology' }));
    assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
    assert.deepEqual(result.sessions.map((session) => session.lane), ['oscar']);
    const launchPlan = JSON.parse(await readFile(path.join(result.runDir, 'launch.json'), 'utf8'));
    assert.deepEqual(launchPlan.sessions.map((session) => session.lane), ['oscar']);
    const startupPacket = JSON.parse(await readFile(path.join(result.runDir, 'startup-packet.json'), 'utf8'));
    assert.equal(startupPacket.route.id, 'fixture-claude-oscar-dynamic');
    const oscarPrompt = await readFile(path.join(result.runDir, 'jobs', 'oscar', 'prompt.md'), 'utf8');
    assert.match(oscarPrompt, /## Lead Founder Interaction Guard/);
    assert.match(oscarPrompt, /Do not open Claude Code interactive question UI/);
    assert.match(oscarPrompt, /Do not open interactive pickers, cursor-driven forms, checkbox menus/);
    assert.match(oscarPrompt, /Forbidden founder-decision UI includes terminal lists that say `Enter to select`, `Type something`, `Chat about this`/);
    assert.match(oscarPrompt, /Before `add-lanes`, do not block on low-level implementation mechanics/);
    assert.match(oscarPrompt, /Selecting a declared topology option for an already authorized atom is not a founder decision/);
    assert.match(oscarPrompt, /If orchestration mechanics fail, stop and report/);
    assert.match(oscarPrompt, /## Validated Topology Options/);
    assert.match(oscarPrompt, /primitive-authoring: lanes oscar, phil/);
    assert.match(oscarPrompt, /add-lanes --run-dir/);
  } finally {
    await fixture.cleanup();
  }
});

test('add-lanes writes first-class Phil lane artifacts through a validated topology option', async () => {
  const fixture = await createLaunchFixture({ dynamicTopology: true });
  try {
    const launch = await launchRun(await fixture.options({ execute: false, runId: 'run-add-phil' }));
    const added = await addLanesToRun({
      runDir: launch.runDir,
      lanes: ['phil'],
      topologyOptionId: 'primitive-authoring',
      requiredPersonas: ['phil'],
      reason: 'B3b primitive work needs Phil',
      contractsDir,
      adaptersDir: fixture.adaptersDir,
      priorityBoundariesDir: fixture.boundariesDir,
      repoStateAudit: async () => ({ ok: true, dirtyFiles: [], issues: [] }),
      env: { PATH: process.env.PATH || '' }
    });
    assert.equal(added.ok, true, JSON.stringify(added.issues, null, 2));
    assert.deepEqual(added.sessions.map((session) => session.lane), ['oscar', 'phil']);
    assert.ok(added.helperScripts.phil.endsWith('send-to-phil.sh'));
    assert.ok(added.completionWatchScripts.phil.endsWith('watch-phil-completion.sh'));
    const decision = JSON.parse(await readFile(path.join(launch.runDir, 'topology-decision.json'), 'utf8'));
    assert.equal(decision.status, 'accepted');
    assert.equal(decision.topologyOptionId, 'primitive-authoring');
    assert.equal(decision.checks.laneArtifacts, 'written');
    const philPrompt = await readFile(path.join(launch.runDir, 'jobs', 'phil', 'prompt.md'), 'utf8');
    assert.match(philPrompt, /lane: phil/);
    assert.match(philPrompt, /startup_mode: wait-for-lead-dispatch/);
  } finally {
    await fixture.cleanup();
  }
});

test('add-lanes refuses lanes outside validated topology options', async () => {
  const fixture = await createLaunchFixture({ dynamicTopology: true });
  try {
    const launch = await launchRun(await fixture.options({ execute: false, runId: 'run-add-invalid-lane' }));
    const added = await addLanesToRun({
      runDir: launch.runDir,
      lanes: ['talia'],
      topologyOptionId: 'primitive-authoring',
      contractsDir,
      adaptersDir: fixture.adaptersDir,
      priorityBoundariesDir: fixture.boundariesDir,
      repoStateAudit: async () => ({ ok: true, dirtyFiles: [], issues: [] }),
      env: { PATH: process.env.PATH || '' }
    });
    assert.equal(added.ok, false);
    assert.equal(added.issues.some((issue) => issue.code === 'topology-option-lane-not-allowed'), true);
  } finally {
    await fixture.cleanup();
  }
});

test('add-lanes warns on unrelated unstaged durable orchestration state and still mutates lane group', async () => {
  const fixture = await createLaunchFixture({ dynamicTopology: true });
  try {
    const launch = await launchRun(await fixture.options({ execute: false, runId: 'run-add-dirty-warn' }));
    const added = await addLanesToRun({
      runDir: launch.runDir,
      lanes: ['phil'],
      topologyOptionId: 'primitive-authoring',
      contractsDir,
      adaptersDir: fixture.adaptersDir,
      priorityBoundariesDir: fixture.boundariesDir,
      repoStateAudit: async () => ({
        ok: true,
        dirtyFiles: ['packages/core/routes/dirty.json'],
        warnings: [{ code: 'dirty-durable-orchestration-state', severity: 'warn', detail: 'fixture dirty state' }],
        issues: []
      }),
      env: { PATH: process.env.PATH || '' }
    });
    assert.equal(added.ok, true, JSON.stringify(added.issues, null, 2));
    assert.equal(added.decision.checks.gitState, 'warn');
    assert.equal(added.decision.warnings.some((warning) => warning.code === 'dirty-durable-orchestration-state'), true);
    const launchPlan = JSON.parse(await readFile(path.join(launch.runDir, 'launch.json'), 'utf8'));
    assert.deepEqual(launchPlan.sessions.map((session) => session.lane), ['oscar', 'phil']);
  } finally {
    await fixture.cleanup();
  }
});

test('add-lanes blocks staged durable orchestration state before mutating lane group', async () => {
  const fixture = await createLaunchFixture({ dynamicTopology: true });
  try {
    const launch = await launchRun(await fixture.options({ execute: false, runId: 'run-add-staged-block' }));
    const added = await addLanesToRun({
      runDir: launch.runDir,
      lanes: ['phil'],
      topologyOptionId: 'primitive-authoring',
      contractsDir,
      adaptersDir: fixture.adaptersDir,
      priorityBoundariesDir: fixture.boundariesDir,
      repoStateAudit: async () => ({
        ok: false,
        dirtyFiles: ['packages/core/routes/dirty.json'],
        stagedFiles: ['packages/core/routes/dirty.json'],
        warnings: [{ code: 'dirty-durable-orchestration-state', severity: 'warn', detail: 'fixture dirty state' }],
        issues: [{ code: 'staged-durable-orchestration-state', severity: 'block', detail: 'fixture staged state' }]
      }),
      env: { PATH: process.env.PATH || '' }
    });
    assert.equal(added.ok, false);
    assert.equal(added.issues.some((issue) => issue.code === 'staged-durable-orchestration-state'), true);
    const launchPlan = JSON.parse(await readFile(path.join(launch.runDir, 'launch.json'), 'utf8'));
    assert.deepEqual(launchPlan.sessions.map((session) => session.lane), ['oscar']);
  } finally {
    await fixture.cleanup();
  }
});

test('add-lanes execute reports deferred lane readiness and send-message blocks until start signal', async () => {
  const fixture = await createLaunchFixture({ dynamicTopology: true });
  try {
    const transport = recordingTransport();
    const launch = await launchRun(await fixture.options({
      execute: true,
      deferStart: true,
      runId: 'run-add-bob-deferred',
      transport,
      socketName: 'test-socket',
      tmuxBin: '/bin/tmux'
    }));
    const added = await addLanesToRun({
      runDir: launch.runDir,
      lanes: ['bob'],
      topologyOptionId: 'implementation',
      requiredPersonas: ['bob'],
      reason: 'H1 validates Bob readiness',
      contractsDir,
      adaptersDir: fixture.adaptersDir,
      priorityBoundariesDir: fixture.boundariesDir,
      repoStateAudit: async () => ({ ok: true, dirtyFiles: [], issues: [] }),
      execute: true,
      transport,
      env: { PATH: process.env.PATH || '' }
    });
    assert.equal(added.ok, true, JSON.stringify(added.issues, null, 2));
    assert.equal(added.status, 'waiting_for_visible_attach');
    assert.equal(added.decision.checks.laneReadiness, 'waiting_for_visible_attach');
    assert.equal(added.decision.checks.watchers, 'not-run');
    assert.equal(added.laneReadiness[0].lane, 'bob');
    assert.equal(added.laneReadiness[0].status, 'waiting_for_visible_attach');
    assert.match(added.laneReadiness[0].attachCommand, /attach -t orch-bob-/);
    assert.ok(added.attachAddedLanesScript.endsWith('attach-added-lanes.sh'));
    const attachScript = await readFile(added.attachAddedLanesScript, 'utf8');
    assert.match(attachScript, /split vertically with default profile command/);
    assert.doesNotMatch(attachScript, /create tab with default profile command/);
    assert.doesNotMatch(attachScript, /set baseWindow to current window/);
    assert.match(attachScript, /set targetSessionName to "orch-oscar-/);
    assert.match(attachScript, /list-clients -t "\$TARGET_SESSION" -F "#{client_tty}"/);
    assert.match(attachScript, /set targetTty to system attribute "COCODER_ORCH_TARGET_TTY"/);
    assert.match(attachScript, /candidateTty is targetTty/);
    assert.match(attachScript, /targetTty is "" and \(\(targetSessionName is not "" and candidateContents contains targetSessionName\)/);
    assert.match(attachScript, /candidateName contains targetDisplayLabel/);
    assert.match(attachScript, /create window with default profile command/);
    assert.match(attachScript, /set columns to 120/);
    assert.match(attachScript, /set rows to 40/);
    assert.match(attachScript, /do script .*attach -t orch-bob-/);
    assert.match(attachScript, /TMUX_BIN='\/bin\/tmux'/);
    assert.match(attachScript, /SOCKET_ARGS=\('-L' 'test-socket'\)/);
    assert.match(attachScript, /has-session -t 'orch-bob-/);
    assert.match(attachScript, /Added lane session disappeared before visible attach completed: bob/);
    assert.ok(
      attachScript.indexOf("has-session -t 'orch-bob-") < attachScript.indexOf('jobs/bob/start.signal'),
      'session survival check must run before writing the start signal'
    );
    assert.match(attachScript, /jobs\/bob\/start\.signal/);

    await assert.rejects(
      () => sendMessageToLane({
        runDir: launch.runDir,
        lane: 'bob',
        message: 'start implementation',
        transport
      }),
      /waiting_for_visible_attach/
    );

    await writeFile(added.laneReadiness[0].startSignalPath, '');
    const sent = await sendMessageToLane({
      runDir: launch.runDir,
      lane: 'bob',
      message: 'start implementation',
      transport
    });
    assert.equal(sent.ok, true);
  } finally {
    await fixture.cleanup();
  }
});

test('add-lanes CLI auto-attach path can start deferred lanes after visible attach', async () => {
  const fixture = await createLaunchFixture({ dynamicTopology: true });
  try {
    const transport = recordingTransport();
    const launch = await launchRun(await fixture.options({
      execute: true,
      deferStart: true,
      runId: 'run-add-bob-auto-attach',
      transport,
      socketName: 'test-socket',
      tmuxBin: '/bin/tmux'
    }));
    const visibleAttachCalls = [];
    const startWatchersCalls = [];
    const added = await addLanesToRun({
      runDir: launch.runDir,
      lanes: ['bob'],
      topologyOptionId: 'implementation',
      requiredPersonas: ['bob'],
      reason: 'H6 validates visible attach runner',
      contractsDir,
      adaptersDir: fixture.adaptersDir,
      priorityBoundariesDir: fixture.boundariesDir,
      repoStateAudit: async () => ({ ok: true, dirtyFiles: [], issues: [] }),
      execute: true,
      autoAttachAddedLanes: true,
      visibleAttachRunner: async ({ scriptPath, sessions }) => {
        visibleAttachCalls.push({ scriptPath, lanes: sessions.map((session) => session.lane) });
        for (const session of sessions) await writeFile(session.startSignalPath, '');
        return { ok: true, status: 'attached', attachAddedLanesScript: scriptPath };
      },
      startWatchersRunner: async ({ scriptPath, lanes }) => {
        startWatchersCalls.push({ scriptPath, lanes });
        return { ok: true, status: 'started', startWatchersScript: scriptPath };
      },
      transport,
      env: { PATH: process.env.PATH || '' }
    });

    assert.equal(added.ok, true, JSON.stringify(added.issues, null, 2));
    assert.equal(added.status, 'running');
    assert.equal(added.decision.checks.visibleAttach, 'attached');
    assert.equal(added.decision.checks.laneReadiness, 'ready');
    assert.equal(added.decision.checks.watchers, 'started');
    assert.deepEqual(visibleAttachCalls, [{ scriptPath: added.attachAddedLanesScript, lanes: ['bob'] }]);
    assert.deepEqual(startWatchersCalls, [{ scriptPath: added.startWatchersScript, lanes: ['bob'] }]);
    assert.equal(added.laneReadiness[0].status, 'ready');
  } finally {
    await fixture.cleanup();
  }
});

test('add-lanes readiness covers every dynamic topology option', async () => {
  const cases = [
    { runId: 'run-add-bob-topology', lanes: ['bob'], topologyOptionId: 'implementation', requiredPersonas: ['bob'] },
    { runId: 'run-add-phil-topology', lanes: ['phil'], topologyOptionId: 'primitive-authoring', requiredPersonas: ['phil'] },
    { runId: 'run-add-phil-bob-topology', lanes: ['phil', 'bob'], topologyOptionId: 'primitive-implementation', requiredPersonas: ['phil', 'bob'] },
    { runId: 'run-add-talia-quinn-topology', lanes: ['talia', 'quinn'], topologyOptionId: 'qa-verification', requiredPersonas: ['talia', 'quinn'] }
  ];

  for (const item of cases) {
    const fixture = await createLaunchFixture({ dynamicTopology: true });
    try {
      const transport = recordingTransport();
      const launch = await launchRun(await fixture.options({
        execute: true,
        deferStart: true,
        runId: item.runId,
        transport,
        socketName: 'test-socket',
        tmuxBin: '/bin/tmux'
      }));
      const added = await addLanesToRun({
        runDir: launch.runDir,
        lanes: item.lanes,
        topologyOptionId: item.topologyOptionId,
        requiredPersonas: item.requiredPersonas,
        reason: `H1 validates ${item.topologyOptionId}`,
        contractsDir,
        adaptersDir: fixture.adaptersDir,
        priorityBoundariesDir: fixture.boundariesDir,
        repoStateAudit: async () => ({ ok: true, dirtyFiles: [], issues: [] }),
        execute: true,
        transport,
        env: { PATH: process.env.PATH || '' }
      });
      assert.equal(added.ok, true, JSON.stringify(added.issues, null, 2));
      assert.equal(added.status, 'waiting_for_visible_attach');
      assert.deepEqual(added.laneReadiness.map((entry) => entry.lane).sort(), [...item.lanes].sort());
      assert.equal(added.laneReadiness.every((entry) => entry.status === 'waiting_for_visible_attach'), true);
      assert.equal(added.decision.checks.watchers, 'not-run');
      if (item.lanes.length > 1) {
        const attachScript = await readFile(added.attachAddedLanesScript, 'utf8');
        assert.ok((attachScript.match(/split vertically with default profile command/g) || []).length >= item.lanes.length);
        assert.doesNotMatch(attachScript, /set baseWindow to current window/);
        assert.match(attachScript, /list-clients -t "\$TARGET_SESSION" -F "#{client_tty}"/);
        assert.match(attachScript, /candidateTty is targetTty/);
        assert.match(attachScript, /targetTty is "" and \(\(targetSessionName is not "" and candidateContents contains targetSessionName\)/);
        assert.equal((attachScript.match(/has-session -t 'orch-/g) || []).length, item.lanes.length);
      }
      const decision = JSON.parse(await readFile(path.join(launch.runDir, 'topology-decision.json'), 'utf8'));
      assert.equal(decision.topologyOptionId, item.topologyOptionId);
      assert.equal(decision.checks.laneReadiness, 'waiting_for_visible_attach');
    } finally {
      await fixture.cleanup();
    }
  }
});

test('script-backed Quinn lanes keep a visible holder pane and reject stdin dispatch', async () => {
  const fixture = await createLaunchFixture({ dynamicTopology: true, scriptQuinn: true });
  try {
    const transport = recordingTransport();
    const launch = await launchRun(await fixture.options({
      execute: true,
      deferStart: true,
      runId: 'run-add-quinn-script-holder',
      transport,
      socketName: 'test-socket',
      tmuxBin: '/bin/tmux'
    }));
    const added = await addLanesToRun({
      runDir: launch.runDir,
      lanes: ['talia', 'quinn'],
      topologyOptionId: 'qa-verification',
      requiredPersonas: ['talia', 'quinn'],
      reason: 'H6 validates Quinn script-backed visible holder',
      contractsDir,
      adaptersDir: fixture.adaptersDir,
      priorityBoundariesDir: fixture.boundariesDir,
      repoStateAudit: async () => ({ ok: true, dirtyFiles: [], issues: [] }),
      execute: true,
      autoAttachAddedLanes: true,
      visibleAttachRunner: async ({ scriptPath, sessions }) => {
        for (const session of sessions) await writeFile(session.startSignalPath, '');
        return { ok: true, status: 'attached', attachAddedLanesScript: scriptPath };
      },
      startWatchersRunner: async ({ scriptPath }) => ({ ok: true, status: 'started', startWatchersScript: scriptPath }),
      transport,
      env: { PATH: process.env.PATH || '' }
    });

    assert.equal(added.ok, true, JSON.stringify(added.issues, null, 2));
    assert.equal(added.status, 'running');
    const quinn = added.sessions.find((session) => session.lane === 'quinn');
    assert.equal(quinn.adapter, 'quinn-scripts');
    assert.equal(quinn.adapterCapabilities.interactive, false);
    assert.equal(quinn.adapterCapabilities.stdinDispatch, false);
    const quinnWrapper = await readFile(path.join(launch.runDir, 'jobs', 'quinn', 'launch.sh'), 'utf8');
    assert.match(quinnWrapper, /visibility\/readiness holder only/);
    assert.match(quinnWrapper, /while :; do sleep 3600; done/);
    assert.doesNotMatch(quinnWrapper, /exec node "\$BOOTSTRAP"/);

    await assert.rejects(
      () => sendMessageToLane({
        runDir: launch.runDir,
        lane: 'quinn',
        message: 'run Quinn smoke',
        transport
      }),
      /does not support stdin dispatch/
    );
  } finally {
    await fixture.cleanup();
  }
});

test('route-owned commit prompts forbid writer-lane git commits and describe result-only handoff', async () => {
  const fixture = await createLaunchFixture({ routeDeclaresCommit: true });
  try {
    const result = await launchRun(await fixture.options({ execute: false, runId: 'run-launch-route-owned-commit-prompt' }));
    assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
    const bobPrompt = await readFile(path.join(result.runDir, 'jobs', 'bob', 'prompt.md'), 'utf8');
    assert.match(bobPrompt, /route-owned exact-file commits/);
    assert.match(bobPrompt, /Do not run `git add` or `git commit`/);
    assert.match(bobPrompt, /This lane's route-owned commit scope allows:/);
    assert.match(bobPrompt, /Do not include another lane's implementation files in a lead wrap result/);
    assert.match(bobPrompt, /route-owned `orchestrator-commit` step is the only commit path/);
  } finally {
    await fixture.cleanup();
  }
});

test('route-owned Oscar wrap authority is reflected in generated canWrite metadata', async () => {
  const fixture = await createLaunchFixture({ routeDeclaresOscarWrapCommit: true });
  try {
    const result = await launchRun(await fixture.options({ execute: false, runId: 'run-launch-oscar-wrap-write' }));
    assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
    const launchPlan = JSON.parse(await readFile(path.join(result.runDir, 'launch.json'), 'utf8'));
    const oscarSession = launchPlan.sessions.find((session) => session.lane === 'oscar');
    assert.equal(oscarSession.profileCanWrite, false);
    assert.equal(oscarSession.routeOwnedCommit, true);
    assert.equal(oscarSession.canWrite, true);
    const oscarPrompt = await readFile(path.join(result.runDir, 'jobs', 'oscar', 'prompt.md'), 'utf8');
    assert.match(oscarPrompt, /can_write: true/);
    assert.match(oscarPrompt, /"canWrite": true/);
  } finally {
    await fixture.cleanup();
  }
});

test('launch execute path starts tmux sessions through injected transport and can send lane messages', async () => {
  const fixture = await createLaunchFixture();
  try {
    const transport = recordingTransport();
    const result = await launchRun(await fixture.options({
      execute: true,
      runId: 'run-launch-live',
      transport,
      socketName: 'test-socket',
      tmuxBin: '/bin/tmux'
    }));
    assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
    assert.equal(result.executed, true);
    assert.equal(result.status, 'running');
    assert.equal(transport.calls.filter((call) => call.includes('new-session')).length, 2);
    assert.equal(transport.calls.filter((call) => call.includes('new-session') && call.includes('-x 120 -y 40')).length, 2);
    assert.equal(transport.calls.filter((call) => call.includes('rename-window')).length, 2);
    assert.equal(transport.calls.filter((call) => call.includes('set-titles-string')).length, 2);
    assert.equal(transport.calls.filter((call) => call.includes('paste-buffer')).length, 0);

    const sent = await sendMessageToLane({
      runDir: result.runDir,
      lane: 'bob',
      message: 'hello bob',
      transport
    });
    assert.equal(sent.ok, true);
    assert.equal(transport.calls.filter((call) => call.includes('send-keys')).length, 2);
    assert.equal(transport.calls.some((call) => call.includes('send-keys') && call.includes('C-u')), true);
    assert.equal(transport.calls.some((call) => call.includes('send-keys') && call.includes('C-m')), true);
  } finally {
    await fixture.cleanup();
  }
});

test('send-message blocks direct git add or commit instructions for route-owned commit lanes', async () => {
  const fixture = await createLaunchFixture({ routeDeclaresCommit: true });
  try {
    const transport = recordingTransport();
    const launch = await launchRun(await fixture.options({
      execute: true,
      runId: 'run-send-route-owned-git-block',
      transport,
      socketName: 'test-socket'
    }));

    await assert.rejects(
      () => sendMessageToLane({
        runDir: launch.runDir,
        lane: 'bob',
        message: 'Stage only the plan file: git add docs/accepted.md && git commit -m "done"',
        transport
      }),
      /route-owned commit policy/
    );
    assert.equal(transport.calls.some((call) => call.includes('paste-buffer')), false);
  } finally {
    await fixture.cleanup();
  }
});

test('send-message allows negated git command warnings for route-owned commit lanes', async () => {
  const fixture = await createLaunchFixture({ routeDeclaresCommit: true });
  try {
    const transport = recordingTransport();
    const launch = await launchRun(await fixture.options({
      execute: true,
      runId: 'run-send-route-owned-git-warning',
      transport,
      socketName: 'test-socket'
    }));

    const sent = await sendMessageToLane({
      runDir: launch.runDir,
      lane: 'bob',
      message: 'Do not run git add or git commit; write result files only.',
      transport
    });
    assert.equal(sent.ok, true);
    assert.equal(transport.calls.some((call) => call.includes('paste-buffer')), true);
  } finally {
    await fixture.cleanup();
  }
});

test('send-message CLI accepts stdin dispatch payloads', async () => {
  const fixture = await createLaunchFixture();
  const fakeTmuxDir = await mkdtemp(path.join(os.tmpdir(), 'cocoder-orch-fake-tmux-'));
  try {
    const transport = recordingTransport();
    const launch = await launchRun(await fixture.options({
      execute: true,
      runId: 'run-send-stdin-cli',
      transport,
      socketName: 'test-socket'
    }));
    const fakeTmux = path.join(fakeTmuxDir, 'tmux');
    await writeFile(fakeTmux, '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
    const cliPath = path.join(repoRoot, 'packages/core/cli.mjs');
    const stdout = await spawnWithInput(process.execPath, [
      cliPath,
      'send-message',
      '--run-dir',
      launch.runDir,
      '--lane',
      'bob',
      '--stdin',
      '--tmux-bin',
      fakeTmux
    ], {
      cwd: repoRoot,
      input: 'hello from stdin'
    });
    const result = JSON.parse(stdout);
    assert.equal(result.ok, true);
    assert.equal(result.lane, 'bob');
  } finally {
    await rm(fakeTmuxDir, { recursive: true, force: true });
    await fixture.cleanup();
  }
});

test('send-message refuses a lane after result artifacts exist', async () => {
  const fixture = await createLaunchFixture();
  try {
    const transport = recordingTransport();
    const launch = await launchRun(await fixture.options({
      execute: true,
      runId: 'run-send-result-closeout-lock',
      transport,
      socketName: 'test-socket'
    }));
    const bobJobDir = path.join(launch.runDir, 'jobs', 'bob');
    await writeJson(path.join(bobJobDir, 'result.json'), jobResult({
      persona: 'bob',
      adapter: 'codex',
      canWrite: true
    }));
    await writeFile(path.join(bobJobDir, 'result.md'), 'Status: PASS\n');

    await assert.rejects(
      () => sendMessageToLane({
        runDir: launch.runDir,
        lane: 'bob',
        message: 'start another packet',
        transport
      }),
      /lane-result-already-exists.*do not move, rename, or archive jobs\/<lane>\/result\.\*/
    );
    assert.equal(transport.calls.some((call) => call.includes('paste-buffer')), false);
  } finally {
    await fixture.cleanup();
  }
});

test('route laneRequirements adapterSandbox overrides teammate codex sandbox', async () => {
  const fixture = await createLaunchFixture({ bobAdapterSandbox: { codex: 'danger-full-access' } });
  try {
    const result = await launchRun({
      profilePath: fixture.profilePath,
      routePath: fixture.routePath,
      priorityFile: fixture.priorityPath,
      sessionLogFile: fixture.sessionLogPath,
      priorityBoundariesDir: fixture.boundariesDir,
      adaptersDir: fixture.adaptersDir,
      contractsDir,
      runsDir: fixture.runsDir,
      prioritySlug: 'DOCS-REBUILD',
      execute: false,
      cwd: fixture.tmp,
      probeGitCommitCapability: async () => ({ ok: true })
    });

    assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
    assert.equal(result.sessions.find((session) => session.lane === 'bob').adapterSandbox, 'danger-full-access');
    const bobWrapper = await readFile(path.join(result.runDir, 'jobs', 'bob', 'launch.sh'), 'utf8');
    assert.match(bobWrapper, /exec codex --ask-for-approval never --sandbox danger-full-access "\$BOOTSTRAP"/);
    const launchPlan = JSON.parse(await readFile(path.join(result.runDir, 'launch.json'), 'utf8'));
    assert.equal(launchPlan.sessions.find((session) => session.lane === 'bob').adapterSandbox, 'danger-full-access');
  } finally {
    await fixture.cleanup();
  }
});

test('send-message refuses a lane after a partial result artifact exists', async () => {
  const fixture = await createLaunchFixture();
  try {
    const transport = recordingTransport();
    const launch = await launchRun(await fixture.options({
      execute: true,
      runId: 'run-send-partial-result-lock',
      transport,
      socketName: 'test-socket'
    }));
    await writeFile(path.join(launch.runDir, 'jobs', 'bob', 'result.md'), 'Status: PASS\n');

    await assert.rejects(
      () => sendMessageToLane({
        runDir: launch.runDir,
        lane: 'bob',
        message: 'continue after partial result',
        transport
      }),
      /lane-result-already-exists/
    );
    assert.equal(transport.calls.some((call) => call.includes('paste-buffer')), false);
  } finally {
    await fixture.cleanup();
  }
});

test('send-message refuses terminal run status even without terminal flag', async () => {
  const fixture = await createLaunchFixture({ routeDeclaresCommit: true });
  try {
    const transport = recordingTransport();
    const launch = await launchRun(await fixture.options({
      execute: true,
      runId: 'run-send-terminal-lock',
      transport,
      socketName: 'test-socket'
    }));
    await writeJson(path.join(launch.runDir, 'status.json'), {
      runId: launch.runId,
      status: 'complete'
    });

    await assert.rejects(
      () => sendMessageToLane({
        runDir: launch.runDir,
        lane: 'bob',
        message: 'start next atom',
        transport
      }),
      /run is terminal: complete/
    );
    assert.equal(transport.calls.some((call) => call.includes('paste-buffer')), false);
  } finally {
    await fixture.cleanup();
  }
});

test('run finalizer completes a launched run only after every lane writes PASS', async () => {
  const fixture = await createLaunchFixture();
  try {
    const transport = recordingTransport();
    const launch = await launchRun(await fixture.options({
      execute: true,
      runId: 'run-finalize-pass',
      transport,
      socketName: 'test-socket'
    }));

    await writeResultPair(path.join(launch.runDir, 'jobs', 'bob'), jobResult({
      persona: 'bob',
      adapter: 'codex',
      canWrite: true
    }));

    const waiting = await finalizeRunStatusFromResults({
      runDir: launch.runDir,
      contractsDir,
      summary: 'fixture should wait'
    });
    assert.equal(waiting.finalized, false);
    assert.equal(waiting.status, 'running');
    assert.deepEqual(waiting.missing.map((item) => item.lane), ['oscar']);

    await writeResultPair(path.join(launch.runDir, 'jobs', 'oscar'), jobResult({
      persona: 'oscar',
      adapter: 'claude',
      canWrite: false
    }));

    const complete = await finalizeRunStatusFromResults({
      runDir: launch.runDir,
      contractsDir,
      summary: 'fixture complete'
    });
    assert.equal(complete.finalized, true);
    assert.equal(complete.status, 'complete');

    const status = JSON.parse(await readFile(path.join(launch.runDir, 'status.json'), 'utf8'));
    assert.equal(status.status, 'complete');
    assert.equal(status.terminal, true);
    assert.equal(status.jobs.oscar.status, 'PASS');
    assert.equal(status.jobs.bob.status, 'PASS');
  } finally {
    await fixture.cleanup();
  }
});

test('run finalizer rejects lane result identity that conflicts with launch plan', async () => {
  const fixture = await createLaunchFixture();
  try {
    const transport = recordingTransport();
    const launch = await launchRun(await fixture.options({
      execute: true,
      runId: 'run-finalize-identity-mismatch',
      transport,
      socketName: 'test-socket'
    }));

    await writeResultPair(path.join(launch.runDir, 'jobs', 'bob'), jobResult({
      persona: 'bob',
      adapter: 'claude',
      canWrite: true
    }));
    await writeResultPair(path.join(launch.runDir, 'jobs', 'oscar'), jobResult({
      persona: 'oscar',
      adapter: 'claude',
      canWrite: false
    }));

    const result = await finalizeRunStatusFromResults({
      runDir: launch.runDir,
      contractsDir,
      summary: 'fixture should reject mismatch'
    });
    assert.equal(result.finalized, false);
    assert.equal(result.status, 'running');
    assert.equal(result.reason, 'lane result files are invalid');
    assert.deepEqual(result.invalid.map((item) => item.lane), ['bob']);
    assert.match(result.invalid[0].reason, /result identity mismatch/);
    assert.match(result.invalid[0].reason, /adapter must be codex, got claude/);
  } finally {
    await fixture.cleanup();
  }
});

test('finalize-run-status refuses terminal teardown without founder approval', async () => {
  const fixture = await createLaunchFixture();
  try {
    const launch = await launchRun(await fixture.options({
      execute: false,
      runId: 'run-finalize-teardown-guard'
    }));
    await writeResultPair(path.join(launch.runDir, 'jobs', 'bob'), jobResult({
      persona: 'bob',
      adapter: 'codex',
      canWrite: true
    }));
    await writeResultPair(path.join(launch.runDir, 'jobs', 'oscar'), jobResult({
      persona: 'oscar',
      adapter: 'claude',
      canWrite: false
    }));

    const cliPath = path.join(repoRoot, 'packages/core/cli.mjs');
    const { stdout } = await execFileAsync(process.execPath, [
      cliPath,
      'finalize-run-status',
      '--run-dir',
      launch.runDir,
      '--contracts-dir',
      contractsDir,
      '--summary',
      'fixture complete without teardown approval',
      '--stop-terminal-sessions',
      'true'
    ], { cwd: repoRoot });
    const result = JSON.parse(stdout);
    assert.equal(result.status, 'complete');
    assert.equal(result.terminal, true);
    assert.equal(result.sessionStop.executed, false);
    assert.equal(result.sessionStop.status, 'blocked');
    assert.match(result.sessionStop.reason, /requires explicit founder approval/);
  } finally {
    await fixture.cleanup();
  }
});

test('run continuation launches one fresh run after terminal PASS request', async () => {
  const fixture = await createLaunchFixture();
  try {
    const transport = recordingTransport();
    const launch = await launchRun(await fixture.options({
      execute: true,
      runId: 'run-continuation-source',
      transport,
      socketName: 'test-socket'
    }));

    await writeResultPair(path.join(launch.runDir, 'jobs', 'bob'), jobResult({
      persona: 'bob',
      adapter: 'codex',
      canWrite: true
    }));
    await writeResultPair(path.join(launch.runDir, 'jobs', 'oscar'), jobResult({
      persona: 'oscar',
      adapter: 'claude',
      canWrite: true,
      continuation: {
        action: 'launch-fresh-run',
        prioritySlug: 'DOCS-REBUILD',
        routeId: 'fixture-claude-oscar-codex-bob',
        nextAtom: 'A2 fixture continuation',
        reason: 'fixture auto mode continuation',
        requiresFounder: false
      }
    }));

    const complete = await finalizeRunStatusFromResults({
      runDir: launch.runDir,
      contractsDir,
      summary: 'fixture complete with continuation'
    });
    assert.equal(complete.finalized, true);

    const stops = [];
    const launches = [];
    const continued = await processRunContinuation({
      runDir: launch.runDir,
      contractsDir,
      adaptersDir: fixture.adaptersDir,
      runsDir: fixture.runsDir,
      profilesDir: fixture.tmp,
      routesDir: fixture.tmp,
      priorityBoundariesDir: fixture.boundariesDir,
      priorityFile: fixture.priorityPath,
      sessionLogFile: fixture.sessionLogPath,
      repoRoot: fixture.tmp,
      stop: async (options) => {
        stops.push(options);
        return { ok: true, status: 'complete', killed: ['fixture-oscar', 'fixture-bob'] };
      },
      launch: async (options) => {
        launches.push(options);
        return { ok: true, status: 'running', runId: 'run-continuation-next', runDir: path.join(fixture.runsDir, 'run-continuation-next') };
      },
      gitStatus: async () => ''
    });

    assert.equal(continued.status, 'launched');
    assert.equal(stops.length, 0);
    assert.equal(launches.length, 1);
    assert.equal(launches[0].prioritySlug, 'DOCS-REBUILD');
    assert.equal(launches[0].routePath, fixture.routePath);
    assert.equal(launches[0].profilePath, fixture.profilePath);

    const artifact = JSON.parse(await readFile(path.join(launch.runDir, 'continuation.json'), 'utf8'));
    assert.equal(artifact.status, 'launched');
    assert.equal(artifact.launchResult.runId, 'run-continuation-next');
  } finally {
    await fixture.cleanup();
  }
});

test('run continuation blocks non-PASS lead result even when continuation is requested', async () => {
  const fixture = await createLaunchFixture();
  try {
    const launch = await launchRun(await fixture.options({
      execute: false,
      runId: 'run-continuation-non-pass'
    }));
    await writeResultPair(path.join(launch.runDir, 'jobs', 'bob'), jobResult({
      persona: 'bob',
      adapter: 'codex',
      canWrite: true
    }));
    await writeResultPair(path.join(launch.runDir, 'jobs', 'oscar'), jobResult({
      status: 'CONDITIONAL_PASS',
      persona: 'oscar',
      adapter: 'claude',
      canWrite: true,
      continuation: {
        action: 'launch-fresh-run',
        prioritySlug: 'DOCS-REBUILD',
        routeId: 'fixture-claude-oscar-codex-bob',
        nextAtom: 'A2 fixture continuation',
        reason: 'fixture auto mode continuation',
        requiresFounder: false
      }
    }));

    const finalized = await finalizeRunStatusFromResults({
      runDir: launch.runDir,
      contractsDir,
      summary: 'fixture non-pass continuation'
    });
    assert.equal(finalized.finalized, false);
    assert.equal(finalized.status, 'needs_founder');
    assert.match(finalized.reason, /blocked by stale non-PASS result/);

    const statusPath = path.join(launch.runDir, 'status.json');
    const statusRecord = JSON.parse(await readFile(statusPath, 'utf8'));
    await writeJson(statusPath, { ...statusRecord, status: 'complete', terminal: true });
    const continued = await processRunContinuation({
      runDir: launch.runDir,
      contractsDir,
      adaptersDir: fixture.adaptersDir,
      runsDir: fixture.runsDir,
      profilesDir: fixture.tmp,
      routesDir: fixture.tmp,
      priorityBoundariesDir: fixture.boundariesDir,
      priorityFile: fixture.priorityPath,
      sessionLogFile: fixture.sessionLogPath,
      repoRoot: fixture.tmp,
      gitStatus: async () => ''
    });
    assert.equal(continued.status, 'blocked');
    assert.match(continued.reason, /lead result status CONDITIONAL_PASS cannot request continuation/);
  } finally {
    await fixture.cleanup();
  }
});

test('run continuation blocks founder-gated follow-on launches', async () => {
  const fixture = await createLaunchFixture();
  try {
    const launch = await launchRun(await fixture.options({
      execute: false,
      runId: 'run-continuation-blocked'
    }));
    await writeResultPair(path.join(launch.runDir, 'jobs', 'bob'), jobResult({
      persona: 'bob',
      adapter: 'codex',
      canWrite: true
    }));
    await writeResultPair(path.join(launch.runDir, 'jobs', 'oscar'), jobResult({
      persona: 'oscar',
      adapter: 'claude',
      canWrite: true,
      continuation: {
        action: 'launch-fresh-run',
        prioritySlug: 'DOCS-REBUILD',
        routeId: 'fixture-claude-oscar-codex-bob',
        nextAtom: 'C6 signing',
        reason: 'fixture founder gate',
        requiresFounder: true
      }
    }));
    await finalizeRunStatusFromResults({
      runDir: launch.runDir,
      contractsDir,
      summary: 'fixture complete but founder gated'
    });

    const founderBlocked = await processRunContinuation({
      runDir: launch.runDir,
      contractsDir,
      adaptersDir: fixture.adaptersDir,
      runsDir: fixture.runsDir,
      profilesDir: fixture.tmp,
      routesDir: fixture.tmp,
      priorityBoundariesDir: fixture.boundariesDir,
      priorityFile: fixture.priorityPath,
      sessionLogFile: fixture.sessionLogPath,
      repoRoot: fixture.tmp,
      gitStatus: async () => ''
    });

    assert.equal(founderBlocked.status, 'blocked');
    assert.equal(founderBlocked.issues[0].code, 'founder-required');
  } finally {
    await fixture.cleanup();
  }
});

test('run continuation blocks dirty worktree follow-on launches', async () => {
  const fixture = await createLaunchFixture();
  try {
    const launch = await launchRun(await fixture.options({
      execute: false,
      runId: 'run-continuation-dirty'
    }));
    await writeResultPair(path.join(launch.runDir, 'jobs', 'bob'), jobResult({
      persona: 'bob',
      adapter: 'codex',
      canWrite: true
    }));
    await writeResultPair(path.join(launch.runDir, 'jobs', 'oscar'), jobResult({
      persona: 'oscar',
      adapter: 'claude',
      canWrite: true,
      continuation: {
        action: 'launch-fresh-run',
        prioritySlug: 'DOCS-REBUILD',
        routeId: 'fixture-claude-oscar-codex-bob',
        nextAtom: 'A2 fixture continuation',
        reason: 'fixture auto mode continuation',
        requiresFounder: false
      }
    }));
    await finalizeRunStatusFromResults({
      runDir: launch.runDir,
      contractsDir,
      summary: 'fixture complete but dirty'
    });

    const dirtyBlocked = await processRunContinuation({
      runDir: launch.runDir,
      contractsDir,
      adaptersDir: fixture.adaptersDir,
      runsDir: fixture.runsDir,
      profilesDir: fixture.tmp,
      routesDir: fixture.tmp,
      priorityBoundariesDir: fixture.boundariesDir,
      priorityFile: fixture.priorityPath,
      sessionLogFile: fixture.sessionLogPath,
      repoRoot: fixture.tmp,
      gitStatus: async () => ' M docs/dirty.md\n'
    });

    assert.equal(dirtyBlocked.status, 'blocked');
    assert.equal(dirtyBlocked.gitAudit.issues[0].code, 'dirty-worktree-state');
  } finally {
    await fixture.cleanup();
  }
});

test('route-owned run finalizer waits for accepted PASS commits before terminal closeout', async () => {
  const fixture = await createLaunchFixture({ routeDeclaresOscarWrapCommit: true });
  try {
    const transport = recordingTransport();
    const launch = await launchRun(await fixture.options({
      execute: true,
      runId: 'run-finalize-route-owned-commits',
      transport,
      socketName: 'test-socket'
    }));

    const bobResultPath = path.join(launch.runDir, 'jobs', 'bob', 'result.json');
    const oscarResultPath = path.join(launch.runDir, 'jobs', 'oscar', 'result.json');

    await writeResultPair(path.dirname(bobResultPath), jobResult({
      persona: 'bob',
      adapter: 'codex',
      canWrite: true,
      filesChanged: ['docs/accepted.md']
    }));
    await writeResultPair(path.dirname(oscarResultPath), jobResult({
      persona: 'oscar',
      adapter: 'claude',
      canWrite: true,
      filesChanged: ['cocoder/SESSION_LOG.md']
    }));

    const waiting = await finalizeRunStatusFromResults({
      runDir: launch.runDir,
      contractsDir,
      summary: 'fixture must wait for route-owned commits'
    });
    assert.equal(waiting.finalized, false);
    assert.equal(waiting.status, 'running');
    assert.equal(waiting.terminal, false);
    assert.deepEqual(waiting.pendingOrchestratorCommits.map((item) => item.lane), ['oscar', 'bob']);
    let status = JSON.parse(await readFile(path.join(launch.runDir, 'status.json'), 'utf8'));
    assert.equal(status.status, 'running');
    assert.equal(status.terminal, false);

    await appendCommitEvent(launch.runDir, { lane: 'bob', acceptedResultPath: bobResultPath, sha: 'bob-sha' });
    await appendCommitEvent(launch.runDir, { lane: 'oscar', acceptedResultPath: oscarResultPath, sha: 'oscar-sha' });

    const complete = await finalizeRunStatusFromResults({
      runDir: launch.runDir,
      contractsDir,
      summary: 'fixture complete after route-owned commits'
    });
    assert.equal(complete.finalized, true);
    assert.equal(complete.status, 'complete');

    status = JSON.parse(await readFile(path.join(launch.runDir, 'status.json'), 'utf8'));
    assert.equal(status.status, 'complete');
    assert.equal(status.terminal, true);
  } finally {
    await fixture.cleanup();
  }
});

test('run finalizer ignores unrelated unstaged durable orchestration state', async () => {
  const fixture = await createLaunchFixture();
  const repo = await mkdtemp(path.join(os.tmpdir(), 'cocoder-finalize-repo-'));
  try {
    await mkdir(path.join(repo, 'packages/core/core'), { recursive: true });
    await writeFile(path.join(repo, 'packages/core/cli.mjs'), 'runtime base\n');
    await git(repo, ['init']);
    await git(repo, ['config', 'user.email', 'orchestrator@example.test']);
    await git(repo, ['config', 'user.name', 'Orchestrator Test']);
    await git(repo, ['add', '--', '.']);
    await git(repo, ['commit', '-m', 'initial']);
    await writeFile(path.join(repo, 'packages/core/cli.mjs'), 'unrelated concurrent runtime change\n');

    const transport = recordingTransport();
    const launch = await launchRun(await fixture.options({
      execute: true,
      runId: 'run-finalize-with-unrelated-orchestration-dirt',
      transport,
      socketName: 'test-socket'
    }));

    await writeResultPair(path.join(launch.runDir, 'jobs', 'bob'), jobResult({
      persona: 'bob',
      adapter: 'codex',
      canWrite: true
    }));
    await writeResultPair(path.join(launch.runDir, 'jobs', 'oscar'), jobResult({
      persona: 'oscar',
      adapter: 'claude',
      canWrite: false
    }));

    const complete = await finalizeRunStatusFromResults({
      runDir: launch.runDir,
      contractsDir,
      summary: 'fixture complete with unrelated orchestration dirt',
      repoRoot: repo
    });
    assert.equal(complete.finalized, true, JSON.stringify(complete, null, 2));
    assert.equal(complete.status, 'complete');
  } finally {
    await rm(repo, { recursive: true, force: true });
    await fixture.cleanup();
  }
});

test('run finalizer blocks staged durable orchestration state', async () => {
  const fixture = await createLaunchFixture();
  const repo = await mkdtemp(path.join(os.tmpdir(), 'cocoder-finalize-repo-'));
  try {
    await mkdir(path.join(repo, 'packages/core/core'), { recursive: true });
    await writeFile(path.join(repo, 'packages/core/cli.mjs'), 'runtime base\n');
    await git(repo, ['init']);
    await git(repo, ['config', 'user.email', 'orchestrator@example.test']);
    await git(repo, ['config', 'user.name', 'Orchestrator Test']);
    await git(repo, ['add', '--', '.']);
    await git(repo, ['commit', '-m', 'initial']);
    await writeFile(path.join(repo, 'packages/core/cli.mjs'), 'staged runtime change\n');
    await git(repo, ['add', '--', 'packages/core/cli.mjs']);

    const transport = recordingTransport();
    const launch = await launchRun(await fixture.options({
      execute: true,
      runId: 'run-finalize-with-staged-orchestration-dirt',
      transport,
      socketName: 'test-socket'
    }));

    await writeResultPair(path.join(launch.runDir, 'jobs', 'bob'), jobResult({
      persona: 'bob',
      adapter: 'codex',
      canWrite: true
    }));
    await writeResultPair(path.join(launch.runDir, 'jobs', 'oscar'), jobResult({
      persona: 'oscar',
      adapter: 'claude',
      canWrite: false
    }));

    const waiting = await finalizeRunStatusFromResults({
      runDir: launch.runDir,
      contractsDir,
      summary: 'fixture should wait on staged orchestration dirt',
      repoRoot: repo
    });
    assert.equal(waiting.finalized, false);
    assert.match(waiting.reason, /waiting for clean durable orchestration state/);
    assert.deepEqual(waiting.dirtyOrchestrationState, ['packages/core/cli.mjs']);
  } finally {
    await rm(repo, { recursive: true, force: true });
    await fixture.cleanup();
  }
});

test('stop-run refuses to kill sessions without exact run id confirmation', async () => {
  const fixture = await createLaunchFixture();
  try {
    const transport = recordingTransport();
    const launch = await launchRun(await fixture.options({
      execute: true,
      runId: 'run-stop-guard',
      transport,
      socketName: 'test-socket'
    }));
    const result = await stopRunSessions({
      runDir: launch.runDir,
      confirmRunId: 'wrong-run-id',
      execute: true,
      transport
    });
    assert.equal(result.ok, false);
    assert.equal(result.issues[0].code, 'run-id-confirmation-required');
    assert.equal(transport.calls.some((call) => call.includes('kill-session')), false);
  } finally {
    await fixture.cleanup();
  }
});

test('stop-run kills only sessions declared by the selected run launch plan', async () => {
  const fixture = await createLaunchFixture();
  try {
    const transport = recordingTransport();
    const launch = await launchRun(await fixture.options({
      execute: true,
      runId: 'run-stop-exact',
      transport,
      socketName: 'test-socket'
    }));
    const result = await stopRunSessions({
      runDir: launch.runDir,
      confirmRunId: 'run-stop-exact',
      execute: true,
      transport
    });
    assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
    assert.deepEqual(result.killed.sort(), ['orch-bob-run-stop-exact', 'orch-oscar-run-stop-exact']);
    const killCalls = transport.calls.filter((call) => call.includes('kill-session'));
    assert.equal(killCalls.length, 2);
    assert.equal(killCalls.every((call) => call.includes('orch-oscar-run-stop-exact') || call.includes('orch-bob-run-stop-exact')), true);
  } finally {
    await fixture.cleanup();
  }
});

test('run finalizer refuses result json without markdown pair', async () => {
  const fixture = await createLaunchFixture();
  try {
    const transport = recordingTransport();
    const launch = await launchRun(await fixture.options({
      execute: true,
      runId: 'run-finalize-missing-md',
      transport,
      socketName: 'test-socket'
    }));

    await writeJson(path.join(launch.runDir, 'jobs', 'bob', 'result.json'), jobResult({
      persona: 'bob',
      adapter: 'codex',
      canWrite: true
    }));

    const checked = await finalizeRunStatusFromResults({
      runDir: launch.runDir,
      contractsDir,
      summary: 'fixture should reject missing markdown'
    });
    assert.equal(checked.finalized, false);
    assert.equal(checked.status, 'running');
    assert.equal(checked.invalid[0].lane, 'bob');
    assert.match(checked.invalid[0].reason, /missing markdown result file/);
  } finally {
    await fixture.cleanup();
  }
});

test('run finalizer refuses Oscar PASS result without founder completion brief', async () => {
  const fixture = await createLaunchFixture();
  try {
    const transport = recordingTransport();
    const launch = await launchRun(await fixture.options({
      execute: true,
      runId: 'run-finalize-missing-founder-brief',
      transport,
      socketName: 'test-socket'
    }));

    await writeResultPair(path.join(launch.runDir, 'jobs', 'bob'), jobResult({
      persona: 'bob',
      adapter: 'codex',
      canWrite: true
    }));
    await writeResultPair(path.join(launch.runDir, 'jobs', 'oscar'), jobResult({
      persona: 'oscar',
      adapter: 'claude',
      canWrite: false
    }), { founderBrief: false });

    const checked = await finalizeRunStatusFromResults({
      runDir: launch.runDir,
      contractsDir,
      summary: 'fixture should reject missing founder completion brief'
    });

    assert.equal(checked.finalized, false);
    assert.equal(checked.terminal, false);
    assert.equal(checked.status, 'running');
    assert.equal(checked.invalid[0].lane, 'oscar');
    assert.match(checked.invalid[0].reason, /missing founder completion brief/);
    assert.match(checked.invalid[0].reason, /Founder Completion Brief/);

    const status = JSON.parse(await readFile(path.join(launch.runDir, 'status.json'), 'utf8'));
    assert.equal(status.status, 'running');
    assert.equal(status.terminal, false);
  } finally {
    await fixture.cleanup();
  }
});

test('run finalizer refuses verbose founder completion brief', async () => {
  const fixture = await createLaunchFixture();
  try {
    const transport = recordingTransport();
    const launch = await launchRun(await fixture.options({
      execute: true,
      runId: 'run-finalize-verbose-founder-brief',
      transport,
      socketName: 'test-socket'
    }));

    await writeResultPair(path.join(launch.runDir, 'jobs', 'bob'), jobResult({
      persona: 'bob',
      adapter: 'codex',
      canWrite: true
    }));
    await writeResultPair(path.join(launch.runDir, 'jobs', 'oscar'), jobResult({
      persona: 'oscar',
      adapter: 'claude',
      canWrite: false
    }), { founderBrief: 'verbose' });

    const checked = await finalizeRunStatusFromResults({
      runDir: launch.runDir,
      contractsDir,
      summary: 'fixture should reject verbose founder completion brief'
    });

    assert.equal(checked.finalized, false);
    assert.equal(checked.terminal, false);
    assert.equal(checked.invalid[0].lane, 'oscar');
    assert.match(checked.invalid[0].reason, /15 non-empty lines or fewer|1400 characters or fewer/);
  } finally {
    await fixture.cleanup();
  }
});

test('run finalizer refuses Oscar PASS result whose founder brief says atom is incomplete', async () => {
  const fixture = await createLaunchFixture();
  try {
    const transport = recordingTransport();
    const launch = await launchRun(await fixture.options({
      execute: true,
      runId: 'run-finalize-incomplete-founder-brief',
      transport,
      socketName: 'test-socket'
    }));

    await writeResultPair(path.join(launch.runDir, 'jobs', 'bob'), jobResult({
      persona: 'bob',
      adapter: 'codex',
      canWrite: true
    }));
    await writeResultPair(path.join(launch.runDir, 'jobs', 'oscar'), jobResult({
      persona: 'oscar',
      adapter: 'claude',
      canWrite: false
    }), { founderBrief: 'incomplete' });

    const checked = await finalizeRunStatusFromResults({
      runDir: launch.runDir,
      contractsDir,
      summary: 'fixture should reject incomplete atom PASS'
    });

    assert.equal(checked.finalized, false);
    assert.equal(checked.terminal, false);
    assert.equal(checked.status, 'running');
    assert.equal(checked.invalid[0].lane, 'oscar');
    assert.match(checked.invalid[0].reason, /Atom Complete: Yes/);

    const status = JSON.parse(await readFile(path.join(launch.runDir, 'status.json'), 'utf8'));
    assert.equal(status.status, 'running');
    assert.equal(status.terminal, false);
  } finally {
    await fixture.cleanup();
  }
});

test('run finalizer refuses Oscar PASS result with packet-only persona dispatch plan', async () => {
  const fixture = await createLaunchFixture();
  try {
    const transport = recordingTransport();
    const launch = await launchRun(await fixture.options({
      execute: true,
      runId: 'run-finalize-packet-only-persona',
      transport,
      socketName: 'test-socket'
    }));

    await writeResultPair(path.join(launch.runDir, 'jobs', 'bob'), jobResult({
      persona: 'bob',
      adapter: 'codex',
      canWrite: true
    }));
    await writeResultPair(path.join(launch.runDir, 'jobs', 'oscar'), jobResult({
      persona: 'oscar',
      adapter: 'claude',
      canWrite: false,
      personaDispatchPlan: [{
        atom: 'C3',
        requiredPersona: 'Quinn',
        routeAvailable: false,
        dispatchStatus: 'packet-only',
        evidenceExpected: 'Quinn packaged-build report'
      }]
    }));

    const checked = await finalizeRunStatusFromResults({
      runDir: launch.runDir,
      contractsDir,
      summary: 'fixture should reject packet-only persona work'
    });

    assert.equal(checked.finalized, false);
    assert.equal(checked.terminal, false);
    assert.equal(checked.status, 'running');
    assert.equal(checked.invalid[0].lane, 'oscar');
    assert.match(checked.invalid[0].reason, /packet-only|not executed/);
  } finally {
    await fixture.cleanup();
  }
});

test('run finalizer labels Oscar PASS result with yes-no persona route availability as dispatch-plan invalid', async () => {
  const fixture = await createLaunchFixture();
  try {
    const transport = recordingTransport();
    const launch = await launchRun(await fixture.options({
      execute: true,
      runId: 'run-finalize-route-available-string',
      transport,
      socketName: 'test-socket'
    }));

    await writeResultPair(path.join(launch.runDir, 'jobs', 'bob'), jobResult({
      persona: 'bob',
      adapter: 'codex',
      canWrite: true
    }));
    await writeResultPair(path.join(launch.runDir, 'jobs', 'oscar'), jobResult({
      persona: 'oscar',
      adapter: 'claude',
      canWrite: false,
      personaDispatchPlan: [{
        atom: 'C3',
        requiredPersona: 'Bob',
        routeAvailable: 'yes',
        dispatchStatus: 'completed',
        evidenceExpected: 'jobs/bob/result.json'
      }]
    }));

    const checked = await finalizeRunStatusFromResults({
      runDir: launch.runDir,
      contractsDir,
      summary: 'fixture should reject string routeAvailable'
    });

    assert.equal(checked.finalized, false);
    assert.equal(checked.terminal, false);
    assert.equal(checked.status, 'running');
    assert.equal(checked.invalid[0].lane, 'oscar');
    assert.match(checked.invalid[0].reason, /invalid Oscar PASS persona dispatch plan/);
    assert.match(checked.invalid[0].reason, /routeAvailable must be a boolean/);
  } finally {
    await fixture.cleanup();
  }
});

test('run finalizer refuses empty result markdown pair', async () => {
  const fixture = await createLaunchFixture();
  try {
    const transport = recordingTransport();
    const launch = await launchRun(await fixture.options({
      execute: true,
      runId: 'run-finalize-empty-md',
      transport,
      socketName: 'test-socket'
    }));

    const bobJobDir = path.join(launch.runDir, 'jobs', 'bob');
    await writeJson(path.join(bobJobDir, 'result.json'), jobResult({
      persona: 'bob',
      adapter: 'codex',
      canWrite: true
    }));
    await writeFile(path.join(bobJobDir, 'result.md'), '');

    const checked = await finalizeRunStatusFromResults({
      runDir: launch.runDir,
      contractsDir,
      summary: 'fixture should reject empty markdown'
    });
    assert.equal(checked.finalized, false);
    assert.equal(checked.status, 'running');
    assert.equal(checked.invalid[0].lane, 'bob');
    assert.match(checked.invalid[0].reason, /empty markdown result file/);
  } finally {
    await fixture.cleanup();
  }
});

test('stop-run preserves terminal complete status while killing declared sessions', async () => {
  const fixture = await createLaunchFixture();
  try {
    const transport = recordingTransport();
    const launch = await launchRun(await fixture.options({
      execute: true,
      runId: 'run-stop-complete',
      transport,
      socketName: 'test-socket'
    }));
    await writeResultPair(path.join(launch.runDir, 'jobs', 'bob'), jobResult({
      persona: 'bob',
      adapter: 'codex',
      canWrite: true
    }));
    await writeResultPair(path.join(launch.runDir, 'jobs', 'oscar'), jobResult({
      persona: 'oscar',
      adapter: 'claude',
      canWrite: false
    }));
    await finalizeRunStatusFromResults({ runDir: launch.runDir, contractsDir, summary: 'fixture complete before stop' });

    const stopped = await stopRunSessions({
      runDir: launch.runDir,
      confirmRunId: 'run-stop-complete',
      execute: true,
      transport
    });
    assert.equal(stopped.ok, true, JSON.stringify(stopped.issues, null, 2));
    assert.equal(stopped.status, 'complete');
    assert.equal(stopped.terminalStatusPreserved, true);

    const status = JSON.parse(await readFile(path.join(launch.runDir, 'status.json'), 'utf8'));
    assert.equal(status.status, 'complete');
  } finally {
    await fixture.cleanup();
  }
});

test('stop-run preserves terminal complete status when terminal session teardown fails', async () => {
  const fixture = await createLaunchFixture();
  try {
    const transport = failKillTransport();
    const launch = await launchRun(await fixture.options({
      execute: true,
      runId: 'run-stop-complete-failure',
      transport,
      socketName: 'test-socket'
    }));
    await writeResultPair(path.join(launch.runDir, 'jobs', 'bob'), jobResult({
      persona: 'bob',
      adapter: 'codex',
      canWrite: true
    }));
    await writeResultPair(path.join(launch.runDir, 'jobs', 'oscar'), jobResult({
      persona: 'oscar',
      adapter: 'claude',
      canWrite: false
    }));
    await finalizeRunStatusFromResults({ runDir: launch.runDir, contractsDir, summary: 'fixture complete before failed stop' });

    const stopped = await stopRunSessions({
      runDir: launch.runDir,
      confirmRunId: 'run-stop-complete-failure',
      execute: true,
      transport
    });
    assert.equal(stopped.ok, false);
    assert.equal(stopped.status, 'complete');
    assert.equal(stopped.issues[0].code, 'tmux-kill-session-failed');

    const status = JSON.parse(await readFile(path.join(launch.runDir, 'status.json'), 'utf8'));
    assert.equal(status.status, 'complete');
    assert.equal(status.terminal, true);
  } finally {
    await fixture.cleanup();
  }
});

test('launch can defer LLM startup until visible panes are attached', async () => {
  const fixture = await createLaunchFixture();
  try {
    const transport = recordingTransport();
    const result = await launchRun(await fixture.options({
      execute: true,
      deferStart: true,
      runId: 'run-launch-deferred',
      transport,
      socketName: 'test-socket',
      tmuxBin: '/bin/tmux'
    }));
    assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
    assert.equal(result.startAllScript.endsWith('start-lanes.sh'), true);
    assert.equal(transport.calls.some((call) => call.includes('launch-deferred.sh')), true);
    assert.equal(transport.calls.some((call) => call.includes('new-session') && call.includes('launch.sh')), false);
    const startAll = await readFile(result.startAllScript, 'utf8');
    assert.match(startAll, /start\.signal/);
  } finally {
    await fixture.cleanup();
  }
});

test('launch prompt renderer keeps persona behavior in composed fragments', async () => {
  const source = await readFile(path.join(repoRoot, 'packages/core/lib/launch.mjs'), 'utf8');
  const personaProseLines = source
    .split('\n')
    .filter((line) => /You are (Oscar|Bob|Ian|Phil|Talia|Quinn)|visible orchestration lead|implementation teammate|Founder Brief|Single Priority Session/.test(line));
  assert.equal(personaProseLines.length, 0, personaProseLines.join('\n'));
});

test('launch quotes tmux shell command paths so repo roots may contain spaces', async () => {
  const fixture = await createLaunchFixture();
  try {
    const transport = recordingTransport();
    const cwdWithSpace = path.join(fixture.tmp, 'NAS Local', 'infrastructure');
    await mkdir(cwdWithSpace, { recursive: true });
    const result = await launchRun(await fixture.options({
      execute: true,
      deferStart: true,
      runId: 'run-launch-space-path',
      transport,
      socketName: 'test-socket',
      tmuxBin: '/bin/tmux',
      cwd: cwdWithSpace
    }));
    assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
    const newSessionCalls = transport.calls.filter((call) => call.includes('new-session'));
    assert.equal(newSessionCalls.length, 2);
    assert.match(newSessionCalls[0], /'[^']*launch-deferred\.sh'/);
  } finally {
    await fixture.cleanup();
  }
});

test('launch returns structured block when tmux session startup fails', async () => {
  const fixture = await createLaunchFixture();
  try {
    const transport = failingStartupTransport();
    const result = await launchRun(await fixture.options({
      execute: true,
      runId: 'run-launch-startup-fail',
      transport
    }));
    assert.equal(result.ok, false);
    assert.equal(result.status, 'blocked');
    assert.equal(result.issues.some((issue) => issue.code === 'tmux-session-startup-failed'), true);
    const status = JSON.parse(await readFile(path.join(result.runDir, 'status.json'), 'utf8'));
    assert.equal(status.status, 'blocked');
  } finally {
    await fixture.cleanup();
  }
});

test('launch blocks routes that do not support the selected priority owner', async () => {
  const fixture = await createLaunchFixture({ supportedPriorityOwners: ['ORCHESTRATION-REBUILD'] });
  try {
    const result = await launchRun(await fixture.options({ execute: false, runId: 'run-launch-blocked', prioritySlug: 'DOCS-REBUILD' }));
    assert.equal(result.ok, false);
    assert.equal(result.issues.some((issue) => issue.code === 'priority-owner-not-supported'), true);
  } finally {
    await fixture.cleanup();
  }
});

test('launch warns but proceeds when PRIORITIES Last updated and selected entry disagree on next atom', async () => {
  const fixture = await createLaunchFixture({ priorityNextAtomDrift: true });
  try {
    const result = await launchRun(await fixture.options({ execute: false, runId: 'run-launch-next-atom-drift' }));
    assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
    assert.equal(result.status, 'ready');
    assert.equal(result.warnings.some((warning) => warning.includes('priority-next-atom-drift')), true);
    const startupPacket = JSON.parse(await readFile(path.join(result.runDir, 'startup-packet.json'), 'utf8'));
    assert.equal(startupPacket.selectedPriority.lastUpdated.includes('A2 path canonicalization is next'), true);
    assert.equal(startupPacket.gaps.some((gap) => gap.includes('priority-next-atom-drift')), false);
    assert.equal(startupPacket.warnings.some((warning) => warning.includes('priority-next-atom-drift')), true);
    const status = JSON.parse(await readFile(path.join(result.runDir, 'status.json'), 'utf8'));
    assert.equal(status.status, 'ready');
    assert.equal(status.terminal, false);
    assert.match(status.reason, /startup packet and profile\/route validation passed/);
    const oscarPrompt = await readFile(path.join(result.runDir, 'jobs', 'oscar', 'prompt.md'), 'utf8');
    const bobPrompt = await readFile(path.join(result.runDir, 'jobs', 'bob', 'prompt.md'), 'utf8');
    assert.match(oscarPrompt, /## Startup Warnings/);
    assert.match(oscarPrompt, /priority-next-atom-drift/);
    assert.match(oscarPrompt, /Acknowledge startup warnings proportionally before dispatch/);
    assert.match(oscarPrompt, /Do not run a broad dirty-worktree survey or block `add-lanes` unless a warning names staged work/);
    assert.match(bobPrompt, /Wait for the lead lane to reconcile startup warnings/);
  } finally {
    await fixture.cleanup();
  }
});

test('launch falls back to profile write boundaries when selected priority has no boundary', async () => {
  const fixture = await createLaunchFixture({
    supportedPriorityOwners: ['DOCS-REBUILD', 'NO-BOUNDARY'],
    extraPrioritySlug: 'NO-BOUNDARY'
  });
  try {
    const transport = recordingTransport();
    const result = await launchRun(await fixture.options({
      execute: true,
      runId: 'run-launch-no-boundary',
      prioritySlug: 'NO-BOUNDARY',
      transport
    }));
    assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
    assert.equal(result.status, 'running');
    assert.equal(result.priorityBoundary, null);
    assert.equal(transport.calls.filter((call) => call.includes('new-session')).length, 2);
    const startupPacket = JSON.parse(await readFile(path.join(result.runDir, 'startup-packet.json'), 'utf8'));
    assert.equal(startupPacket.resolvedWriteBoundary.source, 'priority-boundary-unresolved');
    assert.deepEqual(startupPacket.writeBoundaries, []);
  } finally {
    await fixture.cleanup();
  }
});

test('launch returns structured block when tmux preflight fails', async () => {
  const fixture = await createLaunchFixture();
  try {
    const transport = failingVersionTransport();
    const result = await launchRun(await fixture.options({
      execute: true,
      runId: 'run-launch-tmux-fail',
      transport
    }));
    assert.equal(result.ok, false);
    assert.equal(result.status, 'blocked');
    assert.equal(transport.calls.filter((call) => call.includes('new-session')).length, 0);
    assert.equal(result.issues.some((issue) => issue.code === 'tmux-preflight-failed'), true);
    const status = JSON.parse(await readFile(path.join(result.runDir, 'status.json'), 'utf8'));
    assert.equal(status.status, 'blocked');
  } finally {
    await fixture.cleanup();
  }
});

test('launch blocks a second non-terminal run for the same priority and route', async () => {
  const fixture = await createLaunchFixture();
  try {
    const first = await launchRun(await fixture.options({ execute: false, runId: 'run-active-priority-existing' }));
    assert.equal(first.ok, true, JSON.stringify(first.issues, null, 2));

    const blocked = await launchRun(await fixture.options({ execute: false, runId: 'run-active-priority-duplicate' }));
    assert.equal(blocked.ok, false);
    assert.equal(blocked.status, 'blocked');
    assert.equal(blocked.runDir, undefined);
    assert.equal(blocked.issues[0].code, 'active-priority-run-exists');
    assert.match(blocked.issues[0].detail, /run-active-priority-existing/);
    assert.match(blocked.issues[0].detail, /--allow-concurrent-priority-run true/);
  } finally {
    await fixture.cleanup();
  }
});

test('launch allows a same-priority historical terminal run and explicit concurrency override', async () => {
  const fixture = await createLaunchFixture();
  try {
    const terminal = await launchRun(await fixture.options({ execute: false, runId: 'run-terminal-priority-history' }));
    await writeJson(path.join(terminal.runDir, 'status.json'), {
      runId: 'run-terminal-priority-history',
      status: 'complete',
      createdAt: '2026-05-22T18:00:00.000Z',
      updatedAt: '2026-05-22T18:01:00.000Z',
      routeId: 'fixture-claude-oscar-codex-bob',
      profileId: 'fixture-profile',
      startupPacketPath: 'startup-packet.json',
      terminal: true,
      reason: 'fixture terminal run'
    });

    const afterTerminal = await launchRun(await fixture.options({ execute: false, runId: 'run-after-terminal-history' }));
    assert.equal(afterTerminal.ok, true, JSON.stringify(afterTerminal.issues, null, 2));

    const override = await launchRun(await fixture.options({
      execute: false,
      runId: 'run-explicit-concurrent-priority',
      allowConcurrentPriorityRun: true
    }));
    assert.equal(override.ok, true, JSON.stringify(override.issues, null, 2));
    assert.equal(override.activeRunPreflight.override, true);
  } finally {
    await fixture.cleanup();
  }
});

test('git capability preflight allows sandboxed writer when route owns commits', async () => {
  const fixture = await createLaunchFixture({ routeDeclaresCommit: true });
  try {
    const transport = recordingTransport();
    let probeCalls = 0;
    const result = await launchRun(await fixture.options({
      execute: true,
      runId: 'run-git-preflight-orchestrator-commit',
      transport,
      probeGitCommitCapability: async () => {
        probeCalls += 1;
        return { ok: false, status: 'git-dir-write-denied', detail: '.git/index.lock denied' };
      }
    }));
    assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
    assert.equal(result.status, 'running');
    assert.equal(result.gitCapabilityPreflight.ok, true);
    assert.deepEqual(result.gitCapabilityPreflight.checkedLanes, []);
    assert.deepEqual(result.gitCapabilityPreflight.skippedLanes, ['bob']);
    assert.equal(probeCalls, 0);
    assert.equal(transport.calls.filter((call) => call.includes('new-session')).length, 2);
  } finally {
    await fixture.cleanup();
  }
});

test('git capability preflight blocks sandboxed writer-lane commit route before launch', async () => {
  const fixture = await createLaunchFixture({ requiresBobSideCommits: true });
  try {
    const transport = recordingTransport();
    const result = await launchRun(await fixture.options({
      execute: true,
      runId: 'run-git-preflight-blocked',
      transport,
      probeGitCommitCapability: async () => ({ ok: false, status: 'git-dir-write-denied', detail: 'EPERM while probing .git/index.lock' })
    }));
    assert.equal(result.ok, false);
    assert.equal(result.status, 'blocked');
    assert.equal(result.executed, false);
    assert.equal(result.runDir, undefined);
    assert.equal(result.issues.some((issue) => issue.code === 'missing-git-commit-capability'), true);
    assert.equal(transport.calls.filter((call) => call.includes('new-session')).length, 0);
  } finally {
    await fixture.cleanup();
  }
});

test('git capability preflight reports remediation for missing writer-lane commit capability', async () => {
  const fixture = await createLaunchFixture({ requiresBobSideCommits: true });
  try {
    const result = await launchRun(await fixture.options({
      execute: false,
      runId: 'run-git-preflight-remediation',
      probeGitCommitCapability: async () => ({ ok: false, status: 'git-dir-write-denied', detail: 'Operation not permitted while creating .git/index.lock' })
    }));
    const issue = result.issues.find((candidate) => candidate.code === 'missing-git-commit-capability');
    assert.ok(issue, JSON.stringify(result.issues, null, 2));
    assert.equal(issue.capability, 'git-commit');
    assert.equal(issue.lane, 'bob');
    assert.match(issue.detail, /orchestrator-owned commits/);
    assert.match(issue.detail, /unsandboxed terminal/);
    assert.match(issue.detail, /Operation not permitted/);
    assert.doesNotMatch(issue.detail, /stack/i);
  } finally {
    await fixture.cleanup();
  }
});

test('git capability preflight allows unsandboxed writer-lane commit route to launch', async () => {
  const fixture = await createLaunchFixture({ requiresBobSideCommits: true });
  try {
    const transport = recordingTransport();
    const result = await launchRun(await fixture.options({
      execute: true,
      runId: 'run-git-preflight-unsandboxed',
      transport,
      probeGitCommitCapability: async () => ({ ok: true, status: 'available', gitDir: '/tmp/repo/.git' })
    }));
    assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
    assert.equal(result.status, 'running');
    assert.deepEqual(result.gitCapabilityPreflight.checkedLanes, ['bob']);
    assert.deepEqual(result.gitCapabilityPreflight.issues, []);
    assert.equal(transport.calls.filter((call) => call.includes('new-session')).length, 2);
  } finally {
    await fixture.cleanup();
  }
});

async function createLaunchFixture(options = {}) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'cocoder-launch-'));
  const adaptersDir = path.join(tmp, 'adapters');
  const runsDir = path.join(tmp, 'runs');
  const boundariesDir = path.join(tmp, 'priority-boundaries');
  const priorityPath = path.join(tmp, 'PRIORITIES.md');
  const sessionLogPath = path.join(tmp, 'SESSION_LOG.md');
  const profilePath = path.join(tmp, 'profile.json');
  const routePath = path.join(tmp, 'route.json');
  await mkdir(adaptersDir, { recursive: true });
  await mkdir(boundariesDir, { recursive: true });
  await writeFile(path.join(adaptersDir, 'claude.json'), `${JSON.stringify(adapter('claude'), null, 2)}\n`);
  await writeFile(path.join(adaptersDir, 'codex.json'), `${JSON.stringify(adapter('codex'), null, 2)}\n`);
  if (options.scriptQuinn) {
    await writeFile(path.join(adaptersDir, 'quinn-scripts.json'), `${JSON.stringify(quinnScriptAdapter(), null, 2)}\n`);
  }
  await writeFile(path.join(boundariesDir, 'docs-rebuild.json'), `${JSON.stringify(priorityBoundary({
    routeId: options.dynamicTopology ? 'fixture-claude-oscar-dynamic' : 'fixture-claude-oscar-codex-bob',
    includePhil: options.dynamicTopology
  }), null, 2)}\n`);
  await writeFile(profilePath, `${JSON.stringify(profile(options), null, 2)}\n`);
  await writeFile(routePath, `${JSON.stringify(route({
    supportedPriorityOwners: options.supportedPriorityOwners,
    allowAutonomousTeammateStart: options.allowAutonomousTeammateStart,
    routeDeclaresCommit: options.routeDeclaresCommit || options.routeDeclaresOscarWrapCommit,
    routeDeclaresOscarWrapCommit: options.routeDeclaresOscarWrapCommit,
    requiresBobSideCommits: options.requiresBobSideCommits,
    dynamicTopology: options.dynamicTopology,
    scriptQuinn: options.scriptQuinn,
    bobAdapterSandbox: options.bobAdapterSandbox
  }), null, 2)}\n`);
  await writeFile(priorityPath, [
    ...(options.priorityNextAtomDrift ? [
      'Last updated: 2026-05-19 — [DOCS-REBUILD] A2 path canonicalization is next; see SESSION_LOG.md for full run history.',
      ''
    ] : []),
    '### [DOCS-REBUILD] Documentation Rebuild',
    ...(options.priorityNextAtomDrift ? [
      '**Plan:** Fixture plan. Next Session Start Here recommends **A1 — stale fixture atom** as the next atom.',
      '**Runnable:** Yes — **A1 is the next dispatch**.',
      '**Status:** Fixture active. Recommended next atom: **A1**.'
    ] : [
      '**Status:** In progress',
      'Launch fixture priority.'
    ]),
    '',
    ...(options.extraPrioritySlug ? [
      `### [${options.extraPrioritySlug}] Extra Priority`,
      '**Status:** In progress',
      'Launch fixture priority without a boundary.',
      ''
    ] : []),
    '### [OTHER] Other Priority'
  ].join('\n'));
  await writeFile(sessionLogPath, [
    '# Session Log',
    '',
    '## 2026-05-19 -- newest',
    '',
    '**Next.** Current pickup.',
    '',
    '---',
    '',
    '## 2026-05-18 -- older',
    '',
    'stale tail'
  ].join('\n'));

  return {
    tmp,
    adaptersDir,
    runsDir,
    boundariesDir,
    profilePath,
    routePath,
    priorityPath,
    sessionLogPath,
    options: async (overrides = {}) => ({
      contractsDir,
      adaptersDir,
      runsDir,
      priorityBoundariesDir: boundariesDir,
      profilePath,
      routePath,
      priorityFile: priorityPath,
      prioritySlug: overrides.prioritySlug || 'DOCS-REBUILD',
      sessionLogFile: sessionLogPath,
      sessionLineLimit: 2,
      runId: overrides.runId,
      execute: overrides.execute,
      deferStart: overrides.deferStart,
      attach: overrides.attach,
      transport: overrides.transport,
      socketName: overrides.socketName,
      tmuxBin: overrides.tmuxBin,
      cwd: overrides.cwd || promptFixtureRoot,
      probeGitCommitCapability: overrides.probeGitCommitCapability,
      allowConcurrentPriorityRun: overrides.allowConcurrentPriorityRun,
      env: { PATH: process.env.PATH || '' }
    }),
    cleanup: () => rm(tmp, { recursive: true, force: true })
  };
}

async function writePromptFixture(root) {
  const promptsRoot = path.join(root, 'cocoder/personas/prompts');
  await mkdir(path.join(promptsRoot, 'shared'), { recursive: true });
  await mkdir(path.join(promptsRoot, 'personas'), { recursive: true });
  await writeJson(path.join(promptsRoot, 'manifest.json'), {
    version: 1,
    personas: {
      oscar: [
        'shared/startup-packet.md',
        'shared/write-boundaries.md',
        'shared/result-contract.md',
        'shared/closeout.md',
        'shared/private-playbook-boundary.md',
        'shared/evidence-classes.md',
        'shared/session-wrap.md',
        'personas/oscar.md'
      ],
      bob: [
        'shared/startup-packet.md',
        'shared/write-boundaries.md',
        'shared/result-contract.md',
        'shared/closeout.md',
        'shared/private-playbook-boundary.md',
        'shared/evidence-classes.md',
        'personas/bob.md'
      ],
      phil: [
        'shared/startup-packet.md',
        'shared/write-boundaries.md',
        'shared/result-contract.md',
        'shared/closeout.md',
        'shared/private-playbook-boundary.md',
        'shared/evidence-classes.md',
        'personas/phil.md'
      ],
      talia: [
        'shared/startup-packet.md',
        'shared/write-boundaries.md',
        'shared/result-contract.md',
        'shared/closeout.md',
        'shared/private-playbook-boundary.md',
        'shared/evidence-classes.md',
        'personas/talia.md'
      ],
      quinn: [
        'shared/startup-packet.md',
        'shared/write-boundaries.md',
        'shared/result-contract.md',
        'shared/closeout.md',
        'shared/private-playbook-boundary.md',
        'shared/evidence-classes.md',
        'personas/quinn.md'
      ]
    }
  });
  await writeFile(path.join(promptsRoot, 'shared/startup-packet.md'), [
    '# Startup Packet Fragment',
    'startup_packet:',
    'Acknowledge startup warnings proportionally before dispatch.',
    'Do not run a broad dirty-worktree survey or block `add-lanes` unless a warning names staged work.',
    'Wait for the lead lane to reconcile startup warnings.'
  ].join('\n'));
  await writeFile(path.join(promptsRoot, 'shared/write-boundaries.md'), [
    '# Write Boundaries Fragment',
    'Do not mutate ignored dependency, build, or cache artifacts such as `node_modules/`, `dist/`, `.turbo/`.',
    'Verification must be reproducible from tracked manifests, lockfiles, and declared commands.'
  ].join('\n'));
  await writeFile(path.join(promptsRoot, 'shared/result-contract.md'), [
    '# Result Contract Fragment',
    '`routeAvailable` must be a JSON boolean.',
    'never strings like `"yes"` or `"no"`.',
    'Do not include upstream packet-authoring.',
    'do not restate or override that lane\'s result identity fields.'
  ].join('\n'));
  await writeFile(path.join(promptsRoot, 'shared/closeout.md'), [
    '# Closeout Fragment',
    'Architecture-invariant atoms cannot close on Bob PASS alone.',
    'Independent verification means a verifier path that is not Bob and not a Bob-invoked helper.'
  ].join('\n'));
  await writeFile(path.join(promptsRoot, 'shared/private-playbook-boundary.md'), [
    '# Private Playbook Boundary Fragment',
    'Do not invoke legacy persona slash skills or `Skill(...)` commands.'
  ].join('\n'));
  await writeFile(path.join(promptsRoot, 'shared/evidence-classes.md'), [
    '# Evidence Classes Fragment',
    'Codex YELLOW review gates are verifier work, not Bob implementation work.',
    'Never ask Bob to run `codex-review.sh` when Bob\'s adapter is `codex`.'
  ].join('\n'));
  await writeFile(path.join(promptsRoot, 'shared/session-wrap.md'), [
    '# Session Wrap Fragment',
    'Plain-English Finding:'
  ].join('\n'));
  await writeFile(path.join(promptsRoot, 'personas/oscar.md'), [
    '# Oscar Prompt Fragment',
    '## Lead Founder Interaction Guard',
    'Do not open Claude Code interactive question UI.',
    'Do not open interactive pickers, cursor-driven forms, checkbox menus.',
    'Forbidden founder-decision UI includes terminal lists that say `Enter to select`, `Type something`, `Chat about this`.',
    'Before `add-lanes`, do not block on low-level implementation mechanics.',
    'Selecting a declared topology option for an already authorized atom is not a founder decision.',
    'If orchestration mechanics fail, stop and report.',
    '## Validated Topology Options',
    'primitive-authoring: lanes oscar, phil.',
    'Use add-lanes --run-dir for validated topology expansion.'
  ].join('\n'));
  await writeFile(path.join(promptsRoot, 'personas/bob.md'), [
    '# Bob Prompt Fragment',
    'route-owned exact-file commits.',
    'Do not run `git add` or `git commit`.',
    'This lane\'s route-owned commit scope allows:',
    'Do not include another lane\'s implementation files in a lead wrap result.',
    'route-owned `orchestrator-commit` step is the only commit path.'
  ].join('\n'));
  await writeFile(path.join(promptsRoot, 'personas/phil.md'), '# Phil Prompt Fragment\n');
  await writeFile(path.join(promptsRoot, 'personas/talia.md'), '# Talia Prompt Fragment\n');
  await writeFile(path.join(promptsRoot, 'personas/quinn.md'), '# Quinn Prompt Fragment\n');
}

function recordingTransport() {
  return {
    calls: [],
    async run(args) {
      this.calls.push(args.join(' '));
      return { stdout: '', stderr: '' };
    }
  };
}

function failKillTransport() {
  return {
    calls: [],
    async run(args) {
      this.calls.push(args.join(' '));
      if (args.includes('kill-session')) throw new Error('kill failed');
      return { stdout: '', stderr: '' };
    }
  };
}

function assertFragmentOrder(prompt, fragments) {
  let previous = -1;
  for (const fragment of fragments) {
    const index = prompt.indexOf(`prompt-fragment: ${fragment};`);
    assert.notEqual(index, -1, `missing fragment ${fragment}`);
    assert.ok(index > previous, `${fragment} should appear after previous fragment`);
    previous = index;
  }
}

function jobResult({ persona, adapter, canWrite, status = 'PASS', filesChanged = ['none'], ...rest }) {
  return {
    status,
    persona,
    adapter,
    canWrite,
    filesChanged,
    summary: 'Fixture result.',
    findings: ['none'],
    evidence: ['fixture'],
    residualRisk: ['none'],
    nextAction: 'none',
    ...rest
  };
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeResultPair(jobDir, result, { founderBrief = result.persona === 'oscar' } = {}) {
  const resultForWrite = result.persona === 'oscar' && result.status === 'PASS' && !Array.isArray(result.personaDispatchPlan)
    ? { ...result, personaDispatchPlan: defaultPersonaDispatchPlan() }
    : result;
  await writeJson(path.join(jobDir, 'result.json'), resultForWrite);
  const lines = [
    `status: ${resultForWrite.status}`,
    `nextAction: ${resultForWrite.nextAction}`,
    ''
  ];
  if (founderBrief) {
    lines.push(
      '## Founder Completion Brief',
      '',
      'Atom Complete: Yes.',
      'What Changed: Fixture atom closed.',
      'What Remains: Continue the fixture priority.',
      'Recommended Next Step: Continue with the next fixture atom.',
      'Founder Decision Needed: No.',
      ''
    );
    if (founderBrief === 'verbose') {
      lines.push(
        'Extra Detail: This line should make the brief too long.',
        'Extra Detail: This line should make the brief too long.',
        'Extra Detail: This line should make the brief too long.',
        'Extra Detail: This line should make the brief too long.',
        'Extra Detail: This line should make the brief too long.',
        'Extra Detail: This line should make the brief too long.',
        'Extra Detail: This line should make the brief too long.',
        'Extra Detail: This line should make the brief too long.',
        'Extra Detail: This line should make the brief too long.',
        'Extra Detail: This line should make the brief too long.',
        'Extra Detail: This line should make the brief too long.',
        ''
      );
    }
    if (founderBrief === 'incomplete') {
      const index = lines.findIndex((line) => line.startsWith('Atom Complete:'));
      lines[index] = 'Atom Complete: No -- C0 partial.';
    }
    lines.push(
      '## Persona Dispatch Plan',
      '',
      '- Atom: Fixture atom; Required Persona: none; Route Available: yes; Dispatch Status: not-required; Evidence Expected: none.',
      ''
    );
  }
  await writeFile(path.join(jobDir, 'result.md'), lines.join('\n'));
}

function defaultPersonaDispatchPlan() {
  return [{
    atom: 'fixture',
    requiredPersona: 'none',
    routeAvailable: true,
    dispatchStatus: 'not-required',
    evidenceExpected: 'none'
  }];
}

async function appendCommitEvent(runDir, { lane, acceptedResultPath, sha }) {
  await writeFile(path.join(runDir, 'events.jsonl'), `${JSON.stringify({
    createdAt: '2026-05-19T12:00:00.000Z',
    type: 'orchestrator.commit',
    lane,
    acceptedResultPath,
    stagedPaths: [],
    sha,
    evidencePath: `evidence/orchestrator-commit-${lane}`,
    timestamp: '2026-05-19T12:00:00.000Z'
  })}\n`, { flag: 'a' });
}

async function git(repo, args) {
  const result = await execFileAsync('git', ['-C', repo, ...args], { maxBuffer: 1024 * 1024 });
  return result.stdout;
}

function failingVersionTransport() {
  return {
    calls: [],
    async run(args) {
      this.calls.push(args.join(' '));
      if (args.includes('-V')) throw new Error('tmux unavailable');
      return { stdout: '', stderr: '' };
    }
  };
}

function failingStartupTransport() {
  return {
    calls: [],
    async run(args) {
      this.calls.push(args.join(' '));
      if (args.includes('new-session')) throw new Error('new session failed');
      return { stdout: '', stderr: '' };
    }
  };
}

function adapter(id) {
  return {
    id,
    label: `${id} fixture`,
    kind: 'llm-cli',
    command: '/bin/sh',
    commandEnv: 'inherit',
    availabilityCheck: { commandExists: '/bin/sh' },
    capabilities: {
      interactive: true,
      initialPrompt: true,
      stdinDispatch: true,
      resultFile: true,
      transcriptCapture: true,
      streamingDetection: true,
      screenshots: false,
      dom: false,
      console: false,
      shell: true,
      fileEdit: true
    },
    writeCapability: 'repo',
    sandboxModes: ['read-only', 'workspace-write'],
    approvalModes: ['never', 'on-request'],
    resultContract: 'job-result',
    evidenceCapabilities: ['transcript', 'command-output', 'diff', 'test-result'],
    failureModes: ['missing-cli', 'auth-expired', 'stalled-tui', 'refusal', 'no-result-file', 'permission-prompt', 'rate-limit', 'unknown']
  };
}

function quinnScriptAdapter() {
  return {
    ...adapter('quinn-scripts'),
    kind: 'script',
    command: 'node',
    availabilityCheck: { commandExists: 'node' },
    capabilities: {
      interactive: false,
      initialPrompt: false,
      stdinDispatch: false,
      resultFile: true,
      transcriptCapture: false,
      streamingDetection: false,
      screenshots: true,
      dom: true,
      console: true,
      shell: false,
      fileEdit: false
    },
    writeCapability: 'none',
    sandboxModes: ['read-only'],
    approvalModes: ['never'],
    evidenceCapabilities: ['screenshot', 'dom', 'console', 'command-output', 'test-result']
  };
}

function profile(options = {}) {
  const readonly = (persona, adapterId = 'claude') => ({
    persona,
    adapter: adapterId,
    adapterProfile: adapterId === 'claude' ? 'opus' : 'default',
    canWrite: false,
    writeBoundary: [],
    excludedWriteBoundary: [],
    resultContract: 'job-result',
    evidenceClassDefault: 'B'
  });
  const writer = (persona, adapterId = 'codex') => ({
    persona,
    adapter: adapterId,
    adapterProfile: adapterId === 'codex' ? 'gpt-5.5' : 'default',
    canWrite: true,
    writeBoundary: [],
    excludedWriteBoundary: [],
    resultContract: 'job-result',
    evidenceClassDefault: 'B'
  });
  return {
    id: 'fixture-profile',
    label: 'Fixture Profile',
    createdFor: 'DOCS-REBUILD',
    lanes: {
      oscar: readonly('oscar', 'claude'),
      bob: writer('bob', 'codex'),
      ian: readonly('ian', 'claude'),
      phil: writer('phil', 'codex'),
      talia: readonly('talia', 'claude'),
      quinn: readonly('quinn', options.scriptQuinn ? 'quinn-scripts' : 'claude'),
      verifiers: {
        primary: readonly('verifier', 'claude'),
        adversarial: readonly('verifier', 'claude')
      },
      bobHelpers: {
        default: readonly('bob-helper', 'codex'),
        readonlyResearch: readonly('bob-helper', 'claude'),
        implementation: writer('bob-helper', 'codex')
      }
    },
    modelRoles: {
      orchestrator: { lane: 'oscar', purpose: 'lead orchestration' },
      builder: { lane: 'bob', purpose: 'primary implementation' },
      builderSubagents: {
        primary: [{ adapter: 'codex', adapterProfile: 'gpt-5.5', label: 'Codex GPT-5.5', purpose: 'coding subagents' }]
      },
      planning: {
        primary: [{ adapter: 'claude', adapterProfile: 'opus-4.7', label: 'Claude Opus 4.7', purpose: 'priority-to-plan authoring' }],
        audit: [{ adapter: 'codex', adapterProfile: 'gpt-5.5', label: 'Codex GPT-5.5', purpose: 'plan review' }]
      },
      research: {
        primary: [{ adapter: 'codex', adapterProfile: 'gpt-5.5', label: 'Codex GPT-5.5', purpose: 'primary research' }],
        triangulation: [{ adapter: 'claude', adapterProfile: 'opus-4.7', label: 'Claude Opus 4.7', purpose: 'audit/synthesis only' }],
        synthesis: [{ lane: 'oscar', purpose: 'founder-facing synthesis' }]
      },
      fallbackPolicy: 'ask-founder',
      substitutionPolicy: 'strict'
    },
    defaults: {
      evidenceClass: 'B',
      maxParallelHelpers: 1,
      missingAdapterPolicy: 'needs_founder'
    }
  };
}

function priorityBoundary({ routeId = 'fixture-claude-oscar-codex-bob', includePhil = false } = {}) {
  return {
    id: 'docs-rebuild-boundary',
    prioritySlug: 'DOCS-REBUILD',
    label: 'DOCS fixture boundary',
    routeIds: [routeId],
    writerLanes: {
      bob: {
        allowed: ['docs/'],
        excluded: ['packages/core/']
      },
      ...(includePhil ? {
        phil: {
          allowed: ['cocoder-roots/'],
          excluded: []
        }
      } : {})
    }
  };
}

function route({ supportedPriorityOwners = ['*'], allowAutonomousTeammateStart = false, routeDeclaresCommit = false, routeDeclaresOscarWrapCommit = false, requiresBobSideCommits = false, dynamicTopology = false, scriptQuinn = false, bobAdapterSandbox = null } = {}) {
  if (dynamicTopology) {
    return {
      id: 'fixture-claude-oscar-dynamic',
      label: 'Fixture Claude Oscar Dynamic',
      lead: 'oscar',
      teammates: ['bob', 'phil', 'talia', 'quinn'],
      lanes: ['oscar', 'bob', 'phil', 'talia', 'quinn'],
      initialLanes: ['oscar'],
      topologyOptions: [
        {
          id: 'primitive-authoring',
          label: 'Oscar and Phil primitive authoring',
          lanes: ['oscar', 'phil'],
          requiredPersonas: ['phil']
        },
        {
          id: 'implementation',
          label: 'Oscar and Bob implementation',
          lanes: ['oscar', 'bob'],
          requiredPersonas: ['bob']
        },
        {
          id: 'qa-verification',
          label: 'Oscar with Talia and Quinn verification',
          lanes: ['oscar', 'talia', 'quinn'],
          requiredPersonas: ['talia', 'quinn']
        },
        {
          id: 'primitive-implementation',
          label: 'Oscar with Phil and Bob split-scope work',
          lanes: ['oscar', 'phil', 'bob'],
          requiredPersonas: ['phil', 'bob']
        }
      ],
      supportedPriorityOwners,
      gates: ['startup-packet', 'profile-preflight', 'write-boundary'],
      writePolicy: 'bounded-writers',
      orchestratorCommit: {
        enabled: true,
        owner: 'route',
        writerLanes: ['phil', 'bob'],
        laneWriteScopes: {
          phil: {
            allowed: ['cocoder-roots/'],
            excluded: []
          },
          bob: {
            allowed: ['docs/'],
            excluded: ['packages/core/']
          }
        },
        stageMode: 'exact-files',
        acceptedResultField: 'filesChanged',
        blockUnrelatedStaged: true,
        preserveUnstaged: true,
        coAuthorWriter: true
      },
      laneRequirements: {
        oscar: {
          allowedAdapters: ['claude'],
          requiresInteractive: true,
          requiredCapabilities: ['initialPrompt', 'stdinDispatch', 'transcriptCapture'],
          requiredEvidenceCapabilities: ['transcript', 'command-output']
        },
        bob: {
          allowedAdapters: ['codex'],
          requiresInteractive: true,
          requiredCapabilities: ['initialPrompt', 'stdinDispatch', 'fileEdit', 'shell'],
          requiredEvidenceCapabilities: ['transcript', 'diff', 'test-result'],
          ...(bobAdapterSandbox ? { adapterSandbox: bobAdapterSandbox } : {})
        },
        phil: {
          allowedAdapters: ['codex'],
          requiresInteractive: true,
          requiredCapabilities: ['initialPrompt', 'stdinDispatch', 'fileEdit'],
          requiredEvidenceCapabilities: ['transcript', 'diff']
        },
        talia: {
          allowedAdapters: ['claude'],
          requiresInteractive: true,
          requiredCapabilities: ['initialPrompt', 'stdinDispatch'],
          requiredEvidenceCapabilities: ['transcript', 'command-output']
        },
        quinn: scriptQuinn ? {
          allowedAdapters: ['quinn-scripts'],
          requiresInteractive: false,
          requiredCapabilities: ['resultFile', 'screenshots', 'dom', 'console'],
          requiredEvidenceCapabilities: ['screenshot', 'dom', 'console', 'test-result'],
          readOnlyVerifier: true
        } : {
          allowedAdapters: ['claude'],
          requiresInteractive: true,
          requiredCapabilities: ['initialPrompt', 'stdinDispatch'],
          requiredEvidenceCapabilities: ['transcript', 'command-output']
        }
      }
    };
  }
  return {
    id: 'fixture-claude-oscar-codex-bob',
    label: 'Fixture Claude Oscar Codex Bob',
    lead: 'oscar',
    teammates: ['bob'],
    lanes: ['oscar', 'bob'],
    supportedPriorityOwners,
    gates: ['startup-packet', 'profile-preflight', 'write-boundary'],
    writePolicy: 'one-writer',
    allowAutonomousTeammateStart,
    ...(routeDeclaresCommit ? {
      orchestratorCommit: {
        enabled: true,
        owner: 'route',
        writerLanes: ['bob', ...(routeDeclaresOscarWrapCommit ? ['oscar'] : [])],
        ...(routeDeclaresOscarWrapCommit ? {
          laneWriteScopes: {
            oscar: {
              allowed: [
                'cocoder/PRIORITIES.md',
                'cocoder/SESSION_LOG.md',
                'cocoder/plans/*.md'
              ],
              excluded: []
            }
          }
        } : {}),
        stageMode: 'exact-files',
        acceptedResultField: 'filesChanged',
        blockUnrelatedStaged: true,
        preserveUnstaged: true,
        coAuthorWriter: true
      }
    } : {}),
    ...(requiresBobSideCommits ? {
      gitCommitPolicy: {
        mode: 'writer-lane',
        writerLanes: ['bob']
      }
    } : {}),
    laneRequirements: {
      oscar: {
        allowedAdapters: ['claude'],
        requiresInteractive: true,
        requiredCapabilities: ['initialPrompt', 'stdinDispatch', 'transcriptCapture'],
        requiredEvidenceCapabilities: ['transcript', 'command-output']
      },
      bob: {
        allowedAdapters: ['codex'],
        requiresInteractive: true,
        requiredCapabilities: ['initialPrompt', 'stdinDispatch', 'fileEdit', 'shell'],
        requiredEvidenceCapabilities: ['transcript', 'diff', 'test-result'],
        ...(bobAdapterSandbox ? { adapterSandbox: bobAdapterSandbox } : {})
      }
    }
  };
}
