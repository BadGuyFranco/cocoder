# ADR-0004 — Process architecture: core library, optional daemon, CLI-standalone (seam S4)

**Status:** Accepted (founder + Claude, 2026-05-28)
**Seam:** S4 — Oz ↔ runner boundary
**Charter:** [0001](./0001-rebuild-charter.md) · **Builds on:** [0002](./0002-substrate-oz-and-cmux.md), [0003](./0003-data-model-hybrid.md) · **Refines:** ADR-0003 "sole writer" → "single-writer-at-a-time" · **Touches seams:** S3 (topology)
**Refined by:** [0013](./0013-orchestration-observation.md) — the runner's one-shot composition becomes an Oscar-orchestrated **multi-atom loop** with continuous observation and an Oscar-decided wrap-up.

## Context

S1 made Oz the owner of the cmux connection; S2 made Oz the writer of the operational DB. Both
point to one clean layering. The open question was whether a running Oz is *mandatory* or
whether the CLI can run a task headless with no daemon.

## Decision

### Layering (hexagonal — dependency points inward)

```
  core  (I/O-agnostic library)          runner logic · launch composition ·
    ▲      pure, unit-testable           data-model schema · SessionHost port
    │
  Oz daemon  (always-on owner, interactive use)  owns: DB write-conn · cmux driver · live runs
    ▲
    │  local contract (socket/IPC)
  clients:  dashboard UI   ·   `cocoder` CLI
```

`core` makes no I/O assumptions and is the only thing the daemon, UI, and CLI depend on.
Swapping the daemon, the UI, or a SessionHost driver never touches `core`. This preserves the
one thing v1 got right (testable pure logic) and keeps every other layer replaceable (D1).

### CLI-standalone (the resolved question)

`cocoder run <priority>` works **with no daemon running**. `core` is runnable headless, so
runs can be driven from a script, from CI, or from our own dogfood loop (e.g. building v2 via
Claude Code) without a GUI. In interactive use, the Oz daemon is the always-on owner; the CLI
and UI are its clients.

### DB write coordination (refines ADR-0003)

ADR-0003's "Oz is the sole writer" is refined to **single-writer-at-a-time**, enforced by
SQLite's file lock (WAL: many readers, one writer):

- If the **daemon is running**, it holds the writer role; the CLI routes writes through it
  (client mode).
- If **no daemon is running**, the CLI acquires the SQLite write-lock directly for the duration
  of the run (standalone mode).
- Two writers never coexist; SQLite serializes. The ownership rule (who writes) is explicit, not
  emergent — the CLI checks for a live daemon before choosing client vs standalone mode.

## Consequences

- **Testable core, headless runs, CI-friendly** — and the dogfood loop can drive v2 runs before
  any UI exists.
- **The write-lock seam needs care:** the daemon-vs-standalone choice must be deterministic
  (probe for a live daemon first). This is the one added bit of complexity we accept for
  flexibility.
- **Maps directly onto S3 topology:** `core` / `daemon` / `cli` / `ui` become the top-level
  package boundaries. S3 can now be decided concretely.
- The local contract between clients and daemon (socket/IPC shape) is an implementation detail,
  not a seam — deferred to Phase 1 (D1).
