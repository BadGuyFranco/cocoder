import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathExists, readJson } from './fs-utils.mjs';

const AUTHORIZATION_BASES = new Set(['route-policy', 'founder-authorization']);

export async function recordSupersession({
  runDir,
  supersededLane,
  resolvingLane,
  authorizationBasis,
  findingsAddressed,
  supersessionEvidence,
  id,
  createdBy,
  now = new Date().toISOString()
} = {}) {
  if (!runDir) throw new Error('runDir is required');
  if (!supersededLane) throw new Error('supersededLane is required');
  if (!resolvingLane) throw new Error('resolvingLane is required');

  const runId = path.basename(runDir);
  const route = await readJson(path.join(runDir, 'route.snapshot.json'));
  const results = await readLaneResults(runDir);
  const superseded = results.get(supersededLane);
  const resolving = results.get(resolvingLane);
  if (!superseded) throw new Error(`No result exists for superseded lane ${supersededLane}`);
  if (!resolving) throw new Error(`No result exists for resolving lane ${resolvingLane}`);

  const requestedFindings = normalizeList(findingsAddressed);
  const resolvedFindings = requestedFindings;
  const explicitEvidence = normalizeList(supersessionEvidence);
  const record = {
    id: id || `supersession-${safeName(supersededLane)}-by-${safeName(resolvingLane)}-${compactTimestamp(now)}`,
    createdAt: now,
    runId,
    supersededLane,
    supersededResultPath: superseded.resultPath,
    resolvingLane,
    resolvingResultPath: resolving.resultPath,
    authorizationBasis,
    authorizationEvidence: authorizationEvidenceFor({ route, resolving, authorizationBasis }),
    supersessionEvidence: explicitEvidence,
    findingsAddressed: resolvedFindings,
    createdBy: createdBy || resolvingLane
  };

  const recordPath = path.join(runDir, 'supersessions', `${safeName(record.id)}.json`);
  const validation = await validateSupersessionRecord({
    runDir,
    route,
    results,
    record,
    recordPath
  });
  if (!validation.ok) {
    return {
      ok: false,
      status: 'blocked',
      record,
      recordPath,
      issues: validation.issues
    };
  }

  await mkdir(path.dirname(recordPath), { recursive: true });
  await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' });
  await ensureSupersessionLedgerEvents(runDir, [{
    record,
    recordPath,
    validation
  }]);
  return {
    ok: true,
    status: 'recorded',
    record,
    recordPath,
    issues: []
  };
}

export async function evaluateSupersessionsForRun({ runDir, results } = {}) {
  if (!runDir) throw new Error('runDir is required');
  const route = await readJson(path.join(runDir, 'route.snapshot.json'));
  const laneResults = results || await readLaneResults(runDir);
  const loaded = await loadSupersessionRecords(runDir);
  const valid = [];
  const invalid = [];
  for (const item of loaded) {
    const validation = await validateSupersessionRecord({
      runDir,
      route,
      results: laneResults,
      record: item.record,
      recordPath: item.recordPath
    });
    if (validation.ok) valid.push({ ...item, validation });
    else invalid.push({ ...item, issues: validation.issues });
  }
  return { route, records: loaded, valid, invalid };
}

export async function ensureSupersessionLedgerEvents(runDir, validSupersessions) {
  const eventsPath = path.join(runDir, 'events.jsonl');
  const existing = await readEvents(eventsPath);
  const existingKeys = new Set(existing
    .filter((event) => event.type === 'run.supersession.recorded')
    .map((event) => `${event.runId}:${event.supersessionRecordPath}`));
  for (const item of validSupersessions) {
    const event = supersessionEvent(runDir, item);
    const key = `${event.runId}:${event.supersessionRecordPath}`;
    if (existingKeys.has(key)) continue;
    await appendRunEvent(runDir, event);
    existingKeys.add(key);
  }
}

export async function readLaneResults(runDir) {
  const launchPath = path.join(runDir, 'launch.json');
  const launch = await readJson(launchPath);
  const results = new Map();
  for (const session of launch.sessions || []) {
    const lane = session.lane;
    const resultPath = session.resultPath || path.join(runDir, 'jobs', safeName(lane), 'result.json');
    const markdownResultPath = session.markdownResultPath || path.join(runDir, 'jobs', safeName(lane), 'result.md');
    if (!(await pathExists(resultPath))) continue;
    const result = await readJson(resultPath);
    results.set(lane, { lane, resultPath, markdownResultPath, result });
  }
  return results;
}

async function loadSupersessionRecords(runDir) {
  const dir = path.join(runDir, 'supersessions');
  if (!(await pathExists(dir))) return [];
  const names = (await readdir(dir)).filter((name) => name.endsWith('.json')).sort();
  const records = [];
  for (const name of names) {
    const recordPath = path.join(dir, name);
    try {
      records.push({ record: await readJson(recordPath), recordPath });
    } catch (error) {
      records.push({
        record: { id: name },
        recordPath,
        parseError: error.message || String(error)
      });
    }
  }
  return records;
}

async function validateSupersessionRecord({ runDir, route, results, record, recordPath }) {
  const issues = [];
  const required = [
    'id',
    'createdAt',
    'runId',
    'supersededLane',
    'supersededResultPath',
    'resolvingLane',
    'resolvingResultPath',
    'authorizationBasis',
    'authorizationEvidence',
    'supersessionEvidence',
    'findingsAddressed',
    'createdBy'
  ];
  for (const field of required) {
    if (record?.[field] === undefined) issues.push(issue('supersession-record-missing-field', `supersession record ${recordPath} missing required field ${field}`, { field }));
  }
  if (record?.runId !== path.basename(runDir)) {
    issues.push(issue('supersession-run-mismatch', `supersession record ${recordPath} runId must be ${path.basename(runDir)}`));
  }
  if (record?.createdAt && Number.isNaN(Date.parse(record.createdAt))) {
    issues.push(issue('supersession-created-at-invalid', `supersession record ${recordPath} createdAt must be an ISO datetime`));
  }
  if (record?.authorizationBasis && !AUTHORIZATION_BASES.has(record.authorizationBasis)) {
    issues.push(issue('supersession-authorization-basis-invalid', `authorizationBasis must be route-policy or founder-authorization, got ${record.authorizationBasis}`));
  }
  if (!Array.isArray(record?.findingsAddressed) || record.findingsAddressed.length === 0) {
    issues.push(issue('supersession-findings-missing', `supersession record ${recordPath} must list findingsAddressed`));
  }
  if (!Array.isArray(record?.supersessionEvidence) || record.supersessionEvidence.length === 0) {
    issues.push(issue('supersession-evidence-missing', `supersession record ${recordPath} must cite specific supersessionEvidence`));
  }

  const superseded = results.get(record?.supersededLane);
  const resolving = results.get(record?.resolvingLane);
  if (!superseded) {
    issues.push(issue('superseded-result-missing', `superseded lane result is missing: ${record?.supersededLane || 'unknown'}`));
  } else if (!samePath(record.supersededResultPath, superseded.resultPath, runDir)) {
    issues.push(issue('superseded-result-path-mismatch', `supersededResultPath must name ${superseded.resultPath}`));
  } else {
    issues.push(...await validateResultMarkdownPair({ lane: record.supersededLane, role: 'superseded', resultRecord: superseded }));
  }
  if (!resolving) {
    issues.push(issue('resolving-result-missing', `resolving lane result is missing: ${record?.resolvingLane || 'unknown'}`));
  } else {
    if (!samePath(record.resolvingResultPath, resolving.resultPath, runDir)) {
      issues.push(issue('resolving-result-path-mismatch', `resolvingResultPath must name ${resolving.resultPath}`));
    } else {
      issues.push(...await validateResultMarkdownPair({ lane: record.resolvingLane, role: 'resolving', resultRecord: resolving }));
    }
    if (resolving.result.status !== 'PASS') {
      issues.push(issue('resolving-result-not-pass', `resolving lane ${record.resolvingLane} must have PASS result, got ${resolving.result.status}`));
    }
  }

  if (record?.authorizationBasis === 'route-policy' && !routePolicyAllows(route, record.resolvingLane, record.supersededLane)) {
    issues.push(issue('route-policy-does-not-authorize-supersession', `route ${route?.id || 'unknown'} does not permit ${record.resolvingLane} to supersede ${record.supersededLane}`));
  }
  if (record?.authorizationBasis === 'founder-authorization' && !resolving?.result?.founderAcceptance) {
    issues.push(issue('founder-authorization-missing', `founder-authorization requires founderAcceptance on resolving result ${record?.resolvingResultPath || 'unknown'}`));
  }

  if (superseded && Array.isArray(record?.findingsAddressed)) {
    const supersededFindings = new Set(normalizeList(superseded.result.findings));
    for (const finding of record.findingsAddressed) {
      if (!supersededFindings.has(finding)) {
        issues.push(issue('supersession-finding-not-from-superseded-result', `findingsAddressed entry is not present on superseded result: ${finding}`));
      }
    }
  }
  if (resolving && Array.isArray(record?.findingsAddressed)) {
    for (const finding of record.findingsAddressed) {
      if (!findingIsAddressed(finding, resolving.result, record)) {
        issues.push(issue('supersession-finding-not-addressed', `resolving lane ${record.resolvingLane} does not address superseded finding: ${finding}`));
      }
    }
  }

  return { ok: issues.length === 0, issues };
}

async function validateResultMarkdownPair({ lane, role, resultRecord }) {
  const issues = [];
  if (!(await pathExists(resultRecord.markdownResultPath))) {
    issues.push(issue('supersession-result-markdown-missing', `${role} lane ${lane} must have result.md paired with ${resultRecord.resultPath}`));
    return issues;
  }
  const markdownStat = await stat(resultRecord.markdownResultPath);
  if (!markdownStat.isFile() || markdownStat.size === 0) {
    issues.push(issue('supersession-result-markdown-empty', `${role} lane ${lane} result.md must be a non-empty file`));
  }
  return issues;
}

function routePolicyAllows(route, resolvingLane, supersededLane) {
  const policy = route?.leadRescue;
  if (!policy || policy.allowed !== true) return false;
  if (!Array.isArray(policy.leads) || !policy.leads.includes(resolvingLane)) return false;
  if (!Array.isArray(policy.superseded) || !policy.superseded.includes(supersededLane)) return false;
  return true;
}

function authorizationEvidenceFor({ route, resolving, authorizationBasis }) {
  if (authorizationBasis === 'route-policy') {
    return {
      routeId: route?.id || '',
      leadRescue: route?.leadRescue || null
    };
  }
  if (authorizationBasis === 'founder-authorization') {
    return {
      resolvingResultPath: resolving?.resultPath || '',
      founderAcceptance: resolving?.result?.founderAcceptance || null
    };
  }
  return null;
}

function findingIsAddressed(finding, resolvingResult, record) {
  const explicitAddresses = [
    ...normalizeList(record.addresses),
    ...normalizeList(resolvingResult.addresses)
  ];
  if (explicitAddresses.includes(finding)) return true;
  const haystacks = [
    resolvingResult.summary,
    ...normalizeList(resolvingResult.findings),
    ...normalizeList(resolvingResult.evidence)
  ];
  return haystacks.some((value) => includesText(value, finding));
}

function includesText(value, needle) {
  const normalizedValue = normalizeText(value);
  const normalizedNeedle = normalizeText(needle);
  return normalizedNeedle.length > 0 && normalizedValue.includes(normalizedNeedle);
}

function normalizeText(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function normalizeList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || '').trim()).filter(Boolean);
}

function supersessionEvent(runDir, item) {
  return {
    type: 'run.supersession.recorded',
    runId: item.record.runId,
    supersededLane: item.record.supersededLane,
    resolvingLane: item.record.resolvingLane,
    authorizationBasis: item.record.authorizationBasis,
    supersessionRecordPath: path.relative(runDir, item.recordPath),
    timestamp: item.record.createdAt
  };
}

async function readEvents(eventsPath) {
  if (!(await pathExists(eventsPath))) return [];
  const raw = await readFile(eventsPath, 'utf8');
  return raw.split(/\r?\n/).filter(Boolean).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }).filter(Boolean);
}

async function appendRunEvent(runDir, event) {
  await writeFile(path.join(runDir, 'events.jsonl'), `${JSON.stringify({
    createdAt: new Date().toISOString(),
    ...event
  })}\n`, { flag: 'a' });
}

function samePath(candidate, expected, runDir) {
  const resolvedCandidate = path.isAbsolute(candidate || '') ? path.resolve(candidate) : path.resolve(runDir, candidate || '');
  return resolvedCandidate === path.resolve(expected);
}

function issue(code, detail, extra = {}) {
  return { code, severity: 'block', detail, ...extra };
}

function safeName(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, '-');
}

function compactTimestamp(iso) {
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}
