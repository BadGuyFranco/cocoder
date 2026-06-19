# Founder Brief Format Durability

## Owner map

- Source of truth: `packages/personas/base/plays/wrap-up.md` owns the founder-visible closeout format.
  Its fenced contract names the exact labels and order, and its prose owns the content constraints for
  `What Changed`, `Run Status`, `What Remains`, `Recommended Next Step`, `Commit State`, `Teardown
  Readiness`, and final standing-by line (`packages/personas/base/plays/wrap-up.md:44-115`).
- Persona surface: Oscar is a consumer only. It points at the wrap-up Play and explicitly says not to
  invent a parallel shape (`packages/personas/base/oscar.md:162-164`).
- Runner prompt surface: Oscar's wrap-up directive mentions the wrap-up Play section contract instead
  of restating the labels (`packages/core/src/runner/prompts.ts:162-169`).
- Daemon launch surface: run input loads the effective `wrap-up` Play, including repo deltas, before
  handing it to the runner (`packages/daemon/src/launcher.ts:96-119`); launch coverage proves deltas are
  merged into that effective Play (`packages/daemon/tests/play-delta-launch.test.ts:61-78`).
- Runtime enforcement: the runner now parses the effective Play's fenced contract, validates the
  wrap-up output against that parsed contract, and renders its malformed-brief fallback from the same
  parsed labels (`packages/core/src/runner/runner.ts:182-197`,
  `packages/core/src/runner/runner.ts:244-335`, `packages/core/src/runner/runner.ts:1070-1108`).
- Pinning tests: base persona tests pin the Play as the canonical owner and Oscar as a deferring
  consumer (`packages/personas/tests/base-personas.test.ts:147-179`). Runner tests prove malformed
  output is blocked, old labels fail after a Play-label change, updated labels pass, and the observed
  drift classes are rejected (`packages/core/tests/runner.test.ts:855-980`).

## Six observed mismatch classes

The recurring problem was not one bad sentence. The Play, persona prompt, runner validator, fallback
brief, and tests could each preserve a different copy of the expected shape. The six drift classes now
covered are:

1. Missing or non-first `Founder Completion Brief` title.
2. Ledger/test-matrix detail in `What Changed`.
3. Optional or multi-choice action language in `Recommended Next Step`.
4. Long or multi-sentence `What Changed` summaries.
5. Percent-complete lifecycle claims in `Run Status`.
6. Overlong, implementation-labeled, or bare-priority `What Remains` / `Recommended Next Step` handoffs.

## Ticket review

- `0005` folded in as evidence, not closed. It is the same governed-file-versus-side-channel-memory
  failure mode: durable behavior must live in governed persona/standards files and be read by runtime
  surfaces.
- `0012` left as a sibling. It covers generated UI/design-reference clobbering, the generated-source
  version of the same source-of-truth problem; this repair does not decide the design-ref direction.
- `0015` left as a sibling. It covers ticket authoring format and loader enforcement drift; this repair
  uses the same pattern but does not fix ticket loader behavior.
- `0008` folded in as precedent and remains closed. It showed the durable-orchestration repair shape:
  map every prompt/runtime/status surface, align the owner, and pin the contract with tests.

## Why the prior change drifted

The prior change was hard to make stick because the Play text was treated as the owner in prose while
the runner still kept its own section list, fallback brief, and validation messages. A future founder
change to the Play could leave the runtime accepting the old labels or emitting the old fallback. The
smallest durable rule is: when a founder-facing orchestration format is owned by a Play or governed
persona file, runtime validators and fallback emitters must parse or import that owner; they must not
copy the format into a second local contract.
