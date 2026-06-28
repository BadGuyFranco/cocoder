---
id: 0083
title: Retention live-enablement has no founder-facing affordance — founder handed a settings.json edit + node commands
type: task
status: Closed
priority: none
owner: founder-session
created: 2026-06-28
---

# 0083 — Retention live-enablement has no founder-facing affordance

## Context

The `local-cache-retention` engine ships inert (`retention.enabled` defaults false). The last archive
gate is observing one real live daemon-boot GC pass with the flag on. In run_279 (CoCoder run 137) the
wrap-up and its follow-up handed the **solo non-developer founder** the enablement as:

- a hand-edit of `local/settings.json` to add `"retention": { "enabled": true, "keepLastNPerWorkspace": 25 }`, and
- four `node scripts/observe-retention-live.mjs …` terminal commands.

Both are the wrong founder surface. The operating premise is that founder-facing actions are plain
English through **governed affordances** (Oz chat, a button, a Play backed by the daemon
commit/lifecycle spine). The founder should never hand-edit machine-local internal config (`local/` is
the gitignored cache, ADR-0027) and should never run terminal/`node` commands. `observe-retention-live.mjs`
is a valid developer/Oscar verification tool, but it is **not** a founder surface; the real gap is that
there is no daemon-backed founder path to (a) enable retention and (b) drive + surface the observed boot
GC pass.

This is the same failure class as F18 (handing the founder a checklist to execute by hand), here leaking
into the wrap-up Play's *Founder Decision Needed* / *Recommended Next Step* sections, which emitted raw
terminal commands and a JSON edit instead of a governed action.

## Acceptance

A founder-facing, daemon-backed path to perform live retention enablement with **no** terminal command
and **no** hand-edit of `local/`:

- Set `retention.enabled` (+ `keepLastNPerWorkspace`) through the daemon/settings spine — an Oz chat
  instruction, a UI toggle, or a Play — not a manual `settings.json` edit.
- Drive the controlled boot/Refresh GC pass via the sanctioned affordance and surface the observed result
  back in Oz: the `retention-gc` audit entry, before/after `local/` footprint, and that no
  protected/non-terminal run was pruned — reusing the `observe-retention-live.mjs` measurements behind the
  scenes rather than asking the founder to run them.
- Wrap-up closeouts for any settings or lifecycle change must emit a governed founder action
  (chat/affordance/Play), never founder-executed terminal commands or hand-edits.

## Notes

Interim path until this is built: route enablement through the Oscar–Deb machinery-repair dialogue
(ADR-0036). Deb applies the settings change via the governed commit spine and surfaces the observed pass,
leaving the founder at most one **sanctioned Refresh click** — a legitimate governed affordance, not a
terminal/JSON action.

## Resolution

Resolved by run run_283 (d3ffacfdbddeb7ed14e5e712c78517ef39120637) on 2026-06-28.

Governed founder-facing retention enablement shipped: Oz-chat `retention enable [N]` / `retention disable` persists via the daemon settings spine and audit-wraps intent (atom 1); enabling drives the real runRetentionGcOnce on-demand and surfaces footprint delta + pruned + protected-skipped runs + the retention-gc audit entry, one footprint owner in local-footprint.ts (atom 2); the base wrap-up Play now forbids founder-run terminal/node commands and machine-local hand-edits for any settings/lifecycle change, routing them through a governed affordance while keeping the F18 proof-harness allowance (atom 3). No settings.json hand-edit or node commands handed to the founder.
