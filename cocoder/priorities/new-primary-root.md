---
id: new-primary-root
title: "Onboard a primary root — New Primary + Onboard-existing (ADR-0020/0026)"
---

> **Refreshed 2026-06-22 (run_181).** The onboarding *machinery* is built and the entire code backlog (Atoms
> A–G) is landed and verified — including the four first-live-onboarding fixes (Atoms D–G, run_181; tickets
> 0025–0028 closed). **The first real live onboarding (Job Hunt / run_178)** succeeded and surfaced those
> four issues; all are now fixed in code. **No buildable atoms remain.** Two founder-owned beats block archive:
> **(founder)** reset-and-retest `job-hunt` from clean via **Add Workspace** (confirm git-init, full-tree
> baseline, complete governance commit, `onboard-existing` in panel, Run 1 labels); **(proof)** the
> Verified-when external-repo live proof (billable, multi-agent, separate surface). Deploy auto-reload is
> delivered (ticket `0013`, run_179). **Drift Audit** was split to `drift-audit` and **archived 2026-06-21**.
> Vocabulary: "Takeover" → **Onboard (existing repo)** (ADR-0026); **`playbooks/` genre retired** (ADR-0032).
> Build history (runs 111–181) lives in `cocoder/SESSION_LOG.md` + git; this doc is current-state only.

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

**Disposition: `continue` (archive-blocked on founder action).** The entire code backlog (Atoms A–G) is now
landed and verified. Two non-code beats remain before archive, both founder-owned and off this build surface:
(1) the founder reset-and-retest of Job Hunt from clean, and (2) the Verified-when external-repo live proof
below.

### Founder-gated live proof (separate, after D–G + reset retest)
Onboard a real external repo (CoPublisher / a CoBuilder copy) end-to-end through the rebuilt Oscar-driven
flow: scaffold → multi-agent audit → founder ratifies the drafted Objectives → first ratified run lands,
with findings traceable to repo reality (Objective verification). This is **billable, multi-agent, founder-
authorized**, on a different launch surface than an ordinary build loop.

### Build-quality flaws to research and properly fix (run_181 retro)
Atoms D–G are correct and verified, but the run_181 self-audit surfaced design debt in the onboarding/scaffold
code that was scoped-out at the time and must be **researched and properly fixed** (root cause, not band-aid)
before this priority is archive-clean. None blocks the founder reset-retest; each is a future build atom.

- **SSOT — two byte-identical copies of the seeded priority templates (highest priority).** `onboard-existing.md`
  and `adhoc-session.md` exist twice: `templates/workspace-cocoder/cocoder/priorities/**` (what the scaffold
  seeds) and `packages/personas/base/priorities/**` (the shipped base, `basePrioritiesDir()`). Atom F kept them
  in sync with a **guard test** — a band-aid, not a fix. Proper fix: collapse to **one owner** (scaffold reads
  through from `base/priorities`, or one dir is generated from the other at build) so a single edit is
  impossible to half-apply. Research which copy is canonical and whether anything depends on both. *(Trips F4
  config-fragmentation / the elegance "one owner per concept" rule; mind F5 — prefer removing the duplication
  over keeping the checker.)*
- **`counters.json` split ownership.** Atom E commits `cocoder/counters.json` in the scaffold governance commit,
  but it is also in the runner's `PORTABLE_RUN_HISTORY_SCOPE` (run-history rewrites it every run). Two writers
  to one tracked file. Decide one owner / one intended lifecycle (seed-then-run-history-owns, or document the
  split deliberately) rather than leaving it incidental.
- **`commitMessage(run: string | RunDisplayInput)` compat shim (from Atom G).** The union overload was left so
  old string call-sites keep working; it is a footgun (pass a bare runId string → silently lose the
  per-root number). Migrate all callers to `RunDisplayInput` and drop the string form.
- **No runnable proof for the D/E behavior.** There is no `scripts/proof-*.mjs` proving "git-init a non-git root
  → full-tree baseline commit + complete governance commit + clean status." Per F18, build one so this behavior
  has runnable proof instead of relying on the manual founder reset-retest. *(This also partly discharges the
  reset-retest gate.)*
- **Resolution prose triplicated (elegance, low).** Each atom's resolution is restated in the ticket body, the
  `tickets/INDEX.md` row, and this doc. INDEX-vs-body is the accepted slim-index convention; this doc could link
  the closed tickets instead of restating them.

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
