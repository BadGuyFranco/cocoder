import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadPersona, loadRoute } from './config.mjs';

export const REQUIRED_PERSONAS = Object.freeze(['bob', 'oscar', 'talia', 'quinn', 'ian', 'phil', 'verifier']);
export const ROUTE_PERSONA_EXCEPTIONS = Object.freeze({
  verifier: 'external verifier lane resolved by route/profile adapter assignment'
});

const PRIVATE_PLAYBOOK_PATTERNS = Object.freeze([
  /cocoder\/personas\/(?:bob|oscar|talia|quinn|ian|phil)\.md/i,
  /personas\/(?:bob|oscar|talia|quinn|ian|phil)\.md/i,
  /cocoder\/personas\/checklists\//i,
  /personas\/checklists\//i,
  /cocoder\/personas\/scripts\//i,
  /personas\/scripts\//i
]);

const ALLOWED_WRITE_POLICIES = Object.freeze(['read-only', 'task-scoped', 'bounded-writer']);

export async function validatePersonaDirectory({ personasDir, contractsDir, readdirImpl, pathJoin, readPersona } = {}) {
  const fsReaddir = readdirImpl || readdir;
  const join = pathJoin || path.join;
  const files = (await fsReaddir(personasDir)).filter((name) => name.endsWith('.json')).sort();
  const personas = [];
  const failures = [];

  for (const file of files) {
    const filePath = join(personasDir, file);
    try {
      const persona = await (readPersona || loadPersona)({ contractsDir, filePath });
      const errors = validatePersonaSemantics(persona);
      if (errors.length > 0) failures.push({ filePath, errors });
      else personas.push(persona);
    } catch (error) {
      failures.push({ filePath, errors: [error.message] });
    }
  }

  const ids = new Set(personas.map((persona) => persona.id));
  for (const required of REQUIRED_PERSONAS) {
    if (!ids.has(required)) failures.push({ filePath: personasDir, errors: [`missing required persona ${required}`] });
  }

  return { ok: failures.length === 0, personas, failures };
}

export function validatePersonaSemantics(persona) {
  const errors = [];
  if (typeof persona.resultContract !== 'string' || persona.resultContract.trim() === '') {
    errors.push(`${persona.id || 'persona'} missing non-empty resultContract`);
  }
  if (!Array.isArray(persona.allowedRoutes)) {
    errors.push(`${persona.id || 'persona'} allowedRoutes must be an array`);
  }
  if (!Array.isArray(persona.evidenceResponsibilities) || persona.evidenceResponsibilities.length === 0) {
    errors.push(`${persona.id || 'persona'} evidenceResponsibilities must be a non-empty array`);
  }
  if (!ALLOWED_WRITE_POLICIES.includes(persona.writePolicy)) {
    errors.push(`${persona.id || 'persona'} writePolicy must be one of ${ALLOWED_WRITE_POLICIES.join(', ')}`);
  }
  if (!persona.launchModel || typeof persona.launchModel !== 'string') {
    errors.push(`${persona.id || 'persona'} launchModel must be a non-empty string`);
  }
  return errors;
}

export async function checkPersonaRouteCoverage({ personasDir, routesDir, contractsDir } = {}) {
  const personaResult = await validatePersonaDirectory({ personasDir, contractsDir });
  const personaIds = new Set(personaResult.personas.map((persona) => persona.id));
  const routeFiles = (await readdir(routesDir)).filter((name) => name.endsWith('.json')).sort();
  const missing = [];
  const exceptions = [];
  const routes = [];

  for (const file of routeFiles) {
    const route = await loadRoute({ contractsDir, filePath: path.join(routesDir, file) });
    routes.push(route.id);
    for (const persona of impliedRoutePersonas(route)) {
      if (personaIds.has(persona)) continue;
      if (ROUTE_PERSONA_EXCEPTIONS[persona]) {
        exceptions.push({ route: route.id, persona, reason: ROUTE_PERSONA_EXCEPTIONS[persona] });
      } else {
        missing.push({ route: route.id, persona });
      }
    }
  }

  return {
    ok: personaResult.ok && missing.length === 0,
    routes,
    personas: [...personaIds].sort(),
    missing,
    exceptions,
    personaFailures: personaResult.failures
  };
}

export async function scanPersonaPrivateReferenceLeakage({ personasDir } = {}) {
  const files = await collectFiles(personasDir);
  const matches = [];
  for (const filePath of files) {
    const content = await readFile(filePath, 'utf8');
    for (const pattern of PRIVATE_PLAYBOOK_PATTERNS) {
      if (pattern.test(content)) {
        matches.push({ filePath, pattern: pattern.toString() });
      }
    }
  }
  return { ok: matches.length === 0, matches };
}

export function impliedRoutePersonas(route) {
  const personas = new Set();
  if (route.lead) personas.add(route.lead);
  for (const teammate of route.teammates || []) personas.add(personaFromLanePath(teammate));
  for (const lane of route.lanes || []) personas.add(personaFromLanePath(lane));
  return [...personas].filter(Boolean).sort();
}

function personaFromLanePath(lanePath) {
  if (lanePath === 'oscar') return 'oscar';
  if (lanePath === 'bob') return 'bob';
  if (lanePath === 'ian') return 'ian';
  if (lanePath === 'phil') return 'phil';
  if (lanePath === 'talia') return 'talia';
  if (lanePath === 'quinn') return 'quinn';
  if (lanePath.startsWith('verifiers.')) return 'verifier';
  if (lanePath.startsWith('bobHelpers.')) return 'bob';
  return lanePath;
}

async function collectFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(entryPath));
    else files.push(entryPath);
  }
  return files.sort();
}
