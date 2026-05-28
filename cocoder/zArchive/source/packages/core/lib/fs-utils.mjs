import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import YAML from 'yaml';

export function repoPath(...parts) {
  return path.join(process.cwd(), ...parts);
}

export async function readJson(filePath) {
  const raw = await readFile(filePath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in ${filePath}: ${error.message}`);
  }
}

export async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function sha256File(filePath) {
  const hash = createHash('sha256');
  const stream = createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

export function sha256String(value) {
  return createHash('sha256').update(value).digest('hex');
}

export async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

export async function readLineTail(filePath, lineLimit) {
  if (!(await pathExists(filePath))) {
    return { excerpt: '', source: filePath, lineLimit, linesRead: 0, missing: true };
  }

  const lines = [];
  const rl = readline.createInterface({
    input: createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    lines.push(line);
    if (lines.length > lineLimit) lines.shift();
  }

  return {
    excerpt: lines.join('\n'),
    source: filePath,
    lineLimit,
    linesRead: lines.length,
    missing: false
  };
}

export async function readSessionLogBrief(filePath, lineLimit, entryLimit = 3) {
  if (!(await pathExists(filePath))) {
    return { excerpt: '', source: filePath, lineLimit, linesRead: 0, missing: true, strategy: 'newest-session-entries' };
  }

  const raw = await readFile(filePath, 'utf8');
  const lines = raw.split(/\r?\n/);
  const entries = [];
  let current = null;

  for (const line of lines) {
    if (/^## 20\d\d-\d\d-\d\d\b/.test(line)) {
      if (current) entries.push(current);
      current = [line];
      continue;
    }
    if (current) current.push(line);
  }
  if (current) entries.push(current);

  const selected = entries.length > 0 ? entries.slice(0, entryLimit).flat() : lines;
  const limited = selected.slice(0, lineLimit);

  return {
    excerpt: limited.join('\n'),
    source: filePath,
    lineLimit,
    linesRead: limited.length,
    missing: false,
    strategy: entries.length > 0 ? 'newest-session-entries' : 'head-fallback',
    entryLimit
  };
}

export async function extractPriorityEntry(filePath, slug) {
  const result = {
    slug,
    title: slug,
    status: 'unknown',
    excerpt: '',
    lastUpdated: '',
    staleState: 'active',
    source: filePath,
    matched: false
  };

  if (!(await pathExists(filePath))) {
    result.staleState = 'missing-source';
    return result;
  }

  const lines = [];
  let capturing = false;
  const headingPattern = /^#{2,4}\s+/;
  const priorityHeadingPattern = /^#{2,4}\s+.*\[[^\]]+\].*$/;
  const archivedPriorityPattern = /^<!--\s+\[[^\]]+\]\s+Archived\b/i;
  const rl = readline.createInterface({
    input: createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    const lastUpdatedMatch = line.match(/^Last updated:\s*(.*)$/);
    if (lastUpdatedMatch) result.lastUpdated = lastUpdatedMatch[1].trim();

    const isPriorityHeading = priorityHeadingPattern.test(line);
    const isArchivedPriorityComment = archivedPriorityPattern.test(line);
    if (!capturing && isPriorityHeading && line.includes(slug)) {
      capturing = true;
      result.matched = true;
    } else if (capturing && (isPriorityHeading || isArchivedPriorityComment) && lines.length > 0) {
      break;
    }

    if (capturing) {
      lines.push(line);
      const titleMatch = line.match(headingPattern);
      const statusMatch = line.match(/\*\*Status:\*\*\s*(.*)$/);
      if (titleMatch) result.title = line.replace(headingPattern, '').trim();
      if (statusMatch) result.status = statusMatch[1].trim();
      if (
        (titleMatch && declaresPriorityInactive(line.replace(headingPattern, '')))
        || (statusMatch && declaresPriorityInactive(statusMatch[1]))
      ) {
        result.staleState = 'review-required';
      }
    }
  }

  result.excerpt = lines.join('\n');
  if (!result.matched) result.staleState = 'missing';
  return result;
}

export async function extractPrioritySlugs(filePath) {
  const slugs = new Set();
  if (!(await pathExists(filePath))) return slugs;
  const linkedPriorityHeadingPattern = /^#{2,4}\s+.*\[[^\]]+\]\(([^)]+)\).*$/;
  const bracketPriorityHeadingPattern = /^#{2,4}\s+\[([^\]]+)\]/;
  const slugPattern = /(?:^|\/)priorities\/([^/#)]+)(?:\/README\.md)?/;
  const rl = readline.createInterface({
    input: createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    const linkMatch = line.match(linkedPriorityHeadingPattern);
    const bracketMatch = line.match(bracketPriorityHeadingPattern);
    const slug = linkMatch?.[1].match(slugPattern)?.[1] || bracketMatch?.[1];
    if (slug) slugs.add(slug);
  }
  return slugs;
}

function declaresPriorityInactive(text) {
  return /^\s*(stale|superseded|archived|closed)\b/i.test(text);
}

export async function readStructuredFile(filePath) {
  const text = await readFile(filePath, 'utf8');
  if (filePath.endsWith('.json')) return JSON.parse(text);
  if (filePath.endsWith('.yaml') || filePath.endsWith('.yml')) return YAML.parse(text) ?? {};
  throw new Error(`Unsupported config format: ${filePath}`);
}

export async function writeStructuredFile(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  if (filePath.endsWith('.json')) {
    await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
    return;
  }
  if (filePath.endsWith('.yaml') || filePath.endsWith('.yml')) {
    await writeFile(filePath, YAML.stringify(value));
    return;
  }
  throw new Error(`Unsupported config format: ${filePath}`);
}

export function getByDottedPath(value, dottedPath) {
  if (!dottedPath) return value;
  return String(dottedPath).split('.').reduce((current, segment) => current?.[segment], value);
}

export function setByDottedPath(value, dottedPath, nextValue) {
  const segments = String(dottedPath).split('.').filter(Boolean);
  if (segments.length === 0) throw new Error('Config key is required');
  let current = value;
  for (const segment of segments.slice(0, -1)) {
    if (!current[segment] || typeof current[segment] !== 'object' || Array.isArray(current[segment])) {
      current[segment] = {};
    }
    current = current[segment];
  }
  current[segments.at(-1)] = parseConfigScalar(nextValue);
  return value;
}

function parseConfigScalar(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(String(value))) return Number(value);
  try {
    if (/^[\[{]/.test(String(value).trim())) return JSON.parse(value);
  } catch {
    return value;
  }
  return value;
}
