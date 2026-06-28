# ADR-0040 — Oz write-side autonomy: conversational authoring + self-directed governance edits

**Status:** Accepted (founder + Claude, 2026-06-23)
**Seam:** the Oz control plane — how much Oz may *write* to governed flat files without per-action founder approval
**Amends:** [0016](./0016-deb-scoped-repair-fallback.md) (repair is reactive/fault-triggered and Deb-owned) ·
[0017](./0017-oz-orchestration-persona.md) (Oz's bounded tool surface was lifecycle + read only) ·
[0025](./0025-atomic-authoring-plays.md) (the atomic `author` spine; founder owns the Objective)
**Builds on:** [0010](./0010-taxonomy-and-authoring.md) / [0035](./0035-priority-creation-always-placed-or-halted.md)
(founder owns the Objective; creation is placed-or-halted), [0023](./0023-workspace-commit-spine.md) (the one
commit spine; scope is advisory and out-of-lane paths commit with flags), [0007](./0007-write-scope-enforcement.md)
(allow-list + commit-gate enforcement), the `oz-file-access` priority (the read/answer foundation this layers on).

## Context

Oz is a first-class persona with a **bounded tool surface** (ADR-0017): its verbs map to daemon
run-lifecycle ops (`launch`/`stop`/`teardown`/`status`) plus, via ADR-0025, a single atomic `author` action.
ADR-0017's doctrine — *read facts from disk, don't burn model calls; lifecycle by tool, never free rein* —
plus ADR-0016's rule that in-tree **writes** to governed machinery are **Deb's reactive, fault-triggered
repair authority**, together mean Oz today cannot make even a trivial, reversible governance edit on its own.
Every reorder, ticket close, or one-line doc fix the founder wants Oz to "just do" requires either a
hand-edit or a full adhoc run.

That is the wrong cost curve for **reversible** edits to **existing** governance. The founder's mental model
is an autonomous control-plane agent: tell Oz "reorder these two priorities" or "close ticket 0040" or "fix
that stale path in the doc" and have it land — while the **irreversible, high-stakes** acts (a net-new
priority Objective, product code, secrets, lifecycle) stay gated. ADR-0016/0017/0025 each drew their line
before that distinction existed; this ADR draws the reversible-vs-irreversible line explicitly and opens a
narrow self-direct write lane on the reversible side.

The companion read/answer foundation is `oz-file-access` (Oz reads governed flat files to answer questions);
this ADR is the **write** half and layers on it.

## Decision

**Oz gains a bounded self-direct write capability over reversible edits to existing governed flat files,
committed by the daemon as a gate-scoped `oz-action` commit. Irreversible and high-stakes acts stay
founder-gated. Conversational authoring drafts a new priority with the founder and commits it through the
existing `author` spine only on the founder's explicit go-ahead — the Objective gate (ADR-0010) is untouched.**

### 1. The self-direct write scope (reversible edits to *existing* governance, no per-action approval)

Oz may, on its own judgment within a conversation, write these and only these paths:

- **Reorder priorities** — `cocoder/priorities/order.json`.
- **Open/close tickets** — `cocoder/tickets/**`.
- **Narrow documentation fixes** — `docs/**` and governed `*.md` doc surfaces (a stale path, a broken link, a
  corrected fact) — narrow, not a rewrite.
- **Edits to an *existing* priority that do not change its founder-approved Objective** — clarifying body,
  follow-up notes, boundary wording; **never** the `## Objective` of a priority.

These are reversible: a reorder, a ticket state flip, a doc-line fix, and non-Objective priority edits are all
trivially revertable and carry no product-behavior or security risk.

### 2. The gate-commit lane: `oz-action`

A self-direct edit is committed by the daemon through the **one commit spine** (ADR-0023), gate-enforced
against the scope in §1: the whole changed set lands, and any path outside §1 is **flagged and surfaced**
as `outOfLanePaths`, never silently dropped. The commit is attributed and labelled `oz-action` so it is distinct in history from
`deb-repair` (ADR-0016), `governance: <playId>` authoring (ADR-0025), and the founder/agent build commits.
No second commit lane is created — `oz-action` is a new **label and scope** over the existing spine.

### 3. Conversational authoring (founder still owns the Objective — ADR-0010/0025 preserved)

Oz may **draft** a new priority's id/title/Objective *with* the founder in chat and, on the founder's
explicit go-ahead, commit it through the existing atomic `author` spine (ADR-0025) — **no adhoc run
launched**. The founder-approval boundary is **carried forward unchanged**: the `author` Play still refuses
to fabricate an Objective; a net-new priority Objective lands only when the founder-approved id/title/Objective
arrives in the invocation. Self-direct mode (§1) explicitly **excludes** net-new Objectives — they route
through this founder-approved authoring path, never the no-approval `oz-action` lane.

### 4. Hard exclusions (forbidden in self-direct mode, enforced in code)

Even in self-direct mode Oz **cannot** write:

- **Product / target code** — `packages/*/src/` and any target-repo product tree.
- **Secrets** and **install-local state** (run records, event streams, machine-local coordination).
- **A net-new priority Objective** without the founder-approval field present (routes through §3).
- **Process / window / daemon lifecycle** — unchanged; F20 and the teardown rules hold. This ADR does **not**
  change teardown or stop semantics.

The scope guard is **code-level and test-proven**, not prompt-only: an Oz self-direct write outside §1 is
rejected by the gate before it can land, and a net-new Objective without the founder-approval field is
refused by the `author` validator (ADR-0025 §4).

### 5. Relationship to Deb repair (ADR-0016) — two distinct lanes, one spine

This does **not** fold into or replace Deb's repair authority. Deb repair stays **reactive** (fault-triggered
or the Oscar↔Deb dialogue, ADR-0036) and broad within her scope. Oz self-direct is **proactive and narrow**
(the §1 reversible set), founder-conversation-initiated, committed as `oz-action`. Both ride the **same**
ADR-0023 spine and gate; neither rescues a failed run.

## How this amends the three ADRs

- **ADR-0016** said in-tree writes to governed machinery are Deb's reactive repair authority. Carried forward:
  Deb repair is unchanged. **Added:** a second, narrower, proactive write lane owned by Oz (`oz-action`, §1/§2)
  for reversible edits to existing governance — distinct from repair, on the same spine.
- **ADR-0017** bounded Oz to lifecycle ops + read-from-disk ("don't burn model calls"). Carried forward: read
  doctrine and lifecycle bounding are unchanged. **Added:** the tool surface now includes the §1 self-direct
  write actions and the §3 conversational-author action — still a fixed, gated vocabulary, not free rein.
- **ADR-0025** built the atomic `author` spine and fixed that authoring cannot fabricate the founder-approved
  id/title/Objective. Carried forward **unchanged and reaffirmed**: §3 reuses that spine and that founder-gate.
  **Added:** Oz may now reach the `author` action *conversationally* (draft-with-founder-then-commit), and §1
  adds the no-approval reversible-edit lane *outside* authoring.

On founder approval of this ADR, the superseded clauses in ADR-0016/0017/0025 receive carry-forward amendment
pointers to ADR-0040 (one-owner / current-truth, per ADR-0014), and this ADR is added to the decisions index.

## Consequences

- Oz becomes a genuinely autonomous control-plane agent on the **reversible** governance surface, while the
  irreversible/high-stakes line (Objectives, product code, secrets, lifecycle) stays founder-gated — the cost
  curve now matches the risk.
- One auditable commit lane (`oz-action`) makes every self-direct edit reviewable and revertable; the gate's
  hold-back-and-surface behavior means an out-of-scope path can never leak in silently.
- No new commit path, no new orchestration loop: the lane is a label + scope over the existing spine, and the
  founder-Objective gate is preserved verbatim.

## Out of scope for this ADR (deferred to the build)

The concrete wiring — the daemon `oz-action` tool/handler, the scope-guard predicate and its test, the
conversational-author tool round, and the carry-forward pointer edits to 0016/0017/0025 — is **mechanism**,
decided in the build atoms with an owner-map-first atom. No build atom lands before this ADR is founder-approved.
