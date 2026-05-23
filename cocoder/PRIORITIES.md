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
| [`v0.1-foundation`](./priorities/v0.1-foundation/README.md) | Ship CoCoder v0.1 — extraction, Oz MVP, docs, public publish | Active | Refine — Sub-Playbook A M4 Checkpoint REACHED 2026-05-23; Sub-Playbook E **Complete** 2026-05-23; **Sub-Playbook F Expand complete 2026-05-23** (FP-Q1=A, FP-Q2=B; FB-1/FB-2/FB-3 landed PR #28; F Refine ceremony pending); Sub-Playbook B Activated 2026-05-23 (W/I/S authored, PB-Q1..PB-Q4 awaiting founder; B Solve unblocked pending F Refine). Test suite **249/249 all-passing**; repo public at `BadGuyFranco/cocoder`. | Bob + founder | **Next:** F Refine ceremony (founder spot-check composer + 3 CLI commands). Then PB-Q1..PB-Q4 + B Solve. See [`priorities/v0.1-foundation/plans/2026-05-23-structural-cleanup.plan.md`](./priorities/v0.1-foundation/plans/2026-05-23-structural-cleanup.plan.md). |

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
**Active task (v0.1 Completion Plan — three remaining items to ship v0.1):** Audit §4 port-first list is CLOSED (12 of 12 ports landed 2026-05-22). Three remaining work items, bundled in [`plans/2026-05-23-v0.1-completion.plan.md`](./priorities/v0.1-foundation/plans/2026-05-23-v0.1-completion.plan.md):

1. **Resolve ticket 0001** — `.command` wrapper restore/retire decision. Cheapest: 10min (retire) or 1-2h (restore). Unblocks 6 skipped tests in `launch-command.test.mjs`.
2. **Sub-Playbook A M4 free-wins cleanup** — M4.5–M4.14 + M4.16–M4.21 (medium-priority audit findings; ~3-5h total). Clean v0.1 audit close.
3. **Sub-Playbook B activation** — Witness/Interrogate/Solve-target for adopter onboarding (workspace template + `cocoder init` + getting-started doc). Multi-session work; the marquee remaining v0.1 deliverable.

**Recommended next-session ordering:** Item 1 → Item 2 (in batches) → Item 3 (Witness/Interrogate only). The completion plan has an appendix with a verbatim resume prompt for fresh-session pickup. **Done = ticket 0001 closed, M4 free-wins all `[x]` or marked deferred-to-v0.2, Sub-Playbook B Witness populated + Status flipped to Active.**
**Status:** Active — Refine. Sub-Playbook F **Expand complete 2026-05-23** (FP-Q1=A, FP-Q2=B; FB-1/FB-2/FB-3; PR #28; suite **249/249**; F Refine ceremony pending). Sub-Playbook B Solve unblocked pending F Refine. Sub-Playbook A Milestone M4 founder-gated tasks (M4.22–M4.27) complete 2026-05-22. **Sub-Playbook E proven end-to-end 2026-05-22** … Repo published at `BadGuyFranco/cocoder` (public, Apache-2.0, branch-protected). See [`priorities/v0.1-foundation/README.md`](./priorities/v0.1-foundation/README.md).

### [v0.2-adapter-extensibility](./priorities/v0.2-adapter-extensibility/README.md)
**Owner:** Bob + founder
**Summary:** Beyond local CLI models — add adapter kinds for cloud APIs and managed remote sessions.
**What:** Extend the adapter system from a single `kind: llm-cli` shape (local tmux-driven CLI) to a richer enum (`llm-cli`, `llm-api`, `llm-managed-session`, `script`) with per-kind runner contracts. Motivating examples: Cursor SDK Background Agents, cloud Kimi K2.6 over HTTP, Anthropic Messages API. Personas, routes, write boundaries, and the `job-result` contract stay unchanged.
**Status:** Draft. Sequenced after v0.1-foundation Complete (depends on Sub-Playbook C Oz dashboard for non-pane lane visibility). Authored 2026-05-22 mid-session per founder ask. See [`priorities/v0.2-adapter-extensibility/README.md`](./priorities/v0.2-adapter-extensibility/README.md).
