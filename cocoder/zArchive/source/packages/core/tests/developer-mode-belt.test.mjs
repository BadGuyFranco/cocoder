import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COCODER_PRODUCT_WRITE_PREFIXES,
  auditCocoderProductWriteBelt,
  developerModeEnabled
} from '../lib/orchestrator-commit.mjs';

// M4.22 / pending-decisions Q1=B.
// The `--developer-mode` belt is the only line of defense between an
// orchestration run launched against the CoCoder install and accidental
// writes into the install-public product surface (`packages/`, `templates/`,
// `docs/`, `.github/`). These tests pin the belt's behavior so a refactor
// can't quietly undo Q1's choice.

test('product-write prefixes are exactly the Q1-B set', () => {
  assert.deepEqual(
    [...COCODER_PRODUCT_WRITE_PREFIXES],
    ['packages/', 'templates/', 'docs/', '.github/']
  );
});

test('developerModeEnabled treats explicit booleans + string forms identically', () => {
  assert.equal(developerModeEnabled(true, {}), true);
  assert.equal(developerModeEnabled('true', {}), true);
  assert.equal(developerModeEnabled('1', {}), true);
  assert.equal(developerModeEnabled(false, {}), false);
  assert.equal(developerModeEnabled('false', {}), false);
  assert.equal(developerModeEnabled('0', {}), false);
  assert.equal(developerModeEnabled(undefined, {}), false);
});

test('developerModeEnabled honors COCODER_DEVELOPER_MODE env when no explicit value given', () => {
  assert.equal(developerModeEnabled(undefined, { COCODER_DEVELOPER_MODE: '1' }), true);
  assert.equal(developerModeEnabled(undefined, { COCODER_DEVELOPER_MODE: 'true' }), true);
  assert.equal(developerModeEnabled(undefined, { COCODER_DEVELOPER_MODE: '0' }), false);
  assert.equal(developerModeEnabled(undefined, { COCODER_DEVELOPER_MODE: '' }), false);
  assert.equal(developerModeEnabled(undefined, {}), false);
});

test('developerModeEnabled — explicit false beats env=1 (caller intent wins)', () => {
  assert.equal(developerModeEnabled(false, { COCODER_DEVELOPER_MODE: '1' }), false);
  assert.equal(developerModeEnabled('false', { COCODER_DEVELOPER_MODE: '1' }), false);
});

test('belt passes when no files are committed', () => {
  const result = auditCocoderProductWriteBelt({ filesChanged: [], developerMode: false });
  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
});

test('belt passes when only non-product paths are touched', () => {
  const result = auditCocoderProductWriteBelt({
    filesChanged: ['cocoder/PRIORITIES.md', 'cocoder/SESSION_LOG.md', 'cocoder/priorities/v0.1-foundation/README.md'],
    developerMode: false
  });
  assert.equal(result.ok, true);
});

test('belt blocks a packages/ write when developer mode is off', () => {
  const result = auditCocoderProductWriteBelt({
    filesChanged: ['packages/core/lib/launch.mjs'],
    developerMode: false
  });
  assert.equal(result.ok, false);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].code, 'cocoder-product-write-blocked');
  assert.deepEqual(result.issues[0].paths, ['packages/core/lib/launch.mjs']);
  assert.equal(result.issues[0].severity, 'block');
  assert.match(result.issues[0].detail, /--developer-mode/);
  assert.match(result.issues[0].detail, /COCODER_DEVELOPER_MODE=1/);
});

test('belt blocks docs/, templates/, .github/ writes (full prefix set)', () => {
  const result = auditCocoderProductWriteBelt({
    filesChanged: ['docs/configuration.md', 'templates/install-local/config.example.yaml', '.github/workflows/ci.yml'],
    developerMode: false
  });
  assert.equal(result.ok, false);
  assert.equal(result.issues.length, 1);
  assert.deepEqual(result.issues[0].paths, [
    'docs/configuration.md',
    'templates/install-local/config.example.yaml',
    '.github/workflows/ci.yml'
  ]);
});

test('belt allows the same product writes when developer mode is on', () => {
  const result = auditCocoderProductWriteBelt({
    filesChanged: ['packages/core/lib/launch.mjs', 'docs/configuration.md', '.github/workflows/ci.yml'],
    developerMode: true
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
});

test('belt does not match similar-but-different prefixes (no false positives)', () => {
  // `packagesXYZ/` should NOT match `packages/`. `package.json` (no slash) should NOT match either.
  const result = auditCocoderProductWriteBelt({
    filesChanged: ['packagesXYZ/file.txt', 'package.json', 'github-mirror/foo.md'],
    developerMode: false
  });
  assert.equal(result.ok, true);
});

test('belt reports only the violating paths, not the clean ones', () => {
  const result = auditCocoderProductWriteBelt({
    filesChanged: [
      'cocoder/PRIORITIES.md',
      'packages/core/lib/foo.mjs',
      'cocoder/SESSION_LOG.md',
      'docs/configuration.md'
    ],
    developerMode: false
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.issues[0].paths, ['packages/core/lib/foo.mjs', 'docs/configuration.md']);
});
