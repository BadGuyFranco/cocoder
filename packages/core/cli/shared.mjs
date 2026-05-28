import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_WORKSPACE_SLUG,
  assertExplicitWorkspaceContextWhenInsideInstall,
  resolveInstallRoot,
  workspaceCheckReportPath,
  workspaceDebuggerRunsRoot,
  workspaceRunsRoot
} from '../lib/paths.mjs';
import { repoPath } from '../lib/fs-utils.mjs';

const CLI_DIR = path.dirname(fileURLToPath(import.meta.url));
export const CORE_DIR = path.join(CLI_DIR, '..');
export const DEFAULT_CONTRACTS_DIR = path.join(CORE_DIR, 'contracts');
export const DEFAULT_BASELINE = path.join(CORE_DIR, 'baselines', 'accepted-reference-baseline.md');
export const DEFAULT_ADAPTERS_DIR = path.join(CORE_DIR, 'adapters');
export const DEFAULT_SERVICES_DIR = path.join(CORE_DIR, 'services');
export const DEFAULT_PROFILES_DIR = repoPath('cocoder/profiles');
export const DEFAULT_ROUTES_DIR = repoPath('cocoder/routes');
export const DEFAULT_PERSONAS_DIR = repoPath('cocoder/personas');
export const DEFAULT_IMPROVEMENTS_DIR = repoPath('cocoder/improvements');
export const DEFAULT_PRIORITY_BOUNDARIES_DIR = repoPath('cocoder/priority-boundaries');

export async function resolveDefaultRunPaths(args) {
  await assertExplicitWorkspaceContextWhenInsideInstall({
    workspaceRoot: args.workspaceRoot,
    workspaceSlug: args.workspaceSlug,
    startDir: process.cwd()
  });
  const cocoderHome = args.cocoderHome
    ? path.resolve(args.cocoderHome)
    : await resolveInstallRoot(process.cwd());
  const workspaceSlug = args.workspaceSlug || DEFAULT_WORKSPACE_SLUG;
  return {
    cocoderHome,
    workspaceSlug,
    runsDir: workspaceRunsRoot({ cocoderHome, workspaceSlug }),
    debuggerRunsDir: workspaceDebuggerRunsRoot({ cocoderHome, workspaceSlug }),
    checkReportFor: (checkName, timestamp) =>
      workspaceCheckReportPath({ cocoderHome, workspaceSlug, checkName, timestamp })
  };
}

export async function safeListDirectories(dir) {
  try {
    return (await readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

export function trimCompatibility(result) {
  return {
    ok: result.ok,
    status: result.status,
    profile: result.profile.id,
    route: result.route.id,
    lanes: result.lanes,
    issues: result.issues
  };
}

export function parseArgs(tokens) {
  const args = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith('--')) throw new Error(`Unexpected positional argument ${token}`);
    const key = toCamel(token.slice(2));
    const next = tokens[index + 1];
    if (!next || next.startsWith('--')) args[key] = 'true';
    else {
      args[key] = path.resolve(next);
      if (['contract', 'prioritySlug', 'status', 'reason', 'summary', 'runId', 'jobId', 'sessionId', 'confirmRunId', 'mode', 'followIntervalSeconds', 'maxCycles', 'execute', 'deferStart', 'attach', 'stopTerminalSessions', 'founderApprovedTeardown', 'sessionLineLimit', 'owner', 'nonce', 'now', 'ttlMs', 'staleMs', 'timeoutMs', 'thresholdDays', 'maxChars', 'maxEntries', 'maxEntryLines', 'maxEntryChars', 'allowLive', 'cdpUrl', 'socketName', 'socketPath', 'lane', 'lanes', 'message', 'command', 'tmuxBin', 'noSession', 'supersededLane', 'resolvingLane', 'basis', 'findings', 'evidence', 'id', 'name', 'tmuxSocket', 'createdBy', 'personaPaths', 'sessionLog', 'topologyOption', 'requiredPersonas', 'autoAttachAddedLanes', 'workspaceSlug', 'developerMode', 'allowConcurrentPriorityRun', 'revealSecrets', 'service', 'executorCommand', 'model'].includes(key)) args[key] = next;
      index += 1;
    }
  }
  return args;
}

export function parseArgsAllowPositionals(tokens) {
  const flags = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith('--')) continue;
    flags.push(token);
    if (tokens[index + 1] && !tokens[index + 1].startsWith('--')) {
      flags.push(tokens[index + 1]);
      index += 1;
    }
  }
  return parseArgs(flags);
}

export function splitCliList(value) {
  if (!value) return [];
  return String(value).split(';').map((item) => item.trim()).filter(Boolean);
}

export function readStdin() {
  return new Promise((resolve, reject) => {
    let raw = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      raw += chunk;
    });
    process.stdin.on('end', () => resolve(raw));
    process.stdin.on('error', reject);
  });
}

export function requireArgs(args, required) {
  const missing = required.filter((key) => args[key] === undefined);
  if (missing.length > 0) throw new Error(`Missing required argument(s): ${missing.map((key) => `--${key}`).join(', ')}`);
}

function toCamel(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

export function splitCsv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
