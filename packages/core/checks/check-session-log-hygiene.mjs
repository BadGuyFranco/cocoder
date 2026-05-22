import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_MAX_ENTRIES = 10;
const DEFAULT_MAX_ENTRY_LINES = 20;
const DEFAULT_MAX_ENTRY_CHARS = 2500;
const FINDING_KINDS = [
  'session-log-missing',
  'session-log-entry-missing',
  'session-log-entry-count-over-limit',
  'session-log-entry-too-long',
  'session-log-entry-too-large',
  'session-log-order-drift',
  'session-log-file-inventory'
];

export async function checkSessionLogHygiene({
  root,
  reportPath,
  sessionLogFile,
  maxEntries = DEFAULT_MAX_ENTRIES,
  maxEntryLines = DEFAULT_MAX_ENTRY_LINES,
  maxEntryChars = DEFAULT_MAX_ENTRY_CHARS,
  now = new Date().toISOString()
} = {}) {
  if (!root) throw new Error('root is required');
  const rootPath = path.resolve(root);
  const filePath = path.resolve(sessionLogFile || path.join(rootPath, 'cocoder/SESSION_LOG.md'));
  const report = {
    ok: true,
    advisory: true,
    root: rootPath,
    generatedAt: now,
    sessionLogFile: formatReportPath(rootPath, filePath),
    maxEntries: Number(maxEntries),
    maxEntryLines: Number(maxEntryLines),
    maxEntryChars: Number(maxEntryChars),
    summary: {
      totalScanned: 1,
      totalEntries: 0,
      totalFindings: 0,
      findingsByKind: Object.fromEntries(FINDING_KINDS.map((kind) => [kind, 0]))
    },
    findings: []
  };

  let content = '';
  try {
    content = await readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    addFinding(report, {
      kind: 'session-log-missing',
      file: formatReportPath(rootPath, filePath),
      expected: 'SESSION_LOG.md exists and contains newest-first session entries.',
      suggestion: 'Restore SESSION_LOG.md from git or create a concise current handoff entry.'
    });
    return finish(report, reportPath);
  }

  const entries = parseEntries(content);
  report.summary.totalEntries = entries.length;
  if (entries.length === 0) {
    addFinding(report, {
      kind: 'session-log-entry-missing',
      file: formatReportPath(rootPath, filePath),
      expected: 'At least one `## YYYY-MM-DD` session entry is present.',
      suggestion: 'Add a concise newest-first session handoff entry.'
    });
  }

  if (entries.length > Number(maxEntries)) {
    addFinding(report, {
      kind: 'session-log-entry-count-over-limit',
      file: formatReportPath(rootPath, filePath),
      entryCount: entries.length,
      maxEntries: Number(maxEntries),
      expected: `SESSION_LOG.md keeps at most ${maxEntries} live entries.`,
      suggestion: 'Move oldest entries to SESSION_LOG_ARCHIVE.md, keeping only the newest entries live.'
    });
  }

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry.lineCount > Number(maxEntryLines)) {
      addFinding(report, {
        kind: 'session-log-entry-too-long',
        file: formatReportPath(rootPath, filePath),
        line: entry.startLine,
        lineCount: entry.lineCount,
        maxEntryLines: Number(maxEntryLines),
        expected: `Each session entry is ${maxEntryLines} lines or fewer.`,
        suggestion: 'Condense the live entry to outcomes, unfinished work, and next-session pickup only.'
      });
    }
    if (entry.charCount > Number(maxEntryChars)) {
      addFinding(report, {
        kind: 'session-log-entry-too-large',
        file: formatReportPath(rootPath, filePath),
        line: entry.startLine,
        charCount: entry.charCount,
        maxEntryChars: Number(maxEntryChars),
        expected: `Each session entry is ${maxEntryChars} characters or fewer.`,
        suggestion: 'Move long-form run history to run artifacts and leave a short pointer in SESSION_LOG.md.'
      });
    }
    const inventoryReason = classifyInventory(entry.body);
    if (inventoryReason) {
      addFinding(report, {
        kind: 'session-log-file-inventory',
        file: formatReportPath(rootPath, filePath),
        line: entry.startLine,
        reason: inventoryReason,
        expected: 'Entries summarize outcomes and do not inventory files, commit SHAs, LOC counts, or test-count dumps.',
        suggestion: 'Replace mechanical details with outcome-level summary and point to git log or run artifacts.'
      });
    }
    if (index > 0 && entry.date > entries[index - 1].date) {
      addFinding(report, {
        kind: 'session-log-order-drift',
        file: formatReportPath(rootPath, filePath),
        line: entry.startLine,
        previousLine: entries[index - 1].startLine,
        previousDate: entries[index - 1].date,
        currentDate: entry.date,
        expected: 'Entries are reverse-chronological, newest first.',
        suggestion: 'Move the newer entry above older entries before committing.'
      });
    }
  }

  return finish(report, reportPath);
}

export function summarizeSessionLogHygieneReport(report) {
  const counts = report.summary.findingsByKind;
  return `check-session-log-hygiene scanned=${report.summary.totalScanned} findings=${report.summary.totalFindings} entries=${report.summary.totalEntries} count=${counts['session-log-entry-count-over-limit']} length=${counts['session-log-entry-too-long']} size=${counts['session-log-entry-too-large']} order=${counts['session-log-order-drift']} inventory=${counts['session-log-file-inventory']} missing=${counts['session-log-missing'] + counts['session-log-entry-missing']}`;
}

function parseEntries(content) {
  const lines = content.split(/\r?\n/);
  const entries = [];
  let current = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(/^## (20\d\d-\d\d-\d\d)\b/);
    if (match) {
      if (current) entries.push(finishEntry(current));
      current = {
        startLine: index + 1,
        date: match[1],
        lines: [line]
      };
      continue;
    }
    if (current) current.lines.push(line);
  }
  if (current) entries.push(finishEntry(current));
  return entries;
}

function finishEntry(entry) {
  while (entry.lines.at(-1) === '') entry.lines.pop();
  entry.body = entry.lines.join('\n');
  entry.lineCount = entry.lines.length;
  entry.charCount = entry.body.length;
  return entry;
}

function classifyInventory(body) {
  const text = String(body || '');
  if (/\*\*Commits?\.\*\*/i.test(text)) return 'commit-section';
  if (/\b\d+\s+files?\s+changed\b/i.test(text)) return 'files-changed-count';
  if (/\b\d+\s+LOC\b/i.test(text) || /[+-]\d+\s*\/\s*-\d+/.test(text)) return 'loc-count';
  const shaHits = text.match(/\b[0-9a-f]{7,40}\b/gi) || [];
  if (shaHits.length > 3) return 'commit-sha-list';
  const pathHits = text.match(/\b[\w.-]+\/[\w./-]+\.(?:md|mjs|js|ts|tsx|json|sh|yml|yaml|css|html)\b/g) || [];
  if (pathHits.length > 6) return 'file-path-inventory';
  return '';
}

async function finish(report, reportPath) {
  report.summary.totalFindings = report.findings.length;
  report.ok = report.findings.length === 0;
  if (reportPath) {
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  return report;
}

function addFinding(report, finding) {
  report.findings.push(finding);
  report.summary.findingsByKind[finding.kind] += 1;
}

function formatReportPath(rootPath, filePath) {
  const relative = path.relative(rootPath, filePath);
  return relative && !relative.startsWith('..') ? relative : filePath;
}
