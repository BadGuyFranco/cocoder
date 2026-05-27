# v0.3 — Workspace Lifecycle & Onboarding

**Status:** Draft
**Owner:** Bob + founder
**Sequencing:** DECIDED (2026-05-26) — **v0.3 runs before `v0.2-adapter-extensibility`.** Rationale: the dogfood loop (Oz actually driving an Oscar/Bob session) is the proof-of-life the whole product rests on; cloud/managed adapters are additive and non-blocking, and the near-term adapter want (cursor-agent) already shipped. Depends on the Sub-Playbook C Oz dashboard as the surface for this work.

## Near-term: Dogfood Loop Enablement — ✅ COMPLETE (2026-05-26)

The slice that made "CoCoder on itself" real is done and verified live (launch Oz → pick the CoCoder workspace → pick a priority → spawn an Oscar/Bob session):

1. ✅ **Daemon launch path wired** — `packages/oz-daemon/src/cli.ts` resolves the `cocoder` bin and passes `launchExecutable`/`stopExecutable`; `POST /runs` spawns a real launch (`launchWired:true`). Regression-guarded by `launch-bin.test.ts`.
2. ✅ **Oscar-led route + profile + boundary** — `routes/oscar-lead.json`, `profiles/cocoder-oscar.profile.json`, `priority-boundaries/v0.3-workspace-lifecycle.boundary.json`; added to Oscar/Bob allowlists.
3. ✅ **CoCoder dogfood workspace registered** (`id: cocoder`, socket `cocoder-cocoder`).

Verified live: a real Oscar/Bob session ran, returned a correct `NEEDS_FOUNDER`, and the dogfood caught a real PRIORITIES.md drift (since fixed). Bob's writer boundary has since been widened to the v0.3 implementation surfaces.

## Completed atoms

- ✅ **WS-DESC-1** — optional `description` on the workspace **registry** entry schema (ADR-0007), with tests. Built autonomously by the dogfood (run-20260526T234112Z) and merged.

## Next atom

**Recommended next atom:** `WS-DESC-2` — surface the `description` field in the Oz **workspace-list API** so clients (and the dashboard) can read each root's Primary/Helper role.

- **Scope (Bob, in-boundary):** carry `description` from the registry entry through to the workspace response. Add `description` (optional) to the workspace response/list schema in `packages/schemas/src/`, and include it in the daemon's `GET /workspaces` payload in `packages/oz-daemon/src/workspaces.ts` (read from the registry entry). Add/extend tests covering an entry with and without a description.
- **Out of scope (later atom):** rendering `description` on the dashboard Workspaces page (`WS-DESC-3`).
- **Acceptance:** schemas + oz-daemon test suites pass; `GET /workspaces` returns `description` when the registry entry has one and omits/undefined when it doesn't; backward-compatible.
- **Boundary:** `packages/` only for this atom. Governance docs (priorities/decisions/PRIORITIES.md) stay founder/Oscar-owned.

## Summary

Make CoCoder able to **start working on real projects** — initialize itself into a new or existing repo, manage the multi-root workspaces Oz orchestrates, and secure per-project secrets — with Oz as the control plane for all of it.

## Why now

v0.1 ships the engine and the dogfood. To be useful on a user's own product, CoCoder needs a first-class way to (a) attach to an existing codebase or scaffold a new one, (b) describe the set of roots it works across, and (c) hold that project's credentials safely. The founder surfaced these on 2026-05-26; the first concrete artifact (the CoCoder workspace file + `description` convention) already landed (see [ADR-0007](../../decisions/0007-workspace-files-and-multiroot-description.md)).

## Work items

1. **Project secret security** *(open decision)* — Secure per-project API tokens **inside the project's `cocoder/` repo folder**, appropriately protected (gitignore + encryption-at-rest and/or OS keychain handoff — TBD). Distinct from the CoCoder-install secrets at `<CoCoder>/local/secrets/`. Needs an ADR once the mechanism is chosen. Constraint from founder: tokens live inside the repo folder, never outside it.

2. **Brownfield onboarding** — Construct the `cocoder/` meta-project folder inside an *existing* project and **audit the repo** to seed it: pull in existing code architecture, build/test process, conventions, and `.env`/secret inventory. The audit runs **multiple CLIs and sub-agents in parallel** (e.g. codex + cursor-agent + claude as adapters) to cross-read the codebase. Extends v0.1 Sub-Playbook B's `cocoder init` and the existing `audit-workspace` / `refresh-memory` core commands.

3. **Greenfield scaffold** — Craft a **new product from scratch**: scaffold repo, `cocoder/` meta-project, initial priorities/personas/profile/route, and a starter workspace file — then hand off to Oscar/Bob to build.

4. **Multi-root workspace management** — Add/edit multi-root workspaces via Oz. Each `folders[]` entry carries a `description` (`Primary:`/`Helper:` convention per [ADR-0007](../../decisions/0007-workspace-files-and-multiroot-description.md)) so Oz knows the primary project vs helper roots. CoCoder is always a root. Plumb `description`/role into the workspace **registry** (`packages/schemas/src/workspaces-registry.ts` already `.passthrough()`es unknown keys) and the daemon/dashboard.

5. **Workspace file storage** *(decided — ADR-0007)* — `.code-workspace` files live in `<CoCoder>/cocoder/local/` (gitignored, per-machine). First instance shipped: `cocoder/local/CoCoder.code-workspace`. Remaining: registry sync + create/edit flow.

6. **Oz as control plane** — Items 2–5 are all surfaced and driven through Oz (daemon + dashboard): onboarding wizards, workspace add/edit, registry, and per-project secret status. Oz's importance rises sharply with this priority; treat Oz dashboard/daemon capacity as the gating dependency.

## Decisions / ADRs

- [ADR-0007](../../decisions/0007-workspace-files-and-multiroot-description.md) — workspace file location + multi-root `description` convention *(accepted)*.
- *Pending:* project-secret security mechanism (item 1).

## Open questions

- Secret mechanism for item 1: gitignored plaintext vs encrypted-at-rest vs OS keychain reference? (Founder constraint: inside the repo folder.)
- Sequencing vs `v0.2-adapter-extensibility` — which v0.x ships first?
- Does brownfield audit reuse the existing `audit-workspace`/`refresh-memory` commands, or need a richer multi-adapter audit orchestration?
