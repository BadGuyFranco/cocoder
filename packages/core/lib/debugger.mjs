import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { pathExists, readJson, writeJson } from './fs-utils.mjs';

const execFileAsync = promisify(execFile);
const CORE_CLI_PATH = fileURLToPath(new URL('../cli.mjs', import.meta.url));
const DEFAULT_TMUX_BIN = process.env.TMUX_BIN || '/opt/homebrew/bin/tmux';
const INTERACTIVE_PICKER_SIGNAL_PATTERNS = [
  /Enter to select/i,
  /Type something\.?/i,
  /Chat about this/i,
  /Esc to cancel/i
];
const DEBUGGER_RUNTIME_FACTS = {
  sendMessage: {
    clearsInputBeforePaste: true,
    clearCommand: 'tmux send-keys C-u',
    behavior: 'run-local send-message clears the target input line before paste-buffer and Enter',
    paneTextGuidance: 'Visible composer-like pane text is ambiguous evidence; do not classify it as dispatch contamination unless it persists after dispatch or correlates with wrong-task execution, result artifacts, or out-of-boundary edits.'
  },
  intervention: {
    tmuxSendAuthority: 'probe-on-use',
    blockedSendGuidance: 'If a debugger tmux send attempt fails, classify debugger intervention as observe-only/founder-action-needed; do not treat that failure alone as proof the active run is broken.'
  }
};

export async function prepareDebuggerSession(options) {
  const repoRoot = options.repoRoot || process.cwd();
  const runsDir = path.resolve(repoRoot, options.runsDir || 'cocoder/runs');
  const debuggerRunsDir = path.resolve(repoRoot, options.debuggerRunsDir || 'cocoder/debug-runs');
  const noSession = options.noSession === true || options.noSession === 'true';
  const sessionId = noSession ? (options.sessionId || 'NO-SESSION') : options.sessionId;
  if (!sessionId) throw new Error('Missing required sessionId');

  const resolved = noSession ? { runDir: null, matchType: 'none' } : await resolveRunDir({ runsDir, sessionId });
  const debugId = `debug-${new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15)}-${safeName(sessionId).slice(-12)}`;
  const debugDir = path.join(debuggerRunsDir, debugId);
  await mkdir(debugDir, { recursive: true });

  const bundle = noSession ? await collectNoSessionDebugEvidence({
    repoRoot,
    runsDir,
    sessionId,
    tmuxBin: options.tmuxBin || DEFAULT_TMUX_BIN,
    mode: options.mode || 'launch-failure',
    followIntervalSeconds: Number(options.followIntervalSeconds || 60)
  }) : await collectDebugEvidence({
    repoRoot,
    runDir: resolved.runDir,
    sessionId,
    tmuxBin: options.tmuxBin || DEFAULT_TMUX_BIN,
    mode: options.mode || 'snapshot',
    followIntervalSeconds: Number(options.followIntervalSeconds || 60)
  });
  bundle.debug = {
    debugId,
    debugDir,
    promptPath: path.join(debugDir, 'prompt.md'),
    reportPath: path.join(debugDir, 'debug-report.md'),
    resultPath: path.join(debugDir, 'debug-result.json'),
    followCollector: noSession || bundle.mode !== 'follow'
      ? { enabled: false }
      : {
        enabled: true,
        latestPath: path.join(debugDir, 'follow', 'latest-evidence-bundle.json'),
        snapshotsDir: path.join(debugDir, 'follow', 'snapshots'),
        logPath: path.join(debugDir, 'follow', 'collector.log'),
        pidPath: path.join(debugDir, 'follow', 'collector.pid')
      }
  };
  await writeJson(path.join(debugDir, 'evidence-bundle.json'), bundle);

  const prompt = renderDebuggerPrompt(bundle);
  await writeFile(bundle.debug.promptPath, prompt);
  const wrapperPath = path.join(debugDir, 'launch-debugger.sh');
  await writeFile(wrapperPath, renderDebuggerWrapper(repoRoot, bundle), { mode: 0o755 });

  return {
    ok: true,
    status: 'ready',
    sessionId,
    noSession,
    runDir: resolved.runDir,
    debugDir,
    evidenceBundlePath: path.join(debugDir, 'evidence-bundle.json'),
    promptPath: bundle.debug.promptPath,
    wrapperPath,
    reportPath: bundle.debug.reportPath,
    resultPath: bundle.debug.resultPath,
    mode: bundle.mode,
    followIntervalSeconds: bundle.followIntervalSeconds,
    issues: bundle.issues
  };
}

export async function followDebuggerEvidence({ repoRoot, runDir, sessionId, debugDir, tmuxBin = DEFAULT_TMUX_BIN, followIntervalSeconds = 60, maxCycles = 0 }) {
  const followDir = path.join(debugDir, 'follow');
  const snapshotsDir = path.join(followDir, 'snapshots');
  const latestPath = path.join(followDir, 'latest-evidence-bundle.json');
  const statusPath = path.join(followDir, 'collector-status.json');
  await mkdir(snapshotsDir, { recursive: true });

  let cycles = 0;
  while (true) {
    cycles += 1;
    const collectedAt = new Date().toISOString();
    try {
      const bundle = await collectDebugEvidence({
        repoRoot,
        runDir,
        sessionId,
        tmuxBin,
        mode: 'follow',
        followIntervalSeconds
      });
      const snapshotPath = path.join(snapshotsDir, `evidence-${compactTimestamp(collectedAt)}.json`);
      bundle.followCollector = {
        collectedBy: 'orchestration-debugger-follow-collector',
        cycle: cycles,
        latestPath,
        snapshotsDir,
        lastSnapshotPath: snapshotPath
      };
      await writeJson(latestPath, bundle);
      await writeJson(snapshotPath, bundle);
      await writeJson(statusPath, {
        ok: true,
        status: 'running',
        cycle: cycles,
        lastCollectedAt: collectedAt,
        latestPath,
        lastSnapshotPath: snapshotPath
      });
      if (isTerminalRunStatus(bundle.run?.status)) {
        await writeJson(statusPath, {
          ok: true,
          status: 'stopped',
          reason: 'run reached terminal status',
          cycle: cycles,
          lastCollectedAt: collectedAt,
          latestPath,
          lastSnapshotPath: snapshotPath
        });
        return { ok: true, status: 'stopped', reason: 'run reached terminal status', cycles, latestPath, lastSnapshotPath: snapshotPath };
      }
    } catch (error) {
      await writeJson(statusPath, {
        ok: false,
        status: 'error',
        cycle: cycles,
        lastCollectedAt: collectedAt,
        error: error.message || String(error)
      });
    }

    if (maxCycles > 0 && cycles >= maxCycles) {
      return { ok: true, status: 'stopped', reason: 'max cycles reached', cycles, latestPath };
    }
    await sleep(Math.max(1, Number(followIntervalSeconds || 60)) * 1000);
  }
}

export async function collectNoSessionDebugEvidence({ repoRoot, runsDir, sessionId = 'NO-SESSION', tmuxBin = DEFAULT_TMUX_BIN, mode = 'launch-failure', followIntervalSeconds = 60 }) {
  const git = await collectGitEvidence(repoRoot);
  const launchPreflight = await collectLaunchPreflight(repoRoot);
  const adapterProbes = await collectAdapterProbes(repoRoot);
  const concurrency = await collectConcurrencyMap({ repoRoot, runsDir, tmuxBin });
  const rootCheck = {
    ok: true,
    roots: [{ source: 'debugger-process', path: repoRoot, normalized: normalizePath(repoRoot) }],
    uniqueRoots: [normalizePath(repoRoot)],
    note: 'No run/session was supplied; root check is limited to the debugger process root.'
  };
  const issues = classifyNoSessionIssues({ git, launchPreflight, adapterProbes, concurrency, rootCheck });

  return {
    version: 1,
    collectedAt: new Date().toISOString(),
    mode,
    noSession: true,
    followIntervalSeconds,
    sessionId,
    repoRoot,
    runDir: null,
    targetRun: buildTargetRun({ sessionId, runDir: null }),
    targetPanes: [],
    rootCheck,
    debuggerRuntime: DEBUGGER_RUNTIME_FACTS,
    launchPreflight,
    adapterProbes,
    concurrency,
    git,
    issues
  };
}

export async function collectDebugEvidence({ repoRoot, runDir, sessionId, tmuxBin = DEFAULT_TMUX_BIN, mode = 'snapshot', followIntervalSeconds = 60 }) {
  const launchPath = path.join(runDir, 'launch.json');
  const startupPacketPath = path.join(runDir, 'startup-packet.json');
  const statusPath = path.join(runDir, 'status.json');
  const topologyDecisionPath = path.join(runDir, 'topology-decision.json');
  const launch = await readJsonIfExists(launchPath);
  const startupPacket = await readJsonIfExists(startupPacketPath);
  const status = await readJsonIfExists(statusPath);
  const topologyDecision = await readJsonIfExists(topologyDecisionPath);
  const jobs = await collectJobs(path.join(runDir, 'jobs'));
  const watchers = await collectTextFiles(path.join(runDir, 'watchers'), 20000);
  const panes = await collectPaneEvidence({ launch, tmuxBin });
  const git = await collectGitEvidence(repoRoot);
  const roots = buildRootCheck({ repoRoot, runDir, launch, startupPacket, panes });
  const targetRun = buildTargetRun({ sessionId, runDir, launch, startupPacket, status });
  const resultConsistency = await collectResultConsistency({ runDir, launch, status, jobs });
  const launchPreflight = await collectLaunchPreflight(repoRoot);
  const adapterProbes = await collectAdapterProbes(repoRoot);
  const concurrency = await collectConcurrencyMap({ repoRoot, runsDir: path.dirname(runDir), tmuxBin, currentRunDir: runDir });
  const issues = classifyDebugIssues({ status, jobs, panes, watchers, git, roots, resultConsistency, launchPreflight, adapterProbes });

  return {
    version: 1,
    collectedAt: new Date().toISOString(),
    mode,
    followIntervalSeconds,
    sessionId,
    repoRoot,
    runDir,
    targetRun,
    targetPanes: panes,
    rootCheck: roots,
    debuggerRuntime: DEBUGGER_RUNTIME_FACTS,
    run: {
      launchPath,
      startupPacketPath,
      statusPath,
      topologyDecisionPath,
      launch,
      startupPacket,
      status,
      topologyDecision
    },
    jobs,
    watchers,
    panes,
    resultConsistency,
    launchPreflight,
    adapterProbes,
    concurrency,
    git,
    issues
  };
}

async function collectLaunchPreflight(repoRoot) {
  // M4.13 (audit §H8): the three legacy `.command` double-click wrappers
  // (Launch-Orchestrator.command, ORCH DEBUGGER.command, Stop-Orchestrator-Run.command)
  // were intentionally dropped during the CoBuilder extraction and formally
  // retired 2026-05-23 per ticket 0001 Path B (CoCoder is terminal-only).
  // The previous `zsh -n` syntax probes against those files always failed
  // and added noise to every debugger evidence bundle. The launch preflight
  // now runs only the live CLI validate-* checks that reflect real
  // orchestration health.
  const cliPath = CORE_CLI_PATH;
  return {
    validateAdapters: await runCommand(process.execPath, [cliPath, 'validate-adapters'], { cwd: repoRoot, maxBuffer: 512 * 1024 }),
    preflightAdapters: await runCommand(process.execPath, [cliPath, 'preflight-adapters'], { cwd: repoRoot, maxBuffer: 512 * 1024 }),
    validateProfiles: await runCommand(process.execPath, [cliPath, 'validate-profiles'], { cwd: repoRoot, maxBuffer: 512 * 1024 }),
    validateRoutes: await runCommand(process.execPath, [cliPath, 'validate-routes'], { cwd: repoRoot, maxBuffer: 512 * 1024 }),
    validatePriorityBoundaries: await runCommand(process.execPath, [cliPath, 'validate-priority-boundaries'], { cwd: repoRoot, maxBuffer: 512 * 1024 }),
    validatePersonas: await runCommand(process.execPath, [cliPath, 'validate-personas'], { cwd: repoRoot, maxBuffer: 512 * 1024 })
  };
}

async function collectAdapterProbes(repoRoot) {
  const probeDir = path.join(repoRoot, 'cocoder/debug-runs/.adapter-probe');
  const workspaceProbePath = path.join(probeDir, `workspace-${process.pid}.tmp`);
  // M4.14 (audit §H15): the git-write probe MUST stay inside `.git/` so
  // sandboxes that can write to the workspace but not to git metadata are
  // correctly detected. Pollution concern is addressed by isolating the
  // probe into a dedicated `.git/cocoder-capability-probes/` subdirectory
  // (mirrors the same scheme `launch.mjs probeRepoGitCommitCapability` uses)
  // rather than dropping a file directly at the top of `.git/` where the
  // name could be mistaken for git's own internals.
  const gitProbeDir = path.join(repoRoot, '.git', 'cocoder-capability-probes');
  const gitProbePath = path.join(gitProbeDir, `debugger-${process.pid}.tmp`);
  await mkdir(probeDir, { recursive: true });
  const workspaceWrite = await writeProbe(workspaceProbePath);
  const gitWrite = await writeProbe(gitProbePath);
  // Best-effort cleanup of the probe subdir if the probe itself succeeded
  // and removed the file (writeProbe rms on success). Failure-path leftovers
  // are intentionally left for the next debugger invocation to retry — the
  // dir is gitignored by git's own tracking semantics.
  await rm(gitProbeDir, { recursive: true, force: true }).catch(() => {});
  return {
    codexCommand: await commandProbe('codex'),
    claudeCommand: await commandProbe('claude'),
    tmuxCommand: await commandProbe('tmux'),
    workspaceWrite,
    gitWrite,
    gitIndexLockState: await fileState(path.join(repoRoot, '.git/index.lock'))
  };
}

async function writeProbe(filePath) {
  try {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `probe ${new Date().toISOString()}\n`, { flag: 'wx' });
    await rm(filePath, { force: true });
    return { ok: true, path: filePath };
  } catch (error) {
    return { ok: false, path: filePath, error: error.message || String(error), code: error.code };
  }
}

async function commandProbe(command) {
  // M4.11 (audit §H9): previously `bash -lc "command -v <cmd>"`. The `bash
  // -lc` form sources login files (`/etc/profile`, `~/.bash_profile`, …),
  // which means an unrelated shell-config bug can corrupt the probe result,
  // and (more pointedly) it violates the Oz "no shell-string interpolation
  // of workspace paths" invariant in spirit. `/usr/bin/which` is a real
  // binary on macOS + Linux that does the same job — exits 0 with the path
  // when found, exits non-zero otherwise — without spawning a shell. The
  // input `command` was already sanitised through `shellWord(...)`; passing
  // it via argv to `which` removes shell parsing from the picture entirely.
  return runCommand('/usr/bin/which', [shellWord(command)], { maxBuffer: 64 * 1024 });
}

async function collectConcurrencyMap({ repoRoot, runsDir, tmuxBin, currentRunDir }) {
  const listSessions = await runCommand(tmuxBin, ['-L', 'cocoder-orchestration', 'list-sessions', '-F', '#{session_name}\t#{session_created}\t#{session_attached}'], { maxBuffer: 512 * 1024 });
  const listPanes = await runCommand(tmuxBin, ['-L', 'cocoder-orchestration', 'list-panes', '-a', '-F', '#{session_name}\t#{pane_current_command}\t#{pane_current_path}\t#{pane_dead}'], { maxBuffer: 512 * 1024 });
  const runMap = await mapRunsToSessions(runsDir);
  const sessions = listSessions.ok
    ? listSessions.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
      const [sessionName, created, attached] = line.split('\t');
      return {
        sessionName,
        created,
        attached: attached === '1',
        runId: runMap.get(sessionName)?.runId || null,
        runDir: runMap.get(sessionName)?.runDir || null,
        isCurrentRun: currentRunDir ? runMap.get(sessionName)?.runDir === currentRunDir : false
      };
    })
    : [];
  const panes = listPanes.ok
    ? listPanes.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
      const [sessionName, command, currentPath, dead] = line.split('\t');
      return { sessionName, command, currentPath, dead: dead === '1' };
    })
    : [];
  return {
    listSessions,
    listPanes,
    sessions,
    panes,
    activeOtherSessions: sessions.filter((session) => !session.isCurrentRun),
    otherSessions: sessions.filter((session) => !session.isCurrentRun)
  };
}

async function mapRunsToSessions(runsDir) {
  const map = new Map();
  if (!runsDir || !(await pathExists(runsDir))) return map;
  const entries = await readdir(runsDir, { withFileTypes: true });
  for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
    const runDir = path.join(runsDir, entry.name);
    const launch = await readJsonIfExists(path.join(runDir, 'launch.json'));
    for (const session of launch?.sessions || []) {
      if (session.sessionName) map.set(session.sessionName, { runId: launch.runId || entry.name, runDir });
    }
  }
  return map;
}

async function collectResultConsistency({ runDir, launch, status, jobs }) {
  const observations = [];
  const mismatches = [];
  const launchSessions = Array.isArray(launch?.sessions) ? launch.sessions : [];
  const jobsByLane = new Map(jobs.map((job) => [job.lane, job]));
  for (const session of launchSessions) {
    const job = jobsByLane.get(session.lane);
    const resultStatus = job?.resultJson?.status || null;
    const statusJob = status?.jobs?.[session.lane] || null;
    const markdownStatus = parseMarkdownStatus(job?.resultMarkdown);
    observations.push({
      lane: session.lane,
      resultStatus,
      statusJsonStatus: job?.statusJson?.status || null,
      runStatusJobStatus: statusJob?.status || null,
      markdownStatus
    });
    if (statusJob?.status && resultStatus && statusJob.status !== resultStatus) {
      mismatches.push({ lane: session.lane, code: 'run-status-job-result-mismatch', detail: `status.json.jobs.${session.lane}=${statusJob.status}, result.json=${resultStatus}` });
    }
    if (markdownStatus && resultStatus && markdownStatus !== resultStatus) {
      mismatches.push({ lane: session.lane, code: 'markdown-result-status-mismatch', detail: `result.md=${markdownStatus}, result.json=${resultStatus}` });
    }
  }
  const observedStatuses = observations.flatMap((item) => [item.resultStatus, item.statusJsonStatus, item.runStatusJobStatus, item.markdownStatus]).filter(Boolean);
  if (status?.status === 'needs_founder' && observedStatuses.includes('PASS') && observedStatuses.includes('NEEDS_FOUNDER')) {
    mismatches.push({ code: 'mixed-pass-needs-founder-results', detail: 'At least one lane is PASS while another remains NEEDS_FOUNDER; check whether a lead rescue superseded the stale result.' });
  }
  return { observations, mismatches };
}

export async function resolveRunDir({ runsDir, sessionId }) {
  const normalized = String(sessionId).trim();
  if (!normalized) throw new Error('Session id cannot be empty');
  const direct = path.resolve(runsDir, normalized);
  if (normalized.startsWith('run-') && (await pathExists(direct))) {
    return { runDir: direct, matchType: 'exact' };
  }

  const entries = await readdir(runsDir, { withFileTypes: true });
  const matches = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name === normalized || name.includes(normalized) || name.endsWith(normalized));

  if (matches.length === 0) throw new Error(`No orchestration run found for session id ${sessionId} in ${runsDir}`);
  if (matches.length > 1) throw new Error(`Multiple orchestration runs match ${sessionId}: ${matches.join(', ')}`);
  return { runDir: path.join(runsDir, matches[0]), matchType: 'partial' };
}

async function collectJobs(jobsDir) {
  if (!(await pathExists(jobsDir))) return [];
  const entries = await readdir(jobsDir, { withFileTypes: true });
  const jobs = [];
  for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
    const jobDir = path.join(jobsDir, entry.name);
    jobs.push({
      lane: entry.name,
      dir: jobDir,
      prompt: await readTextIfExists(path.join(jobDir, 'prompt.md'), 20000),
      resultJson: await readJsonIfExists(path.join(jobDir, 'result.json')),
      resultMarkdown: await readTextIfExists(path.join(jobDir, 'result.md'), 20000),
      statusJson: await readJsonIfExists(path.join(jobDir, 'status.json')),
      files: await listFiles(jobDir)
    });
  }
  return jobs;
}

async function collectPaneEvidence({ launch, tmuxBin }) {
  const sessions = Array.isArray(launch?.sessions) ? launch.sessions : [];
  const socketName = launch?.socketName || 'cocoder-orchestration';
  const panes = [];
  for (const session of sessions) {
    const target = session.sessionName;
    const captured = await runCommand(tmuxBin, ['-L', socketName, 'capture-pane', '-p', '-t', target, '-S', '-250'], { maxBuffer: 1024 * 1024 });
    panes.push({
      lane: session.lane,
      persona: session.persona,
      adapter: session.adapter,
      sessionName: target,
      displayLabel: session.displayLabel,
      ok: captured.ok,
      stdout: truncate(captured.stdout, 50000),
      stderr: truncate(captured.stderr || captured.error || '', 12000)
    });
  }
  return panes;
}

async function collectGitEvidence(repoRoot) {
  return {
    statusShort: await runGit(repoRoot, ['status', '--short']),
    statusPorcelainV1: await runGit(repoRoot, ['status', '--porcelain=v1']),
    stagedStat: await runGit(repoRoot, ['diff', '--cached', '--stat']),
    unstagedStat: await runGit(repoRoot, ['diff', '--stat']),
    recentLog: await runGit(repoRoot, ['log', '--oneline', '-12']),
    indexLock: await fileState(path.join(repoRoot, '.git/index.lock'))
  };
}

function buildRootCheck({ repoRoot, runDir, launch, startupPacket, panes }) {
  const roots = [
    { source: 'debugger-process', path: repoRoot },
    { source: 'run-dir-parent', path: inferRepoRootFromRunDir(runDir) },
    { source: 'launch.cwd', path: launch?.cwd },
    { source: 'launch.runDir', path: launch?.runDir ? inferRepoRootFromRunDir(launch.runDir) : undefined },
    { source: 'startupPacket.repoRoot', path: startupPacket?.repoRoot }
  ].filter((entry) => entry.path);
  for (const pane of panes || []) {
    const match = pane.stdout?.match(/directory:\s+(.+)$/m) || pane.stdout?.match(/\/Volumes\/[^\n]+\/infrastructure/m);
    const panePath = cleanPanePath(match?.[1] || match?.[0]);
    if (panePath) roots.push({ source: `pane.${pane.lane}`, path: panePath });
  }
  const normalized = roots.map((entry) => ({ ...entry, normalized: normalizePath(entry.path) }));
  const unique = [...new Set(normalized.map((entry) => entry.normalized))];
  return {
    ok: unique.length <= 1,
    roots: normalized,
    uniqueRoots: unique,
    note: unique.length <= 1 ? 'All discovered roots agree.' : 'Discovered roots disagree; do not apply fixes until founder chooses the canonical root.'
  };
}

function buildTargetRun({ sessionId, runDir, launch, startupPacket, status }) {
  const sessions = Array.isArray(launch?.sessions) ? launch.sessions : [];
  return {
    sessionId,
    runDir: runDir || null,
    runId: launch?.runId || (runDir ? path.basename(runDir) : null),
    priority: startupPacket?.selectedPriority?.slug || status?.prioritySlug || launch?.prioritySlug || null,
    routeId: launch?.route?.id || status?.routeId || startupPacket?.route?.id || null,
    status: status?.status || null,
    terminal: status?.terminal === true,
    lanes: sessions.map((session) => ({
      lane: session.lane || null,
      persona: session.persona || null,
      adapter: session.adapter || null,
      adapterProfile: session.adapterProfile || null,
      sessionName: session.sessionName || null,
      displayLabel: session.displayLabel || null,
      startupMode: session.startupMode || null,
      resultPath: session.resultPath || null,
      markdownResultPath: session.markdownResultPath || null
    }))
  };
}

function classifyNoSessionIssues({ git, launchPreflight, adapterProbes, concurrency, rootCheck }) {
  const issues = [];
  if (!rootCheck.ok) issues.push({ severity: 'block', code: 'root-mismatch', detail: rootCheck.note });
  if (git.indexLock.exists) issues.push({ severity: 'block', code: 'git-index-lock-present', detail: `.git/index.lock exists: ${git.indexLock.path}` });
  if (git.stagedStat.stdout?.trim()) issues.push({ severity: 'block', code: 'staged-work-present', detail: 'Git index contains staged work; launch-failure debugging must not contaminate staged work.' });
  for (const [name, result] of Object.entries(launchPreflight || {})) {
    if (!result.ok) issues.push({ severity: 'warn', code: `preflight-${safeName(name)}-failed`, detail: `${name}: ${firstLine(result.stderr || result.error || result.stdout)}` });
  }
  for (const [name, result] of Object.entries(adapterProbes || {})) {
    if (result && result.ok === false) issues.push({ severity: name === 'gitWrite' ? 'block' : 'warn', code: `adapter-probe-${safeName(name)}-failed`, detail: `${name}: ${result.error || firstLine(result.stderr || result.stdout)}` });
  }
  if (concurrency?.activeOtherSessions?.length > 0) {
    issues.push({ severity: 'warn', code: 'active-orchestration-sessions-present', detail: `${concurrency.activeOtherSessions.length} active orchestration session(s) are present on the tmux socket.` });
  }
  return issues;
}

function classifyDebugIssues({ status, jobs, panes, watchers, git, roots, resultConsistency, launchPreflight, adapterProbes }) {
  const issues = [];
  if (!roots.ok) {
    issues.push({ severity: 'block', code: 'root-mismatch', detail: roots.note });
  }
  if (git.indexLock.exists) {
    issues.push({ severity: 'block', code: 'git-index-lock-present', detail: `.git/index.lock exists: ${git.indexLock.path}` });
  }
  if (git.stagedStat.stdout?.trim()) {
    issues.push({ severity: 'block', code: 'staged-work-present', detail: 'Git index contains staged work; new dispatch/commit boundaries are unsafe until resolved.' });
  }
  for (const mismatch of resultConsistency?.mismatches || []) {
    issues.push({ severity: mismatch.code === 'mixed-pass-needs-founder-results' ? 'warn' : 'block', code: mismatch.code, detail: mismatch.detail });
  }
  for (const [name, result] of Object.entries(launchPreflight || {})) {
    if (!result.ok) issues.push({ severity: 'warn', code: `preflight-${safeName(name)}-failed`, detail: `${name}: ${firstLine(result.stderr || result.error || result.stdout)}` });
  }
  if (adapterProbes?.gitWrite?.ok === false) {
    issues.push({ severity: 'block', code: 'adapter-git-write-probe-failed', detail: adapterProbes.gitWrite.error || 'git write probe failed' });
  }
  for (const job of jobs) {
    const resultStatus = job.resultJson?.status;
    if (resultStatus && !['PASS', 'BLOCK', 'CONDITIONAL_PASS', 'NEEDS_FOUNDER', 'FAILED'].includes(resultStatus)) {
      issues.push({ severity: 'block', code: 'invalid-result-status', detail: `${job.lane} result.json has invalid status ${resultStatus}` });
    }
    if (['BLOCK', 'FAILED', 'NEEDS_FOUNDER', 'CONDITIONAL_PASS'].includes(resultStatus)) {
      issues.push({ severity: resultStatus === 'BLOCK' || resultStatus === 'FAILED' ? 'block' : 'warn', code: `job-${resultStatus.toLowerCase()}`, detail: `${job.lane} result status is ${resultStatus}` });
    }
  }
  for (const [name, watcher] of Object.entries(watchers)) {
    if (/Permission denied|timed out|Error|exit 124/i.test(watcher.text)) {
      issues.push({ severity: 'warn', code: 'watcher-log-error', detail: `${name}: ${firstLine(watcher.text)}` });
    }
  }
  for (const pane of panes) {
    if (!pane.ok) issues.push({ severity: 'warn', code: 'pane-capture-failed', detail: `${pane.lane}: ${pane.stderr}` });
    if (/operation not permitted|permission denied|index\.lock|Unknown skill|read-only variable/i.test(pane.stdout || '')) {
      issues.push({ severity: 'warn', code: 'pane-error-signal', detail: `${pane.lane} pane contains an error signal.` });
    }
    if (hasInteractivePickerSignal(pane.stdout || '')) {
      issues.push({
        severity: 'block',
        code: 'pane-interactive-picker',
        detail: `${pane.lane} pane appears blocked on forbidden interactive question UI; recover with founder direction or relaunch with plain-chat decision handling.`
      });
    }
  }
  if (status?.status && ['blocked', 'needs_founder', 'failed', 'stale'].includes(status.status)) {
    issues.push({ severity: 'block', code: `run-${status.status}`, detail: status.reason || `run status is ${status.status}` });
  }
  return issues;
}

function hasInteractivePickerSignal(text) {
  if (!text) return false;
  const signalCount = INTERACTIVE_PICKER_SIGNAL_PATTERNS.filter((pattern) => pattern.test(text)).length;
  return signalCount >= 2 || (/Enter to select/i.test(text) && /[↑↓]|arrow-key|select/i.test(text));
}

function renderDebuggerPrompt(bundle) {
  const targetRun = bundle.targetRun || {};
  const boundRunDir = bundle.runDir || 'null';
  const targetRunId = targetRun.runId || 'none';
  const targetPriority = targetRun.priority || 'none';
  const targetRoute = targetRun.routeId || 'none';
  const targetStatus = targetRun.status || 'none';
  return [
    '# CoCoder Orchestrator Debugger',
    '',
    `debug_id: ${bundle.debug.debugId}`,
    `session_id: ${bundle.sessionId}`,
    `run_dir: ${bundle.runDir}`,
    `no_session: ${bundle.noSession ? 'true' : 'false'}`,
    `evidence_bundle: ${path.join(bundle.debug.debugDir, 'evidence-bundle.json')}`,
    `debug_report: ${bundle.debug.reportPath}`,
    `debug_result: ${bundle.debug.resultPath}`,
    `review_mode: ${bundle.mode}`,
    `follow_interval_seconds: ${bundle.followIntervalSeconds}`,
    'debugger_git_authority: enabled when `COCODER_ORCH_DEBUGGER_GIT_WRITE=true` is set in the debugger\'s environment; the generated debugger wrapper script reads that env var at exec time and upgrades Codex from `--sandbox workspace-write` to `--sandbox danger-full-access` for founder-approved orchestration fixes and commits',
    '',
    '## Target Run Binding',
    '',
    bundle.noSession
      ? `- This no-session debugger is bound to \`session_id: ${bundle.sessionId}\` and has no run-backed target. Do not switch into any run-backed session unless the founder explicitly relaunches the debugger for that run.`
      : `- This debugger is bound only to \`session_id: ${bundle.sessionId}\`, \`target_run_id: ${targetRunId}\`, and \`run_dir: ${boundRunDir}\`.`,
    `- Target priority: \`${targetPriority}\`; target route: \`${targetRoute}\`; target status: \`${targetStatus}\`.`,
    '- Do not switch target runs, attach to a newer/live run, or treat another visible session as the subject of this audit.',
    '- Other sessions may be inspected only as background concurrency evidence under `concurrency.otherSessions`.',
    `- Every follow-cycle note appended to \`debug_report\` must begin with \`Target: ${bundle.sessionId}\`.`,
    '',
    '## Role',
    '',
    'You are the CoCoder Orchestrator Debugger running in Codex.',
    'Your job is to audit an orchestration run, diagnose what happened, offer the concrete fix path for every confirmed orchestration issue, and then ask the founder in plain English before applying any fix.',
    '',
    '## Hard Boundaries',
    '',
    '- Read any repo file needed to diagnose orchestration.',
    '- You may write debugger artifacts under `cocoder/debug-runs/**`.',
    '- Do not edit source/config/test files until after you present findings and the founder explicitly says to fix them.',
    '- If the founder says yes, edit only `cocoder/**`.',
    '- Do not edit product code, DOCS-REBUILD target docs, legacy reference orchestrators, legacy persona files, active run result files, or `.git` state unless the founder explicitly overrides this boundary.',
    '- Do not commit another priority\'s staged work. If staged work exists, treat it as a blocker and recommend a recovery path.',
    '- Never coordinate with unrelated sessions. Inspect their artifacts only when they belong to the requested run.',
    '',
    '## Debugger Git Authority',
    '',
    '- The debugger wrapper script generated by `cocoder prepare-debug` reads `COCODER_ORCH_DEBUGGER_GIT_WRITE` from its environment at exec time. When that env var is `true`, the wrapper invokes Codex with `--sandbox danger-full-access` so founder-approved orchestration fixes and commits can land.',
    '- The wrapper defaults to `--sandbox workspace-write`. Set `COCODER_ORCH_DEBUGGER_GIT_WRITE=true` in the founder shell before exec\'ing the wrapper when git authority is intended; otherwise the debugger runs read/write inside the workspace but cannot mutate git state.',
    '- Even in git-authority mode, commit only after the founder explicitly approves the fix and the commit.',
    '- Before committing, run `git status --short`; if unrelated staged files exist, stop and report the blocker.',
    '- Stage exact paths only. Never use `git add .`, `git add -A`, wildcard staging, or interactive staging.',
    '- Commit only files you edited for the founder-approved debugger fix plus debugger artifacts under `cocoder/debug-runs/**` when needed.',
    '- Never stage or commit product/session work, active run result files, unrelated priority files, or another lane\'s dirty files unless the founder explicitly names those exact paths.',
    '- Run `git diff --check` and the relevant focused tests before committing; include both command results in the final report.',
    '',
    '## Required Flow',
    '',
    '1. Read `evidence_bundle` first.',
    '2. Reconstruct the timeline from launch artifacts, panes, job results, watcher logs, and git state.',
    '3. Classify each issue as launch/config, adapter sandbox, prompt/behavior, boundary, result contract, watcher/result handoff, unsafe repo state, concurrency, preflight, or founder-action-needed.',
    '4. Separate confirmed evidence from inference.',
    '5. Present a concise recommendation list: Must fix, Should fix, Monitor only.',
    '6. For every Must fix or Should fix, state the exact source/test/operational repair you would make; if no fix is warranted, say why.',
    '7. Say plainly whether each fix is worth doing now.',
    '8. Ask the founder: "Do you want me to apply the recommended orchestration fixes?"',
    '9. Only after explicit yes, patch orchestration files, add/update tests, run the relevant tests, and write `debug_report` plus `debug_result`.',
    '',
    '## No-Session Mode',
    '',
    'If `no_session` is `true`, this debugger was launched without a run-backed session because orchestration may be failing before run artifacts exist.',
    '- Diagnose launch/config failures from repository state, launcher scripts, profile/route/boundary validation, adapter declarations, command availability, tmux state, and git safety.',
    '- Use `launchPreflight`, `adapterProbes`, and `concurrency` from the evidence bundle as first-class evidence.',
    '- Do not require pane captures or result files in this mode; their absence is expected.',
    '- Recommend the exact launch/preflight/source fix needed to create a usable run-backed session.',
    '',
    '## Follow Mode',
    '',
    'If `review_mode` is `follow`, this is a live monitoring session, not just a postmortem.',
    '- Start with the same initial audit and root/index safety checks.',
    '- Then watch the run in cycles until the founder stops you, the run reaches a terminal state, or a hard blocker appears.',
    bundle.debug.followCollector?.enabled
      ? `- A launcher-side follow collector is enabled. Prefer its latest refreshed bundle at \`${bundle.debug.followCollector.latestPath}\` for each cycle; it is collected before Codex sandbox restrictions apply. If it is stale or missing, fall back to local artifact reads and record the collector failure.`
      : '- Each cycle should refresh pane captures, result files, watcher logs, and git status using local commands; do not rely only on the initial evidence bundle.',
    `- Before using each refreshed bundle, verify \`latest.targetRun.sessionId\` or \`latest.sessionId\` still equals \`${bundle.sessionId}\`; if it does not, classify that bundle as stale/wrong-target and fall back to local reads for the bound run directory.`,
    `- Append concise timestamped observations to \`debug_report\` after each meaningful change. Every appended follow observation must start with \`Target: ${bundle.sessionId}\`.`,
    '- Flag process issues early: invalid statuses, stalled result files, missing watcher notifications, prompt loops, boundary drift, staged-work contamination risk, adapter permission failures, or lead/writer role violations.',
    '- Treat visible pane composer text as ambiguous unless it is confirmed by post-dispatch behavior. The run-local `send-message` helper clears the target input line with `tmux send-keys C-u` before pasting and submitting a dispatch, so stale or visible composer-like text alone is not a hard dispatch-contamination blocker.',
    '- For Oscar-bootstrap routes, an initial run with only the Oscar lane is expected when `launch.route.initialLanes` contains only Oscar. Do not classify missing Phil/Bob/Talia/Quinn panes as broken until Oscar has requested them through a validated `add-lanes` topology decision.',
    '- If `run.topologyDecision` or `topology-decision.json` exists, treat it as first-class evidence for the requested lane group, selected topology option, validation checks, blocked issues, and whether added lane artifacts should exist.',
    '- If Oscar requested lanes through `add-lanes`, verify the requested lanes appear in `launch.sessions`, have prompt/helper/watcher/result paths, and are included in result finalization expectations. If no topology decision exists yet, evaluate Oscar\'s bootstrap reasoning and startup warnings, not missing counterpart panes.',
    '- If a debugger tmux send/intervention attempt fails, classify the debugger as observe-only for that action and ask for founder/manual intervention when needed. Do not report the active run as broken solely because the debugger sandbox cannot send keys.',
    '- Do not interrupt the active run unless there is an immediate safety issue. If you need to intervene, state the exact concern and ask the founder first unless the requested run is about to contaminate the repo state.',
    '- Follow mode still cannot edit source/config/test files without explicit founder approval after recommendations are presented.',
    '',
    '## Initial Signals From Evidence Collection',
    '',
    `root_check: ${bundle.rootCheck.ok ? 'ok' : 'MISMATCH'}`,
    `issue_count: ${bundle.issues.length}`,
    ...bundle.issues.map((issue) => `- ${issue.severity.toUpperCase()} ${issue.code}: ${issue.detail}`),
    '',
    '## Recommendation Pack',
    '',
    'When presenting findings, include:',
    '- Immediate operational action, if any.',
    '- Source fix candidate, if any.',
    '- Priority/plan item candidate, if the fix belongs in a broader workstream.',
    '- Whether each item is worth doing now.',
    '',
    '## Result Shape',
    '',
    'When you finish the audit or a founder-approved fix, write `debug_result` as JSON:',
    '',
    '```json',
    '{',
    '  "status": "PASS | BLOCK | CONDITIONAL_PASS | NEEDS_FOUNDER | FAILED",',
    '  "persona": "orchestrator-debugger",',
    '  "adapter": "codex",',
    `  "targetSessionId": "${bundle.sessionId}",`,
    `  "targetRunDir": ${bundle.runDir ? JSON.stringify(bundle.runDir) : 'null'},`,
    `  "targetPriority": "${targetPriority}",`,
    `  "targetRoute": "${targetRoute}",`,
    '  "filesChanged": ["<path or none>"],',
    '  "summary": "<one paragraph>",',
    '  "findings": ["<finding or none>"],',
    '  "recommendations": ["<recommendation or none>"],',
    '  "evidence": ["<artifact, command, pane, result file, or diff>"],',
    '  "nextAction": "<specific next action or none>"',
    '}',
    '```',
    ''
  ].join('\n');
}

function renderDebuggerWrapper(repoRoot, bundle) {
  const promptPath = bundle.debug.promptPath;
  const bootstrap = `Read and follow this CoCoder Orchestrator Debugger prompt exactly: ${promptPath}. Load that file before acting; do not rely on this bootstrap line as the full instruction set.`;
  const collector = bundle.debug.followCollector;
  const collectorLines = collector?.enabled
    ? [
      'if [ "${COCODER_ORCH_DEBUGGER_FOLLOW_COLLECTOR:-true}" = "true" ]; then',
      `  mkdir -p ${shellQuote(path.dirname(collector.logPath))}`,
      '  if [ ! -s ' + shellQuote(collector.pidPath) + ' ] || ! kill -0 "$(cat ' + shellQuote(collector.pidPath) + ')" 2>/dev/null; then',
      `    nohup ${shellQuote(process.execPath)} ${shellQuote(CORE_CLI_PATH)} watch-debugger-evidence --run-dir ${shellQuote(bundle.runDir)} --session-id ${shellQuote(bundle.sessionId)} --debug-dir ${shellQuote(bundle.debug.debugDir)} --follow-interval-seconds ${shellQuote(String(bundle.followIntervalSeconds))} --tmux-bin ${shellQuote(bundle.run?.launch?.tmuxBin || DEFAULT_TMUX_BIN)} > ${shellQuote(collector.logPath)} 2>&1 &`,
      `    echo $! > ${shellQuote(collector.pidPath)}`,
      '  fi',
      'fi'
    ]
    : [];
  return [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    `cd ${shellQuote(repoRoot)}`,
    ...collectorLines,
    'CODEX_SANDBOX="workspace-write"',
    'if [ "${COCODER_ORCH_DEBUGGER_GIT_WRITE:-false}" = "true" ]; then',
    '  CODEX_SANDBOX="danger-full-access"',
    'fi',
    `exec codex --ask-for-approval never --sandbox "$CODEX_SANDBOX" ${shellQuote(bootstrap)}`,
    ''
  ].join('\n');
}

function isTerminalRunStatus(status) {
  if (!status) return false;
  if (status.terminal === true) return true;
  return ['complete', 'blocked', 'failed', 'aborted', 'stale'].includes(status.status);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function compactTimestamp(iso) {
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

async function collectTextFiles(dir, maxChars) {
  if (!(await pathExists(dir))) return {};
  const entries = await readdir(dir, { withFileTypes: true });
  const files = {};
  for (const entry of entries.filter((candidate) => candidate.isFile())) {
    const filePath = path.join(dir, entry.name);
    files[entry.name] = { path: filePath, text: await readTextIfExists(filePath, maxChars) };
  }
  return files;
}

async function listFiles(dir) {
  if (!(await pathExists(dir))) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.map((entry) => entry.name).sort();
}

async function readJsonIfExists(filePath) {
  if (!(await pathExists(filePath))) return null;
  try {
    return readJson(filePath);
  } catch (error) {
    return { __invalidJson: true, path: filePath, error: error.message };
  }
}

async function readTextIfExists(filePath, maxChars) {
  if (!(await pathExists(filePath))) return '';
  const raw = await readFile(filePath, 'utf8');
  return truncate(raw, maxChars);
}

async function fileState(filePath) {
  try {
    const info = await stat(filePath);
    return { path: filePath, exists: true, size: info.size, mtime: info.mtime.toISOString() };
  } catch (error) {
    if (error.code === 'ENOENT') return { path: filePath, exists: false };
    return { path: filePath, exists: false, error: error.message };
  }
}

async function runGit(repoRoot, args) {
  return runCommand('git', args, { cwd: repoRoot, maxBuffer: 1024 * 1024 });
}

async function runCommand(command, args, options = {}) {
  try {
    const result = await execFileAsync(command, args, { cwd: options.cwd, maxBuffer: options.maxBuffer || 256 * 1024 });
    return { ok: true, command: [command, ...args].join(' '), stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      ok: false,
      command: [command, ...args].join(' '),
      stdout: error.stdout || '',
      stderr: error.stderr || '',
      error: error.message
    };
  }
}

function inferRepoRootFromRunDir(runDir) {
  const marker = `${path.sep}cocoder${path.sep}orchestration${path.sep}runs${path.sep}`;
  const index = runDir.indexOf(marker);
  return index >= 0 ? runDir.slice(0, index) : undefined;
}

function normalizePath(value) {
  return path.resolve(unescapeDisplayedPath(String(value).trim())).replace(/\/$/, '');
}

function cleanPanePath(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (/[…│]/.test(text)) return null;
  const withoutAnsi = text.replace(/\u001b\[[0-9;]*m/g, '').trim();
  const unescaped = unescapeDisplayedPath(withoutAnsi);
  const match = unescaped.match(/^(.+?\/infrastructure)(?:\s.*)?$/);
  return match ? match[1] : null;
}

function unescapeDisplayedPath(value) {
  return String(value || '').replace(/\\([ \t])/g, '$1');
}

function safeName(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, '-');
}

function shellWord(value) {
  const text = String(value);
  if (!/^[a-zA-Z0-9._/-]+$/.test(text)) throw new Error(`Unsafe shell word: ${text}`);
  return text;
}

function parseMarkdownStatus(resultMarkdown) {
  const text = String(resultMarkdown || '');
  const statusLine = text.match(/^\s*(?:[-*]\s*)?(?:\*\*)?Status\s*:\s*(?:\*\*)?\s*`?([A-Z_]+)`?\s*$/im);
  if (statusLine) return statusLine[1];
  const heading = text.match(/^\s*#{1,3}\s*`?(PASS|BLOCK|CONDITIONAL_PASS|NEEDS_FOUNDER|FAILED)`?\s*$/im);
  return heading ? heading[1] : null;
}

function truncate(value, maxChars) {
  const text = String(value || '');
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n...[truncated ${text.length - maxChars} chars]`;
}

function firstLine(value) {
  return String(value || '').split(/\r?\n/).find(Boolean) || '';
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}
