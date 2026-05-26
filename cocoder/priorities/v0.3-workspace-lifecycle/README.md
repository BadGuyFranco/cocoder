# v0.3 — Workspace Lifecycle & Onboarding

**Status:** Draft
**Owner:** Bob + founder
**Sequencing:** DECIDED (2026-05-26) — **v0.3 runs before `v0.2-adapter-extensibility`.** Rationale: the dogfood loop (Oz actually driving an Oscar/Bob session) is the proof-of-life the whole product rests on; cloud/managed adapters are additive and non-blocking, and the near-term adapter want (cursor-agent) already shipped. Depends on the Sub-Playbook C Oz dashboard as the surface for this work.

## Near-term: Dogfood Loop Enablement (do FIRST)

Smallest slice that makes "CoCoder on itself" real — launch Oz → pick the CoCoder workspace → pick a priority → spawn an Oscar/Bob session. Three concrete gaps (see also the Oz MVP finish in v0.1 Sub-Playbook C):

1. **Wire the daemon launch path (stub → real).** `packages/oz-daemon/src/cli.ts` starts `startOzDaemon` without `launchExecutable`/`stopExecutable`, so `POST /runs` is a stub. Pass the resolved `cocoder` bin + argv prefix + stop executable so the dashboard Launch button actually spawns `cocoder launch`. (Plumbing already exists in `server.ts`; only the entrypoint is unwired.)
2. **Author an Oscar-led route + profile + priority-boundary.** Today only `dogfood-port-tests` (lead=bob) exists. Add an `oscar-lead` route (lead=oscar, teammates=[bob]) + matching profile (the dogfood profile already stubs all 11 lanes) + a priority boundary so the loop produces a real Oscar→Bob dispatch session.
3. **Register the CoCoder dogfood workspace.** `local/workspaces.json` is empty; `cocoder oz register --id cocoder --workspace-root <CoCoder>` (the ADR-0006-allowed install-as-its-own-workspace dogfood case).

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
