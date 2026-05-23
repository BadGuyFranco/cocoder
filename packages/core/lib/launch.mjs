import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { loadAdapterDeclarations, preflightAdapterRegistry } from './adapters.mjs';
import { checkRouteProfileCompatibility, composeCompatibility, composePersonaPrompt } from './composition.mjs';
import { readJson, writeJson } from './fs-utils.mjs';
import { appendEvent, createRun, setRunStatus } from './ledger.mjs';
import { resolveModelRoles, summarizeModelRoles } from './model-roles.mjs';
import { evaluateLaneGitPolicy, getOrchestratorCommitPolicy } from './orchestrator-commit.mjs';
import { resolvePriorityBoundary } from './priority-boundaries.mjs';
import { auditAddLaneOrchestrationState } from './repo-state.mjs';
import { isTerminalRunStatusRecord } from './run-status.mjs';

const execFileAsync = promisify(execFile);
const CORE_CLI_PATH = fileURLToPath(new URL('../cli.mjs', import.meta.url));
const DEFAULT_SOCKET = 'cocoder-orchestration';

// M4.26 / pending-decisions Q5=A — verification-artifact write guard.
// The inline string in this module is the canonical SSOT for v0.1; prompt-fragment
// SSOT is an explicit v0.2 option per pending-decisions.md. Tests exercise this
// constant via composeRuntimeRoleLines() instead of source-grepping the file.
export const VERIFICATION_ARTIFACT_GUARD_LINE = '- Do not mutate ignored dependency, build, or cache artifacts such as `node_modules/`, `dist/`, `.turbo/`, or generated package-manager link directories as a verification workaround unless the dispatch explicitly grants that operational scope. Verification must be reproducible from tracked manifests, lockfiles, and declared commands.';
const DEFAULT_TMUX_BIN = process.env.TMUX_BIN || '/opt/homebrew/bin/tmux';
const DEFAULT_SESSION_WIDTH = 120;
const DEFAULT_SESSION_HEIGHT = 40;
const DEFAULT_ADDED_SPLIT_PANE_WIDTH = 120;
const LEGACY_SKILL_BOOTSTRAP_GUARD = 'Do not invoke Skill(...) commands or slash skills during orchestration launch unless the loaded launch prompt explicitly instructs you to do so.';

export async function launchRun(options) {
  const execute = options.execute === true || options.execute === 'true';
  const socketName = options.socketName || DEFAULT_SOCKET;
  const socketPath = options.socketPath || '';
  const tmuxBin = options.tmuxBin || DEFAULT_TMUX_BIN;
  const cwd = options.cwd || process.cwd();
  const transport = options.transport || realTmuxTransport(tmuxBin);

  const compatibility = await checkRouteProfileCompatibility({
    profilePath: options.profilePath,
    routePath: options.routePath,
    adaptersDir: options.adaptersDir,
    contractsDir: options.contractsDir,
    env: options.env,
    pathValue: options.pathValue
  });
  const priorityIssue = routePriorityIssue(compatibility.route, options.prioritySlug);
  const launchLanes = selectInitialLaunchLanes(compatibility.route, compatibility.lanes);
  const priorityBoundary = await resolvePriorityBoundary({
    boundariesDir: options.priorityBoundariesDir,
    prioritySlug: options.prioritySlug,
    route: compatibility.route,
    lanes: launchLanes
  });
  const priorityBoundaryIssues = blockingPriorityBoundaryIssues(priorityBoundary);
  const gitCapabilityPreflight = await evaluateLaunchGitCapabilityPreflight({
    route: compatibility.route,
    lanes: launchLanes,
    repoRoot: cwd,
    probeGitCommitCapability: options.probeGitCommitCapability
  });
  const issues = [
    ...compatibility.issues,
    ...(priorityIssue ? [priorityIssue] : []),
    ...priorityBoundaryIssues,
    ...gitCapabilityPreflight.issues
  ];
  if (!compatibility.ok || priorityIssue || priorityBoundaryIssues.length > 0 || !gitCapabilityPreflight.ok) {
    return {
      ok: false,
      status: gitCapabilityPreflight.ok ? 'non-ready' : 'blocked',
      executed: false,
      profile: compatibility.profile.id,
      route: compatibility.route.id,
      lanes: launchLanes,
      priorityBoundary: priorityBoundary.ok ? priorityBoundary.priorityBoundary.id : null,
      gitCapabilityPreflight,
      issues
    };
  }

  // Active-priority-run preflight (audit §4 E2.2e.5 dogfood port surfaced
  // the gap): launch blocks a second non-terminal run for the same priority
  // + route unless the caller passes --allow-concurrent-priority-run true.
  // Ported from CoBuilder per ADR-0004.
  const activeRunPreflight = options.allowConcurrentPriorityRun === true || options.allowConcurrentPriorityRun === 'true'
    ? { ok: true, status: 'skipped', activeRuns: [], issues: [], override: true }
    : await findActiveRunsForPriority({
        runsDir: options.runsDir,
        prioritySlug: options.prioritySlug,
        routeId: compatibility.route.id,
        excludeRunId: options.runId
      });
  if (!activeRunPreflight.ok) {
    return {
      ok: false,
      status: 'blocked',
      executed: false,
      profile: compatibility.profile.id,
      route: compatibility.route.id,
      lanes: launchLanes,
      priorityBoundary: priorityBoundary.ok ? priorityBoundary.priorityBoundary.id : null,
      gitCapabilityPreflight,
      activeRunPreflight,
      issues: activeRunPreflight.issues
    };
  }

  const created = await createRun({
    contractsDir: options.contractsDir,
    runsDir: options.runsDir,
    runId: options.runId,
    profilePath: options.profilePath,
    routePath: options.routePath,
    priorityFile: options.priorityFile,
    prioritySlug: options.prioritySlug,
    priorityBoundariesDir: options.priorityBoundariesDir,
    resolvedPriorityBoundary: priorityBoundary,
    sessionLogFile: options.sessionLogFile,
    sessionLineLimit: options.sessionLineLimit,
    creationContext: {
      command: 'launch',
      execute,
      deferStart: options.deferStart === true || options.deferStart === 'true',
      socketName,
      socketPath,
      tmuxBin
    }
  });
  const runDir = created.runDir;
  const startupPacket = await readJson(path.join(runDir, 'startup-packet.json'));
  if (created.status !== 'ready') {
    return {
      ok: false,
      status: created.status,
      executed: false,
      runId: created.runId,
      runDir,
      issues: [{ code: 'priority-not-ready', severity: 'block', detail: startupPacket.gaps.join('; ') || 'selected priority is not active' }]
    };
  }

  const adapterCommands = await resolveAdapterCommands({
    adaptersDir: options.adaptersDir,
    contractsDir: options.contractsDir
  });
  const launchPlan = buildLaunchPlan({
    runId: created.runId,
    runDir,
    cwd,
    socketName,
    socketPath,
    tmuxBin,
    deferStart: options.deferStart === true || options.deferStart === 'true',
    route: compatibility.route,
    profile: compatibility.profile,
    sourcePaths: {
      profilePath: options.profilePath,
      routePath: options.routePath
    },
    lanes: launchLanes,
    startupPacket,
    adapterCommands
  });
  await writeLaunchArtifacts(launchPlan);

  if (!execute) {
    return {
      ok: true,
      status: 'ready',
      executed: false,
      runId: created.runId,
      runDir,
      launchPlanPath: path.join(runDir, 'launch.json'),
      sessions: launchPlan.sessions.map(publicSession),
      priorityBoundary: priorityBoundary.ok ? priorityBoundary.priorityBoundary.id : null,
      gitCapabilityPreflight,
      activeRunPreflight,
      helperScripts: launchPlan.helperScripts,
      completionWatchScripts: launchPlan.completionWatchScripts,
      startWatchersScript: launchPlan.startWatchersScript,
      startAllScript: launchPlan.startAllScript,
      attachCommands: launchPlan.attachCommands,
      warnings: startupPacket.warnings || [],
      issues: []
    };
  }

  try {
    await transport.run([...tmuxSocketArgs({ socketName, socketPath }), '-V']);
  } catch (error) {
    const detail = error.message || String(error);
    await setRunStatus(runDir, 'blocked', `tmux preflight failed: ${detail}`);
    return {
      ok: false,
      status: 'blocked',
      executed: false,
      runId: created.runId,
      runDir,
      launchPlanPath: path.join(runDir, 'launch.json'),
      sessions: launchPlan.sessions.map(publicSession),
      priorityBoundary: priorityBoundary.ok ? priorityBoundary.priorityBoundary.id : null,
      gitCapabilityPreflight,
      helperScripts: launchPlan.helperScripts,
      completionWatchScripts: launchPlan.completionWatchScripts,
      startWatchersScript: launchPlan.startWatchersScript,
      startAllScript: launchPlan.startAllScript,
      attachCommands: launchPlan.attachCommands,
      issues: [{ code: 'tmux-preflight-failed', severity: 'block', detail }]
    };
  }
  try {
    for (const session of launchPlan.sessions) {
      await transport.run([
        ...tmuxSocketArgs({ socketName, socketPath }),
        'new-session',
        '-d',
        '-s',
        session.sessionName,
        '-x',
        String(session.width),
        '-y',
        String(session.height),
        '-c',
        cwd,
        shellQuote(session.entryPath)
      ]);
      await transport.run([...tmuxSocketArgs({ socketName, socketPath }), 'rename-window', '-t', `${session.sessionName}:0`, session.displayLabel]);
      await transport.run([...tmuxSocketArgs({ socketName, socketPath }), 'set-option', '-t', session.sessionName, 'allow-rename', 'off']);
      await transport.run([...tmuxSocketArgs({ socketName, socketPath }), 'set-option', '-t', session.sessionName, 'set-titles', 'on']);
      await transport.run([...tmuxSocketArgs({ socketName, socketPath }), 'set-option', '-t', session.sessionName, 'set-titles-string', session.displayLabel]);
    }
  } catch (error) {
    const detail = error.message || String(error);
    await setRunStatus(runDir, 'blocked', `tmux session startup failed: ${detail}`);
    return {
      ok: false,
      status: 'blocked',
      executed: false,
      runId: created.runId,
      runDir,
      launchPlanPath: path.join(runDir, 'launch.json'),
      sessions: launchPlan.sessions.map(publicSession),
      priorityBoundary: priorityBoundary.ok ? priorityBoundary.priorityBoundary.id : null,
      gitCapabilityPreflight,
      helperScripts: launchPlan.helperScripts,
      completionWatchScripts: launchPlan.completionWatchScripts,
      startWatchersScript: launchPlan.startWatchersScript,
      startAllScript: launchPlan.startAllScript,
      attachCommands: launchPlan.attachCommands,
      issues: [{ code: 'tmux-session-startup-failed', severity: 'block', detail }]
    };
  }

  const running = await setRunStatus(runDir, 'running', `launched tmux sessions on ${tmuxSocketLabel({ socketName, socketPath })}`);
  await writeJson(path.join(runDir, 'launch-evidence.json'), {
    id: 'live-launch-started',
    class: 'B',
    source: 'local-dev',
    artifact: 'launch.json',
    command: `tmux ${tmuxSocketArgs({ socketName, socketPath }).join(' ')} new-session ...`,
    observed: `Started ${launchPlan.sessions.length} tmux session(s) for route ${compatibility.route.id}.`,
    limitations: [
      'Class B local launch evidence; not a user-facing product claim.',
      'CLI authentication and model behavior must be verified from resulting transcripts/result files.'
    ],
    createdAt: new Date().toISOString()
  });

  return {
    ok: true,
    status: running.status,
    executed: true,
    runId: created.runId,
    runDir,
    launchPlanPath: path.join(runDir, 'launch.json'),
    sessions: launchPlan.sessions.map(publicSession),
    priorityBoundary: priorityBoundary.ok ? priorityBoundary.priorityBoundary.id : null,
    gitCapabilityPreflight,
    helperScripts: launchPlan.helperScripts,
    completionWatchScripts: launchPlan.completionWatchScripts,
    startWatchersScript: launchPlan.startWatchersScript,
    startAllScript: launchPlan.startAllScript,
    attachCommands: launchPlan.attachCommands,
    warnings: startupPacket.warnings || [],
    issues: []
  };
}

export async function addLanesToRun({
  runDir,
  lanes,
  topologyOptionId,
  reason = '',
  requiredPersonas = [],
  execute = false,
  transport,
  tmuxBin = DEFAULT_TMUX_BIN,
  adaptersDir,
  contractsDir,
  env,
  pathValue,
  priorityBoundariesDir,
  repoRoot = process.cwd(),
  repoStateAudit = auditAddLaneOrchestrationState,
  autoAttachAddedLanes = false,
  visibleAttachRunner = runVisibleAttachScript,
  startWatchersRunner = runStartWatchersScript
} = {}) {
  if (!runDir) throw new Error('runDir is required');
  const requestedLanes = unique((Array.isArray(lanes) ? lanes : String(lanes || '').split(',')).map((lane) => lane.trim()).filter(Boolean));
  if (requestedLanes.length === 0) throw new Error('at least one lane is required');

  const status = await readJson(path.join(runDir, 'status.json'));
  if (isTerminalRunStatusRecord(status)) throw new Error(`add-lanes blocked because run is terminal: ${status.status}`);

  const launchPlan = await readJson(path.join(runDir, 'launch.json'));
  const route = await readJson(path.join(runDir, 'route.snapshot.json'));
  const profile = await readJson(path.join(runDir, 'profile.snapshot.json'));
  const startupPacket = await readJson(path.join(runDir, 'startup-packet.json'));
  const existing = new Set((launchPlan.sessions || []).map((session) => session.lane));
  const issues = [];

  for (const lane of requestedLanes) {
    if (existing.has(lane)) issues.push(issue('lane-already-launched', lane, `lane ${lane} is already launched in this run`));
    if (!route.lanes?.includes(lane)) issues.push(issue('lane-not-in-route-policy', lane, `lane ${lane} is not declared by route ${route.id}`));
  }

  const option = validateTopologyOption({ route, topologyOptionId, requestedLanes, existingLanes: existing, issues });
  const loaded = await loadAdapterDeclarations({ adaptersDir, contractsDir });
  const preflight = await preflightAdapterRegistry({ adaptersDir, contractsDir, env, pathValue });
  const compatibility = composeCompatibility({ profile, route, loaded, preflight });
  const requestedLaneRecords = compatibility.lanes.filter((lane) => requestedLanes.includes(lane.lane));
  for (const lane of requestedLanes) {
    const laneRecord = requestedLaneRecords.find((candidate) => candidate.lane === lane);
    if (!laneRecord) issues.push(issue('lane-profile-resolution-failed', lane, `lane ${lane} did not resolve from profile and route`));
  }
  for (const laneIssue of compatibility.issues.filter((candidate) => requestedLanes.includes(candidate.lane))) {
    issues.push(laneIssue);
  }

  const boundary = priorityBoundariesDir
    ? await resolvePriorityBoundary({
        boundariesDir: priorityBoundariesDir,
        prioritySlug: startupPacket.selectedPriority?.slug || status.prioritySlug,
        route,
        lanes: requestedLaneRecords
      })
    : validateStartupBoundaryForAddedLanes({ startupPacket, route, lanes: requestedLaneRecords });
  if (!boundary.ok) issues.push(...blockingPriorityBoundaryIssues(boundary));

  const gitCapabilityPreflight = await evaluateLaunchGitCapabilityPreflight({
    route,
    lanes: requestedLaneRecords,
    repoRoot
  });
  if (!gitCapabilityPreflight.ok) issues.push(...gitCapabilityPreflight.issues);

  const repoState = await repoStateAudit({ repoRoot });
  if (!repoState.ok) issues.push(...repoState.issues);
  const repoStateWarnings = Array.isArray(repoState.warnings) ? repoState.warnings : [];

  const decision = {
    version: 1,
    status: issues.length === 0 ? 'accepted' : 'blocked',
    runId: launchPlan.runId,
    routeId: route.id,
    topologyOptionId: option?.id || topologyOptionId || null,
    requestedLanes,
    requiredPersonas,
    reason,
    existingLanes: [...existing],
    checks: {
      routePolicy: issues.some((candidate) => ['lane-not-in-route-policy', 'topology-option-missing', 'topology-option-lane-not-allowed'].includes(candidate.code)) ? 'blocked' : 'pass',
      profileAndAdapter: compatibility.issues.some((candidate) => requestedLanes.includes(candidate.lane)) ? 'blocked' : 'pass',
      priorityBoundary: boundary.ok ? 'pass' : 'blocked',
      gitCapability: gitCapabilityPreflight.ok ? 'pass' : 'blocked',
      gitState: repoState.ok ? (repoStateWarnings.length > 0 ? 'warn' : 'pass') : 'blocked',
      laneArtifacts: issues.length === 0 ? 'pending-write' : 'not-written'
    },
    issues,
    warnings: repoStateWarnings,
    createdAt: new Date().toISOString()
  };
  await writeJson(path.join(runDir, 'topology-decision.json'), decision);

  if (issues.length > 0) {
    await appendEvent(runDir, { type: 'topology.decision.blocked', topologyOptionId: decision.topologyOptionId, requestedLanes, issues });
    return {
      ok: false,
      status: 'blocked',
      executed: false,
      runId: launchPlan.runId,
      runDir,
      topologyDecisionPath: path.join(runDir, 'topology-decision.json'),
      decision,
      issues
    };
  }

  const adapterCommands = await resolveAdapterCommands({ adaptersDir, contractsDir });
  const nextLaunchPlan = buildLaunchPlan({
    runId: launchPlan.runId,
    runDir,
    cwd: launchPlan.cwd,
    socketName: launchPlan.socketName,
    socketPath: launchPlan.socketPath,
    tmuxBin: launchPlan.tmuxBin || tmuxBin,
    deferStart: launchPlan.deferStart,
    route,
    profile,
    lanes: [...(launchPlan.sessions || []).map((session) => compatibility.lanes.find((lane) => lane.lane === session.lane)).filter(Boolean), ...requestedLaneRecords],
    startupPacket,
    adapterCommands
  });
  await writeLaunchArtifacts(nextLaunchPlan);
  const addedSessions = nextLaunchPlan.sessions
    .filter((session) => requestedLanes.includes(session.lane))
    .map((session) => ({ ...session, attachCommand: nextLaunchPlan.attachCommands?.[session.lane] || '' }));
  const attachAddedLanesScript = path.join(runDir, 'attach-added-lanes.sh');
  const leadSession = nextLaunchPlan.sessions.find((session) => session.lane === nextLaunchPlan.route.lead);
  await writeFile(attachAddedLanesScript, renderAttachAddedLanesScript(addedSessions, {
    tmuxBin: nextLaunchPlan.tmuxBin || tmuxBin,
    socketName: nextLaunchPlan.socketName,
    socketPath: nextLaunchPlan.socketPath,
    targetSession: leadSession
  }), { mode: 0o755 });
  decision.checks.laneArtifacts = 'written';
  decision.attachAddedLanesScript = attachAddedLanesScript;
  await writeJson(path.join(runDir, 'topology-decision.json'), decision);
  await appendEvent(runDir, { type: 'topology.lanes.added', topologyOptionId: decision.topologyOptionId, requestedLanes });
  if (repoStateWarnings.length > 0) {
    await appendEvent(runDir, { type: 'topology.decision.warning', topologyOptionId: decision.topologyOptionId, requestedLanes, warnings: repoStateWarnings });
  }

  if (!execute) {
    return {
      ok: true,
      status: status.status,
      executed: false,
      runId: launchPlan.runId,
      runDir,
      topologyDecisionPath: path.join(runDir, 'topology-decision.json'),
      sessions: nextLaunchPlan.sessions.map(publicSession),
      helperScripts: nextLaunchPlan.helperScripts,
      completionWatchScripts: nextLaunchPlan.completionWatchScripts,
      attachCommands: nextLaunchPlan.attachCommands,
      attachAddedLanesScript,
      decision,
      issues: []
    };
  }

  const tmux = transport || realTmuxTransport(nextLaunchPlan.tmuxBin || tmuxBin);
  for (const session of addedSessions) {
    await tmux.run([
      ...tmuxSocketArgs({ socketName: nextLaunchPlan.socketName, socketPath: nextLaunchPlan.socketPath }),
      'new-session',
      '-d',
      '-s',
      session.sessionName,
      '-x',
      String(session.width),
      '-y',
      String(session.height),
      '-c',
      nextLaunchPlan.cwd,
      shellQuote(session.entryPath)
    ]);
    await tmux.run([...tmuxSocketArgs({ socketName: nextLaunchPlan.socketName, socketPath: nextLaunchPlan.socketPath }), 'rename-window', '-t', `${session.sessionName}:0`, session.displayLabel]);
    await tmux.run([...tmuxSocketArgs({ socketName: nextLaunchPlan.socketName, socketPath: nextLaunchPlan.socketPath }), 'set-option', '-t', session.sessionName, 'allow-rename', 'off']);
    await tmux.run([...tmuxSocketArgs({ socketName: nextLaunchPlan.socketName, socketPath: nextLaunchPlan.socketPath }), 'set-option', '-t', session.sessionName, 'set-titles', 'on']);
    await tmux.run([...tmuxSocketArgs({ socketName: nextLaunchPlan.socketName, socketPath: nextLaunchPlan.socketPath }), 'set-option', '-t', session.sessionName, 'set-titles-string', session.displayLabel]);
  }
  let visibleAttach = {
    ok: false,
    status: nextLaunchPlan.deferStart ? 'not-run' : 'not-required',
    attachAddedLanesScript
  };
  if (nextLaunchPlan.deferStart && autoAttachAddedLanes) {
    visibleAttach = await visibleAttachRunner({ scriptPath: attachAddedLanesScript, sessions: addedSessions });
  }
  const laneReadiness = await assessLaneReadiness({
    launchPlan: nextLaunchPlan,
    lanes: requestedLanes
  });
  decision.checks.laneReadiness = laneReadiness.every((item) => item.status === 'ready') ? 'ready' : 'waiting_for_visible_attach';
  decision.checks.visibleAttach = visibleAttach.status;
  decision.laneReadiness = laneReadiness;
  decision.visibleAttach = visibleAttach;
  let watcherStart = {
    ok: false,
    status: 'not-run',
    startWatchersScript: nextLaunchPlan.startWatchersScript
  };
  if (decision.checks.laneReadiness === 'ready') {
    watcherStart = await startWatchersRunner({ scriptPath: nextLaunchPlan.startWatchersScript, lanes: requestedLanes });
  }
  decision.checks.watchers = watcherStart.status;
  decision.watcherStart = watcherStart;
  await writeJson(path.join(runDir, 'topology-decision.json'), decision);

  if (decision.checks.laneReadiness === 'ready' && !watcherStart.ok) {
    const watcherIssue = issue('watchers-start-failed', 'start-watchers', `added lane completion watchers did not start: ${watcherStart.error || watcherStart.status}`);
    await appendEvent(runDir, { type: 'topology.watchers.start_failed', topologyOptionId: decision.topologyOptionId, requestedLanes, issue: watcherIssue });
    return {
      ok: false,
      status: 'watchers_start_failed',
      executed: true,
      runId: launchPlan.runId,
      runDir,
      topologyDecisionPath: path.join(runDir, 'topology-decision.json'),
      sessions: nextLaunchPlan.sessions.map(publicSession),
      helperScripts: nextLaunchPlan.helperScripts,
      completionWatchScripts: nextLaunchPlan.completionWatchScripts,
      startWatchersScript: nextLaunchPlan.startWatchersScript,
      attachCommands: nextLaunchPlan.attachCommands,
      attachAddedLanesScript,
      visibleAttach,
      laneReadiness,
      watcherStart,
      decision,
      issues: [watcherIssue]
    };
  }

  return {
    ok: true,
    status: decision.checks.laneReadiness === 'ready' ? status.status : 'waiting_for_visible_attach',
    executed: true,
    runId: launchPlan.runId,
    runDir,
    topologyDecisionPath: path.join(runDir, 'topology-decision.json'),
    sessions: nextLaunchPlan.sessions.map(publicSession),
    helperScripts: nextLaunchPlan.helperScripts,
    completionWatchScripts: nextLaunchPlan.completionWatchScripts,
    startWatchersScript: nextLaunchPlan.startWatchersScript,
    attachCommands: nextLaunchPlan.attachCommands,
    attachAddedLanesScript,
    visibleAttach,
    laneReadiness,
    watcherStart,
    decision,
    issues: []
  };
}

export async function sendMessageToLane({ runDir, lane, message, transport, tmuxBin = DEFAULT_TMUX_BIN }) {
  const status = await readJson(path.join(runDir, 'status.json'));
  if (isTerminalRunStatusRecord(status)) {
    throw new Error(`send-message blocked because run is terminal: ${status.status}`);
  }
  const launchPlan = await readJson(path.join(runDir, 'launch.json'));
  const session = launchPlan.sessions.find((candidate) => candidate.lane === lane);
  if (!session) throw new Error(`No launched lane named ${lane}`);
  const resultState = await assessLaneResultArtifactState(session);
  if (resultState.hasResultArtifact) {
    throw new Error([
      `send-message blocked by lane-result-already-exists for ${lane}`,
      `result artifacts are close-out artifacts for a lane in this run: ${resultState.existingPaths.join(', ')}`,
      'start a fresh run for another packet or implement a first-class packet ledger; do not move, rename, or archive jobs/<lane>/result.* as a workaround'
    ].join('. '));
  }
  const readiness = await assessSessionReadiness({ launchPlan, session });
  if (readiness.status !== 'ready') {
    throw new Error(`send-message blocked because lane ${lane} is ${readiness.status}: ${readiness.detail}`);
  }
  if (session.adapterCapabilities && session.adapterCapabilities.stdinDispatch !== true) {
    throw new Error(`send-message blocked because lane ${lane} adapter ${session.adapter} does not support stdin dispatch; use the lane-specific script runner/result ingestion path instead`);
  }
  const route = await readJson(path.join(runDir, 'route.snapshot.json'));
  const gitPolicy = evaluateLaneGitPolicy({ route, lane, command: message });
  if (!gitPolicy.ok) {
    const detail = gitPolicy.issues.map((issue) => issue.detail).join('; ');
    throw new Error(`send-message blocked by route-owned commit policy: ${detail}`);
  }
  await sendTmuxMessage({
    transport: transport || realTmuxTransport(tmuxBin),
    socketName: launchPlan.socketName,
    socketPath: launchPlan.socketPath,
    target: session.sessionName,
    message,
    bufferName: `${launchPlan.runId}-${lane}-manual`
  });
  return { ok: true, lane, session: session.sessionName };
}

async function assessLaneResultArtifactState(session) {
  const candidatePaths = [session.resultPath, session.markdownResultPath].filter(Boolean);
  const existingPaths = [];
  for (const filePath of candidatePaths) {
    if (await pathExists(filePath)) existingPaths.push(filePath);
  }
  return {
    hasResultArtifact: existingPaths.length > 0,
    existingPaths
  };
}

async function assessLaneReadiness({ launchPlan, lanes }) {
  const requested = new Set(lanes || []);
  const sessions = (launchPlan.sessions || []).filter((session) => requested.has(session.lane));
  const values = [];
  for (const session of sessions) values.push(await assessSessionReadiness({ launchPlan, session }));
  return values;
}

async function assessSessionReadiness({ launchPlan, session }) {
  const usesDeferredStart = session.entryPath === session.deferWrapperPath;
  if (!usesDeferredStart) {
    return {
      lane: session.lane,
      status: 'ready',
      detail: 'lane uses direct launch wrapper',
      sessionName: session.sessionName
    };
  }
  const started = await pathExists(session.startSignalPath);
  if (started) {
    return {
      lane: session.lane,
      status: 'ready',
      detail: 'deferred lane start signal exists',
      sessionName: session.sessionName,
      startSignalPath: session.startSignalPath
    };
  }
  return {
    lane: session.lane,
    status: 'waiting_for_visible_attach',
    detail: `deferred lane is waiting for visible attach/start signal at ${session.startSignalPath}`,
    sessionName: session.sessionName,
    startSignalPath: session.startSignalPath,
    attachCommand: launchPlan.attachCommands?.[session.lane] || '',
    startCommand: `: > ${shellQuote(session.startSignalPath)}`
  };
}

export async function stopRunSessions({ runDir, confirmRunId, execute = false, transport, tmuxBin = DEFAULT_TMUX_BIN }) {
  const launchPlan = await readJson(path.join(runDir, 'launch.json'));
  if (!confirmRunId || confirmRunId !== launchPlan.runId) {
    return {
      ok: false,
      status: 'blocked',
      executed: false,
      runId: launchPlan.runId,
      runDir,
      sessions: launchPlan.sessions.map(publicSession),
      issues: [{
        code: 'run-id-confirmation-required',
        severity: 'block',
        detail: `Refusing to stop run without exact --confirm-run-id ${launchPlan.runId}`
      }]
    };
  }

  const tmux = transport || realTmuxTransport(tmuxBin);
  const socketName = launchPlan.socketName || DEFAULT_SOCKET;
  const socketPath = launchPlan.socketPath || '';
  const sessionStates = [];
  for (const session of launchPlan.sessions) {
    const probe = await safeTransportRun(tmux, [...tmuxSocketArgs({ socketName, socketPath }), 'has-session', '-t', session.sessionName]);
    sessionStates.push({
      lane: session.lane,
      sessionName: session.sessionName,
      displayLabel: session.displayLabel,
      exists: probe.ok,
      probeError: probe.ok ? '' : probe.error
    });
  }

  if (!execute) {
    return {
      ok: true,
      status: 'dry-run',
      executed: false,
      runId: launchPlan.runId,
      runDir,
      socketName,
      sessions: sessionStates,
      issues: []
    };
  }

  const killed = [];
  const failures = [];
  for (const session of sessionStates.filter((candidate) => candidate.exists)) {
    const result = await safeTransportRun(tmux, [...tmuxSocketArgs({ socketName, socketPath }), 'kill-session', '-t', session.sessionName]);
    if (result.ok) killed.push(session.sessionName);
    else failures.push({ sessionName: session.sessionName, error: result.error });
  }

  if (failures.length > 0) {
    const currentStatus = await readJson(path.join(runDir, 'status.json'));
    if (!isTerminalRunStatusRecord(currentStatus)) {
      await setRunStatus(runDir, 'blocked', `stop-run failed for ${failures.map((failure) => failure.sessionName).join(', ')}`);
    }
    return {
      ok: false,
      status: isTerminalRunStatusRecord(currentStatus) ? currentStatus.status : 'blocked',
      executed: true,
      runId: launchPlan.runId,
      runDir,
      socketName,
      sessions: sessionStates,
      killed,
      issues: failures.map((failure) => ({
        code: 'tmux-kill-session-failed',
        severity: 'block',
        detail: `${failure.sessionName}: ${failure.error}`
      }))
    };
  }

  const currentStatus = await readJson(path.join(runDir, 'status.json'));
  if (!isTerminalRunStatusRecord(currentStatus)) {
    await setRunStatus(runDir, 'aborted', `stopped by guarded stop-run; killed ${killed.length} tmux session(s)`);
  }
  const terminalStatusPreserved = isTerminalRunStatusRecord(currentStatus);
  return {
    ok: true,
    status: terminalStatusPreserved ? currentStatus.status : 'aborted',
    executed: true,
    runId: launchPlan.runId,
    runDir,
    socketName,
    socketPath,
    sessions: sessionStates,
    killed,
    terminalStatusPreserved,
    issues: []
  };
}

export function buildLaunchPlan({ runId, runDir, cwd, socketName, socketPath = '', tmuxBin, deferStart = false, route, profile, sourcePaths = {}, lanes, startupPacket, adapterCommands }) {
  const suffix = safeName(runId).slice(-18);
  const visibleRunId = displayRunId(runId);
  const priorityLabel = startupPacket?.selectedPriority?.slug || 'NO-PRIORITY';
  const sessions = lanes.map((lane) => {
    const sessionName = `orch-${safeName(lane.lane)}-${suffix}`;
    const jobDir = path.join(runDir, 'jobs', safeName(lane.lane));
    const promptPath = path.join(jobDir, 'prompt.md');
    const profileLane = getLane(profile.lanes, lane.lane) || {};
    const adapterProfile = profileLane.adapterProfile || '';
    const displayLabel = [
      titleCase(lane.persona),
      modelDisplayName(lane.adapter, adapterProfile),
      priorityLabel,
      visibleRunId
    ].join(' | ');
    const routeCommitPolicy = getOrchestratorCommitPolicy(route, lane.lane);
    const routeOwnedCommit = routeCommitPolicy.ok;
    const routeWriteScope = routeOwnedCommit ? route.orchestratorCommit?.laneWriteScopes?.[lane.lane] || null : null;
    const canWrite = lane.canWrite === true || routeOwnedCommit;
    return {
      lane: lane.lane,
      persona: lane.persona,
      adapter: lane.adapter,
      adapterProfile,
      canWrite,
      profileCanWrite: lane.canWrite === true,
      routeOwnedCommit,
      routeWriteScope,
      adapterKind: lane.adapterKind || '',
      adapterCapabilities: lane.capabilities || {},
      command: adapterCommands.get(lane.adapter),
      sessionName,
      displayLabel,
      promptPath,
      resultPath: path.join(jobDir, 'result.json'),
      markdownResultPath: path.join(jobDir, 'result.md'),
      wrapperPath: path.join(jobDir, 'launch.sh'),
      deferWrapperPath: path.join(jobDir, 'launch-deferred.sh'),
      startSignalPath: path.join(jobDir, 'start.signal'),
      startupMode: laneStartupMode(route, lane),
      width: DEFAULT_SESSION_WIDTH,
      height: DEFAULT_SESSION_HEIGHT,
      bootstrapMessage: `Read and follow this CoCoder orchestration launch prompt exactly: ${promptPath}`
    };
  });
  const helperScripts = Object.fromEntries(
    sessions.map((session) => [session.lane, path.join(runDir, `send-to-${safeName(session.lane)}.sh`)])
  );
  const completionWatchScripts = Object.fromEntries(
    sessions
      .map((session) => [session.lane, path.join(runDir, `watch-${safeName(session.lane)}-completion.sh`)])
  );
  for (const session of sessions) {
    session.entryPath = deferStart ? session.deferWrapperPath : session.wrapperPath;
  }
  return {
    version: 1,
    runId,
    runDir,
    cwd,
    socketName,
    socketPath,
    tmuxBin,
    deferStart,
    route: {
      id: route.id,
      lead: route.lead,
      teammates: route.teammates || [],
      initialLanes: route.initialLanes || null,
      topologyOptions: route.topologyOptions || [],
      leadSupportCommit: route.leadSupportCommit || null
    },
    profile: { id: profile.id, label: profile.label },
    sourcePaths,
    modelRoles: resolveModelRoles({ profile, route }),
    startupWarnings: startupPacket?.warnings || [],
    personaRouteAudit: startupPacket?.personaRouteAudit || null,
    startupPacketPath: path.join(runDir, 'startup-packet.json'),
    sessions,
    helperScripts,
    completionWatchScripts,
    startAllScript: path.join(runDir, 'start-lanes.sh'),
    startWatchersScript: path.join(runDir, 'start-watchers.sh'),
    attachCommands: Object.fromEntries(
      sessions.map((session) => [session.lane, `${tmuxBin} ${tmuxSocketArgs({ socketName, socketPath }).map(shellQuoteIfNeeded).join(' ')} attach -t ${session.sessionName}`])
    ),
    createdAt: new Date().toISOString()
  };
}

export function selectInitialLaunchLanes(route, lanes = []) {
  if (!Array.isArray(route?.initialLanes) || route.initialLanes.length === 0) return lanes;
  const initial = new Set(route.initialLanes);
  return lanes.filter((lane) => initial.has(lane.lane));
}

export async function evaluateLaunchGitCapabilityPreflight({
  route,
  lanes,
  repoRoot = process.cwd(),
  probeGitCommitCapability = probeRepoGitCommitCapability
} = {}) {
  const requirements = laneGitCommitRequirements(route, lanes);
  const issues = [];
  for (const requirement of requirements) {
    if (requirement.issue) {
      issues.push(requirement.issue);
      continue;
    }
    const capability = await probeGitCommitCapability({ repoRoot, route, lane: requirement.lane });
    if (!capability.ok) {
      issues.push({
        code: 'missing-git-commit-capability',
        severity: 'block',
        capability: 'git-commit',
        lane: requirement.lane,
        route: route?.id || 'unknown',
        remediation: gitCommitRemediation(),
        detail: [
          `route ${route?.id || 'unknown'} requires lane ${requirement.lane} to run git commits, but git-commit capability is unavailable`,
          capability.detail || capability.error || 'unable to create a harmless lock probe under the repository git directory',
          `Remediation: ${gitCommitRemediation()}`
        ].filter(Boolean).join('. ')
      });
    }
  }
  return {
    ok: issues.length === 0,
    status: issues.length === 0 ? 'ok' : 'blocked',
    checkedLanes: requirements.filter((requirement) => !requirement.issue).map((requirement) => requirement.lane),
    skippedLanes: skippedOrchestratorCommitLanes(route, lanes),
    issues
  };
}

function laneGitCommitRequirements(route, lanes = []) {
  const policy = route?.gitCommitPolicy;
  if (!policy) return [];
  if (policy.mode !== 'writer-lane') {
    return [{
      issue: {
        code: 'route-config-git-commit-policy-invalid',
        severity: 'block',
        route: route?.id || 'unknown',
        detail: `gitCommitPolicy.mode must be writer-lane when present, got ${policy.mode || 'missing'}`,
        remediation: gitCommitRemediation()
      }
    }];
  }
  if (!Array.isArray(policy.writerLanes) || policy.writerLanes.length === 0) {
    return [{
      issue: {
        code: 'route-config-git-commit-writer-lanes-missing',
        severity: 'block',
        route: route?.id || 'unknown',
        detail: 'gitCommitPolicy.writerLanes must name each lane that is expected to run git commits',
        remediation: gitCommitRemediation()
      }
    }];
  }
  return policy.writerLanes.map((lane) => {
    const orchestratorPolicy = getOrchestratorCommitPolicy(route, lane);
    if (orchestratorPolicy.ok) {
      return {
        issue: {
          code: 'route-config-git-commit-policy-conflict',
          severity: 'block',
          route: route?.id || 'unknown',
          lane,
          detail: `lane ${lane} cannot require writer-lane git commits while orchestratorCommit owns commits for the same lane`,
          remediation: gitCommitRemediation()
        }
      };
    }
    const laneConfig = lanes.find((candidate) => candidate.lane === lane);
    if (!laneConfig) {
      return {
        issue: {
          code: 'route-config-git-commit-lane-missing',
          severity: 'block',
          route: route?.id || 'unknown',
          lane,
          detail: `gitCommitPolicy names lane ${lane}, but the route/profile compatibility result does not include that lane`,
          remediation: gitCommitRemediation()
        }
      };
    }
    return { lane };
  });
}

function skippedOrchestratorCommitLanes(route, lanes = []) {
  return lanes
    .map((lane) => lane.lane)
    .filter((lane) => getOrchestratorCommitPolicy(route, lane).ok);
}

async function probeRepoGitCommitCapability({ repoRoot }) {
  let gitDir = '';
  try {
    const result = await execFileAsync('git', ['-C', repoRoot, 'rev-parse', '--absolute-git-dir'], { maxBuffer: 1024 * 1024 });
    gitDir = result.stdout.trim();
  } catch (error) {
    return {
      ok: false,
      status: 'git-dir-unavailable',
      detail: error.stderr || error.message || 'git rev-parse --absolute-git-dir failed'
    };
  }

  // M4.14 (audit §H15): the probe MUST stay inside `.git/` to actually test
  // git-write capability — workspace-write sandboxes (codex `--sandbox
  // workspace-write` and similar) can write under the workspace tree but
  // not under `.git/`, so moving the probe to a run-evidence dir would
  // produce a false positive. Pollution concern is addressed by isolating
  // the probe into a dedicated subdirectory (`.git/cocoder-capability-probes/`)
  // instead of writing directly at the top of `.git/` where the filename
  // could be mistaken for git's own `.lock` files. The subdir + file are
  // both removed in both the success and failure paths.
  const probeDir = path.join(gitDir, 'cocoder-capability-probes');
  const probePath = path.join(probeDir, `probe-${process.pid}-${Date.now()}.tmp`);
  try {
    await mkdir(probeDir, { recursive: true });
    await writeFile(probePath, 'cocoder git capability probe\n', { flag: 'wx' });
    await rm(probePath, { force: true });
    await rm(probeDir, { recursive: true, force: true });
    return { ok: true, status: 'available', gitDir };
  } catch (error) {
    await rm(probePath, { force: true }).catch(() => {});
    await rm(probeDir, { recursive: true, force: true }).catch(() => {});
    return {
      ok: false,
      status: 'git-dir-write-denied',
      gitDir,
      detail: `${error.code || 'git-dir-write-failed'} while probing ${probePath}: ${error.message}`
    };
  }
}

function gitCommitRemediation() {
  return 'use a route with orchestrator-owned commits (orchestratorCommit.enabled=true) or run from an unsandboxed terminal with .git write access';
}

async function writeLaunchArtifacts(launchPlan) {
  await writeJson(path.join(launchPlan.runDir, 'launch.json'), launchPlan);
  for (const session of launchPlan.sessions) {
    await mkdir(path.dirname(session.promptPath), { recursive: true });
    await writeFile(session.promptPath, await renderLanePrompt(launchPlan, session));
    await writeFile(session.wrapperPath, renderSessionWrapper(launchPlan, session), { mode: 0o755 });
    await writeFile(session.deferWrapperPath, renderDeferredSessionWrapper(session), { mode: 0o755 });
  }
  for (const session of launchPlan.sessions) {
    await writeFile(launchPlan.helperScripts[session.lane], renderSendScript(launchPlan.runDir, session.lane), { mode: 0o755 });
  }
  for (const session of launchPlan.sessions) {
    await writeFile(launchPlan.completionWatchScripts[session.lane], renderCompletionWatchScript(launchPlan, session), { mode: 0o755 });
  }
  await writeFile(launchPlan.startAllScript, renderStartAllScript(launchPlan), { mode: 0o755 });
  await writeFile(launchPlan.startWatchersScript, renderStartWatchersScript(launchPlan), { mode: 0o755 });
}

async function renderLanePrompt(launchPlan, session) {
  const teammateSessions = launchPlan.sessions
    .filter((candidate) => candidate.lane !== session.lane)
    .map((candidate) => `${candidate.lane}: ${candidate.sessionName}`)
    .join('\n');
  const sendHelpers = Object.entries(launchPlan.helperScripts)
    .map(([lane, script]) => `${lane}: ${script}`)
    .join('\n');
  const completionWatchers = Object.entries(launchPlan.completionWatchScripts)
    .map(([lane, script]) => `${lane}: ${script}`)
    .join('\n');
  const composed = await composePersonaPrompt({ persona: session.persona });
  const modelRoleLines = summarizeModelRoles(launchPlan.modelRoles);
  const startupWarningLines = (launchPlan.startupWarnings || []).map((warning) => `- ${warning}`);
  const personaRouteAuditLines = renderPersonaRouteAuditLines(launchPlan.personaRouteAudit);
  const topologyLines = renderTopologyOptionLines(launchPlan);

  return [
    '# CoCoder Orchestration Launch',
    '',
    `Launch guard: ${LEGACY_SKILL_BOOTSTRAP_GUARD}`,
    '',
    `run_id: ${launchPlan.runId}`,
    `route: ${launchPlan.route.id}`,
    `lane: ${session.lane}`,
    `persona: ${session.persona}`,
    `adapter: ${session.adapter}`,
    `adapter_profile: ${session.adapterProfile || 'default'}`,
    `display_label: ${session.displayLabel}`,
    `can_write: ${session.canWrite ? 'true' : 'false'}`,
    `startup_packet: ${launchPlan.startupPacketPath}`,
    `result_file: ${session.resultPath}`,
    `markdown_result_file: ${session.markdownResultPath}`,
    `startup_mode: ${session.startupMode}`,
    '',
    '## Lane Result Artifact Contract',
    '',
    '- `result_file` and `markdown_result_file` are close-out artifacts for this lane in this run.',
    '- Write them only when this lane is done for the current packet; after either file exists, the runtime refuses further `send-message` dispatches to this lane.',
    '- Do not move, rename, archive, overwrite, or clear `jobs/<lane>/result.*` to make room for another packet. Start a fresh run for additional lane packets until a first-class packet ledger exists.',
    '',
    ...composeRuntimeRoleLines(session),
    ...startupModeInstructions(launchPlan, session),
    '- Write the JSON and Markdown result files named above before declaring the lane complete.',
    ...(session.startupMode === 'lead' ? [
      '',
      '## Lead Founder Interaction Guard',
      '',
      '- Use plain chat for founder decisions. Do not open interactive pickers, cursor-driven forms, checkbox menus, or one-question-at-a-time prompts unless the founder explicitly requested that interface or the launcher/control plane cannot proceed without it. Do not open Claude Code interactive question UI for founder decisions.',
      '- Forbidden founder-decision UI includes terminal lists that say `Enter to select`, `Type something`, `Chat about this`, or otherwise wait for arrow-key selection; write normal chat options instead.',
      '- Before `add-lanes`, do not block on low-level implementation mechanics that already have a conservative recommendation. State the default in the founder brief or dispatch packet, request the needed topology with `add-lanes`, and let the configured teammate lane execute within that assumption.',
      '- Selecting a declared topology option for an already authorized atom is not a founder decision and must not use an interactive picker; state the selected option in normal chat and run `add-lanes`.',
      '- When dispatching a teammate lane, do not restate or override that lane\'s result identity fields (`persona`, `adapter`, `canWrite`, result paths). Tell the teammate to use its launch prompt as the authoritative result contract.',
      '- Escalate only scope, priority order, architecture direction, route/topology authority, write-boundary changes, external accounts/vendors/payments, production or user-facing behavior, security posture, or irreversible data state.',
      '- If orchestration mechanics fail, stop and report. Do not repair or delegate repair of `add-lanes`, lane attach/start state, run-local helpers, `send-message`, watchers, result artifacts, stale tmux sessions, or files under `cocoder/**`; preserve evidence and ask the founder to use the Orchestrator Debugger.'
    ] : []),
    ...(startupWarningLines.length > 0 ? [
      '',
      '## Startup Warnings',
      '',
      ...startupWarningLines,
      '',
      '- These warnings do not block run creation.',
      session.startupMode === 'lead'
        ? '- Acknowledge startup warnings proportionally before dispatch. Do not run a broad dirty-worktree survey or block `add-lanes` unless a warning names staged work or files that overlap this run\'s route/profile/boundary snapshots, control-plane inputs, selected priority boundary, active run artifacts, or files Oscar is about to commit.'
        : '- Wait for the lead lane to reconcile startup warnings before treating the selected priority excerpt as dispatch authority.'
    ] : []),
    ...(personaRouteAuditLines.length > 0 ? [
      '',
      '## Persona Route Audit',
      '',
      ...personaRouteAuditLines,
      '',
      session.startupMode === 'lead'
        ? '- If a required persona is missing from this route, do not substitute Bob/Oscar. Use Decision Needed, Wrap Up, or launch the route/session that contains that persona before implementation dispatch.'
        : '- Wait for the lead lane to reconcile persona route fit before treating any packet or next action as executable.'
    ] : []),
    ...(modelRoleLines.length > 0 ? [
      '',
      '## Model Role Policy',
      '',
      ...modelRoleLines,
      '',
      '- Treat role names as the dispatch contract. Do not silently substitute one role for another.',
      '- Dispatch helper and subagent work from the configured role slot; planning, research, audit, and synthesis roles do not satisfy builder subagent roles unless the route explicitly configures that slot.',
      '- If a configured role model is unavailable, follow the fallback policy and label any degraded mode explicitly.'
    ] : []),
    ...(topologyLines.length > 0 && session.startupMode === 'lead' ? [
      '',
      '## Validated Topology Options',
      '',
      ...topologyLines,
      '',
      '- Choose from these topology options only; do not invent a lane topology or start manual tmux sessions.',
      '- If the next atom requires lanes that are not currently launched, request them with `add-lanes`; the control plane validates route policy, profile, adapter preflight, priority boundary, staged git state, helpers, watchers, and result contracts before writing lane artifacts.',
      '- Unstaged unrelated durable orchestration edits are topology-decision warnings, not automatic add-lanes blockers. Staged durable orchestration edits still block.',
      `- Command form: node ${CORE_CLI_PATH} add-lanes --run-dir ${launchPlan.runDir} --lanes <lane[,lane]> --topology-option <id> --required-personas <Persona[,Persona]> --reason "<plain-English reason>" --execute true`,
      '- If validation blocks, write or present the topology decision and wrap or ask the founder instead of substituting another persona.'
    ] : []),
    ...(launchPlan.route?.leadSupportCommit?.enabled === true && Array.isArray(launchPlan.route.leadSupportCommit.leads) && launchPlan.route.leadSupportCommit.leads.includes(session.lane) ? [
      '',
      '## Guarded Lead Support Commits',
      '',
      '- If a mechanical orchestration blocker is already authorized and only needs bounded support-file changes, use `lead-support-commit` instead of asking the founder to run git manually.',
      '- This is not a priority implementation commit. It can stage only exact files inside the route-declared leadSupportCommit allowed scopes, excludes run-local artifacts, blocks unrelated staged files, and writes evidence under this run.',
      `- Command form: node ${CORE_CLI_PATH} lead-support-commit --run-dir ${launchPlan.runDir} --lane ${session.lane} --files <repo-relative-path[,path]> --message "<commit message>" --reason "<plain-English support reason>"`
    ] : []),
    '',
    '## Composed Persona Prompt',
    '',
    composed.markdown,
    '',
    '## Teammate Sessions',
    '',
    teammateSessions || 'none',
    '',
    '## Send Helpers',
    '',
    sendHelpers,
    '',
    '## Completion Watchers',
    '',
    completionWatchers || 'none',
    '',
    '## Required Result Shape',
    '',
    'Write `result_file` as JSON matching the local `job-result` contract:',
    ...(session.persona === 'oscar' ? [
      '',
      'Oscar PASS results must also include `personaDispatchPlan`: an array of rows with `atom`, `requiredPersona`, `routeAvailable`, `dispatchStatus`, and `evidenceExpected`.',
      '- `routeAvailable` must be a JSON boolean (`true` or `false`), never strings like `"yes"` or `"no"`.',
      '- Use `dispatchStatus: "completed"` only for current-atom required persona work that actually ran and has evidence.',
      '- If a required persona is unavailable on this route, use `routeAvailable: false` with `dispatchStatus: "next-route-required"` and do not report the current atom as PASS.',
      '- Do not include upstream packet-authoring, packet-only, deferred, unavailable, blocked, or not-executed persona work as completed current-atom PASS coverage.'
    ] : []),
    '',
    '```json',
    '{',
    '  "status": "PASS | BLOCK | CONDITIONAL_PASS | NEEDS_FOUNDER | FAILED",',
    `  "persona": "${session.persona}",`,
    `  "adapter": "${session.adapter}",`,
    `  "canWrite": ${session.canWrite ? 'true' : 'false'},`,
    '  "filesChanged": ["<path or none>"],',
    '  "summary": "<one paragraph>",',
    '  "findings": ["<finding or none>"],',
    '  "evidence": ["<file, command, screenshot, diff, or none>"],',
    '  "residualRisk": ["<risk or none>"],',
    '  "nextAction": "<specific next action or none>"',
    '}',
    '```',
    ''
  ].join('\n');
}

function renderTopologyOptionLines(launchPlan) {
  const options = launchPlan.route?.topologyOptions || [];
  if (!Array.isArray(options) || options.length === 0) return [];
  return options.map((option) => {
    const required = Array.isArray(option.requiredPersonas) && option.requiredPersonas.length > 0
      ? `; required personas: ${option.requiredPersonas.join(', ')}`
      : '';
    return `- ${option.id}: lanes ${option.lanes.join(', ')}${required}.`;
  });
}

function renderPersonaRouteAuditLines(audit) {
  if (!audit) return [];
  const lines = [
    `- Available personas in this route: ${(audit.availablePersonas || []).join(', ') || 'none'}.`
  ];
  if ((audit.requiredPersonas || []).length > 0) {
    lines.push(`- Required personas detected from bounded next/dispatch context: ${audit.requiredPersonas.join(', ')}.`);
  }
  if ((audit.missingPersonas || []).length > 0) {
    lines.push(`- Missing required personas: ${audit.missingPersonas.join(', ')}.`);
  }
  if ((audit.packetOnlyPersonas || []).length > 0) {
    lines.push(`- Packetized or not-executed persona work detected: ${audit.packetOnlyPersonas.join(', ')}.`);
  }
  for (const item of (audit.evidence || []).slice(0, 6)) {
    lines.push(`- Evidence (${item.persona}, ${item.reason}): ${item.source}`);
  }
  return lines;
}

export function renderSessionWrapper(launchPlan, session) {
  if (session.adapterCapabilities?.interactive === false) {
    return renderNoninteractiveSessionHolder(launchPlan, session);
  }
  // Lead lanes drive teammate dispatch via `tmux send-keys` against the
  // orchestration socket from inside their own pane. Codex's default
  // `workspace-write` sandbox denies socket IPC, which makes the lead lane's
  // `send-to-<lane>.sh` helper fail with "Operation not permitted" and blocks
  // the whole route. Sub-Playbook E E3.3 surfaced this; until dispatch moves
  // outside the codex sandbox (a v0.2 architectural item), grant lead lanes
  // `danger-full-access` so multi-lane orchestration actually completes.
  // Teammate / writer lanes keep `workspace-write` — they receive dispatches
  // through stdin/file, never drive tmux themselves.
  const codexSandbox = session.startupMode === 'lead' ? 'danger-full-access' : 'workspace-write';
  return [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    `cd ${shellQuote(launchPlan.cwd)}`,
    `BOOTSTRAP=${shellQuote(`${LEGACY_SKILL_BOOTSTRAP_GUARD} ${session.bootstrapMessage}. Load that file before acting; do not rely on this bootstrap line as the full instruction set.`)}`,
    `case ${shellQuote(session.adapter)} in`,
    '  claude)',
    '    exec claude -- "$BOOTSTRAP"',
    '    ;;',
    '  codex)',
    `    exec codex --ask-for-approval never --sandbox ${codexSandbox} "$BOOTSTRAP"`,
    '    ;;',
    '  *)',
    // M4.11 (audit §H9): shellQuote the fall-through `session.command` so
    // future adapter declarations (currently only codex/claude land here
    // since both have explicit branches above) can't shell-inject through
    // command names with spaces or metacharacters. v0.2 adapter-extensibility
    // work that adds non-CLI runners may want to migrate this branch off
    // raw `exec` entirely.
    `    exec ${shellQuote(session.command)} "$BOOTSTRAP"`,
    '    ;;',
    'esac',
    ''
  ].join('\n');
}

function renderNoninteractiveSessionHolder(launchPlan, session) {
  return [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    `cd ${shellQuote(launchPlan.cwd)}`,
    `printf "%s\\n" ${shellQuote(session.displayLabel)}`,
    `printf "%s\\n" ${shellQuote(`Lane ${session.lane} uses noninteractive adapter ${session.adapter}.`)}`,
    `printf "%s\\n" ${shellQuote('This pane is a visibility/readiness holder only; do not paste chat dispatches here.')}`,
    `printf "%s\\n" ${shellQuote(`Write result artifacts at ${session.resultPath} and ${session.markdownResultPath} after running the adapter-specific script flow.`)}`,
    'printf "%s\\n" "Press Ctrl-C only if the founder/debugger is intentionally stopping this lane."',
    'while :; do sleep 3600; done',
    ''
  ].join('\n');
}

function renderDeferredSessionWrapper(session) {
  return [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    `echo ${shellQuote(`Waiting for visible terminal attach before starting ${session.displayLabel}...`)}`,
    `while [ ! -f ${shellQuote(session.startSignalPath)} ]; do`,
    '  sleep 0.1',
    'done',
    'clear',
    `exec ${shellQuote(session.wrapperPath)}`,
    ''
  ].join('\n');
}

function renderStartAllScript(launchPlan) {
  return [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    ...launchPlan.sessions.map((session) => `: > ${shellQuote(session.startSignalPath)}`),
    ''
  ].join('\n');
}

// Hardened by porting CoBuilder's `renderAttachAddedLanesScript` (audit §4
// E2.2e.5 dogfood port surfaced two failing tests that pin the safer
// selection semantics). Instead of grabbing `current window`, the script
// asks tmux which TTY is attached to the lead session, then iterates iTerm
// sessions looking for the matching candidate (with a session-name /
// display-label fallback). If no candidate is found, it creates a fresh
// window from scratch instead of hijacking whatever iTerm window happens to
// be focused.
function renderAttachAddedLanesScript(sessions, { tmuxBin = DEFAULT_TMUX_BIN, socketName = DEFAULT_SOCKET, socketPath = '', targetSession = null } = {}) {
  const first = sessions[0];
  const attachLines = sessions.map((session) => `echo "  ${session.lane}: ${session.attachCommand || ''}"`);
  const socketArgs = tmuxSocketArgs({ socketName, socketPath });
  const shellSocketArgs = socketArgs.length > 0 ? socketArgs.map(shellQuote).join(' ') : '';
  if (!first) {
    return [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'echo "No added lanes to attach."',
      ''
    ].join('\n');
  }
  const splitAddedSessionLines = sessions.flatMap((session, index) => [
    '  tell baseSession',
    `    set addedSession${index} to (split vertically with default profile command ${appleScriptString(session.attachCommand)})`,
    '  end tell',
    `  tell addedSession${index}`,
    `    set name to ${appleScriptString(session.displayLabel)}`,
    `    try`,
    `      set columns to ${Math.min(session.width, DEFAULT_ADDED_SPLIT_PANE_WIDTH)}`,
    `      set rows to ${session.height}`,
    `    end try`,
    '  end tell'
  ]);
  const fallbackSplitLines = sessions.slice(1).flatMap((session, index) => {
    const sessionIndex = index + 1;
    return [
      '  tell baseSession',
      `    set addedSession${sessionIndex} to (split vertically with default profile command ${appleScriptString(session.attachCommand)})`,
      '  end tell',
      `  tell addedSession${sessionIndex}`,
      `    set name to ${appleScriptString(session.displayLabel)}`,
      `    try`,
      `      set columns to ${Math.min(session.width, DEFAULT_ADDED_SPLIT_PANE_WIDTH)}`,
      `      set rows to ${session.height}`,
      `    end try`,
      '  end tell'
    ];
  });
  const targetSessionName = targetSession?.sessionName || '';
  const targetDisplayLabel = targetSession?.displayLabel || '';
  return [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    `TMUX_BIN=${shellQuote(tmuxBin)}`,
    `SOCKET_ARGS=(${shellSocketArgs})`,
    `TARGET_SESSION=${shellQuote(targetSessionName)}`,
    'TARGET_TTY=""',
    'if [ -n "$TARGET_SESSION" ]; then',
    '  TARGET_TTY="$("$TMUX_BIN" "${SOCKET_ARGS[@]}" list-clients -t "$TARGET_SESSION" -F "#{client_tty}" 2>/dev/null | head -n 1 || true)"',
    'fi',
    'export COCODER_ORCH_TARGET_TTY="$TARGET_TTY"',
    'echo "Attaching added lanes:"',
    ...attachLines,
    'if osascript -e \'id of application "iTerm"\' >/dev/null 2>&1; then',
    '  osascript <<\'ITERM_EOF\'',
    'tell application "iTerm"',
    '  activate',
    `  set targetSessionName to ${appleScriptString(targetSessionName)}`,
    `  set targetDisplayLabel to ${appleScriptString(targetDisplayLabel)}`,
    '  set targetTty to system attribute "COCODER_ORCH_TARGET_TTY"',
    '  set baseWindow to missing value',
    '  set baseSession to missing value',
    '  repeat with candidateWindow in windows',
    '    repeat with candidateTab in tabs of candidateWindow',
    '      repeat with candidateSession in sessions of candidateTab',
    '        set candidateTty to ""',
    '        try',
    '          set candidateTty to tty of candidateSession',
    '        end try',
    '        set candidateName to ""',
    '        try',
    '          set candidateName to name of candidateSession',
    '        end try',
    '        set candidateContents to ""',
    '        try',
    '          set candidateContents to contents of candidateSession',
    '        end try',
    '        if (targetTty is not "" and candidateTty is targetTty) or (targetTty is "" and ((targetSessionName is not "" and candidateContents contains targetSessionName) or (targetDisplayLabel is not "" and (candidateName contains targetDisplayLabel or candidateContents contains targetDisplayLabel)))) then',
    '          set baseWindow to candidateWindow',
    '          set baseSession to candidateSession',
    '          exit repeat',
    '        end if',
    '      end repeat',
    '      if baseSession is not missing value then exit repeat',
    '    end repeat',
    '    if baseSession is not missing value then exit repeat',
    '  end repeat',
    '  if baseSession is not missing value then',
    '    try',
    '      tell baseWindow to select',
    '    end try',
    ...splitAddedSessionLines,
    '  else',
    `    set baseWindow to (create window with default profile command ${appleScriptString(first.attachCommand)})`,
    '    set baseSession to current session of current tab of baseWindow',
    `    set name of baseSession to ${appleScriptString(first.displayLabel)}`,
    ...fallbackSplitLines,
    '  end if',
    'end tell',
    'ITERM_EOF',
    'elif osascript -e \'id of application "Terminal"\' >/dev/null 2>&1; then',
    '  osascript <<\'TERMINAL_EOF\'',
    'tell application "Terminal"',
    '  activate',
    ...sessions.flatMap((session) => [
      `  do script ${appleScriptString(session.attachCommand)}`,
      '  try',
      `    set number of columns of front window to ${session.width}`,
      `    set number of rows of front window to ${session.height}`,
      '  end try'
    ]),
    'end tell',
    'TERMINAL_EOF',
    'else',
    '  echo "No supported terminal app found for auto-attach. Attach manually, then run this script again or create the listed start signals after visible attach." >&2',
    '  exit 3',
    'fi',
    ...sessions.flatMap((session) => [
      `if ! "$TMUX_BIN" "\${SOCKET_ARGS[@]}" has-session -t ${shellQuote(session.sessionName)} >/dev/null 2>&1; then`,
      `  echo "Added lane session disappeared before visible attach completed: ${session.lane} (${session.sessionName})." >&2`,
      '  exit 4',
      'fi'
    ]),
    ...sessions.map((session) => `: > ${shellQuote(session.startSignalPath)}`),
    ''
  ].join('\n');
}

function renderCompletionWatchScript(launchPlan, session) {
  const cliPath = CORE_CLI_PATH;
  const message = [
    `Completion watcher: lane ${session.lane} wrote result file at ${session.resultPath}.`,
    `Capture fresh pane evidence, inspect ${session.resultPath} and ${session.markdownResultPath}, changed files, diffs, and tests, then make an accept/fresh-run-continuation/founder-decision phase-transition call before reporting completion.`,
    `Treat jobs/${session.lane}/result.json and jobs/${session.lane}/result.md as close-out artifacts for this lane in this run; do not move, rename, archive, overwrite, or clear them to send another packet.`,
    `If lane ${session.lane} is non-PASS and the lead accepts it, first write the lead PASS result JSON and Markdown pair, then run: node ${cliPath} record-supersession --run-dir ${launchPlan.runDir} --superseded-lane ${session.lane} --resolving-lane ${launchPlan.route.lead} --basis route-policy --findings "<exact finding from superseded result>" --evidence "<specific resolving evidence>".`,
    'Only after the supersession record exists should finalize-run-status be called.'
  ].join(' ');
  const notifyLead = session.lane === launchPlan.route.lead
    ? []
    : ['    node "$CLI" send-message --run-dir "$RUN_DIR" --lane "$LEAD" --message "$MESSAGE"'];
  return [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    `RESULT=${shellQuote(session.resultPath)}`,
    `MARKDOWN_RESULT=${shellQuote(session.markdownResultPath)}`,
    `RUN_DIR=${shellQuote(launchPlan.runDir)}`,
    `CLI=${shellQuote(cliPath)}`,
    `LEAD=${shellQuote(launchPlan.route.lead)}`,
    `MESSAGE=${shellQuote(message)}`,
    'TIMEOUT_SECONDS="${COCODER_ORCH_WATCH_TIMEOUT_SECONDS:-14400}"',
    'INTERVAL_SECONDS="${COCODER_ORCH_WATCH_INTERVAL_SECONDS:-15}"',
    'STABLE_SECONDS="${COCODER_ORCH_RESULT_STABLE_SECONDS:-5}"',
    'file_size() { wc -c < "$1" | tr -d "[:space:]"; }',
    'is_terminal_finalize() { node -e \'let raw=""; process.stdin.on("data", c => raw += c); process.stdin.on("end", () => { const value = JSON.parse(raw); process.exit(value.terminal === true ? 0 : 1); });\'; }',
    'is_non_running_finalize() { node -e \'let raw=""; process.stdin.on("data", c => raw += c); process.stdin.on("end", () => { const value = JSON.parse(raw); process.exit(value.status && value.status !== "running" ? 0 : 1); });\'; }',
    'elapsed=0',
    'notified_lead=0',
    'while [ "$elapsed" -lt "$TIMEOUT_SECONDS" ]; do',
    '  if [ -s "$RESULT" ] && [ -s "$MARKDOWN_RESULT" ]; then',
    '    result_size_before="$(file_size "$RESULT")"',
    '    markdown_size_before="$(file_size "$MARKDOWN_RESULT")"',
    '    sleep "$STABLE_SECONDS"',
    '    elapsed=$((elapsed + STABLE_SECONDS))',
    '    if [ -s "$RESULT" ] && [ -s "$MARKDOWN_RESULT" ] && [ "$(file_size "$RESULT")" = "$result_size_before" ] && [ "$(file_size "$MARKDOWN_RESULT")" = "$markdown_size_before" ]; then',
    '      if [ "$notified_lead" = "0" ]; then',
    ...notifyLead,
    '        notified_lead=1',
    '      fi',
    `      finalize_output="$(node "$CLI" finalize-run-status --run-dir "$RUN_DIR" --repo-root ${shellQuote(launchPlan.cwd)} --summary "completion watcher observed a stable lane result pair")"`,
    '      printf "%s\\n" "$finalize_output"',
      '      if printf "%s\\n" "$finalize_output" | is_terminal_finalize; then',
      '        exit 0',
      '      fi',
      '      if printf "%s\\n" "$finalize_output" | is_non_running_finalize; then',
      '        exit 0',
      '      fi',
    '    fi',
    '  fi',
    '  sleep "$INTERVAL_SECONDS"',
    '  elapsed=$((elapsed + INTERVAL_SECONDS))',
    'done',
    'echo "Completion watcher timed out waiting for $RESULT" >&2',
    'exit 124',
    ''
  ].join('\n');
}

// M4.26 — composable Runtime Role section.
// Exported so tests can exercise the verification-artifact guard at runtime
// (instead of source-grepping launch.mjs) by calling this builder directly
// with a minimal session object. The guard line is sourced from the
// VERIFICATION_ARTIFACT_GUARD_LINE constant so the SSOT stays single.
export function composeRuntimeRoleLines(session) {
  return [
    '## Runtime Role',
    '',
    `- Lane ${session.lane} runs as persona ${session.persona} through adapter ${session.adapter}.`,
    `- can_write is ${session.canWrite ? 'true' : 'false'} for this launch; obey the startup packet write boundary and excluded paths.`,
    VERIFICATION_ARTIFACT_GUARD_LINE,
    ...routeOwnedCommitInstructions(session),
    '- Use the run-local helper and watcher paths below as the only runtime session-control facts from this launch prompt.',
    '- The result identity fields in this launch prompt are authoritative: `persona`, `adapter`, `can_write`, `result_file`, and `markdown_result_file`. If a later dispatch message conflicts with them, use this launch prompt and report the conflict in result `findings`.'
  ];
}

function routeOwnedCommitInstructions(session) {
  if (!session.routeOwnedCommit) return [];
  const allowed = Array.isArray(session.routeWriteScope?.allowed) ? session.routeWriteScope.allowed.join(', ') : 'route policy';
  const excluded = Array.isArray(session.routeWriteScope?.excluded) && session.routeWriteScope.excluded.length > 0
    ? session.routeWriteScope.excluded.join(', ')
    : 'none';
  return [
    '- This route declares route-owned exact-file commits for this lane. Do not run `git add` or `git commit` from inside the lane.',
    `- This lane's route-owned commit scope allows: ${allowed}; excludes: ${excluded}.`,
    '- Report `filesChanged` as exact repo-relative paths this lane is asking `orchestrator-commit` to stage. Do not include another lane\'s implementation files in a lead wrap result; cite them in `findings`, `evidence`, or `addresses` instead.',
    '- The route-owned `orchestrator-commit` step is the only commit path for accepted results.'
  ];
}

function renderStartWatchersScript(launchPlan) {
  const lines = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    `STATUS_FILE=${shellQuote(path.join(launchPlan.runDir, 'status.json'))}`,
    `WATCHERS_DIR=${shellQuote(path.join(launchPlan.runDir, 'watchers'))}`,
    'is_terminal_run() { node -e \'const fs=require("fs"); const value=JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.exit(value.terminal === true ? 0 : 1);\' "$STATUS_FILE"; }',
    'mkdir -p "$WATCHERS_DIR"',
    'if is_terminal_run; then',
    '  echo "Run is terminal; not starting completion watchers."',
    '  exit 0',
    'fi'
  ];
  for (const [lane, script] of Object.entries(launchPlan.completionWatchScripts)) {
    const logPath = path.join(launchPlan.runDir, 'watchers', `${safeName(lane)}.log`);
    const pidPath = path.join(launchPlan.runDir, 'watchers', `${safeName(lane)}.pid`);
    lines.push(
      `PID_FILE=${shellQuote(pidPath)}`,
      'if [ -s "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then',
      `  echo ${shellQuote(`Watcher already running for ${lane}:`)} "$(cat "$PID_FILE")"`,
      'else',
      `  nohup ${shellQuote(script)} > ${shellQuote(logPath)} 2>&1 &`,
      '  echo "$!" > "$PID_FILE"',
      'fi'
    );
  }
  lines.push('');
  return lines.join('\n');
}

function renderSendScript(runDir, lane) {
  // M4.11 (audit §H9): the `--message "$*"` on the `else` branch below is
  // deliberate. With "$*" (quoted), every arg the caller passes becomes a
  // single IFS-joined --message value, so both `send-to-lane hello world`
  // and `send-to-lane "phrase one"` route through as one --message value.
  // "$@" (quoted) would expand to multiple separate args, and --message
  // only takes one, so the second arg would land as an unexpected positional.
  // The audit's "$@" recommendation was inverted for this dispatcher's
  // "all args → one message" contract.
  const cliPath = CORE_CLI_PATH;
  return [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'if [ "$#" -lt 1 ]; then',
    `  echo "Usage: $(basename "$0") \\"message\\" | --stdin" >&2`,
    '  exit 2',
    'fi',
    'if [ "$1" = "--stdin" ]; then',
    '  if [ "$#" -ne 1 ]; then',
    `    echo "Usage: $(basename "$0") --stdin < message-file" >&2`,
    '    exit 2',
    '  fi',
    `  node ${shellQuote(cliPath)} send-message --run-dir ${shellQuote(runDir)} --lane ${shellQuote(lane)} --stdin`,
    'else',
    `  node ${shellQuote(cliPath)} send-message --run-dir ${shellQuote(runDir)} --lane ${shellQuote(lane)} --message "$*"`,
    'fi',
    ''
  ].join('\n');
}

async function resolveAdapterCommands({ adaptersDir, contractsDir }) {
  const loaded = await loadAdapterDeclarations({ adaptersDir, contractsDir });
  const map = new Map();
  for (const adapter of loaded.adapters) map.set(adapter.id, adapter.command);
  return map;
}

async function sendTmuxMessage({ transport, socketName, socketPath, target, message, bufferName }) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'cocoder-orch-message-'));
  const messagePath = path.join(tmp, 'message.txt');
  try {
    await writeFile(messagePath, message);
    await transport.run([...tmuxSocketArgs({ socketName, socketPath }), 'send-keys', '-t', target, 'C-u']);
    await delay(75);
    await transport.run([...tmuxSocketArgs({ socketName, socketPath }), 'load-buffer', '-b', safeName(bufferName), messagePath]);
    await transport.run([...tmuxSocketArgs({ socketName, socketPath }), 'paste-buffer', '-d', '-b', safeName(bufferName), '-t', target]);
    await delay(75);
    await transport.run([...tmuxSocketArgs({ socketName, socketPath }), 'send-keys', '-t', target, 'C-m']);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function runVisibleAttachScript({ scriptPath }) {
  try {
    const result = await execFileAsync('/bin/zsh', [scriptPath], { maxBuffer: 1024 * 1024 });
    return {
      ok: true,
      status: 'attached',
      attachAddedLanesScript: scriptPath,
      stdout: result.stdout,
      stderr: result.stderr
    };
  } catch (error) {
    return {
      ok: false,
      status: 'manual_attach_required',
      attachAddedLanesScript: scriptPath,
      error: error.stderr || error.message || String(error)
    };
  }
}

async function runStartWatchersScript({ scriptPath }) {
  try {
    const result = await execFileAsync('/bin/zsh', [scriptPath], { maxBuffer: 1024 * 1024 });
    return {
      ok: true,
      status: 'started',
      startWatchersScript: scriptPath,
      stdout: result.stdout,
      stderr: result.stderr
    };
  } catch (error) {
    return {
      ok: false,
      status: 'failed',
      startWatchersScript: scriptPath,
      error: error.stderr || error.message || String(error)
    };
  }
}

function appleScriptString(value) {
  return `"${String(value || '').replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function realTmuxTransport(tmuxBin) {
  return {
    run: async (args) => {
      try {
        const result = await execFileAsync(tmuxBin, args, { maxBuffer: 1024 * 1024 });
        return { stdout: result.stdout, stderr: result.stderr };
      } catch (error) {
        const detail = error.stderr || error.message;
        throw new Error(`tmux command failed: ${tmuxBin} ${args.join(' ')}\n${detail}`);
      }
    }
  };
}

function tmuxSocketArgs({ socketName, socketPath }) {
  return socketPath ? ['-S', socketPath] : ['-L', socketName || DEFAULT_SOCKET];
}

function tmuxSocketLabel({ socketName, socketPath }) {
  return socketPath ? `socket path ${socketPath}` : `socket ${socketName || DEFAULT_SOCKET}`;
}

async function safeTransportRun(transport, args) {
  try {
    const result = await transport.run(args);
    return { ok: true, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
}

function publicSession(session) {
  return {
    lane: session.lane,
    persona: session.persona,
    adapter: session.adapter,
    adapterProfile: session.adapterProfile,
    adapterKind: session.adapterKind,
    adapterCapabilities: session.adapterCapabilities,
    startupMode: session.startupMode,
    sessionName: session.sessionName,
    displayLabel: session.displayLabel,
    promptPath: session.promptPath,
    resultPath: session.resultPath,
    startSignalPath: session.startSignalPath
  };
}

function routePriorityIssue(route, prioritySlug) {
  if (!Array.isArray(route.supportedPriorityOwners) || route.supportedPriorityOwners.length === 0) return null;
  if (route.supportedPriorityOwners.includes('*') || route.supportedPriorityOwners.includes(prioritySlug)) return null;
  return {
    code: 'priority-owner-not-supported',
    severity: 'block',
    detail: `route ${route.id} does not list ${prioritySlug} in supportedPriorityOwners`
  };
}

function blockingPriorityBoundaryIssues(priorityBoundary) {
  if (!priorityBoundary || priorityBoundary.ok) return [];
  return priorityBoundary.issues.filter((issue) => issue.code !== 'priority-boundary-missing');
}

function validateTopologyOption({ route, topologyOptionId, requestedLanes, existingLanes, issues }) {
  const options = Array.isArray(route.topologyOptions) ? route.topologyOptions : [];
  if (options.length === 0) {
    issues.push(issue('topology-options-missing', 'startup', `route ${route.id} does not declare validated topologyOptions for dynamic lane launch`));
    return null;
  }
  const option = topologyOptionId
    ? options.find((candidate) => candidate.id === topologyOptionId)
    : options.find((candidate) => requestedLanes.every((lane) => candidate.lanes.includes(lane)));
  if (!option) {
    issues.push(issue('topology-option-missing', 'startup', `no topology option covers requested lanes ${requestedLanes.join(', ')}`));
    return null;
  }
  const optionLanes = new Set(option.lanes || []);
  for (const lane of existingLanes) {
    if (lane === route.lead && !optionLanes.has(lane)) {
      issues.push(issue('topology-option-lead-missing', lane, `topology option ${option.id} must include lead lane ${lane}`));
    }
  }
  for (const lane of requestedLanes) {
    if (!optionLanes.has(lane)) {
      issues.push(issue('topology-option-lane-not-allowed', lane, `topology option ${option.id} does not allow lane ${lane}`));
    }
  }
  return option;
}

function validateStartupBoundaryForAddedLanes({ startupPacket, route, lanes }) {
  const issues = [];
  const laneBoundaries = startupPacket?.resolvedWriteBoundary?.laneBoundaries || {};
  for (const lane of lanes || []) {
    const routeScope = route.orchestratorCommit?.laneWriteScopes?.[lane.lane];
    const needsBoundary = lane.canWrite === true || routeScope;
    if (!needsBoundary) continue;
    if (!laneBoundaries[lane.lane] && !routeScope) {
      issues.push({
        code: 'priority-boundary-writer-missing',
        severity: 'block',
        lane: lane.lane,
        detail: `startup packet has no resolved writer boundary for added lane ${lane.lane}`
      });
    }
  }
  return {
    ok: issues.length === 0,
    status: issues.length === 0 ? 'ready' : 'non-ready',
    issues
  };
}

function issue(code, lane, detail) {
  return { code, severity: 'block', lane, detail };
}

function unique(values) {
  return [...new Set(values)];
}

function laneStartupMode(route, lane) {
  if (route.allowAutonomousTeammateStart === true) return 'autonomous';
  if (lane.lane === route.lead) return 'lead';
  if (Array.isArray(route.teammates) && route.teammates.includes(lane.persona)) return 'wait-for-lead-dispatch';
  if (Array.isArray(route.teammates) && route.teammates.includes(lane.lane)) return 'wait-for-lead-dispatch';
  return 'autonomous';
}

function startupModeInstructions(launchPlan, session) {
  if (session.startupMode === 'wait-for-lead-dispatch') {
    return [
      `- startup_mode is wait-for-lead-dispatch: load this prompt and the startup packet for orientation only, then wait for a concrete dispatch from lane ${launchPlan.route.lead}.`,
      '- Do not plan, inspect target files, run verification commands, edit files, or infer a phase from the startup packet alone.',
      `- If no dispatch arrives, leave the lane idle; the lead should dispatch through ${launchPlan.helperScripts[session.lane] || 'the run-local helper for this lane'}.`
    ];
  }
  if (session.startupMode === 'lead') {
    return [
      '- startup_mode is lead: you own scoping, teammate dispatch, result review, and phase-transition recommendations for this route.'
    ];
  }
  return [
    '- startup_mode is autonomous: this route allows this lane to proceed from the generated launch prompt and startup packet.'
  ];
}

function safeName(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, '-');
}

function getLane(root, lanePath) {
  return String(lanePath).split('.').reduce((current, part) => current?.[part], root);
}

function titleCase(value) {
  const text = String(value || '');
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

function displayRunId(runId) {
  const parts = String(runId || '').split('-').filter(Boolean);
  return safeName(parts[parts.length - 1] || runId || 'run');
}

function modelDisplayName(adapter, adapterProfile) {
  const names = [adapterDisplayName(adapter), profileDisplayName(adapterProfile)].filter(Boolean);
  return names.join(' ');
}

function adapterDisplayName(adapter) {
  return titleCase(adapter);
}

function profileDisplayName(profile) {
  const text = String(profile || '').trim();
  if (!text) return '';
  if (/^gpt-/i.test(text)) return text.toUpperCase();
  return text
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => titleCase(part))
    .join(' ');
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function shellQuoteIfNeeded(value) {
  return /[^A-Za-z0-9_./:@%+=,-]/.test(String(value)) ? shellQuote(value) : String(value);
}

// Audit §4 E2.2e.5 dogfood port surfaced this gap: launchRun never checked
// whether the requested priority + route already had a non-terminal run in
// flight. The hardened preflight (ported from CoBuilder) prevents accidental
// duplicate launches; `--allow-concurrent-priority-run true` is the explicit
// override.
async function findActiveRunsForPriority({ runsDir, prioritySlug, routeId, excludeRunId } = {}) {
  if (!runsDir || !prioritySlug || !routeId) {
    return { ok: true, status: 'skipped', activeRuns: [], issues: [] };
  }
  let entries = [];
  try {
    entries = await readdir(runsDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return { ok: true, status: 'no-runs-dir', activeRuns: [], issues: [] };
    throw error;
  }

  const activeRuns = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const runId = entry.name;
    if (excludeRunId && runId === excludeRunId) continue;
    const runDir = path.join(runsDir, runId);
    const status = await readJsonIfExists(path.join(runDir, 'status.json'));
    if (!status || isTerminalRunStatusRecord(status)) continue;
    const startupPacket = await readJsonIfExists(path.join(runDir, 'startup-packet.json'));
    const runPrioritySlug = startupPacket?.selectedPriority?.slug || status.prioritySlug || null;
    const runRouteId = status.routeId || startupPacket?.route?.id || null;
    if (runPrioritySlug !== prioritySlug || runRouteId !== routeId) continue;
    activeRuns.push({
      runId,
      runDir,
      status: status.status || 'unknown',
      updatedAt: status.updatedAt || null,
      routeId: runRouteId,
      prioritySlug: runPrioritySlug
    });
  }

  if (activeRuns.length === 0) return { ok: true, status: 'clear', activeRuns, issues: [] };
  const activeSummary = activeRuns.map((run) => `${run.runId} (${run.status})`).join(', ');
  return {
    ok: false,
    status: 'blocked',
    activeRuns,
    issues: [{
      code: 'active-priority-run-exists',
      severity: 'block',
      lane: 'run',
      detail: `Launch blocked because ${prioritySlug} already has non-terminal run(s) on route ${routeId}: ${activeSummary}. Close, adopt, or explicitly relaunch with --allow-concurrent-priority-run true.`
    }]
  };
}

async function readJsonIfExists(filePath) {
  try {
    return await readJson(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    if (/^Invalid JSON\b/.test(error.message || '')) return null;
    throw error;
  }
}
