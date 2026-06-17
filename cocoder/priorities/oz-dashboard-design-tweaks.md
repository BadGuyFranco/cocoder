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

## Round-2 founder review (2026-06-17, on the rebuilt bundle)
Dark-mode reversal, light-mode nudge, and Oz-card de-gradient confirmed in the right direction — but the
darker dark-mode surface exposed four follow-on visual issues (the surface tones are now intentional, so
the remaining work is making the *separation between* surfaces correct). Captured as Round-3 below.

## Round-3 — founder visual refinements (NOT yet built — needs a fresh build run)
UI-only (`packages/ui` + `design-ref` mirror); no run/orchestration behavior. The contrast/surface items
remain a **founder visual check on a rebuilt app** (the bundle must be rebuilt after commit before the
eye check — ticket 0010; Oscar can run the build meanwhile). Keep `fusion.css` ↔
`design-ref/design-system/colors_and_type.css` in sync for any token edit.

1. **Persona card backgrounds inconsistent — all render light except Oz.** Root cause: non-Oz persona
   cards use the `Card` primitive default `var(--cb-surface-glass)` (`packages/ui/app/ui/primitives.tsx`
   L54, with `backdropFilter` blur), while the Oz card uses solid `var(--cb-surface)`
   (`packages/ui/app/sections/Personas.tsx` ~L70); the `--cb-surface-solid` (#1E1A16) / `--cb-surface-raised`
   (#221E19) tokens were also left lighter in round-2. Net effect: Oz reads dark/recessed, every other
   persona reads light. **Make all persona cards share ONE consistent recessed surface in dark mode** —
   Oz distinguished by its `--cb-accent-15` border ONLY, not by a different fill. Diagnose the exact
   token (and the glass-vs-solid + backdrop-blur compositing) on the running app.

2. **Priorities blend into one panel — no separation between rows.** In
   `packages/ui/app/sections/dashboard/Priorities.tsx`, each `PriorityRow` (~L24–37) AND its container
   `oz-panel-body` / `oz-panel` (`packages/ui/app/styles/oz.css` L329 / L297) both use
   `var(--cb-surface-glass)`, so the queue reads as one undifferentiated block. **Founder steer: KEEP the
   priority *card* background as-is; dramatically differentiate the *panel/container* background behind
   the cards** so each row stands out as a distinct tile. (A clearly different panel-body bg is the
   primary lever; stronger per-card border/shadow or more inter-card gap are secondary — but anchor on
   changing the container background per the founder.) Apply consistently to `AdhocPriorityRow`.

3. **Priority card layout — stack Status + Launch; give the title more room; shorter boxes.** In
   `PriorityRow` (Priorities.tsx ~L45–51) the title, `StatusChip`, and `Launch` button share ONE
   horizontal row (status+launch pushed right via `marginLeft:'auto'`), squeezing the title. **Stack the
   status chip and Launch button vertically in the right-hand column** so the title gets more horizontal
   width; **shrink the status chip a bit**; and **tighten vertical padding so the boxes are a little
   shorter.** Layout only — no behavior change. Mirror the same treatment in `AdhocPriorityRow` where it
   shares the pattern.

4. **Scrollbar blends into the background.** `packages/ui/app/styles/oz.css` L16–19: the thumb is
   `var(--cb-border)` on a transparent track — invisible against the panel. **Give the thumb a more
   visible/contrasting tone** (e.g. `--cb-border-strong` or a muted text token) and optionally a faint
   track, so the scrollbar is legible without being loud, in BOTH themes.

**Verified when (Round-3):** rebuilt app shows (1) all persona cards on one consistent surface with Oz
set apart only by its accent border, (2) priority rows visually distinct as separate tiles via a
differentiated container background (card bg unchanged), (3) priority boxes with stacked status/launch,
roomier title, and shorter height, and (4) a legible scrollbar — all confirmed by the founder's eye;
`pnpm -w typecheck` and the UI suite green; token files in sync.

## Status — Round-3 queued; needs a fresh build run (run_114, 2026-06-17)

Rounds 1–2 shipped and were directionally confirmed. Founder reviewed the rebuilt bundle and raised the
four Round-3 refinements above (persona-card consistency, priority-row separation, priority-box layout,
scrollbar legibility). **These are concrete, scoped, UI-only build atoms — not an archive.** Founder will
launch a fresh build run to implement them; verify each diff, rebuild the bundle, then founder eye-checks.
Do **not** archive — this priority has live, specified work remaining.
