import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { readJson, writeJson } from './fs-utils.mjs';
import { launchRun } from './launch.mjs';
import { appendEvent } from './ledger.mjs';
import { parsePorcelainStatus } from './repo-state.mjs';
import { isTerminalRunStatusRecord } from './run-status.mjs';

const execFileAsync = promisify(execFile);

export async function processRunContinuation({
  runDir,
  repoRoot = process.cwd(),
  contractsDir,
  adaptersDir,
  runsDir,
  profilesDir,
  routesDir,
  priorityBoundariesDir,
  priorityFile,
  sessionLogFile,
  tmuxBin,
  execute = true,
  launch = launchRun,
  gitStatus = realGitStatus
} = {}) {
  if (!runDir) throw new Error('runDir is required');

  const artifactPath = path.join(runDir, 'continuation.json');
  const status = await readJson(path.join(runDir, 'status.json'));
  const launchPlan = await readJson(path.join(runDir, 'launch.json'));
  const leadLane = launchPlan.route?.lead || 'oscar';
  const leadSession = (launchPlan.sessions || []).find((session) => session.lane === leadLane);
  const now = new Date().toISOString();

  if (!isTerminalRunStatusRecord(status)) {
    return writeContinuation({
      artifactPath,
      artifact: baseArtifact({ status: 'skipped', reason: 'run is not terminal', runDir, launchPlan, leadLane, now })
    });
  }
  if (!leadSession?.resultPath) {
    return writeContinuation({
      artifactPath,
      artifact: baseArtifact({ status: 'blocked', reason: `lead lane ${leadLane} has no result path in launch.json`, runDir, launchPlan, leadLane, now })
    });
  }

  const leadResult = await readJson(leadSession.resultPath);
  const requested = normalizeContinuationRequest(leadResult.continuation);
  if (!requested) {
    return writeContinuation({
      artifactPath,
      artifact: baseArtifact({ status: 'skipped', reason: 'lead result did not request continuation', runDir, launchPlan, leadLane, now })
    });
  }

  const validationIssues = validateContinuationRequest({ requested, leadResult, launchPlan });
  if (validationIssues.length > 0) {
    return writeContinuation({
      artifactPath,
      artifact: {
        ...baseArtifact({ status: 'blocked', reason: validationIssues[0].detail, runDir, launchPlan, leadLane, now }),
        requested,
        issues: validationIssues
      }
    });
  }

  const gitAudit = await auditContinuationGitState({ repoRoot, gitStatus });
  if (!gitAudit.ok && requested.allowUnstaged !== true) {
    return writeContinuation({
      artifactPath,
      artifact: {
        ...baseArtifact({ status: 'blocked', reason: gitAudit.issues[0].detail, runDir, launchPlan, leadLane, now }),
        requested,
        gitAudit
      }
    });
  }
  if (gitAudit.stagedFiles.length > 0) {
    return writeContinuation({
      artifactPath,
      artifact: {
        ...baseArtifact({ status: 'blocked', reason: `staged files block continuation: ${gitAudit.stagedFiles.join(', ')}`, runDir, launchPlan, leadLane, now }),
        requested,
        gitAudit
      }
    });
  }

  const stopResult = {
    ok: true,
    executed: false,
    status: 'skipped',
    reason: 'continuation never tears down the current run; teardown requires explicit founder kill/teardown approval'
  };

  const launchOptions = buildLaunchOptions({
    requested,
    launchPlan,
    repoRoot,
    contractsDir,
    adaptersDir,
    runsDir,
    profilesDir,
    routesDir,
    priorityBoundariesDir,
    priorityFile,
    sessionLogFile,
    tmuxBin,
    execute
  });
  const launchResult = await launch(launchOptions);
  const artifactStatus = launchResult.ok ? 'launched' : 'blocked';
  const artifact = {
    ...baseArtifact({
      status: artifactStatus,
      reason: launchResult.ok ? 'fresh run launched' : 'fresh run launch failed',
      runDir,
      launchPlan,
      leadLane,
      now
    }),
    requested,
    gitAudit,
    stopResult,
    launchOptions: publicLaunchOptions(launchOptions),
    launchResult
  };
  const result = await writeContinuation({ artifactPath, artifact });
  await appendEvent(runDir, {
    type: 'run.continuation.processed',
    status: artifactStatus,
    reason: artifact.reason,
    continuationPath: path.relative(runDir, artifactPath),
    nextRunId: launchResult.runId || null,
    nextRunDir: launchResult.runDir || null
  });
  return result;
}

export async function auditContinuationGitState({ repoRoot = process.cwd(), gitStatus = realGitStatus } = {}) {
  let porcelain = '';
  try {
    porcelain = await gitStatus(repoRoot);
  } catch (error) {
    return {
      ok: false,
      porcelain: '',
      dirtyFiles: [],
      stagedFiles: [],
      issues: [{
        code: 'git-status-failed',
        severity: 'block',
        detail: error.message || String(error)
      }]
    };
  }
  const entries = parsePorcelainStatus(porcelain)
    .flatMap((entry) => entry.paths.map((filePath) => ({ ...entry, path: filePath })));
  const dirtyFiles = [...new Set(entries.map((entry) => entry.path))];
  const stagedFiles = [...new Set(entries
    .filter((entry) => (String(entry.status || '  ')[0] || ' ') !== ' ')
    .map((entry) => entry.path))];
  const issues = [];
  if (stagedFiles.length > 0) {
    issues.push({
      code: 'staged-worktree-state',
      severity: 'block',
      detail: `staged files block continuation: ${stagedFiles.join(', ')}`,
      paths: stagedFiles
    });
  }
  if (dirtyFiles.length > 0) {
    issues.push({
      code: 'dirty-worktree-state',
      severity: 'block',
      detail: `dirty files block continuation unless continuation.allowUnstaged is true: ${dirtyFiles.join(', ')}`,
      paths: dirtyFiles
    });
  }
  return {
    ok: issues.length === 0,
    porcelain,
    entries,
    dirtyFiles,
    stagedFiles,
    issues
  };
}

function normalizeContinuationRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return {
    action: value.action,
    prioritySlug: value.prioritySlug,
    routeId: value.routeId,
    profileId: value.profileId,
    nextAtom: value.nextAtom,
    reason: value.reason,
    requiresFounder: value.requiresFounder === true,
    stopCurrentRunPanes: value.stopCurrentRunPanes,
    allowUnstaged: value.allowUnstaged === true,
    execute: value.execute,
    deferStart: value.deferStart,
    runId: value.runId,
    profilePath: value.profilePath,
    routePath: value.routePath,
    tmuxBin: value.tmuxBin
  };
}

function validateContinuationRequest({ requested, leadResult, launchPlan }) {
  const issues = [];
  if (leadResult.status !== 'PASS') {
    issues.push(issue('non-pass-lead-result', `lead result status ${leadResult.status} cannot request continuation`));
  }
  if (requested.requiresFounder) {
    issues.push(issue('founder-required', 'continuation requires founder input'));
  }
  if (requested.action !== 'launch-fresh-run') {
    issues.push(issue('unsupported-continuation-action', `unsupported continuation action: ${requested.action || 'missing'}`));
  }
  if (!requested.prioritySlug) issues.push(issue('missing-priority-slug', 'continuation.prioritySlug is required'));
  if (!requested.routeId) issues.push(issue('missing-route-id', 'continuation.routeId is required'));
  if (!requested.nextAtom) issues.push(issue('missing-next-atom', 'continuation.nextAtom is required'));
  if (!requested.reason) issues.push(issue('missing-reason', 'continuation.reason is required'));
  if (requested.routeId && launchPlan.route?.id && requested.routeId !== launchPlan.route.id) {
    issues.push(issue('route-switch-not-supported', `continuation route ${requested.routeId} does not match current route ${launchPlan.route.id}`));
  }
  return issues;
}

function buildLaunchOptions({
  requested,
  launchPlan,
  repoRoot,
  contractsDir,
  adaptersDir,
  runsDir,
  profilesDir,
  routesDir,
  priorityBoundariesDir,
  priorityFile,
  sessionLogFile,
  tmuxBin,
  execute
}) {
  const profileId = requested.profileId || launchPlan.profile?.id || 'active';
  const routeId = requested.routeId || launchPlan.route?.id;
  return {
    contractsDir,
    adaptersDir,
    runsDir,
    runId: requested.runId,
    profilePath: requested.profilePath || launchPlan.sourcePaths?.profilePath || path.join(profilesDir, `${profileId}.profile.json`),
    routePath: requested.routePath || launchPlan.sourcePaths?.routePath || path.join(routesDir, `${routeId}.json`),
    priorityFile,
    prioritySlug: requested.prioritySlug,
    priorityBoundariesDir,
    sessionLogFile,
    sessionLineLimit: 80,
    socketName: launchPlan.socketName,
    socketPath: launchPlan.socketPath,
    tmuxBin: requested.tmuxBin || tmuxBin || launchPlan.tmuxBin,
    deferStart: requested.deferStart === true,
    execute: execute !== false && requested.execute !== false,
    cwd: repoRoot,
    env: { PATH: process.env.PATH || '' }
  };
}

function publicLaunchOptions(options) {
  return {
    runId: options.runId || null,
    profilePath: options.profilePath,
    routePath: options.routePath,
    prioritySlug: options.prioritySlug,
    socketName: options.socketName,
    socketPath: options.socketPath,
    deferStart: options.deferStart,
    execute: options.execute
  };
}

function baseArtifact({ status, reason, runDir, launchPlan, leadLane, now }) {
  return {
    version: 1,
    ok: status === 'launched' || status === 'skipped',
    status,
    reason,
    runId: launchPlan.runId || path.basename(runDir),
    runDir,
    leadLane,
    createdAt: now
  };
}

async function writeContinuation({ artifactPath, artifact }) {
  await writeJson(artifactPath, artifact);
  return { ...artifact, artifactPath };
}

function issue(code, detail) {
  return { code, severity: 'block', detail };
}

async function realGitStatus(repoRoot) {
  const result = await execFileAsync('git', ['-C', repoRoot, 'status', '--porcelain=v1'], { maxBuffer: 1024 * 1024 });
  return result.stdout;
}
