import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { extractPrioritySlugs, pathExists, readJson } from '../lib/fs-utils.mjs';
import { routeGhostPriorityIssues } from '../lib/orchestration-issues.mjs';

const FINDING_KINDS = ['ghost-priority', 'dangling-adr'];
const ADR_REF_PATTERN = /\bADR-0*(\d{1,4})\b/gi;
const ADR_LINK_PATTERN = /\[ADR-0*(\d{1,4})]\(([^)]+)\)/gi;

export async function checkOrchestrationFragmentation({
  root,
  reportPath,
  priorityFile,
  routesDir,
  decisionsDir,
  decisionsIndex,
  now = new Date().toISOString()
} = {}) {
  if (!root) throw new Error('root is required');
  const rootPath = path.resolve(root);
  const priorityFilePath = path.resolve(priorityFile || path.join(rootPath, 'cocoder/PRIORITIES.md'));
  const routesDirPath = path.resolve(routesDir || path.join(rootPath, 'cocoder/routes'));
  const decisionsDirPath = path.resolve(decisionsDir || path.join(rootPath, 'cocoder/decisions'));
  const decisionsIndexPath = path.resolve(decisionsIndex || path.join(decisionsDirPath, 'README.md'));

  const prioritySlugs = await extractPrioritySlugs(priorityFilePath);
  const routeFiles = await findRouteFiles(routesDirPath);
  const report = {
    ok: true,
    advisory: true,
    root: rootPath,
    generatedAt: now,
    priorityFile: formatReportPath(rootPath, priorityFilePath),
    routesDir: formatReportPath(rootPath, routesDirPath),
    decisionsIndex: formatReportPath(rootPath, decisionsIndexPath),
    summary: {
      prioritySlugs: prioritySlugs.size,
      routesScanned: routeFiles.length,
      adrIndexRows: 0,
      pendingAdrReferences: 0,
      totalFindings: 0,
      findingsByKind: Object.fromEntries(FINDING_KINDS.map((kind) => [kind, 0]))
    },
    findings: []
  };

  for (const routeFile of routeFiles) {
    const route = await readJson(routeFile);
    for (const issue of routeGhostPriorityIssues(route, prioritySlugs)) {
      addFinding(report, {
        kind: 'ghost-priority',
        routeId: route.id || path.basename(routeFile, '.json'),
        routeFile: formatReportPath(rootPath, routeFile),
        slug: extractGhostSlug(issue.detail),
        issue
      });
    }
  }

  const adrScan = await scanDecisionsIndex({
    rootPath,
    decisionsDirPath,
    decisionsIndexPath
  });
  report.summary.adrIndexRows = adrScan.adrIndexRows;
  report.summary.pendingAdrReferences = adrScan.pendingAdrReferences;
  for (const finding of adrScan.findings) addFinding(report, finding);

  report.summary.totalFindings = report.findings.length;
  report.ok = report.findings.length === 0;

  if (reportPath) {
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  return report;
}

export function summarizeOrchestrationFragmentationReport(report) {
  const counts = report.summary.findingsByKind;
  return `check-orchestration-fragmentation routes=${report.summary.routesScanned} prioritySlugs=${report.summary.prioritySlugs} adrRows=${report.summary.adrIndexRows} findings=${report.summary.totalFindings} ghost-priority=${counts['ghost-priority']} dangling-adr=${counts['dangling-adr']}`;
}

async function findRouteFiles(routesDirPath) {
  let entries;
  try {
    entries = await readdir(routesDirPath, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(routesDirPath, entry.name))
    .sort();
}

async function scanDecisionsIndex({ rootPath, decisionsDirPath, decisionsIndexPath }) {
  const result = {
    adrIndexRows: 0,
    pendingAdrReferences: 0,
    findings: []
  };
  if (!(await pathExists(decisionsIndexPath))) return result;

  const lines = (await readFile(decisionsIndexPath, 'utf8')).split(/\r?\n/);
  let section = '';
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const heading = line.match(/^#{2,6}\s+(.+?)\s*$/);
    if (heading) {
      section = heading[1].trim().toLowerCase();
      continue;
    }

    if (isPendingProposedSection(section)) {
      result.pendingAdrReferences += collectAdrIds(line).length;
      continue;
    }

    if (section !== 'index' || !isAdrTableRow(line)) continue;
    result.adrIndexRows += 1;

    const refs = collectIndexedAdrRefs(line);
    for (const ref of refs) {
      const resolved = await resolveAdrRef({
        decisionsDirPath,
        decisionsIndexPath,
        id: ref.id,
        target: ref.target
      });
      if (resolved.exists) continue;
      result.findings.push({
        kind: 'dangling-adr',
        adr: `ADR-${ref.id}`,
        sourceFile: formatReportPath(rootPath, decisionsIndexPath),
        line: index + 1,
        linkedPath: ref.target || null,
        resolvedPath: formatReportPath(rootPath, resolved.path),
        expected: ref.target ? 'Linked ADR file exists.' : `An ADR file matching ${ref.id}-*.md exists.`,
        suggestion: 'Create the ADR file, correct the decisions index link, or move the reservation to the Pending / proposed section.'
      });
    }
  }
  return result;
}

function isPendingProposedSection(section) {
  return /\bpending\b|\bproposed\b/.test(section);
}

function isAdrTableRow(line) {
  return /^\s*\|/.test(line) && !/^\s*\|\s*-+/.test(line) && /\bADR-0*\d{1,4}\b/i.test(line);
}

function collectAdrIds(line) {
  return [...line.matchAll(ADR_REF_PATTERN)].map((match) => String(Number(match[1])).padStart(4, '0'));
}

function collectIndexedAdrRefs(line) {
  const linked = new Map();
  for (const match of line.matchAll(ADR_LINK_PATTERN)) {
    linked.set(String(Number(match[1])).padStart(4, '0'), match[2].trim());
  }
  return [...new Set(collectAdrIds(line))].map((id) => ({
    id,
    target: linked.get(id) || null
  }));
}

async function resolveAdrRef({ decisionsDirPath, decisionsIndexPath, id, target }) {
  if (target) {
    const stripped = stripAnchor(target);
    const resolved = path.isAbsolute(stripped)
      ? stripped
      : path.resolve(path.dirname(decisionsIndexPath), stripped);
    return { exists: await pathExists(resolved), path: resolved };
  }
  const filePath = await findAdrFile(decisionsDirPath, id);
  return {
    exists: Boolean(filePath),
    path: filePath || path.join(decisionsDirPath, `${id}-*.md`)
  };
}

async function findAdrFile(decisionsDirPath, id) {
  for (const dir of [decisionsDirPath, path.join(decisionsDirPath, 'archive')]) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    const match = entries.find((entry) => entry.isFile() && entry.name.startsWith(`${id}-`) && entry.name.endsWith('.md'));
    if (match) return path.join(dir, match.name);
  }
  return null;
}

function stripAnchor(value) {
  return String(value || '').replace(/#.*$/, '');
}

function extractGhostSlug(detail) {
  const match = String(detail || '').match(/\blists\s+(.+?)\s+in supportedPriorityOwners\b/);
  return match?.[1] || null;
}

function addFinding(report, finding) {
  report.findings.push(finding);
  report.summary.findingsByKind[finding.kind] += 1;
}

function formatReportPath(rootPath, filePath) {
  const relative = path.relative(rootPath, filePath);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : filePath;
}
