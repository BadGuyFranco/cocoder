import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathExists, readJson } from '../lib/fs-utils.mjs';

const FINDING_KINDS = [
  'write-authority-drift',
  'write-authority-claim-narrative'
];
const PERSONA_TOKENS = new Set(['bob', 'ian', 'oscar', 'phil', 'quinn', 'talia']);
const NEGATION_PATTERN = /\b(?:not|never|excluded|do not|does not|outside)\b/i;

export async function checkWriteAuthority({
  root,
  reportPath,
  raciPath = path.join(process.cwd(), 'cocoder/standards/raci.json'),
  boundariesDir = path.join(process.cwd(), 'cocoder/priority-boundaries'),
  routesDir = path.join(process.cwd(), 'cocoder/routes'),
  personasDir = path.join(process.cwd(), 'cocoder/personas'),
  now = new Date().toISOString()
} = {}) {
  if (!root) throw new Error('root is required');
  const rootPath = path.resolve(root);
  const raci = await readJson(raciPath);
  const surfaces = buildSurfaceRules(raci);
  const approvedExceptions = normalizeApprovedExceptions(raci.approvedExceptions || []);
  const boundaryFiles = await findJsonFiles(boundariesDir, (name) => name.endsWith('.boundary.json'));
  const routeFiles = await findJsonFiles(routesDir, (name) => name.endsWith('.json'));
  const personaFiles = await findJsonFiles(personasDir, (name) => name.endsWith('.json'));
  const report = {
    ok: true,
    advisory: true,
    root: rootPath,
    generatedAt: now,
    raciPath: formatReportPath(rootPath, path.resolve(raciPath)),
    summary: {
      totalScanned: boundaryFiles.length + routeFiles.length + personaFiles.length,
      boundaryFiles: boundaryFiles.length,
      routeFiles: routeFiles.length,
      personaFiles: personaFiles.length,
      exceptionsApplied: 0,
      totalFindings: 0,
      findingsByKind: Object.fromEntries(FINDING_KINDS.map((kind) => [kind, 0]))
    },
    findings: []
  };

  for (const filePath of boundaryFiles) {
    appendScanResult(report, await scanBoundaryFile({ rootPath, filePath, surfaces, approvedExceptions }));
  }
  for (const filePath of routeFiles) {
    appendScanResult(report, await scanRouteFile({ rootPath, filePath, surfaces, approvedExceptions }));
  }
  for (const filePath of personaFiles) {
    appendScanResult(report, { findings: await scanPersonaFile({ rootPath, filePath, surfaces }), exceptionsApplied: 0 });
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

export function summarizeWriteAuthorityReport(report) {
  const counts = report.summary.findingsByKind;
  return `check-write-authority scanned=${report.summary.totalScanned} findings drift=${counts['write-authority-drift']} narrative=${counts['write-authority-claim-narrative']} exceptionsApplied=${report.summary.exceptionsApplied}`;
}

function appendScanResult(report, result) {
  report.findings.push(...result.findings);
  report.summary.exceptionsApplied += result.exceptionsApplied;
}

async function scanBoundaryFile({ rootPath, filePath, surfaces, approvedExceptions }) {
  const boundary = await readJson(filePath);
  return scanWriterLanes({
    rootPath,
    filePath,
    writerLanes: boundary.writerLanes,
    pointerBase: '/writerLanes',
    surfaces,
    approvedExceptions
  });
}

async function scanRouteFile({ rootPath, filePath, surfaces, approvedExceptions }) {
  const route = await readJson(filePath);
  const result = emptyScanResult();
  if (route.writerLanes && !Array.isArray(route.writerLanes)) {
    mergeScanResult(result, scanWriterLanes({
      rootPath,
      filePath,
      writerLanes: route.writerLanes,
      pointerBase: '/writerLanes',
      surfaces,
      approvedExceptions
    }));
  }
  if (route.writeBoundary?.allowed) {
    const personas = route.orchestratorCommit?.writerLanes || route.writePolicy?.writerLanes || route.writerLanes;
    const writerPersonas = Array.isArray(personas) ? personas : ['unknown'];
    for (const persona of writerPersonas) {
      mergeScanResult(result, scanAllowedClaims({
        rootPath,
        filePath,
        persona,
        allowed: route.writeBoundary.allowed,
        excluded: route.writeBoundary.excluded || [],
        pointerBase: `/writeBoundary/allowed`,
        surfaces,
        approvedExceptions
      }));
    }
  }
  return result;
}

async function scanPersonaFile({ rootPath, filePath, surfaces }) {
  const persona = await readJson(filePath);
  const boundaries = Array.isArray(persona.boundaries) ? persona.boundaries : [];
  const findings = [];
  for (let index = 0; index < boundaries.length; index += 1) {
    const text = String(boundaries[index] || '');
    for (const rule of surfaces.filter((item) => item.basename && item.primaryOwner !== 'active-lead-persona')) {
      const match = text.match(new RegExp(`\\b${escapeRegExp(rule.basename)}\\b`));
      if (!match || rule.primaryOwner === persona.id || hasNearbyNegation(text, match.index)) continue;
      findings.push({
        kind: 'write-authority-claim-narrative',
        persona: persona.id,
        surface: rule.surface,
        claimedIn: {
          file: formatReportPath(rootPath, filePath),
          pointer: `/boundaries/${index}`,
          line: findLineNumber(await readFile(filePath, 'utf8'), text)
        },
        expectedOwner: rule.primaryOwner,
        expected: `${rule.primaryOwner} (per cocoder/standards/raci.json)`,
        text
      });
    }
  }
  return findings;
}

function scanWriterLanes({ rootPath, filePath, writerLanes, pointerBase, surfaces, approvedExceptions }) {
  if (!writerLanes || Array.isArray(writerLanes) || typeof writerLanes !== 'object') return emptyScanResult();
  const result = emptyScanResult();
  for (const [persona, lane] of Object.entries(writerLanes)) {
    mergeScanResult(result, scanAllowedClaims({
      rootPath,
      filePath,
      persona,
      allowed: Array.isArray(lane.allowed) ? lane.allowed : [],
      excluded: Array.isArray(lane.excluded) ? lane.excluded : [],
      pointerBase: `${pointerBase}/${escapeJsonPointer(persona)}/allowed`,
      surfaces,
      approvedExceptions
    }));
  }
  return result;
}

function scanAllowedClaims({ rootPath, filePath, persona, allowed, excluded, pointerBase, surfaces, approvedExceptions }) {
  const result = emptyScanResult();
  for (let index = 0; index < allowed.length; index += 1) {
    const claimedPath = normalizeClaimPath(allowed[index]);
    for (const rule of surfaces) {
      if (rule.skip || !rule.matches(claimedPath)) continue;
      for (const expectedOwner of rule.expectedOwners(claimedPath)) {
        if (expectedOwner === 'active-lead-persona' || expectedOwner === persona) continue;
        if (isExcluded(rule.targetPath(claimedPath, expectedOwner), excluded)) continue;
        if (hasApprovedException({ approvedExceptions, persona, surface: rule.surface, claimedPath })) {
          // Founder-authorized cross-persona grants remain auditable without drift noise.
          result.exceptionsApplied += 1;
          continue;
        }
        result.findings.push({
          kind: 'write-authority-drift',
          persona,
          surface: rule.surface,
          claimedPath,
          claimedIn: {
            file: formatReportPath(rootPath, filePath),
            pointer: `${pointerBase}/${index}`
          },
          expectedOwner,
          expected: `${expectedOwner} (per cocoder/standards/raci.json)`
        });
      }
    }
  }
  return result;
}

function emptyScanResult() {
  return { findings: [], exceptionsApplied: 0 };
}

function mergeScanResult(target, source) {
  target.findings.push(...source.findings);
  target.exceptionsApplied += source.exceptionsApplied;
  return target;
}

function buildSurfaceRules(raci) {
  const ownerBySurface = new Map((raci.surfaces || []).map((entry) => [entry.surface, entry.primaryOwner]));
  return [
    exactRule('../SESSION_LOG.md', 'cocoder/SESSION_LOG.md', ownerBySurface.get('../SESSION_LOG.md'), 'SESSION_LOG.md'),
    exactRule('../PRIORITIES.md', 'cocoder/PRIORITIES.md', ownerBySurface.get('../PRIORITIES.md'), 'PRIORITIES.md'),
    exactRule('../TICKETS.md and ticketing convention', 'cocoder/TICKETS.md', ownerBySurface.get('../TICKETS.md and ticketing convention'), 'TICKETS.md'),
    {
      surface: 'checklists/shared/',
      primaryOwner: ownerBySurface.get('checklists/shared/'),
      matches: (claimPath) => pathContainsClaim(claimPath, 'cocoder/personas/checklists/shared/'),
      expectedOwners: () => [ownerBySurface.get('checklists/shared/')],
      targetPath: () => 'cocoder/personas/checklists/shared/'
    },
    {
      surface: 'checklists/<persona>/',
      primaryOwner: ownerBySurface.get('checklists/<persona>/'),
      matches: (claimPath) => normalizeClaimPath(claimPath).startsWith('cocoder/personas/checklists/'),
      expectedOwners: (claimPath) => {
        const token = pathTokenAfter(claimPath, 'cocoder/personas/checklists/');
        if (token && token !== 'shared' && PERSONA_TOKENS.has(token)) return [token];
        if (claimPath === 'cocoder/personas/checklists/' || claimPath === 'cocoder/personas/checklists') {
          return [...PERSONA_TOKENS].filter((persona) => persona !== 'bob');
        }
        return [];
      },
      targetPath: (_claimPath, owner) => `cocoder/personas/checklists/${owner}/`
    },
    {
      surface: 'Persona playbooks *.md',
      primaryOwner: ownerBySurface.get('Persona playbooks *.md'),
      matches: (claimPath) => normalizeClaimPath(claimPath).startsWith('cocoder/personas/'),
      expectedOwners: (claimPath) => {
        const token = path.basename(claimPath, '.md');
        if (claimPath.endsWith('.md') && PERSONA_TOKENS.has(token)) return [token];
        return [];
      },
      targetPath: (_claimPath, owner) => `cocoder/personas/${owner}.md`
    },
    {
      surface: 'Priority closure sequence',
      skip: true,
      matches: () => false,
      expectedOwners: () => [],
      targetPath: () => null
    }
  ];
}

function exactRule(surface, target, owner, basename) {
  return {
    surface,
    primaryOwner: owner,
    basename,
    matches: (claimPath) => pathContainsClaim(claimPath, target),
    expectedOwners: () => [owner],
    targetPath: () => target
  };
}

function pathContainsClaim(claimPath, targetPath) {
  const claim = normalizeClaimPath(claimPath);
  const target = normalizeClaimPath(targetPath);
  if (claim === target) return true;
  if (claim.endsWith('/')) return target.startsWith(claim);
  return false;
}

function isExcluded(targetPath, excluded) {
  if (!targetPath) return false;
  return excluded.map(normalizeClaimPath).some((excludedPath) => pathContainsClaim(excludedPath, targetPath));
}

function normalizeApprovedExceptions(exceptions) {
  return exceptions
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({
      persona: String(entry.persona || ''),
      surface: String(entry.surface || ''),
      scope: normalizeClaimPath(entry.scope)
    }));
}

function hasApprovedException({ approvedExceptions, persona, surface, claimedPath }) {
  return approvedExceptions.some((exception) => (
    exception.persona === persona
    && exception.surface === surface
    && pathsArePrefixCompatible(claimedPath, exception.scope)
  ));
}

function pathsArePrefixCompatible(left, right) {
  const first = normalizeClaimPath(left);
  const second = normalizeClaimPath(right);
  return pathContainsClaim(first, second) || pathContainsClaim(second, first);
}

function normalizeClaimPath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, (match) => (match.length > 0 ? '/' : ''));
}

function pathTokenAfter(value, prefix) {
  const normalized = normalizeClaimPath(value);
  if (!normalized.startsWith(prefix)) return null;
  const rest = normalized.slice(prefix.length);
  return rest.split('/').filter(Boolean)[0] || null;
}

async function findJsonFiles(target, predicate) {
  const root = path.resolve(target);
  if (!(await pathExists(root))) return [];
  const rootStat = await stat(root);
  if (rootStat.isFile()) return predicate(path.basename(root)) ? [root] : [];
  const files = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && predicate(entry.name)) files.push(path.join(root, entry.name));
  }
  return files.sort();
}

function hasNearbyNegation(text, index) {
  const start = Math.max(0, index - 48);
  const end = Math.min(text.length, index + 80);
  return NEGATION_PATTERN.test(text.slice(start, end));
}

function findLineNumber(content, needle) {
  const before = content.slice(0, content.indexOf(needle));
  return before.split(/\r?\n/).length;
}

function formatReportPath(rootPath, filePath) {
  const relative = path.relative(rootPath, filePath);
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) return relative;
  return filePath;
}

function escapeJsonPointer(value) {
  return String(value).replace(/~/g, '~0').replace(/\//g, '~1');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
