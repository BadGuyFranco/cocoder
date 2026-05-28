import assert from 'node:assert/strict';
import test from 'node:test';
import { validateModelRolesSemantics } from '../lib/model-roles.mjs';
import { validateInstance } from '../lib/contracts.mjs';
import { hasPrivateLegacyReference, validatePromptManifest } from '../lib/composition.mjs';
import { renderSessionWrapper } from '../lib/launch.mjs';

// Sub-Playbook E (Dogfood Ramp) surfaced two integration bugs while running
// `compose-launch` and `launch` against the CoCoder dogfood workspace. These
// regression tests pin the fixes so the next dogfood run does not re-hit them.

test('validateModelRolesSemantics treats null like undefined (E-S1 modelRoles bug)', () => {
  // resolveModelRoles({ profile, route }) returns null when merged is empty
  // (model-roles.mjs:12). The downstream validator previously only
  // short-circuited on undefined and emitted a false-positive
  // "modelRoles must be an object when present" for every profile/route
  // pair that did not declare modelRoles.
  assert.deepEqual(validateModelRolesSemantics({ modelRoles: undefined }), []);
  assert.deepEqual(validateModelRolesSemantics({ modelRoles: null }), []);
});

test('validateModelRolesSemantics still rejects non-object values', () => {
  assert.deepEqual(
    validateModelRolesSemantics({ modelRoles: 'oops' }),
    ['modelRoles must be an object when present']
  );
  assert.deepEqual(
    validateModelRolesSemantics({ modelRoles: 42 }),
    ['modelRoles must be an object when present']
  );
  assert.deepEqual(
    validateModelRolesSemantics({ modelRoles: [] }),
    ['modelRoles must be an object when present']
  );
});

test('matchesType iso-datetime accepts ISO-8601 strings (startup-packet createdAt bug)', () => {
  // The startup-packet/evidence/self-healing contracts declare
  // `createdAt: { type: 'iso-datetime' }`. The previous matchesType
  // implementation fell through to `typeof value === 'iso-datetime'`,
  // which is always false, so launch failed with
  // "generated startup packet failed startup-packet validation:
  //  createdAt expected iso-datetime" on every run.
  const contract = {
    contract: 'startup-packet-stub',
    version: 1,
    status: 'phase-2-draft',
    required: ['createdAt'],
    fields: { createdAt: { type: 'iso-datetime' } }
  };
  assert.deepEqual(validateInstance(contract, { createdAt: '2026-05-22T13:45:30.123Z' }), []);
  assert.deepEqual(validateInstance(contract, { createdAt: '2026-05-22T13:45:30Z' }), []);
  assert.deepEqual(validateInstance(contract, { createdAt: '2026-05-22T13:45:30+02:00' }), []);
  assert.deepEqual(validateInstance(contract, { createdAt: new Date().toISOString() }), []);
});

test('matchesType iso-datetime rejects malformed and non-string values', () => {
  const contract = {
    contract: 'startup-packet-stub',
    version: 1,
    status: 'phase-2-draft',
    required: ['createdAt'],
    fields: { createdAt: { type: 'iso-datetime' } }
  };
  // Plain date with no time component is not iso-datetime.
  assert.deepEqual(
    validateInstance(contract, { createdAt: '2026-05-22' }),
    ['createdAt expected iso-datetime']
  );
  // Bare string that is not an ISO timestamp.
  assert.deepEqual(
    validateInstance(contract, { createdAt: 'yesterday' }),
    ['createdAt expected iso-datetime']
  );
  // Numbers / nulls / dates-as-objects are rejected.
  assert.deepEqual(
    validateInstance(contract, { createdAt: 1747920330000 }),
    ['createdAt expected iso-datetime']
  );
  assert.deepEqual(
    validateInstance(contract, { createdAt: null }),
    ['createdAt expected iso-datetime']
  );
});

test('PRIVATE_LEGACY_REFERENCE_PATTERNS no longer false-positives CoCoder prompt fragments', () => {
  // Earlier extraction renamed CoBuilder's `build-personas/` → `personas/`
  // inside PRIVATE_LEGACY_REFERENCE_PATTERNS, which then flagged CoCoder's
  // own legitimate manifest fragment paths (e.g. `personas/bob.md`,
  // `shared/write-boundaries.md`) as private-legacy leakage and prevented
  // every `composePersonaPrompt` call.
  assert.equal(hasPrivateLegacyReference('personas/bob.md'), false);
  assert.equal(hasPrivateLegacyReference('shared/write-boundaries.md'), false);
  assert.equal(hasPrivateLegacyReference('cocoder/personas/'), false);

  // True CoBuilder-private leakage must still be detected — these are
  // upstream playbook surfaces that should never appear in a shipped
  // CoCoder prompt fragment.
  assert.equal(hasPrivateLegacyReference('cobuilder-build/build-personas/bob.md'), true);
  assert.equal(hasPrivateLegacyReference('./cobuilder-build/orchestrator/scripts/foo.sh'), true);
  assert.equal(hasPrivateLegacyReference('see cobuilder-build/codex-orchestrator/notes.md'), true);
});

test('parseArgs preserves --workspace-slug as a literal string (not path.resolve)', async () => {
  // Sub-Playbook E found `parseArgs` was running `path.resolve` on every
  // flag value except an explicit allow-list. The `--workspace-slug`
  // argument (added in M4.27) was missing from the allow-list, so
  // `--workspace-slug cocoder-dogfood` was being resolved to an absolute
  // path against cwd — producing run dirs like
  //   `<install>/local/workspaces/<install>/cocoder-dogfood/runs/...`
  // instead of `<install>/local/workspaces/cocoder-dogfood/runs/...`.
  //
  // Re-export the parser to test it without touching cli.mjs internals.
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const cliPath = fileURLToPath(new URL('../cli.mjs', import.meta.url));
  // `list-runs` is read-only and goes through resolveDefaultRunPaths.
  // We do NOT need a real install; we just need the path-shape echoed back
  // in the error. Force --cocoder-home to a known tmp value and pass the
  // slug verbatim. The slug must surface verbatim in any path containing
  // `local/workspaces/<slug>/runs/`.
  const result = spawnSync('node', [
    cliPath,
    'list-runs',
    '--cocoder-home', '/tmp/cocoder-test',
    '--workspace-slug', 'cocoder-dogfood'
  ], { encoding: 'utf8' });
  const blob = `${result.stdout}\n${result.stderr}`;
  // Pre-fix bug: `cocoder-dogfood` was path.resolve'd → cwd-absolute.
  // Post-fix: appears verbatim as the workspaces/<slug>/ segment.
  assert.ok(
    /local\/workspaces\/cocoder-dogfood/.test(blob)
    || /workspaceSlug.*cocoder-dogfood/.test(blob)
    || result.status === 0,
    `expected workspace-slug 'cocoder-dogfood' to surface as a literal slug, got: ${blob}`
  );
  assert.ok(
    !/local\/workspaces\/(?:Users|Volumes|tmp|home)[^\s]*cocoder-dogfood/.test(blob),
    `workspace-slug was path-resolved (still contains a parent path before the slug): ${blob}`
  );
});

test('codex sandbox is danger-full-access for lead lanes, workspace-write otherwise', () => {
  // Sub-Playbook E E3.3 surfaced this: lead lanes drive teammate dispatch
  // via `tmux send-keys` from inside their own codex pane. The default
  // `workspace-write` sandbox denies socket IPC and the dispatch helper
  // fails with "Operation not permitted", blocking the whole route. The
  // lead lane needs `danger-full-access`; teammate lanes (which receive
  // dispatches but don't drive tmux themselves) stay locked down.
  const launchPlan = { cwd: '/tmp/cocoder-fixture' };
  const leadSession = {
    lane: 'bob',
    adapter: 'codex',
    startupMode: 'lead',
    adapterCapabilities: { interactive: true },
    bootstrapMessage: 'Read /tmp/prompt.md'
  };
  const teammateSession = {
    lane: 'talia',
    adapter: 'codex',
    startupMode: 'wait-for-lead-dispatch',
    adapterCapabilities: { interactive: true },
    bootstrapMessage: 'Read /tmp/talia/prompt.md'
  };
  const leadScript = renderSessionWrapper(launchPlan, leadSession);
  const teammateScript = renderSessionWrapper(launchPlan, teammateSession);
  assert.match(leadScript, /codex --ask-for-approval never --sandbox danger-full-access/);
  assert.doesNotMatch(leadScript, /sandbox workspace-write/);
  assert.match(teammateScript, /codex --ask-for-approval never --sandbox workspace-write/);
  assert.doesNotMatch(teammateScript, /sandbox danger-full-access/);
});

test('validatePromptManifest accepts the CoCoder dogfood Bob manifest shape', () => {
  // Regression for E-S1: this is the literal manifest the Sub-Playbook E
  // dogfood ramp authored. If a future scrub re-introduces an over-broad
  // pattern, this test catches it before launch does.
  const manifest = {
    version: 1,
    personas: {
      bob: [
        'shared/startup-packet.md',
        'shared/write-boundaries.md',
        'shared/result-contract.md',
        'shared/closeout.md',
        'shared/private-playbook-boundary.md',
        'shared/evidence-classes.md',
        'personas/bob.md'
      ]
    }
  };
  assert.deepEqual(validatePromptManifest(manifest), []);
});
