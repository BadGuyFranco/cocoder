export const MODEL_ROLE_FALLBACK_POLICIES = Object.freeze(['ask-founder', 'stop', 'degrade-with-label']);
export const MODEL_ROLE_SUBSTITUTION_POLICIES = Object.freeze(['strict', 'allow-labeled-degraded']);

const ROLE_REF_KEYS = new Set(['orchestrator', 'builder']);
const ROLE_GROUP_KEYS = new Set(['builderSubagents', 'planning', 'research']);
const PLANNING_KEYS = new Set(['primary', 'audit', 'synthesis']);
const RESEARCH_KEYS = new Set(['primary', 'triangulation', 'synthesis']);
const BUILDER_SUBAGENT_KEYS = new Set(['primary', 'fallback']);

export function resolveModelRoles({ profile, route } = {}) {
  const merged = deepMerge(profile?.modelRoles || {}, route?.modelRoles || {});
  if (Object.keys(merged).length === 0) return null;
  return normalizeModelRoles(merged);
}

export function validateModelRolesSemantics({ modelRoles, laneExists, adapterExists } = {}) {
  const errors = [];
  if (modelRoles === undefined || modelRoles === null) return errors;
  if (!isPlainObject(modelRoles)) return ['modelRoles must be an object when present'];

  const normalized = normalizeModelRoles(modelRoles);
  for (const key of ROLE_REF_KEYS) {
    if (normalized[key]) validateRoleRef(`modelRoles.${key}`, normalized[key], errors, { laneExists, adapterExists });
  }
  if (normalized.builderSubagents) validateRoleGroup('modelRoles.builderSubagents', normalized.builderSubagents, errors, BUILDER_SUBAGENT_KEYS, { laneExists, adapterExists });
  if (normalized.planning) validateRoleGroup('modelRoles.planning', normalized.planning, errors, PLANNING_KEYS, { laneExists, adapterExists });
  if (normalized.research) validateRoleGroup('modelRoles.research', normalized.research, errors, RESEARCH_KEYS, { laneExists, adapterExists });

  if (normalized.fallbackPolicy && !MODEL_ROLE_FALLBACK_POLICIES.includes(normalized.fallbackPolicy)) {
    errors.push(`modelRoles.fallbackPolicy must be one of ${MODEL_ROLE_FALLBACK_POLICIES.join(', ')}`);
  }
  if (normalized.substitutionPolicy && !MODEL_ROLE_SUBSTITUTION_POLICIES.includes(normalized.substitutionPolicy)) {
    errors.push(`modelRoles.substitutionPolicy must be one of ${MODEL_ROLE_SUBSTITUTION_POLICIES.join(', ')}`);
  }
  return errors;
}

export function summarizeModelRoles(modelRoles) {
  if (!modelRoles) return [];
  const lines = [];
  if (modelRoles.orchestrator) lines.push(`- orchestrator: ${formatRoleRef(modelRoles.orchestrator)}`);
  if (modelRoles.builder) lines.push(`- builder: ${formatRoleRef(modelRoles.builder)}`);
  if (modelRoles.builderSubagents?.primary?.length) lines.push(`- builder subagents primary: ${modelRoles.builderSubagents.primary.map(formatRoleRef).join('; ')}`);
  if (modelRoles.builderSubagents?.fallback?.length) lines.push(`- builder subagents fallback: ${modelRoles.builderSubagents.fallback.map(formatRoleRef).join('; ')}`);
  if (modelRoles.planning?.primary?.length) lines.push(`- planning primary: ${modelRoles.planning.primary.map(formatRoleRef).join('; ')}`);
  if (modelRoles.planning?.audit?.length) lines.push(`- planning audit: ${modelRoles.planning.audit.map(formatRoleRef).join('; ')}`);
  if (modelRoles.planning?.synthesis?.length) lines.push(`- planning synthesis: ${modelRoles.planning.synthesis.map(formatRoleRef).join('; ')}`);
  if (modelRoles.research?.primary?.length) lines.push(`- research primary: ${modelRoles.research.primary.map(formatRoleRef).join('; ')}`);
  if (modelRoles.research?.triangulation?.length) lines.push(`- research triangulation/audit: ${modelRoles.research.triangulation.map(formatRoleRef).join('; ')}`);
  if (modelRoles.research?.synthesis?.length) lines.push(`- research synthesis: ${modelRoles.research.synthesis.map(formatRoleRef).join('; ')}`);
  if (modelRoles.substitutionPolicy) lines.push(`- substitution policy: ${modelRoles.substitutionPolicy}`);
  if (modelRoles.fallbackPolicy) lines.push(`- fallback policy: ${modelRoles.fallbackPolicy}`);
  return lines;
}

export function formatRoleRef(ref) {
  const bits = [];
  if (ref.lane) bits.push(`lane ${ref.lane}`);
  if (ref.adapter) bits.push(`${ref.adapter}${ref.adapterProfile ? ` ${ref.adapterProfile}` : ''}`);
  if (ref.label) bits.push(`(${ref.label})`);
  if (ref.purpose) bits.push(`-- ${ref.purpose}`);
  return bits.join(' ') || 'unspecified';
}

function normalizeModelRoles(modelRoles) {
  const normalized = clone(modelRoles);
  for (const key of ROLE_GROUP_KEYS) {
    if (!isPlainObject(normalized[key])) continue;
    for (const [childKey, value] of Object.entries(normalized[key])) {
      if (['fallbackPolicy', 'substitutionPolicy'].includes(childKey)) continue;
      normalized[key][childKey] = normalizeRoleRefList(value);
    }
  }
  return normalized;
}

function normalizeRoleRefList(value) {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function validateRoleGroup(label, group, errors, allowedKeys, context) {
  if (!isPlainObject(group)) {
    errors.push(`${label} must be an object when present`);
    return;
  }
  for (const [key, refs] of Object.entries(group)) {
    if (!allowedKeys.has(key)) {
      errors.push(`${label}.${key} is not a supported role slot`);
      continue;
    }
    if (!Array.isArray(refs)) {
      errors.push(`${label}.${key} must be a role reference or array of role references`);
      continue;
    }
    refs.forEach((ref, index) => validateRoleRef(`${label}.${key}[${index}]`, ref, errors, context));
  }
}

function validateRoleRef(label, ref, errors, { laneExists, adapterExists } = {}) {
  if (!isPlainObject(ref)) {
    errors.push(`${label} must be an object role reference`);
    return;
  }
  const hasLane = typeof ref.lane === 'string' && ref.lane.trim() !== '';
  const hasAdapter = typeof ref.adapter === 'string' && ref.adapter.trim() !== '';
  if (!hasLane && !hasAdapter) {
    errors.push(`${label} must define lane or adapter`);
    return;
  }
  if ('lane' in ref && !hasLane) errors.push(`${label}.lane must be a non-empty string when present`);
  if ('adapter' in ref && !hasAdapter) errors.push(`${label}.adapter must be a non-empty string when present`);
  for (const field of ['adapterProfile', 'label', 'purpose']) {
    if (field in ref && (typeof ref[field] !== 'string' || ref[field].trim() === '')) {
      errors.push(`${label}.${field} must be a non-empty string when present`);
    }
  }
  if (hasLane && laneExists && !laneExists(ref.lane)) errors.push(`${label}.lane references unknown lane ${ref.lane}`);
  if (hasAdapter && adapterExists && !adapterExists(ref.adapter)) errors.push(`${label}.adapter references unknown adapter ${ref.adapter}`);
}

function deepMerge(base, override) {
  const result = clone(base);
  for (const [key, value] of Object.entries(override || {})) {
    if (isPlainObject(value) && isPlainObject(result[key])) result[key] = deepMerge(result[key], value);
    else result[key] = clone(value);
  }
  return result;
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (isPlainObject(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clone(child)]));
  return value;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
