import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathExists } from '../lib/fs-utils.mjs';

const DEFAULT_THRESHOLD_DAYS = 30;
const FINDING_KINDS = [
  'doc-freshness-stale',
  'doc-freshness-missing-stamp',
  'doc-freshness-unparseable-date'
];

export async function checkDocFreshness({
  root,
  reportPath,
  decisionsDirs = [path.join(process.cwd(), 'decisions')],
  thresholdDays = DEFAULT_THRESHOLD_DAYS,
  now = new Date().toISOString()
} = {}) {
  if (!root) throw new Error('root is required');
  const rootPath = path.resolve(root);
  const numericThresholdDays = Number.isFinite(Number(thresholdDays)) ? Number(thresholdDays) : DEFAULT_THRESHOLD_DAYS;
  const architectureFiles = await findArchitectureFiles(rootPath);
  const adrFiles = await findAdrFiles(decisionsDirs);
  const report = {
    ok: true,
    advisory: true,
    root: rootPath,
    generatedAt: now,
    thresholdDays: numericThresholdDays,
    summary: {
      totalScanned: architectureFiles.length + adrFiles.length,
      architectureFiles: architectureFiles.length,
      adrFiles: adrFiles.length,
      totalFindings: 0,
      findingsByKind: Object.fromEntries(FINDING_KINDS.map((kind) => [kind, 0]))
    },
    findings: []
  };

  for (const filePath of architectureFiles) {
    const finding = await evaluateFreshness({
      rootPath,
      filePath,
      category: 'architecture',
      requireStamp: true,
      thresholdDays: numericThresholdDays,
      now
    });
    if (finding) report.findings.push(finding);
  }

  for (const filePath of adrFiles) {
    const finding = await evaluateFreshness({
      rootPath,
      filePath,
      category: 'adr',
      requireStamp: false,
      thresholdDays: numericThresholdDays,
      now
    });
    if (finding) report.findings.push(finding);
  }

  report.summary.totalFindings = report.findings.length;
  for (const finding of report.findings) {
    report.summary.findingsByKind[finding.kind] += 1;
  }

  if (reportPath) {
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  return report;
}

export function summarizeDocFreshnessReport(report) {
  const counts = report.summary.findingsByKind;
  return `check-doc-freshness scanned=${report.summary.totalScanned} findings stale=${counts['doc-freshness-stale']} missing-stamp=${counts['doc-freshness-missing-stamp']} unparseable-date=${counts['doc-freshness-unparseable-date']}`;
}

async function evaluateFreshness({ rootPath, filePath, category, requireStamp, thresholdDays, now }) {
  const field = readFrontmatterField(await readFile(filePath, 'utf8'), 'last-verified');
  if (!field.present || isNullishFieldValue(field.value)) {
    if (!requireStamp) return null;
    return {
      kind: 'doc-freshness-missing-stamp',
      file: formatReportPath(rootPath, filePath),
      category,
      field: 'last-verified',
      thresholdDays,
      expected: `<= ${thresholdDays} days old`
    };
  }

  const parsed = parseDateField(field.value);
  if (!parsed) {
    return {
      kind: 'doc-freshness-unparseable-date',
      file: formatReportPath(rootPath, filePath),
      category,
      field: 'last-verified',
      value: field.value,
      thresholdDays,
      expected: 'YYYY-MM-DD'
    };
  }

  const ageDays = calculateAgeDays(parsed, now);
  if (ageDays > thresholdDays) {
    return {
      kind: 'doc-freshness-stale',
      file: formatReportPath(rootPath, filePath),
      category,
      field: 'last-verified',
      value: field.value,
      ageDays,
      thresholdDays,
      expected: `<= ${thresholdDays} days old`
    };
  }
  return null;
}

function readFrontmatterField(content, fieldName) {
  const lines = content.split(/\r?\n/);
  if (lines[0] !== '---') return { present: false, value: null };
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index] === '---') break;
    const match = lines[index].match(/^([A-Za-z0-9_-]+):\s*(.*?)\s*$/);
    if (!match || match[1].toLowerCase() !== fieldName.toLowerCase()) continue;
    return { present: true, value: cleanYamlScalar(match[2]) };
  }
  return { present: false, value: null };
}

function cleanYamlScalar(value) {
  return String(value || '')
    .replace(/\s+#.*$/, '')
    .trim()
    .replace(/^["']|["']$/g, '');
}

function isNullishFieldValue(value) {
  return value === '' || String(value).toLowerCase() === 'null' || value === '~';
}

function parseDateField(value) {
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

function calculateAgeDays(verifiedAt, now) {
  const nowDate = new Date(now);
  const nowUtcMidnight = Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), nowDate.getUTCDate());
  return Math.floor((nowUtcMidnight - verifiedAt.getTime()) / 86400000);
}

async function findArchitectureFiles(rootPath) {
  let rootStat;
  try {
    rootStat = await stat(rootPath);
  } catch {
    return [];
  }
  if (rootStat.isFile()) return path.basename(rootPath) === 'ARCHITECTURE.md' ? [rootPath] : [];
  const files = [];
  await walk(rootPath, async (filePath, entry) => {
    if (entry.isFile() && path.basename(filePath) === 'ARCHITECTURE.md') files.push(filePath);
  });
  return files.sort();
}

async function findAdrFiles(decisionsDirs) {
  const files = new Set();
  for (const dir of decisionsDirs || []) {
    const root = path.resolve(dir);
    if (!(await pathExists(root))) continue;
    for (const scanRoot of [root, path.join(root, 'archive')]) {
      if (!(await pathExists(scanRoot))) continue;
      await walk(scanRoot, async (filePath, entry) => {
        if (!entry.isFile() || !filePath.endsWith('.md')) return;
        if (/^\d{4}-.*\.md$/.test(path.basename(filePath))) files.add(filePath);
      });
    }
  }
  return [...files].sort();
}

function formatReportPath(rootPath, filePath) {
  const base = path.extname(rootPath) ? path.dirname(rootPath) : rootPath;
  const relative = path.relative(base, filePath);
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) return relative;
  return filePath;
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
    if (shouldSkipEntry(entry.name)) continue;
    const filePath = path.join(root, entry.name);
    if (entry.isDirectory()) await walk(filePath, visit);
    else await visit(filePath, entry);
  }
}

function shouldSkipEntry(name) {
  return name === 'node_modules'
    || name === '.git'
    || name === '.claude'
    || name === 'archive'
    || /^\.bench-repo/.test(name);
}
