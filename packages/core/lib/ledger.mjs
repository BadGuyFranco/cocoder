import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { extractPriorityEntry, extractPrioritySlugs, pathExists, readJson, readSessionLogBrief, sha256String, writeJson } from './fs-utils.mjs';
import { loadContracts, validateInstance } from './contracts.mjs';
import { loadProfile, loadRoute } from './config.mjs';
import { resolveModelRoles } from './model-roles.mjs';
import { resolvePriorityBoundary } from './priority-boundaries.mjs';
import { ensureSupersessionLedgerEvents, evaluateSupersessionsForRun } from './lead-rescue.mjs';
import { auditDirtyDurableOrchestrationState } from './repo-state.mjs';
import { isTerminalRunStatus, isTerminalRunStatusRecord } from './run-status.mjs';
import { compactTimestamp, getLane, safeName } from './lib-utils.mjs';
import { collectArchivedLanePacketResults } from './lane-packets.mjs';
import { blockingPriorityBoundaryIssues, routeGhostPriorityIssues, routePriorityIssue } from './orchestration-issues.mjs';
import { auditPersonaRouteFit } from './persona-route-audit.mjs';

const ALLOWED_STATUSES = new Set(['created', 'ready', 'running', 'blocked', 'needs_founder', 'failed', 'complete', 'aborted', 'stale']);
const PASS_PERSONA_DISPATCH_STATUSES = new Set(['completed', 'not-required', 'next-route-required']);
const BLOCKING_PERSONA_DISPATCH_STATUSES = new Set(['packet-only', 'deferred', 'unavailable', 'blocked', 'not-executed']);

export async function createRun(options) {
  const now = new Date().toISOString();
  const runId = options.runId || `run-${compactTimestamp(now)}-${randomSuffix()}`;
  const runDir = path.join(options.runsDir, runId);
  await mkdir(runDir, { recursive: true });
  await mkdir(path.join(runDir, 'jobs'), { recursive: true });
  await mkdir(path.join(runDir, 'flows'), { recursive: true });
  await mkdir(path.join(runDir, 'evidence'), { recursive: true });

  const contracts = await loadContracts(options.contractsDir);
  const profile = await loadProfile({ contractsDir: options.contractsDir, filePath: options.profilePath });
  const route = await loadRoute({ contractsDir: options.contractsDir, filePath: options.routePath });
  const modelRoles = resolveModelRoles({ profile, route });

  const profileRaw = await readFile(options.profilePath, 'utf8');
  const profileDigest = sha256String(profileRaw);
  const selectedPriority = await extractPriorityEntry(options.priorityFile, options.prioritySlug);
  const prioritySlugs = await extractPrioritySlugs(options.priorityFile);
  const recentSessionContext = await readSessionLogBrief(options.sessionLogFile, options.sessionLineLimit);
  const routeIssue = routePriorityIssue(route, options.prioritySlug);
  const ghostPriorityIssues = routeGhostPriorityIssues(route, prioritySlugs);
  const priorityContextIssue = priorityNextAtomDriftIssue(selectedPriority);
  const routeLaneRecords = collectRouteLaneRecords(profile, route.lanes || []);
  const personaRouteAudit = auditPersonaRouteFit({
    selectedPriority,
    recentSessionContext,
    route,
    lanes: routeLaneRecords
  });
  const priorityBoundary = options.resolvedPriorityBoundary || (options.priorityBoundariesDir
    ? await resolvePriorityBoundary({
        boundariesDir: options.priorityBoundariesDir,
        prioritySlug: options.prioritySlug,
        route,
        lanes: routeLaneRecords
      })
    : null);
  const boundaryGaps = blockingPriorityBoundaryIssues(priorityBoundary)
    .map((issue) => `${issue.code}: ${issue.detail}`);
  const routeGaps = routeIssue ? [`${routeIssue.code}: ${routeIssue.detail}`] : [];
  const ghostPriorityGaps = ghostPriorityIssues.map((issue) => `${issue.code}: ${issue.detail}`);
  const startupWarnings = [
    ...(priorityContextIssue ? [`${priorityContextIssue.code}: ${priorityContextIssue.detail}`] : []),
    ...personaRouteAudit.warnings.map((warning) => `persona-route-audit: ${warning}`)
  ];
  const startupGaps = [
    ...(selectedPriority.matched ? [] : [`priority ${options.prioritySlug} was not found`]),
    ...routeGaps,
    ...ghostPriorityGaps,
    ...boundaryGaps
  ];
  const isReady = selectedPriority.matched
    && selectedPriority.staleState === 'active'
    && routeGaps.length === 0
    && ghostPriorityGaps.length === 0
    && boundaryGaps.length === 0;
  const resolvedWriteBoundaries = priorityBoundary?.ok
    ? priorityBoundary.writeBoundaries
    : collectWriteBoundaries(profile, route.lanes || []);
  const startupPacket = {
    runId,
    createdAt: now,
    route: {
      id: route.id,
      lead: route.lead,
      teammates: route.teammates || []
    },
    profileDigest,
    selectedPriority,
    recentSessionContext,
    personaRouteAudit,
    writeBoundaries: resolvedWriteBoundaries,
    resolvedWriteBoundary: priorityBoundary?.ok ? {
      id: priorityBoundary.priorityBoundary.id,
      prioritySlug: priorityBoundary.priorityBoundary.prioritySlug,
      source: 'priority-boundary',
      laneBoundaries: priorityBoundary.laneBoundaries,
      excludedWriteBoundaries: priorityBoundary.excludedWriteBoundaries
    } : {
      source: priorityBoundary ? 'priority-boundary-unresolved' : 'profile-fallback',
      laneBoundaries: {},
      excludedWriteBoundaries: []
    },
    ...(modelRoles ? { modelRoles } : {}),
    safetyFlags: {
      oldReferencesReadOnly: true,
      noFullPriorityRead: true,
      noFullSessionLogRead: true
    },
    extractionEvidence: [
      {
        source: options.priorityFile,
        method: 'line-stream selected priority extraction',
        slug: options.prioritySlug
      },
      {
        source: options.sessionLogFile,
        method: 'bounded newest session entries',
        lineLimit: options.sessionLineLimit
      }
    ],
    gaps: startupGaps,
    warnings: startupWarnings
  };

  assertValid(contracts, 'startup-packet', startupPacket, 'generated startup packet');

  await writeJson(path.join(runDir, 'profile.snapshot.json'), profile);
  await writeJson(path.join(runDir, 'route.snapshot.json'), route);
  await writeJson(path.join(runDir, 'startup-packet.json'), startupPacket);
  await writeFile(path.join(runDir, 'events.jsonl'), '');
  await writeFile(path.join(runDir, 'jobs.jsonl'), '');
  await writeStatus(runDir, {
    runId,
    status: isReady ? 'ready' : 'stale',
    createdAt: now,
    updatedAt: now,
    routeId: route.id,
    profileId: profile.id,
    startupPacketPath: 'startup-packet.json',
    terminal: !isReady,
    reason: isReady
      ? 'startup packet and profile/route validation passed'
      : stalePriorityReason(options.prioritySlug, selectedPriority, [...routeGaps, ...boundaryGaps])
  });
  await appendEvent(runDir, {
    type: 'run.created',
    runId,
    status: isReady ? 'ready' : 'stale',
    creationContext: normalizeRunCreationContext(options.creationContext)
  });
  return {
    runId,
    runDir,
    status: isReady ? 'ready' : 'stale'
  };
}

export async function setRunStatus(runDir, status, reason) {
  if (!ALLOWED_STATUSES.has(status)) throw new Error(`Invalid status ${status}`);
  const current = await readJson(path.join(runDir, 'status.json'));
  if (isTerminalRunStatusRecord(current)) throw new Error(`Run is already terminal: ${current.status}`);
  const next = {
    ...current,
    status,
    updatedAt: new Date().toISOString(),
    terminal: isTerminalRunStatus(status),
    reason: reason || current.reason || ''
  };
  await writeStatus(runDir, next);
  await appendEvent(runDir, { type: 'status.changed', from: current.status, to: status, reason: next.reason });
  return next;
}

export async function addEvidence({ runDir, contractsDir, evidencePath }) {
  const contracts = await loadContracts(contractsDir);
  const evidence = await readJson(evidencePath);
  assertValid(contracts, 'evidence', evidence, evidencePath);
  const relativePath = path.join('evidence', `${safeName(evidence.id)}.json`);
  await writeJson(path.join(runDir, relativePath), evidence);
  await appendEvent(runDir, { type: 'evidence.added', id: evidence.id, path: relativePath });
  return { id: evidence.id, path: relativePath };
}

export async function ingestResult({ runDir, contractsDir, jobId, resultPath, promptPath, transcriptPath }) {
  const contracts = await loadContracts(contractsDir);
  const result = await readJson(resultPath);
  assertValid(contracts, 'job-result', result, resultPath);
  const jobDir = path.join(runDir, 'jobs', safeName(jobId));
  await mkdir(jobDir, { recursive: true });
  if (promptPath) await writeFile(path.join(jobDir, 'prompt.md'), await readFile(promptPath, 'utf8'));
  else if (!(await pathExists(path.join(jobDir, 'prompt.md')))) await writeFile(path.join(jobDir, 'prompt.md'), '');
  if (transcriptPath) await writeFile(path.join(jobDir, 'transcript.txt'), await readFile(transcriptPath, 'utf8'));
  else if (!(await pathExists(path.join(jobDir, 'transcript.txt')))) await writeFile(path.join(jobDir, 'transcript.txt'), '');
  const resultTargetPath = path.join(jobDir, 'result.json');
  const markdownTargetPath = path.join(jobDir, 'result.md');
  const markdownSourcePath = pairedMarkdownResultPath(resultPath);
  await writeJson(resultTargetPath, result);
  if (await pathExists(markdownTargetPath)) {
    // Preserve lane-authored Markdown result artifacts; generated summaries are only a fallback.
  } else if (markdownSourcePath && await pathExists(markdownSourcePath)) {
    await writeFile(markdownTargetPath, await readFile(markdownSourcePath, 'utf8'));
  } else {
    await writeFile(markdownTargetPath, renderResultMarkdown(result));
  }
  await writeJson(path.join(jobDir, 'status.json'), {
    jobId,
    status: result.status,
    persona: result.persona,
    adapter: result.adapter,
    updatedAt: new Date().toISOString()
  });
  await appendJsonl(path.join(runDir, 'jobs.jsonl'), { jobId, status: result.status, persona: result.persona, adapter: result.adapter });
  await appendEvent(runDir, { type: 'job.result.ingested', jobId, status: result.status });
  return { jobId, status: result.status };
}

function pairedMarkdownResultPath(resultPath) {
  if (!resultPath || !String(resultPath).endsWith('.json')) return '';
  return String(resultPath).slice(0, -'.json'.length) + '.md';
}

export async function closeoutRun(runDir, summary) {
  const closeout = {
    createdAt: new Date().toISOString(),
    summary,
    status: 'complete'
  };
  await writeJson(path.join(runDir, 'closeout.json'), closeout);
  return setRunStatus(runDir, 'complete', summary || 'run closed out');
}

export async function finalizeRunStatusFromResults({ runDir, contractsDir, summary, repoRoot } = {}) {
  if (!runDir) throw new Error('runDir is required');
  if (!contractsDir) throw new Error('contractsDir is required');

  const statusPath = path.join(runDir, 'status.json');
  const launchPath = path.join(runDir, 'launch.json');
  const current = await readJson(statusPath);
  if (isTerminalRunStatusRecord(current)) {
    return {
      ok: true,
      finalized: false,
      status: current.status,
      terminal: true,
      reason: `run is already terminal: ${current.status}`,
      missing: [],
      invalid: [],
      nonPassing: []
    };
  }

  const launchPlan = await readJson(launchPath);
  const contracts = await loadContracts(contractsDir);
  const contract = contracts.get('job-result');
  if (!contract) throw new Error('Missing contract job-result');

  const jobs = {};
  const missing = [];
  const invalid = [];
  const nonPassing = [];
  const resultRecords = new Map();

  for (const session of launchPlan.sessions || []) {
    const lane = session.lane;
    const resultPath = session.resultPath || path.join(runDir, 'jobs', safeName(lane), 'result.json');
    const markdownResultPath = session.markdownResultPath || path.join(runDir, 'jobs', safeName(lane), 'result.md');
    if (!(await pathExists(resultPath))) {
      missing.push({ lane, resultPath });
      continue;
    }
    if (!(await pathExists(markdownResultPath))) {
      invalid.push({ lane, resultPath: markdownResultPath, reason: 'missing markdown result file paired with result.json' });
      continue;
    }
    const markdownStat = await stat(markdownResultPath);
    if (!markdownStat.isFile() || markdownStat.size === 0) {
      invalid.push({ lane, resultPath: markdownResultPath, reason: 'empty markdown result file paired with result.json' });
      continue;
    }
    let result;
    try {
      result = await readJson(resultPath);
    } catch (error) {
      invalid.push({ lane, resultPath, reason: error.message || String(error) });
      continue;
    }
    const errors = validateInstance(contract, result);
    if (errors.length > 0) {
      invalid.push({ lane, resultPath, reason: errors.join('; ') });
      continue;
    }
    const identityIssues = validateLaneResultIdentity({ lane, session, result });
    if (identityIssues.length > 0) {
      invalid.push({ lane, resultPath, reason: `result identity mismatch: ${identityIssues.join('; ')}` });
      continue;
    }
    const markdown = await readFile(markdownResultPath, 'utf8');
    const founderBriefIssues = validateOscarPassResultArtifacts({ lane, result, markdown });
    if (founderBriefIssues.length > 0) {
      const hasPersonaDispatchIssue = founderBriefIssues.some((candidate) => /personaDispatchPlan|required persona work|Persona Dispatch Plan/.test(candidate));
      const hasFounderBriefIssue = founderBriefIssues.some((candidate) => /Founder Completion Brief|founder brief|Atom Complete/.test(candidate));
      const reasonPrefix = hasPersonaDispatchIssue && !hasFounderBriefIssue
        ? 'invalid Oscar PASS persona dispatch plan'
        : 'missing founder completion brief';
      invalid.push({
        lane,
        resultPath: markdownResultPath,
        reason: `${reasonPrefix}: ${founderBriefIssues.join('; ')}`
      });
      continue;
    }
    const resultStat = await stat(resultPath);
    jobs[lane] = {
      status: result.status,
      persona: result.persona,
      adapter: result.adapter,
      updatedAt: result.createdAt || resultStat.mtime.toISOString()
    };
    resultRecords.set(`${lane}:current`, {
      lane,
      resultPath: path.resolve(resultPath),
      result
    });
    if (result.status !== 'PASS') {
      nonPassing.push({ lane, status: result.status, resultPath });
    }
  }

  const archivedPacketRecords = await collectArchivedLanePacketResults({ runDir, launchPlan });
  for (const archived of archivedPacketRecords) {
    const lane = archived.lane;
    if (archived.issues.length > 0) {
      invalid.push({
        lane,
        resultPath: archived.resultPath,
        reason: `invalid archived packet ${archived.packetId || '<unknown>'}: ${archived.issues.join('; ')}`
      });
      continue;
    }
    const session = (launchPlan.sessions || []).find((candidate) => candidate.lane === lane);
    const errors = validateInstance(contract, archived.result);
    if (errors.length > 0) {
      invalid.push({ lane, resultPath: archived.resultPath, reason: `invalid archived packet ${archived.packetId || '<unknown>'}: ${errors.join('; ')}` });
      continue;
    }
    const identityIssues = validateLaneResultIdentity({ lane, session, result: archived.result });
    if (identityIssues.length > 0) {
      invalid.push({ lane, resultPath: archived.resultPath, reason: `archived packet identity mismatch: ${identityIssues.join('; ')}` });
      continue;
    }
    if (archived.result.status !== 'PASS') {
      invalid.push({ lane, resultPath: archived.resultPath, reason: `archived packet ${archived.packetId || '<unknown>'} must be PASS, got ${archived.result.status}` });
      continue;
    }
    const markdown = await readFile(archived.markdownResultPath, 'utf8');
    const founderBriefIssues = validateOscarPassResultArtifacts({ lane, result: archived.result, markdown });
    if (founderBriefIssues.length > 0) {
      invalid.push({
        lane,
        resultPath: archived.markdownResultPath,
        reason: `invalid archived packet ${archived.packetId || '<unknown>'}: ${founderBriefIssues.join('; ')}`
      });
      continue;
    }
    resultRecords.set(`${lane}:${archived.resultPath}`, {
      lane,
      resultPath: path.resolve(archived.resultPath),
      result: archived.result,
      packetId: archived.packetId
    });
  }

  if (missing.length > 0 || invalid.length > 0) {
    await writeStatus(runDir, {
      ...current,
      jobs,
      updatedAt: new Date().toISOString(),
      reason: current.reason || ''
    });
    await appendEvent(runDir, {
      type: 'run.results.checked',
      missing: missing.map((item) => item.lane),
      invalid: invalid.map((item) => item.lane),
      nonPassing
    });
    return {
      ok: true,
      finalized: false,
      status: current.status,
      terminal: false,
      reason: missing.length > 0 ? 'waiting for lane result files' : 'lane result files are invalid',
      missing,
      invalid,
      nonPassing
    };
  }

  if (nonPassing.length > 0) {
    const supersessions = await evaluateSupersessionsForRun({ runDir });
    if (supersessions.invalid.length > 0) {
      const status = summarizeNonPassingStatus(nonPassing);
      const issue = supersessions.invalid[0].issues[0];
      const reason = `invalid supersession for ${supersessions.invalid[0].record?.supersededLane || 'unknown'}: ${issue.detail}`;
      await writeStatus(runDir, {
        ...current,
        jobs,
        updatedAt: new Date().toISOString(),
        reason: current.reason || ''
      });
      await appendEvent(runDir, {
        type: 'run.results.checked',
        missing: [],
        invalid: [],
        nonPassing,
        supersessionErrors: supersessions.invalid.map((item) => ({
          recordPath: item.recordPath,
          issues: item.issues
        }))
      });
      const updated = await setRunStatus(runDir, status, reason);
      return {
        ok: true,
        finalized: false,
        status: updated.status,
        terminal: updated.terminal,
        reason,
        missing,
        invalid,
        nonPassing,
        supersessions
      };
    }

    const unresolved = [];
    const covering = [];
    for (const item of nonPassing) {
      const cover = supersessions.valid.find((candidate) =>
        candidate.record.supersededLane === item.lane
        && resolveRunPath(runDir, candidate.record.supersededResultPath) === path.resolve(item.resultPath)
      );
      if (cover) covering.push(cover);
      else unresolved.push(item);
    }
    if (unresolved.length === 0) {
      await ensureSupersessionLedgerEvents(runDir, covering);
      const supersessionReason = `completed via authorized supersession: ${covering.map((item) =>
        `${item.record.supersededLane} by ${item.record.resolvingLane} (${item.record.authorizationBasis})`
      ).join('; ')}`;
      const pendingOrchestratorCommits = await collectPendingRouteOwnedCommits(runDir, resultRecords, {
        supersessions: covering
      });
      if (pendingOrchestratorCommits.length > 0) {
        return waitForRouteOwnedCommits({
          runDir,
          current,
          jobs,
          missing,
          invalid,
          nonPassing,
          pendingOrchestratorCommits,
          supersessions: covering
        });
      }
      const dirtyOrchestrationAudit = await auditDirtyBeforeTerminalize({ repoRoot });
      if (!dirtyOrchestrationAudit.ok) {
        return waitForCleanDurableOrchestrationState({
          runDir,
          current,
          jobs,
          missing,
          invalid,
          nonPassing,
          dirtyOrchestrationAudit,
          supersessions: covering
        });
      }
      const closeout = await completeRunWithJobs(runDir, current, jobs, summary || supersessionReason, {
        reason: supersessionReason,
        nonPassing,
        supersessions: covering
      });
      return {
        ok: true,
        finalized: true,
        status: closeout.status,
        terminal: closeout.terminal,
        reason: closeout.reason,
        missing,
        invalid,
        nonPassing,
        supersessions
      };
    }

    const status = summarizeNonPassingStatus(nonPassing);
    const reason = `blocked by stale non-PASS result: ${unresolved.map((item) => `${item.lane}=${item.status}`).join(', ')}`;
    await writeStatus(runDir, {
      ...current,
      jobs,
      updatedAt: new Date().toISOString(),
      reason: current.reason || ''
    });
    await appendEvent(runDir, {
      type: 'run.results.checked',
      missing: [],
      invalid: [],
      nonPassing,
      supersessions: supersessions.records.map((item) => item.record?.id || item.recordPath)
    });
    const updated = await setRunStatus(runDir, status, reason);
    return {
      ok: true,
      finalized: false,
      status: updated.status,
      terminal: updated.terminal,
      reason,
      missing,
      invalid,
      nonPassing,
      supersessions
    };
  }

  const pendingOrchestratorCommits = await collectPendingRouteOwnedCommits(runDir, resultRecords);
  if (pendingOrchestratorCommits.length > 0) {
    return waitForRouteOwnedCommits({
      runDir,
      current,
      jobs,
      missing,
      invalid,
      nonPassing,
      pendingOrchestratorCommits
    });
  }

  const dirtyOrchestrationAudit = await auditDirtyBeforeTerminalize({ repoRoot });
  if (!dirtyOrchestrationAudit.ok) {
    return waitForCleanDurableOrchestrationState({
      runDir,
      current,
      jobs,
      missing,
      invalid,
      nonPassing,
      dirtyOrchestrationAudit
    });
  }

  const closeout = await completeRunWithJobs(runDir, current, jobs, summary || 'all launched lanes wrote PASS results');
  return {
    ok: true,
    finalized: true,
    status: closeout.status,
    terminal: closeout.terminal,
    reason: closeout.reason,
    missing,
    invalid,
    nonPassing
  };
}

async function waitForRouteOwnedCommits({
  runDir,
  current,
  jobs,
  missing,
  invalid,
  nonPassing,
  pendingOrchestratorCommits,
  supersessions
}) {
  const lanes = pendingOrchestratorCommits.map((item) => item.lane);
  const reason = `waiting for route-owned commits: ${lanes.join(', ')}`;
  await writeStatus(runDir, {
    ...current,
    jobs,
    updatedAt: new Date().toISOString(),
    reason: current.reason || ''
  });
  await appendEvent(runDir, {
    type: 'run.results.checked',
    missing: missing.map((item) => item.lane),
    invalid: invalid.map((item) => item.lane),
    nonPassing,
    pendingOrchestratorCommits,
    supersessions: (supersessions || []).map((item) => ({
      id: item.record.id,
      supersededLane: item.record.supersededLane,
      resolvingLane: item.record.resolvingLane,
      authorizationBasis: item.record.authorizationBasis
    }))
  });
  return {
    ok: true,
    finalized: false,
    status: current.status,
    terminal: false,
    reason,
    missing,
    invalid,
    nonPassing,
    pendingOrchestratorCommits,
    ...(supersessions ? { supersessions } : {})
  };
}

async function waitForCleanDurableOrchestrationState({
  runDir,
  current,
  jobs,
  missing,
  invalid,
  nonPassing,
  dirtyOrchestrationAudit,
  supersessions
}) {
  const reason = `waiting for clean durable orchestration state: ${dirtyOrchestrationAudit.dirtyFiles.join(', ')}`;
  await writeStatus(runDir, {
    ...current,
    jobs,
    updatedAt: new Date().toISOString(),
    reason: current.reason || ''
  });
  await appendEvent(runDir, {
    type: 'run.results.checked',
    missing: missing.map((item) => item.lane),
    invalid: invalid.map((item) => item.lane),
    nonPassing,
    dirtyOrchestrationState: dirtyOrchestrationAudit.dirtyFiles,
    supersessions: (supersessions || []).map((item) => ({
      id: item.record.id,
      supersededLane: item.record.supersededLane,
      resolvingLane: item.record.resolvingLane,
      authorizationBasis: item.record.authorizationBasis
    }))
  });
  return {
    ok: true,
    finalized: false,
    status: current.status,
    terminal: false,
    reason,
    missing,
    invalid,
    nonPassing,
    dirtyOrchestrationState: dirtyOrchestrationAudit.dirtyFiles,
    ...(supersessions ? { supersessions } : {})
  };
}

async function auditDirtyBeforeTerminalize({ repoRoot }) {
  if (!repoRoot) {
    return { ok: true, skipped: true, dirtyFiles: [], issues: [] };
  }
  return auditDirtyDurableOrchestrationState({ repoRoot, blockUnstaged: false });
}

function validateLaneResultIdentity({ lane, session, result }) {
  const issues = [];
  if (session?.persona && result.persona !== session.persona) {
    issues.push(`persona must be ${session.persona}, got ${result.persona}`);
  }
  if (session?.adapter && result.adapter !== session.adapter) {
    issues.push(`adapter must be ${session.adapter}, got ${result.adapter}`);
  }
  if (!session?.persona && result.persona !== lane) {
    issues.push(`persona must match lane ${lane} when launch persona metadata is missing, got ${result.persona}`);
  }
  return issues;
}

async function collectPendingRouteOwnedCommits(runDir, resultRecords, { supersessions = [] } = {}) {
  const routePath = path.join(runDir, 'route.snapshot.json');
  if (!(await pathExists(routePath))) return [];
  const route = await readJson(routePath);
  const policy = route?.orchestratorCommit;
  if (!policy?.enabled || policy.owner !== 'route' || policy.stageMode !== 'exact-files') return [];

  const writerLanes = new Set(policy.writerLanes || []);
  if (writerLanes.size === 0) return [];

  const commitEvents = (await readRunEvents(runDir))
    .filter((event) => event.type === 'orchestrator.commit' && event.lane && event.acceptedResultPath && event.sha);

  const pending = [];
  for (const record of resultRecords.values()) {
    if (!writerLanes.has(record.lane) || !isCommittableResultRecord(runDir, record, supersessions)) continue;
    const filesChanged = committableFilesChanged(record.result.filesChanged);
    if (filesChanged.length === 0) continue;
    const committed = commitEvents.some((event) =>
      event.lane === record.lane
      && resolveRunPath(runDir, event.acceptedResultPath) === record.resultPath
    );
    if (!committed) {
      pending.push({
        lane: record.lane,
        resultPath: record.resultPath,
        filesChanged
      });
    }
  }
  return pending;
}

function isCommittableResultRecord(runDir, record, supersessions) {
  if (record.result.status === 'PASS') return true;
  return supersessions.some((candidate) =>
    candidate.record.supersededLane === record.lane
    && resolveRunPath(runDir, candidate.record.supersededResultPath) === record.resultPath
  );
}

async function readRunEvents(runDir) {
  const eventsPath = path.join(runDir, 'events.jsonl');
  if (!(await pathExists(eventsPath))) return [];
  const raw = await readFile(eventsPath, 'utf8');
  const events = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      // Corrupt historical event lines should not make the finalizer terminal.
    }
  }
  return events;
}

function committableFilesChanged(filesChanged) {
  if (!Array.isArray(filesChanged)) return [];
  return [...new Set(filesChanged
    .map((item) => String(item || '').trim())
    .filter((item) => item && item !== 'none'))];
}

export function validateOscarPassResultArtifacts({ lane, result, markdown }) {
  return [
    ...validateFounderCompletionBrief({ lane, result, markdown }),
    ...validatePersonaDispatchPlan({ lane, result, markdown })
  ];
}

function validateFounderCompletionBrief({ lane, result, markdown }) {
  if (result?.status !== 'PASS' || result?.persona !== 'oscar') return [];
  const issues = [];
  const text = String(markdown || '');
  const headingMatch = text.match(/^#{1,3}\s+Founder Completion Brief\b.*$/im);
  if (!headingMatch) {
    issues.push(`${lane} result.md must include a "Founder Completion Brief" section`);
    return issues;
  }

  const beforeHeading = text.slice(0, headingMatch.index);
  const nonEmptyBeforeHeading = beforeHeading.split(/\r?\n/).filter((line) => line.trim()).length;
  if (nonEmptyBeforeHeading > 6) {
    issues.push(`${lane} Founder Completion Brief must appear before technical evidence near the top of result.md`);
  }

  const brief = extractFounderCompletionBrief(text, headingMatch);
  const briefLines = brief.split(/\r?\n/).filter((line) => line.trim());
  if (briefLines.length > 15) {
    issues.push(`${lane} Founder Completion Brief must be short: 15 non-empty lines or fewer, got ${briefLines.length}`);
  }
  if (brief.length > 1400) {
    issues.push(`${lane} Founder Completion Brief must be concise: 1400 characters or fewer, got ${brief.length}`);
  }
  if (/```/.test(brief)) {
    issues.push(`${lane} Founder Completion Brief must not contain code fences or command dumps`);
  }
  if (/^\s*(?:node|pnpm|git|tmux|xcrun|codesign|spctl)\b/im.test(brief)) {
    issues.push(`${lane} Founder Completion Brief must not use raw commands as the primary founder handoff`);
  }

  for (const label of [
    'Atom Complete',
    'Run Status',
    'What Changed',
    'What Remains',
    'Recommended Next Step',
    'Founder Decision Needed',
    'Commit State',
    'Teardown Readiness'
  ]) {
    const pattern = new RegExp(`^\\s*(?:[-*]\\s*)?(?:\\*\\*)?${escapeRegExp(label)}(?:\\*\\*)?\\s*:`, 'im');
    if (!pattern.test(brief)) issues.push(`${lane} founder brief missing "${label}:"`);
  }

  const atomCompleteValue = founderBriefLabelValue(brief, 'Atom Complete');
  if (atomCompleteValue && !/^yes\b/i.test(atomCompleteValue)) {
    issues.push(`${lane} PASS result founder brief must say "Atom Complete: Yes"; got "${atomCompleteValue}"`);
  }
  const runStatusValue = founderBriefLabelValue(brief, 'Run Status');
  if (runStatusValue && !/\b(?:complete|terminal|finalized|wrapped)\b/i.test(runStatusValue)) {
    issues.push(`${lane} PASS result founder brief must state terminal run status; got "${runStatusValue}"`);
  }
  const teardownReadinessValue = founderBriefLabelValue(brief, 'Teardown Readiness');
  if (teardownReadinessValue && !/\b(?:yes|ready)\b/i.test(teardownReadinessValue)) {
    issues.push(`${lane} PASS result founder brief must state teardown readiness; got "${teardownReadinessValue}"`);
  }
  return issues;
}

function extractFounderCompletionBrief(text, headingMatch) {
  const start = headingMatch.index + headingMatch[0].length;
  const rest = text.slice(start);
  const nextHeading = rest.search(/^#{1,3}\s+(?!Founder Completion Brief\b).+$/im);
  return (nextHeading >= 0 ? rest.slice(0, nextHeading) : rest).trim();
}

function founderBriefLabelValue(brief, label) {
  const pattern = new RegExp(`^\\s*(?:[-*]\\s*)?(?:\\*\\*)?${escapeRegExp(label)}(?:\\*\\*)?\\s*:\\s*(.+)$`, 'im');
  const match = String(brief || '').match(pattern);
  return match ? match[1].replace(/\*\*/g, '').trim() : '';
}

function validatePersonaDispatchPlan({ lane, result, markdown }) {
  if (result?.status !== 'PASS' || result?.persona !== 'oscar') return [];
  const issues = [];
  if (!/^#{1,3}\s+Persona Dispatch Plan\b/im.test(String(markdown || ''))) {
    issues.push(`${lane} result.md must include a "Persona Dispatch Plan" section`);
  }
  if (!Array.isArray(result.personaDispatchPlan) || result.personaDispatchPlan.length === 0) {
    issues.push(`${lane} PASS result must include non-empty personaDispatchPlan`);
    return issues;
  }
  for (const [index, row] of result.personaDispatchPlan.entries()) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      issues.push(`${lane} personaDispatchPlan[${index}] must be an object`);
      continue;
    }
    for (const field of ['atom', 'requiredPersona', 'routeAvailable', 'dispatchStatus', 'evidenceExpected']) {
      if (row[field] === undefined || row[field] === '') issues.push(`${lane} personaDispatchPlan[${index}] missing ${field}`);
    }
    if (row.routeAvailable !== undefined && typeof row.routeAvailable !== 'boolean') {
      issues.push(`${lane} personaDispatchPlan[${index}].routeAvailable must be a boolean`);
    }
    const dispatchStatus = String(row.dispatchStatus || '').toLowerCase();
    if (dispatchStatus && !PASS_PERSONA_DISPATCH_STATUSES.has(dispatchStatus)) {
      issues.push(`${lane} PASS result cannot include personaDispatchPlan[${index}] dispatchStatus=${row.dispatchStatus}`);
    }
    if (BLOCKING_PERSONA_DISPATCH_STATUSES.has(dispatchStatus)) {
      issues.push(`${lane} required persona work is not executed: ${row.requiredPersona || 'unknown'} status=${row.dispatchStatus}`);
    }
    if (row.routeAvailable === false && dispatchStatus !== 'next-route-required') {
      issues.push(`${lane} personaDispatchPlan[${index}] routeAvailable=false must use dispatchStatus=next-route-required for PASS`);
    }
  }
  return issues;
}

async function completeRunWithJobs(runDir, initialStatus, jobs, summary, options = {}) {
  const closeout = {
    createdAt: new Date().toISOString(),
    summary,
    status: 'complete'
  };
  await writeJson(path.join(runDir, 'closeout.json'), closeout);
  const current = await readJson(path.join(runDir, 'status.json'));
  if (isTerminalRunStatusRecord(current)) return current;
  const next = {
    ...initialStatus,
    ...current,
    jobs,
    status: 'complete',
    updatedAt: new Date().toISOString(),
    terminal: true,
    reason: options.reason || summary || 'run closed out'
  };
  await writeStatus(runDir, next);
  await appendEvent(runDir, {
    type: 'run.results.checked',
    missing: [],
    invalid: [],
    nonPassing: options.nonPassing || [],
    supersessions: (options.supersessions || []).map((item) => ({
      id: item.record.id,
      supersededLane: item.record.supersededLane,
      resolvingLane: item.record.resolvingLane,
      authorizationBasis: item.record.authorizationBasis
    }))
  });
  await appendEvent(runDir, { type: 'status.changed', from: current.status, to: 'complete', reason: next.reason });
  return next;
}

export async function abortRun(runDir, reason) {
  await writeJson(path.join(runDir, 'abort.json'), {
    createdAt: new Date().toISOString(),
    reason
  });
  return setRunStatus(runDir, 'aborted', reason || 'run aborted');
}

export async function cleanupRuns({ runsDir, dryRun = true }) {
  const entries = (await readdir(runsDir, { withFileTypes: true })).filter((entry) => entry.isDirectory());
  const removable = [];
  for (const entry of entries) {
    const runDir = path.join(runsDir, entry.name);
    const statusPath = path.join(runDir, 'status.json');
    if (!(await pathExists(statusPath))) continue;
    const status = await readJson(statusPath);
    if (isTerminalRunStatusRecord(status)) removable.push(runDir);
  }
  if (!dryRun) {
    for (const runDir of removable) await rm(runDir, { recursive: true, force: false });
  }
  return { dryRun, removable };
}

async function writeStatus(runDir, status) {
  await writeJson(path.join(runDir, 'status.json'), status);
}

export async function appendEvent(runDir, event) {
  await appendJsonl(path.join(runDir, 'events.jsonl'), {
    createdAt: new Date().toISOString(),
    ...event
  });
}

export async function appendRunEvent(runDir, event) {
  await appendEvent(runDir, event);
}

async function appendJsonl(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value)}\n`, { flag: 'a' });
}

function assertValid(contracts, contractId, value, label) {
  const contract = contracts.get(contractId);
  if (!contract) throw new Error(`Missing contract ${contractId}`);
  const errors = validateInstance(contract, value);
  if (errors.length > 0) throw new Error(`${label} failed ${contractId} validation: ${errors.join('; ')}`);
}

function summarizeNonPassingStatus(nonPassing) {
  const statuses = new Set(nonPassing.map((item) => item.status));
  if (statuses.has('FAILED')) return 'failed';
  if (statuses.has('BLOCK')) return 'blocked';
  return 'needs_founder';
}

function resolveRunPath(runDir, value) {
  return path.isAbsolute(value || '') ? path.resolve(value) : path.resolve(runDir, value || '');
}

function collectWriteBoundaries(profile, routeLanes) {
  const boundaries = [];
  for (const lanePath of routeLanes) {
    const lane = getLane(profile.lanes, lanePath);
    if (lane && Array.isArray(lane.writeBoundary)) boundaries.push(...lane.writeBoundary);
  }
  return [...new Set(boundaries)];
}

function collectRouteLaneRecords(profile, routeLanes) {
  return routeLanes.map((lanePath) => {
    const lane = getLane(profile.lanes, lanePath) || {};
    return {
      lane: lanePath,
      persona: lane.persona,
      adapter: lane.adapter,
      canWrite: lane.canWrite === true
    };
  });
}

function priorityNextAtomDriftIssue(selectedPriority) {
  if (!selectedPriority?.matched) return null;
  const currentAtoms = nextAtomCandidates(selectedPriority.lastUpdated || '');
  if (currentAtoms.size !== 1) return null;

  const entryAtoms = nextAtomCandidates(priorityDecisionLines(selectedPriority.excerpt || ''));
  if (entryAtoms.size === 0) return null;

  const [currentAtom] = [...currentAtoms];
  if (entryAtoms.has(currentAtom)) return null;
  return {
    code: 'priority-next-atom-drift',
    detail: `PRIORITIES.md Last updated says ${currentAtom} is next, but the selected priority entry says ${[...entryAtoms].join(', ')}`
  };
}

function priorityDecisionLines(excerpt) {
  return String(excerpt)
    .split(/\r?\n/)
    .filter((line) => /^\*\*(Plan|Runnable|Status):\*\*/.test(line))
    .join('\n');
}

function nextAtomCandidates(text) {
  const value = String(text || '');
  const atoms = new Set();
  const patterns = [
    /\b(?:recommended\s+)?next\s+atom\s*:?\s*(?:\*\*)?([A-Z]\d+)/gi,
    /\b(?:next\s+dispatch|recommends?)\b[^.\n;]{0,80}?\b([A-Z]\d+)\b/gi,
    /\b([A-Z]\d+)\b[^.\n;]{0,80}?\b(?:is\s+)?(?:the\s+)?next(?:\s+dispatch)?\b/gi
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(value))) atoms.add(match[1].toUpperCase());
  }
  return atoms;
}

function renderResultMarkdown(result) {
  return [
    `# ${result.status}`,
    '',
    `Persona: ${result.persona}`,
    `Adapter: ${result.adapter}`,
    '',
    result.summary || '',
    ''
  ].join('\n');
}

function normalizeRunCreationContext(context = {}) {
  return {
    command: context.command || 'create-run',
    execute: context.execute === true,
    deferStart: context.deferStart === true,
    socketName: context.socketName || '',
    socketPath: context.socketPath ? '<set>' : '',
    tmuxBin: context.tmuxBin || '',
    pid: process.pid,
    ppid: process.ppid,
    cwd: process.cwd(),
    argv: process.argv.slice(1, 4)
  };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function randomSuffix() {
  return Math.random().toString(36).slice(2, 10);
}

function stalePriorityReason(prioritySlug, selectedPriority, boundaryGaps = []) {
  if (boundaryGaps.length > 0) return boundaryGaps.join('; ');
  if (!selectedPriority.matched) return `priority ${prioritySlug} was not found`;
  return `priority ${prioritySlug} is not active: staleState=${selectedPriority.staleState}`;
}
