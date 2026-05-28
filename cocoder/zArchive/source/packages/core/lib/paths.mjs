import os from 'node:os';
import path from 'node:path';
import { pathExists, readStructuredFile } from './fs-utils.mjs';

// M4.25 / pending-decisions Q3=A + ARCHITECTURE.md L132-136 —
// ephemeral run/report/debug artifacts live in the install-local zone
// at `<install>/local/workspaces/<slug>/`, never in the tracked `cocoder/`
// meta-project tree. The Sub-Playbook C workspaces registry will assign
// proper slugs at v0.2; v0.1 callers pass an explicit `workspaceSlug` (the
// dogfood passes `cocoder-dogfood`) or fall back to `default` for anonymous
// invocations.
export const DEFAULT_WORKSPACE_SLUG = 'default';

export function workspaceArtifactsRoot({ cocoderHome, workspaceSlug = DEFAULT_WORKSPACE_SLUG } = {}) {
  if (!cocoderHome) throw new Error('workspaceArtifactsRoot requires cocoderHome');
  return path.join(cocoderHome, 'local', 'workspaces', workspaceSlug);
}

export function workspaceRunsRoot(opts) {
  return path.join(workspaceArtifactsRoot(opts), 'runs');
}

export function workspaceDebuggerRunsRoot(opts) {
  return path.join(workspaceArtifactsRoot(opts), 'debug-runs');
}

export function workspaceCheckReportPath({ cocoderHome, workspaceSlug, checkName, timestamp }) {
  if (!checkName) throw new Error('workspaceCheckReportPath requires checkName');
  if (!timestamp) throw new Error('workspaceCheckReportPath requires timestamp');
  return path.join(
    workspaceArtifactsRoot({ cocoderHome, workspaceSlug }),
    'check-reports',
    `${checkName}-${timestamp}`,
    'evidence',
    'report.json'
  );
}

export function resolveHomePath(input) {
  if (input === '~') return os.homedir();
  if (String(input).startsWith('~/')) return path.join(os.homedir(), String(input).slice(2));
  return input;
}

// M4.23 / audit §B6 — findCocoderHome fails closed.
//
// Returns the absolute install-root path (the directory containing both
// `cocoder/AGENTS.md` AND `ARCHITECTURE.md`) by walking ancestors from
// startDir. Returns `null` when no install root is found in the ancestor
// chain. Callers that require an install root should use
// `resolveInstallRoot()` instead, which throws a friendly error on null.
export async function findCocoderHome(startDir = process.cwd()) {
  let current = path.resolve(startDir);
  while (true) {
    if (await pathExists(path.join(current, 'cocoder', 'AGENTS.md')) && await pathExists(path.join(current, 'ARCHITECTURE.md'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

// M4.23 — install-root resolver that fails closed with a friendly error.
export async function resolveInstallRoot(startDir = process.cwd()) {
  const home = await findCocoderHome(startDir);
  if (!home) {
    const where = path.resolve(startDir);
    throw new Error(
      `Could not locate the CoCoder install root from ${where}. ` +
      'Searched ancestor directories for cocoder/AGENTS.md + ARCHITECTURE.md. ' +
      'Pass --cocoder-home=<path> explicitly, or cd into the CoCoder install.'
    );
  }
  return home;
}

// M4.24 / ADR-0006 — active workspace-root resolver.
//
// Precedence:
//   1. Explicit `workspaceRoot` argument (typically the CLI's `--workspace-root` flag)
//   2. Cwd ancestor walk for the first directory containing `cocoder/AGENTS.md`
//   3. Fail with `null`
//
// In either branch the chosen workspace root is checked against ADR-0006:
// a workspace nested inside the CoCoder install repository is forbidden. The
// only exception is the install's own dogfood — a directory containing BOTH
// `cocoder/AGENTS.md` AND `ARCHITECTURE.md` IS the install dogfood workspace
// and that's the one legitimate "workspace inside install" instance.
//
// Throws an Error with `code === 'COCODER_NESTED_WORKSPACE_FORBIDDEN'` when
// the resolved workspace would be nested inside an install repo.
export async function resolveActiveWorkspaceRoot({ workspaceRoot, startDir = process.cwd() } = {}) {
  if (workspaceRoot) {
    const resolved = path.resolve(workspaceRoot);
    await assertWorkspaceNotNestedInsideInstall(resolved);
    return resolved;
  }
  let current = path.resolve(startDir);
  while (true) {
    if (await pathExists(path.join(current, 'cocoder', 'AGENTS.md'))) {
      await assertWorkspaceNotNestedInsideInstall(current);
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

// M4.24 / ADR-0006 — refuses a workspace path that sits inside a CoCoder
// install tree (other than the install's own dogfood root itself).
export async function assertWorkspaceNotNestedInsideInstall(workspaceRoot) {
  const resolved = path.resolve(workspaceRoot);
  // Walk up from the workspace candidate; if we find an install marker pair
  // at a STRICT ANCESTOR (not the workspace itself), the workspace is nested.
  const installAncestor = await findCocoderHome(path.dirname(resolved));
  if (installAncestor) {
    throw nestedWorkspaceError({ workspaceRoot: resolved, installRoot: installAncestor });
  }
}

// M4.27 / pending-decisions Q6=A — friendly cwd error.
//
// When a workspace-scope CLI command runs from inside the CoCoder install
// repository without an explicit `--workspace-root` or `--workspace-slug`,
// CoCoder refuses to silently bind to the install dogfood. The user must
// either cd into their project, or opt into the dogfood explicitly.
//
// Pass `{ workspaceRoot, workspaceSlug, startDir }` from the CLI handler.
// If either explicit identifier is present (truthy string), the check
// short-circuits as a no-op. If startDir is outside any CoCoder install,
// also a no-op (normal user-app cwd). Only the cwd-inside-install case
// without explicit workspace context surfaces the friendly error.
export async function assertExplicitWorkspaceContextWhenInsideInstall({
  workspaceRoot,
  workspaceSlug,
  startDir = process.cwd()
} = {}) {
  if (workspaceRoot && String(workspaceRoot).trim() !== '' && workspaceRoot !== 'true') return;
  if (workspaceSlug && String(workspaceSlug).trim() !== '' && workspaceSlug !== 'true') return;
  const installAncestor = await findCocoderHome(startDir);
  if (!installAncestor) return;
  const cwd = path.resolve(startDir);
  const error = new Error(
    'cocoder: this command runs against a workspace, but you are inside the CoCoder install\n' +
    'repository and did not specify which workspace to use.\n\n' +
    `  Install root:   ${installAncestor}\n` +
    `  Current dir:    ${cwd}\n\n` +
    'CoCoder will not silently bind to the install dogfood. Pick one:\n' +
    '  - cd into your project (the directory that owns its own cocoder/ folder), then re-run.\n' +
    `  - Pass --workspace-root="${installAncestor}" to operate against the CoCoder dogfood.\n` +
    '  - Pass --workspace-root=<path> to operate against a different workspace.\n\n' +
    '(See ADR-0006 for the "no workspaces inside install" rationale.)'
  );
  error.code = 'COCODER_WORKSPACE_CONTEXT_REQUIRED';
  error.installRoot = installAncestor;
  error.cwd = cwd;
  throw error;
}

function nestedWorkspaceError({ workspaceRoot, installRoot }) {
  // Canonical wording per ADR-0006 §Decision step 3.
  const error = new Error(
    'cocoder: refusing to operate on a workspace nested inside the CoCoder install repository.\n\n' +
    `  Workspace path: ${workspaceRoot}\n` +
    `  Install root:   ${installRoot}\n\n` +
    'CoCoder workspaces must live outside the install tree. The install repo\n' +
    `already contains the dogfood workspace at ${installRoot}/cocoder/, and v0.1 does\n` +
    'not support additional nested workspaces.\n\n' +
    `Move the target directory outside ${installRoot}, or pass --workspace-root to\n` +
    'point at an out-of-tree path.\n\n' +
    '(Nested workspaces are tracked for v0.2 via the workspaces registry; see\n' +
    'ADR-0005 + Sub-Playbook C.)'
  );
  error.code = 'COCODER_NESTED_WORKSPACE_FORBIDDEN';
  error.workspaceRoot = workspaceRoot;
  error.installRoot = installRoot;
  return error;
}

export async function loadRoots({ cocoderHome, rootsPath } = {}) {
  const filePath = rootsPath || path.join(cocoderHome || await resolveInstallRoot(), 'local', 'roots.yaml');
  if (!(await pathExists(filePath))) return {};
  const value = await readStructuredFile(filePath);
  return value.roots || {};
}

export async function resolvePathToken(input, { cocoderHome, roots } = {}) {
  if (!input) throw new Error('Path token is required');
  const home = path.resolve(cocoderHome || await resolveInstallRoot());
  const rootMap = roots || await loadRoots({ cocoderHome: home });
  const text = String(input);
  if (text === '${COCODER_HOME}') return home;
  if (text.startsWith('${COCODER_HOME}/')) return path.resolve(home, text.slice('${COCODER_HOME}/'.length));

  const rootMatch = text.match(/^\$\{root:([A-Za-z0-9_-]+)\}(?:\/(.*))?$/);
  if (rootMatch) {
    const [, name, rest = ''] = rootMatch;
    if (!rootMap[name]) throw new Error(`Unknown root token ${name}`);
    return path.resolve(resolveHomePath(rootMap[name]), rest);
  }

  if (text.startsWith('~/')) return path.resolve(resolveHomePath(text));
  if (path.isAbsolute(text)) return path.resolve(text);
  return path.resolve(home, text);
}

export async function tokenizePath(input, { cocoderHome, roots } = {}) {
  const absolute = path.resolve(resolveHomePath(input));
  const home = path.resolve(cocoderHome || await resolveInstallRoot());
  const rootMap = roots || await loadRoots({ cocoderHome: home });
  const candidates = Object.entries(rootMap)
    .map(([name, rootPath]) => [name, path.resolve(resolveHomePath(rootPath))])
    .filter(([, rootPath]) => isInsideOrSame(rootPath, absolute))
    .sort((left, right) => right[1].length - left[1].length);

  if (candidates.length > 0) {
    const [name, rootPath] = candidates[0];
    return {
      path: absolute === rootPath ? `\${root:${name}}` : `\${root:${name}}/${path.relative(rootPath, absolute).split(path.sep).join('/')}`,
      warning: null
    };
  }

  if (isInsideOrSame(home, absolute)) {
    return {
      path: absolute === home ? '${COCODER_HOME}' : `\${COCODER_HOME}/${path.relative(home, absolute).split(path.sep).join('/')}`,
      warning: null
    };
  }

  return {
    path: absolute,
    warning: `Stored absolute path because no token matched: ${absolute}`
  };
}

export function workspaceIdentity(workspace) {
  return workspace.id || workspace.slug || workspace.name || workspace.path;
}

function isInsideOrSame(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
