import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { loadContracts, validateInstance } from '../lib/contracts.mjs';

const repoRoot = path.resolve(process.cwd(), '../..');
const contractsDir = path.join(repoRoot, 'packages/core/contracts');

test('job-result status enum accepts PASS and rejects invalid values', async () => {
  const contracts = await loadContracts(contractsDir);
  const contract = contracts.get('job-result');
  assert.ok(contract);

  const valid = {
    status: 'PASS',
    persona: 'bob',
    adapter: 'codex',
    canWrite: true,
    filesChanged: ['none'],
    summary: 'ok',
    findings: ['none'],
    evidence: ['none'],
    residualRisk: ['none'],
    nextAction: 'none'
  };
  assert.deepEqual(validateInstance(contract, valid), []);

  const invalid = { ...valid, status: 'NOT_A_STATUS' };
  const errors = validateInstance(contract, invalid);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /status expected one of PASS, BLOCK/);
});

test('fields without enum still use type checking', async () => {
  const contracts = await loadContracts(contractsDir);
  const contract = contracts.get('job-result');
  const base = {
    status: 'PASS',
    persona: 'bob',
    adapter: 'codex',
    canWrite: true,
    filesChanged: ['none'],
    summary: 'ok',
    findings: ['none'],
    evidence: ['none'],
    residualRisk: ['none'],
    nextAction: 'none'
  };
  assert.deepEqual(validateInstance(contract, { ...base, canWrite: 'true' }), ['canWrite expected boolean']);
});

test('contract JSON files declare enum for job-result status', async () => {
  const raw = JSON.parse(await readFile(path.join(contractsDir, 'job-result.schema.json'), 'utf8'));
  assert.deepEqual(raw.fields.status.enum, ['PASS', 'BLOCK', 'CONDITIONAL_PASS', 'NEEDS_FOUNDER', 'FAILED']);
});
