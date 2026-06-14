---
id: full-oz-dashboard
title: Full Oz dashboard — the v1-designed control plane, earned in slices
---

## Objective
Oz grows from the four Phase-2 "thin" surfaces to the v1-designed control plane — an in-app **chat
command interface**, **run oversight/debugger**, **settings**, and **drag-reorder priorities** — built
and operated in **earned slices**, not big-bang (D6). **Verified** per slice: each ships behind the
existing loopback/token/Origin/CSRF posture and is operated end-to-end from the dashboard before the
next slice starts. Boundary: rides the existing `core` ports + the Phase-2 daemon/ui; no fork.

This is the road to feature-complete and the surface you actually operate from (re-authored from the
archived v1 `v0.4-oz-control-plane` as reference, not resurrected). Three reconciliations flagged for
design time: its **drag-reorder** is where priority *ordering* migrates off the interim (`backlog/` +
the PLAYBOOK roadmap) into Oz/DB; its **oversight/debugger** must be reconciled with [`deb`](../zArchive/priorities/v2/deb.md)
so we build one debugger, not two; and its oversight is **tier 3 of the observation hierarchy
(ADR-0013)** — Oz monitors Oscars across sessions and may observe (poll) Bobs/Debs, but never
orchestrates them — **reusing** the monitor primitive built by
[`oscar-orchestrates-bob`](../zArchive/priorities/v2/oscar-orchestrates-bob.md) (done + archived), not a second implementation.

## Status — CODE-COMPLETE; founder live-proof ladder owed

All builder-delegable work is landed on `main`. Every owed daemon surface in
`packages/ui/ENDPOINTS_OWED.md` is served: Oz chat (+ SSE, agent turns, nudge, repair); Workspaces CRUD
([ADR-0019](../decisions/0019-multi-root-workspaces.md)); cooperative stop; persona run-mode + sub-agents
honored for Oscar **and** Bob ([ADR-0018](../decisions/0018-persona-run-mode-and-sub-agents.md)); settings;
free-text ad-hoc runs; priority create + reorder; resolve from the run drawer. (The post-design
"Awaiting you" column-1 strip was removed in run_81 — design-ref has no such panel; founder-attention
runs surface via the drawer + Oz chat.) The two by-design
deferrals are dynamic CLI registration (CLIs derive from compiled adapters) and richer chat streaming
beyond coarse refetch hints. Mechanical proof: `node scripts/proof-oz-surfaces.mjs`.

**Do NOT relaunch this as a build run** — it only produces empty reaffirmation wraps (F18). Open a
builder atom only if a live finding surfaces a concrete defect.

> **Post-reset note (2026-06-14, [ADR-0023](../decisions/0023-workspace-commit-spine.md)).** The
> orchestration operating-model reset changed how runs commit: **direct-to-branch is the default**, so
> the `pending-landing` / stranded-commit / **Resolve** surfaces now fire only on the opt-in isolation
> lane, and out-of-scope **held-back** is the normal founder-attention state (drawer + Oz chat, not a
> column-1 runs list). The dashboard's run / resolve surfaces should be sanity-checked against this
> during the live pass (a likely punch-list item). The historical slice-by-slice build log that used to fill this file was
> written against the pre-reset model — it now lives in the PLAYBOOK roadmap + SESSION_LOG + git history
> (it never belonged in a stub — ADR-0010).

## Remaining — founder-present live evidence only (zero buildable atoms)

1. Restart the daemon onto current `main` (confirm via `/health` bootSha), then launch the dashboard —
   it should render, not blank (F16 fixed, `88888d7`).
2. Assign `oz` a real CLI+model; exercise the chat ladder: status / launch / stop / nudge / repair /
   Refresh Oz.
3. Eyeball the rebuilt priorities pane against `packages/ui/design-ref/`.
4. One live headless-Oscar run + one live headless-Bob run (flip mode in Personas).
5. A **full founder Q/A pass** end-to-end → expect one punch-list run of fixes (fold in the post-reset
   surface check above).

**Archive-candidate** only AFTER the Q/A pass + punch-list — not after the live proofs alone.
