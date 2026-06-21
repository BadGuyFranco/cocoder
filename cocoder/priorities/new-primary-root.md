---
id: new-primary-root
title: "Onboard a primary root — New Primary + Onboard-existing (ADR-0020/0026)"
---

> **Refreshed 2026-06-21 (run_176).** The onboarding *machinery* is built; the **non-git primary root defect**
> (run_174, workspace `job-hunt`) is **fixed** — fail-fast preflight (920abe30) plus scaffold-time local
> `git init` (817d2e3f). Only the **founder-gated live proof** (onboard a real external repo end-to-end)
> remains. The
> third situation,
> **Drift Audit**, was split out into the `drift-audit` priority and **completed + archived 2026-06-21**, so
> it is no longer in this priority's scope. Vocabulary updated to current truth: "Takeover" → **Onboard
> (existing repo)** (ADR-0026); the baked-plan **`playbooks/` genre is retired** (ADR-0032) — onboarding
> ships as **scaffold-seeded priorities**, not a live `playbooks/` genre. The detailed run-by-run build
> history (runs 111–160) lives in `cocoder/SESSION_LOG_ARCHIVE.md` + git; this doc is current-state only.

## Objective
CoCoder can onboard any primary root for **two situations**, each writing only the target's `cocoder/**`,
committing via the spine (ADR-0023) to the target's active branch, with **the founder ratifying every
drafted Objective** before anything is runnable:

- **New Primary** (fresh/empty root) — scaffold the `cocoder/` zone + minimal seeded governance; launch-ready
  immediately.
- **Onboard (existing repo)** (the big lift) — a world-class multi-agent, founder-checkpointed audit that
  *reviews and proposes only* (never touches product code), authoring the repo's `cocoder/` governance and a
  first priority the founder ratifies. Driven as an **ordinary Oscar priority** (ADR-0026), not a standalone
  executor.

**Verified when:** a real external repo is onboarded end-to-end — scaffold → audit → founder ratifies
Objectives → first run lands, findings traceable to repo reality. *(The former Verified-when (b) — a dogfood
Drift Audit — is satisfied by the archived `drift-audit` priority.)*

**Boundary:** founder acceptance of ADR-0020 gates any build (accepted); no deployment, no multi-repo commit
spine, no product code. Onboarding writes `cocoder/**` only, enforced at the commit spine.

## What is built (run_141; `main` green run_160)
The Onboard-existing flow was rebuilt per ADR-0026 as an ordinary Oscar-driven priority — the executor +
phase protocol were retired, the engines kept as library tooling:

- **Scaffold (P0)** — `scaffoldCocoderZone` seeds a target's `cocoder/` zone; for an *existing* repo it also
  create-only-seeds `templates/workspace-cocoder/cocoder/priorities/onboard-existing.md` as the repo's first
  priority (the **scaffold-seeded** delivery model — ADR-0020 §7 amendment; one mechanism, priorities).
- **Audit engines (reused as plain library calls)** — `recon`/`intent`/`estimate`, the `deep-read` Play, the
  dual-source convergence engine (`p2-fanout`/`p3-cross-check`), `p4-questions`/`p5-synthesis`/`p6-apply`.
  Oscar decomposes the onboarding Objective into atoms that call these; founder gates (spend / questions /
  ratify) are ordinary Oscar wrap/verify beats.
- **`cocoder/**`-only trust boundary** — `loadPriority` parses optional `auditWriteBoundary: ["cocoder/**"]`
  frontmatter (set on `onboard-existing.md`; absent ⇒ ordinary behavior), enforced via
  `AuditWriteBoundary`/`AuditWriteBoundaryError` at every commit site. An onboarding priority writing a
  product path is REFUSED (zero commit); ordinary priorities still commit-and-flag out-of-lane (ADR-0023 §3).
- **Proof:** `node scripts/proof-onboard-existing.mjs` → exit 0, three invariants green (onboarding refuses
  product-code writes / ordinary runs unchanged / scaffold seeding is conditional on an existing repo).

**New Primary** scaffolds a fresh `cocoder/` zone via the dashboard **Add Workspace** flow. A non-git primary
root is now onboarded cleanly: **Add Workspace** runs local `git init` + commits the `cocoder/` zone (817d2e3f);
launch preflight refuses any root that still isn't git-backed with a clear founder message (920abe30). A
per-language **tech-stack-starter template** (non-negotiables + "if-unsure"
fallback) was sketched as a
playbook skeleton, now frozen design history at `cocoder/zArchive/playbooks/new-primary-tech-stack.md`
(genre retired, ADR-0032). It is an optional future enhancement — not required for the core New Primary
path; revive as its own priority if wanted.

## Remaining work

### Build atoms — non-git primary root (DONE, run_176)
Both atoms committed; no further buildable backlog for this defect.

- **Atom A — fail-fast preflight guard (DONE, 920abe30).** Non-git primary roots are refused at launch
  preflight with a clear founder message before any run starts; `runner.test.ts` covers it.
- **Atom B — scaffold initializes local git (DONE, 817d2e3f).** **Add Workspace** on a non-git root runs local
  `git init -b main` (no remote), create-only root `.gitignore`, and commits the scaffolded `cocoder/` zone via
  the spine; existing git roots untouched. Daemon real-git tests prove `governanceCommitted` + branch `main`.

**`job-hunt` unblock:** no manual `git init` needed — re-add or recreate the workspace via **Add Workspace** on
the non-git root and the scaffold path self-inits git + commits the zone.

### Founder-gated live proof (only remaining gap)
Onboard a real external repo (CoPublisher / a CoBuilder copy) end-to-end through the rebuilt Oscar-driven
flow: scaffold → multi-agent audit → founder ratifies the drafted Objectives → first ratified run lands,
with findings traceable to repo reality (Objective verification). This is **billable, multi-agent, founder-
authorized**, on a different launch surface than an ordinary build loop.

## First-run operational note (run_160)
A fresh-workspace first run launches the persona CLIs with **no `--model`** (CoCoder passes the persona's
default through unchanged), so the CLI uses *its own* configured default. If that default is an unavailable
alias (e.g. `~/.claude/settings.json` → `opus[1m]`), the run errors "model … not available." **Remedy:** set
`~/.claude/settings.json` `model` to an available alias (or remove it). `ClaudeAdapter.preflight` now probes
the exact launch form, so an unavailable model surfaces at preflight, not the founder's first live run
(guarded by `fresh-workspace-model-launch.test.ts` + `adapters.test.ts`). Model *tier* selection is owned
separately by `first-class-model-tiers.md`.

## Key decisions
- [ADR-0020](../decisions/0020-primary-root-audit.md) — onboarding situations + scaffold/audit machinery
  (Accepted; §7 amended: onboarding ships as scaffold-seeded priorities, not a loader-discovery field).
- [ADR-0026](../decisions/0026-onboard-existing-as-oscar-priority.md) — Onboard-existing runs as an ordinary
  Oscar priority (supersedes the executor runner-mode); renames "Takeover" → "Onboard (existing repo)".
- [ADR-0032](../decisions/0032-retire-playbooks-genre.md) — the `playbooks/` genre is retired; skeletons
  frozen under `cocoder/zArchive/playbooks/` as design history.
- [ADR-0023](../decisions/0023-workspace-commit-spine.md) — the commit spine onboarding writes through.
