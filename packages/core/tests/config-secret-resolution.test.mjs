// M4.5 (audit §H1) + M4.6 (audit §H2) regression coverage for
// packages/core/lib/config.mjs.
//
// M4.5 — `resolveSecretReferences()` is wired into `resolveConfig()` so
// runtime callers get real values; the `resolveSecrets: false` opt-out is
// what `config get` uses to keep `${env:OPENAI_API_KEY}` literals out of
// stdout.
//
// M4.6 — `validateConfig()` fails closed when the schema artifact is missing;
// the `allowMissingSchema: true` opt-out preserves the old skip-and-continue
// shape for tests that intentionally exercise the validate path without a
// built schema on disk.

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { DEFAULT_CONFIG, resolveConfig, resolveSecretReferences, validateConfig } from '../lib/config.mjs';

async function makeFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cocoder-secret-resolution-'));
  await mkdir(path.join(root, 'local'), { recursive: true });
  await mkdir(path.join(root, 'templates', 'install-local'), { recursive: true });
  await writeFile(
    path.join(root, 'templates', 'install-local', 'config.example.yaml'),
    ['version: "0.1"', 'defaults:', '  adapter: codex'].join('\n')
  );
  await writeFile(
    path.join(root, 'local', 'config.yaml'),
    [
      'defaults:',
      '  adapter: claude',
      'secrets:',
      '  openai: "${env:RESOLVE_TEST_OPENAI_KEY}"'
    ].join('\n')
  );
  return root;
}

test('resolveConfig resolves ${env:FOO} secret references by default', async () => {
  const root = await makeFixture();
  try {
    const previous = process.env.RESOLVE_TEST_OPENAI_KEY;
    process.env.RESOLVE_TEST_OPENAI_KEY = 'sk-resolve-test-value';
    try {
      const { config } = await resolveConfig({ cocoderHome: root });
      assert.equal(config.secrets.openai, 'sk-resolve-test-value');
      assert.equal(config.defaults.adapter, 'claude');
    } finally {
      if (previous === undefined) delete process.env.RESOLVE_TEST_OPENAI_KEY;
      else process.env.RESOLVE_TEST_OPENAI_KEY = previous;
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('resolveConfig with resolveSecrets:false leaves ${env:FOO} literal in the merged config', async () => {
  const root = await makeFixture();
  try {
    process.env.RESOLVE_TEST_OPENAI_KEY = 'sk-should-not-appear';
    try {
      const { config } = await resolveConfig({ cocoderHome: root, resolveSecrets: false });
      assert.equal(config.secrets.openai, '${env:RESOLVE_TEST_OPENAI_KEY}');
    } finally {
      delete process.env.RESOLVE_TEST_OPENAI_KEY;
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('resolveSecretReferences honors an injected env object instead of process.env', async () => {
  const value = { secrets: { openai: '${env:FAKE_KEY}' } };
  const resolved = await resolveSecretReferences(value, { env: { FAKE_KEY: 'sk-injected' } });
  assert.equal(resolved.secrets.openai, 'sk-injected');
});

test('resolveSecretReferences raises when the referenced env var is missing', async () => {
  const value = { secrets: { openai: '${env:DEFINITELY_NOT_SET_KEY}' } };
  await assert.rejects(
    () => resolveSecretReferences(value, { env: {} }),
    /Missing environment secret DEFINITELY_NOT_SET_KEY/
  );
});

test('validateConfig fails closed when the schema artifact is missing (M4.6)', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cocoder-schema-missing-'));
  try {
    const missingSchema = path.join(root, 'never-built.schema.json');
    await assert.rejects(
      () => validateConfig(DEFAULT_CONFIG, { schemaPath: missingSchema }),
      /Config schema artifact missing at .*never-built\.schema\.json/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('validateConfig with allowMissingSchema:true preserves the legacy skip behavior', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cocoder-schema-missing-allow-'));
  try {
    const missingSchema = path.join(root, 'never-built.schema.json');
    const result = await validateConfig(DEFAULT_CONFIG, { schemaPath: missingSchema, allowMissingSchema: true });
    assert.equal(result.ok, true);
    assert.equal(result.skipped, true);
    assert.equal(result.schemaPath, missingSchema);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('validateConfig still passes when the real built schema is present (regression — does not break Solve fixtures)', async () => {
  // Uses the actual packages/schemas/dist/config.schema.json that ships with
  // the repo (built via pre-test `pnpm -F schemas build`). DEFAULT_CONFIG
  // must validate against it; if this fails we have a real schema drift.
  const result = await validateConfig(DEFAULT_CONFIG);
  assert.equal(result.ok, true);
  assert.equal(result.skipped, false);
});
