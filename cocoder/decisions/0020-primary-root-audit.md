# ADR-0020 — Onboarding Playbooks: bootstrap, takeover, and drift as shipped baked-plan Playbooks

> **⚠ AMENDED by [ADR-0026](./0026-onboard-existing-as-oscar-priority.md) (Accepted 2026-06-17) — read
> 0026 for the current model.** Two changes: **(1) Rename** — the "**Takeover**" situation is now
> **"Onboard (existing repo)"** (the word wrongly implied seizing the founder's existing build process;
> the act is review-and-propose only). Read every "takeover" in this ADR's body as "onboard existing
> repo" (the full term-purge across docs + code happens in the `new-primary-root` rebuild). **(2)
> Execution model** — the standalone **phase-executor** (the
> [addendum](./0020-addendum-phase-executor.md)) is **superseded**: the existing-repo audit runs as an
> **Oscar-driven priority**, not a runner-mode (the executor reached its founder gates but had no
> founder-facing interaction surface, so a real audit would freeze). **0020's product structure STANDS**
> — three onboarding situations, deep multi-agent audit, founder ratifies every Objective, propose-only
> drift, and the `cocoder/**`-only trust boundary are all unchanged. Only the *driver* and the *term*
> changed.

**Status:** **Accepted (founder, 2026-06-14)** — product structure current; **execution model amended by
[0026](./0026-onboard-existing-as-oscar-priority.md)** (2026-06-17, see banner). Co-designed with the founder (this redraft supersedes the
2026-06-10 draft; the founder set the high-quality bar, the three-template split, and the mid-process
checkpoints) and accepted to proceed with the [`new-primary-root`](../priorities/new-primary-root.md)
build. The three skeletons under `packages/personas/base/playbooks/` remain inert until that build wires
the loader extension (§7).
**Builds on:** [0019](./0019-multi-root-workspaces.md) (primary root / workspace model),
[0012](./0012-living-base-personas.md) (living base + portability), [0018](./0018-persona-run-mode-and-sub-agents.md)
(per-Play model pinning + sub-agents), [0005](./0005-personas-and-subtasks.md) (Plays),
[0023](./0023-workspace-commit-spine.md) (governance authoring commits via the spine).
**Extends:** [0010](./0010-taxonomy-and-authoring.md) — adds a narrow second category of Playbook whose
plan is *baked*, not improvised (see Decision 1).

## Context

Pointing CoCoder at a repo it has never managed — or re-checking one it already manages — is a
**repeatable, high-stakes process**, and everything downstream (objectives, scopes, persona
extensions) inherits the quality of that first read. The founder's bar, set explicitly: **never one
cheap pass.** A real code review + audit to migrate an existing repo into a CoCoder-style build is a
**big lift** — multi-pass, cross-checked, expensive by design.

That bar rules out the original "one Play, deep-read the repo" design: a single agent invocation, one
context window, one pass, produces plausible-but-shallow governance on any non-trivial repo. It also
sits in tension with [ADR-0010](./0010-taxonomy-and-authoring.md), which says a priority is a stub and
its **plan lives in the run, improvised by the orchestrator** — fine for a one-off founder goal, wrong
for a repeatable process where improvisation is the enemy of quality.

## Decision (proposed)

### 1. Onboarding is a shipped, baked-plan **Playbook** — a deliberate, narrow exception to ADR-0010

A new artifact: an **onboarding Playbook** is a **multi-phase plan that is authored once, adversarially
reviewed once, shipped with the living base (`packages/personas/base/playbooks/`, propagates to every
install — ADR-0012), and run many times.** Unlike a one-off priority (ADR-0010: improvised plan, stub
file), an onboarding Playbook's plan is **baked into the file** on purpose — because the process is
repeatable and the cost of improvising it badly is high. It is distinct from a **Play** (a single
delegatable task, ADR-0005): a Playbook **orchestrates** Plays + atoms across phases.

This is the *only* sanctioned baked-plan category; ADR-0010's improvise-in-the-run rule still governs
all ordinary priorities. (ADR-0010 gets a one-line reconciliation pointer here.)

### 2. Three templates, one per onboarding type

| Template | Trigger | Shape |
|---|---|---|
| **New Primary** | a fresh/empty primary root (little-to-no code) | scaffold → founder-intake conversation → *minimal* starter governance → ratify → first run. Light. |
| **CoCoder Takeover** | an existing repo with code | the big lift — multi-agent, founder-checkpointed deep audit → drafted governance → ratify (Decision 4). |
| **Drift Audit** | an already-managed `cocoder/` root | propose-only: compare governance vs repo reality → drift report + amendment/ticket drafts → founder ratifies → apply (Decision 5). |

The skeletons ship at `packages/personas/base/playbooks/{new-primary,cocoder-takeover,drift-audit}.md`.

### 3. The deterministic/agentic line — files are scaffolded, content is authored

Creating the `cocoder/` skeleton is a deterministic copy of `templates/workspace-cocoder/` (an init
op the daemon/CLI owns, refusing inside the install tree — ADR-0019 §7). Everything with judgment in it
— the reading, the mapping, the drafted Objectives — is agentic, run by the Playbook's phases. New
Primary and Takeover scaffold first; Drift never scaffolds (the zone already exists).

### 4. CoCoder Takeover is multi-agent and founder-checkpointed (the quality mechanism)

The big lift is structured, not a single pass:
- **P0 Scaffold** — create-only `cocoder/` skeleton, non-destructive.
- **P1 Recon** — map the repo (languages, packages/modules, build/test commands, entry points, dep
  graph, size) into a structured inventory. **▸ Founder checkpoint:** approve the map before spending on
  the deep read.
- **P2 Parallel deep read** — fan out top-tier-pinned sub-agents **per subsystem** (ADR-0018 sub-agents
  = play assignments), each emitting structured findings (architecture, conventions, domain, risks,
  tech debt). This is the multi-pass mechanism — not one context window.
- **P3 Adversarial cross-check** — a reviewer pass over the findings (gaps, disagreements, hallucinated
  structure); optional founder-triggered Ultra review (Decision 10).
- **P4 Synthesize** — from *verified* findings, draft `memory/` (codebase map, tech stack), architecture
  notes, candidate priorities with draft Objectives, persona deltas, standards extensions.
- **P5 Ratify** — the founder approves/edits **each** Objective (ADR-0010 create-priority rigor — a hard
  gate; nothing is runnable until ratified). **▸ Founder checkpoint.**
- **P6 Prove** — a first ordinary run executes against a ratified priority.

The two checkpoints (P1, P5) protect both the wallet (don't deep-read a map you'd reject) and the truth
(don't author governance from unratified findings).

### 5. Drift is propose-only — structurally — with a defined consumption path

Drift mode **never rewrites governance in place.** Its phases: read governance claims → read repo
reality → compare → emit a **drift report + amendment/ticket drafts** (artifacts only). The founder
reviews the report and **ratifies which amendments to apply**; only then does an **apply step** land the
ratified changes (through the commit spine, Decision 8). The propose→ratify→apply split is the structure,
not a prompt suggestion — an audit that silently rewrites governance is a machine for moving the
founder's source of truth out from under them. (Dogfood note: the 2026-06-14 ADR-reset + priority-audit
this session was a Drift Audit run by hand — its first proof of the right phases.)

### 6. Model pinning rides ADR-0018

The quality bar is enforced by **play assignment**: the deep-read / cross-check phases pin a top-tier
`{cli, model}`, shipped as a sensible base default (a brand-new root has no `cocoder/` to read a pin
from yet) and founder-overridable in the Personas screen after bootstrap. No new "sub-agent" concept.

### 7. Pervasive availability = shipped meta-Playbooks (the earned loader extension)

The priority loader is extended to ALSO offer **install-shipped onboarding Playbooks** from
`packages/personas/base/playbooks/`, available in every workspace, never copied into the repo. This is
**earned by Drift Audit**, which must be launchable *inside* an already-managed workspace (New
Primary/Takeover run as the first run in a new root, seeded at scaffold). One home: shipped Playbooks
live with the base; a workspace's own priorities stay the repo's.

### 8. Write-scope: the target's `cocoder/**` only

A Playbook authors only the target primary root's `cocoder/**` — never product code, never the engine
install. Drift's audit phase writes only its report + tickets; its apply phase writes ratified
`cocoder/**`. All commits go through the one commit spine (ADR-0023), direct to the target's active
branch by default — no worktree needed for governance authoring. The commit gate enforces the scope.

### 9. Vocabulary (settles the priority's Q1)

No new term: a **workspace** is the multi-root set defined by its `.code-workspace` file (ADR-0019); the
**primary root** is the one root whose `cocoder/` carries the workspace's governance. "New primary root"
means "a primary root without a `cocoder/` yet."

### 10. Ultra Code review stays founder-triggered

A Playbook does not invoke billed external review surfaces on its own; its pinned top-tier model + the
P3 cross-check are the quality mechanism. The founder may run Ultra on a Takeover's output for a repo
that matters; revisit only if that proves routine.

## Risks (named for the founder)

- **Takeover quality is the whole ballgame.** Mitigations: the multi-pass P2/P3 structure, top-tier
  pins, the P1/P5 founder checkpoints, and the hard ratification gate — quality is mechanism here, not
  just a good prompt.
- **Drift must never be a rewrite engine** — hence propose→ratify→apply is structural (Decision 5).
- **Cost:** a world-class Takeover on a large repo is expensive by design (multi-agent, top-tier). It is
  founder-launched, never scheduled, and the P1 checkpoint caps spend on a map you'd reject.
- **Baked plans can rot** — a shipped Playbook is code-like and must be versioned + adversarially
  reviewed before first use on a repo that matters, and re-reviewed when the persona/Play set changes.

## Consequences

- `new-primary-root` (which absorbed `workspace-onboarding`, 2026-06-14) becomes buildable once this ADR
  is accepted. Build atoms: the three Playbook plans wired as shipped meta-Playbooks; a `deep-read` /
  audit Play (the P2 unit); the loader extension (Decision 7); the scaffold init op; and a **live
  Takeover proof on a real external repo** (Phase 5's first step — CoPublisher is the intended target).
- The loader extension is deliberately small but is new install surface — it ships behind this ADR.
- The three skeletons under `packages/personas/base/playbooks/` are **drafted for review now, built when
  this ADR is accepted** — they are inert until the loader reads that directory.
