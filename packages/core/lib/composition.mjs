import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadAdapterDeclarations, preflightAdapterRegistry, ADAPTER_PREFLIGHT_STATUSES } from './adapters.mjs';
import { loadProfile, loadRoute } from './config.mjs';
import { extractPriorityEntry, pathExists, readJson, readSessionLogBrief, repoPath, sha256String } from './fs-utils.mjs';
import { resolveModelRoles, validateModelRolesSemantics } from './model-roles.mjs';
import { resolvePriorityBoundary } from './priority-boundaries.mjs';
import { getLane } from './lib-utils.mjs';
import { blockingPriorityBoundaryIssues, routePriorityIssue } from './orchestration-issues.mjs';
import { auditPersonaRouteFit } from './persona-route-audit.mjs';

const READY = 'ready';
const NON_READY = 'non-ready';
const STALE = 'stale';
const DEFAULT_PROMPTS_ROOT = repoPath('cocoder/personas/prompts');
const DEFAULT_PROMPT_MANIFEST = path.join(DEFAULT_PROMPTS_ROOT, 'manifest.json');

// Detect leakage of CoBuilder-private playbook surfaces into shipped CoCoder
// prompt fragments. CoCoder extracted its orchestration core from CoBuilder
// per ADR-0004; CoBuilder kept private build-persona playbooks under
// `cobuilder-build/build-personas/` and several archived orchestrator
// directories. Any reference to those paths inside a shipped CoCoder prompt
// fragment is a leakage bug, so we flag it here.
//
// IMPORTANT: do not match CoCoder's own legitimate `personas/` prompt-fragment
// paths (the manifest format intentionally uses entries like `personas/bob.md`
// and `shared/write-boundaries.md`). The previous extraction pass mechanically
// renamed CoBuilder's `build-personas/` → `personas/` here and produced a
// false-positive on every fragment in the CoCoder manifest. Sub-Playbook E
// surfaced that bug; the patterns below target CoBuilder paths directly so
// CoCoder's own surface is unaffected.
const PRIVATE_LEGACY_REFERENCE_PATTERNS = Object.freeze([
  /(?:^|[\s"'`(])(?:\.\/|\.\.\/)*cobuilder-build\/build-personas\//i,
  /(?:^|[\s"'`(])(?:\.\/|\.\.\/)*cobuilder-build\/orchestrator\//i,
  /(?:^|[\s"'`(])(?:\.\/|\.\.\/)*cobuilder-build\/codex-orchestrator\//i,
  /(?:^|[\s"'`(])(?:\.\/|\.\.\/)*cobuilder-build\/archive\/codex-orchestrator\//i
]);

export const REQUIRED_PROFILE_LANE_PATHS = Object.freeze([
  'oscar',
  'bob',
  'ian',
  'phil',
  'talia',
  'quinn',
  'verifiers.primary',
  'verifiers.adversarial',
  'bobHelpers.default',
  'bobHelpers.readonlyResearch',
  'bobHelpers.implementation'
]);

export const REQUIRED_LANE_FIELDS = Object.freeze([
  'persona',
  'adapter',
  'canWrite',
  'writeBoundary',
  'excludedWriteBoundary',
  'resultContract',
  'evidenceClassDefault'
]);

export async function loadPromptManifest({ manifestPath = DEFAULT_PROMPT_MANIFEST } = {}) {
  const manifest = await readJson(manifestPath);
  const errors = validatePromptManifest(manifest);
  if (errors.length > 0) throw new Error(`Invalid prompt manifest ${manifestPath}: ${errors.join('; ')}`);
  return manifest;
}

export function validatePromptManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return ['manifest must be an object'];
  }
  if (!manifest.personas || typeof manifest.personas !== 'object' || Array.isArray(manifest.personas)) {
    errors.push('manifest.personas must be an object');
    return errors;
  }
  for (const [persona, fragments] of Object.entries(manifest.personas)) {
    if (!Array.isArray(fragments) || fragments.length === 0) {
      errors.push(`${persona} fragments must be a non-empty array`);
      continue;
    }
    const seen = new Set();
    for (const fragment of fragments) {
      if (typeof fragment !== 'string' || fragment.trim() === '') {
        errors.push(`${persona} fragment entries must be non-empty strings`);
        continue;
      }
      if (fragment.startsWith('/') || fragment.includes('\\') || fragment.split('/').includes('..')) {
        errors.push(`${persona} fragment ${fragment} must be a relative path under personas/prompts`);
      }
      if (seen.has(fragment)) errors.push(`${persona} duplicates fragment ${fragment}`);
      seen.add(fragment);
      if (hasPrivateLegacyReference(fragment)) {
        errors.push(`${persona} fragment path references private legacy surface: ${fragment}`);
      }
    }
  }
  return errors;
}

export async function composePersonaPrompt({ persona, promptsRoot = DEFAULT_PROMPTS_ROOT, manifestPath = path.join(promptsRoot, 'manifest.json') } = {}) {
  if (!persona || typeof persona !== 'string') throw new Error('persona is required');
  const manifest = await loadPromptManifest({ manifestPath });
  const fragments = manifest.personas[persona];
  if (!fragments) throw new Error(`Prompt manifest has no fragments for persona ${persona}`);

  const resolved = [];
  const seenResolved = new Set();
  const root = path.resolve(promptsRoot);
  for (const fragment of fragments) {
    const absolutePath = path.resolve(root, fragment);
    if (!isInsideDirectory(root, absolutePath)) {
      throw new Error(`Prompt fragment escapes prompts root: ${fragment}`);
    }
    if (seenResolved.has(absolutePath)) throw new Error(`Duplicate prompt fragment for ${persona}: ${fragment}`);
    seenResolved.add(absolutePath);
    if (!(await pathExists(absolutePath))) throw new Error(`Missing prompt fragment for ${persona}: ${fragment}`);
    const content = await readFile(absolutePath, 'utf8');
    if (hasPrivateLegacyReference(content)) {
      throw new Error(`Prompt fragment ${fragment} references a private legacy playbook or orchestrator path`);
    }
    resolved.push({ fragment, absolutePath, content });
  }

  return {
    persona,
    fragments: resolved.map((item) => item.fragment),
    markdown: resolved.map((item, index) => [
      `<!-- prompt-fragment: ${item.fragment}; order: ${index + 1}; persona: ${persona} -->`,
      item.content.trimEnd()
    ].join('\n')).join('\n\n')
  };
}

export function hasPrivateLegacyReference(text) {
  return PRIVATE_LEGACY_REFERENCE_PATTERNS.some((pattern) => pattern.test(String(text || '')));
}

export async function validateProfileDirectory({ profilesDir, contractsDir, readdir, pathJoin, readProfile } = {}) {
  return validateConfigDirectory({
    dir: profilesDir,
    contractsDir,
    extension: '.json',
    loader: readProfile || loadProfile,
    semanticValidator: validateProfileSemantics,
    readdir,
    pathJoin
  });
}

export async function validateRouteDirectory({ routesDir, contractsDir, readdir, pathJoin, readRoute } = {}) {
  return validateConfigDirectory({
    dir: routesDir,
    contractsDir,
    extension: '.json',
    loader: readRoute || loadRoute,
    semanticValidator: validateRouteSemantics,
    readdir,
    pathJoin
  });
}

export function validateProfileSemantics(profile) {
  const errors = [];
  for (const lanePath of REQUIRED_PROFILE_LANE_PATHS) {
    const lane = getLane(profile.lanes, lanePath);
    if (!lane || typeof lane !== 'object' || Array.isArray(lane)) {
      errors.push(`missing required lane path ${lanePath}`);
      continue;
    }
    for (const field of REQUIRED_LANE_FIELDS) {
      if (!(field in lane)) {
        errors.push(`${lanePath} missing required lane field ${field}`);
      }
    }
    validateLaneFieldTypes(lanePath, lane, errors);
  }
  errors.push(...validateModelRolesSemantics({
    modelRoles: profile.modelRoles,
    laneExists: (lanePath) => Boolean(getLane(profile.lanes, lanePath))
  }));
  return errors;
}

export function validateRouteSemantics(route) {
  const errors = [];
  if (!Array.isArray(route.lanes)) return ['route.lanes must be an array'];
  if (!route.laneRequirements || typeof route.laneRequirements !== 'object' || Array.isArray(route.laneRequirements)) {
    return ['route.laneRequirements must be an object'];
  }

  for (const lanePath of route.lanes) {
    const requirements = route.laneRequirements[lanePath];
    if (!requirements || typeof requirements !== 'object' || Array.isArray(requirements)) {
      errors.push(`missing laneRequirements entry for ${lanePath}`);
      continue;
    }
    for (const field of ['requiredCapabilities', 'requiredEvidenceCapabilities', 'allowedAdapters']) {
      if (field in requirements && !Array.isArray(requirements[field])) {
        errors.push(`${lanePath}.laneRequirements.${field} must be an array when present`);
      }
    }
    for (const field of ['readOnlyVerifier', 'allowWriteCapableAdapterWhenWritesDisabled', 'requiresInteractive']) {
      if (field in requirements && typeof requirements[field] !== 'boolean') {
        errors.push(`${lanePath}.laneRequirements.${field} must be a boolean when present`);
      }
    }
  }
  if ('allowAutonomousTeammateStart' in route && typeof route.allowAutonomousTeammateStart !== 'boolean') {
    errors.push('route.allowAutonomousTeammateStart must be a boolean when present');
  }
  if ('initialLanes' in route) {
    if (!Array.isArray(route.initialLanes) || route.initialLanes.length === 0) {
      errors.push('route.initialLanes must be a non-empty array when present');
    } else {
      for (const lanePath of route.initialLanes) {
        if (!route.lanes.includes(lanePath)) errors.push(`route.initialLanes includes undeclared lane ${lanePath}`);
      }
      if (route.lead && !route.initialLanes.includes(route.lead)) {
        errors.push(`route.initialLanes must include lead lane ${route.lead}`);
      }
    }
  }
  if ('topologyOptions' in route) {
    if (!Array.isArray(route.topologyOptions) || route.topologyOptions.length === 0) {
      errors.push('route.topologyOptions must be a non-empty array when present');
    } else {
      const seen = new Set();
      for (const option of route.topologyOptions) {
        if (!option || typeof option !== 'object' || Array.isArray(option)) {
          errors.push('route.topologyOptions entries must be objects');
          continue;
        }
        if (typeof option.id !== 'string' || option.id.trim() === '') {
          errors.push('route.topologyOptions entries must have a non-empty id');
        } else if (seen.has(option.id)) {
          errors.push(`route.topologyOptions duplicates id ${option.id}`);
        } else {
          seen.add(option.id);
        }
        if (!Array.isArray(option.lanes) || option.lanes.length === 0) {
          errors.push(`route.topologyOptions.${option.id || 'unknown'}.lanes must be a non-empty array`);
        } else {
          for (const lanePath of option.lanes) {
            if (!route.lanes.includes(lanePath)) errors.push(`route.topologyOptions.${option.id || 'unknown'} includes undeclared lane ${lanePath}`);
          }
          if (route.lead && !option.lanes.includes(route.lead)) {
            errors.push(`route.topologyOptions.${option.id || 'unknown'} must include lead lane ${route.lead}`);
          }
        }
        if ('requiredPersonas' in option && (!Array.isArray(option.requiredPersonas) || option.requiredPersonas.some((value) => typeof value !== 'string' || value.trim() === ''))) {
          errors.push(`route.topologyOptions.${option.id || 'unknown'}.requiredPersonas must be an array of non-empty strings when present`);
        }
      }
    }
  }
  if ('orchestratorCommit' in route) {
    const policy = route.orchestratorCommit;
    if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
      errors.push('route.orchestratorCommit must be an object when present');
    } else {
      if (policy.enabled !== true) errors.push('route.orchestratorCommit.enabled must be true when present');
      if (policy.owner !== 'route') errors.push('route.orchestratorCommit.owner must be route');
      if (policy.stageMode !== 'exact-files') errors.push('route.orchestratorCommit.stageMode must be exact-files');
      if (!Array.isArray(policy.writerLanes) || policy.writerLanes.length === 0) {
        errors.push('route.orchestratorCommit.writerLanes must be a non-empty array');
      } else {
        for (const lanePath of policy.writerLanes) {
          if (!route.lanes.includes(lanePath)) errors.push(`route.orchestratorCommit.writerLanes includes undeclared lane ${lanePath}`);
        }
      }
      if ('laneWriteScopes' in policy) {
        if (!policy.laneWriteScopes || typeof policy.laneWriteScopes !== 'object' || Array.isArray(policy.laneWriteScopes)) {
          errors.push('route.orchestratorCommit.laneWriteScopes must be an object when present');
        } else {
          for (const [lanePath, scope] of Object.entries(policy.laneWriteScopes)) {
            if (!route.lanes.includes(lanePath)) errors.push(`route.orchestratorCommit.laneWriteScopes includes undeclared lane ${lanePath}`);
            if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
              errors.push(`route.orchestratorCommit.laneWriteScopes.${lanePath} must be an object`);
              continue;
            }
            if (!Array.isArray(scope.allowed)) errors.push(`route.orchestratorCommit.laneWriteScopes.${lanePath}.allowed must be an array`);
            if (!Array.isArray(scope.excluded)) errors.push(`route.orchestratorCommit.laneWriteScopes.${lanePath}.excluded must be an array`);
            for (const value of [...(Array.isArray(scope.allowed) ? scope.allowed : []), ...(Array.isArray(scope.excluded) ? scope.excluded : [])]) {
              if (typeof value !== 'string' || value.trim() === '') {
                errors.push(`route.orchestratorCommit.laneWriteScopes.${lanePath} paths must be non-empty strings`);
              }
            }
          }
        }
      }
    }
  }
  if ('leadRescue' in route) {
    const policy = route.leadRescue;
    if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
      errors.push('route.leadRescue must be an object when present');
    } else {
      if (policy.allowed !== true) errors.push('route.leadRescue.allowed must be true when present');
      if (!Array.isArray(policy.leads) || policy.leads.length === 0) {
        errors.push('route.leadRescue.leads must be a non-empty array');
      } else {
        for (const lanePath of policy.leads) {
          if (!route.lanes.includes(lanePath)) errors.push(`route.leadRescue.leads includes undeclared lane ${lanePath}`);
        }
      }
      if (!Array.isArray(policy.superseded) || policy.superseded.length === 0) {
        errors.push('route.leadRescue.superseded must be a non-empty array');
      } else {
        for (const lanePath of policy.superseded) {
          if (!route.lanes.includes(lanePath)) errors.push(`route.leadRescue.superseded includes undeclared lane ${lanePath}`);
        }
      }
    }
  }
  if ('leadSupportCommit' in route) {
    const policy = route.leadSupportCommit;
    if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
      errors.push('route.leadSupportCommit must be an object when present');
    } else {
      if (policy.enabled !== true) errors.push('route.leadSupportCommit.enabled must be true when present');
      if (policy.stageMode !== 'exact-files') errors.push('route.leadSupportCommit.stageMode must be exact-files');
      if (!Array.isArray(policy.leads) || policy.leads.length === 0) {
        errors.push('route.leadSupportCommit.leads must be a non-empty array');
      } else {
        for (const lanePath of policy.leads) {
          if (!route.lanes.includes(lanePath)) errors.push(`route.leadSupportCommit.leads includes undeclared lane ${lanePath}`);
        }
      }
      if (!Array.isArray(policy.allowed) || policy.allowed.length === 0) {
        errors.push('route.leadSupportCommit.allowed must be a non-empty array');
      }
      if ('excluded' in policy && !Array.isArray(policy.excluded)) {
        errors.push('route.leadSupportCommit.excluded must be an array when present');
      }
      for (const value of [...(Array.isArray(policy.allowed) ? policy.allowed : []), ...(Array.isArray(policy.excluded) ? policy.excluded : [])]) {
        if (typeof value !== 'string' || value.trim() === '') {
          errors.push('route.leadSupportCommit paths must be non-empty strings');
        }
      }
    }
  }
  if ('implementationOwnership' in route) {
    const policy = route.implementationOwnership;
    if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
      errors.push('route.implementationOwnership must be an object when present');
    } else {
      if ('enabled' in policy && typeof policy.enabled !== 'boolean') errors.push('route.implementationOwnership.enabled must be a boolean when present');
      if ('ownerLane' in policy && (typeof policy.ownerLane !== 'string' || policy.ownerLane.trim() === '')) {
        errors.push('route.implementationOwnership.ownerLane must be a non-empty string when present');
      }
      for (const field of ['surfaces', 'exemptSurfaces']) {
        if (field in policy) {
          if (!Array.isArray(policy[field])) errors.push(`route.implementationOwnership.${field} must be an array when present`);
          else if (policy[field].some((value) => typeof value !== 'string' || value.trim() === '')) {
            errors.push(`route.implementationOwnership.${field} paths must be non-empty strings`);
          }
        }
      }
      if (policy.ownerLane && !route.lanes.includes(policy.ownerLane)) {
        errors.push(`route.implementationOwnership.ownerLane references undeclared lane ${policy.ownerLane}`);
      }
    }
  }
  errors.push(...validateModelRolesSemantics({ modelRoles: route.modelRoles }));
  return errors;
}

export async function checkRouteProfileCompatibility({
  profilePath,
  routePath,
  adaptersDir,
  contractsDir,
  env,
  pathValue
}) {
  const profile = await loadProfile({ contractsDir, filePath: profilePath });
  const route = await loadRoute({ contractsDir, filePath: routePath });
  const loaded = await loadAdapterDeclarations({ adaptersDir, contractsDir });
  const preflight = await preflightAdapterRegistry({ adaptersDir, contractsDir, env, pathValue });
  return composeCompatibility({ profile, route, loaded, preflight });
}

export async function composeLaunchDryRun({
  profilePath,
  routePath,
  adaptersDir,
  contractsDir,
  priorityFile,
  prioritySlug,
  priorityBoundariesDir,
  sessionLogFile,
  sessionLineLimit = 80,
  env,
  pathValue
}) {
  const compatibility = await checkRouteProfileCompatibility({
    profilePath,
    routePath,
    adaptersDir,
    contractsDir,
    env,
    pathValue
  });
  const selectedPriority = await extractPriorityEntry(priorityFile, prioritySlug);
  const recentSessionContext = await readSessionLogBrief(sessionLogFile, sessionLineLimit);
  const staleIssue = priorityStaleIssue(selectedPriority);
  const ownerIssue = routePriorityIssue(compatibility.route, prioritySlug);
  const personaRouteAudit = auditPersonaRouteFit({
    selectedPriority,
    recentSessionContext,
    route: compatibility.route,
    lanes: compatibility.lanes
  });
  const priorityBoundary = priorityBoundariesDir
    ? await resolvePriorityBoundary({
        boundariesDir: priorityBoundariesDir,
        prioritySlug,
        route: compatibility.route,
        lanes: compatibility.lanes
      })
    : null;
  const boundaryIssues = blockingPriorityBoundaryIssues(priorityBoundary);
  const issues = [
    ...compatibility.issues,
    ...(staleIssue ? [staleIssue] : []),
    ...(ownerIssue ? [ownerIssue] : []),
    ...boundaryIssues
  ];
  const ready = compatibility.ok && !staleIssue && !ownerIssue && boundaryIssues.length === 0;
  const status = ready ? READY : staleIssue ? STALE : NON_READY;
  const resolvedProfile = compatibility.profile;
  const resolvedRoute = compatibility.route;
  const resolvedLanes = compatibility.lanes;
  const modelRoles = resolveModelRoles({ profile: resolvedProfile, route: resolvedRoute });

  return {
    ok: ready,
    status,
    profile: {
      id: resolvedProfile.id,
      label: resolvedProfile.label,
      digest: sha256String(JSON.stringify(resolvedProfile))
    },
    route: {
      id: resolvedRoute.id,
      label: resolvedRoute.label,
      digest: sha256String(JSON.stringify(resolvedRoute))
    },
    selectedPriority,
    recentSessionContext,
    personaRouteAudit,
    priorityBoundary: priorityBoundary?.ok ? {
      id: priorityBoundary.priorityBoundary.id,
      prioritySlug: priorityBoundary.priorityBoundary.prioritySlug,
      writeBoundaries: priorityBoundary.writeBoundaries,
      excludedWriteBoundaries: priorityBoundary.excludedWriteBoundaries
    } : null,
    ...(modelRoles ? { modelRoles } : {}),
    startupPacket: {
      version: 1,
      dryRun: true,
      selectedPriority,
      recentSessionContext,
      personaRouteAudit,
      route: {
        id: resolvedRoute.id,
        label: resolvedRoute.label,
        lead: resolvedRoute.lead,
        lanes: resolvedRoute.lanes
      },
      profile: {
        id: resolvedProfile.id,
        label: resolvedProfile.label,
        lanes: resolvedLanes.map((lane) => ({
          lane: lane.lane,
          persona: lane.persona,
          adapter: lane.adapter,
          canWrite: lane.canWrite,
          preflightStatus: lane.preflightStatus
        }))
      },
      ...(modelRoles ? { modelRoles } : {}),
      safetyFlags: {
        noRealLaunch: true,
        noTmuxControl: true,
        noVerifierDispatch: true,
        noQuinnExecution: true,
        noFullPriorityRead: true,
        boundedSessionContext: true
      }
    },
    lanes: resolvedLanes,
    issues
  };
}

export function composeCompatibility({ profile, route, loaded, preflight }) {
  const adaptersById = new Map(loaded.adapters.map((adapter) => [adapter.id, adapter]));
  const preflightById = new Map(preflight.results.map((result) => [result.adapter, result]));
  const issues = [
    ...loaded.failures.map((failure) => ({
      code: 'adapter-declaration-invalid',
      severity: 'block',
      path: failure.filePath,
      detail: failure.errors.join('; ')
    }))
  ];
  const lanes = [];
  const writerLanes = [];

  for (const lanePath of route.lanes || []) {
    const lane = getLane(profile.lanes, lanePath);
    const requirements = route.laneRequirements?.[lanePath] || {};
    if (!lane) {
      issues.push(issue('missing-lane', lanePath, `profile does not define lane ${lanePath}`));
      continue;
    }

    const adapter = adaptersById.get(lane.adapter);
    const preflightResult = preflightById.get(lane.adapter);
    const laneRecord = {
      lane: lanePath,
      persona: lane.persona,
      adapter: lane.adapter,
      canWrite: lane.canWrite === true,
      writeBoundary: lane.writeBoundary || [],
      preflightStatus: preflightResult?.status || 'not-run',
      adapterKind: adapter?.kind || 'missing',
      writeCapability: adapter?.writeCapability || 'missing',
      evidenceCapabilities: adapter?.evidenceCapabilities || [],
      capabilities: adapter?.capabilities || {}
    };
    lanes.push(laneRecord);

    if (!adapter) {
      issues.push(issue('missing-adapter', lanePath, `adapter ${lane.adapter} is not declared`));
      continue;
    }
    if (!preflightResult) {
      issues.push(issue('missing-preflight', lanePath, `adapter ${lane.adapter} did not produce preflight status`));
      continue;
    }
    if (Array.isArray(requirements.allowedAdapters) && !requirements.allowedAdapters.includes(adapter.id)) {
      issues.push(issue('adapter-not-allowed', lanePath, `adapter ${adapter.id} is not allowed for lane ${lanePath}`));
    }
    if (preflightResult.status !== ADAPTER_PREFLIGHT_STATUSES.AVAILABLE) {
      issues.push(issue(preflightResult.status, lanePath, `adapter ${lane.adapter} is ${preflightResult.status}: ${preflightResult.reasons.join('; ')}`));
    }
    if (lane.canWrite === true) writerLanes.push(lanePath);
    if (lane.canWrite === true && adapter.writeCapability === 'none') {
      issues.push(issue('writer-with-readonly-adapter', lanePath, `writer lane ${lanePath} uses adapter ${adapter.id} with writeCapability none`));
    }
    if (requirements.requiresInteractive === true && adapter.capabilities?.interactive !== true) {
      issues.push(issue('interactive-required', lanePath, `lane ${lanePath} requires an interactive adapter`));
    }
    for (const capability of requirements.requiredCapabilities || []) {
      if (adapter.capabilities?.[capability] !== true) {
        issues.push(issue('missing-capability', lanePath, `adapter ${adapter.id} lacks required capability ${capability}`));
      }
    }
    for (const evidenceCapability of requirements.requiredEvidenceCapabilities || []) {
      if (!(adapter.evidenceCapabilities || []).includes(evidenceCapability)) {
        issues.push(issue('missing-evidence-capability', lanePath, `adapter ${adapter.id} lacks evidence capability ${evidenceCapability}`));
      }
    }
    if (requirements.readOnlyVerifier === true && adapter.writeCapability !== 'none' && lane.canWrite !== false) {
      issues.push(issue('verifier-write-not-disabled', lanePath, `read-only verifier lane ${lanePath} must disable writes for adapter ${adapter.id}`));
    }
    if (requirements.readOnlyVerifier === true && adapter.writeCapability !== 'none' && requirements.allowWriteCapableAdapterWhenWritesDisabled !== true) {
      issues.push(issue('verifier-writing-adapter-not-explicit', lanePath, `read-only verifier lane ${lanePath} uses write-capable adapter ${adapter.id} without explicit route allowance`));
    }
  }

  if (route.writePolicy === 'one-writer' && writerLanes.length > 1) {
    issues.push(issue('one-writer-violation', writerLanes.join(','), `one-writer route has ${writerLanes.length} writer lanes`));
  }
  if (route.writePolicy === 'read-only' && writerLanes.length > 0) {
    issues.push(issue('read-only-route-writer', writerLanes.join(','), 'read-only route has writer lanes'));
  }
  const modelRoleErrors = validateModelRolesSemantics({
    modelRoles: resolveModelRoles({ profile, route }),
    laneExists: (lanePath) => Boolean(getLane(profile.lanes, lanePath)),
    adapterExists: (adapterId) => adaptersById.has(adapterId)
  });
  for (const detail of modelRoleErrors) {
    issues.push(issue('model-role-invalid', 'modelRoles', detail));
  }

  return {
    ok: issues.length === 0,
    status: issues.length === 0 ? READY : NON_READY,
    profile,
    route,
    modelRoles: resolveModelRoles({ profile, route }),
    lanes,
    issues
  };
}

function priorityStaleIssue(selectedPriority) {
  if (selectedPriority.matched && selectedPriority.staleState === 'active') return null;
  return {
    code: 'priority-not-active',
    severity: 'block',
    lane: 'startup',
    detail: `selected priority ${selectedPriority.slug} staleState=${selectedPriority.staleState} matched=${selectedPriority.matched}`
  };
}

function issue(code, lane, detail) {
  return { code, severity: 'block', lane, detail };
}

function validateLaneFieldTypes(lanePath, lane, errors) {
  for (const field of ['persona', 'adapter', 'resultContract']) {
    if (field in lane && (typeof lane[field] !== 'string' || lane[field].trim() === '')) {
      errors.push(`${lanePath}.${field} must be a non-empty string`);
    }
  }
  if ('canWrite' in lane && typeof lane.canWrite !== 'boolean') {
    errors.push(`${lanePath}.canWrite must be a boolean`);
  }
  for (const field of ['writeBoundary', 'excludedWriteBoundary']) {
    if (field in lane && !Array.isArray(lane[field])) {
      errors.push(`${lanePath}.${field} must be an array`);
    }
  }
  if ('evidenceClassDefault' in lane && !['A', 'B'].includes(lane.evidenceClassDefault)) {
    errors.push(`${lanePath}.evidenceClassDefault must be A or B`);
  }
  if ('maxParallel' in lane && typeof lane.maxParallel !== 'number') {
    errors.push(`${lanePath}.maxParallel must be a number when present`);
  }
}

function isInsideDirectory(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function validateConfigDirectory({ dir, contractsDir, extension, loader, semanticValidator, readdir, pathJoin }) {
  const fsReaddir = readdir || (await import('node:fs/promises')).readdir;
  const join = pathJoin || (await import('node:path')).join;
  const files = (await fsReaddir(dir)).filter((name) => name.endsWith(extension)).sort();
  const values = [];
  const failures = [];
  for (const file of files) {
    const filePath = join(dir, file);
    try {
      const value = await loader({ contractsDir, filePath });
      const semanticErrors = semanticValidator ? semanticValidator(value) : [];
      if (semanticErrors.length > 0) failures.push({ filePath, errors: semanticErrors });
      else values.push(value);
    } catch (error) {
      failures.push({ filePath, errors: [error.message] });
    }
  }
  return {
    ok: failures.length === 0,
    files: files.map((file) => join(dir, file)),
    values,
    failures
  };
}
