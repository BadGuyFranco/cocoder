import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, readlink } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

export const DEFAULT_REFERENCE_ROOTS = [
  'cocoder/personas'
];

export const DEFAULT_EXCLUDED_PREFIXES = [
  // Founder-authorized Phase 13 CI gate integration lives in Talia's checklist
  // surface but is governed by orchestration RACI approvedExceptions.
  'cocoder/personas/checklists/talia/doc-consistency-gates.md'
];

// OS-generated files that Finder, Explorer, etc. drop into directories without
// developer action. Excluding them keeps the immutability gate signal-only —
// otherwise opening cocoder/personas/ in Finder is enough to
// trip the baseline. These are gitignored repo-wide; no human ever stages one.
export const DEFAULT_EXCLUDED_BASENAMES = new Set([
  '.DS_Store',
  'Thumbs.db'
]);

export async function compareImmutableBaseline({
  baselinePath,
  roots = DEFAULT_REFERENCE_ROOTS,
  excludedPrefixes = DEFAULT_EXCLUDED_PREFIXES,
  excludedBasenames = DEFAULT_EXCLUDED_BASENAMES
}) {
  const baseline = await parseBaselineMarkdown(baselinePath);
  const current = new Map((await collectReferenceEntries({ roots, excludedPrefixes, excludedBasenames })).map((entry) => [entry.path, entry]));
  const differences = [];

  for (const [entryPath, expected] of baseline) {
    const actual = current.get(entryPath);
    if (!actual) {
      differences.push({ path: entryPath, field: 'path', expected: 'present', actual: 'missing' });
      continue;
    }
    for (const field of ['status', 'kind', 'bytes', 'sha256']) {
      if (String(actual[field]) !== String(expected[field])) {
        differences.push({ path: entryPath, field, expected: expected[field], actual: actual[field] });
      }
    }
  }

  for (const entryPath of current.keys()) {
    if (!baseline.has(entryPath)) {
      differences.push({ path: entryPath, field: 'path', expected: 'absent', actual: 'present' });
    }
  }

  return {
    ok: differences.length === 0,
    baselineEntries: baseline.size,
    currentEntries: current.size,
    excludedPrefixes,
    differences
  };
}

export async function parseBaselineMarkdown(baselinePath) {
  const markdown = await readFile(baselinePath, 'utf8');
  const entries = new Map();
  for (const line of markdown.split('\n')) {
    if (!line.startsWith('| ')) continue;
    if (line.includes('| status |') || line.includes('|--------|')) continue;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length !== 5) continue;
    const [status, kind, bytes, sha256, pathCell] = cells;
    const match = pathCell.match(/^`(.+)`$/);
    if (!match) continue;
    entries.set(match[1], { status, kind, bytes: Number(bytes), sha256 });
  }
  return entries;
}

export async function collectReferenceEntries({ roots, excludedPrefixes, excludedBasenames = DEFAULT_EXCLUDED_BASENAMES }) {
  const tracked = gitPathSet(['ls-files', '--', ...roots]);
  const untracked = gitPathSet(['ls-files', '--others', '--exclude-standard', '--', ...roots]);
  const ignored = gitPathSet(['ls-files', '--others', '--ignored', '--exclude-standard', '--', ...roots]);
  const entries = [];

  for (const root of roots) await walk(root);
  return entries.sort((a, b) => a.path.localeCompare(b.path));

  async function walk(filePath) {
    const rel = normalizePath(filePath);
    if (isExcluded(rel, excludedPrefixes)) return;
    if (excludedBasenames.has(path.basename(filePath))) return;
    const stats = await lstat(filePath);
    const isDir = stats.isDirectory();
    entries.push({
      status: classify(rel, isDir, tracked, untracked, ignored),
      kind: isDir ? 'dir' : 'file',
      bytes: isDir ? 0 : stats.size,
      sha256: isDir ? '-' : await hashPath(filePath, stats),
      path: rel
    });

    if (!isDir) return;
    for (const child of (await readdir(filePath)).sort()) {
      await walk(path.join(filePath, child));
    }
  }
}

function gitPathSet(args) {
  return new Set(execFileSync('git', args, { encoding: 'utf8' }).split('\n').filter(Boolean));
}

function classify(entryPath, isDir, tracked, untracked, ignored) {
  if (isDir) return 'directory';
  if (tracked.has(entryPath)) return 'tracked';
  if (untracked.has(entryPath)) return 'untracked';
  if (ignored.has(entryPath)) return 'ignored';
  return 'unlisted';
}

function isExcluded(entryPath, prefixes) {
  return prefixes.some((prefix) => entryPath === prefix || entryPath.startsWith(`${prefix}/`));
}

async function hashPath(filePath, stats) {
  const hash = createHash('sha256');
  if (stats.isSymbolicLink()) {
    hash.update(await readlink(filePath));
    return hash.digest('hex');
  }
  const stream = createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

function normalizePath(filePath) {
  return filePath.split(path.sep).join('/');
}
