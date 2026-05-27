# Persona Port Notes — CoBuilder → CoCoder

This file records every divergence the Sub-Playbook E (Dogfood Ramp) borrow pass introduced when porting CoBuilder persona artifacts into `cocoder/personas/`. Sub-Playbook B's full persona/template work extends this; B must not re-write what is already here without reading this document first.

**Source root (read-only borrow target):** `/Volumes/NAS LOCAL/CoBuilder/infrastructure/cobuilder-build/orchestration/personas/`

**Updated:** 2026-05-22 (Sub-Playbook E Solve close)

---

## What landed at E-S1 (Bob-only)

| Borrowed file | Target in CoCoder | Scrub / divergence |
|---|---|---|
| `bob.json` | `cocoder/personas/bob.json` | `allowedRoutes` narrowed from CoBuilder's 3-route list to the dogfood `dogfood-port-tests` route only. Everything else verbatim. |
| `prompts/personas/bob.md` | `cocoder/personas/prompts/personas/bob.md` | Verbatim. |
| `prompts/shared/startup-packet.md` | `cocoder/personas/prompts/shared/startup-packet.md` | Verbatim. |
| `prompts/shared/write-boundaries.md` | `cocoder/personas/prompts/shared/write-boundaries.md` | **Two scrubs:** (1) `ORCHESTRATION-REBUILD` → `v0.1-foundation` (CoCoder's priority slug). (2) The verification-artifact write-guard line was REMOVED and replaced with a pointer comment per Q5=A — the canonical text lives inline in `packages/core/lib/launch.mjs` as `VERIFICATION_ARTIFACT_GUARD_LINE` and is injected by `composeRuntimeRoleLines`. Keeping it in this fragment too would duplicate the guard in the rendered prompt. |
| `prompts/shared/result-contract.md` | `cocoder/personas/prompts/shared/result-contract.md` | Verbatim. |
| `prompts/shared/closeout.md` | `cocoder/personas/prompts/shared/closeout.md` | Verbatim. |
| `prompts/shared/private-playbook-boundary.md` | `cocoder/personas/prompts/shared/private-playbook-boundary.md` | Verbatim. |
| `prompts/shared/evidence-classes.md` | `cocoder/personas/prompts/shared/evidence-classes.md` | Verbatim. |
| `prompts/manifest.json` | `cocoder/personas/prompts/manifest.json` | Pared to **Bob-only** for E-S1. The CoBuilder manifest also lists oscar/talia/quinn/ian/phil/verifier; those land at E1 (Talia) and Sub-Playbook B (the rest). The fragment list for Bob matches CoBuilder's exactly. |

## Deferred to E1 (Talia borrow)

The Sub-Playbook E Expand milestone E1 still needs to land before Talia can execute:

- `talia.json` (verbatim from CoBuilder; `allowedRoutes` narrowed to `dogfood-port-tests`)
- `prompts/personas/talia.md` (verbatim)
- `prompts/shared/session-wrap.md` — Talia's manifest entry in CoBuilder doesn't list this, but it is referenced by Bob's wrap protocol; borrow only if `compose-launch` reports it missing for a route that adds session-wrap gates.
- `manifest.json` — extend with a `talia` entry.

## Deferred to Sub-Playbook B (full persona library)

These personas are NOT borrowed here; Sub-Playbook B owns the full port:

- `oscar.json` + `prompts/personas/oscar.md` (`oscar` is the per-priority lead orchestrator — needed once the dogfood runs multi-lane routes)
- `quinn.json` + `prompts/personas/quinn.md` (browser/UX layer; not used by `dogfood-port-tests`)
- `ian.json` + `prompts/personas/ian.md` (ops/backoffice; out of scope for v0.1 product dogfood)
- `phil.json` + `prompts/personas/phil.md` (custom-persona example; CoCoder ships an example variant under `examples/personas/`)
- `verifier.json` + `prompts/personas/verifier.md`
- `migration/` (CoBuilder-only legacy persona transition; not relevant to CoCoder)

Sub-Playbook B Witness section should reference this file under "Reuse check: Sub-Playbook E borrowed Bob, Talia, and shared fragments."

## Source-of-truth conflicts encountered during E-S1

The dogfood ramp surfaced **four real bugs** in the extracted CoCoder core. All were fixed in the same session and have regression coverage at `packages/core/tests/composition-dogfood-bugfixes.test.mjs`. They are not part of the persona port itself but they blocked it.

| ID | File:line | Symptom | Fix |
|---|---|---|---|
| Bug A | `packages/core/lib/model-roles.mjs:18` | `validateModelRolesSemantics` only short-circuited on `undefined`. `resolveModelRoles` returns `null` for the empty-merged case, which slipped through and triggered "modelRoles must be an object when present" for every profile that didn't declare modelRoles. | Treat `null` like `undefined`. |
| Bug B | `packages/core/lib/contracts.mjs:64-68` | `matchesType` had no case for the `iso-datetime` schema type, falling through to `typeof value === 'iso-datetime'` which is always false. Every `startup-packet.json` validation failed with `createdAt expected iso-datetime`. Blocked `launch` entirely. | Added `iso-datetime` branch with a strict ISO-8601 regex + `Date.parse` sanity check. |
| Bug C | `packages/core/lib/composition.mjs:16-22` | `PRIVATE_LEGACY_REFERENCE_PATTERNS` was mechanically scrubbed from CoBuilder's `build-personas/` → CoCoder's `personas/`, but this matched the CoCoder manifest's own legitimate fragment paths (e.g. `personas/bob.md`). The validator rejected every CoCoder manifest. | Re-targeted patterns at CoBuilder paths directly (`cobuilder-build/build-personas/`, `cobuilder-build/orchestrator/`, etc.) — the patterns now detect upstream leakage (their original intent) without false-positiving CoCoder's own surface. |
| Bug D | `packages/core/cli.mjs:996` | `parseArgs` `path.resolve`d every flag value except an explicit allow-list. The `--workspace-slug` flag added by M4.27 (and `--developer-mode` from M4.22) were missing from the list, so `--workspace-slug cocoder-dogfood` became an absolute path. Run artifacts landed under `local/workspaces/<absolute-workspace-root>/cocoder-dogfood/runs/...`. | Added `workspaceSlug` + `developerMode` to the parseArgs string allow-list. |
| Bug E | `packages/core/lib/launch.mjs:1141` `renderSessionWrapper` | Codex panes ran with hardcoded `--sandbox workspace-write`. Lead lanes drive teammate dispatch via `tmux send-keys` from inside their own codex pane; the `workspace-write` sandbox denies socket IPC and the helper failed with `Operation not permitted`, blocking the whole route. Surfaced during E3.3 first execute attempt: Bob loaded prompt + read startup packet correctly, attempted dispatch, hit the IPC denial, then followed his "do not repair orchestration mechanics" guard and wrote `BLOCK` with diagnostic findings. Talia stayed idle in `wait-for-lead-dispatch` (correct behavior). | Gated codex sandbox on `session.startupMode`: lead lanes get `danger-full-access` (need IPC for dispatch); teammate / writer lanes stay on `workspace-write`. Function exported; regression test pins both paths. v0.2 follow-up: move dispatch OUT of the codex sandbox entirely (file-based or watcher-driven), so the lead can stay locked down. |
| Finding F (v0.2) | `packages/core/scripts/test.mjs` + `packages/core/package.json` `pretest` | The `pnpm -F core test <filter>` declared verification command unconditionally invokes the `pretest` hook which runs `pnpm --filter schemas build`. That rebuild touches mtimes (but not content — bytes verified byte-stable) of `packages/schemas/dist/*.schema.json` files. Bob's CONDITIONAL_PASS finding on the `adapters.test.mjs` port: this is technically a write outside Talia's `packages/core/tests/` zone. Not a real schema drift (verified `shasum` identical pre/post rebuild) but it's a write-boundary technicality that makes Bob conservative on the route's `nextAction`. | **No code change at v0.1** — the schema-drift CI gate (`git diff --exit-code -- packages/schemas/dist/`) catches real drift. v0.2 follow-up options: (a) make the `core` pretest a no-op when `packages/schemas/dist/` is fresher than `packages/schemas/src/`; (b) narrow the verification command in route configs to skip pretest; (c) tag the schemas-dist mtime touch as an expected side effect in the write-boundary audit. Tracked as Sub-Playbook A audit-finding candidate. |

## Plan-vs-reality reconciliation surfaced

The Sub-Playbook E plan (`cocoder/priorities/v0.1-foundation/plans/2026-05-22-dogfood-ramp.plan.md`) was authored before the CLI shape was concretely known. Sub-Playbook E Solve forced these clarifications (all reconciled into the plan in-place per founder go-signal):

- **`compose-launch` takes file paths, not slug names.** Use `--profile cocoder/profiles/cocoder-dogfood.profile.json` and `--route cocoder/routes/dogfood-port-tests.json`.
- **`compose-launch` does not accept `--dry-run`.** It IS the dry-run path (`composeLaunchDryRun`); the live execute is `launch`.
- **`compose-launch` requires `--priority-slug`.** The plan's invocation omitted it.
- **Profile/route files must be JSON, not YAML.** `loadProfile`/`loadRoute` go through `readJson`.
- **Profile-roster contract requires 11 lane sub-keys** (`oscar`, `bob`, `ian`, `phil`, `talia`, `quinn`, `verifiers.primary`, `verifiers.adversarial`, `bobHelpers.default`, `bobHelpers.readonlyResearch`, `bobHelpers.implementation`). A Bob-only profile must still stub all 11 — the dogfood profile stubs the unused lanes with `persona: 'bob'` to satisfy persona-existence checks while making clear the route only targets Bob.
- **Routes must declare `laneRequirements`** even though the contract schema marks it optional. `validateRouteSemantics` rejects routes without it.
- **A `priority-boundary` file is required for every route lane that can write.** The plan didn't mention this; authored at `cocoder/priority-boundaries/v0.1-foundation.boundary.json`.
- **`extractPriorityEntry` reads `## [slug]` headings, not table rows.** The dogfood `PRIORITIES.md` was a slim table-only mirror; added a "Parser-readable priority entries" section below the table that contains the heading-style block the extractor needs. The slim table mirror is preserved (per the SSOT rule in `cocoder/AGENTS.md`).
- **`compose-launch` only emits JSON.** The actual composed launch-time prompt (`<runDir>/jobs/<lane>/prompt.md`) is rendered by `launch` (default `--execute=false`). E-S1's Solve evidence is both: the compose-launch JSON proves readiness; the prompt.md proves composition. Both are captured at `local/workspaces/cocoder-dogfood/solve-evidence/`.

## Sub-Playbook B Solve — persona-identity regression fixture (2026-05-23)

| Field | Value |
|---|---|
| Source E run | `run-20260522T233422Z-pqk1t3w0` (dogfood port-tests; successful autonomous run) |
| Fixture runId | `run-fixture-persona-identity-bob` (deterministic re-render target) |
| Fixture paths | `packages/core/tests/fixtures/persona-identity/bob-dogfood.{expected-prompt.md,expected-context.json,launch-plan.json}` |
| Route / profile / priority | `dogfood-port-tests` / `cocoder-dogfood` / `v0.1-foundation` |
| Manifest version | `1` (bob + talia entries) |
| Test | `packages/core/tests/persona-identity.test.mjs` — byte-identical `launchRun` bob prompt vs fixture; negative control mutates priority slug |

Paths in committed fixtures use `__REPO_ROOT__` token; tests hydrate with the checkout root so CI and local NAS paths both work.

## Sub-Playbook B Expand — Oscar, Phil, session-wrap, stubs (2026-05-23)

| Borrowed / authored | Target in CoCoder | Scrub / divergence |
|---|---|---|
| `oscar.json` | `cocoder/personas/oscar.json` | `allowedRoutes` narrowed to `dogfood-port-tests` + `phil-workshop-toolsmith`. Everything else verbatim from CoBuilder orchestration personas. |
| `prompts/personas/oscar.md` (CoBuilder) | `cocoder/personas/prompts/personas/oscar.md` | **Major divergence:** upstream CoBuilder file is ~25KB (private playbook prose embedded in the runtime fragment). CoCoder ships a concise public fragment (~15 lines) matching Bob/Talia fragment shape. Identity constraints preserved; CoBuilder-specific paths and checklists omitted. |
| `prompts/shared/session-wrap.md` | `cocoder/personas/prompts/shared/session-wrap.md` | Scrubbed CoBuilder launcher paths (`Launch-Orchestrator.command`, `cobuilder-build/orchestration/...`) to CoCoder-neutral wrap language. |
| `phil.json` + `prompts/personas/phil.md` | `cocoder/personas/phil.json` + `prompts/personas/phil.md` | Role reframed from CoBuilder "primitive builder" to CoCoder-neutral "extension builder". CoBuilder primitive-boundary references removed. |
| `quinn.json`, `ian.json`, `verifier.json` | matching files in `cocoder/personas/` | Contract stubs only (PB-Q2=B deferral). `allowedRoutes` emptied; boundaries note v0.2 deferral. No manifest entries or public playbooks. |
| `manifest.json` | `cocoder/personas/prompts/manifest.json` | Extended with `oscar` (includes `session-wrap.md`) and `phil`. Bob + Talia unchanged. |
| Phil working example | `examples/personas/phil-primitive-builder/` | CoCoder-neutral "Workshop Toolsmith" domain; not CoBuilder primitives. |
| Public playbooks | `cocoder/personas/playbooks/{bob,talia,oscar,phil}.md` | Authored fresh; not copied from CoBuilder private playbooks. |
| Private operator pattern | `cocoder/personas/playbooks/README-private-operator-pattern.md` + template `local/README.md` | Documents `<workspace>/cocoder/local/playbooks/`. |

## Orchestration-services import (2026-05-27) — ADR-0009

Ported CoBuilder's non-persona orchestration-services pattern. Source root: `/Volumes/NAS LOCAL/CoBuilder/infrastructure/cobuilder-build/orchestration/`. This port is **runtime/contracts**, not personas, but the scrubs are recorded here as the canonical CoBuilder→CoCoder divergence log.

| Borrowed file (CoBuilder) | Target in CoCoder | Scrub / divergence |
|---|---|---|
| `core/lib/services.mjs` | `packages/core/lib/services.mjs` | **3 scrubs, logic verbatim:** (1) `DEFAULT_SERVICES_DIR` resolved module-relative (`../services` via `fileURLToPath`) instead of `repoPath('cobuilder-build/orchestration/services')` — services ship inside the package like `contracts/`+`adapters/`; (2) dropped the now-unused `repoPath` import; (3) `renderServicePrompt` "CoBuilder orchestration service packet" → "CoCoder". Reuses CoCoder's existing `lib/contracts.mjs` `loadContracts`/`validateInstance` (same names/shape upstream uses) — **no AJV introduced**. |
| `contracts/orchestration-service-declaration.schema.json` | `packages/core/contracts/orchestration-service-declaration.schema.json` | Verbatim (repo-agnostic custom `{contract,required,fields,rules}` shape; loads via existing `contracts.mjs`). |
| `contracts/orchestration-service.schema.json` | `packages/core/contracts/orchestration-service.schema.json` | Verbatim (the packet contract; `createdAt: iso-datetime` validates via the Bug-B `matchesType` fix). |
| `services/*.json` (11) | `packages/core/services/*.json` (11) | Verbatim **except `allowedWriteScopes` path scrubs** (read-only services unchanged — empty scopes): `cobuilder-build/PRIORITIES.md`→`cocoder/PRIORITIES.md`; `cobuilder-build/SESSION_LOG.md`→`cocoder/SESSION_LOG.md`; `SESSION_LOG_ARCHIVE.md` same prefix swap; `cobuilder-build/plans/*.md`→`cocoder/plans/*.md` **+ added `cocoder/priorities/*/plans/*.md`** (most CoCoder plans live under the priority folder); `cobuilder-build/PRIORITIES-ARCHIVE.md`→`cocoder/priorities/zArchive/INDEX.md` (CoCoder has no PRIORITIES-ARCHIVE.md); `cobuilder-build/orchestration/runs/*/jobs/*/result.{json,md}`→`local/workspaces/*/runs/*/jobs/*/result.{json,md}`. `requiredChecks` verbatim — all gate/command names (`check-handoff-consistency`, `check-session-log-hygiene`, `gate-result`, `orchestrator-commit`, `finalize-run-status`, `check-doc-refs`, …) already exist in CoCoder's CLI. |
| `adapters/cursor-agent.json` (repurposed headless) | `packages/core/adapters/cursor-agent-service.json` (**new id**) | Founder decision: do NOT overwrite CoCoder's interactive `cursor-agent.json` (resultContract `job-result`). New separate adapter declares the headless profile (`interactive:false`, `sandboxModes:[danger-full-access]`, `approvalModes:[never]`, `resultContract:orchestration-service-packet`). The executor hardcodes its own `cursor-agent` flags, so this adapter is registry metadata only. |
| `core/cli.mjs` service commands (5) | `packages/core/cli/registry.mjs` handlers + `commandRegistry` + `cli/help.mjs` | Same 5 commands. Added `service`/`executorCommand`/`model` to the `parseArgs` string allow-list in `cli/shared.mjs` (must not be `path.resolve`d). Added `DEFAULT_SERVICES_DIR`. Help baseline fixture `tests/fixtures/cli-help-baseline.txt` regenerated. |
| `core/lib/debugger.mjs` "Orchestration Service Pattern" section | `packages/core/lib/debugger.mjs` `renderDebuggerPrompt` | Additive prompt text only (no change to evidence APIs Oz reuses). Path scrub `cobuilder-build/orchestration/services/<id>.json`→`packages/core/services/<id>.json`. |
| `personas/prompts/shared/session-wrap.md` (item 7) | `cocoder/personas/prompts/shared/session-wrap.md` | Added the one service-delegation bullet verbatim (no CoBuilder-specific paths in it). |
| `tests/services.test.mjs` | `packages/core/tests/services.test.mjs` | Ported; dirs resolved module-relative; fixture paths `cobuilder-build/`→`cocoder/`; out-of-scope product path → `packages/core/lib/launch.mjs`; CLI entry → `packages/core/cli.mjs`. |
| `tests/debugger.test.mjs` (service-guidance asserts) | `packages/core/tests/debugger.test.mjs` | Added 4 assertions for the new guidance section (scrubbed path). |

**Layout decision (founder):** service results land at `<runDir>/services/<packetId>/` (upstream layout preserved), not `jobs/<lane>/` — services are not personas/lanes. **Oz untouched (ADR-0008):** services execute externally and surface as ordinary run artifacts.
