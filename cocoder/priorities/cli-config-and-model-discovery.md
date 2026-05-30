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

## Endpoints / seams owed (consumed by the Oz dashboard)
- `GET /clis` returns, per CLI: install + auth status, **available models** (Part B), and **config-managed**
  state (Part A).
- `POST /clis/:id/test` runs the health check **and** refreshes the model list.
- The persona Model dropdown reads models from `GET /clis` instead of the current placeholder constant in
  `packages/ui/app/sections/Personas.tsx` / `CLIs.tsx`.

## Relationship to other priorities
- Feeds [`full-oz-dashboard`](./full-oz-dashboard.md) — these are the daemon side of its CLIs screen and
  persona Model picker; that doc's "endpoints owed" already lists `GET /clis` + `POST /clis/:id/test`,
  which this priority specifies and fills.
- Per-CLI run-readiness is adjacent to the run-launch path; keep it behind the `adapters`/`session-hosts`
  ports so `core` and the daemon stay CLI-agnostic.
- Sequencing decided when picked up, not here.
