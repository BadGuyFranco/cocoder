import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { loadContracts, validateInstance } from './contracts.mjs';
import { pathExists, readJson } from './fs-utils.mjs';

export async function validatePriorityBoundaryDirectory({ boundariesDir, contractsDir }) {
  const contracts = await loadContracts(contractsDir);
  const contract = contracts.get('priority-boundary');
  if (!contract) throw new Error('Missing contract priority-boundary');
  const files = await boundaryFiles(boundariesDir);
  const values = [];
  const failures = [];
  for (const filePath of files) {
    try {
      const boundary = await readJson(filePath);
      const errors = [
        ...validateInstance(contract, boundary),
        ...validatePriorityBoundarySemantics(boundary)
      ];
      if (errors.length > 0) failures.push({ filePath, errors });
      else values.push(boundary);
    } catch (error) {
      failures.push({ filePath, errors: [error.message] });
    }
  }
  return { ok: failures.length === 0, files, values, failures };
}

export async function resolvePriorityBoundary({ boundariesDir, prioritySlug, route, lanes }) {
  const boundary = await findPriorityBoundary(boundariesDir, prioritySlug);
  if (!boundary) {
    return {
      ok: false,
      status: 'non-ready',
      prioritySlug,
      issues: [issue('priority-boundary-missing', `No priority boundary file found for ${prioritySlug}`)]
    };
  }

  const semanticErrors = validatePriorityBoundarySemantics(boundary);
  if (semanticErrors.length > 0) {
    return {
      ok: false,
      status: 'non-ready',
      prioritySlug,
      priorityBoundary: boundary,
      issues: semanticErrors.map((error) => issue('priority-boundary-invalid', error))
    };
  }

  const issues = [];
  if (boundary.prioritySlug !== prioritySlug) {
    issues.push(issue('priority-boundary-slug-mismatch', `Boundary ${boundary.id} is for ${boundary.prioritySlug}, not ${prioritySlug}`));
  }
  if (Array.isArray(boundary.routeIds) && boundary.routeIds.length > 0 && !boundary.routeIds.includes(route.id)) {
    issues.push(issue('priority-boundary-route-mismatch', `Boundary ${boundary.id} does not allow route ${route.id}`));
  }

  const activeWriters = (lanes || []).filter((lane) => lane.canWrite === true);
  const laneBoundaries = {};
  const writeBoundaries = [];
  const excludedWriteBoundaries = [];

  for (const lane of activeWriters) {
    const laneBoundary = boundary.writerLanes?.[lane.lane];
    if (!laneBoundary) {
      issues.push(issue('priority-boundary-writer-missing', `Boundary ${boundary.id} has no writer boundary for active lane ${lane.lane}`));
      continue;
    }
    if (!Array.isArray(laneBoundary.allowed) || laneBoundary.allowed.length === 0) {
      issues.push(issue('priority-boundary-empty-allowed', `Boundary ${boundary.id} writer lane ${lane.lane} must have at least one allowed path`));
      continue;
    }
    laneBoundaries[lane.lane] = {
      allowed: [...laneBoundary.allowed],
      excluded: [...(laneBoundary.excluded || [])]
    };
    writeBoundaries.push(...laneBoundary.allowed);
    excludedWriteBoundaries.push(...(laneBoundary.excluded || []));
  }

  return {
    ok: issues.length === 0,
    status: issues.length === 0 ? 'ready' : 'non-ready',
    prioritySlug,
    priorityBoundary: boundary,
    laneBoundaries,
    writeBoundaries: unique(writeBoundaries),
    excludedWriteBoundaries: unique(excludedWriteBoundaries),
    issues
  };
}

export function validatePriorityBoundarySemantics(boundary) {
  const errors = [];
  if (!boundary || typeof boundary !== 'object' || Array.isArray(boundary)) return ['priority boundary must be an object'];
  if (typeof boundary.id !== 'string' || boundary.id.trim() === '') errors.push('id must be a non-empty string');
  if (typeof boundary.prioritySlug !== 'string' || boundary.prioritySlug.trim() === '') errors.push('prioritySlug must be a non-empty string');
  if (boundary.routeIds !== undefined && !Array.isArray(boundary.routeIds)) errors.push('routeIds must be an array when present');
  if (!boundary.writerLanes || typeof boundary.writerLanes !== 'object' || Array.isArray(boundary.writerLanes)) {
    errors.push('writerLanes must be an object');
    return errors;
  }
  for (const [lane, laneBoundary] of Object.entries(boundary.writerLanes)) {
    if (!laneBoundary || typeof laneBoundary !== 'object' || Array.isArray(laneBoundary)) {
      errors.push(`writerLanes.${lane} must be an object`);
      continue;
    }
    if (!Array.isArray(laneBoundary.allowed)) errors.push(`writerLanes.${lane}.allowed must be an array`);
    if (!Array.isArray(laneBoundary.excluded)) errors.push(`writerLanes.${lane}.excluded must be an array`);
  }
  return errors;
}

async function findPriorityBoundary(boundariesDir, prioritySlug) {
  if (!boundariesDir || !(await pathExists(boundariesDir))) return null;
  for (const filePath of await boundaryFiles(boundariesDir)) {
    const boundary = await readJson(filePath);
    if (boundary.prioritySlug === prioritySlug || boundary.id === prioritySlug) return boundary;
  }
  return null;
}

async function boundaryFiles(boundariesDir) {
  if (!(await pathExists(boundariesDir))) return [];
  const entries = await readdir(boundariesDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(boundariesDir, entry.name))
    .sort();
}

function issue(code, detail) {
  return { code, severity: 'block', lane: 'startup', detail };
}

function unique(values) {
  return [...new Set(values)];
}
