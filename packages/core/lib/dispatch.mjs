import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { loadContracts, validateInstance } from './contracts.mjs';
import { pathExists, readJson, writeJson } from './fs-utils.mjs';
import { validateOscarPassResultArtifacts } from './ledger.mjs';

const ACCEPTING_STATUS = 'PASS';
const NON_ACCEPTING_STATUSES = new Set(['BLOCK', 'CONDITIONAL_PASS', 'NEEDS_FOUNDER', 'FAILED']);
const CONFIDENCE_PATTERNS = [/bob confidence/i, /confidence\s*:/i, /builder confidence/i, /i am confident/i];

export function generateDispatchNonce() {
  return randomUUID();
}

export function validateDispatchNonce(expected, actual) {
  return typeof expected === 'string' && expected.length > 0 && expected === actual;
}

export async function acquireDispatchLock({ lockPath, owner, nonce = generateDispatchNonce(), now = new Date().toISOString(), ttlMs = 300000 }) {
  const current = await readOptionalJson(lockPath);
  if (current) {
    const stale = isLockStale(current, now, ttlMs);
    if (!stale) {
      return {
        ok: false,
        status: 'busy',
        reason: `lock held by ${current.owner || 'unknown'}`,
        lock: current,
        recovery: 'wait-or-timeout'
      };
    }
  }

  const lock = {
    owner,
    nonce,
    acquiredAt: now,
    updatedAt: now,
    ttlMs,
    staleReplacementOf: current ? { owner: current.owner, nonce: current.nonce, updatedAt: current.updatedAt } : null
  };
  await writeJson(lockPath, lock);
  return { ok: true, status: current ? 'recovered-stale-lock' : 'locked', lock, recovery: current ? 'replace-stale-lock' : 'none' };
}

export async function releaseDispatchLock({ lockPath, owner, nonce }) {
  const current = await readOptionalJson(lockPath);
  if (!current) return { ok: false, status: 'missing-lock', reason: 'lock file does not exist' };
  if (current.owner !== owner || !validateDispatchNonce(current.nonce, nonce)) {
    return { ok: false, status: 'nonce-mismatch', reason: 'owner or nonce did not match lock' };
  }
  await rm(lockPath);
  return { ok: true, status: 'released' };
}

export async function checkDispatchLock({ lockPath, now = new Date().toISOString(), staleMs = 300000 }) {
  const lock = await readOptionalJson(lockPath);
  if (!lock) return { ok: true, status: 'unlocked', recovery: 'none' };
  if (isLockStale(lock, now, staleMs)) {
    return { ok: false, status: 'stale-lock', lock, recovery: 'replace-stale-lock' };
  }
  return { ok: false, status: 'locked', lock, recovery: 'wait-or-timeout' };
}

export async function classifyTeammateState({ statePath, now = new Date().toISOString(), timeoutMs = 300000 }) {
  const state = await readJson(statePath);
  return classifyTeammate(state, { now, timeoutMs });
}

export function classifyTeammate(state, { now = new Date().toISOString(), timeoutMs = 300000 } = {}) {
  const artifacts = state.captureArtifacts || [];
  if (state.status === 'dead' || state.alive === false) {
    return { ok: false, status: 'dead', teammate: state.id, captureArtifacts: artifacts, recovery: 'restart-required' };
  }
  if (state.status === 'busy') {
    const stale = isTimestampStale(state.lastSeenAt, now, timeoutMs);
    return {
      ok: false,
      status: stale ? 'timeout' : 'busy',
      teammate: state.id,
      activeJobId: state.activeJobId || '',
      captureArtifacts: artifacts,
      recovery: stale ? 'capture-and-abort-or-restart' : 'wait'
    };
  }
  if (state.status === 'idle') {
    return { ok: true, status: 'idle', teammate: state.id, captureArtifacts: artifacts, recovery: 'none' };
  }
  return { ok: false, status: 'unknown', teammate: state.id, captureArtifacts: artifacts, recovery: 'inspect-state' };
}

export function validateHelperPolicy(plan) {
  const helpers = plan.helpers || [];
  const maxParallel = plan.maxParallelHelpers ?? helpers.length;
  const issues = [];
  if (helpers.length > maxParallel) {
    issues.push(issue('max-parallel-exceeded', `helpers=${helpers.length} maxParallelHelpers=${maxParallel}`));
  }

  const writeHelpers = helpers.filter((helper) => helper.canWrite === true);
  for (const helper of helpers) {
    if (helper.type === 'readonlyResearch' && helper.canWrite === true) {
      issues.push(issue('readonly-research-can-write', `${helper.id} readonly research helper must be read-only`));
    }
    if (helper.type === 'implementation' && helper.resultContract !== 'job-result') {
      issues.push(issue('implementation-result-contract', `${helper.id} implementation helper must use job-result`));
    }
    if (helper.sameModelDefault !== true && helper.adapter !== plan.leadAdapter && !helper.adapterOverrideReason) {
      issues.push(issue('same-model-default-missing', `${helper.id} differs from lead adapter without override reason`));
    }
  }
  for (let index = 0; index < writeHelpers.length; index += 1) {
    for (let next = index + 1; next < writeHelpers.length; next += 1) {
      if (scopesOverlap(writeHelpers[index].writeBoundary || [], writeHelpers[next].writeBoundary || [])) {
        issues.push(issue('helper-write-scope-overlap', `${writeHelpers[index].id} overlaps ${writeHelpers[next].id}`));
      }
    }
  }
  if (writeHelpers.length > 0 && plan.leadIntegrationResponsibility !== true) {
    issues.push(issue('missing-lead-integration', 'lead must own integration of helper output'));
  }
  return { ok: issues.length === 0, issues };
}

export function auditWriteBoundary({ allowed = [], excluded = [], filesChanged = [], mode = 'task-scoped' }) {
  const issues = [];
  if (mode === 'read-only' && filesChanged.length > 0) {
    issues.push(issue('read-only-changed-files', 'read-only lane reported file changes'));
  }
  for (const filePath of filesChanged) {
    if (matchesAny(filePath, excluded)) {
      issues.push(issue('excluded-path-changed', `${filePath} matches excluded scope`));
    }
    if (allowed.length > 0 && !matchesAny(filePath, allowed)) {
      issues.push(issue('out-of-bound-path', `${filePath} is outside allowed scopes`));
    }
  }
  return { ok: issues.length === 0, issues, filesChanged };
}

export function validateVerifierPacket(packet) {
  const issues = [];
  if (packet.canWrite !== false || packet.writePolicy !== 'read-only') {
    issues.push(issue('verifier-write-violation', 'verifier packet must be read-only with canWrite=false'));
  }
  for (const field of ['specScope', 'diffScope', 'artifactScope']) {
    if (!Array.isArray(packet[field]) || packet[field].length === 0) {
      issues.push(issue('missing-verifier-scope', `${field} must be a non-empty array`));
    }
  }
  const text = [packet.notes, packet.prompt, packet.context].filter(Boolean).join('\n');
  if (CONFIDENCE_PATTERNS.some((pattern) => pattern.test(text))) {
    issues.push(issue('bob-confidence-note', 'verifier packet must not include Bob confidence notes'));
  }
  return {
    ok: issues.length === 0,
    packet: {
      ...packet,
      canWrite: false,
      writePolicy: 'read-only'
    },
    issues
  };
}

export async function evaluateResultGate({ resultPath, contractsDir }) {
  if (!(await pathExists(resultPath))) {
    return { ok: false, accepting: false, status: 'MISSING_RESULT', reasons: ['result file missing'] };
  }
  let result;
  try {
    result = await readJson(resultPath);
  } catch (error) {
    return { ok: false, accepting: false, status: 'MALFORMED_RESULT', reasons: [error.message] };
  }
  const contracts = await loadContracts(contractsDir);
  const contract = contracts.get('job-result');
  const errors = validateInstance(contract, result);
  if (errors.length > 0) {
    return { ok: false, accepting: false, status: 'MALFORMED_RESULT', reasons: errors };
  }
  if (result.status === ACCEPTING_STATUS) {
    if (result.persona === 'oscar') {
      const markdownPath = pairedMarkdownResultPath(resultPath);
      if (!(await pathExists(markdownPath))) {
        return { ok: false, accepting: false, status: 'MALFORMED_RESULT', reasons: [`paired markdown result missing: ${markdownPath}`] };
      }
      const markdown = await readFile(markdownPath, 'utf8');
      const artifactErrors = validateOscarPassResultArtifacts({ lane: result.persona, result, markdown });
      if (artifactErrors.length > 0) {
        return { ok: false, accepting: false, status: 'MALFORMED_RESULT', reasons: artifactErrors };
      }
    }
    return { ok: true, accepting: true, status: result.status, reasons: [] };
  }
  if (NON_ACCEPTING_STATUSES.has(result.status)) {
    return { ok: false, accepting: false, status: result.status, reasons: [`${result.status} does not allow phase acceptance`] };
  }
  return { ok: false, accepting: false, status: result.status || 'UNKNOWN', reasons: ['unknown result status'] };
}

function pairedMarkdownResultPath(resultPath) {
  return String(resultPath).endsWith('.json')
    ? String(resultPath).slice(0, -'.json'.length) + '.md'
    : `${resultPath}.md`;
}

export async function readJsonList(filePath) {
  const value = await readJson(filePath);
  if (Array.isArray(value)) return value;
  if (Array.isArray(value.filesChanged)) return value.filesChanged;
  throw new Error(`${filePath} must be a JSON array or object with filesChanged array`);
}

async function readOptionalJson(filePath) {
  if (!(await pathExists(filePath))) return null;
  return readJson(filePath);
}

function isLockStale(lock, now, staleMs) {
  return isTimestampStale(lock.updatedAt || lock.acquiredAt, now, staleMs);
}

function isTimestampStale(then, now, staleMs) {
  if (!then) return true;
  return new Date(now).getTime() - new Date(then).getTime() > staleMs;
}

function scopesOverlap(left, right) {
  for (const leftScope of left) {
    for (const rightScope of right) {
      if (pathMatchesScope(leftScope, rightScope) || pathMatchesScope(rightScope, leftScope)) return true;
    }
  }
  return false;
}

function matchesAny(filePath, scopes) {
  return scopes.some((scope) => pathMatchesScope(filePath, scope));
}

function pathMatchesScope(filePath, scope) {
  const normalizedPath = normalizeScopePath(filePath);
  const normalizedScope = normalizeScopePath(scope);
  return normalizedPath === normalizedScope || normalizedPath.startsWith(`${normalizedScope}/`);
}

function normalizeScopePath(value) {
  return String(value).split(path.sep).join('/').replace(/\/+$/g, '');
}

function issue(code, detail) {
  return { code, severity: 'block', detail };
}
