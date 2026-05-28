# ADR-0006 — Adapter contract: trust-the-CLI + capability probe (seam S6)

**Status:** Accepted (founder + Claude, 2026-05-28)
**Seam:** S6 — adapter / sandbox contract
**Charter:** [0001](./0001-rebuild-charter.md) · **Builds on:** [0004](./0004-process-architecture.md), [0005](./0005-personas-and-subtasks.md) · **Touches seams:** S7 (write-scope enforcement)

## Context

Path B runs the founder's **own, locally-trusted, pre-authenticated CLIs**. F10 showed that a
restrictive OS sandbox (Codex `workspace-write`) breaks a CLI cryptically *mid-run*
(`SecItemCopyMatching -50`, blocked Keychain). This seam: how a CLI plugs in, and how its auth +
permissions are verified — without CoCoder managing fragile OS sandboxes.

## Decision

### 1. Adapter = a per-CLI driver behind a common interface
Invoke headlessly, pass prompt + model, capture output, detect completion. Code implementations
per CLI for MVP (claude, codex, cursor-agent). Data-driven declarations are deferred (D1 —
unearned until we have several working).

### 2. Trust-the-CLI permission posture (no CoCoder-managed OS sandbox for MVP)
CLIs run with the founder's **normal OS permissions**. Write boundaries are enforced by
CoCoder's own **deterministic pre/post-run checks** (seam S7), not OS-level confinement.
Rationale: the restrictive sandbox is *what caused F10*, it's fragile on macOS, and it buys
little when the tools are already trusted and local. OS-level sandboxing is a future option *if*
CoCoder ever runs untrusted work — explicitly not MVP.

### 3. Preflight — the deterministic guardrail that kills the F10 class (D3)
Before launching any CLI, a per-adapter preflight checks: **installed · authenticated (valid
session) · requested model available.** Failure blocks at launch with a clear message — never a
cryptic mid-run failure.

### 4. CLI capability probe + setup assistant (founder feature)
Each adapter ships a **probe spec**: the concrete capabilities CoCoder relies on — *write a file
in cwd · read/edit files · run a shell command · reach the network · access its auth
(keychain/session) · reach the model* — plus a probe prompt. Oz surfaces a per-CLI **"Test CLI
permissions"** button that:

1. launches the CLI and runs the probe;
2. **deterministically verifies each capability from the outside** (did the test file actually
   land on disk? did the command output match? did the network call succeed?) — this is the
   source of truth, **not** the CLI's self-report;
3. for anything that actually failed, uses the CLI's **own agentic ability to interpret the
   failure and guide the founder** to enable the needed permissive / "yolo" / full-allow setting
   for that specific CLI;
4. records a **`last-verified`** result per CLI (operational state, DB) so preflight can warn
   when a CLI was never tested or its setup has gone stale.

**Two layers by design** — deterministic verification (truth) + agentic guidance (UX) — matching
the project's deterministic/probabilistic split.

**Honesty note:** the assistant deliberately helps configure *permissive* settings. Appropriate
for Path B (trusted local tools, solo builder); the UI states this plainly rather than silently
maximizing permissions, since the same tool ships to adopters.

## Consequences

- **Operationalizes trust-the-CLI:** a concrete way to verify *and* self-configure CLI setup,
  turning preflight into assisted onboarding. The probe is the human-facing complement to the
  automated preflight.
- New-CLI onboarding = a new adapter (driver + probe spec). Adapter extensibility shares the
  spirit of S8 but for CLIs, not personas.
- **Enforcement of write boundaries is now explicitly owed to S7** — that's the next seam.
- `last-verified` probe results live in operational state (DB, per ADR-0003).
