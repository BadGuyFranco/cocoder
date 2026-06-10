# Pending Decisions — v0.1 Foundation

**Created:** 2026-05-22 | **Status:** Resolved 2026-05-22 — all 7 answered
**Source:** 2026-05-22 Foundation Audit — [`plans/2026-05-22-foundation-audit.md`](./plans/2026-05-22-foundation-audit.md)
**Parent priority:** [`./README.md`](./README.md)

> **Resume cue:** This file gates **Milestone M4 (Audit Remediation)** in Sub-Playbook A ([`plans/2026-05-21-foundation.plan.md`](./plans/2026-05-21-foundation.plan.md)). M4 tasks tagged `gates: Q#` must not start until the corresponding question is answered here. Free-of-decision M4 tasks (refresh checkboxes, root `.gitignore`, CLI path rename, branding scrub) can proceed in parallel.

## How this file works

- One section per question, stable ID (`Q1`–`Q7`).
- Each question carries: **Context**, **Audit references**, **Options**, **Recommendation** (with rationale), **Decision** (blank until founder answers).
- When founder answers:
  - For small operational calls: edit the **Decision** block inline, set status to "Answered YYYY-MM-DD", note the chosen option.
  - For architectural calls: also graduate the answer to a new ADR; record the ADR number here and route the question to that ADR.
- When **all** questions are Answered, this file's status becomes "Resolved" and M4 can run end-to-end.

## Status table

| ID | Question (short) | Status | Decision | Gates |
|---|---|---|---|---|
| [Q1](#q1--adr-0005-enforcement-scope) | ADR-0005 enforcement: A or C scope? | Answered 2026-05-22 | **Option B** (minimal `--developer-mode` belt) | B5, H4 |
| [Q2](#q2--config-set-zone-defaults) | `config set` zone defaults | Answered 2026-05-22 | **Option A** (install-local default; `--workspace-root` flag) | B6, H3 |
| [Q3](#q3--ephemeral-runs-gitignore-policy) | Runs/debug-runs gitignore policy | Answered 2026-05-22 | **Option A** (`local/workspaces/<slug>/runs/`) | H5 |
| [Q4](#q4--workspaces-inside-the-install-repo) | Workspaces inside install — allowed? | Answered 2026-05-22 | **Option A** → graduated to **ADR-0006** | B6, H7 |
| [Q5](#q5--verification-artifact-guard-ssot) | Verification-guard SSOT | Answered 2026-05-22 | **Option A** (inline in core; replace source-grep test with runtime fixture) | B9 |
| [Q6](#q6--stranger-test-cwd-assumption) | Stranger-test cwd assumption | Answered 2026-05-22 | **Option A** (user-app cwd required; `--cocoder-home` for install ops) | B6 |
| [Q7](#q7--sub-playbook-a-close-criteria) | A close criteria scope | Answered 2026-05-22 | **Option B** (Standard — free wins + workspace detection + Q1-B product belt) | M4 closure |

---

## Q1 — ADR-0005 enforcement scope

### Context

ADR-0005 defines five Oz improvement target zones (`cocoder-product`, `workspace-shared`, `workspace-local`, `install-local`, `upstream-candidate`) and gates `cocoder-product` behind developer-mode + dogfood-workspace detection. Today the routing exists as a Zod schema + JSON Schema artifact + documentation, with **zero runtime enforcement** and no detection logic. ADR-0005 Consequences explicitly assign Oz API + audit work to Sub-Playbook C.

Audit found that `packages/core/lib/orchestrator-commit.mjs` `DEFAULT_IMPLEMENTATION_SURFACES` already allows commits to `packages/`, `docs/`, `templates/`, `.github/workflows/`, root `package.json` (audit §B5). If a Bob lane runs with cwd = CoCoder install and orchestrator-commit enabled, product mutation is allowed by design with no zone gate.

### Audit references
B5, H4

### Options

| ID | Option | Pros | Cons |
|---|---|---|---|
| **A** | Strict deferral to Sub-Playbook C. No enforcement in A. | Smaller A scope; matches ADR-0005 Consequences. | Window of unsafe defaults during A→C gap; orchestration-from-install path is a hot risk. |
| **B** | Minimal deny-gate in A: require an explicit `--developer-mode` flag (or `COCODER_DEVELOPER_MODE=1` env) to permit any write under `packages/`, `templates/`, `docs/`. No taxonomy classification, no Oz integration, no audit log. Belt only. | Closes the orchestration-from-install hole now; cheap (~30 min); doesn't conflict with C's fuller implementation. | Founder-mode flag is on the honor system; not a substitute for the C-scope solution. |
| **C** | Full enforcement in A: implement classifier, detection, audit log. | Resolves H4 and B5 immediately. | Expands A by days; conflicts with original scope split. |

### Recommendation

**Option B.** The orchestration-from-install vector is real and a 30-minute belt closes it. C still owns the proper taxonomy + audit. Mark Q4 (workspaces-inside-install) related — combined fix in M4.

### Decision

```
Status: Answered 2026-05-22
Answered: 2026-05-22 (founder)
Option chosen: B (minimal --developer-mode deny-gate in Sub-Playbook A)
Notes: Belt-only; full taxonomy + audit-log enforcement remains Sub-Playbook C scope per ADR-0005 Consequences. Env var COCODER_DEVELOPER_MODE=1 accepted as equivalent.
Graduate to ADR? (yes/no): no — operates inside ADR-0005's existing taxonomy; M4.22 implementation note suffices.
```

---

## Q2 — `config set` zone defaults

### Context

`config set` today writes `<cwd>/local/config.yaml` (`config.mjs` only exposes `setInstallConfigValue`). E3.4 wording in the foundation plan says writes go to `<CoCoder>/local/config.yaml` — but the implementation uses `process.cwd()`, so the write actually depends on where the user runs the command from.

Audit found `config get` reads workspace overrides (`config.mjs:156-164`) but there is no writer for `<workspace>/cocoder/local/config.yaml`. So a user editing "workspace-level prefs" today silently can't.

### Audit references
B6, H3

### Options

| ID | Option | Pros | Cons |
|---|---|---|---|
| **A** | Bare `config set` → always install-local. Resolve install root via `findCocoderHome()`. Add `config set --workspace-root <path>` (or `--workspace <slug>`) for workspace-local writes. | Predictable; matches E3.4 wording; install-local is the more common case (account, model, default editor). | User who runs `config set` from inside a workspace might expect workspace-scope. |
| **B** | Bare `config set` → workspace-local if cwd is inside a workspace; else install-local. Explicit `--install` / `--workspace` flags override. | "Does the right thing by default" feel. | Hidden dependency on cwd; surprising when cwd happens to be a workspace by accident. |
| **C** | Bare `config set` is an error; require `--install` or `--workspace`. | Maximally explicit. | Worst ergonomics; trains users to alias the flag. |

### Recommendation

**Option A.** Install-local default matches E3.4 and matches the dominant use case (founder configuring API keys, models, themes). Workspace-local exists via `--workspace-root` for power users. Explicit `--install` flag also accepted as a no-op for clarity. This pairs naturally with Q6 (require user-app cwd for workspace ops).

### Decision

```
Status: Answered 2026-05-22
Answered: 2026-05-22 (founder)
Option chosen: A (bare `config set` always writes install-local via findCocoderHome(); --workspace-root flag for workspace-local writes)
Notes: Mirror --workspace-root onto `config set` to match the existing `config get` shape. Add setWorkspaceConfigValue() helper. Accept --install as a no-op alias for clarity. Document in docs/configuration.md.
Graduate to ADR? (yes/no): no — CLI ergonomics decision; documented in docs/configuration.md + foundation-plan M4.23.
```

---

## Q3 — Ephemeral runs gitignore policy

### Context

CLI default report and run paths write under `repoPath('cocoder/runs/...')` and `repoPath('cocoder/debug-runs/...')` (audit §H5). Root `.gitignore` only ignores `/local/`, not `cocoder/runs/` or `cocoder/debug-runs/`. When cwd = CoCoder dogfood, every check or run pollutes the tracked dogfood `cocoder/` tree.

`DEFAULT_RUNS_DIR` is also flat (`local/runs`) instead of the per-workspace `local/workspaces/[slug]/` that ARCHITECTURE.md L132-136 specifies.

### Audit references
H5, H6

### Options

| ID | Option | Pros | Cons |
|---|---|---|---|
| **A** | Move runs to install-local: `local/workspaces/<slug>/runs/` (matches ARCHITECTURE). Per-workspace. Requires workspace detection (Q4). | Matches the four-zone model exactly; runs naturally isolated per workspace; install-local already gitignored. | Requires workspace detection to be wired (which Q4 also wants). |
| **B** | Move runs to workspace-private: `<workspace>/cocoder/local/runs/`. Workspace owns its own run history. Add `runs/` to the inner `cocoder/local/.gitignore` allow-list... actually it's already covered by `*` ignore in `cocoder/local/.gitignore`. | Workspace contains its own state; great for portability between machines via sync of CoCoder install. | Run history doesn't survive when workspace is removed; multi-workspace summary harder for Oz. |
| **C** | Keep tracked under `cocoder/runs/` but redact secrets and treat as project history. | Run history visible to collaborators. | Pollutes tracked tree; not what ARCHITECTURE specifies; secret redaction is hard. |

### Recommendation

**Option A.** Matches ARCHITECTURE L132-136 directly. Per-workspace isolation aligns with the tmux namespace + multi-workspace concurrency model. Pairs with Q4 (workspace detection enabled). Also resolves H6 (per-workspace runs dir) in the same change.

### Decision

```
Status: Answered 2026-05-22
Answered: 2026-05-22 (founder)
Option chosen: A (move ephemeral runs to install-local: local/workspaces/<slug>/runs/)
Notes: Matches ARCHITECTURE.md L132-136 verbatim. DEFAULT_RUNS_DIR must resolve per workspace via the registry, not the flat `local/runs` constant. Closes H5 and H6 in the same M4.25 change.
Graduate to ADR? (yes/no): no — already specified in ARCHITECTURE.md; M4.25 implements the directive.
```

---

## Q4 — Workspaces inside the install repo

### Context

`findCocoderHome()` walks ancestors for `cocoder/AGENTS.md` + `ARCHITECTURE.md`. Any directory inside the CoCoder clone resolves home to the install root, regardless of nested workspace structures (audit §H7). This silently treats the CoCoder dogfood `cocoder/` as **the** workspace when cwd is anywhere under the CoCoder clone.

The dogfood case is real and works today — CoCoder is its own workspace. But it raises the question: should `cocoder init` ever succeed inside an existing CoCoder install? Should a nested workspace be detectable?

### Audit references
B6, H7

### Options

| ID | Option | Pros | Cons |
|---|---|---|---|
| **A** | Documented constraint: workspaces cannot be nested inside the CoCoder install repo. Detection uses ancestor walk only; if ancestor matches install, that's the (only) active workspace. | Simple model; matches dogfood; `cocoder init` refuses inside install. | Loses some flexibility; founder doing weird directory layouts gets bitten. |
| **B** | Support nested workspaces: detection is `--workspace=<slug>` → cwd ancestor walk for nested `cocoder/AGENTS.md` *without* `ARCHITECTURE.md` → install fallback. | Maximally flexible; supports "CoCoder install also contains a user app for testing" scenarios. | More complex detection; more edge cases; need to distinguish nested workspace from install dogfood. |
| **C** | Hybrid: registry-first. If `local/workspaces.json` has an entry whose path is an ancestor of cwd, that's the workspace. Otherwise fall back to ancestor walk. Disallow registering a workspace whose path is inside install. | Registry-driven (cleaner); explicit user intent; CoCoder install only ever resolves to dogfood unless explicitly added. | Requires registry to actually exist on disk (workspaces-registry schema is ready; `oz register` command is C scope). |

### Recommendation

**Option A** for v0.1. Document the constraint; `cocoder init` refuses inside install with a friendly error. Option C is the right long-term shape but depends on Sub-Playbook C (Oz daemon + workspace registry CLI). Document the upgrade path.

### Decision

```
Status: Answered 2026-05-22
Answered: 2026-05-22 (founder)
Option chosen: A (documented constraint: no workspaces nested inside the CoCoder install repo; cocoder init refuses with friendly error)
Notes: Founder directive — "be sure this is a well documented requirement." Implementation must (1) emit a friendly CLI error from `cocoder init` when cwd or --workspace-root resolves inside install, (2) document the constraint prominently in docs/configuration.md (and docs/getting-started.md once it lands in Sub-Playbook D), (3) document the upgrade path to Option C (registry-first) as a Sub-Playbook C deliverable. Graduated to ADR-0006 so the constraint is durable and discoverable.
Graduate to ADR? (yes/no): YES — ADR-0006 (No workspaces nested inside the CoCoder install repository).
```

---

## Q5 — Verification-artifact guard SSOT

### Context

CoBuilder enforces the verification-artifact write guard via a composable prompt fragment (`personas/prompts/shared/write-boundaries.md:6`), referenced from manifests. CoCoder inlined the same guard string directly into `packages/core/lib/launch.mjs:993`. CoCoder's only test is a source-grep (`orchestration-improvements.test.mjs`) that doesn't exercise behavior (audit §B9).

When Sub-Playbook B ports persona prompts, this guard will exist in two places unless one is canonical.

### Audit references
B9

### Options

| ID | Option | Pros | Cons |
|---|---|---|---|
| **A** | Inline in core (current state) is SSOT. When B ports prompt fragments, the verification-guard fragment is removed; prompts reference the inlined string via composition. | Behavior is testable from `packages/core` alone; no dependency on prompt fragments existing. | Diverges from CoBuilder's composition model; harder to override per-workspace. |
| **B** | Prompt fragment is SSOT. Port `write-boundaries.md` in B; remove the inline string in `launch.mjs`; loader assembles it. | Matches CoBuilder; supports per-workspace override. | Core can't test the guard in isolation; B-blocked. |
| **C** | Both: core ships an inline fallback; prompt fragment overrides when present. | Safest. | Two sources to maintain; SSOT violated. |

### Recommendation

**Option A** for v0.1. Inline keeps the guard testable from core alone; aligns with the "extract verbatim, no behavior change" extraction strategy. Revisit in v0.2 if per-workspace override becomes a real need. Replace the source-grep test with a runtime test that the guard string appears in generated launch prompts.

### Decision

```
Status: Answered 2026-05-22
Answered: 2026-05-22 (founder)
Option chosen: A (inline string in launch.mjs is SSOT for v0.1)
Notes: When Sub-Playbook B ports persona prompts, the prompts reference the inlined string via composition; the prompt-fragment SSOT path is deferred to v0.2 if per-workspace override becomes a real need. M4.26 replaces orchestration-improvements.test.mjs source-grep with a runtime test asserting the guard appears in generated launch prompts.
Graduate to ADR? (yes/no): no — extraction-strategy decision under ADR-0004; documented in M4.26 implementation note.
```

---

## Q6 — Stranger-test cwd assumption

### Context

Sub-Playbook D's stranger test (Refine gate) requires a new developer to onboard `cocoder init → cocoder launch` within 30 minutes. The audit found CLI defaults assume `process.cwd()` (audit §B6). Docs need to commit to a cwd model so the stranger doesn't get surprising behavior.

### Audit references
B6

### Options

| ID | Option | Pros | Cons |
|---|---|---|---|
| **A** | Docs require cwd = user app for all workspace operations. CoCoder install operations require `--cocoder-home` flag. | Predictable; matches Q2-A and Q4-A. | Requires user to remember the flag for install ops; CLI should print friendly errors when run from install with workspace intent. |
| **B** | CLI auto-detects: if cwd is inside a workspace, workspace ops default to that workspace; install ops require explicit `--install` flag. | Less typing. | Hidden cwd dependency surfaces in surprising ways. |
| **C** | All operations require either `--install` or `--workspace` explicitly; no cwd magic. | Maximally explicit. | Worst ergonomics. |

### Recommendation

**Option A.** Matches Q2-A, Q4-A. Stranger test docs read: "open a terminal in your project's root directory, then run `cocoder init`." Add a friendly CLI error: "running from CoCoder install but no workspace specified; pass `--workspace=<slug>` or `cd` into your project."

### Decision

```
Status: Answered 2026-05-22
Answered: 2026-05-22 (founder)
Option chosen: A (user-app cwd required for workspace ops; --cocoder-home flag for install ops)
Notes: Consistent with Q2-A and Q4-A. Stranger-test docs (Sub-Playbook D) read: "open a terminal in your project's root directory, then run `cocoder init`." M4.27 wires the friendly CLI error path. CoCoder dogfood case requires explicit --workspace-root per ADR-0006.
Graduate to ADR? (yes/no): no — UX/docs directive; reflected in M4.27, docs/configuration.md, and (in Sub-Playbook D) docs/getting-started.md.
```

---

## Q7 — Sub-Playbook A close criteria

### Context

The audit found 9 critical blockers, 15 high-risk gaps, 12 medium items. Many were originally in scope for A; some legitimately belong to B or C. This question scopes which M4 tasks block A closure versus which can be deferred.

### Audit references
M4 closure; gates everything

### Options

| ID | Option | A closes when... |
|---|---|---|
| **A** | Narrow: only test port (B4) + path fixes (B1, B6) + branding scrub (B3) + free wins. Defer workspace detection (H7) + minimal product gate (B5) to C. | Original A scope only. |
| **B** | Standard: A items above + workspace detection (H7) + Q1-Option-B minimal product gate (B5). The audit-driven additions that don't create a B/C dependency. | Sub-Playbook A delivers a CLI that is safe by default for normal adopters, even before B/C land. |
| **C** | Broad: everything in B + ADR-0005 full enforcement (Q1-Option-C). | A merges Oz-routing taxonomy work that was originally C. |

### Recommendation

**Option B.** Narrow A misses the "safe by default" property and ships a CLI with a known orchestration-from-install foot-gun. Broad A breaks the original split with C. Standard A closes the audit-discovered safety gaps without expanding into Oz daemon work. Estimated 1–2 sessions of remediation past today's E2.2e test port.

### Decision

```
Status: Answered 2026-05-22
Answered: 2026-05-22 (founder)
Option chosen: B (Standard — free wins + workspace detection H7 + minimal Q1-B product belt + the full M4.22-M4.27 set)
Notes: A closes when M4 Checkpoint is reached (all free-wins + all founder-gated tasks done or formally deferred). Sub-Playbook E remains a downstream Playbook with its own WISER cycle, not folded into A. Sub-Playbook C still owns the full ADR-0005 taxonomy + audit log per the original split.
Graduate to ADR? (yes/no): no — scope decision recorded in foundation.plan.md Decision Log + Master README.
```

---

## When all are answered

1. Update each section's **Status** and **Decision** block.
2. Update this file's top-line status to "Resolved YYYY-MM-DD".
3. Promote any "Graduate to ADR" decisions to numbered ADRs in `cocoder/decisions/`.
4. Reflect the chosen scope in `2026-05-21-foundation.plan.md` Milestone M4 task rows (un-gate or remove gated tasks).
5. Update `cocoder/PRIORITIES.md` Canon and "blocked on" note.
6. Add SESSION_LOG entry: "Pending decisions resolved; M4 unblocked."
