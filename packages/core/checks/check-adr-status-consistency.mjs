import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathExists } from '../lib/fs-utils.mjs';

const IGNORE_MARKER = 'adr-status-check: ignore';
const ACCEPTED_STATUSES = new Set(['superseded', 'superseded-pending']);

export async function checkAdrStatusConsistency({
  root,
  reportPath,
  decisionsDirs = [path.join(process.cwd(), 'decisions')],
  now = new Date().toISOString()
} = {}) {
  if (!root) throw new Error('root is required');
  const rootPath = path.resolve(root);
  const adrIndex = await buildAdrIndex(decisionsDirs);
  const files = await findScannableMarkdownFiles(rootPath);
  const report = {
    ok: true,
    advisory: true,
    root: rootPath,
    generatedAt: now,
    ignoredMarker: IGNORE_MARKER,
    scannedMarkdownFiles: files.length,
    summary: {
      totalScanned: files.length,
      totalDeclarations: 0,
      totalFindings: 0,
      findingsByKind: {
        'adr-status-drift': 0
      }
    },
    findings: []
  };

  const seenDeclarations = new Set();
  for (const filePath of files) {
    const lines = (await readFile(filePath, 'utf8')).split(/\r?\n/);
    let inFence = false;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (/^\s*```/.test(line) || /^\s*~~~/.test(line)) {
        inFence = !inFence;
        continue;
      }
      if (inFence || line.includes(IGNORE_MARKER)) continue;
      for (const declaration of collectSupersessionDeclarations(line)) {
        const key = `${filePath}:${index + 1}:${declaration.adr}`;
        if (seenDeclarations.has(key)) continue;
        seenDeclarations.add(key);
        report.summary.totalDeclarations += 1;
        const finding = evaluateDeclaration({
          rootPath,
          filePath,
          lineNumber: index + 1,
          declaration,
          adrIndex
        });
        if (finding) report.findings.push(finding);
      }
    }
  }

  report.summary.totalFindings = report.findings.length;
  report.summary.findingsByKind['adr-status-drift'] = report.findings.length;

  if (reportPath) {
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  return report;
}

export function summarizeAdrStatusReport(report) {
  return `check-adr-status-consistency scanned=${report.summary.totalScanned} declarations=${report.summary.totalDeclarations} findings adr-status-drift=${report.summary.findingsByKind['adr-status-drift']}`;
}

function collectSupersessionDeclarations(line) {
  const declarations = new Map();
  const explicitBy = /\bADR-0*(\d{1,4})\b\s*(?:\((?:[^)]*\b)?superseded\s+by\s+\bADR-0*\d{1,4}\b[^)]*\)|(?:is|was)?\s*superseded\s+by\s+\bADR-0*\d{1,4}\b)/gi;
  for (const match of line.matchAll(explicitBy)) {
    addDeclaration(declarations, match[1], line);
  }

  const patterns = [
    /\bADR-0*(\d{1,4})\b\s+(?:will\s+be\s+)?superseded\b/gi,
    /\bADR-0*(\d{1,4})\b\s+\([^)]*superseded[^)]*\)/gi,
    /\bADR-0*(\d{1,4})\b\s+marked\s+superseded\b/gi
  ];
  for (const pattern of patterns) {
    for (const match of line.matchAll(pattern)) {
      addDeclaration(declarations, match[1], line);
    }
  }
  for (const match of line.matchAll(/\bsupersedes?\b\s*:?\s*(?=\bADR-0*\d{1,4}\b)/gi)) {
    addTrailingAdrDeclarations(declarations, line, match.index + match[0].length);
  }
  for (const match of line.matchAll(/\bsuperseded(?:-by)?\s+(?=\bADR-0*\d{1,4}\b)/gi)) {
    addTrailingAdrDeclarations(declarations, line, match.index + match[0].length);
  }
  return [...declarations.values()];
}

function addDeclaration(declarations, id, line) {
  const padded = String(Number(id)).padStart(4, '0');
  declarations.set(padded, {
    adr: `ADR-${padded}`,
    id: padded,
    declarationText: line.trim()
  });
}

function addTrailingAdrDeclarations(declarations, line, startIndex) {
  const rest = line.slice(startIndex);
  for (const match of rest.matchAll(/\bADR-0*(\d{1,4})\b/gi)) {
    addDeclaration(declarations, match[1], line);
  }
}

function evaluateDeclaration({ rootPath, filePath, lineNumber, declaration, adrIndex }) {
  const adr = adrIndex.get(declaration.id);
  if (!adr) {
    return {
      kind: 'adr-status-drift',
      adr: declaration.adr,
      declaredIn: {
        file: path.relative(rootPath, filePath) || path.basename(filePath),
        line: lineNumber
      },
      declarationText: declaration.declarationText,
      adrFile: null,
      status: null,
      expected: [...ACCEPTED_STATUSES],
      suggestion: 'Supersession declaration may be premature; create or locate the referenced ADR before declaring its status.'
    };
  }
  if (ACCEPTED_STATUSES.has(String(adr.status || '').toLowerCase())) return null;
  return {
    kind: 'adr-status-drift',
    adr: declaration.adr,
    declaredIn: {
      file: path.relative(rootPath, filePath) || path.basename(filePath),
      line: lineNumber
    },
    declarationText: declaration.declarationText,
    adrFile: formatResolvedPath(rootPath, adr.filePath),
    status: adr.status ?? null,
    expected: [...ACCEPTED_STATUSES]
  };
}

async function buildAdrIndex(decisionsDirs) {
  const candidates = new Map();
  for (const dir of decisionsDirs || []) {
    const root = path.resolve(dir);
    if (!(await pathExists(root))) continue;
    for (const scanRoot of [root, path.join(root, 'archive')]) {
      if (!(await pathExists(scanRoot))) continue;
      await walk(scanRoot, async (filePath, entry) => {
        if (!entry.isFile() || !filePath.endsWith('.md')) return;
        const match = path.basename(filePath).match(/^(\d{4})-/);
        if (!match) return;
        const item = {
          filePath,
          status: parseFrontmatterStatus(await readFile(filePath, 'utf8')),
          priority: adrFilePriority(filePath)
        };
        const existing = candidates.get(match[1]);
        if (!existing || item.priority < existing.priority) candidates.set(match[1], item);
      });
    }
  }
  return candidates;
}

function parseFrontmatterStatus(content) {
  const lines = content.split(/\r?\n/);
  if (lines[0] !== '---') return null;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index] === '---') break;
    const match = lines[index].match(/^status:\s*(.+?)\s*$/i);
    if (match) return match[1].trim().replace(/^["']|["']$/g, '');
  }
  return null;
}

function adrFilePriority(filePath) {
  const name = path.basename(filePath).toLowerCase();
  if (/^\d{4}-(?:amendment|.*amendment|draft|.*draft)/.test(name)) return 2;
  return 1;
}

function formatResolvedPath(rootPath, filePath) {
  const base = path.extname(rootPath) ? path.dirname(rootPath) : rootPath;
  const relative = path.relative(base, filePath);
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) return relative;
  return filePath;
}

async function findScannableMarkdownFiles(rootPath) {
  let rootStat;
  try {
    rootStat = await stat(rootPath);
  } catch {
    return [];
  }
  if (rootStat.isFile()) return rootPath.endsWith('.md') ? [rootPath] : [];
  const files = [];
  await walk(rootPath, async (filePath, entry) => {
    if (!entry.isFile() || !filePath.endsWith('.md')) return;
    if (isPriorityScopeFile(rootPath, filePath)) files.push(filePath);
  });
  return files.sort();
}

function isPriorityScopeFile(rootPath, filePath) {
  const relative = path.relative(rootPath, filePath).replace(/\\/g, '/');
  if (relative === 'cocoder/PRIORITIES.md' || relative === 'PRIORITIES.md') return true;
  if (relative.startsWith('cocoder/priorities/') || relative.startsWith('priorities/')) return true;
  if (relative.startsWith('cocoder/plans/archive/') || relative.startsWith('plans/archive/')) return false;
  if (relative.startsWith('cocoder/plans/') || relative.startsWith('plans/')) return true;
  return false;
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
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const filePath = path.join(root, entry.name);
    if (entry.isDirectory()) await walk(filePath, visit);
    else await visit(filePath, entry);
  }
}
