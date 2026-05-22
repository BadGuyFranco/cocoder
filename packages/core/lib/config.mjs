import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { getByDottedPath, pathExists, readJson, readStructuredFile, setByDottedPath, writeStructuredFile } from './fs-utils.mjs';
import { loadContracts, validateInstance } from './contracts.mjs';
import { resolveInstallRoot } from './paths.mjs';

export const DEFAULT_CONFIG = {
  version: '0.1',
  defaults: {
    adapter: 'codex'
  },
  oz: {
    host: '127.0.0.1',
    port: 47321
  },
  theme: {
    mode: 'system'
  }
};

export async function resolveConfig(options = {}) {
  const cocoderHome = path.resolve(options.cocoderHome || await resolveInstallRoot(options.cwd || process.cwd()));
  const workspaceRoot = options.workspaceRoot ? path.resolve(options.workspaceRoot) : null;
  const files = await configFileOrder({ cocoderHome, workspaceRoot });
  const loaded = [];
  let value = structuredClone(DEFAULT_CONFIG);

  for (const filePath of files) {
    if (!(await pathExists(filePath))) continue;
    const partial = await readStructuredFile(filePath);
    value = deepMerge(value, partial, { source: filePath });
    loaded.push(filePath);
  }

  await validateConfig(value, { schemaPath: options.schemaPath });
  return {
    config: value,
    loaded,
    cocoderHome,
    workspaceRoot
  };
}

export async function loadConfigFile({ contractsDir, contractId, filePath }) {
  const contracts = await loadContracts(contractsDir);
  const contract = contracts.get(contractId);
  if (!contract) throw new Error(`Missing contract ${contractId}`);
  const value = await readJson(filePath);
  const errors = validateInstance(contract, value);
  if (errors.length > 0) throw new Error(`${filePath} failed ${contractId} validation: ${errors.join('; ')}`);
  return value;
}

export function loadProfile(options) {
  return loadConfigFile({ ...options, contractId: 'profile-roster' });
}

export function loadRoute(options) {
  return loadConfigFile({ ...options, contractId: 'route-declaration' });
}

export function loadPersona(options) {
  return loadConfigFile({ ...options, contractId: 'persona-contract' });
}

export function loadAdapter(options) {
  return loadConfigFile({ ...options, contractId: 'adapter-declaration' });
}

export async function getConfigValue(key, options = {}) {
  const { config } = await resolveConfig(options);
  return getByDottedPath(config, key);
}

export async function setInstallConfigValue(key, rawValue, options = {}) {
  const cocoderHome = path.resolve(options.cocoderHome || await resolveInstallRoot(options.cwd || process.cwd()));
  const filePath = options.filePath || path.join(cocoderHome, 'local', 'config.yaml');
  const current = await pathExists(filePath) ? await readStructuredFile(filePath) : {};
  const next = setByDottedPath(current, key, rawValue);
  await validateConfig(deepMerge(structuredClone(DEFAULT_CONFIG), next), { schemaPath: options.schemaPath });
  await writeStructuredFile(filePath, next);
  return { filePath, config: next, zone: 'install-local' };
}

// M4.23 / pending-decisions Q2=A — workspace-local config writer.
// Routed via `--workspace-root` on `config set`; writes to
// `<workspace>/cocoder/local/config.yaml` (the workspace-private zone).
export async function setWorkspaceConfigValue(key, rawValue, options = {}) {
  if (!options.workspaceRoot) {
    throw new Error('setWorkspaceConfigValue requires options.workspaceRoot');
  }
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const filePath = options.filePath || path.join(workspaceRoot, 'cocoder', 'local', 'config.yaml');
  const current = await pathExists(filePath) ? await readStructuredFile(filePath) : {};
  const next = setByDottedPath(current, key, rawValue);
  await validateConfig(deepMerge(structuredClone(DEFAULT_CONFIG), next), { schemaPath: options.schemaPath });
  await writeStructuredFile(filePath, next);
  return { filePath, config: next, zone: 'workspace-local' };
}

export async function resolveSecretReferences(value, { baseDir = process.cwd(), env = process.env } = {}) {
  if (Array.isArray(value)) {
    return Promise.all(value.map((item) => resolveSecretReferences(item, { baseDir, env })));
  }
  if (value && typeof value === 'object') {
    const entries = await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await resolveSecretReferences(item, { baseDir, env })]));
    return Object.fromEntries(entries);
  }
  if (typeof value !== 'string') return value;
  const match = value.match(/^\$\{([^:}]+):([^}]+)\}$/);
  if (!match) return value;
  const [, kind, target] = match;
  if (kind === 'env') {
    if (!(target in env)) throw new Error(`Missing environment secret ${target}`);
    return env[target];
  }
  if (kind === 'file') {
    const filePath = path.resolve(baseDir, target);
    return readFile(filePath, 'utf8');
  }
  if (kind === 'keychain') {
    throw new Error('Keychain secret references are reserved for v0.2');
  }
  return value;
}

export function deepMerge(base, overlay, { source = 'overlay' } = {}) {
  if (overlay === undefined) return base;
  if (Array.isArray(base) || Array.isArray(overlay)) {
    if (overlay && typeof overlay === 'object' && !Array.isArray(overlay) && overlay.__merge === 'append') {
      const items = Array.isArray(overlay.items) ? overlay.items : [];
      return [...(Array.isArray(base) ? base : []), ...items];
    }
    if (overlay && typeof overlay === 'object' && !Array.isArray(overlay) && overlay.__merge === 'replace') {
      return Array.isArray(overlay.items) ? overlay.items : [];
    }
    return structuredClone(overlay);
  }
  if (!isPlainObject(base) || !isPlainObject(overlay)) return structuredClone(overlay);
  const next = structuredClone(base);
  for (const [key, value] of Object.entries(overlay)) {
    if (key === '__merge') continue;
    next[key] = key in next ? deepMerge(next[key], value, { source }) : structuredClone(value);
  }
  return next;
}

export async function validateConfig(value, { schemaPath } = {}) {
  const resolvedSchemaPath = schemaPath || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../schemas/dist/config.schema.json');
  if (!(await pathExists(resolvedSchemaPath))) return { ok: true, skipped: true, schemaPath: resolvedSchemaPath };
  const schema = JSON.parse(await readFile(resolvedSchemaPath, 'utf8'));
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  if (validate(value)) return { ok: true, skipped: false, schemaPath: resolvedSchemaPath };
  const message = validate.errors.map((error) => {
    const pointer = error.instancePath || '/';
    return `${pointer} ${error.message}`;
  }).join('; ');
  throw new Error(`Config validation failed: ${message}`);
}

export async function configFileOrder({ cocoderHome, workspaceRoot }) {
  const files = [
    path.join(cocoderHome, 'templates', 'install-local', 'config.example.yaml'),
    path.join(cocoderHome, 'local', 'config.yaml'),
    path.join(cocoderHome, 'local', 'config.json'),
    path.join(cocoderHome, 'local', 'overrides.yaml'),
    path.join(cocoderHome, 'local', 'overrides.json')
  ];
  if (workspaceRoot) {
    files.push(
      path.join(workspaceRoot, 'cocoder', 'config.yaml'),
      path.join(workspaceRoot, 'cocoder', 'config.json'),
      path.join(workspaceRoot, 'cocoder', 'local', 'config.yaml'),
      path.join(workspaceRoot, 'cocoder', 'local', 'config.json'),
      path.join(workspaceRoot, 'cocoder', 'local', 'overrides.yaml'),
      path.join(workspaceRoot, 'cocoder', 'local', 'overrides.json')
    );
  }
  return files;
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}
