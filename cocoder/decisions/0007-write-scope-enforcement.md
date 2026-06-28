# ADR-0007 — Write-scope: allow-list + commit-gate enforcement (seam S7)

**Status:** Accepted (founder + Claude, 2026-05-28). **Reconciled into [ADR-0023](./0023-workspace-commit-spine.md) (2026-06-14):** the allow-list + gate-the-commit primitive below *is* the one commit spine's scope step — unchanged in spirit, relocated to a single shared service. The 2026-06-13 reconciliation note (founder-directed Surface-A edits in-scope by default; hold-back bar = breakage-risk) carries forward.
**Seam:** S7 — write-scope & enforcement boundary
**Charter:** [0001](./0001-rebuild-charter.md) · **Builds on:** [0006](./0006-adapter-contract.md) (trust-the-CLI), [0003](./0003-data-model-hybrid.md) (commit linkage), [0005](./0005-personas-and-subtasks.md) · **Touches seams:** S3 (topology)

## Context

Trust-the-CLI (S6) means no OS confinement — the agent process *can* physically write anywhere.
v1's priority-boundaries were heavy and fragmented (F4); F11 showed a bypassable gate pretending
to be a guarantee. We need the deterministic agent→reality boundary (charter D3) without an OS
sandbox.

> **Reconciliation note (2026-06-13, [ADR-0022](../zArchive/v2/decisions/0022-orchestration-change-durability.md)).** The
> commit gate below stays — it is the deterministic agent→reality boundary, not a restriction to
> remove. Two clarifications from the broad-by-default principle (ADR-0022 §1, §6): (1) a
> **founder-directed Surface-A edit** (governance, orchestration, docs, machinery-blocker fix) is
> **in-scope by default** — personas do not refuse or defer it as "read-only / needs a new run"; (2)
> the bar for holding a change back is **high risk of breaking something**, not merely "outside a
> narrow preset scope." Out-of-scope-but-low-risk changes still surface for an expand decision (never
> silent-discard, never silent-commit). Nothing in this ADR may be read to license refusing a
> founder-directed governance edit.
>
> **Later reconciliation note ([ADR-0023](./0023-workspace-commit-spine.md) Amendment 1, founder directive
> 2026-06-15).** The path-scope expand-decision sentence above was superseded two days later: out-of-lane
> is now an advisory visibility flag, and the spine commits the whole changed set. The high-breakage-risk
> judgment bar still carries forward as a separate escalation axis.

## Decision

### Scope expression
- **Allow-list globs, default-deny.** Attached as a **per-persona default** (`builder` →
  `packages/**`), optionally **narrowed per priority** (a priority references and narrows the
  persona default — never restates it, so no F4 fragmentation).
- **Plays also carry default scopes** (per the S5 registry): e.g. `code-review` is
  **read-only**; `documentation` writes only doc paths. This is why the Play registry is a
  known set — scope is one of the things the deterministic layer reads from it.

### Enforcement — gate the commit, not the write
Because we don't confine the process (S6), we don't try to prevent the write. CoCoder owns the
commit step, so the **commit is the boundary**:

- **Pre-run (probabilistic steer):** the allowed scope is injected into the agent's prompt
  ("only modify X").
- **Post-run (deterministic guarantee, D3):** before committing, CoCoder computes the changed-
  file set from git and matches it against the allowed scope. **The working tree is
  unconstrained; only the commit is gated.**

### Out-of-scope handling — block-the-commit-but-surface-for-approval
> **Superseded behavior ([ADR-0023](./0023-workspace-commit-spine.md) Amendment 1, founder directive
> 2026-06-15).** This section records the original block-the-commit rule. Current truth: scope is
> advisory, so the spine commits the whole changed set and flags out-of-lane paths for visibility; it
> never parks them for a path-scope decision.

Out-of-scope changes are **detected deterministically, held back from the commit, and surfaced**
for an **expand-or-discard** decision (orchestrator or founder). In-scope changes commit; out-of-
scope changes stay in the working tree pending the decision. **Never silent auto-discard** — the
agent may have made a legitimate out-of-scope change, and destroying it hides signal.

### Honest boundary (the F11 lesson)
Scope is enforced **for commits CoCoder makes**. CoCoder does **not** police out-of-band manual
`git commit`s. This is stated plainly — no pretending a bypassable gate is a hard guarantee.

## Homes (D4)

- Persona default scope → persona definition (governance). Priority narrowing → the priority
  (governance). Play default scope → the Play registry (governance).
- Enforcement logic → `core` (the commit gate), shared by daemon and CLI.
- The commit gate is also where **run↔commit linkage** is recorded (ADR-0003, fixes F6).

## Consequences

- This is the canonical D3 deterministic boundary check, and it's cheap (git diff + glob match).
- "Surface for approval" needs a UI affordance (Oz) and a CLI prompt (standalone mode) —
  implementation, not a seam (D1).
- With S7 settled, the remaining seams are **S3** (topology — now highly derivable; all
  components are known) and **S8** (persona/Play extensibility).
