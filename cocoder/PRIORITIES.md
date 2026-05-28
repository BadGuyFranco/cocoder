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
| [`v0.5-orchestration-services`](./priorities/v0.5-orchestration-services/README.md) | Cheap/fast-model admin delegation — Oscar offloads wrap/compaction/teardown to bounded services | **Active** | Adoption — service runtime slice committed; closeout authority fixed | Bob + founder | **Sequenced before v0.4** (founder 2026-05-27). Next: prove real `cursor-agent` service execution or fix auth; then Phase 2 PR #51 governance reconciliation. |

## Draft

| Slug | Description | Status | Canon | Owner | Sequenced |
|---|---|---|---|---|---|
| [`v0.2-adapter-extensibility`](./priorities/v0.2-adapter-extensibility/README.md) | Beyond local CLI models — cloud APIs (Anthropic Messages, Kimi K2.6), managed sessions (Cursor SDK), etc. | Draft | — | Bob + founder | After v0.1-foundation Complete **and now after v0.3-workspace-lifecycle** (2026-05-26 resequence). Depends on Sub-Playbook C Oz dashboard. Authored 2026-05-22 per founder ask. |
| [`v0.3-workspace-lifecycle`](./priorities/v0.3-workspace-lifecycle/README.md) | Onboard into new/existing projects, manage multi-root workspaces, secure project secrets — via Oz | Draft | — | Bob + founder | **Sequenced before v0.2** (2026-05-26). Near-term "Dogfood Loop Enablement" slice first. Depends on Oz dashboard (Sub-Playbook C). ADR-0007 accepted. |
| [`v0.4-oz-control-plane`](./priorities/v0.4-oz-control-plane/README.md) | Oz as a real control plane — in-app chat command interface + run oversight/debugger; UI per ADR-0008 | Draft | — | Bob + founder | Founder decision. Depends on the claude.ai/design output + ADR-0008. Stub authored 2026-05-27. |

## Recently Archived

| Slug | Disposition | Archived | Closeout |
|---|---|---|---|
| [`v0.1-foundation`](./priorities/zArchive/v0.1-foundation/README.md) | Complete — **`v0.1.0` shipped + tagged** | 2026-05-27 | [ADR-0011](./decisions/0011-v0.1-closeout.md) (Refine validations waived; validated by ship + founder real-use). Full list in [`priorities/zArchive/INDEX.md`](./priorities/zArchive/INDEX.md). |

---

## Parser-readable priority entries

> The slim table above is the human-readable index. The headings below feed `extractPriorityEntry()` (the orchestration launch-time priority scanner in `packages/core/lib/fs-utils.mjs`), which matches `## [slug]` headings, not table rows. Update both this section and the table together (per the SSOT rule in `AGENTS.md`).

### [v0.2-adapter-extensibility](./priorities/v0.2-adapter-extensibility/README.md)
**Owner:** Bob + founder
**Summary:** Beyond local CLI models — add adapter kinds for cloud APIs and managed remote sessions.
**What:** Extend the adapter system from a single `kind: llm-cli` shape (local tmux-driven CLI) to a richer enum (`llm-cli`, `llm-api`, `llm-managed-session`, `script`) with per-kind runner contracts. Motivating examples: Cursor SDK Background Agents, cloud Kimi K2.6 over HTTP, Anthropic Messages API. Personas, routes, write boundaries, and the `job-result` contract stay unchanged.
**Status:** Draft. Sequenced after v0.1-foundation Complete (depends on Sub-Playbook C Oz dashboard for non-pane lane visibility). Authored 2026-05-22 mid-session per founder ask. See [`priorities/v0.2-adapter-extensibility/README.md`](./priorities/v0.2-adapter-extensibility/README.md).

### [v0.3-workspace-lifecycle](./priorities/v0.3-workspace-lifecycle/README.md)
**Owner:** Bob + founder
**Summary:** Onboard CoCoder into new/existing projects, manage multi-root workspaces, and secure per-project secrets — all through Oz.
**What:** Six work items: (1) secure per-project API tokens **inside** the project's `cocoder/` repo folder (open ADR); (2) brownfield onboarding — build the `cocoder/` folder inside an existing repo and audit its architecture/process/env using multiple CLIs + sub-agents; (3) greenfield — scaffold a new product from scratch; (4) add/edit multi-root workspaces with a `description` (`Primary:`/`Helper:`) per folder so Oz picks the primary root vs helpers; (5) store `.code-workspace` files in `cocoder/local/` (decided, ADR-0007); (6) Oz as the control plane surfacing all of the above. CoCoder is always a root in every workspace.
**Status:** Draft. **Sequencing DECIDED 2026-05-26 — v0.3 runs before v0.2-adapter-extensibility** (near-term "Dogfood Loop Enablement" slice first). Depends on Sub-Playbook C Oz dashboard. Artifacts landed: `cocoder/local/CoCoder.code-workspace` + [ADR-0007](./decisions/0007-workspace-files-and-multiroot-description.md); Oscar-led dogfood loop wired + verified live. Authored 2026-05-26 per founder ask. See [`priorities/v0.3-workspace-lifecycle/README.md`](./priorities/v0.3-workspace-lifecycle/README.md).

### [v0.4-oz-control-plane](./priorities/v0.4-oz-control-plane/README.md)
**Owner:** Bob + founder
**Summary:** Turn Oz into a real operator control plane — a per-workspace, in-dashboard headless chatbot that is the primary command interface and the primary watcher/debugger for every run.
**What:** Build the Oz UI per [ADR-0008](./decisions/0008-oz-control-plane-architecture.md) (Dashboard with Oz chat + drag-reorder priorities + ad-hoc run launcher; Workspaces with primary/writable/read-only roots; CLIs with Test; Personas with CLI/model + sub-agent hierarchy + visible/headless; Runs list+detail; Settings) plus the Oz oversight/debugger mechanism. Screen/flow brief + design prompt in `docs/oz-design-brief.md`. Root roles per ADR-0007 (revised 2026-05-27).
**Status:** Draft (stub). Founder decision on sequencing. Depends on the claude.ai/design output + ADR-0008. Authored 2026-05-27 per founder ask. See [`priorities/v0.4-oz-control-plane/README.md`](./priorities/v0.4-oz-control-plane/README.md).

### [v0.5-orchestration-services](./priorities/v0.5-orchestration-services/README.md)
**Owner:** Bob + founder
**Summary:** Let Oscar run faster/cheaper models for repeatable admin work (priority/handoff editing, run wrap-up, teardown) via bounded non-persona orchestration services, instead of spending lead-model context.
**What:** Declarative services (`packages/core/services/*.json`) + two contracts + `lib/services.mjs` (build/validate/execute packet with deterministic git write-audit) + 5 CLI commands + a headless `cursor-agent-service` adapter. 11 services shipped. Services never commit/finalize/supersede (Oscar-only route control); adapter+model configurable per service (`cursor-agent` default). Oz unchanged (ADR-0008 preserved).
**Status:** **Active — engine + launch config landed on `main`; Phase 3 service runtime adoption slice is committed; Oscar closeout/commit authority is fixed.** Next: prove real headless `cursor-agent` service execution once local auth/keychain access works, then handle Phase 2 PR #51 governance reconciliation. (v0.1-foundation already archived 2026-05-27 — ADR-0011.) Full brief in [`priorities/v0.5-orchestration-services/README.md`](./priorities/v0.5-orchestration-services/README.md).
