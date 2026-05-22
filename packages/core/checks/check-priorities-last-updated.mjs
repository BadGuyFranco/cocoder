import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_MAX_CHARS = 600;
const FINDING_KINDS = [
  'priorities-last-updated-missing',
  'priorities-last-updated-duplicate',
  'priorities-last-updated-too-long',
  'priorities-last-updated-history-chain'
];

export async function checkPrioritiesLastUpdated({
  root,
  reportPath,
  priorityFile,
  maxChars = DEFAULT_MAX_CHARS,
  now = new Date().toISOString()
} = {}) {
  if (!root) throw new Error('root is required');
  const rootPath = path.resolve(root);
  const filePath = path.resolve(priorityFile || path.join(rootPath, 'cocoder/PRIORITIES.md'));
  const limit = Number(maxChars || DEFAULT_MAX_CHARS);
  const content = await readFile(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const matches = [];
  let inHtmlComment = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const startsComment = line.includes('<!--');
    const endsComment = line.includes('-->');
    const insideComment = inHtmlComment || startsComment;
    if (!insideComment && line.startsWith('Last updated:')) {
      matches.push({ line: index + 1, text: lines[index], length: lines[index].length });
    }
    if (startsComment && !endsComment) inHtmlComment = true;
    if (inHtmlComment && endsComment) inHtmlComment = false;
  }

  const report = {
    ok: true,
    advisory: true,
    root: rootPath,
    generatedAt: now,
    priorityFile: formatReportPath(rootPath, filePath),
    maxChars: limit,
    summary: {
      totalScanned: 1,
      lastUpdatedLines: matches.length,
      totalFindings: 0,
      findingsByKind: Object.fromEntries(FINDING_KINDS.map((kind) => [kind, 0]))
    },
    findings: []
  };

  if (matches.length === 0) {
    addFinding(report, {
      kind: 'priorities-last-updated-missing',
      file: formatReportPath(rootPath, filePath),
      expected: 'Exactly one top-level Last updated: line is required.',
      suggestion: 'Add `Last updated: <YYYY-MM-DD> — <one-or-two sentence current-state summary>; see SESSION_LOG.md for full run history.`'
    });
  }

  if (matches.length > 1) {
    for (const match of matches.slice(1)) {
      addFinding(report, {
        kind: 'priorities-last-updated-duplicate',
        file: formatReportPath(rootPath, filePath),
        line: match.line,
        length: match.length,
        expected: 'Exactly one Last updated: line.',
        suggestion: 'Keep the current-state line near the top of PRIORITIES.md and remove duplicate Last updated lines.'
      });
    }
  }

  for (const match of matches) {
    if (match.length > limit) {
      addFinding(report, {
        kind: 'priorities-last-updated-too-long',
        file: formatReportPath(rootPath, filePath),
        line: match.line,
        length: match.length,
        maxChars: limit,
        expected: `Last updated line length <= ${limit} characters.`,
        suggestion: 'Replace the line with a current-state summary and move run history to SESSION_LOG.md.'
      });
    }
    if (match.text.includes('Previous:')) {
      addFinding(report, {
        kind: 'priorities-last-updated-history-chain',
        file: formatReportPath(rootPath, filePath),
        line: match.line,
        length: match.length,
        expected: 'Last updated line does not contain Previous: history chains.',
        suggestion: 'Move historical run chain prose to SESSION_LOG.md and replace the line, never prepend.'
      });
    }
  }

  report.summary.totalFindings = report.findings.length;
  report.ok = report.findings.length === 0;

  if (reportPath) {
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  return report;
}

export function summarizePrioritiesLastUpdatedReport(report) {
  const counts = report.summary.findingsByKind;
  return `check-priorities-last-updated scanned=${report.summary.totalScanned} findings=${report.summary.totalFindings} lines=${report.summary.lastUpdatedLines} tooLong=${counts['priorities-last-updated-too-long']} previous=${counts['priorities-last-updated-history-chain']} duplicate=${counts['priorities-last-updated-duplicate']} missing=${counts['priorities-last-updated-missing']}`;
}

function addFinding(report, finding) {
  report.findings.push(finding);
  report.summary.findingsByKind[finding.kind] += 1;
}

function formatReportPath(rootPath, filePath) {
  const relative = path.relative(rootPath, filePath);
  return relative && !relative.startsWith('..') ? relative : filePath;
}
