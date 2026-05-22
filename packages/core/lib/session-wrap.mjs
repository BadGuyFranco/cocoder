import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { evaluateResultGate } from './dispatch.mjs';
import { pathExists, readJson } from './fs-utils.mjs';

export async function auditSessionWrap({
  runDir,
  contractsDir,
  lanes,
  statusPath = path.join(runDir, 'status.json'),
  dirtyFiles = [],
  writeBoundary,
  commitBoundaryAudit,
  handoffContext
} = {}) {
  const issues = [];
  const status = await readOptionalJson(statusPath);
  if (!status) issues.push(issue('missing-run-status', `missing run status: ${statusPath}`));

  const expectedLanes = lanes || await discoverJobLanes(runDir);
  const jobResults = [];
  for (const lane of expectedLanes) {
    const jobDir = path.join(runDir, 'jobs', lane);
    const resultPath = path.join(jobDir, 'result.json');
    const markdownPath = path.join(jobDir, 'result.md');
    const result = await readOptionalJson(resultPath);
    const markdown = await readOptionalText(markdownPath);
    const gate = await evaluateResultGate({ resultPath, contractsDir });
    if (!result) issues.push(issue('missing-json-result', `${lane} missing result.json`));
    if (!markdown) issues.push(issue('missing-markdown-result', `${lane} missing result.md`));
    if (result && status?.jobs?.[lane]?.status && status.jobs[lane].status !== result.status) {
      issues.push(issue('run-status-result-mismatch', `${lane} status.json=${status.jobs[lane].status} result.json=${result.status}`));
    }
    if (result && markdown) {
      for (const field of ['status', 'nextAction']) {
        const value = result[field];
        if (typeof value === 'string' && value.trim() && !markdown.includes(value)) {
          issues.push(issue('markdown-json-mismatch', `${lane} result.md does not include ${field}=${value}`));
        }
      }
      if (status?.updatedAt && result.createdAt && Date.parse(status.updatedAt) > Date.parse(result.createdAt)) {
        issues.push(issue('stale-result-text', `${lane} result predates run status update`));
      }
      if (await isNewer(statusPath, markdownPath)) {
        issues.push(issue('stale-result-text', `${lane} result.md is older than status.json`));
      }
    }
    jobResults.push({ lane, resultPath, markdownPath, result, gate });
  }

  const dirtyState = classifyDirtyWorktree({ dirtyFiles, writeBoundary });
  if (!dirtyState.ok) {
    for (const detail of dirtyState.outOfBoundary) issues.push(issue('dirty-worktree-out-of-boundary', detail));
  }
  if (!commitBoundaryAudit || commitBoundaryAudit.ok !== true) {
    issues.push(issue('missing-commit-boundary-audit', 'autonomous continuation requires an explicit passing commit-boundary audit'));
  }
  const handoffConsistency = handoffContext ? checkHandoffConsistency({
    ...handoffContext,
    runStatus: handoffContext.runStatus || status,
    jobResults: handoffContext.jobResults || jobResults.map((item) => item.result).filter(Boolean)
  }) : null;
  if (handoffConsistency && !handoffConsistency.ok) {
    issues.push(...handoffConsistency.issues);
  }

  return {
    ok: issues.length === 0,
    status,
    jobResults,
    dirtyState,
    commitBoundaryAudit: commitBoundaryAudit || null,
    handoffConsistency,
    issues
  };
}

export async function checkHandoffConsistencyFromFiles({
  prioritySlug,
  priorityFile,
  planFile,
  sessionLogFile,
  runDir
} = {}) {
  const [priorityText, planText, sessionLogText] = await Promise.all([
    readOptionalText(priorityFile),
    readOptionalText(planFile),
    readOptionalText(sessionLogFile)
  ]);
  const status = runDir ? await readOptionalJson(path.join(runDir, 'status.json')) : null;
  const jobResults = runDir ? await readJobResults(runDir) : [];
  return checkHandoffConsistency({
    prioritySlug,
    priorityText,
    planText,
    sessionLogText,
    runStatus: status,
    jobResults
  });
}

export function checkHandoffConsistency({
  prioritySlug,
  priorityText = '',
  planText = '',
  sessionLogText = '',
  runStatus = null,
  jobResults = []
} = {}) {
  const issues = [];
  if (!prioritySlug || typeof prioritySlug !== 'string') issues.push(issue('missing-priority-slug', 'priority slug is required'));

  const planNextAtom = extractPlanNextAtom(planText);
  const priorityNextAtom = extractPriorityNextAtom(priorityText);
  const latestEntry = extractLatestSessionEntry(sessionLogText, prioritySlug);
  const latestEntryAtom = extractAtom(latestEntry?.heading || '');
  const latestNextAtom = extractSessionNextAtom(latestEntry?.body || '');

  if (!priorityText) issues.push(issue('missing-priority-text', 'PRIORITIES.md text is missing'));
  if (!planText) issues.push(issue('missing-plan-text', 'priority plan text is missing'));
  if (!sessionLogText) issues.push(issue('missing-session-log-text', 'SESSION_LOG.md text is missing'));
  if (prioritySlug && !latestEntry) issues.push(issue('missing-session-log-entry', `SESSION_LOG.md has no entry for [${prioritySlug}]`));

  if (planNextAtom && priorityNextAtom && planNextAtom !== priorityNextAtom) {
    issues.push(issue('next-atom-mismatch', `plan Next Session Start Here says ${planNextAtom}, but PRIORITIES.md says ${priorityNextAtom}`));
  }

  if (latestEntry?.status === 'DONE' && planNextAtom && latestNextAtom && planNextAtom !== latestNextAtom) {
    issues.push(issue('session-log-next-atom-mismatch', `latest DONE session entry says next ${latestNextAtom}, but plan says ${planNextAtom}`));
  }

  if (latestEntry?.status === 'IN PROGRESS' && planNextAtom && latestEntryAtom && planNextAtom !== latestEntryAtom) {
    issues.push(issue('session-log-current-atom-mismatch', `latest IN PROGRESS session entry is ${latestEntryAtom}, but plan says next ${planNextAtom}`));
  }

  if (isTerminalRunStatus(runStatus) && latestEntry?.status === 'IN PROGRESS') {
    issues.push(issue('terminal-run-session-log-in-progress', `run ${runStatus.runId || ''} is terminal, but latest SESSION_LOG.md entry remains IN PROGRESS`.trim()));
  }

  const unsafeLeadRescue = findUnsafeLeadRescueLanguage(latestEntry?.body || '');
  for (const detail of unsafeLeadRescue) issues.push(issue('unsafe-lead-rescue-handoff', detail));

  const planTaskAtoms = new Set(extractPlanTaskAtoms(planText));
  const closedAtoms = new Set([
    ...extractClosedAtoms(priorityText),
    ...extractClosedAtoms(planText),
    ...jobResults.flatMap((result) => extractClosedAtoms(`${result.summary || ''}\n${(result.findings || []).join('\n')}`))
  ].filter((atom) => planTaskAtoms.has(atom)));
  for (const atom of closedAtoms) {
    if (latestEntry?.status === 'IN PROGRESS' && latestEntryAtom === atom) continue;
    if (taskUnchecked(planText, atom)) {
      issues.push(issue('closed-atom-task-unchecked', `${atom} is described as closed, but the plan task marker is still unchecked`));
    }
    if (acceptanceUncheckedWithoutResidual(planText, atom)) {
      issues.push(issue('closed-atom-acceptance-unchecked', `${atom} is described as closed, but a matching acceptance marker remains unchecked without residual/follow-up wording`));
    }
  }

  return {
    ok: issues.length === 0,
    prioritySlug: prioritySlug || null,
    observed: {
      planNextAtom: planNextAtom || null,
      priorityNextAtom: priorityNextAtom || null,
      latestSessionStatus: latestEntry?.status || null,
      latestSessionAtom: latestEntryAtom || null,
      latestSessionNextAtom: latestNextAtom || null,
      runStatus: runStatus?.status || null,
      terminal: isTerminalRunStatus(runStatus),
      planTaskAtoms: [...planTaskAtoms].sort(),
      closedAtoms: [...closedAtoms].sort()
    },
    issues
  };
}

export function classifyDirtyWorktree({ dirtyFiles = [], writeBoundary } = {}) {
  const allowed = writeBoundary?.allowed || [];
  const excluded = writeBoundary?.excluded || [];
  const classified = dirtyFiles.map((file) => {
    const excludedMatch = excluded.some((prefix) => file === prefix || file.startsWith(prefix));
    const allowedMatch = allowed.length === 0 || allowed.some((prefix) => file === prefix || file.startsWith(prefix));
    return {
      file,
      classification: excludedMatch ? 'excluded' : allowedMatch ? 'inside-boundary' : 'outside-boundary'
    };
  });
  return {
    ok: classified.every((item) => item.classification === 'inside-boundary'),
    files: classified,
    outOfBoundary: classified
      .filter((item) => item.classification !== 'inside-boundary')
      .map((item) => `${item.file} is ${item.classification}`)
  };
}

export function checkAutonomousContinuationReadiness(input = {}) {
  const issues = [];
  if (!input.nextAtom || typeof input.nextAtom !== 'string') issues.push(issue('missing-next-atom', 'next atom must be named'));
  if (input.priorityBoundaryResolved !== true) issues.push(issue('priority-boundary-unresolved', 'priority boundary must be resolved'));
  if (!Array.isArray(input.stopConditions) || input.stopConditions.length === 0) issues.push(issue('missing-stop-conditions', 'stop conditions must be listed'));
  if (!Array.isArray(input.requiredTests) || input.requiredTests.length === 0) issues.push(issue('missing-required-tests', 'required tests must be named'));
  if (!Array.isArray(input.founderDecisions)) issues.push(issue('founder-decisions-unknown', 'founder decisions must be explicit, even when empty'));
  if (input.wrapAuditOk !== true) issues.push(issue('wrap-audit-blocked', 'session-wrap audit must have no blockers'));
  if (input.commitBoundaryAuditOk !== true) issues.push(issue('commit-boundary-audit-blocked', 'commit-boundary audit must have no blockers'));
  return {
    ok: issues.length === 0,
    decision: issues.length === 0 ? 'autonomous-continuation-ready' : 'founder-review-required',
    issues
  };
}

async function discoverJobLanes(runDir) {
  const jobsDir = path.join(runDir, 'jobs');
  if (!(await pathExists(jobsDir))) return [];
  const { readdir } = await import('node:fs/promises');
  const entries = await readdir(jobsDir, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

async function readJobResults(runDir) {
  const lanes = await discoverJobLanes(runDir);
  const results = [];
  for (const lane of lanes) {
    const result = await readOptionalJson(path.join(runDir, 'jobs', lane, 'result.json'));
    if (result) results.push({ lane, ...result });
  }
  return results;
}

async function readOptionalJson(filePath) {
  if (!(await pathExists(filePath))) return null;
  return readJson(filePath);
}

async function readOptionalText(filePath) {
  if (!(await pathExists(filePath))) return '';
  return readFile(filePath, 'utf8');
}

async function isNewer(leftPath, rightPath) {
  if (!(await pathExists(leftPath)) || !(await pathExists(rightPath))) return false;
  const [left, right] = await Promise.all([stat(leftPath), stat(rightPath)]);
  return left.mtimeMs > right.mtimeMs + 5;
}

function issue(code, detail) {
  return { code, severity: 'block', detail };
}

function isTerminalRunStatus(status) {
  if (!status) return false;
  if (status.terminal === true) return true;
  return ['complete', 'blocked', 'failed', 'aborted', 'stale'].includes(status.status);
}

function extractAtom(text) {
  return String(text || '').match(/\b([A-Z]\d+)\b/)?.[1] || null;
}

function extractPlanNextAtom(text) {
  const section = String(text || '').split(/^## Next Session Start Here\b/m)[1] || '';
  return section.match(/\*\*Recommended next atom:\*\*\s*([A-Z]\d+)/)?.[1] || null;
}

function extractPriorityNextAtom(text) {
  const source = String(text || '');
  return source.match(/Next Session Start Here` recommends \*\*([A-Z]\d+)/)?.[1]
    || source.match(/\*\*([A-Z]\d+)[^*]*\*\*[^.\n]*is the next dispatch/)?.[1]
    || source.match(/Recommended next atom:\s*\*\*([A-Z]\d+)/)?.[1]
    || null;
}

function extractSessionNextAtom(text) {
  const nextBlock = String(text || '').match(/\*\*Next session should\.\*\*([\s\S]*?)(?:\n\n|$)/)?.[1] || '';
  return extractAtom(nextBlock);
}

function extractLatestSessionEntry(text, prioritySlug) {
  const source = String(text || '');
  const entryPattern = /^## .*(?:\n(?!## ).*)*/gm;
  const entries = source.match(entryPattern) || [];
  const entry = entries.find((candidate) => !prioritySlug || candidate.includes(`[${prioritySlug}]`));
  if (!entry) return null;
  const [heading, ...rest] = entry.split(/\r?\n/);
  return {
    heading,
    body: rest.join('\n'),
    status: heading.match(/\b(IN PROGRESS|DONE|BLOCKED|PAUSED)\b/)?.[1] || null
  };
}

function findUnsafeLeadRescueLanguage(text) {
  const source = String(text || '');
  const findings = [];
  const patterns = [
    /if\s+non-pass[^.\n]*write\s+oscar\s+pass\s+with\s+supersession/i,
    /automatic(?:ally)?[^.\n]*(?:pass|supersession)/i,
    /write\s+[^.\n]*pass\s+with\s+supersession/i
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match) findings.push(`handoff implies automatic lead-rescue PASS: "${match[0]}"`);
  }
  return [...new Set(findings)];
}

function extractClosedAtoms(text) {
  const atoms = new Set();
  const clauses = String(text || '').split(/[.;\n]/);
  for (const clause of clauses) {
    if (!/\b(closed|complete(?:d)?)\b/i.test(clause)) continue;
    for (const match of clause.matchAll(/\b([A-Z]\d+)\b/g)) {
      atoms.add(match[1].toUpperCase());
    }
  }
  return [...atoms];
}

function taskUnchecked(planText, atom) {
  const line = String(planText || '').split(/\r?\n/).find((candidate) => (
    new RegExp(`^\\s*-\\s*\\[\\s\\]\\s*\\*\\*${atom}\\*\\*`).test(candidate)
  ));
  return Boolean(line && /^\s*-\s*\[\s\]/.test(line));
}

function extractPlanTaskAtoms(planText) {
  return String(planText || '').split(/\r?\n/)
    .map((line) => line.match(/^\s*-\s*\[[ x!~-]{1,2}\]\s*\*\*([A-Z]\d+)\*\*/)?.[1])
    .filter(Boolean);
}

function acceptanceUncheckedWithoutResidual(planText, atom) {
  const lines = String(planText || '').split(/\r?\n/);
  const acceptanceIndex = lines.findIndex((line) => /^## Acceptance Criteria\b/.test(line));
  if (acceptanceIndex === -1) return false;
  const acceptanceLines = [];
  for (const line of lines.slice(acceptanceIndex + 1)) {
    if (/^## /.test(line)) break;
    acceptanceLines.push(line);
  }
  return acceptanceLines.some((line) => (
    /^\s*-\s*\[\s\]/.test(line)
    && line.includes(atom)
    && !/\b(residual|follow-up|defer|final check|not gating|not blocking)\b/i.test(line)
  ));
}
