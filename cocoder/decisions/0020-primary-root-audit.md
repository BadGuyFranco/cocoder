# ADR-0020 — The primary-root audit: bootstrap + drift, one world-class Play

**Status:** Proposed (drafted by Claude, founder session 2026-06-10 — founder review owed before any
build; this is the design deliverable the [`new-primary-root`](../priorities/new-primary-root.md)
priority requires before it becomes runnable).
**Builds on:** [0019](./0019-multi-root-workspaces.md) (primary root / workspace model),
[0012](./0012-living-base-personas.md) (living base + portability), [0018](./0018-persona-run-mode-and-sub-agents.md)
(per-Play model pinning), [0010](./0010-taxonomy-and-authoring.md) (priorities are founder-approved
Objectives), [0005](./0005-personas-and-subtasks.md) (Plays).

## Context

Pointing CoCoder at a repo it has never managed requires building that repo's `cocoder/` governance
from nothing — and everything downstream (objectives, scopes, persona extensions) inherits the
quality of that first read. The founder's bar: a **world-class audit**, run by a **top-tier model**,
**available in every workspace** without per-repo authoring, and **re-runnable** whenever a
workspace's `cocoder/` is suspected of drifting from the reality of its codebase.

## Decision (proposed)

1. **One base Play, two modes.** `primary-root-audit` ships in `packages/personas/base/plays/`
   (living base — propagates to every install, ADR-0012):
   - **Bootstrap mode** (no `cocoder/` in the primary root): deep-read the repo — architecture,
     build/test reality, domain, conventions, risks — then author the governance: `memory/`
     (codebase map, tech stack), candidate priorities as **draft stubs with draft Objectives**,
     persona deltas where the repo demands them, standards extensions. Nothing becomes *runnable*
     until the founder approves each Objective (ADR-0010's create-priority rigor — the audit
     proposes, the founder ratifies).
   - **Drift mode** (`cocoder/` exists): compare governance claims against repo reality and produce
     a **drift report** + proposed amendments/tickets. **Propose-only, structurally:** drift mode
     never rewrites governance in place — its output is a report artifact plus tickets/amendment
     drafts for review. An audit that silently rewrites governance is a machine for moving the
     founder's source of truth out from under him.
2. **The deterministic/agentic line: files are scaffolded, content is authored.** Creating the
   `cocoder/` skeleton is a deterministic copy of `templates/workspace-cocoder/` (an init operation
   the daemon/CLI owns, refusing inside the install tree per ADR-0019 §7). Everything with judgment
   in it — the reading, the mapping, the drafted Objectives — is the agentic Play. The bootstrap is
   self-continuing by construction: scaffold deterministically, then the **first run in the new
   root IS the audit** (the seeded `audit-primary-root` priority below).
3. **Model pinning rides ADR-0018.** The audit's quality bar is enforced by its **play assignment**:
   a per-(persona,Play) `{cli, model}` pinned to a top-tier model, configurable in the Personas
   screen, honored by the dispatch machinery that already exists. No new "sub-agent" concept — the
   founder's "Oz sub-agent item so we can specify the right LLM" is exactly a play assignment.
4. **Pervasive availability = shipped meta-priorities.** Today the launchable set is only
   `<primary-root>/cocoder/priorities/*.md`. This ADR authorizes the small generalization: the
   priority loader ALSO offers **install-shipped meta-priorities** (an `audit-primary-root` stub
   shipped with the base, available in every workspace, never copied into the repo). The same
   mechanism later serves other pervasive priorities (`adhoc-session` is the existing in-repo
   precursor). One home: shipped stubs live with the base; a workspace's own priorities stay the
   repo's.
5. **Write scope: the target's `cocoder/**` only.** In bootstrap mode the Play may author governance
   in the primary root; it never touches product code, never the engine install, and in drift mode
   it writes only its report + tickets. The commit gate enforces this like any other scope.
6. **Vocabulary (settles the priority's Q1).** No new term: a **workspace** is the multi-root set
   defined by its `.code-workspace` file (ADR-0019); the **primary root** is the one root whose
   `cocoder/` carries the workspace's governance. The audit targets a primary root; the phrase
   "new primary root" means "a primary root without a `cocoder/` yet."
7. **Ultra Code review stays founder-triggered (settles Q3, default).** The Play does not invoke
   billed externally-triggered review surfaces on its own; its pinned top-tier model is the quality
   mechanism. If the founder wants Ultra in the loop for a given bootstrap, he runs it himself on
   the audit's output — revisit only if that proves routine.

## Risks (named for the founder)

- **Bootstrap quality is the whole ballgame.** A shallow audit writes confident-but-wrong Objectives
  that every later run inherits. Mitigations: top-tier pinned model; founder approval gate on every
  generated Objective (real, not rubber-stamp); the adversarial-review pattern on the Play's prompt
  before first live use on a repo that matters.
- **Drift mode must never be a rewrite engine** — hence propose-only is structural (decision #1),
  not a prompt suggestion.
- **Cost:** a world-class audit on a large repo is expensive by design; it is founder-launched, not
  scheduled.

## Consequences

- `new-primary-root` becomes buildable once this ADR is accepted: atoms = the init scaffold op, the
  base Play (bootstrap + drift prompts), the shipped meta-priority + loader extension, and a live
  bootstrap proof on a real external repo (Phase 5's first step).
- The loader extension (shipped meta-priorities) is deliberately small but is new surface — it ships
  behind this ADR, not silently.
