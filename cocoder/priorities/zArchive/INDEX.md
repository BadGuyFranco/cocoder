# Archived Priorities — Index

Two generations are archived here. **v1** (the folder-priorities + `PRIORITIES.md`) is frozen
reference — it used the route/`Owner`/`Canon` model the rebuild is escaping and is **not read by v2**;
its product *intent* feeds future v2 Playbooks as a recorded port (per the rebuild charter), not a
resurrection. **v2** completed flat Playbooks live under `v2/`. The live `priorities/` tree holds only
not-yet-complete v2 Playbooks (the directory listing is the index — ADR-0010).

## v2 — completed flat Playbooks (`v2/`)

| Slug | Disposition | Outcome |
|---|---|---|
| [`v2/mean-helper`](./v2/mean-helper.md) | Complete | `mean()` core helper — committed `0961a79` via a real Oscar→Bob run. |
| [`v2/phase1-dogfood`](./v2/phase1-dogfood.md) | Complete | `truncate()` core helper — committed `57c0781`; proved the Phase-1 spine end to end. |
| [`v2/objective-presence-gate`](./v2/objective-presence-gate.md) | Complete | Structural Objective presence-gate (ADR-0010 D3): `Priority.objective` parsed; `runRun` refuses a null Objective before any store write — committed `bc6c3e8`. Dogfood-caught: the run auto-committed without Oscar verifying, and the builder's diff had broken `@cocoder/daemon` tests; both fixed and the gap closed by the **Oscar verify-gate** ([ADR-0011](../../rebuild/decisions/0011-orchestrator-verify-gate.md)). |

## v1 — frozen reference (rebuild-superseded)

| Slug | Disposition | Archived | Outcome | Closeout |
|---|---|---|---|---|
| [`v0.1-foundation`](./v0.1-foundation/README.md) | Complete | 2026-05-27 | **CoCoder `v0.1.0` shipped + tagged** (public, CI green): `cocoder` CLI, Oz MVP, persona orchestration, workspace template, adopter docs, Apache-2.0, recursive dogfood. Sub-Playbooks A–F all landed. | [ADR-0011](../../decisions/0011-v0.1-closeout.md) — ship criteria met; Refine validations waived (validated by ship + founder real-use). |
| [`v0.2-adapter-extensibility`](./v0.2-adapter-extensibility/README.md) | Superseded (v1 Draft) | 2026-05-29 | Cloud/managed adapters beyond local CLI. Intent → future v2 adapter Playbook (cf. rebuild ADR-0006/0009). | Rebuild restart. |
| [`v0.3-workspace-lifecycle`](./v0.3-workspace-lifecycle/README.md) | Superseded (v1 Draft) | 2026-05-29 | Onboarding / multi-root workspaces / project secrets via Oz. Intent → future v2 onboarding Playbook (rebuild Phase 5). | Rebuild restart. |
| [`v0.4-oz-control-plane`](./v0.4-oz-control-plane/README.md) | Superseded (v1 Draft) | 2026-05-29 | Oz chat command interface + run oversight/debugger. Intent → deferred rebuild G1 (chat-command plane). | Rebuild restart. |
| [`v0.5-orchestration-services`](./v0.5-orchestration-services/README.md) | Superseded (v1 Active) | 2026-05-29 | Cheap-model admin delegation via bounded services + the `check-orchestration-fragmentation` guard (the F5 governance-of-governance the rebuild rejects). Intent → v2 Plays / cheap-tier sub-tasks (ADR-0005). | Rebuild restart. |
| [`PRIORITIES.md`](./PRIORITIES.md) | Superseded | 2026-05-29 | The v1 slim index/mirror + parser-readable entries. v2 reads flat `priorities/*.md` directly — no mirror (ADR-0010). | Rebuild restart. |
