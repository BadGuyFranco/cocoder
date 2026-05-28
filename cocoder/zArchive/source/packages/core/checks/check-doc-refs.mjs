import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathExists } from '../lib/fs-utils.mjs';

const IGNORE_MARKER = 'doc-ref-check: ignore';
const URL_PATTERN = /^(?:https?:|mailto:)/i;
const MARKDOWN_LINK_PATTERN = /\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const RAW_PATH_PATTERN = /(?<![\w@:])((?:\.{1,2}\/)?[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+(?:\.md)?(?:#[A-Za-z0-9_.-]+)?(?::\d+)?)/g;
const ADR_PATTERN = /\bADR-0*(\d{1,4})\b/gi;
const PERSONA_RULE_PATTERN = /\b([a-z][a-z0-9_-]+\.md):(\d+)\b/gi;

export async function checkDocRefs({
  root,
  reportPath,
  decisionsDir = path.join(process.cwd(), 'decisions'),
  personaPaths = [path.join(process.cwd(), 'cocoder/personas')],
  now = new Date().toISOString()
} = {}) {
  if (!root) throw new Error('root is required');
  const rootPath = path.resolve(root);
  const report = {
    ok: true,
    advisory: true,
    root: rootPath,
    generatedAt: now,
    ignoredMarker: IGNORE_MARKER,
    scannedMarkdownFiles: 0,
    summary: {
      totalScanned: 0,
      totalReferences: 0,
      totalMissing: 0,
      findingsByKind: {
        'file-path': 0,
        adr: 0,
        'persona-rule': 0
      }
    },
    findings: []
  };

  const adrIndex = await buildAdrIndex(decisionsDir);
  const personaIndex = await buildPersonaIndex(personaPaths);
  const markdownFiles = await findMarkdownFiles(rootPath);
  report.scannedMarkdownFiles = markdownFiles.length;
  report.summary.totalScanned = markdownFiles.length;

  const seen = new Set();
  for (const filePath of markdownFiles) {
    const lines = (await readFile(filePath, 'utf8')).split(/\r?\n/);
    let inFence = false;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (/^\s*```/.test(line) || /^\s*~~~/.test(line)) {
        inFence = !inFence;
        continue;
      }
      if (inFence || line.includes(IGNORE_MARKER)) continue;
      const lineNumber = index + 1;
      for (const ref of collectFilePathRefs(line)) {
        addFinding(report, seen, await evaluateFilePathRef({ rootPath, filePath, lineNumber, ref }));
      }
      for (const ref of collectAdrRefs(line)) {
        addFinding(report, seen, evaluateAdrRef({ rootPath, filePath, lineNumber, ref, adrIndex }));
      }
      for (const ref of collectPersonaRuleRefs(line)) {
        addFinding(report, seen, evaluatePersonaRuleRef({ rootPath, filePath, lineNumber, ref, personaIndex }));
      }
    }
  }

  report.summary.totalReferences = report.findings.length;
  for (const finding of report.findings) {
    if (finding.status !== 'missing') continue;
    report.summary.totalMissing += 1;
    report.summary.findingsByKind[finding.kind] += 1;
  }

  if (reportPath) {
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  return report;
}

export function summarizeDocRefReport(report) {
  const counts = report.summary.findingsByKind;
  return `check-doc-refs scanned=${report.summary.totalScanned} findings file-path=${counts['file-path']} adr=${counts.adr} persona-rule=${counts['persona-rule']}`;
}

async function findMarkdownFiles(rootPath) {
  const files = [];
  await walk(rootPath, async (filePath, entry) => {
    if (entry.isFile() && filePath.endsWith('.md')) files.push(filePath);
  });
  return files.sort();
}

async function buildAdrIndex(decisionsDir) {
  const index = new Map();
  const root = path.resolve(decisionsDir);
  if (!(await pathExists(root))) return index;
  await walk(root, async (filePath, entry) => {
    if (!entry.isFile() || !filePath.endsWith('.md')) return;
    const match = path.basename(filePath).match(/^(\d{4})-/);
    if (match && !index.has(match[1])) index.set(match[1], filePath);
  });
  return index;
}

async function buildPersonaIndex(personaPaths) {
  const index = new Map();
  for (const personaPath of personaPaths || []) {
    const root = path.resolve(personaPath);
    if (!(await pathExists(root))) continue;
    await walk(root, async (filePath, entry) => {
      if (!entry.isFile() || !filePath.endsWith('.md')) return;
      const name = path.basename(filePath).toLowerCase();
      if (!index.has(name)) index.set(name, filePath);
    });
  }
  return index;
}

async function walk(root, visit) {
  let rootStat;
  try {
    rootStat = await stat(root);
  } catch {
    return;
  }
  if (rootStat.isFile()) {
    await visit(root, { isFile: () => true, isDirectory: () => false, name: path.basename(root) });
    return;
  }
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.claude' || entry.name.startsWith('.bench-repo')) continue;
    const filePath = path.join(root, entry.name);
    if (entry.isDirectory()) await walk(filePath, visit);
    else await visit(filePath, entry);
  }
}

function collectFilePathRefs(line) {
  const refs = [];
  for (const match of line.matchAll(MARKDOWN_LINK_PATTERN)) {
    const ref = cleanRef(match[1]);
    if (isCheckableFilePath(ref)) refs.push(ref);
  }
  for (const match of line.matchAll(RAW_PATH_PATTERN)) {
    const ref = cleanRef(match[1]);
    if (isCheckableFilePath(ref)) refs.push(ref);
  }
  return [...new Set(refs)];
}

function collectAdrRefs(line) {
  return [...line.matchAll(ADR_PATTERN)].map((match) => ({
    raw: match[0],
    id: String(Number(match[1])).padStart(4, '0')
  }));
}

function collectPersonaRuleRefs(line) {
  return [...line.matchAll(PERSONA_RULE_PATTERN)].map((match) => ({
    raw: match[0],
    fileName: match[1].toLowerCase(),
    lineNumber: Number(match[2])
  }));
}

async function evaluateFilePathRef({ rootPath, filePath, lineNumber, ref }) {
  const resolved = await resolveFilePathRef({ rootPath, filePath, ref });
  return {
    file: path.relative(rootPath, filePath),
    line: lineNumber,
    kind: 'file-path',
    ref,
    status: resolved.exists ? 'resolved' : 'missing',
    ...(resolved.path ? { resolvedPath: resolved.path } : {}),
    ...(resolved.suggestion ? { suggestion: resolved.suggestion } : {})
  };
}

function evaluateAdrRef({ rootPath, filePath, lineNumber, ref, adrIndex }) {
  const resolvedPath = adrIndex.get(ref.id);
  return {
    file: path.relative(rootPath, filePath),
    line: lineNumber,
    kind: 'adr',
    ref: ref.raw,
    status: resolvedPath ? 'resolved' : 'missing',
    ...(resolvedPath ? { resolvedPath } : { suggestion: `Create or index decisions/${ref.id}-*.md` })
  };
}

function evaluatePersonaRuleRef({ rootPath, filePath, lineNumber, ref, personaIndex }) {
  const resolvedPath = personaIndex.get(ref.fileName);
  return {
    file: path.relative(rootPath, filePath),
    line: lineNumber,
    kind: 'persona-rule',
    ref: ref.raw,
    status: resolvedPath ? 'resolved' : 'missing',
    ...(resolvedPath ? { resolvedPath } : { suggestion: `Add ${ref.fileName} to configured persona paths` })
  };
}

async function resolveFilePathRef({ rootPath, filePath, ref }) {
  const stripped = stripAnchorAndLine(ref);
  if (path.isAbsolute(stripped)) {
    return { exists: await safePathExists(stripped), path: stripped };
  }
  const relative = path.resolve(path.dirname(filePath), stripped);
  if (await safePathExists(relative)) return { exists: true, path: relative };
  const rootRelative = path.resolve(rootPath, stripped.replace(/^\.\//, ''));
  if (await safePathExists(rootRelative)) {
    return {
      exists: true,
      path: rootRelative,
      suggestion: `Reference resolves from scan root; consider anchoring from ${path.relative(rootPath, path.dirname(filePath)) || '.'}`
    };
  }
  return { exists: false, path: relative };
}

async function safePathExists(filePath) {
  try {
    return await pathExists(filePath);
  } catch (error) {
    if (error.code === 'ENOTDIR' || error.code === 'ENAMETOOLONG') return false;
    throw error;
  }
}

function cleanRef(value) {
  return String(value || '')
    .replace(/[),.;]+$/g, '')
    .replace(/^`|`$/g, '')
    .trim();
}

function stripAnchorAndLine(value) {
  return value
    .replace(/#.*$/, '')
    .replace(/\.md:\d+.*$/, '.md');
}

function isCheckableFilePath(ref) {
  if (!ref || URL_PATTERN.test(ref) || ref.startsWith('#')) return false;
  if (/\bADR-0*\d{1,4}\b/i.test(ref) && !ref.includes('/')) return false;
  return ref.endsWith('.md') || /\.md[:#]/.test(ref) || ref.startsWith('./') || ref.startsWith('../');
}

function addFinding(report, seen, finding) {
  const key = `${finding.file}:${finding.line}:${finding.kind}:${finding.ref}`;
  if (seen.has(key)) return;
  seen.add(key);
  report.findings.push(finding);
}
