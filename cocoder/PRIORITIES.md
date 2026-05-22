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
| [`v0.1-foundation`](./priorities/v0.1-foundation/README.md) | Ship CoCoder v0.1 — extraction, Oz MVP, docs, public publish | Active | Refine — Sub-Playbook E proven; 4 of 12 audit §4 ports closed (E2.2e.1–E2.2e.4) via the orchestration loop; 110/110 tests; reproducibility proven across 4 distinct autonomous runs; 5 core bugs + 1 audit finding fixed/documented. Sub-Playbook A audit-remediation still mid-Refine. | Bob | **Next:** Founder decision on git initialization (no `.git` at this mount), then E2.2e.5 `launch.test.mjs` (the "largest single port" — 52 tests; founder supervision recommended) or start Sub-Playbook B. Remaining M4 free-wins don't block. |

## Draft

*(none — propose new priorities here before activating)*

## Recently Archived

*(none yet — see `priorities/zArchive/INDEX.md` once populated)*

---

## Parser-readable priority entries

> The slim table above is the human-readable index. The headings below feed `extractPriorityEntry()` (the orchestration launch-time priority scanner in `packages/core/lib/fs-utils.mjs`), which matches `## [slug]` headings, not table rows. Update both this section and the table together (per the SSOT rule in `AGENTS.md`).

### [v0.1-foundation](./priorities/v0.1-foundation/README.md)
**Owner:** Bob
**Summary:** Ship CoCoder v0.1 — extraction, Oz MVP, docs, public publish.
**What:** Master priority covering Sub-Playbooks A (foundation + config survival), E (dogfood ramp), B (personas + workspace template), C (Oz MVP), D (docs + dogfood + publish). Currently mid-Refine on A (Milestone M4 audit remediation) with E mid-Expand (Talia orchestration ramp).
**Active task (Sub-Playbook A audit §4 port-first list E2.2e.5, via Sub-Playbook E's proven orchestration loop):** Talia ports `launch.test.mjs` from CoBuilder into `packages/core/tests/launch.test.mjs`. E2.2e.1 (`core.test.mjs`), E2.2e.2 (`dispatch.test.mjs`), E2.2e.3 (`adapters.test.mjs`), and E2.2e.4 (`composition.test.mjs`) closed 2026-05-22; this is the next + the "largest single port" per audit (52 upstream tests covering dry-run, add-lanes, send-message/stdin, stop-run, finalizer, tmux quotes). Audit recommended pairing with M4.3 CLI path rename, which is done. **Founder supervision recommended for this one due to size and orchestration-internal coverage.** **Source:** `/Volumes/NAS LOCAL/CoBuilder/infrastructure/cobuilder-build/orchestration/tests/launch.test.mjs`. **Target:** `packages/core/tests/launch.test.mjs`. **Allowed write zone:** `packages/core/tests/**` only. **Translation rules:** swap CoBuilder paths (`cobuilder-build/orchestration/`) for CoCoder paths (`packages/core/`); preserve test names + assertions verbatim; use `node:test` + `node:assert/strict`. If a test depends on git state, wrap it in a temporary git fixture under `packages/core/tests/` the same way `core.test.mjs` does. Pay attention to tests that reference the codex sandbox flag (Bug E was fixed today; lead lanes now get `danger-full-access`); the test should reflect that lane-role gating. Do NOT port tests the audit listed as "do not port". **Schemas-dist mtime caveat** still applies (`PORT-NOTES.md` finding F). **Done = `pnpm -F core test launch` green; no mutation outside `packages/core/tests/`.**
**Status:** Active — Refine. Sub-Playbook A Milestone M4 founder-gated tasks (M4.22–M4.27) complete 2026-05-22. **Sub-Playbook E E3.3 + Refine BOTH PASSED 2026-05-22** — Talia autonomously ported `core.test.mjs` (E2.2e.1, ~13 min) AND `dispatch.test.mjs` (E2.2e.2, ~7 min) under multi-lane orchestration in two distinct runs; Bob accepted both with independent audits; 86/86 tests pass; reproducibility proven; 5 core bugs surfaced + fixed end-to-end. Sub-Playbook E effectively complete (Final Check checklist 5/6 with last item deferred to Sub-Playbook B). See [`priorities/v0.1-foundation/README.md`](./priorities/v0.1-foundation/README.md).
