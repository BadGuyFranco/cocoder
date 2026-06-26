# ADR-0043 — Runnerless execution is Shape A: standalone daemon-free `runRun`, not a separate agentic orchestrator

**Status:** Accepted (founder + Oscar, 2026-06-26, run 105). Records that the `independent-of-runner` execution path **reuses the proven runner loop run standalone outside the daemon**, and **rejects** a from-scratch Oscar-driven agentic orchestrator.
**Seam:** how an `independent-of-runner` priority actually executes (scope items 3–5 of the `runnerless-independent-priority`).
**Builds on:** [0023](./0023-workspace-commit-spine.md) (direct-to-branch commit spine — runs commit to the active branch via direct git) · [0042](./0042-run-concurrency-model.md) (the daemon is scheduling + glue; `runRun` is pure in-process orchestration).

## Context

The priority's original wording asked for execution **"without the deterministic runner loop or daemon-driven atom commits."** Read literally, that implies a new orchestrator where Oscar's model drives Bob sub-agents directly (call it **Shape B**), discarding `runRun`.

An architecture read (run 105) found this framing rested on a false premise — that the runner loop and the daemon-reload danger are inseparable. They are not:

- **`runRun` is already fully decoupled from the daemon.** It runs in-process on live git with injected adapters (store, sessionHost, git, getAdapter, io) and has **zero HTTP / daemon / store-socket coupling**. A standalone CLI path already exists.
- **`runRun` does not replace Oscar's judgment.** Inside it, Oscar is spawned as a real agent that writes directives and Bob is a real agent that builds; the "deterministic loop" is the **file-based handoff protocol** (directive → build → verify → commit-gate) — i.e. the **safety rails** (per-atom verify gate, scope quarantine on fail, out-of-scope hold-back, commit receipts, fault context). Removing it is a *downgrade* in rigor, not an increase in Oscar's agency.
- **A standalone process runs frozen code.** It executes the code it was launched with for its whole lifetime — it does **not** hot-reload the way the daemon does (`drainDaemonReload` / `isDaemonRuntimePath` are daemon-only). So a broken/destructive change in the working tree is **not** exercised by the process building it.

The real threat the escape hatch must neutralize is therefore the **daemon** (auto-reload onto new code mid-run; daemon-driven scheduling/commits) and **destructive ops against live state** (a store GC/migration deleting the run's own state) — **not** `runRun`'s logic.

## Decision

**Runnerless execution is Shape A:** a standalone CLI entrypoint (e.g. `cocoder run-independent <priorityId>`) that invokes the existing `runRun` **in direct mode, outside the daemon** — no daemon launch, no daemon-driven scheduling or commits, frozen installed code, commits via direct git. It reuses the proven verify/quarantine/receipt rails. For `destructive`-flagged priorities it adds **target isolation** (run against a scratch store copy) so the change cannot corrupt the run's own state.

**Shape B (a from-scratch agentic orchestrator that discards `runRun`) is rejected.** Its only marginal benefit — executing code that is *not* the under-change code — is already provided by frozen standalone execution, and it would trade the best-tested orchestration we have for an unproven non-deterministic loop.

The priority's `Objective`/`Scope`/`Acceptance` are revised to this shape; the "without the deterministic runner loop" clause is superseded by "without the **daemon** machinery (auto-reload, scheduling, daemon commit spine), running frozen code, with destructive-target isolation."

## Consequences

- **Build is small and low-risk:** a thin standalone entrypoint (~200 LOC) reusing `runStandalone` scaffolding + `runRun`, plus destructive-target store isolation. No new orchestration engine to maintain.
- **Safety rails preserved:** the per-atom verify gate, quarantine, out-of-scope hold-back, and commit receipts all remain — runnerless runs are as trustworthy as normal runs.
- **Escape-hatch guarantee:** no daemon means no mid-run auto-reload; frozen code means the under-change machinery is not self-exercised; destructive isolation means a GC/migration cannot eat the live run's state. Works with the daemon down/inert.
- **Open design point for the build:** the exact destructive-target isolation mechanism (scratch store copy vs. sandboxed home) is to be designed in the build run; it is the one genuinely new piece beyond wiring `runRun` standalone.
- **Reversal-gated:** revisiting Shape B (or weakening the destructive-isolation requirement) requires a new founder-approved ADR superseding this one.
