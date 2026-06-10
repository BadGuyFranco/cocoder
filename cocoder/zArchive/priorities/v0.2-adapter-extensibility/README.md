# Priority: v0.2-adapter-extensibility — Beyond local CLI models

**Slug:** `v0.2-adapter-extensibility` | **Created:** 2026-05-22 | **Updated:** 2026-05-22
**Type:** One-time | **Collaboration:** Collaborative
**Status:** Draft (sequenced after v0.1-foundation ships)
**Method:** WISER Playbook (Master)
**Owner:** Bob + founder

This README **is** the priority's master Playbook. It is a Draft — full Witness/Interrogate/Solve/Expand/Refine/Final-Check sections will be filled out when the priority activates.

> **Why this exists:** the v0.1 orchestration runtime assumes every model is a local interactive CLI driven through tmux (`adapter.kind === 'llm-cli'`). That covers Claude Code, Codex, Grok, Gemini, Kimi-CLI, Cursor CLI when it lands, and any future locally-installed LLM CLI. It does **not** cover three increasingly-real product surfaces: pure cloud APIs (Anthropic Messages, OpenAI Responses, cloud Kimi K2.6 over HTTP), managed remote sessions (Cursor SDK Background Agents, Devin, Replit Agent, Lovable, etc.), and any future browser-or-API-only model surface. This priority extends the adapter system to land those cleanly without touching personas, routes, write-boundary audits, or the `job-result` contract.

## Context

The orchestration runtime decouples *what to do* (personas, routes, profiles, priority boundaries, the `job-result` contract) from *which model executes the lane* (adapter declarations in `packages/core/adapters/*.json` consumed by `loadAdapterDeclarations`). The decoupling worked perfectly for the 5 LLM CLIs already shipped — adding a new CLI is a 5-minute JSON drop-in.

What v0.1 did NOT need was an adapter shape for models that aren't interactive CLIs. The orchestration runtime assumes the model:

- Runs as a local executable launched via tmux (`session.command = adapter.command`)
- Holds a long-lived session in a tmux pane that the founder can attach to
- Accepts dispatch via `tmux send-keys` writing to stdin
- Writes a `result.json` file when done

That shape is unmistakably CLI-shaped. For cloud APIs, managed sessions, and browser-hosted agents, several invariants don't hold. This priority introduces additional adapter `kind` values + matching runner contracts so the orchestration core can drive non-CLI models without changing personas, routes, or contracts.

**Key files for resume:**

- `packages/core/adapters/` — current adapter declarations (`claude.json`, `codex.json`, `grok.json`, `gemini.json`, `kimi.json`, `quinn-scripts.json`, `future-cli-template.json`)
- `packages/core/contracts/adapter.schema.json` — current adapter schema
- `packages/core/lib/adapters.mjs` — adapter loader + preflight
- `packages/core/lib/launch.mjs` — tmux-based runner (assumes `kind === 'llm-cli'` or `'script'`)
- ARCHITECTURE.md "Persona Boundaries" + "Oz daemon security model" — the surfaces that don't need to change

---

## Preconditions

- [ ] v0.1-foundation priority complete (Sub-Playbooks A, B, C, D all closed)
- [ ] Sub-Playbook C (Oz daemon + dashboard) shipped — this priority depends on Oz UX for the "no tmux pane to attach to" experience that managed-session + cloud-API adapters require
- [ ] Sub-Playbook B (workspace template + `cocoder init`) shipped — adopters need the workspace shape before custom adapters become a real path
- [ ] Apache-2.0 license + public-readiness gates green — this priority assumes the project ships before adopters need cloud adapters

---

## Authority

**Autonomous (per Sub-Playbook):** Research existing API shapes for proposed targets; draft ADRs for adapter-kind taxonomy and per-kind runner contracts; prototype runners against mocked endpoints; write contract tests.

**Needs human input:**

- Schema changes to `adapter.schema.json` (ADR-graduating decision)
- Choice of initial cloud target (Cursor SDK vs. Anthropic Messages vs. cloud Kimi vs. all three) when the priority activates
- Auth/secret-handling for cloud adapters (extends ARCHITECTURE.md "Oz daemon security model")
- Any UI change to the Oz dashboard for non-pane lane visibility

---

## Witness *(to be expanded at activation)*

### What we know today

- The current adapter system works cleanly for local CLIs. 5 CLIs ship + a template; adding a 6th is JSON-only.
- Sub-Playbook E dogfood proved the runtime is solid: orchestration loop runs Talia + Bob through 5 successful test ports across two distinct runs; 165 tests pass; 5 core bugs found + fixed end-to-end.
- The contract surfaces below intentionally do NOT change for cloud/managed-session adapters:
  - `job-result` schema (status, persona, adapter, filesChanged, evidence, residualRisk, nextAction)
  - Persona contracts (Bob, Talia, Quinn, Oscar, Ian, Phil, verifier)
  - Routes + profiles (lane → adapter mapping, lane-requirements, write boundaries)
  - Verification-artifact guard (canonical inline at `VERIFICATION_ARTIFACT_GUARD_LINE`)
  - Oz audit log entries
  - Write-boundary audits via `repo-state.mjs`

### What we don't know yet *(populate at activation)*

- Which cloud target to prove the pattern on first — Cursor SDK is the most product-shaped; Anthropic Messages is the simplest; cloud Kimi K2.6 has the most leverage if Moonshot ships a usable cloud endpoint.
- Whether managed sessions need a separate `kind` from cloud APIs (probably yes — managed sessions have explicit session lifecycle + status polling that pure request/response APIs don't).
- How Oz dashboard should render non-pane lanes (status panels vs. log tail vs. transcript replay).
- Auth handling: per-adapter env var pointing at `<install>/local/secrets/<adapter>-token`? Keychain when v0.2 keychain ships? `${env:NAME}` references in the workspace config?

---

## Interrogate *(stub — fill out at activation)*

### Proposed decisions (to be ADR-graduated)

| # | Proposed decision | Notes |
|---|---|---|
| 1 | Adapter `kind` becomes an enum: `llm-cli`, `llm-api`, `llm-managed-session`, `script` | `script` already exists (Quinn). `llm-cli` is current default. |
| 2 | Each kind has a distinct runner module under `packages/core/lib/runners/` | `cli-runner.mjs` (existing tmux logic factored out of `launch.mjs`), `api-runner.mjs`, `managed-session-runner.mjs`, `script-runner.mjs` |
| 3 | Adapter declarations extend with per-kind fields | `api`: endpoint URL, request shape, auth pattern. `managed-session`: API base, session-create payload, status-poll endpoint, results-retrieval contract. |
| 4 | Lane visibility for non-pane adapters lives in Oz dashboard | Status card + streamed transcript instead of tmux attach. Requires Sub-Playbook C feature work. |
| 5 | Auth: per-adapter env var pattern `${env:<ADAPTER>_API_KEY}` resolving from `<install>/local/secrets/.env` | Mirrors ADR-0001 storage zone for secrets. v0.2 keychain landing optional. |

### Proposed risks

- **Adapter-kind sprawl:** Adding too many kinds dilutes the contract. Counter: keep the enum small + closed (4 values; new kinds require an ADR).
- **Non-pane visibility unfamiliar to users:** Adopters who learned the tmux model may be confused by status panels. Counter: Oz dashboard renders both equally; founder dogfood test covers both shapes before publish.
- **Auth-surface expansion:** Each cloud adapter introduces a new auth path + secret-handling burden. Counter: bound to `${env:NAME}` resolving from `<install>/local/secrets/` — same zone as v0.1 secrets.
- **Cloud rate limits / cost runaway:** A misbehaving cloud adapter can rack up bills fast. Counter: per-adapter spend cap + circuit breaker as part of the runner contract (deferred until first cloud adapter ships if too speculative).

---

## Solve target *(to be defined at activation)*

The riskiest invariant: a non-CLI adapter can complete a full route lifecycle (compose-launch → execute → dispatch → result → finalize) without changing personas, routes, or the `job-result` contract. If that round-trips, the rest is mechanical.

**Proposed Solve task:** prototype `llm-api` adapter targeting Anthropic Messages API (simplest cloud target; matches the project's existing Claude affinity); drive a single read-only Oscar lane end-to-end through it; verify `result.json` matches the contract.

---

## Expand *(to be planned at activation)*

Proposed Sub-Playbooks:

- **F-1: Adapter-kind ADR + schema extension** — ADR-0007 (or current next ADR number) graduates the kind enum + per-kind field shapes. `adapter.schema.json` extended. Runner contract documented.
- **F-2: CLI-runner factoring** — pull the existing tmux/CLI logic out of `launch.mjs` into `packages/core/lib/runners/cli-runner.mjs`. No behavior change; the existing 5 CLI adapters keep working.
- **F-3: `llm-api` runner + Anthropic Messages adapter** — prototype, contract tests, evidence pack.
- **F-4: `llm-managed-session` runner + Cursor SDK adapter** — extends Oz dashboard for non-pane visibility.
- **F-5: Cloud Kimi K2.6 adapter** — second `llm-api` consumer, validates the pattern is reusable.
- **F-6: Auth + spend controls** — per-adapter env-var + secret-zone integration; optional spend cap if scope warrants.

Concrete adapter targets in priority order:

1. **Anthropic Messages API** (`llm-api`) — closest to project DNA, well-documented, fast feedback.
2. **Cursor SDK Background Agents** (`llm-managed-session`) — highest founder-stated interest per the conversation that opened this priority.
3. **Cloud Kimi K2.6** (`llm-api`) — second consumer of the `llm-api` runner, proves reusability.
4. **Devin / Replit Agent** (`llm-managed-session`) — only if a real use case surfaces. Not committed.

---

## Refine *(stub)*

Refine = launch a real workspace orchestration using each cloud adapter end-to-end, with the founder watching outcomes match the `job-result` contract exactly. If any adapter requires changes to personas, routes, or the contract, this priority has failed — the whole point is to add capability without touching shared shapes.

---

## Final Check *(stub)*

- [ ] ADR-graduated adapter-kind enum
- [ ] At least one `llm-api` adapter shipped + tested
- [ ] At least one `llm-managed-session` adapter shipped + tested
- [ ] Oz dashboard renders non-pane lanes
- [ ] Documentation in `docs/adapters.md` walks adopters through adding a custom adapter of each kind
- [ ] No regression on existing CLI adapters (Claude, Codex, Grok, Gemini, Kimi-CLI)
- [ ] Auth/secret handling documented + tested

---

## Decision Log *(populate at activation)*

| Date | Decision | Rationale | Alternatives |
|---|---|---|---|
| 2026-05-22 | Open this priority in Draft status, sequenced after v0.1-foundation | Founder asked about Cursor SDK + cloud Kimi K2.6 mid-session; the question is real and important but the right time to land new adapter kinds is after Oz ships (Sub-Playbook C), because Oz is what makes "no tmux pane" usable. Staking out the priority now preserves the design space without blocking v0.1. | Add to v0.2-backlog as a line item (rejected — founder explicitly said "document this as a priority"); roll into Sub-Playbook C (rejected — bundles cross-cutting adapter work into an Oz-scoped Playbook); start immediately (rejected — see Preconditions). |

---

## Resume Instructions

1. Confirm v0.1-foundation priority has reached Complete (Sub-Playbooks A, B, C, D all closed; Sub-Playbook E was already proven via the test-port dogfood loop).
2. Read this README end-to-end + the Solve target above.
3. Activate the priority: status → Active; populate Witness with current adapter inventory + cloud-API landscape; expand Interrogate decisions into ADR drafts.
4. Solve first: prototype the Anthropic Messages `llm-api` adapter end-to-end through Oscar. If the round-trip works without changing personas/routes/contracts, proceed to Expand.
5. Expand: land F-1 through F-6 in dependency order. F-1 (ADR + schema) gates F-2 (factoring) gates F-3 onwards.
6. Refine: dogfood each new adapter on a real workspace task; founder watches; capture evidence.
7. Final Check: tick the boxes above; merge with green CI + founder approval.

---

## Progress

**Last worked:** 2026-05-22 (authored as Draft)
**Current Canon:** Draft — sequenced after v0.1-foundation ships
**Next action:** None until v0.1-foundation Complete. At activation, populate Witness/Interrogate/Solve and draft the adapter-kind ADR.
