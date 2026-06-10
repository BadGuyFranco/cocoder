# Loop-Packets Retrofit Audit

Audit date: 2026-06-10.

This audit covers active priority Playbooks from `cocoder/priorities/*.md`, using only Playbook text and
repo-visible scripts. It does not infer run state from the run database.

## Inclusion Rule

Audited flat priority files:

- `adhoc-session.md`
- `build-priorities-from-plan.md`
- `cli-config-and-model-discovery.md`
- `deb-scoped-repair-fallback.md`
- `full-oz-dashboard.md`
- `isolated-working-state-per-run.md`
- `new-primary-root.md`
- `personas-and-plays.md`
- `run-resolution-and-loop-reliability.md`

Excluded:

- `AGENTS.md` — registry instructions, not a priority Playbook.
- `loop-packets.md` — this priority, excluded by the dispatch.
- `backlog/*.md` — backlog subdirectory, not active under the inclusion rule.

Scripted criteria verified in repo scripts before use: root `pnpm test`, `pnpm typecheck`,
`pnpm check:topology`; package `test` scripts for `@cocoder/adapters`, `@cocoder/cli`,
`@cocoder/core`, `@cocoder/daemon`, `@cocoder/personas`, `@cocoder/session-hosts`, and
`@cocoder/ui`; package `typecheck` for `@cocoder/ui`.

## Priority Audits

### `adhoc-session`

**Remaining work shape:** The Playbook describes an on-ramp session: draft a new priority or run a
bounded read-only support task, ending in a drafted priority or written review/research report. It is
not product-build work.

**Loop-amenable atoms?** No. Success is a founder-facing artifact judged for usefulness and scope, not a
deterministic scripted signal.

**Recommendation:** no retrofit: keep as one-shot or read-only support because acceptance requires
judgment over the resulting draft/report.

**Pilot fitness:** Not a pilot candidate.

### `build-priorities-from-plan`

**Remaining work shape:** Oscar reads plans and decisions, identifies decided work without priority
stubs, and drafts founder-approved priority Playbooks. The Playbook notes this writes governance and
requires approval before stubs are written.

**Loop-amenable atoms?** No. The important gate is whether a drafted Objective is correct and approved,
which cannot be reduced to a script.

**Recommendation:** no retrofit: founder approval and objective quality are judgment gates, so planned
atoms should be one-shot gated.

**Pilot fitness:** Not a pilot candidate.

### `cli-config-and-model-discovery`

**Remaining work shape:** Status says backend adapter/daemon work is done; the remaining slice is UI
consumption of `GET /clis` and `POST /clis/:id/test`: persona Model dropdown, CLIs screen test/refresh,
and stale-model flag.

**Loop-amenable atoms?** Yes, for a narrow UI wire-up atom. Existing criteria can be
`pnpm --filter @cocoder/ui test` plus `pnpm typecheck`; the command exists because `@cocoder/ui` has
`test` and `typecheck` scripts and the root has `typecheck`.

**Recommendation:** retrofit: UI live-CLI wiring as a loop packet with `pnpm --filter @cocoder/ui test`
and `pnpm typecheck` as the scripted criterion.

**Pilot fitness:** Best pilot candidate. It is small, grind-shaped, already described as one remaining
UI atom, and can be measured against historical UI wiring atoms using round-trips and wall-clock.

### `deb-scoped-repair-fallback`

**Remaining work shape:** The Playbook defines six verified outcomes for Deb status, nudge, repair,
write-scope, triage, and recurrence escalation. It has no status section, so status is unclear from the
Playbook.

**Loop-amenable atoms?** Possibly for narrow implementation fixes under core tests, using
`pnpm --filter @cocoder/core test`, but the Playbook does not identify remaining work. The overall
priority also involves behavior and scope judgment.

**Recommendation:** no retrofit: status unclear from Playbook; do not retrofit until a remaining
defect is named with a failing core test.

**Pilot fitness:** Not a pilot candidate.

### `full-oz-dashboard`

**Remaining work shape:** The dashboard is in progress. Remaining work is a set of owed daemon
surfaces and design seams: workspace model, run stop, persona mode/sub-agents, add CLI, ad-hoc launch,
and priority create/reorder.

**Loop-amenable atoms?** Some future narrow implementation atoms could use existing commands such as
`pnpm --filter @cocoder/daemon test`, `pnpm --filter @cocoder/ui test`, `pnpm typecheck`, and
`pnpm check:topology`. The current remaining slices still carry design/API-shape decisions and
end-to-end UX judgment, so not every slice is loop-shaped.

**Recommendation:** no retrofit for the priority as a whole: split a concrete endpoint or UI fix first,
then declare loop-amenability only if its acceptance is an existing package test command going green.

**Pilot fitness:** Not the best pilot; the remaining slices are larger and more design-coupled than the
CLI UI wire-up.

### `isolated-working-state-per-run`

**Remaining work shape:** The Playbook objective is to implement per-run worktrees and verified
auto-merge. It contains verified-when criteria but no status/pickup section, so status is unclear from
the Playbook.

**Loop-amenable atoms?** The verification style is scripted and test-heavy, with plausible criteria
such as `pnpm --filter @cocoder/core test` for runner/worktree behavior. However, the Playbook does not
name remaining work.

**Recommendation:** no retrofit: status unclear from Playbook; only retrofit a specific regression if a
runner/worktree test is red or a new failing test can be added first.

**Pilot fitness:** Not a pilot candidate.

### `new-primary-root`

**Remaining work shape:** The Playbook describes a bootstrap/audit capability gated by founder
acceptance of the proposed decision, then live proof on a real external repo and dogfood drift mode.

**Loop-amenable atoms?** No for the current remaining shape. The main gates are founder acceptance,
audit quality, and external-repo proof. Those require judgment even if later implementation atoms add
tests.

**Recommendation:** no retrofit: founder-gated decision and audit-quality work should exit loops and
surface, not self-iterate.

**Pilot fitness:** Not a pilot candidate.

### `personas-and-plays`

**Remaining work shape:** Remaining work is base QA personas, no-brainer Plays, and extending the
base/delta model to Plays. The Playbook mixes authoring, design-homework boundaries, dispatch behavior,
and proof that play deltas work.

**Loop-amenable atoms?** Some narrow loader or dispatch implementation atoms could use
`pnpm --filter @cocoder/personas test` or `pnpm --filter @cocoder/core test`. The persona/Play authoring
itself needs quality judgment, so the priority is not broadly loop-amenable.

**Recommendation:** no retrofit for the priority as a whole: use loop packets only after a concrete
loader/dispatch test target exists; keep persona and Play content authoring one-shot gated.

**Pilot fitness:** Not the best pilot; too much of the remaining work is authoring and design judgment.

### `run-resolution-and-loop-reliability`

**Remaining work shape:** The Playbook says phases were executed in the founder-directed session of
2026-06-09, but it has no explicit final status section. Status is unclear from Playbook. The phase list
covers run-resolution operations, directive-0 prompt reliability, persona config truthfulness, stale
daemon self-heal, and decision-queue closeout.

**Loop-amenable atoms?** Yes for any specific red/green machinery fix inside those phases, using
existing commands such as `pnpm --filter @cocoder/core test`, `pnpm --filter @cocoder/daemon test`,
`pnpm --filter @cocoder/ui test`, `pnpm typecheck`, and `pnpm check:topology`. The Playbook itself reads
as a multi-phase reliability priority, not one remaining grind-shaped atom.

**Recommendation:** no retrofit: status unclear from Playbook and no single remaining atom is named;
retrofit only a concrete failing test repair.

**Pilot fitness:** Not a pilot candidate.

## Best Phase 4 Pilot Candidate

The single best pilot candidate is `cli-config-and-model-discovery`: retrofit the remaining Oz UI
live-CLI wiring atom as a loop packet with `pnpm --filter @cocoder/ui test` and `pnpm typecheck` as the
scripted criterion.

Why this one: the Playbook names one remaining product slice, the work is grind-shaped UI wiring, the
criterion uses existing scripts, and comparable historical UI atoms exist in the priority history for
round-trip and wall-clock comparison.

## Correction (Oscar, run_47, 2026-06-10)

The pilot recommendation above rested on a stale Playbook. The `cli-config-and-model-discovery` UI
wire-up was already built, verified, and committed in run_42 (`d76cb5a`, ui suite 40/40 green); the
Playbook's Status section had not been updated and still listed the atom as owed. The audit faithfully
reported its input — the input was wrong. The Playbook has now been corrected (disposition
`archive-candidate`; remaining = live demo only, no code owed), so `cli-config-and-model-discovery` is
**not** a valid pilot candidate.

Consequence: no audited priority currently names a ready-made loop-amenable atom. The strongest pilot
route is to carve a concrete, test-gated implementation slice from `full-oz-dashboard` (for example the
persona mode/sub-agents runner-honoring gap, gated by `pnpm --filter @cocoder/core test` /
`pnpm --filter @cocoder/daemon test`) — per this audit's own rule for that priority: declare
loop-amenability only once the slice's acceptance is an existing package test command going green.
Pilot selection is a founder decision (per-priority approval, never wholesale).
