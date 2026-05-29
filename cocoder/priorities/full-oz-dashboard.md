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
the PLAYBOOK roadmap) into Oz/DB; its **oversight/debugger** must be reconciled with [`deb`](./deb.md)
so we build one debugger, not two; and its oversight is **tier 3 of the observation hierarchy
(ADR-0013)** — Oz monitors Oscars across sessions and may observe (poll) Bobs/Debs, but never
orchestrates them — **reusing** the monitor primitive built by
[`oscar-orchestrates-bob`](./oscar-orchestrates-bob.md), not a second implementation. Slice sequencing
is decided when this is picked up, not here.
