import { access, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathExists, readJson } from './fs-utils.mjs';
import { loadContracts, validateInstance } from './contracts.mjs';

export const ADAPTER_PREFLIGHT_STATUSES = Object.freeze({
  AVAILABLE: 'available',
  MISSING_CLI: 'missing-cli',
  UNSUPPORTED: 'unsupported-adapter',
  AUTH_CONFIG_UNAVAILABLE: 'auth-config-unavailable'
});

export const ADAPTER_ITEM_ENUMS = Object.freeze({
  evidenceCapabilities: Object.freeze(['transcript', 'screenshot', 'dom', 'console', 'command-output', 'diff', 'test-result', 'human-confirmation']),
  failureModes: Object.freeze(['missing-cli', 'auth-expired', 'stalled-tui', 'refusal', 'no-result-file', 'permission-prompt', 'rate-limit', 'unknown']),
  sandboxModes: Object.freeze(['read-only', 'workspace-write', 'danger-full-access']),
  approvalModes: Object.freeze(['never', 'on-request'])
});

export async function loadAdapterDeclarations({ adaptersDir, contractsDir }) {
  const contracts = await loadContracts(contractsDir);
  const contract = contracts.get('adapter-declaration');
  if (!contract) throw new Error('Missing adapter-declaration contract');

  const files = (await readdir(adaptersDir)).filter((name) => name.endsWith('.json')).sort();
  const adapters = [];
  const failures = [];
  for (const file of files) {
    const filePath = path.join(adaptersDir, file);
    const adapter = await readJson(filePath);
    const errors = [
      ...validateInstance(contract, adapter),
      ...validateAdapterSemantics(adapter)
    ];
    if (errors.length > 0) failures.push({ filePath, errors });
    else adapters.push({ ...adapter, filePath });
  }
  return { adapters, failures };
}

export function validateAdapterSemantics(adapter) {
  const errors = [];
  for (const [field, allowedItems] of Object.entries(ADAPTER_ITEM_ENUMS)) {
    const value = adapter[field];
    if (!Array.isArray(value)) continue;
    const allowed = new Set(allowedItems);
    for (const item of value) {
      if (!allowed.has(item)) errors.push(`${field} contains unsupported item ${item}`);
    }
  }
  return errors;
}

export async function preflightAdapter(adapter, options = {}) {
  const env = options.env || process.env;
  const pathValue = options.pathValue || env.PATH || '';
  const availability = adapter.availabilityCheck || {};

  if (availability.supported === false || adapter.kind === 'future-cli') {
    return preflightResult(adapter, ADAPTER_PREFLIGHT_STATUSES.UNSUPPORTED, [`${adapter.id} is a future or unsupported adapter declaration`]);
  }

  const commandName = availability.commandExists || firstCommandToken(adapter.command);
  if (!commandName || !(await commandExists(commandName, pathValue))) {
    return preflightResult(adapter, ADAPTER_PREFLIGHT_STATUSES.MISSING_CLI, [`missing command: ${commandName || adapter.command}`]);
  }

  const missingEnv = (availability.requiredEnv || []).filter((name) => !env[name]);
  const missingFiles = [];
  for (const filePath of availability.requiredFiles || []) {
    if (!(await pathExists(filePath))) missingFiles.push(filePath);
  }
  if (missingEnv.length > 0 || missingFiles.length > 0) {
    return preflightResult(adapter, ADAPTER_PREFLIGHT_STATUSES.AUTH_CONFIG_UNAVAILABLE, [
      ...missingEnv.map((name) => `missing env: ${name}`),
      ...missingFiles.map((filePath) => `missing file: ${filePath}`)
    ]);
  }

  return preflightResult(adapter, ADAPTER_PREFLIGHT_STATUSES.AVAILABLE, []);
}

export async function preflightAdapterRegistry({ adaptersDir, contractsDir, env, pathValue } = {}) {
  const loaded = await loadAdapterDeclarations({ adaptersDir, contractsDir });
  const results = [];
  for (const adapter of loaded.adapters) {
    results.push(await preflightAdapter(adapter, { env, pathValue }));
  }
  return {
    ok: loaded.failures.length === 0,
    failures: loaded.failures,
    results
  };
}

async function commandExists(commandName, pathValue) {
  if (commandName.includes('/') || commandName.includes(path.sep)) {
    try {
      await access(commandName);
      return true;
    } catch {
      return false;
    }
  }
  for (const dir of pathValue.split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(dir, commandName);
    try {
      await access(candidate);
      return true;
    } catch {
      // Continue searching PATH.
    }
  }
  return false;
}

function preflightResult(adapter, status, reasons) {
  return {
    adapter: adapter.id,
    label: adapter.label,
    status,
    available: status === ADAPTER_PREFLIGHT_STATUSES.AVAILABLE,
    reasons,
    authHint: adapter.availabilityCheck?.authHint || ''
  };
}

function firstCommandToken(command) {
  if (typeof command !== 'string') return '';
  return command.trim().split(/\s+/)[0] || '';
}
