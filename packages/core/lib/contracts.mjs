import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_CONTRACTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../contracts');

export async function loadContracts(contractsDir = DEFAULT_CONTRACTS_DIR) {
  const result = await validateContractFiles(contractsDir);
  if (result.failures.length > 0) {
    throw new Error(`Contract validation failed: ${result.failures.map((failure) => failure.file).join(', ')}`);
  }
  return new Map(result.contracts.map((contract) => [contract.contract, contract]));
}

export async function validateContractFiles(contractsDir = DEFAULT_CONTRACTS_DIR) {
  const failures = [];
  const contracts = [];
  const entries = await readdir(contractsDir, { withFileTypes: true });
  for (const entry of entries.filter((item) => item.isFile() && item.name.endsWith('.json'))) {
    const filePath = path.join(contractsDir, entry.name);
    try {
      const value = JSON.parse(await readFile(filePath, 'utf8'));
      validateContractShape(value);
      contracts.push(value);
    } catch (error) {
      failures.push({ file: filePath, message: error.message });
    }
  }
  return { ok: failures.length === 0, contracts, failures };
}

export function validateInstance(contract, instance) {
  const errors = [];
  for (const field of contract.required || []) {
    if (!hasPath(instance, field)) errors.push(`${field} is required`);
  }
  for (const [fieldPath, field] of Object.entries(contract.fields || {})) {
    if (!hasPath(instance, fieldPath)) continue;
    const value = getPath(instance, fieldPath);
    if (field.type && !matchesType(value, field.type)) {
      errors.push(`${fieldPath} expected ${field.type}`);
    }
  }
  return errors;
}

function validateContractShape(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Contract must be an object');
  if (typeof value.contract !== 'string' || value.contract.length === 0) throw new Error('Contract contract is required');
  if (typeof value.version !== 'string' && typeof value.version !== 'number') throw new Error('Contract version is required');
  if (typeof value.status !== 'string' || value.status.length === 0) throw new Error('Contract status is required');
  if (value.required !== undefined && !Array.isArray(value.required)) throw new Error('Contract required must be an array');
  if (value.fields !== undefined && (typeof value.fields !== 'object' || Array.isArray(value.fields))) throw new Error('Contract fields must be an object');
}

function hasPath(value, dottedPath) {
  return getPath(value, dottedPath) !== undefined;
}

function getPath(value, dottedPath) {
  return String(dottedPath).split('.').reduce((current, segment) => current?.[segment], value);
}

function matchesType(value, type) {
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return value && typeof value === 'object' && !Array.isArray(value);
  if (type === 'iso-datetime') {
    if (typeof value !== 'string' || value.length === 0) return false;
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) return false;
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/.test(value);
  }
  return typeof value === type;
}
