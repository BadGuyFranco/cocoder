import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { validateInstance, loadContracts } from './contracts.mjs';
import { checkSessionLogHygiene } from '../checks/check-session-log-hygiene.mjs';
import { auditWriteBoundary } from './dispatch.mjs';
import { pathExists, readJson, writeJson } from './fs-utils.mjs';
import { appendRunEvent } from './ledger.mjs';
import { evaluateSupersessionsForRun } from './lead-rescue.mjs';
import { auditDirtyDurableOrchestrationState } from './repo-state.mjs';
import { compactTimestamp, getLane, parseBooleanFlag, safeName } from './lib-utils.mjs';
import { isTerminalRunStatusRecord } from './run-status.mjs';

const execFileAsync = promisify(execFile);
const DIRECT_GIT_PATTERN = /\bgit\b[^\n;&|]*\b(?:add|commit)\b/i;
const NEGATED_DIRECT_GIT_PATTERN = /\b(?:do not|don't|never|must not|may not)\b[^\n]*\bgit\b[^\n;&|]*\b(?:add|commit)\b/i;
// `packages/`, `docs/`, `templates/`, `.github/workflows/` and the root tooling files are
// install-public product surfaces. M4.22 will gate writes to these behind --developer-mode
// once Q1 is answered; until then they remain allowed by default.
// (Legacy upstream paths `cocoder/core/`, `cocoder/scripts/`, `cocoder/tests/` were dropped
// 2026-05-22 — CoCoder code lives under `packages/` and `cocoder/` is the meta-project.)
const DEFAULT_IMPLEMENTATION_SURFACES = [
  'packages/',
  'docs/',
  'templates/',
  '.github/workflows/',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'turbo.json'
];
const DEFAULT_IMPLEMENTATION_EXEMPT_SURFACES = [
  'cocoder/PRIORITIES.md',
  'cocoder/SESSION_LOG.md',
  'cocoder/priorities/zArchive/',
  'cocoder/plans/',
  'cocoder/docs/'
];
const RUN_LOCAL_ARTIFACT_PREFIXES = [
  'cocoder/runs/',
  'cocoder/debug-runs/',
  'cocoder/consult-runs/'
];
const FORBIDDEN_IMPLEMENTATION_COAUTHOR_PATTERN = /^Co-Authored-By:.*(?:Claude|Sonnet|Opus|Anthropic)/im;

// M4.22 / pending-decisions Q1=B — minimal `cocoder-product` deny-gate.
// Writes under these prefixes are blocked unless --developer-mode (or
// COCODER_DEVELOPER_MODE=1) is set. Belt-only; full taxonomy enforcement
// remains Sub-Playbook C scope per ADR-0005 Consequences.
export const COCODER_PRODUCT_WRITE_PREFIXES = Object.freeze([
  'packages/',
  'templates/',
  'docs/',
  '.github/'
]);

export function developerModeEnabled(explicit, env = process.env) {
  if (explicit === false || explicit === 'false' || explicit === '0') return false;
  if (parseBooleanFlag(explicit)) return true;
  return parseBooleanFlag(env?.COCODER_DEVELOPER_MODE);
}

export function auditCocoderProductWriteBelt({ filesChanged = [], developerMode = false } = {}) {
  if (developerMode === true) return { ok: true, issues: [] };
  const violations = filesChanged.filter((filePath) =>
    COCODER_PRODUCT_WRITE_PREFIXES.some((prefix) => {
      const trimmed = prefix.replace(/\/$/, '');
      return filePath === trimmed || filePath.startsWith(prefix);
    })
  );
  if (violations.length === 0) return { ok: true, issues: [] };
  return {
    ok: false,
    issues: [
      issue(
        'cocoder-product-write-blocked',
        `orchestrator-commit refused to mutate CoCoder product paths without developer mode: ${violations.join(', ')}. ` +
        'Pass --developer-mode (or set COCODER_DEVELOPER_MODE=1) to opt in. ' +
        'This belt is intentionally minimal per foundation plan M4.22; full ADR-0005 taxonomy enforcement lands in Sub-Playbook C.',
        { paths: violations }
      )
    ]
  };
}

export async function commitAcceptedResult({
  runDir,
  lane = 'bob',
  repoRoot = process.cwd(),
  contractsDir,
  resultPath,
  message,
  developerMode,
  now = new Date().toISOString(),
  git = realGit,
  env = process.env
} = {}) {
  if (!runDir) throw new Error('runDir is required');
  if (!contractsDir) throw new Error('contractsDir is required');
  if (!repoRoot) throw new Error('repoRoot is required');

  const runId = path.basename(runDir);
  const runStatus = await readJson(path.join(runDir, 'status.json'));
  if (isTerminalRunStatusRecord(runStatus)) {
    return {
      ok: false,
      status: 'blocked',
      runId,
      lane,
      acceptedResultPath: resultPath || path.join(runDir, 'jobs', safeName(lane), 'result.json'),
      stagedPaths: [],
      sha: '',
      evidenceDir: '',
      issues: [issue('terminal-run-locked', `run ${runId} is terminal (${runStatus.status}); start a new route-backed run for new atom work`)]
    };
  }
  const route = await readJson(path.join(runDir, 'route.snapshot.json'));
  const profile = await readJson(path.join(runDir, 'profile.snapshot.json'));
  const launchPlan = await readJson(path.join(runDir, 'launch.json'));
  const startupPacket = await readJson(path.join(runDir, 'startup-packet.json'));
  const acceptedResultPath = resultPath || path.join(runDir, 'jobs', safeName(lane), 'result.json');
  const evidenceDir = path.join(runDir, 'evidence', `orchestrator-commit-${safeName(lane)}-${compactTimestamp(now)}`);
  const attempt = {
    runId,
    lane,
    acceptedResultPath,
    evidenceDir,
    stagedPaths: [],
    boundaryAudit: null,
    commitMessage: '',
    sha: '',
    beforeStatus: '',
    afterStatus: '',
    acceptedSupersession: null,
    issues: []
  };

  const policy = getOrchestratorCommitPolicy(route, lane);
  if (!policy.ok) return fail(attempt, policy.issues, now);

  if (!(await pathExists(acceptedResultPath))) {
    return fail(attempt, [issue('accepted-result-missing', `accepted result does not exist: ${acceptedResultPath}`)], now);
  }

  const result = await readJson(acceptedResultPath);
  const contracts = await loadContracts(contractsDir);
  const resultContract = contracts.get('job-result');
  const contractErrors = validateInstance(resultContract, result);
  if (contractErrors.length > 0) {
    return fail(attempt, [issue('accepted-result-invalid', contractErrors.join('; '))], now);
  }
  const resultAcceptance = await evaluateAcceptedResultForCommit({
    runDir,
    lane,
    acceptedResultPath,
    result
  });
  attempt.acceptedSupersession = resultAcceptance.supersession || null;
  if (!resultAcceptance.ok) return fail(attempt, resultAcceptance.issues, now);

  const normalized = normalizeFilesChanged(result.filesChanged || []);
  if (!normalized.ok) return fail(attempt, normalized.issues, now);
  if (normalized.files.length === 0) {
    return fail(attempt, [issue('no-files-changed', 'accepted result filesChanged contains no committable paths')], now);
  }

  const productWriteBelt = auditCocoderProductWriteBelt({
    filesChanged: normalized.files,
    developerMode: developerModeEnabled(developerMode, env)
  });
  if (!productWriteBelt.ok) return fail(attempt, productWriteBelt.issues, now);

  const implementationAudit = auditImplementationProvenance({
    route,
    profile,
    launchPlan,
    runDir,
    lane,
    acceptedResultPath,
    result,
    filesChanged: normalized.files,
    message
  });
  if (!implementationAudit.ok) return fail(attempt, implementationAudit.issues, now);

  const laneBoundary = resolveLaneBoundary(startupPacket, lane, policy.policy);
  const boundaryAudit = laneBoundary.source === 'orchestrator-commit-policy'
    ? auditPolicyWriteScope({
      allowed: laneBoundary.allowed,
      excluded: laneBoundary.excluded,
      filesChanged: normalized.files
    })
    : auditWriteBoundary({
      allowed: laneBoundary.allowed,
      excluded: laneBoundary.excluded,
      filesChanged: normalized.files
    });
  attempt.boundaryAudit = boundaryAudit;
  if (!boundaryAudit.ok) return fail(attempt, boundaryAudit.issues, now);

  const sessionLogAudit = await auditSessionLogIfChanged({
    repoRoot,
    filesChanged: normalized.files,
    now
  });
  if (!sessionLogAudit.ok) return fail(attempt, sessionLogAudit.issues, now);

  const dirtyOrchestrationAudit = await auditDirtyDurableOrchestrationState({
    repoRoot,
    allowedFiles: normalized.files,
    blockUnstaged: false,
    git
  });
  if (!dirtyOrchestrationAudit.ok) return fail(attempt, dirtyOrchestrationAudit.issues, now);

  attempt.beforeStatus = await git(repoRoot, ['status', '--porcelain=v1']);
  const preexistingStaged = splitLines(await git(repoRoot, ['diff', '--cached', '--name-only']));
  if (preexistingStaged.length > 0) {
    return fail(attempt, [
      issue('preexisting-staged-changes', `unrelated staged changes block orchestrator commit: ${preexistingStaged.join(', ')}`, { paths: preexistingStaged })
    ], now);
  }

  attempt.commitMessage = buildCommitMessage({ message, result, lane });
  await git(repoRoot, ['add', '--', ...normalized.files]);
  attempt.stagedPaths = splitLines(await git(repoRoot, ['diff', '--cached', '--name-only']));
  const outsideStaged = attempt.stagedPaths.filter((filePath) => !normalized.files.includes(filePath));
  if (outsideStaged.length > 0) {
    return fail(attempt, [
      issue('unexpected-staged-path', `git add staged paths outside accepted filesChanged: ${outsideStaged.join(', ')}`, { paths: outsideStaged })
    ], now);
  }
  if (attempt.stagedPaths.length === 0) {
    return fail(attempt, [issue('nothing-staged', 'accepted filesChanged produced no staged changes')], now);
  }

  await git(repoRoot, ['commit', '-m', attempt.commitMessage]);
  attempt.sha = (await git(repoRoot, ['rev-parse', 'HEAD'])).trim();
  attempt.afterStatus = await git(repoRoot, ['status', '--porcelain=v1']);
  await writeAttemptEvidence(attempt, { ok: true, now });
  await appendRunEvent(runDir, {
    type: 'orchestrator.commit',
    runId,
    lane,
    acceptedResultPath,
    stagedPaths: attempt.stagedPaths,
    sha: attempt.sha,
    evidencePath: path.relative(runDir, evidenceDir),
    ...(attempt.acceptedSupersession ? { supersession: attempt.acceptedSupersession } : {}),
    timestamp: now
  });
  return {
    ok: true,
    status: 'committed',
    runId,
    lane,
    acceptedResultPath,
    stagedPaths: attempt.stagedPaths,
    sha: attempt.sha,
    evidenceDir,
    acceptedSupersession: attempt.acceptedSupersession,
    issues: []
  };
}

export async function commitLeadSupportChange({
  runDir,
  lane = 'oscar',
  repoRoot = process.cwd(),
  files = [],
  message,
  reason = '',
  developerMode,
  now = new Date().toISOString(),
  git = realGit,
  env = process.env
} = {}) {
  if (!runDir) throw new Error('runDir is required');
  if (!repoRoot) throw new Error('repoRoot is required');

  const runId = path.basename(runDir);
  const runStatus = await readJson(path.join(runDir, 'status.json'));
  const evidenceDir = path.join(runDir, 'evidence', `lead-support-commit-${safeName(lane)}-${compactTimestamp(now)}`);
  const attempt = {
    runId,
    lane,
    acceptedResultPath: 'lead-support-commit',
    evidenceDir,
    stagedPaths: [],
    boundaryAudit: null,
    commitMessage: '',
    sha: '',
    beforeStatus: '',
    afterStatus: '',
    acceptedSupersession: null,
    issues: [],
    reason
  };

  if (isTerminalRunStatusRecord(runStatus)) {
    return fail(attempt, [issue('terminal-run-locked', `run ${runId} is terminal (${runStatus.status}); start a new route-backed run for support work`)], now);
  }

  const route = await readJson(path.join(runDir, 'route.snapshot.json'));
  const policy = getLeadSupportCommitPolicy(route, lane);
  if (!policy.ok) return fail(attempt, policy.issues, now);

  const normalized = normalizeFilesChanged(files);
  if (!normalized.ok) return fail(attempt, normalized.issues, now);
  if (normalized.files.length === 0) {
    return fail(attempt, [issue('no-files-changed', 'lead-support-commit requires one or more exact files')], now);
  }

  const productWriteBelt = auditCocoderProductWriteBelt({
    filesChanged: normalized.files,
    developerMode: developerModeEnabled(developerMode, env)
  });
  if (!productWriteBelt.ok) return fail(attempt, productWriteBelt.issues, now);

  const boundaryAudit = auditPolicyWriteScope({
    allowed: policy.policy.allowed,
    excluded: policy.policy.excluded || [],
    filesChanged: normalized.files
  });
  attempt.boundaryAudit = boundaryAudit;
  if (!boundaryAudit.ok) return fail(attempt, boundaryAudit.issues, now);

  const dirtyOrchestrationAudit = await auditDirtyDurableOrchestrationState({
    repoRoot,
    allowedFiles: normalized.files,
    // Audit §4 E2.2e.6 dogfood port surfaced this gap: `commitLeadSupportChange`
    // is bounded by design — it commits only the explicitly-allowed `files`.
    // Unrelated *unstaged* dirty work elsewhere in the durable-orchestration
    // surface (e.g., the founder editing PRIORITIES.md mid-session) must not
    // block a bounded support commit. The peer function `commitAcceptedResult`
    // above (line 213) already passes `blockUnstaged: false` for the same
    // reason. Staged conflicts (`preexistingStaged` check below) still block.
    blockUnstaged: false,
    git
  });
  if (!dirtyOrchestrationAudit.ok) return fail(attempt, dirtyOrchestrationAudit.issues, now);

  attempt.beforeStatus = await git(repoRoot, ['status', '--porcelain=v1']);
  const preexistingStaged = splitLines(await git(repoRoot, ['diff', '--cached', '--name-only']));
  if (preexistingStaged.length > 0) {
    return fail(attempt, [
      issue('preexisting-staged-changes', `unrelated staged changes block lead support commit: ${preexistingStaged.join(', ')}`, { paths: preexistingStaged })
    ], now);
  }

  attempt.commitMessage = buildLeadSupportCommitMessage({ message, lane, reason });
  await git(repoRoot, ['add', '--', ...normalized.files]);
  attempt.stagedPaths = splitLines(await git(repoRoot, ['diff', '--cached', '--name-only']));
  const outsideStaged = attempt.stagedPaths.filter((filePath) => !normalized.files.includes(filePath));
  if (outsideStaged.length > 0) {
    return fail(attempt, [
      issue('unexpected-staged-path', `git add staged paths outside requested support files: ${outsideStaged.join(', ')}`, { paths: outsideStaged })
    ], now);
  }
  if (attempt.stagedPaths.length === 0) {
    return fail(attempt, [issue('nothing-staged', 'requested support files produced no staged changes')], now);
  }

  await git(repoRoot, ['commit', '-m', attempt.commitMessage]);
  attempt.sha = (await git(repoRoot, ['rev-parse', 'HEAD'])).trim();
  attempt.afterStatus = await git(repoRoot, ['status', '--porcelain=v1']);
  await writeAttemptEvidence(attempt, { ok: true, now });
  await appendRunEvent(runDir, {
    type: 'lead-support.commit',
    runId,
    lane,
    reason,
    stagedPaths: attempt.stagedPaths,
    sha: attempt.sha,
    evidencePath: path.relative(runDir, evidenceDir),
    timestamp: now
  });
  return {
    ok: true,
    status: 'committed',
    runId,
    lane,
    reason,
    stagedPaths: attempt.stagedPaths,
    sha: attempt.sha,
    evidenceDir,
    issues: []
  };
}

export function evaluateLaneGitPolicy({ route, lane, command }) {
  const policy = getOrchestratorCommitPolicy(route, lane);
  if (!policy.ok) return { ok: true, status: 'not-applicable', issues: [] };
  if (containsForbiddenDirectGit(String(command || ''))) {
    return {
      ok: false,
      status: 'policy-violation',
      issues: [
        issue('lane-direct-git-forbidden', `lane ${lane} may not run git add or git commit when route ${route.id} declares orchestrator-owned commits`)
      ]
    };
  }
  return { ok: true, status: 'allowed', issues: [] };
}

function containsForbiddenDirectGit(command) {
  return String(command || '')
    .split('\n')
    .some((line) => DIRECT_GIT_PATTERN.test(line) && !NEGATED_DIRECT_GIT_PATTERN.test(line));
}

export function getOrchestratorCommitPolicy(route, lane) {
  const policy = route?.orchestratorCommit;
  if (!policy || policy.enabled !== true) {
    return {
      ok: false,
      issues: [issue('route-orchestrator-commit-not-declared', `route ${route?.id || 'unknown'} does not declare orchestrator-owned commits`)]
    };
  }
  if (policy.owner !== 'route') {
    return { ok: false, issues: [issue('orchestrator-commit-owner-invalid', 'orchestratorCommit.owner must be route')] };
  }
  if (!Array.isArray(policy.writerLanes) || !policy.writerLanes.includes(lane)) {
    return { ok: false, issues: [issue('orchestrator-commit-lane-not-declared', `lane ${lane} is not declared for orchestrator-owned commits`)] };
  }
  if (policy.stageMode !== 'exact-files') {
    return { ok: false, issues: [issue('orchestrator-commit-stage-mode-invalid', 'orchestratorCommit.stageMode must be exact-files')] };
  }
  return { ok: true, policy, issues: [] };
}

export function getLeadSupportCommitPolicy(route, lane) {
  const policy = route?.leadSupportCommit;
  if (!policy || policy.enabled !== true) {
    return {
      ok: false,
      issues: [issue('route-lead-support-commit-not-declared', `route ${route?.id || 'unknown'} does not declare lead support commits`)]
    };
  }
  if (!Array.isArray(policy.leads) || !policy.leads.includes(lane)) {
    return { ok: false, issues: [issue('lead-support-commit-lane-not-declared', `lane ${lane} is not declared for lead support commits`)] };
  }
  if (policy.stageMode !== 'exact-files') {
    return { ok: false, issues: [issue('lead-support-commit-stage-mode-invalid', 'leadSupportCommit.stageMode must be exact-files')] };
  }
  if (!Array.isArray(policy.allowed) || policy.allowed.length === 0) {
    return { ok: false, issues: [issue('lead-support-commit-allowed-missing', 'leadSupportCommit.allowed must list support write scopes')] };
  }
  if ('excluded' in policy && !Array.isArray(policy.excluded)) {
    return { ok: false, issues: [issue('lead-support-commit-excluded-invalid', 'leadSupportCommit.excluded must be an array when present')] };
  }
  return { ok: true, policy, issues: [] };
}

async function fail(attempt, issues, now) {
  attempt.issues = issues;
  try {
    if (!attempt.beforeStatus) {
      attempt.beforeStatus = '';
    }
    await writeAttemptEvidence(attempt, { ok: false, now });
  } catch {
    // Preserve the primary failure. Evidence best-effort failures are visible
    // through the missing evidence path in the returned result.
  }
  return {
    ok: false,
    status: 'blocked',
    runId: attempt.runId,
    lane: attempt.lane,
    acceptedResultPath: attempt.acceptedResultPath,
    stagedPaths: attempt.stagedPaths,
    sha: '',
    evidenceDir: attempt.evidenceDir,
    issues
  };
}

async function writeAttemptEvidence(attempt, { ok, now }) {
  await mkdir(attempt.evidenceDir, { recursive: true });
  await writeFile(path.join(attempt.evidenceDir, 'accepted-result-path.txt'), `${attempt.acceptedResultPath}\n`);
  await writeJson(path.join(attempt.evidenceDir, 'staged-files.json'), attempt.stagedPaths);
  await writeJson(path.join(attempt.evidenceDir, 'boundary-audit.json'), attempt.boundaryAudit || { ok: false, issues: attempt.issues, filesChanged: [] });
  await writeFile(path.join(attempt.evidenceDir, 'commit-message.txt'), `${attempt.commitMessage}\n`);
  if (attempt.sha) await writeFile(path.join(attempt.evidenceDir, 'commit-sha.txt'), `${attempt.sha}\n`);
  await writeFile(path.join(attempt.evidenceDir, 'git-status-before.txt'), attempt.beforeStatus || '');
  await writeFile(path.join(attempt.evidenceDir, 'git-status-after.txt'), attempt.afterStatus || '');
  await writeJson(path.join(attempt.evidenceDir, 'summary.json'), {
    ok,
    runId: attempt.runId,
    lane: attempt.lane,
    acceptedResultPath: attempt.acceptedResultPath,
    stagedPaths: attempt.stagedPaths,
    sha: attempt.sha,
    acceptedSupersession: attempt.acceptedSupersession,
    issues: attempt.issues,
    createdAt: now
  });
}

async function evaluateAcceptedResultForCommit({ runDir, lane, acceptedResultPath, result }) {
  if (result.status === 'PASS') return { ok: true, issues: [], supersession: null };

  const supersessions = await evaluateSupersessionsForRun({ runDir });
  const covering = supersessions.valid.find((candidate) =>
    candidate.record.supersededLane === lane
    && resolveRunPath(runDir, candidate.record.supersededResultPath) === path.resolve(acceptedResultPath)
  );
  if (covering) {
    return {
      ok: true,
      issues: [],
      supersession: {
        id: covering.record.id,
        supersededLane: covering.record.supersededLane,
        resolvingLane: covering.record.resolvingLane,
        authorizationBasis: covering.record.authorizationBasis,
        recordPath: path.relative(runDir, covering.recordPath)
      }
    };
  }

  const invalidCovering = supersessions.invalid.find((candidate) =>
    candidate.record?.supersededLane === lane
    && resolveRunPath(runDir, candidate.record?.supersededResultPath) === path.resolve(acceptedResultPath)
  );
  if (invalidCovering) {
    return {
      ok: false,
      supersession: null,
      issues: invalidCovering.issues.map((item) => issue(
        `invalid-supersession-${item.code}`,
        `accepted result ${acceptedResultPath} has invalid supersession ${invalidCovering.recordPath}: ${item.detail}`,
        { supersessionRecordPath: invalidCovering.recordPath }
      ))
    };
  }

  return {
    ok: false,
    supersession: null,
    issues: [issue('accepted-result-not-pass', `accepted result status must be PASS or covered by a valid supersession, got ${result.status}`)]
  };
}

function commitTrailerDomain() {
  const raw = process.env.COCODER_ORCH_COMMIT_TRAILER_DOMAIN;
  if (typeof raw === 'string' && raw.trim() !== '') return raw.trim();
  return 'cocoder.local';
}

function buildCommitMessage({ message, result, lane }) {
  const base = String(message || `[ORCHESTRATION] Commit ${lane} accepted result`).trim();
  const persona = safeName(result.persona || lane);
  const adapter = safeName(result.adapter || 'adapter');
  const domain = commitTrailerDomain();
  return [
    base,
    '',
    `Co-Authored-By: ${titleCase(persona)} (${adapter}) <${persona}-${adapter}@${domain}>`
  ].join('\n');
}

function buildLeadSupportCommitMessage({ message, lane, reason }) {
  const base = String(message || '[ORCH] Lead support commit').trim();
  const domain = commitTrailerDomain();
  return [
    base,
    '',
    `Support-Reason: ${String(reason || 'bounded orchestration support work').trim()}`,
    `Co-Authored-By: ${titleCase(safeName(lane))} (lead-support) <${safeName(lane)}-lead-support@${domain}>`
  ].join('\n');
}

function normalizeFilesChanged(filesChanged) {
  const issues = [];
  const files = [];
  for (const value of filesChanged) {
    if (value === 'none') continue;
    if (typeof value !== 'string' || value.trim() === '') {
      issues.push(issue('invalid-files-changed-path', 'filesChanged entries must be non-empty strings'));
      continue;
    }
    const normalized = value.replace(/\\/g, '/').split(path.sep).join('/').replace(/^\.\//, '').replace(/\/+/g, '/');
    if (path.isAbsolute(value) || normalized === '.' || normalized.startsWith('../') || normalized.includes('/../')) {
      issues.push(issue('unsafe-files-changed-path', `${value} must be a repo-relative path`));
      continue;
    }
    if (/[*?[\]{}]/.test(normalized)) {
      issues.push(issue('glob-path-not-allowed', `${value} is not an exact file path`));
      continue;
    }
    if (RUN_LOCAL_ARTIFACT_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
      issues.push(issue('run-local-artifact-not-committable', `${value} is a run-local orchestration artifact; commit durable source/status files only`));
      continue;
    }
    files.push(normalized);
  }
  return { ok: issues.length === 0, files: [...new Set(files)], issues };
}

function resolveLaneBoundary(startupPacket, lane, policy) {
  const policyScope = policy?.laneWriteScopes?.[lane];
  if (policyScope) {
    return {
      source: 'orchestrator-commit-policy',
      allowed: policyScope.allowed || [],
      excluded: policyScope.excluded || []
    };
  }
  const laneBoundary = startupPacket?.resolvedWriteBoundary?.laneBoundaries?.[lane];
  if (laneBoundary) {
    return {
      source: 'startup-packet-lane-boundary',
      allowed: laneBoundary.allowed || [],
      excluded: laneBoundary.excluded || []
    };
  }
  return {
    source: 'startup-packet-default-boundary',
    allowed: startupPacket?.writeBoundaries || [],
    excluded: startupPacket?.resolvedWriteBoundary?.excludedWriteBoundaries || []
  };
}

function auditImplementationProvenance({ route, profile, launchPlan, runDir, lane, acceptedResultPath, result, filesChanged, message }) {
  const policy = route?.implementationOwnership || {};
  if (policy.enabled === false) return { ok: true, issues: [] };
  const surfaces = Array.isArray(policy.surfaces) && policy.surfaces.length > 0
    ? policy.surfaces
    : DEFAULT_IMPLEMENTATION_SURFACES;
  const exemptSurfaces = Array.isArray(policy.exemptSurfaces)
    ? [...DEFAULT_IMPLEMENTATION_EXEMPT_SURFACES, ...policy.exemptSurfaces]
    : DEFAULT_IMPLEMENTATION_EXEMPT_SURFACES;
  const implementationFiles = filesChanged.filter((filePath) =>
    matchesAnyScope(filePath, surfaces) && !matchesAnyScope(filePath, exemptSurfaces)
  );
  if (implementationFiles.length === 0) return { ok: true, issues: [] };

  const ownerLane = policy.ownerLane || 'bob';
  const expectedLane = getLane(profile?.lanes, ownerLane);
  const launchSession = (launchPlan?.sessions || []).find((session) => session.lane === ownerLane);
  const issues = [];

  if (lane !== ownerLane) {
    issues.push(issue('implementation-owner-lane-required', `implementation files require lane ${ownerLane}, got ${lane}`, { paths: implementationFiles }));
  }
  if (!expectedLane) {
    issues.push(issue('implementation-owner-profile-missing', `profile snapshot does not define implementation owner lane ${ownerLane}`));
  }
  if (!launchSession) {
    issues.push(issue('implementation-owner-launch-session-missing', `launch plan does not define implementation owner lane ${ownerLane}`));
  }

  const expectedPersona = expectedLane?.persona || ownerLane;
  const expectedAdapter = expectedLane?.adapter;
  const expectedAdapterProfile = expectedLane?.adapterProfile || '';
  if (result.persona !== expectedPersona) {
    issues.push(issue('implementation-result-persona-mismatch', `implementation result persona must be ${expectedPersona}, got ${result.persona}`));
  }
  if (expectedAdapter && result.adapter !== expectedAdapter) {
    issues.push(issue('implementation-result-adapter-mismatch', `implementation result adapter must be ${expectedAdapter}, got ${result.adapter}`));
  }
  if (launchSession && expectedAdapter && launchSession.adapter !== expectedAdapter) {
    issues.push(issue('implementation-launch-adapter-mismatch', `implementation launch adapter must be ${expectedAdapter}, got ${launchSession.adapter}`));
  }
  if (launchSession && launchSession.adapterProfile !== expectedAdapterProfile) {
    issues.push(issue('implementation-launch-adapter-profile-mismatch', `implementation launch adapterProfile must be ${expectedAdapterProfile || '<empty>'}, got ${launchSession.adapterProfile || '<empty>'}`));
  }

  const canonicalResultPath = path.resolve(runDir, 'jobs', safeName(ownerLane), 'result.json');
  if (path.resolve(acceptedResultPath) !== canonicalResultPath) {
    issues.push(issue('implementation-result-artifact-mismatch', `implementation commits must use the configured ${ownerLane} result artifact at ${canonicalResultPath}`));
  }
  if (FORBIDDEN_IMPLEMENTATION_COAUTHOR_PATTERN.test(String(message || ''))) {
    issues.push(issue('implementation-forbidden-coauthor', 'implementation commit message contains a Claude/Sonnet/Opus/Anthropic Co-Authored-By line'));
  }

  return { ok: issues.length === 0, issues };
}

function auditPolicyWriteScope({ allowed = [], excluded = [], filesChanged = [] }) {
  const issues = [];
  if (!Array.isArray(allowed) || allowed.length === 0) {
    issues.push(issue('missing-write-boundary', 'writer lane has no allowed write scope'));
  }
  for (const filePath of filesChanged) {
    if (!matchesAnyScope(filePath, allowed)) {
      issues.push(issue('out-of-bound-path', `${filePath} is outside allowed write scope`));
    }
    if (matchesAnyScope(filePath, excluded)) {
      issues.push(issue('excluded-path-changed', `${filePath} is explicitly excluded from write scope`));
    }
  }
  return { ok: issues.length === 0, allowed, excluded, filesChanged, issues };
}

function matchesAnyScope(filePath, scopes) {
  return scopes.some((scope) => matchesScope(filePath, scope));
}

function matchesScope(filePath, scope) {
  const normalizedPath = normalizeScope(filePath);
  const normalizedScope = normalizeScope(scope);
  if (normalizedScope.includes('*')) return globToRegExp(normalizedScope).test(normalizedPath);
  return normalizedPath === normalizedScope || normalizedPath.startsWith(`${normalizedScope}/`);
}

function globToRegExp(scope) {
  const escaped = scope.split('*').map((part) => part.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')).join('[^/]*');
  return new RegExp(`^${escaped}$`);
}

function normalizeScope(value) {
  return String(value).split(path.sep).join('/').replace(/\/+$/g, '');
}

async function auditSessionLogIfChanged({ repoRoot, filesChanged, now }) {
  const touchesSessionLog = filesChanged.some((filePath) => filePath === 'cocoder/SESSION_LOG.md');
  if (!touchesSessionLog) return { ok: true, issues: [] };
  const report = await checkSessionLogHygiene({
    root: repoRoot,
    now
  });
  if (report.ok) return { ok: true, issues: [] };
  return {
    ok: false,
    issues: report.findings.map((finding) => issue(
      `session-log-hygiene-${finding.kind}`,
      `${finding.file}${finding.line ? `:${finding.line}` : ''} violates SESSION_LOG hygiene: ${finding.expected}`,
      { finding }
    ))
  };
}

async function realGit(repoRoot, args) {
  const result = await execFileAsync('git', ['-C', repoRoot, ...args], { maxBuffer: 1024 * 1024 });
  return result.stdout;
}

function splitLines(value) {
  return String(value || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function resolveRunPath(runDir, value) {
  return path.isAbsolute(value || '') ? path.resolve(value) : path.resolve(runDir, value || '');
}

function issue(code, detail, extra = {}) {
  return { code, severity: 'block', detail, ...extra };
}

function titleCase(value) {
  const text = String(value || '');
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}
