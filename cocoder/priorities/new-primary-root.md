---
id: new-primary-root
title: "Onboard a primary root — New Primary + Onboard-existing (ADR-0020/0026)"
---

> **Refreshed 2026-06-22 (run_177).** The onboarding *machinery* is built; the original non-git defect chain is
> fixed in code — fail-fast preflight (920abe30), scaffold-time local `git init` (817d2e3f), and the
> panel-display fix (Atom C, 528f51f2). **The first real live onboarding (Job Hunt / run_178, 2026-06-22) then
> succeeded** (git-init ran, governance committed `2ef1de1` on `main`, `onboard-existing` showed + launched) and
> surfaced **four new code issues → Atoms D–G** (tickets 0025–0028; see "first live-onboarding reassessment"
> below). So the remaining work is BOTH code and founder/deploy beats: **(code)** Atoms D–G — Surface-B, need a
> verified build run; **(deploy)** the daemon must run post-fix code — ticket `0013`, **being fixed by the
> founder now (2026-06-22) in a separate session**; **(founder)** after D–G land + daemon current, reset-and-
> retest `job-hunt` from clean; **(proof)** the founder-gated live proof on a real external repo (billable,
> multi-agent, separate surface). The
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

### Build atoms — non-git primary root (DONE in code, run_176)
Both atoms committed; no further buildable backlog for this defect.

- **Atom A — fail-fast preflight guard (DONE, 920abe30).** Non-git primary roots are refused at launch
  preflight with a clear founder message before any run starts; `runner.test.ts` covers it.
- **Atom B — scaffold initializes local git (DONE, 817d2e3f).** **Add Workspace** on a non-git root runs local
  `git init -b main` (no remote), create-only root `.gitignore`, and commits the scaffolded `cocoder/` zone via
  the spine; existing git roots untouched. Daemon real-git tests prove `governanceCommitted` + branch `main`.

**Deployment gap (why `job-hunt` still failed):** the running daemon booted at SHA `1a2b68d`, *before* Atoms
A/B landed, so it ran the old workspace-create path: `git init` never ran, governance never committed
(`governanceCommitted:false`, "not a git repository" in `local/oz-audit.log`). The code fix is correct but
will only take effect once the daemon is rebuilt + restarted on a post-`817d2e3f` SHA. This is the recurring
"committed fix not deployed" pain — tracked by ticket `0013` (daemon auto-rebuild after runs); strengthen
that ticket rather than re-patching here.

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

**Live acceptance (founder, after daemon rebuild):** unit proof covers the render/refresh path; Add Workspace
end-to-end on a non-git root still requires a post-fix daemon. Reset `job-hunt` — delete its `cocoder/`
folder, remove the workspace from CoCoder, re-add via **Add Workspace** — and confirm `git init`, governance
commit, and `onboard-existing` in the panel.

### Build atoms — first live-onboarding reassessment (NEW, run_177, from Job Hunt / run_178)
The first real non-git onboarding (Job Hunt) surfaced four issues. Each is ticketed; each atom is a normal
one-shot delegated to Bob with a verify gate. Suggested order: D and E first (commit correctness — they
make every onboarded repo sound), then F (template), then G (numbering).

- **Atom D — baseline-commit the full existing tree on git-init ([ticket 0025](../tickets/open/0025-git-init-baseline-commit-full-tree.md), bug).**
  When `createWorkspace` itself git-inits a non-git primary root, commit the user's whole existing tree
  (`git add -A`, honoring the seeded `.gitignore`) so git tracks the repo from a clean baseline — not just
  the `cocoder/` zone. Do NOT re-baseline an already-git repo. Owner: `packages/daemon/src/routes.ts:748-763`.
  Acceptance: non-git onboard tracks product files (excludes `node_modules/` etc.), already-git onboard
  unchanged; daemon real-git test. *(This corrects the run_177 mis-call that leaving the tree untracked was
  acceptable: the `cocoder/**` trust boundary limits what CoCoder MODIFIES, not what git TRACKS.)*
- **Atom E — complete the scaffold governance commit list ([ticket 0026](../tickets/open/0026-scaffold-governance-commit-incomplete.md), bug).**
  The governance commit omits `cocoder/workspace.json` and `cocoder/counters.json` that the scaffold writes;
  include every scaffold-written `cocoder/**` file in the commit (or explicitly `.gitignore` true runtime
  churn). Applies to both new-primary and onboard-existing paths. Owner: `routes.ts:752-763` +
  `scaffoldWorkspaceGovernance`. Acceptance: no untracked scaffold-written `cocoder/**` after create; test
  pins commit-set == written-set − ignored-set.
- **Atom F — onboarding template supports content/ops repos ([ticket 0027](../tickets/open/0027-onboard-existing-template-supports-content-ops-repos.md), task).**
  Generalize `templates/workspace-cocoder/cocoder/priorities/onboard-existing.md` so a non-code repo
  (content/ops/docs) is a first-class target: subsystem typing (code vs content/ops) made explicit, evidence
  rule generalized from "file:line" to "path (and line where it applies)". The live Oscar already adapted to
  Job Hunt; this bakes that into the template. No regression for code repos.
- **Atom G — founder-facing run numbering is per-root, not global ([ticket 0028](../tickets/open/0028-founder-facing-run-number-per-root-not-global.md), bug).**
  Founder-facing surfaces show the global `run_178`; they should show the per-root `displayNumber` (#1). The
  UI run row already does (`adapter.ts:238-239`); fix the leaks in `record.ts:27`, `runner.ts:940/1078/1122`
  (commit trailers), `oz-chat.ts:401/412`, `oz-host.ts:404`, `oz-context-pointer.ts:90`. Keep `run_${seq}` as
  the internal unique key. Acceptance: a fresh root's first run reads as #1 everywhere the founder sees it.

**Founder note (run_177):** the founder is NOT continuing run_178 and will **reset Job Hunt for a brand-new
onboarding test once Atoms D–G land** (delete its `cocoder/` + the workspace, re-add via Add Workspace). The
recon question in run_178 is intentionally left unanswered. These atoms touch `packages/**` product code, so
they are **Surface-B** and require a verified build run (not post-wrap support) — launch this priority as a
build run to execute D–G.

**Disposition: `continue`.** Build backlog re-opened with Atoms D–G (Surface-B, from the first live
onboarding); archive blocked until D–G land, the founder reset-and-retest of Job Hunt passes, and the
Verified-when external-repo live proof completes.

### Founder-gated live proof (separate, after D–G + reset retest)
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
