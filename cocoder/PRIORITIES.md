# Priorities — CoCoder Meta-Project

Slim index of active and archived priorities. Open a priority's folder for detail.

**Conventions:**

- One row per priority. Keep description ≤80 chars.
- Status: `Draft | Active | Paused | Complete | Cancelled`
- Canon: `Witness | Interrogate | Solve | Expand | Refine | Final Check | Complete`
- Owner: persona or human responsible for next action
- Blocked-on: optional column when active work is gated on an upstream decision/event
- Archived priorities move to `priorities/zArchive/` and their row drops here (kept in `zArchive/INDEX.md`)

## Active

| Slug | Description | Status | Canon | Owner | Blocked on |
|---|---|---|---|---|---|
| [`v0.1-foundation`](./priorities/v0.1-foundation/README.md) | Ship CoCoder v0.1 — extraction, Oz MVP, docs, public publish | Active | Refine — Sub-Playbook E proven (5 of 12 audit §4 ports closed; `launch.test.mjs` landed PR #3 with 4 product-code fixes; 165/165 tests; 5 core bugs fixed end-to-end); repo published at `BadGuyFranco/cocoder` (public, branch-protected, community-standards 100%). Sub-Playbook A audit-remediation still mid-Refine. | Bob | **Next:** E2.2e.6 `orchestrator-commit.test.mjs` (next audit §4 port; 708 source lines; auto-merge eligible since `launch.test.mjs` proved the loop). Then chain E2.2e.7–E2.2e.12. Sub-Playbook B (workspace template + `cocoder init`) unblocks once the port set is closed. |

## Draft

| Slug | Description | Status | Canon | Owner | Sequenced |
|---|---|---|---|---|---|
| [`v0.2-adapter-extensibility`](./priorities/v0.2-adapter-extensibility/README.md) | Beyond local CLI models — cloud APIs (Anthropic Messages, Kimi K2.6), managed sessions (Cursor SDK), etc. | Draft | — | Bob + founder | After v0.1-foundation Complete (depends on Sub-Playbook C Oz dashboard for non-pane lane visibility). Authored 2026-05-22 mid-session per founder ask about adding new model adapters. |

## Recently Archived

*(none yet — see `priorities/zArchive/INDEX.md` once populated)*

---

## Parser-readable priority entries

> The slim table above is the human-readable index. The headings below feed `extractPriorityEntry()` (the orchestration launch-time priority scanner in `packages/core/lib/fs-utils.mjs`), which matches `## [slug]` headings, not table rows. Update both this section and the table together (per the SSOT rule in `AGENTS.md`).

### [v0.1-foundation](./priorities/v0.1-foundation/README.md)
**Owner:** Bob
**Summary:** Ship CoCoder v0.1 — extraction, Oz MVP, docs, public publish.
**What:** Master priority covering Sub-Playbooks A (foundation + config survival), E (dogfood ramp), B (personas + workspace template), C (Oz MVP), D (docs + dogfood + publish). Currently mid-Refine on A (Milestone M4 audit remediation) with E mid-Expand (Talia orchestration ramp).
**Active task (Sub-Playbook A audit §4 port-first list E2.2e.8, via Sub-Playbook E's proven orchestration loop):** Talia ports `flows.test.mjs` from CoBuilder into `packages/core/tests/flows.test.mjs`. E2.2e.1–E2.2e.7 closed 2026-05-22. Full suite is now 200/200. This is the next file per audit order. **Source:** `/Volumes/NAS LOCAL/CoBuilder/infrastructure/cobuilder-build/orchestration/tests/flows.test.mjs` (287 lines). **Target:** `packages/core/tests/flows.test.mjs`. **Allowed write zone:** `packages/core/tests/**` only. **Translation rules:** swap CoBuilder paths (`cobuilder-build/orchestration/`) for CoCoder paths (`packages/core/`); preserve test names + assertions verbatim; use `node:test` + `node:assert/strict`. If a test depends on git state, wrap it in a temporary git fixture under `packages/core/tests/` the same way `core.test.mjs` does. **Coverage focus:** phase transitions, write-boundary violations, closeout gates. **Schemas-dist mtime caveat** still applies (`PORT-NOTES.md` finding F). **Done = `pnpm -F core test flows` green; no mutation outside `packages/core/tests/`.**
**Status:** Active — Refine. Sub-Playbook A Milestone M4 founder-gated tasks (M4.22–M4.27) complete 2026-05-22. **Sub-Playbook E proven end-to-end 2026-05-22**: 5 of 12 audit §4 ports closed via the autonomous orchestration loop (E2.2e.1 `core.test.mjs`, E2.2e.2 `dispatch.test.mjs`, E2.2e.3 `adapters.test.mjs`, E2.2e.4 `composition.test.mjs`, E2.2e.5 `launch.test.mjs` — the last one surfaced + fixed 4 product-code bugs via PR #3); 165/165 tests pass; reproducibility proven across 5 distinct autonomous runs; 5 core bugs surfaced + fixed end-to-end. Sub-Playbook E effectively complete (Final Check 5/6 with last item deferred to Sub-Playbook B). Repo published at `BadGuyFranco/cocoder` (public, Apache-2.0, branch-protected). See [`priorities/v0.1-foundation/README.md`](./priorities/v0.1-foundation/README.md).

### [v0.2-adapter-extensibility](./priorities/v0.2-adapter-extensibility/README.md)
**Owner:** Bob + founder
**Summary:** Beyond local CLI models — add adapter kinds for cloud APIs and managed remote sessions.
**What:** Extend the adapter system from a single `kind: llm-cli` shape (local tmux-driven CLI) to a richer enum (`llm-cli`, `llm-api`, `llm-managed-session`, `script`) with per-kind runner contracts. Motivating examples: Cursor SDK Background Agents, cloud Kimi K2.6 over HTTP, Anthropic Messages API. Personas, routes, write boundaries, and the `job-result` contract stay unchanged.
**Status:** Draft. Sequenced after v0.1-foundation Complete (depends on Sub-Playbook C Oz dashboard for non-pane lane visibility). Authored 2026-05-22 mid-session per founder ask. See [`priorities/v0.2-adapter-extensibility/README.md`](./priorities/v0.2-adapter-extensibility/README.md).
