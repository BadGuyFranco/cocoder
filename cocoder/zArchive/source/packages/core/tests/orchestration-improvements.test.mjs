import assert from 'node:assert/strict';
import test from 'node:test';
import {
  VERIFICATION_ARTIFACT_GUARD_LINE,
  composeRuntimeRoleLines
} from '../lib/launch.mjs';

// M4.26 / pending-decisions Q5=A.
// The verification-artifact write guard's SSOT is the inline string in launch.mjs.
// These tests exercise the guard via the live composeRuntimeRoleLines() builder
// (not a source-text grep) so the regression catches behavior changes, not just
// edits to the file's text.

test('VERIFICATION_ARTIFACT_GUARD_LINE captures the documented key phrases', () => {
  assert.match(VERIFICATION_ARTIFACT_GUARD_LINE, /Do not mutate ignored dependency, build, or cache artifacts/);
  assert.match(VERIFICATION_ARTIFACT_GUARD_LINE, /`node_modules\/`, `dist\/`, `\.turbo\/`/);
  assert.match(
    VERIFICATION_ARTIFACT_GUARD_LINE,
    /Verification must be reproducible from tracked manifests, lockfiles, and declared commands/
  );
});

test('composeRuntimeRoleLines emits the verification guard in the Runtime Role section', () => {
  const lines = composeRuntimeRoleLines({
    lane: 'bob',
    persona: 'bob',
    adapter: 'codex',
    canWrite: true,
    routeOwnedCommit: false
  });
  assert.ok(lines.includes('## Runtime Role'));
  assert.ok(lines.includes(VERIFICATION_ARTIFACT_GUARD_LINE),
    'Runtime Role lines must include the verification-artifact guard line');
});

test('composeRuntimeRoleLines surfaces the can_write directive for each lane variant', () => {
  const writeLines = composeRuntimeRoleLines({ lane: 'bob', persona: 'bob', adapter: 'codex', canWrite: true });
  assert.ok(writeLines.some((line) => line.includes('can_write is true')));
  const readLines = composeRuntimeRoleLines({ lane: 'oscar', persona: 'oscar', adapter: 'codex', canWrite: false });
  assert.ok(readLines.some((line) => line.includes('can_write is false')));
});

test('composeRuntimeRoleLines includes route-owned commit guidance only when the route opts in', () => {
  const plain = composeRuntimeRoleLines({ lane: 'bob', persona: 'bob', adapter: 'codex', canWrite: true });
  assert.equal(plain.some((line) => line.includes('route-owned exact-file commits')), false);

  const routed = composeRuntimeRoleLines({
    lane: 'bob',
    persona: 'bob',
    adapter: 'codex',
    canWrite: true,
    routeOwnedCommit: true,
    routeWriteScope: { allowed: ['packages/core/tests/**'], excluded: [] }
  });
  assert.ok(routed.some((line) => line.includes('route-owned exact-file commits')));
  assert.ok(routed.some((line) => line.includes('packages/core/tests/**')));
  // Guard still present alongside the route-owned commit lines.
  assert.ok(routed.includes(VERIFICATION_ARTIFACT_GUARD_LINE));
});
