import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Audit §B1 / M4.3: shipped runtime modules used to hardcode `cocoder/core/cli.mjs` —
// a path that does not exist in CoCoder (the CLI lives at `packages/core/cli.mjs`).
// These tests prevent the legacy literal from re-creeping in and confirm the
// import.meta.url-relative resolution lands on a real file.

const RESOLVED_CLI_PATH = fileURLToPath(new URL('../cli.mjs', import.meta.url));

test('resolved core CLI path exists on disk', async () => {
  await assert.doesNotReject(access(RESOLVED_CLI_PATH), `expected ${RESOLVED_CLI_PATH} to be readable`);
});

test('launch.mjs no longer carries the legacy cocoder/core/cli.mjs literal', async () => {
  const source = await readFile(new URL('../lib/launch.mjs', import.meta.url), 'utf8');
  assert.ok(
    !source.includes('cocoder/core/cli.mjs'),
    'launch.mjs still references the legacy cocoder/core/cli.mjs path'
  );
});

test('debugger.mjs no longer carries the legacy cocoder/core/cli.mjs literal', async () => {
  const source = await readFile(new URL('../lib/debugger.mjs', import.meta.url), 'utf8');
  assert.ok(
    !source.includes('cocoder/core/cli.mjs'),
    'debugger.mjs still references the legacy cocoder/core/cli.mjs path'
  );
});

test('orchestrator-commit.mjs DEFAULT_IMPLEMENTATION_SURFACES drops legacy cocoder/core/ entries', async () => {
  const source = await readFile(new URL('../lib/orchestrator-commit.mjs', import.meta.url), 'utf8');
  // Surfaces array should no longer list any cocoder/core/, cocoder/scripts/, cocoder/tests/ entries.
  // (The comment block referencing the history is fine; the literal array entries are not.)
  assert.ok(
    !/['"]cocoder\/core\/['"]/.test(source),
    'orchestrator-commit.mjs still lists "cocoder/core/" as an implementation surface'
  );
  assert.ok(
    !/['"]cocoder\/scripts\/['"]/.test(source),
    'orchestrator-commit.mjs still lists "cocoder/scripts/" as an implementation surface'
  );
  assert.ok(
    !/['"]cocoder\/tests\/['"]/.test(source),
    'orchestrator-commit.mjs still lists "cocoder/tests/" as an implementation surface'
  );
});
