// ADR-0040 oz-action owner map:
// Source of truth: OZ_ACTION_SCOPE below is the one reversible-edit allow-list for the future
// daemon `oz-action` lane. Do not restate these globs in daemon handlers, prompts, or tests.
// Runtime consumer: the future daemon oz-action handler passes this constant to commitScoped via
// the existing commit-gate spine.
// Commit behavior: every changed path lands; paths outside this allow-list are surfaced as outOfLane by
// commitScoped. No second partition or commit path is introduced here.
// Tests that pin this owner: packages/core/tests/oz-action-scope.test.ts proves the allow-list
// and out-of-lane flagging contract. Objective creation gates remain owned by the authoring lane.

export const OZ_ACTION_SCOPE = [
  'cocoder/priorities/order.json',
  'cocoder/tickets/**',
  'docs/**',
  '*.md',
  'cocoder/priorities/*.md',
] as const satisfies readonly string[]
