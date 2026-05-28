# ADR-0009 — Extensibility: extend by files; new CLIs need a driver (seam S8)

**Status:** Accepted (founder + Claude, 2026-05-28)
**Seam:** S8 — persona / sub-task / domain extensibility
**Charter:** [0001](./0001-rebuild-charter.md) · **Builds on:** [0005](./0005-personas-and-subtasks.md), [0006](./0006-adapter-contract.md), [0008](./0008-repository-topology.md)

## Context

The eventual vision includes adopters extending CoCoder (custom personas, domain "primitives")
without forking core. ADR-0008 already made personas, sub-tasks, and scopes flat governance
files, which largely answers this.

## Decision

### Extend by adding governance files (no core fork)
- **Custom personas** → a `.md` (+ optional scripts) in `cocoder/personas/`. v1's "Phil"
  primitive-builder pattern is simply an example custom persona file.
- **Custom sub-task types** → a registry entry (default prompt + default scope) in the
  governance zone.
- **Custom scopes** → in the persona file / priority.
- Defaults ship in `templates/` (copied on `cocoder init`); adopters **override or add** in their
  own workspace governance zone. Nothing requires touching `packages/`.

### The one exception — new CLIs
A brand-new model CLI needs an **adapter driver (code in `packages/adapters/`)**, because data-
driven adapter declarations were deferred in ADR-0006 (unearned). For MVP this is a contributor-
level action, not a drop-in file; the built-in CLIs cover the common case. Data-driven adapters
become an earned feature later if demand appears.

## Consequences

- Extensibility is mostly "drop a file" — matches the vision without building a plugin engine we
  haven't earned (D1).
- Custom-CLI-as-data is explicitly a future earned feature, not MVP.
- **This closes the seam list. The Phase-0 architecture Q&A is complete** — the v2 foundation is
  decided across ADRs 0001–0009.
