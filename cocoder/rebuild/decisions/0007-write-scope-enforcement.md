# ADR-0007 — Write-scope: allow-list + commit-gate enforcement (seam S7)

**Status:** Accepted (founder + Claude, 2026-05-28)
**Seam:** S7 — write-scope & enforcement boundary
**Charter:** [0001](./0001-rebuild-charter.md) · **Builds on:** [0006](./0006-adapter-contract.md) (trust-the-CLI), [0003](./0003-data-model-hybrid.md) (commit linkage), [0005](./0005-personas-and-subtasks.md) · **Touches seams:** S3 (topology)

## Context

Trust-the-CLI (S6) means no OS confinement — the agent process *can* physically write anywhere.
v1's priority-boundaries were heavy and fragmented (F4); F11 showed a bypassable gate pretending
to be a guarantee. We need the deterministic agent→reality boundary (charter D3) without an OS
sandbox.

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
