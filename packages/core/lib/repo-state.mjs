import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DURABLE_ORCHESTRATION_PREFIX = 'cocoder/';
const RUN_LOCAL_ARTIFACT_PREFIXES = [
  'cocoder/runs/',
  'cocoder/debug-runs/',
  'cocoder/consult-runs/'
];

export async function auditDirtyDurableOrchestrationState({
  repoRoot = process.cwd(),
  allowedFiles = [],
  blockUnstaged = true,
  git = realGit
} = {}) {
  const allowed = new Set(allowedFiles.map(normalizeRepoPath));
  let porcelain = '';
  try {
    porcelain = await git(repoRoot, [
      'status',
      '--porcelain=v1',
      '--untracked-files=all',
      '--',
      DURABLE_ORCHESTRATION_PREFIX
    ]);
  } catch (error) {
    return {
      ok: true,
      skipped: true,
      reason: error.message || String(error),
      dirtyFiles: [],
      entries: [],
      issues: []
    };
  }

  const entries = parsePorcelainStatus(porcelain)
    .flatMap((entry) => entry.paths.map((filePath) => ({ ...entry, path: filePath })))
    .filter((entry) => isDurableOrchestrationPath(entry.path))
    .filter((entry) => !allowed.has(entry.path));
  const dirtyFiles = [...new Set(entries.map((entry) => entry.path))];
  const stagedEntries = entries.filter((entry) => hasStagedChange(entry.status));
  const stagedFiles = [...new Set(stagedEntries.map((entry) => entry.path))];
  const warnings = dirtyFiles.length > 0
    ? [dirtyOrchestrationWarning(dirtyFiles)]
    : [];
  const issues = stagedFiles.length > 0
    ? [stagedOrchestrationIssue(stagedFiles)]
    : blockUnstaged && dirtyFiles.length > 0
      ? [dirtyOrchestrationIssue(dirtyFiles)]
    : [];

  return {
    ok: issues.length === 0,
    skipped: false,
    dirtyFiles,
    stagedFiles,
    entries,
    porcelain,
    warnings,
    issues
  };
}

export async function auditAddLaneOrchestrationState({
  repoRoot = process.cwd(),
  git = realGit
} = {}) {
  const audit = await auditDirtyDurableOrchestrationState({ repoRoot, git });
  if (audit.skipped) return audit;

  const stagedEntries = audit.entries.filter((entry) => hasStagedChange(entry.status));
  const stagedFiles = [...new Set(stagedEntries.map((entry) => entry.path))];
  const warnings = audit.dirtyFiles.length > 0
    ? [dirtyOrchestrationWarning(audit.dirtyFiles)]
    : [];
  const issues = stagedFiles.length > 0
    ? [stagedOrchestrationIssue(stagedFiles)]
    : [];

  return {
    ok: issues.length === 0,
    skipped: false,
    dirtyFiles: audit.dirtyFiles,
    stagedFiles,
    entries: audit.entries,
    porcelain: audit.porcelain,
    warnings,
    issues
  };
}

export function isDurableOrchestrationPath(filePath) {
  const normalized = normalizeRepoPath(filePath);
  return normalized.startsWith(DURABLE_ORCHESTRATION_PREFIX)
    && !RUN_LOCAL_ARTIFACT_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function parsePorcelainStatus(raw) {
  return String(raw || '')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const status = line.slice(0, 2);
      const payload = line.slice(3);
      const paths = payload.includes(' -> ')
        ? payload.split(' -> ').map(normalizeRepoPath)
        : [normalizeRepoPath(payload)];
      return { status, raw: line, paths };
    });
}

export function normalizeRepoPath(filePath) {
  return String(filePath || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+/g, '/');
}

function hasStagedChange(status) {
  const indexStatus = String(status || '  ')[0] || ' ';
  return indexStatus !== ' ' && indexStatus !== '?';
}

function dirtyOrchestrationIssue(dirtyFiles) {
  return {
    code: 'dirty-durable-orchestration-state',
    severity: 'block',
    detail: `dirty durable orchestration files block this operation until resolved: ${dirtyFiles.join(', ')}`,
    paths: dirtyFiles
  };
}

function dirtyOrchestrationWarning(dirtyFiles) {
  return {
    code: 'dirty-durable-orchestration-state',
    severity: 'warn',
    detail: `uncommitted durable orchestration files are present but do not block exact-file operations unless staged or explicitly selected: ${dirtyFiles.join(', ')}`,
    paths: dirtyFiles
  };
}

function stagedOrchestrationIssue(stagedFiles) {
  return {
    code: 'staged-durable-orchestration-state',
    severity: 'block',
    detail: `staged durable orchestration files block exact-file operations until committed or unstaged: ${stagedFiles.join(', ')}`,
    paths: stagedFiles
  };
}

async function realGit(repoRoot, args) {
  const result = await execFileAsync('git', ['-C', repoRoot, ...args], { maxBuffer: 1024 * 1024 });
  return result.stdout;
}
