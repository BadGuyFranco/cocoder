import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadContracts, validateInstance } from './contracts.mjs';
import { pathExists, readJson, sha256String, writeJson } from './fs-utils.mjs';

const DEFECT_TYPES = new Set([
  'gate-failure',
  'stale-doc',
  'missing-verification',
  'adapter-failure',
  'process-failure',
  'manual-intervention',
  'evidence-gap',
  'deferred-live-enforcement'
]);

export async function buildImprovementArtifact(input, { contractsDir, outputPath } = {}) {
  const artifact = normalizeImprovementArtifact(input);
  const validation = await validateImprovementArtifact(artifact, { contractsDir });
  if (validation.ok && outputPath) await writeJson(outputPath, artifact);
  return { ok: validation.ok, artifact, outputPath: outputPath || '', issues: validation.issues };
}

export async function validateImprovementArtifact(artifactOrPath, { contractsDir } = {}) {
  const artifact = typeof artifactOrPath === 'string' ? await readJson(artifactOrPath) : artifactOrPath;
  const issues = [];
  if (!contractsDir) issues.push(issue('missing-contracts-dir', 'self-healing validation requires contractsDir'));
  else {
    const contracts = await loadContracts(contractsDir);
    const errors = validateInstance(contracts.get('self-healing-artifact'), artifact);
    for (const error of errors) issues.push(issue('contract-invalid', error));
  }

  if (!DEFECT_TYPES.has(artifact?.defectType)) {
    issues.push(issue('invalid-defect-type', `defectType must be one of ${[...DEFECT_TYPES].join(', ')}`));
  }
  for (const field of ['classification', 'immediateRecovery', 'permanentHomeRecommendation', 'owner']) {
    if (typeof artifact?.[field] !== 'string' || artifact[field].trim() === '') {
      issues.push(issue('missing-required-text', `${field} must be a non-empty string`));
    }
  }
  if (!Array.isArray(artifact?.evidence) || artifact.evidence.length === 0) {
    issues.push(issue('missing-evidence', 'evidence must be a non-empty array'));
  }
  if (typeof artifact?.founderDecisionNeeded !== 'boolean') {
    issues.push(issue('missing-founder-decision-flag', 'founderDecisionNeeded must be a boolean'));
  }
  if (typeof artifact?.backlogCandidate !== 'boolean') {
    issues.push(issue('missing-backlog-candidate-flag', 'backlogCandidate must be a boolean'));
  }
  if (artifact?.fixed === true && artifact?.durableRecord !== true) {
    issues.push(issue('fixed-without-durable-record', 'fixed failures must still set durableRecord=true'));
  }

  return { ok: issues.length === 0, artifact, issues };
}

export async function validateImprovementDirectory({ improvementsDir, contractsDir }) {
  const names = (await readdir(improvementsDir)).filter((name) => name.endsWith('.json')).sort();
  const artifacts = [];
  const failures = [];
  for (const name of names) {
    const filePath = path.join(improvementsDir, name);
    const result = await validateImprovementArtifact(filePath, { contractsDir });
    if (result.ok) artifacts.push({ ...result.artifact, filePath });
    else failures.push({ filePath, issues: result.issues });
  }
  return { ok: failures.length === 0, artifacts, failures };
}

export async function evaluateStaleDocs(input, { now = new Date().toISOString(), contractsDir } = {}) {
  const issues = [];
  const docs = Array.isArray(input.docs) ? input.docs : [];
  if (docs.length === 0) issues.push(issue('missing-docs', 'docs must be a non-empty array'));

  const staleDocs = [];
  const improvementArtifacts = [];
  for (const doc of docs) {
    const config = typeof doc === 'string' ? { path: doc } : doc;
    const maxAgeDays = Number(config.maxAgeDays ?? input.maxAgeDays ?? 30);
    const evaluated = await evaluateDocFreshness(config.path, { now, maxAgeDays });
    if (!evaluated.ok) {
      staleDocs.push(evaluated);
      improvementArtifacts.push(normalizeImprovementArtifact({
        id: `stale-doc-${safeId(config.path)}`,
        createdAt: now,
        trigger: 'stale-doc',
        defectType: 'stale-doc',
        classification: evaluated.reason,
        owner: config.owner || 'bob',
        evidence: [config.path],
        immediateRecovery: 'Re-verify the document against current implementation and update last-verified metadata.',
        permanentHomeRecommendation: 'Keep architecture and operator docs tied to phase closeout verification.',
        founderDecisionNeeded: false,
        backlogCandidate: true,
        durableRecord: true
      }));
    }
  }

  if (contractsDir) {
    for (const artifact of improvementArtifacts) {
      const validation = await validateImprovementArtifact(artifact, { contractsDir });
      if (!validation.ok) issues.push(issue('generated-artifact-invalid', validation.issues.map((item) => item.detail).join('; ')));
    }
  }

  return { ok: issues.length === 0 && staleDocs.length === 0, checked: docs.length, staleDocs, improvementArtifacts, issues };
}

export async function buildAutonomyReport(input, { contractsDir, outputPath } = {}) {
  const artifactPaths = input.artifactPaths || [];
  const artifacts = [...(input.artifacts || [])];
  const issues = [];
  for (const artifactPath of artifactPaths) {
    if (!(await pathExists(artifactPath))) {
      issues.push(issue('missing-artifact', `artifact path missing: ${artifactPath}`));
      continue;
    }
    const validation = await validateImprovementArtifact(artifactPath, { contractsDir });
    if (!validation.ok) issues.push(issue('invalid-artifact', `${artifactPath}: ${validation.issues.map((item) => item.detail).join('; ')}`));
    else artifacts.push({ ...validation.artifact, filePath: artifactPath });
  }

  const report = {
    createdAt: input.createdAt || new Date().toISOString(),
    scope: input.scope || 'orchestration',
    artifactCount: artifacts.length,
    counts: {
      byTrigger: countBy(artifacts, 'trigger'),
      byDefectType: countBy(artifacts, 'defectType'),
      byOwner: countBy(artifacts, 'owner'),
      founderDecisionNeeded: artifacts.filter((artifact) => artifact.founderDecisionNeeded === true).length,
      backlogCandidates: artifacts.filter((artifact) => artifact.backlogCandidate === true).length
    },
    weakestAreas: weakestAreas(artifacts),
    improvementPassResults: input.improvementPassResults || [],
    processNotes: input.processNotes || [],
    dryRunOnly: true
  };

  if (outputPath && issues.length === 0) await writeJson(outputPath, report);
  return { ok: issues.length === 0, report, issues };
}

export async function loadImprovementArtifacts(improvementsDir, { contractsDir } = {}) {
  const directory = await validateImprovementDirectory({ improvementsDir, contractsDir });
  return directory.artifacts;
}

function normalizeImprovementArtifact(input) {
  const createdAt = input.createdAt || new Date().toISOString();
  const core = {
    trigger: input.trigger,
    defectType: input.defectType,
    classification: input.classification,
    evidence: input.evidence,
    immediateRecovery: input.immediateRecovery,
    permanentHomeRecommendation: input.permanentHomeRecommendation,
    founderDecisionNeeded: input.founderDecisionNeeded,
    owner: input.owner,
    backlogCandidate: input.backlogCandidate
  };
  return {
    id: input.id || `improvement-${sha256String(JSON.stringify(core)).slice(0, 12)}`,
    createdAt,
    ...core,
    durableRecord: input.durableRecord !== false,
    fixed: input.fixed === true,
    sourcePhase: input.sourcePhase || '',
    status: input.status || (input.fixed ? 'fixed-recorded' : 'open'),
    notes: input.notes || []
  };
}

async function evaluateDocFreshness(filePath, { now, maxAgeDays }) {
  if (!(await pathExists(filePath))) {
    return { ok: false, path: filePath, reason: 'document missing', lastVerified: '', ageDays: null, maxAgeDays };
  }
  const raw = await readFile(filePath, 'utf8');
  const frontmatter = parseFrontmatter(raw);
  const lastVerified = frontmatter['last-verified'] || '';
  if (!lastVerified) {
    return { ok: false, path: filePath, reason: 'missing last-verified frontmatter', lastVerified, ageDays: null, maxAgeDays };
  }
  const ageMs = Date.parse(now) - Date.parse(lastVerified);
  const ageDays = Math.floor(ageMs / 86400000);
  if (Number.isNaN(ageMs)) {
    return { ok: false, path: filePath, reason: 'invalid last-verified frontmatter', lastVerified, ageDays: null, maxAgeDays };
  }
  if (ageDays > maxAgeDays) {
    return { ok: false, path: filePath, reason: `last verified ${ageDays} days ago`, lastVerified, ageDays, maxAgeDays };
  }
  return { ok: true, path: filePath, reason: 'fresh', lastVerified, ageDays, maxAgeDays };
}

function parseFrontmatter(raw) {
  if (!raw.startsWith('---\n')) return {};
  const end = raw.indexOf('\n---', 4);
  if (end === -1) return {};
  const lines = raw.slice(4, end).split('\n');
  const values = {};
  for (const line of lines) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match) values[match[1]] = match[2].trim();
  }
  return values;
}

function countBy(items, field) {
  const counts = {};
  for (const item of items) counts[item[field]] = (counts[item[field]] || 0) + 1;
  return counts;
}

function weakestAreas(artifacts) {
  return Object.entries(countBy(artifacts, 'defectType'))
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([defectType, count]) => ({ defectType, count }));
}

function safeId(value) {
  return value.replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'doc';
}

function issue(code, detail) {
  return { code, severity: 'block', detail };
}
