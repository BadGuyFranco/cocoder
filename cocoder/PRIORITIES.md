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
| [`v0.1-foundation`](./priorities/v0.1-foundation/README.md) | Ship CoCoder v0.1 — extraction, Oz MVP, docs, public publish | Active | Expand — **Sub-Playbook D activated**; D Solve next. Suite **335/335** (+ dashboard 8/8). | Bob + founder | **Next:** D Solve. B/C Refines parallel (founder). |
| [`v0.4-oz-control-plane`](./priorities/v0.4-oz-control-plane/README.md) | Oz control plane — chat command interface + run oversight; 5-nav UI per ADR-0008 | Active | **Design spec landed 2026-05-27** (`docs/oz-control-plane-design/`); ADR-0010 + build plan next. | Bob + founder | Sequencing vs v0.2/v0.3 — founder. |

## Draft

| Slug | Description | Status | Canon | Owner | Sequenced |
|---|---|---|---|---|---|
| [`v0.3-workspace-lifecycle`](./priorities/v0.3-workspace-lifecycle/README.md) | Onboard into new/existing projects, manage multi-root workspaces, secure project secrets — via Oz | Draft | — | Bob + founder | **Follow-on to v0.4** — engaged when v0.4 wires the Workspaces screen; v0.3 owns the capabilities (onboarding, secrets, greenfield/brownfield) the UI drives. ADR-0007 accepted. |

## Recently Archived

| Slug | Reason | Date |
|---|---|---|
| `v0.2-adapter-extensibility` | Founder decided not to pursue cloud/managed adapters in this roadmap. | 2026-05-27 |
| `v0.6-cocoder-ide` | Folded into v0.4 — the embedded Electron terminal is a later phase of the control plane, not a separate priority. | 2026-05-27 |

See [`priorities/zArchive/INDEX.md`](./priorities/zArchive/INDEX.md).

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
**Status:** Active — Refine. Sub-Playbook F Complete 2026-05-23. Sub-Playbook B Expand merged (PR #33 → `9bf2433`). Sub-Playbook C Expand complete 2026-05-23 (PRs #42–#47 → `f46dcff`). **Sub-Playbook D activated 2026-05-24** (Witness/Interrogate/Solve-target). B/C Refines parallel-tracked (founder). Suite **335/335** (+ oz-dashboard **8/8**). See [`priorities/v0.1-foundation/README.md`](./priorities/v0.1-foundation/README.md).

### [v0.3-workspace-lifecycle](./priorities/v0.3-workspace-lifecycle/README.md)
**Owner:** Bob + founder
**Summary:** Onboard CoCoder into new/existing projects, manage multi-root workspaces, and secure per-project secrets — all through Oz.
**What:** Six work items: (1) secure per-project API tokens **inside** the project's `cocoder/` repo folder (open ADR); (2) brownfield onboarding — build the `cocoder/` folder inside an existing repo and audit its architecture/process/env using multiple CLIs + sub-agents; (3) greenfield — scaffold a new product from scratch; (4) add/edit multi-root workspaces with a `description` (`Primary:`/`Helper:`) per folder so Oz picks the primary root vs helpers; (5) store `.code-workspace` files in `cocoder/local/` (decided, ADR-0007); (6) Oz as the control plane surfacing all of the above. CoCoder is always a root in every workspace.
**Status:** Draft — **follow-on to v0.4-oz-control-plane** (engaged when v0.4 wires the Workspaces screen / workspace management). v0.3 owns the under-the-hood capabilities the Workspaces UI drives: onboarding (greenfield/brownfield), per-project secrets, multi-root management. Near-term "Dogfood Loop Enablement" slice COMPLETE (Oscar-led loop wired + verified live); ADR-0007 accepted; `cocoder/local/CoCoder.code-workspace` landed. (v0.2 archived 2026-05-27 — the earlier "before v0.2" sequencing is moot.) See [`priorities/v0.3-workspace-lifecycle/README.md`](./priorities/v0.3-workspace-lifecycle/README.md).

### [v0.4-oz-control-plane](./priorities/v0.4-oz-control-plane/README.md)
**Owner:** Bob + founder
**Summary:** Turn Oz into a real operator control plane — a per-workspace, in-dashboard headless chatbot that is the primary command interface and the primary watcher/debugger for every run.
**What:** Build the Oz UI per [ADR-0008](./decisions/0008-oz-control-plane-architecture.md) (Dashboard with Oz chat + drag-reorder priorities + ad-hoc run launcher; Workspaces with primary/writable/read-only roots; CLIs with Test; Personas with CLI/model + sub-agent hierarchy + visible/headless; Runs list+detail; Settings) plus the Oz oversight/debugger mechanism. Screen/flow brief + design prompt in `docs/oz-design-brief.md`. Root roles per ADR-0007 (revised 2026-05-27).
**Status:** Active — **design spec landed 2026-05-27** at `docs/oz-control-plane-design/` (high-fidelity React prototype = source of truth for *what*; reference, not production). Next: ADR-0010 (pause/resume run primitive, `cocoder attach`, transcript streaming, persona-roster reconciliation incl. new "Doc", in-app update channels) → build plan → implement. Designer notes at [`priorities/v0.4-oz-control-plane/designer-notes.md`](./priorities/v0.4-oz-control-plane/designer-notes.md). Embedded Electron terminal harness is the spec's deferred "v2" → v0.6. Authored 2026-05-27 per founder ask. See [`priorities/v0.4-oz-control-plane/README.md`](./priorities/v0.4-oz-control-plane/README.md).
