---
id: new-primary-root
title: "Onboard a primary root — New Primary + Onboard-existing (ADR-0020/0026)"
---

> **Refreshed 2026-06-22 (run_44).** The onboarding *machinery* is built and the entire code backlog (Atoms
> A–G + run_181 retro fixes) is landed and verified — including the four first-live-onboarding fixes (Atoms
> D–G, run_181; tickets 0025–0028 closed) and three run_181 retro build-quality fixes (SSOT collapse,
> `commitMessage` shim removal, D/E runnable proof via `scripts/proof-nongit-onboard.mjs`). **The first real
> live onboarding (Job Hunt / run_178)** succeeded and surfaced the D–G issues; all are now fixed in code.
> **New buildable work (run_188 evidence, founder-approved 2026-06-22):** the second live Job Hunt onboarding
> (run_188 / Job Hunt run 1) surfaced an **Onboarding hardening pass** — 3 atoms (run identity & status
> clarity; onboarding gates & scope; setup defaults & disclosure). It is launch-ready; see *Onboarding
> hardening pass* below. Two founder-owned beats still block final archive: reset-and-retest `job-hunt` from
> clean via **Add Workspace** (partly discharged by `node scripts/proof-nongit-onboard.mjs`) and the
> Verified-when external-repo live proof (billable, multi-agent, separate surface). Deploy
> auto-reload is delivered (ticket `0013`, run_179). **Drift Audit** was split to `drift-audit` and **archived
> 2026-06-21**. Vocabulary: "Takeover" → **Onboard (existing repo)** (ADR-0026); **`playbooks/` genre
> retired** (ADR-0032). Build history lives in `cocoder/SESSION_LOG.md` + git; this doc is current-state only.

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

### Onboarding hardening pass (run_188 evidence, founder-approved 2026-06-22 — launch-ready)
A focused **CoCoder onboarding product-quality repair** (not target-repo work) so a founder's first workspace
onboarding feels legible, scoped, approval-gated, and safe. Triggered by the second live Job Hunt onboarding
(run_188 / Job Hunt run 1), where scaffold → git-init → baseline commit → `onboard-existing` → recon atom 0 →
`cocoder/audit/recon.md` all worked, but six rough edges showed. Three atoms; each verifies by judgment +
the named suites. **Scope guard:** no target product code changes — only CoCoder's own source, tests,
templates, and docs.

**Atom 1 — run identity & status clarity.**
- Founder-facing run labels use the **workspace-local display number** when available ("Job Hunt run 1" /
  "run 1"), keeping the global engine id as a *technical* identifier ("technical id: run_188") only where
  needed for debugging/paths/support. Cover every founder-facing surface: UI + run detail, Deb status feed,
  Deb watch text, closeout & pickup language, founder-surfaced run records, and any Oz status summaries.
- **Owner-map (mandatory — do not fork):** this extends the existing per-root display-number owner from
  Atom G / [ticket 0028] (`runDisplayName` / `coCoderRunReference` / `displayNumber` in
  `packages/core/src/store/portable/display.ts` + the daemon `run-display.ts` accessor). Every remaining
  founder-facing emit-site must **derive from that owner**, not introduce a second labeling scheme. Do NOT
  remove `run_188`-style ids from file paths or internal storage.
- Fix Deb status projection so **verify state is tied to the active atom**: if atom 1 is building and atom 0
  passed, Deb must not show "verify-1 pass". Show verify idle for the active atom, or show "last verified
  atom" separately; handoffs must be atom-correct.
- Tests: prove a run with global id `run_188` + workspace display number 1 renders founder-facing as
  "workspace run 1", and that Deb status does not attribute atom 0's verify pass to atom 1.

**Atom 2 — onboarding gates & scope.**
- Update the shipped `onboard-existing` priority/template so Bob's **normal effective write scope includes
  `cocoder/**`** for onboarding, and keep `auditWriteBoundary: ["cocoder/**"]` as the hard boundary — the two
  must **agree** so valid audit output (e.g. `cocoder/audit/recon.md`) is no longer recorded as
  out-of-scope-committed merely because Bob's base scope was empty. (Apply to the single SSOT template copy —
  the base duplicate was removed in run_44.)
- Make the **recon/spend founder gate mechanical**: after a successful recon atom 0, require a *recorded
  founder approval* before any deep-read / adversarial-read / cross-check atom can be delegated. Implement via
  priority metadata, an onboarding checkpoint file, a runner-recognized gate, or another existing governance
  mechanism — **do NOT create a parallel standalone phase executor; preserve ADR-0026** (onboarding runs the
  ordinary Oscar/Bob/founder loop).
- If Oscar attempts to delegate deep-read before approval, **reject/block the directive** with a clear
  founder-facing message ("recon complete; spend approval required before expensive read"); recovery is to
  wrap/pause with the recon map, spend estimate, and a populated Founder Decision Needed.
- Tests/proof: atom 1 cannot start as deep-read until approval is recorded.

**Atom 3 — first-workspace setup defaults & disclosure.**
- Newly added **non-primary folders default to `readonly`**; `writable` requires an explicit founder action.
  **Preserve existing saved roles** — do not silently downgrade `Anthony/About` or any already-configured
  writable folder. (Roles live in `packages/daemon/src/registry.ts`: `primary|writable|readonly`.)
- Add **first-run scaffold disclosure**: workspace creation's founder-facing result clearly states the
  primary root, added roots and their roles, whether git was initialized, whether a baseline commit was
  created, and **every file written outside `cocoder/`** — for Job Hunt that includes the root `.gitignore`.
- The scaffold's root `.gitignore` write: keep it **and disclose it**, or move it behind an explicit option —
  never silently write a target-repo file outside `cocoder/` during onboarding.

**Verification required:** run the affected unit suites (workspace registration/registry, scaffold, priority
loading, runner status, Deb status projection, onboarding priority behavior) plus the nearest onboarding
proof (`scripts/proof-onboard-existing.mjs` / `scripts/proof-nongit-onboard.mjs`); add targeted tests where
coverage is missing. Report exact commands, exit codes, and relevant output.

**Acceptance:** founder-facing run identity separates workspace run number from the global technical id; new
added folders default readonly while existing explicit writable roles are preserved; onboarding Bob scope
includes `cocoder/**` and valid audit output is not flagged out-of-scope; recon/spend approval is
mechanically required before deep-read; Deb status is atom-correct (no stale cross-atom verify); first-run
scaffold reports any writes outside `cocoder/` including root `.gitignore`; no target product code changed.

### Build atoms — non-git primary root (DONE in code, run_176)
Both atoms committed; no further buildable backlog for this defect.

- **Atom A — fail-fast preflight guard (DONE, 920abe30).** Non-git primary roots are refused at launch
  preflight with a clear founder message before any run starts; `runner.test.ts` covers it.
- **Atom B — scaffold initializes local git (DONE, 817d2e3f).** **Add Workspace** on a non-git root runs local
  `git init -b main` (no remote), create-only root `.gitignore`, and commits the scaffolded `cocoder/` zone via
  the spine; existing git roots untouched. Daemon real-git tests prove `governanceCommitted` + branch `main`.

**Deployment gap (historical; fixed by ticket `0013`, run_179):** early `job-hunt` attempts failed because the
running daemon booted before Atoms A/B landed (`governanceCommitted:false`, "not a git repository" in
`local/oz-audit.log`). Ticket `0013` now idle-reloads the daemon after daemon/core-touching commits — no
founder `scripts/oz.sh restart` required. Live proof: `node scripts/proof-daemon-reload.mjs`.

### Atom C — seeded onboarding priority must appear in the panel and launch (DONE, run_177, 528f51f2)
**Defect was (run_176 post-wrap, `job-hunt`):** the scaffold seeds `cocoder/priorities/onboard-existing.md` and
the daemon API returns it, yet the priority did **not show in the workspace priorities panel** — a render/refresh
bug, not the file or the API.

**Root cause (suspect a, proven):** `handleCreateWorkspace`'s *live* path in `packages/ui/src/renderer/App.tsx`
explicitly set `prioritiesByWs[newId] = []` right after create, masking the daemon-returned list (it never
re-fetched). **Fix:** replace that empty-list seed with `await refreshWorkspace(id)`, which fetches priorities via
`loadWsData`. The `!live` demo branch correctly keeps `[]` (no daemon to fetch from). Pinned by a new
`packages/ui/tests/live-app.test.tsx` case that seeds an `onboard-existing` priority *carrying `auditWriteBoundary`*
on recreate and asserts it renders + launches and that priorities are re-fetched; confirmed fail-before/pass-after,
full UI suite 157/157 green, `tsc --noEmit` exit 0.

**Live acceptance (founder, after idle reload):** unit proof covers the render/refresh path; Add Workspace
end-to-end on a non-git root still requires the daemon on post-fix code (now delivered via ticket `0013`
idle-reload). Reset `job-hunt` — delete its `cocoder/` folder, remove the workspace from CoCoder, re-add
via **Add Workspace** — and confirm `git init`, governance commit, and `onboard-existing` in the panel.

### Build atoms — first live-onboarding reassessment (ALL DONE in code, run_181)
The first real non-git onboarding (Job Hunt) surfaced four issues; all four landed as verified build atoms in
run_181 (tickets 0025–0028 closed). No further buildable backlog remains for this defect set.

- **Atom D — baseline-commit the full existing tree on git-init (DONE, run_181, ad457ebc; [ticket 0025](../tickets/closed/0025-git-init-baseline-commit-full-tree.md)).**
  `createWorkspace` baseline-commits the user's full existing tree (`git add .`, honoring the seeded
  `.gitignore`) only when it git-inits a non-git root; already-git repos get no re-import. Daemon real-git test
  proves product files tracked, `node_modules/` excluded, cocoder zone committed, clean `git status`.
- **Atom E — complete the scaffold governance commit list (DONE, run_181, 38e368e9; [ticket 0026](../tickets/closed/0026-scaffold-governance-commit-incomplete.md)).**
  `scaffoldWorkspaceGovernance` now seeds and commits every `cocoder/**` file it writes (incl. `workspace.json`
  + `counters.json`). An already-git test (no baseline backstop) pins committed == written − ignored.
- **Atom F — onboarding template supports content/ops repos (DONE, run_181, ef093f95; [ticket 0027](../tickets/closed/0027-onboard-existing-template-supports-content-ops-repos.md)).**
  The `onboard-existing` template now treats content/ops/docs repos as first-class (subsystem typing, evidence
  rule "path (and line where it applies)"); applied to BOTH byte-identical copies (template + base) with a
  restored cross-copy sync guard in `scaffold.test.ts`. No regression for code repos.
- **Atom G — founder-facing run numbering is per-root, not global (DONE, run_181, b05027d1; [ticket 0028](../tickets/closed/0028-founder-facing-run-number-per-root-not-global.md)).**
  All founder-facing labels derive from per-root `displayNumber` via one shared owner
  (`runDisplayName`/`coCoderRunReference` in core + the daemon `withPortableDisplayNumber` accessor); trailers
  read `run N (run_NNN)` keeping the global id parseable and as the internal key. "Run 1" everywhere on a fresh
  root's first run; null fallback to `run.id` pinned.

**Founder note:** the founder is NOT continuing run_178 and will **reset Job Hunt for a brand-new onboarding
test now that Atoms D–G have landed** (delete its `cocoder/` + the workspace, re-add via Add Workspace). The
recon question in run_178 is intentionally left unanswered. Because D–G touched daemon/core, the running daemon
must be on post-D–G code before the retest — ticket `0013` idle-reload should handle this once in-flight runs
drain (verify with `node scripts/proof-daemon-reload.mjs` if in doubt).

**Disposition: `continue` (buildable work scoped; relaunch to execute).** Atoms A–G + the run_181 retro
fixes are landed and verified. The **Onboarding hardening pass** (3 atoms above, run_188 evidence) is
founder-approved and launch-ready — relaunch `new-primary-root` to execute it as a fresh build run. Two
non-code beats still remain before final archive, both founder-owned and off this build surface: (1) the
founder reset-and-retest of Job Hunt from clean (partly discharged by `node scripts/proof-nongit-onboard.mjs`),
and (2) the Verified-when external-repo live proof below.

### Founder-gated live proof (separate, after D–G + reset retest)
Onboard a real external repo (CoPublisher / a CoBuilder copy) end-to-end through the rebuilt Oscar-driven
flow: scaffold → multi-agent audit → founder ratifies the drafted Objectives → first ratified run lands,
with findings traceable to repo reality (Objective verification). This is **billable, multi-agent, founder-
authorized**, on a different launch surface than an ordinary build loop.

### Build-quality flaws to research and properly fix (run_181 retro)
Atoms D–G are correct and verified. The run_181 self-audit surfaced design debt in the onboarding/scaffold
code; three items were fixed in run_44; one was resolved-by-design; one optional elegance item remains.

- **SSOT — two byte-identical copies of the seeded priority templates (DONE, run_44, c2fdd2f).** Collapsed to
  one owner: `templates/workspace-cocoder/cocoder/priorities/**` (what the scaffold seeds). Deleted the orphan
  `packages/personas/base/priorities/**` copies (zero runtime consumers), removed `basePrioritiesDir()`, and
  repointed scaffold/personas/daemon tests to the runtime-canonical template dir. Replaced the cross-copy guard
  with real content assertions.
- **`counters.json` split ownership (resolved-by-design; pinned by proof).** Lifecycle is seed-then-run-history-
  owns: scaffold create-seeds `counters.json` into the governance commit only if missing
  (`packages/daemon/src/routes.ts` ~402–406); run-history owns all subsequent mutations under a lock via
  `PORTABLE_RUN_HISTORY_SCOPE`. Pinned by `node scripts/proof-nongit-onboard.mjs` invariant 2 (committed
  governance set includes `counters.json`).
- **`commitMessage(run: string | RunDisplayInput)` compat shim (DONE, run_44, 74ff532).** Param is now
  `RunDisplayInput` only; the string branch is gone so a bare runId cannot silently drop the per-root display
  number.
- **No runnable proof for the D/E behavior (DONE, run_44, 451ba93).** `node scripts/proof-nongit-onboard.mjs`
  wraps the two real daemon real-git tests proving Atom D (non-git root → git init + full-tree baseline commit +
  `node_modules` excluded + clean status) and Atom E (already-git root → no re-import; committed == written −
  ignored, incl. `counters.json` + `workspace.json`). Exit 0 today; partly discharges the founder reset-retest
  gate.
- **Resolution prose triplicated (elegance, optional, low).** Each atom's resolution is restated in the ticket
  body, the `tickets/INDEX.md` row, and this doc. INDEX-vs-body is the accepted slim-index convention; this doc
  could link the closed tickets instead of restating them. Not an archive blocker.

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
