---
id: cli-config-and-model-discovery
title: Per-CLI required-config injection + deterministic model discovery
---

## Objective
Make each coding CLI **actually usable by CoCoder unattended** and make the persona **Model** picker
**truthful**. Two related daemon capabilities, both about the CLI ⇄ CoCoder seam (no UI invention —
these feed surfaces the Oz dashboard already renders). **Verified** when: (a) launching a run via any
registered CLI applies that CLI's required non-interactive settings without a human, and (b) the
persona Model dropdown lists only models the installed CLI actually reports. Boundary: rides the
existing `adapters` + `session-hosts` ports; per-CLI specifics live behind the adapter interface, not in
`core`.

Raised by the founder while reviewing the Oz dashboard (2026-05-30): the dashboard can *show* CLIs and a
Model dropdown, but the values are placeholders and nothing guarantees a CLI runs with the settings
CoCoder needs.

## Part A — Per-CLI required-config injection (the "YOLO" problem)

Each CLI needs specific settings to run **non-interactively under orchestration** — e.g. Codex's
auto-approve / "YOLO" mode, Claude Code's skip-permissions / bypass, Cursor-agent's equivalents — so an
agent isn't blocked on an interactive permission prompt mid-run. Today nothing ensures these are set.

Decide and build, per CLI, the injection mechanism behind the adapter:
- **Config-path injection** — write/merge the required keys into the CLI's settings file
  (e.g. Claude Code settings JSON, Codex config) before/at launch; OR
- **Launch-flag / env injection** — pass the flags/env at spawn (cleanest when the CLI supports it); OR
- **Initial-prompt preamble** — when neither is available, prepend the operating contract to the first
  message.
- Per-CLI **profile** describing which mechanism + exact keys/flags it needs; the `adapters` package owns
  the per-CLI specifics, `core` sees a uniform "ensure this CLI is run-ready" call.
- **Safety:** these modes deliberately reduce a CLI's own guardrails — they are sound only because
  CoCoder's scope/write-fence + verify-gate are the real guardrail. Record that reasoning; never widen a
  run's write-scope to compensate. Reuse the existing scope machinery; do not bypass it.
- **Idempotent + reversible** where it edits a user's config file (back up / merge, don't clobber); make
  it visible in the CLIs screen ("config managed by CoCoder").

## Part B — Deterministic model discovery

The persona **CLI → Model** dropdowns must be **pulled from the CLI itself**, not a hard-coded list, so
they can never drift from reality.
- Add a per-adapter **`listModels()`** (and the model-availability half of the existing per-CLI **Test**)
  that queries the installed CLI for the models it actually exposes; cache with a manual refresh.
- "Default" stays a first-class option (CLI's own default; empty model string).
- Surface results through the CLIs screen (Details → models) and the Personas CLI/Model dropdowns; a
  persona assigned a model the CLI no longer reports is flagged.
- A CLI that can't enumerate models degrades to "Default" + free-text, clearly marked.

## Endpoints / seams (daemon ↔ Oz dashboard)
- **`GET /clis` — served** (run_41): per CLI — install + auth, **models** (Part B), declarative
  **configManaged** / `runReadiness` (Part A); untested CLIs show placeholder detail for tested fields.
- **`POST /clis/:id/test` — served** (run_41): preflight + `listModels()`, caches into `cliTestCache`.
- **UI consumption — served** (run_42, `d76cb5a`): renderer loads live `GET /clis` on connect; CLIs
  screen Test wired to real `POST /clis/:id/test`; persona Model pickers list reported models
  Default-first, flag stale assignments, free-text for non-enumerating CLIs. ui suite 40/40 green.

## Relationship to other priorities
- Feeds [`full-oz-dashboard`](./full-oz-dashboard.md) — daemon side of its CLIs screen and persona Model
  picker; `GET /clis` + `POST /clis/:id/test` are served (run_41); UI wire-up landed run_42.
- Per-CLI run-readiness is adjacent to the run-launch path; keep it behind the `adapters`/`session-hosts`
  ports so `core` and the daemon stay CLI-agnostic.
- Sequencing decided when picked up, not here.

## Status

**Disposition: `archive-candidate`** (updated run_47, 2026-06-10 — this section previously still
showed the UI atom as owed, which misled the loop-packets retrofit audit). All code is built and
verified end-to-end; the ONLY remaining gap is a live demo (evidence, no code owed).

**Done (run_42, 1 atom — `d76cb5a`):** `packages/ui` consumes the daemon seam — renderer loads
`GET /clis` live on connect, CLIs screen Test calls the real `POST /clis/:id/test`, persona Model
pickers list reported models Default-first with stale-assignment flagging and free-text for
non-enumerating CLIs. typecheck + topology clean, ui 40/40 green.

**Done (run_41, 3 atoms — `2cf63d9`, `b3e6cac`, `167ca8c`):** adapter + daemon backend for both
parts is built, typecheck/topology clean, and suites green (adapters 17, core 168, daemon 47).

- **Part B — model discovery:** `listModels(): Promise<ModelListResult>` on the Adapter port
  (`packages/core/src/adapter/types.ts`). `cursor-agent` enumerates via `--list-models`; codex and
  claude honestly degrade (`canEnumerate: false`). Daemon: `GET /clis` (cache read only) and
  `POST /clis/:id/test` (preflight + `listModels()`, CSRF-gated) in `packages/daemon/src/clis.ts`;
  `OzContext.cliTestCache` + `listAdapters()`.
- **Part A — run-readiness:** `runReadiness: RunReadinessProfile` on the Adapter port (launch-flag
  mechanism for all three CLIs today; `managesUserConfig: false`). Non-interactive flags are the
  single source consumed by `build()` (byte-identical argv, pinned by tests). Safety rationale
  recorded against existing ADR-0006 (no new ADR). `GET /clis` always returns declarative
  `configManaged` per CLI.

**Remaining (blocks archive):**

| Gap | Owner |
|-----|-------|
| **Evidence:** live end-to-end demo that the dropdown lists only CLI-reported models (+ Default);
  Part A already holds via `runReadiness` → `build()` | founder-witnessed demo; no code owed |

**Next session start:** run the live demo (open the dashboard against the running daemon, Test a
CLI, observe the persona Model picker reflect reported models). On founder sign-off, propose
archive. No founder decisions outstanding; NOT loop-amenable (no remaining code work).
