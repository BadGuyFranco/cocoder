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

## Round-2 outcome (run_114, committed on `main`)
All three founder-confirmed refinements shipped in one atom (`97bc3a4`); typecheck clean, UI suite
113/113 green. UI-only (`packages/ui` + `design-ref` mirror); no run/orchestration behavior.

1. **Dark mode — panel↔background reversed.** `--cb-bg` #14110E→#2A251F (lighter ambient),
   `--cb-bg-soft` #1A1714→#25211C; `--cb-surface`/`--cb-surface-glass` rgba(34,30,25,0.92)→rgba(20,17,14,0.96)
   (darker panels). Panels now read recessed/darker than the background.
2. **Light mode — background nudged darker.** `--cb-bg` #F3EEE6→#F0E9DF, `--cb-bg-soft` #EDE8DF→#EAE3D8
   so brighter panels separate from the slightly-darker ambient.
3. **Oz persona card — gradient removed.** `Personas.tsx` Oz Card: solid `var(--cb-surface)` with accent
   border `--cb-accent-15` retained (no wash).

Token values mirrored identically in `packages/ui/app/styles/fusion.css` and
`packages/ui/design-ref/design-system/colors_and_type.css`.

**Known follow-up if dark panels look uneven:** `--cb-surface-solid` (#1E1A16) and `--cb-surface-raised`
(#221E19) were left unchanged this round — the non-glass fallback is slightly lighter than the new glass
`--cb-surface`. If spots look inconsistent, darkening surface-solid toward rgb(20,17,14) is a one-atom
fix, not a re-architecture.

## Status — archive-candidate (run_114, 2026-06-17)

Round-1 items 2 (collapsible personas/plays) and 3 (settings trim) were founder-confirmed in run_113.
Round-2 closes item 1 (contrast direction) in code. **Only gate:** founder visual confirmation on a
rebuilt/running app — dark panels recessed vs lighter background, light panels separate, Oz card solid
and readable. No build atom remains until that look-see happens (or a third pass if the eye says no).

Awaiting founder `archive` confirmation — never self-archive.
