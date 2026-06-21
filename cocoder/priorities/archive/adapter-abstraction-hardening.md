---
id: adapter-abstraction-hardening
title: "Harden and reduce duplication in the CLI adapter layer (ADR-0006)"
---

> **Archived 2026-06-21 (founder) — superseded by [[model-layer]].** A grounded code map found this draft's
> core premise **overstated**: the three adapters' `build`/`preflight`/`listModels` bodies are mostly
> *genuinely different* per CLI (flags, completion strategy, auth parsing); the real shared surface is ~a
> class skeleton + a `--version` check. A shared base class at N=3 would **add** surface, not remove it —
> premature-DRY, against the subtraction thesis. The one genuinely-needed piece — **richer model
> capability/tier metadata in the adapter contract** — is absorbed into `model-layer` (Phase 0), with the
> small honest cleanup (a shared `installedCheck` helper) demoted to its optional Phase 4. The speculative
> de-duplication refactor is **dropped**.

> **Drafted by Grok** — This priority was initially constructed by Grok (Grok Build AI coding harness) during a structured codebase review. It requires further review, validation, refinement, and explicit ownership by the founder / Oscar as the **first step** before any scoping or implementation work.

## Objective
The three current adapters (`claude`, `codex`, `cursor-agent`) contain significant duplicated logic for building commands, preflight checks, model listing, and headless vs interactive handling. Make the `Adapter` contract + shared code in `@cocoder/adapters` robust enough that:
- Adding a new backend is mostly declarative + one focused implementation file.
- Differences in headless completion (stdoutPath, `--output-last-message`, pure stdout) and "trust-the-CLI" bypass flags are expressed cleanly rather than repeated magic strings.
- Preflight and auth detection have less per-CLI special casing and better error messages.
- Model capability metadata (enumeration, strength hints, headless support) is richer and used consistently by the runner, UI, and playbook dispatch.
- All existing behavior (including the recent headless lane work) is preserved with no regressions for the three current adapters.

**Verified when:**
- `packages/adapters/` has clear shared helpers (or a small base class) that the three implementations delegate to for common concerns.
- A new hypothetical fourth adapter can be added with substantially less code than the current three.
- Preflight failures give actionable messages for all three CLIs in both interactive and headless contexts.
- The adapter tests + `scripts/proof-headless-lane.mjs` (and any new proofs) remain green.
- The UI (CLIs screen, Personas model pickers) continues to receive accurate `canEnumerate` / models lists without per-adapter special cases leaking into `app/adapter.ts` or model.ts.
- No behavior change for Oscar (visible TUI), Bob, verification plays, or Oz launches.

**Boundaries:** This priority is about the adapter *abstraction and implementation hygiene*, not about changing which CLIs are supported, the prompt contracts, write scope, or the commit spine. Completion model (artifact vs exit code) can be improved as part of this but must not break current runners.

## Context & Evidence
- ADR-0006 established the Adapter contract and "trust-the-CLI" posture (each adapter declares its dangerous bypass flags because CoCoder's own fences are the real boundary).
- `packages/adapters/src/{claude.ts, codex.ts, cursor-agent.ts}` each implement the full `Adapter` interface with very similar structure but different argument lists and output strategies.
- `build()` in each has a `if (input.headless)` branch with CLI-specific flags and output handling.
- `preflight()` has custom parsing for auth status on each CLI (some use stdout, some stderr, one repurposes `--list-models`).
- `listModels()` is entirely hand-curated per adapter.
- `packages/adapters/src/exec.ts` is already injectable and minimal — good seam.
- Recent work (headless-adapter-lane priority) had to touch multiple adapters and the dispatch path to flip `headlessCapable` and wire output paths.
- Cursor-agent is "headless first"; Claude and Codex support both lanes with different mechanisms. This diversity should be expressed once.

## Suggested Next Action
Audit the three adapters for duplication, extract shared command-building and output-handling helpers, improve the `RunReadinessProfile` or add a small `CompletionStrategy` concept if helpful, strengthen preflight with clearer categories, and add adapter-level unit tests that do not require the real binaries. Prove by re-running existing headless and interactive proofs plus adding one new adapter skeleton test.