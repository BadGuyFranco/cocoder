---
id: oz-dashboard-design-tweaks
title: "Oz dashboard design tweaks — contrast, collapsible personas/plays, settings trim"
---

## Objective
Three founder-specified polish changes to the Oz dashboard UI (`packages/ui/app`), each verifiable:

1. **Contrast.** Panels and background are too low-contrast — in **dark mode** panels read too light and
   the background too dark (and the inverse in **light mode**). The panel/ambient **gradient** is a
   likely cause (`packages/ui/app/styles/oz.css` — ambient radial gradients ~L27–28 and panel
   backgrounds). **Remove the panel gradient or make it markedly more subtle** so panels read as a clear,
   comfortable surface distinct from the background in BOTH themes.
2. **Collapsible personas and plays.** A persona currently renders its **full play list** expanded
   (`packages/ui/app/sections/Personas.tsx` / `Plays.tsx`). Make each **persona collapsible** (collapsed
   by default so the long play list is hidden until expanded), and make **plays collapsible** within it.
3. **Settings trim.** **Remove** the **Compact density** and **Reduce motion** settings entirely — the
   toggles in the Settings UI, their state in the preferences model
   (`model.ts` `preferences.compactMode` / `reduceMotion`), the `App.tsx` wiring that sets
   `data-compact` / `data-reduce-motion`, and the now-dead CSS (`oz.css` `[data-compact]` /
   `[data-reduce-motion]` blocks). Leave no orphaned plumbing.

**Verified when:** the app runs and the founder visually confirms (a) comfortable panel↔background
contrast in **both** dark and light modes with the gradient gone/subtle, (b) personas collapse/expand
with the play list hidden by default and plays individually collapsible; and (c) the two settings are
gone from the UI with **no** remaining `compactMode`/`reduceMotion`/`data-compact`/`data-reduce-motion`
references anywhere (grep-clean), with `pnpm -w typecheck` and the UI test suite green. **Boundary:**
UI-only (`packages/ui`); no change to run/orchestration behavior; scope is exactly these three tweaks —
no broader restyle.

## Notes (context the founder may refine at start)
- Items 2 and 3 are objective/grep-checkable; **item 1 (contrast/gradient) is a visual design judgment**
  — the exact tokens/values are tuned at run time and confirmed by the founder's eye, so the verify for
  it is a **runnable app + founder visual check** (offer a quick app launch / before-after screenshots),
  not a unit assertion.
- This is a focused polish priority, distinct from `tickets-review` (which adds dashboard *tabs*). If
  both are active, sequence so they don't both rewrite the same dashboard chrome in conflicting ways.
- Conflict-scan (light): no ADR governs dashboard styling; an older note referenced an "Oz dashboard
  archived" event — the dashboard code is live in `packages/ui`, so confirm current state before
  editing. Draft Objective; founder ratifies at the priority-start alignment beat (ADR-0010).

## Round-1 outcome (run_113, committed on `main`)
All three atoms shipped and committed: settings trim (`f3d55dd`), collapsible personas/plays
(`2995b1b`), contrast tokens (`87fe8bc`), wrap docs (`713db8c`). typecheck clean, UI suite 113/113.
Founder rebuilt the bundle and visually reviewed — items 2 (collapsible) and 3 (settings trim)
confirmed good. Item 1 (contrast) needs another pass; see below.

## Round-2 — founder visual refinements (NOT yet built — needs a fresh build run)
The round-1 contrast pass over-corrected / mis-read the intended direction. The founder's actual
target, confirmed by eye on the running app:

1. **Dark mode — REVERSE the panel↔background relationship.** Currently the background is dark and
   panels are the lighter surface; the founder wants this reversed — **panels should read darker than
   the background** (background the lighter tone, panels recessed/darker). Tune `--cb-bg`/`--cb-bg-soft`
   and the panel surfaces (`--cb-surface` / `--cb-surface-glass`) in the dark theme accordingly
   (`packages/ui/app/styles/fusion.css`, mirror to `design-ref/design-system/colors_and_type.css`).
   Watch that text/border tokens still read against the new panel tone.
2. **Light mode — background a touch darker.** Nudge `--cb-bg` (and `--cb-bg-soft` as needed) slightly
   darker in the light theme so panels (already brighter post-round-1) separate more cleanly.
3. **Oz persona card gradient — remove it.** `packages/ui/app/sections/Personas.tsx` L70: the Oz
   (`isOz`) Card uses `background: 'linear-gradient(180deg, var(--cb-accent-subtle) 0%,
   var(--cb-surface-glass) 60%)'`, which makes the Oz panel hard to read. Replace with a solid,
   readable surface (e.g. `var(--cb-surface)`), keeping the accent border (`--cb-accent-15`) so Oz is
   still visually distinguished without the unreadable wash.

Boundary unchanged: UI-only (`packages/ui`); no run/orchestration behavior. Item 1 verify remains a
**founder visual check on the running app** (rebuild required to see it — see ticket 0010). After this
round lands, founder rebuilds (or the runner auto-rebuilds once 0010 is done) and confirms; if good,
archive.
