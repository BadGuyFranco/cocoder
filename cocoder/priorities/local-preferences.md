---
id: local-preferences
title: Local Preferences — default tech stack and design spec for new/unspecified work
---

## Objective

Establish two founder-owned **local default** surfaces that apply whenever an onboarded workspace does
not specify its own, each with a single owner and a documented resolution rule (workspace-specified
value wins; otherwise the local default applies):

1. **Preferred tech stack for new repos.** Research, verify, and document the canonical preferred stack
   (languages, frameworks, test runner, build tooling, lint/format, pinned versions) as the local
   default seeded into a newly scaffolded repo. Note: today this is **not** actually configured —
   `templates/workspace-cocoder/cocoder/memory/tech-stack.md` ships as a stub ("# Tech stack (stub)"),
   so the assumption that it is already set is the first thing to correct. Verified by: a researched,
   evidence-backed stack decision living at one owner surface, with a short rationale per choice, that a
   freshly scaffolded repo actually receives.

2. **Default design spec.** Capture the CoCoder dashboard's design language / aesthetic / CSS
   (`packages/ui/src/renderer/styles/`) as the documented local-default design spec — color, type,
   spacing, and core component patterns — that any new UI inherits when the onboarded workspace defines
   no CSS/design of its own. Verified by: a design-spec document with one owner (extracted as
   tokens/patterns, not a second hand-copy of the CSS) plus the stated default-resolution rule.

**First research/decision gate — RESOLVED (run 78).** Home and resolution rule are settled by evidence
and founder-ratified:

- **Home = the shipped workspace template**, not an installation-global surface. `scaffoldCocoderZone`
  (`packages/core/src/scaffold/scaffold.ts`) copies `templates/workspace-cocoder/cocoder/**` into each
  repo's `cocoder/` zone **create-only** (`copyFileCreateOnly` skips any file that already exists).
- **Resolution rule = that create-only copy.** A freshly scaffolded repo receives the default; if a
  workspace later specifies its own value the seeded file is never overwritten, so **workspace-specified
  wins; otherwise the template default applies.** This needs **no new mechanism** — it is reconciled
  with ADR-0027 (workspace storage) and ADR-0026 (onboard-existing); the conclusion is **document-only**.
- **Owners differ per concept under that one mechanism.** The design-spec's single owner is
  `packages/ui/src/renderer/styles/design-spec.md` (co-located with its source CSS); the tech-stack has
  no product-code source, so its owner is the seeded file itself,
  `templates/workspace-cocoder/cocoder/memory/tech-stack.md`.

**Boundary:** this priority defines, researches, and documents the two defaults and their resolution
rule, and wires the default-resolution where a clear owner already exists. It does not restyle the
dashboard, does not impose the stack/design on already-onboarded workspaces that specify their own, and
does not rebuild scaffolding beyond what the resolution rule requires.

## Run 79 — mechanism landed, then scope expanded by founder

**Mechanism + first-pass defaults landed (run_79).** The seed mechanism and both files are in place and
proven by the scaffold/mutations test file-set pins (green on every `pnpm test`):
- Tech-stack owner + template seed: `templates/workspace-cocoder/cocoder/memory/tech-stack.md`.
- Design-spec owner: `packages/ui/src/renderer/styles/design-spec.md` (run_78); template pointer:
  `templates/workspace-cocoder/cocoder/memory/design-spec.md` (run_79).
- Scaffold create-only copy (`copyFileCreateOnly`) seeds both; workspace-specified values never overwritten.

**Scope expanded (run_79, founder-ratified) — NOT archive-ready.** The first-pass defaults were sourced
from **CoCoder only**. The founder expanded the objective: the defaults must be the curated **cross-repo
best-of** (CoCoder **and** CoBuilder), and the design default must reflect the **shared "Fusion" design
language used across both the IDE and the website**, not just the Electron dashboard. Disposition:
**continue** (next step is a fresh build run; see remaining atoms).

### Ratified decisions (run_79)

1. **Tech stack = layered**, not one flat stack: one **shared toolchain** + **per-surface UI profiles**
   (the product family ships Electron desktop, Next.js web, and Fastify services).
2. **Adopt a minimal ESLint 9 flat config as the new-repo default** — CoCoder has no linter today;
   CoBuilder runs ESLint 9 (restrained, a few security rules). Keep the default restrained, not a large
   ruleset. CoCoder's **own** engine-repo adoption is tracked separately as ticket **0048** (out of this
   priority's scope).
3. **Design = copy the Fusion tokens into CoCoder** as a **self-contained, dated snapshot** in the
   design-spec owner, covering **both** token surfaces (web `--cb-*` hex/rgba + IDE shadcn-HSL). Name
   CoBuilder's `infrastructure/design-system` as the **upstream SSOT** and date the snapshot so a future
   re-sync is mechanical (founder accepted the drift trade-off vs a live cross-repo reference).

### Research evidence (run_79, read-only cross-repo review)

- **CoBuilder stack** (`/Volumes/NAS LOCAL/CoBuilder/infrastructure`): pnpm `10.30.3`; Node `>=20`;
  TypeScript `5.3.3` (ES2022/ESNext/bundler/strict + `noUncheckedIndexedAccess`, `noImplicitOverride`);
  Vitest `4.0.18` + Playwright `1.58`; Turbo `2.8.12` + knip `6.4.0`; ESLint `9.24.0` flat config +
  `@typescript-eslint 8.26`; web = Next.js `15.5.12` + React `19` + Tailwind v4 + shadcn; desktop =
  Electron `28.3.3` + electron-vite `2.0.0` + Vite `5.0.12` + React `18.2`; services = Fastify/tRPC/socket.io.
- **CoCoder stack** (this repo): pnpm `10.30.3`; Node `>=22`; TypeScript `5.9.3` (ES2022/NodeNext/strict);
  Vitest `3.2.4`; Electron `33.4.11` + electron-vite `2.3.0` + Vite `5.4.21` + React `18.3.1`; **no linter,
  no Turbo**.
- **Fusion design system** (`CoBuilder/infrastructure/design-system`, dual-token SSOT): "Art Deco × Liquid
  Glass"; themes **Warm Espresso** (dark) / **Warm Linen** (light); `--cb-*` hex/rgba tokens for web +
  shadcn-HSL tokens for IDE; fonts Josefin Sans (display) / Inter (body) / JetBrains Mono (mono); 4px
  spacing grid; intentionally low-radius; glass surfaces (22px blur + inset highlight); motion
  150/250/400ms. The CoCoder dashboard already uses the same `--cb-*` convention — it is the IDE surface
  of this one system. Token SSOT files: `design/tokens-website.css`, `design/tokens-ide.css`; live web
  values in `cobuilder-website/app/globals.css`.

### Remaining atoms (fresh build run — writes `templates/**`, `packages/ui/**`)

- **Atom 1 — rewrite `templates/workspace-cocoder/cocoder/memory/tech-stack.md`** as the layered best-of
  default: **shared toolchain** (pnpm `10.30.3`, TypeScript `5.9.x` strict + the extra strict flags, Node
  `>=22`, Vitest `4.x`, Playwright, Turbo `2.x`, knip, **minimal ESLint 9 flat config**) + **desktop
  profile** (electron-vite / Vite 5 / React 18) + **web profile** (Next.js 15 / React 19 / Tailwind v4 /
  shadcn) + **services profile** (Fastify/tRPC, optional). Pin every version from the live config of
  **whichever repo it came from** (no invented versions); one-line rationale per choice; keep the
  workspace-wins resolution note.
- **Atom 2 — rewrite `packages/ui/src/renderer/styles/design-spec.md`** to copy the Fusion tokens as a
  self-contained dated snapshot covering both surfaces (Warm Espresso/Warm Linen palettes, the three font
  families + fluid type scale, 4px spacing grid, low-radius ladder, glass surface recipe, motion tokens),
  naming `CoBuilder/infrastructure/design-system` as upstream SSOT + snapshot date. Keep it as the single
  owner; reconcile the template pointer's description if it changed. Resolve the known upstream value drift
  (e.g. light accent `#7A663B` in live globals vs `#8B7545` in the token SSOT) by snapshotting the live
  `globals.css` values and noting the choice.
- **Done when** both seeded defaults reflect the ratified cross-repo best-of, the design snapshot is
  self-contained + dated + SSOT-named, neither file forks its owner, and the scaffold/mutations test pins
  stay green.
