#!/usr/bin/env node
// Regenerator for `accepted-reference-baseline.md`.
//
// `cocoder check-immutable-baseline` (via `compareImmutableBaseline` in
// packages/core/lib/baseline.mjs) compares the live state of the persona /
// shared-prompt surface (default root: `cocoder/personas/`) against the
// frozen markdown table at `packages/core/baselines/accepted-reference-baseline.md`.
//
// That baseline file should change ONLY when the persona library itself
// changes by founder-approved action (e.g., adding Quinn / Ian / Phil under
// Sub-Playbook B). When that happens:
//
//   $ node packages/core/baselines/regenerate.mjs > packages/core/baselines/accepted-reference-baseline.md
//
// then commit the regenerated file alongside the persona-library change in
// the same PR. The PR description should call out the persona additions /
// removals so the baseline delta is auditable.
//
// Originally ported 2026-05-23 (M4.12 / audit §B2) — the upstream CoBuilder
// baseline shipped a pre-generated table for `cobuilder-build/build-personas/`;
// CoCoder regenerates against its own `cocoder/personas/` surface instead.

import {
  collectReferenceEntries,
  DEFAULT_REFERENCE_ROOTS,
  DEFAULT_EXCLUDED_PREFIXES,
  DEFAULT_EXCLUDED_BASENAMES
} from '../lib/baseline.mjs';

const entries = await collectReferenceEntries({
  roots: DEFAULT_REFERENCE_ROOTS,
  excludedPrefixes: DEFAULT_EXCLUDED_PREFIXES,
  excludedBasenames: DEFAULT_EXCLUDED_BASENAMES
});

const lines = [
  '# Accepted Reference Baseline',
  '',
  'Frozen reference snapshot of the persona / shared-prompt surface under `cocoder/personas/`. Compared against live state by `cocoder check-immutable-baseline`. Drift here means either (a) an unauthorized mutation of the persona library or (b) a founder-approved change that needs the baseline regenerated + committed in the same PR. See `packages/core/baselines/regenerate.mjs` for the regenerator + the rationale.',
  '',
  '| status | kind | bytes | sha256 | path |',
  '|--------|------|-------|--------|------|'
];

for (const entry of entries) {
  lines.push(`| ${entry.status} | ${entry.kind} | ${entry.bytes} | ${entry.sha256} | \`${entry.path}\` |`);
}

process.stdout.write(`${lines.join('\n')}\n`);
