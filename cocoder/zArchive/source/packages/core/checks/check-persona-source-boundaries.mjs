import { access, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const FINDING_KINDS = [
  'persona-source-boundary-missing',
  'legacy-teammate-helper-file-present',
  'legacy-teammate-helper-reference',
  'run-helper-signature-drift'
];

const LEGACY_HELPER_FILES = [
  'cocoder/personas/scripts/oscar/send-to-bob.sh',
  'cocoder/personas/scripts/oscar/wait-for-bob.sh',
  'cocoder/personas/scripts/oscar/launch-bob.sh',
  'cocoder/personas/scripts/ian/send-to-bob.sh',
  'cocoder/personas/scripts/ian/wait-for-bob.sh',
  'cocoder/personas/scripts/ian/launch-bob.sh',
  'cocoder/personas/scripts/session-control.sh'
];

const SCAN_ROOTS = [
  'AGENTS.md',
  'cocoder/AGENTS.md',
  'cocoder/personas',
  'cocoder/AGENTS.md',
  'cocoder/ARCHITECTURE.md',
  'cocoder/docs',
  'cocoder/personas/prompts'
];

const EXCLUDED_PARTS = new Set([
  'zArchive',
  'runs',
  'debug-runs',
  'consult-runs',
  'node_modules'
]);

const TEXT_EXTENSIONS = new Set(['.md', '.mjs', '.js', '.json', '.sh', '.command', '.txt']);

export async function checkPersonaSourceBoundaries({
  root,
  reportPath,
  now = new Date().toISOString()
} = {}) {
  if (!root) throw new Error('root is required');
  const rootPath = path.resolve(root);
  const report = {
    ok: true,
    advisory: true,
    root: rootPath,
    generatedAt: now,
    summary: {
      totalScanned: 0,
      totalFindings: 0,
      findingsByKind: Object.fromEntries(FINDING_KINDS.map((kind) => [kind, 0]))
    },
    findings: []
  };

  await requireBoundaryText(report, rootPath, 'cocoder/personas/AGENTS.md', [
    'private human/persona playbook source',
    'Runtime launch prompts are composed from `../orchestration/personas/prompts/`'
  ]);
  await requireBoundaryText(report, rootPath, 'cocoder/AGENTS.md', [
    'Runtime persona prompt source: `cocoder/personas/prompts/`',
    'Private playbook source: `cocoder/personas/`'
  ]);

  for (const legacyFile of LEGACY_HELPER_FILES) {
    if (await exists(path.join(rootPath, legacyFile))) {
      addFinding(report, {
        kind: 'legacy-teammate-helper-file-present',
        file: legacyFile,
        expected: 'Legacy teammate helper files are archived, not active.',
        suggestion: 'Use orchestration-generated run-local send helpers under runs/<run-id>/.'
      });
    }
  }

  const files = await collectScanFiles(rootPath);
  report.summary.totalScanned = files.length;
  for (const filePath of files) {
    const relative = formatReportPath(rootPath, filePath);
    const content = await readFile(filePath, 'utf8');
    const lines = content.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (line.match(/cocoder\/personas\/scripts\/(?:(?:oscar|ian)\/(?:send-to-bob|wait-for-bob|launch-bob)|session-control)\.sh/)) {
        addFinding(report, {
          kind: 'legacy-teammate-helper-reference',
          file: relative,
          line: index + 1,
          expected: 'Active docs reference orchestration-generated run-local helpers, not retired persona sender scripts.',
          suggestion: 'Replace the hardcoded legacy helper path with the run-local helper listed in the launch prompt.'
        });
      }
      if (line.match(/RUN_DIR\/send-to-[^\s]+\.sh\s+SESSION_NAME/)) {
        addFinding(report, {
          kind: 'run-helper-signature-drift',
          file: relative,
          line: index + 1,
          expected: 'Generated send helpers accept only the message body; lane/session are encoded in launch.json.',
          suggestion: 'Use `RUN_DIR/send-to-<lane>.sh "message"`.'
        });
      }
    });
  }

  report.summary.totalFindings = report.findings.length;
  report.ok = report.findings.length === 0;

  if (reportPath) {
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  return report;
}

export function summarizePersonaSourceBoundaryReport(report) {
  const counts = report.summary.findingsByKind;
  return `check-persona-source-boundaries scanned=${report.summary.totalScanned} findings=${report.summary.totalFindings} missingBoundary=${counts['persona-source-boundary-missing']} legacyFiles=${counts['legacy-teammate-helper-file-present']} legacyRefs=${counts['legacy-teammate-helper-reference']} signature=${counts['run-helper-signature-drift']}`;
}

async function requireBoundaryText(report, rootPath, relativePath, requiredSnippets) {
  const filePath = path.join(rootPath, relativePath);
  let content = '';
  try {
    content = await readFile(filePath, 'utf8');
  } catch {
    addFinding(report, {
      kind: 'persona-source-boundary-missing',
      file: relativePath,
      expected: 'Source-boundary document exists.',
      suggestion: 'Restore the persona source-boundary documentation.'
    });
    return;
  }

  for (const snippet of requiredSnippets) {
    if (!content.includes(snippet)) {
      addFinding(report, {
        kind: 'persona-source-boundary-missing',
        file: relativePath,
        expected: snippet,
        suggestion: 'Document the private playbook/runtime prompt split before changing persona behavior.'
      });
    }
  }
}

async function collectScanFiles(rootPath) {
  const files = [];
  for (const scanRoot of SCAN_ROOTS) {
    const fullPath = path.join(rootPath, scanRoot);
    if (!(await exists(fullPath))) continue;
    await walk(fullPath);
  }
  return files.sort();

  async function walk(filePath) {
    const relative = formatReportPath(rootPath, filePath);
    if (relative.split('/').some((part) => EXCLUDED_PARTS.has(part))) return;
    const info = await stat(filePath);
    if (info.isDirectory()) {
      for (const child of await readdir(filePath)) {
        await walk(path.join(filePath, child));
      }
      return;
    }
    if (!info.isFile()) return;
    if (!TEXT_EXTENSIONS.has(path.extname(filePath)) && path.basename(filePath) !== 'AGENTS.md') return;
    files.push(filePath);
  }
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function addFinding(report, finding) {
  report.findings.push(finding);
  report.summary.findingsByKind[finding.kind] += 1;
}

function formatReportPath(rootPath, filePath) {
  const relative = path.relative(rootPath, filePath).split(path.sep).join('/');
  return relative && !relative.startsWith('..') ? relative : filePath;
}
