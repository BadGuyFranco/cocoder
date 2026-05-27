---
id: ADR-0012
title: "Persona write authority — Oscar owns governance/orchestration state"
status: accepted
date: 2026-05-27
relates-to: ADR-0002, ADR-0008, ADR-0009
---

# ADR-0012: Persona write authority

## Context

The lead orchestrator (Oscar) ran as `canWrite: false`, and Bob (builder) was excluded from `cocoder/priorities/`, `cocoder/decisions/`, `PRIORITIES.md`, `SESSION_LOG.md`. So priority / plan / ADR / lifecycle docs were writable by **neither** persona — "founder/Oz-owned" by default. This contradicted the persona definitions (Oscar = priority/orchestration lead; Bob = architecture/ADRs for the build) and blocked the orchestrator from its own lifecycle work.

The `m2ivp19j` run made it concrete: Oscar correctly recognized a priority drift, got founder approval to archive `v0.1-foundation` (engineering-complete) and fold the deferred release work into v0.4, and produced a fold plan — then **could not execute** (archive the priority, flip status, update `PRIORITIES.md`, author the closeout ADR) because every target was outside his (empty) write boundary. He correctly refused and asked for a write-enabled boundary.

## Decision

1. **Oscar is the governance / orchestration-state writer — always-on.** Oscar's lane is `canWrite: true` with a write boundary covering: `cocoder/PRIORITIES.md`, `cocoder/SESSION_LOG.md`, `cocoder/SESSION_LOG_ARCHIVE.md`, `cocoder/priorities/`, `cocoder/plans/`, `cocoder/tickets/`, `cocoder/decisions/`.
2. **Full authority, including ADRs.** Oscar may add/update/archive priorities, edit plans, manage tickets + the session log, and author ADRs — **including marking them `accepted`**. Oscar records decisions; high-stakes acts (archiving, accepting an ADR) are taken on explicit founder approval in-session, as `m2ivp19j` demonstrated.
3. **Bob is unchanged — the code/product writer** (`packages/`, `docs/`, `templates/`, config dirs), excluded from governance docs. Clean split: **Oscar = orchestration state; Bob = the build.**
4. **Two-layer enforcement stands.** A write requires BOTH the profile lane (`canWrite` + `writeBoundary`) AND the per-priority boundary `writerLanes` entry. Oscar's governance scope was added to both: the `cocoder-oscar` profile and every `oscar-lead` priority boundary gained an `oscar` writer lane.

## Consequences

- Future Oscar runs execute orchestration lifecycle work directly — the v0.1 closeout Oscar teed up in `m2ivp19j` can now run write-enabled.
- **Increased autonomous-lead blast radius:** an Oscar run can now edit the roadmap and ADRs. Mitigations: writes are bounded to governance docs (never code); every change is in git history for founder review; the "forbidden decisions" guardrails still apply (Oscar records decisions, does not invent priority/architecture direction); and `write-boundaries.md` makes Oscar follow the resolved boundary and stop-and-report on overreach.
- The orchestration services ([ADR-0009](./0009-orchestration-services.md): `wrap-execution`, `handoff-compaction`) remain the future optimization — Oscar can delegate the *mechanical* governance edits to a cheap bounded model instead of spending lead context, once they are wired into Oscar's live flow (v0.5).
- `write-boundaries.md` and `session-wrap.md` needed no change — both already reference the runtime-resolved boundary.

## Alternatives considered

- **Opt-in write-enabled Oscar profile** (default read-only; a separate write-enabled profile for closeout) — rejected; founder chose always-on for simplicity (solo dogfood; founder reviews all writes).
- **Read-only Oscar + delegate all governance writes to services** — deferred; services aren't wired into Oscar's live flow yet (v0.5).
- **ADRs gated proposed→accepted** (founder flips to accepted) — rejected; founder chose full authority including accept.
- **Widen Bob to governance/ADRs too** — rejected; keep the Oscar = governance / Bob = code split crisp.

## Numbering note

Authored on the `oz-control-plane-design` branch. ADR-0009 (orchestration services) lives on the `orchestration-services-import` branch (PR #50); ADR-0010 (Oz control-plane build) and ADR-0011 (v0.1 closeout) are reserved/pending (see the v0.4 priority README + the `m2ivp19j` run). Numbering reconciles at merge.
