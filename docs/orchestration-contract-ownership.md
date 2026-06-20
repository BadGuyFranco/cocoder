# Orchestration Contract Ownership

## Status (run_149, 2026-06-19)

This inventory landed through the verify gate (`036e618`). The structural repair atoms — governing rule
in shared standards, contract enforcer, design-ref historical guard, and ticket reconciliations — were
committed in `aa7addc`; the founder's run_147 decision was to **keep** that commit (fix forward, not
revert), because the work is sound and green and a revert would not clean history. run_148 then landed,
each through the verify gate: the standalone red→green enforcer proof harness
(`scripts/proof-orchestration-enforcer.mjs`, `dfe5477`) and the migration of ticket 0005's portable
persona/standards rules (`d06ae45`). run_149 closed ticket 0005's remaining repo-specific items: the
`cocoder/AGENTS.md` name-disambiguation note was applied, and the Oscar daemon-launch prompt delta was
deliberately not actioned because it would duplicate the daemon run-launch contract in a persona delta.
The work queue below is shipped behavior with no remaining live deferral. The run_145/run_147
gate-bypass observation was considered and **deliberately not actioned** (ticket `0018`, closed): the
bypassed commits were correct, green, and founder-kept — not a failure — and any guard that enforces
routing-through-the-gate reintroduces commit-withholding, the ADR-0023 anti-pattern we removed.

### Run_163 Addendum - Closeout Delivery Ownership

The run_163 duplicate wrap-up report exposed a narrower contract the original enforcer missed:
`wrap-up.md` owns the closeout **format**, but the runner's `WRAP-UP READY` artifact owns the visible
closeout **delivery action**. Oscar and the launch/next-turn prompts may tell Oscar to write the
`wrapup` directive and then wait for runner delivery; they must not also tell Oscar to report/deliver a
founder closeout directly. The enforcer now pins that separation by allowing exactly one delivery
instruction in `buildWrapupDelivery()` and rejecting manual founder-closeout delivery language in the
live persona/status surfaces.

Diagnostic status: this is the owner inventory for the priority
`founder-brief-format-durability`, whose objective is the broader "Single-source orchestration
contracts" repair (`cocoder/priorities/founder-brief-format-durability.md:6-16`). This document does
not re-fix the founder-brief instance; that repair is already shipped and recorded in
`docs/founder-brief-format-durability.md`.

## Evidence Pack - Inventory Basis

The priority requires an owner inventory covering closeout briefs, persona prompt restatements, runner
prompt surfaces, Deb status projections, side-channel persona/standard rules, generated-vs-source
artifacts, and ticket authoring/loader formats (`cocoder/priorities/founder-brief-format-durability.md:20-26`).
It also requires live occurrences to be collapsed to a single owner or explicitly deferred
(`cocoder/priorities/founder-brief-format-durability.md:27-29`), promotion of the governing rule into
`shared-standards.md` (`cocoder/priorities/founder-brief-format-durability.md:30-33`), and a structural
enforcer (`cocoder/priorities/founder-brief-format-durability.md:34-37`).

## Owner Inventory

State values are exactly `aligned`, `drifting`, or `already-fixed`.

| Contract | Rightful single owner | Surfaces that re-encode or can override it | State and evidence |
|---|---|---|---|
| Founder / closeout brief format | `packages/personas/base/plays/wrap-up.md` owns the exact founder-facing label order and final line (`packages/personas/base/plays/wrap-up.md:51-75`, `packages/personas/base/plays/wrap-up.md:88-115`). | Oscar consumes the Play instead of inventing a shape (`packages/personas/base/oscar.md:162-164`); runner prompt wrap directives point at the Play contract (`packages/core/src/runner/prompts.ts:168`); runner parses the Play's fenced contract and derives validation/fallback from it (`packages/core/src/runner/runner.ts:182-197`, `packages/core/src/runner/runner.ts:244-301`, `packages/core/src/runner/runner.ts:304-338`, `packages/core/src/runner/runner.ts:1070-1109`); tests prove Play-label changes are enforced (`packages/core/tests/runner.test.ts:879-923`) and old ledger-shaped briefs are rejected (`packages/core/tests/runner.test.ts:925-980`). | `already-fixed`. The diagnosis of record says the repair shipped in `90599db` and names the same owner/consumer map (`docs/founder-brief-format-durability.md:3-4`, `docs/founder-brief-format-durability.md:41-61`). |
| Oscar / base persona prompt restatements of orchestration formats | Governed persona files own role behavior; the wrap-up Play owns the closeout format; shared standards own cross-persona durable-orchestration rules. | Oscar restates the priority lifecycle, wrap-up vs teardown, post-wrap Surface-A support edits, and support-commit command (`packages/personas/base/oscar.md:54-66`, `packages/personas/base/oscar.md:74-93`, `packages/personas/base/oscar.md:150-184`). Bob, Talia, Quinn, and Oz mostly defer to shared standards or define role boundaries rather than format contracts (`packages/personas/base/bob.md:45-48`, `packages/personas/base/talia.md:17-24`, `packages/personas/base/quinn.md:10-16`, `packages/personas/base/oz.md:43-58`). Persona loader reads governed persona markdown by id and frontmatter (`packages/core/src/personas/loader.ts:14-28`). | `aligned`. Oscar explicitly defers the closeout format to the wrap-up Play (`packages/personas/base/oscar.md:162-164`), and base-persona tests pin that Oscar defers instead of restating a parallel closeout shape (`packages/personas/tests/base-personas.test.ts:174-179`). |
| Runner prompt surfaces | `packages/core/src/runner/prompts.ts` owns runner-specific artifact handshakes and generated runtime instructions; it should consume persona/shared rules for role behavior and Play-owned formats. | Launch prompts prepend shared standards and persona body, then append runtime instructions (`packages/core/src/runner/prompts.ts:122-149`); headless turns restate the run loop (`packages/core/src/runner/prompts.ts:260-292`); observer prompts restate Deb status-feed and triage contracts (`packages/core/src/runner/prompts.ts:331-399`); dispatch helpers emit builder, verify, next-or-wrap, and Deb triage handoffs (`packages/core/src/runner/prompts.ts:520-547`). | `aligned`. The runner prompt surface owns the file-artifact protocol it emits; the verify dispatch states the commit happens only on pass (`packages/core/src/runner/prompts.ts:526-529`), matching the launch prompt verify station (`packages/core/src/runner/prompts.ts:175-188`) and ADR pointer (`cocoder/decisions/0011-orchestrator-verify-gate.md:5-8`). |
| Deb live status projection | `packages/core/src/runner/status.ts` owns the Deb status feed schema and markdown projection; the runner owns the current wait-condition text it passes in. | Deb's prompt describes the feed fields and forbids pane/run-dir scraping (`packages/core/src/runner/prompts.ts:331-342`); `renderDebStatus` computes state from store events and runner phase (`packages/core/src/runner/status.ts:67-170`); markdown rendering emits priority, atom, Oscar/Bob/verify, wait condition, scopes, handoffs, and recent events (`packages/core/src/runner/status.ts:178-203`); the runner writes wrapped wait text (`packages/core/src/runner/runner.ts:1129`). | `aligned`. Tests prove the status feed exists only for Deb, carries concrete state, and no longer emits the stale "file-changing follow-ups need a new committed run path" text (`packages/core/tests/runner.test.ts:1973-1990`). |
| Persona/shared-standards rules stranded as side-channel memory | `packages/personas/base/shared-standards.md` owns portable cross-persona standards; role-specific portable rules belong in the relevant base persona; repo-specific rules belong in `cocoder/personas/deltas/` or `cocoder/standards/`. Daemon run-launch authority belongs to Oz's daemon-gated tool surface and the daemon routes, not an Oscar prompt delta. | Shared standards require owner maps and aligned consumers for orchestration behavior (`packages/personas/base/shared-standards.md:66-75`). Ticket `0005` carried five concrete rules that lived outside their rightful governed files (`cocoder/tickets/closed/0005-persona-file-memory-migrations.md:13-18`, `cocoder/tickets/closed/0005-persona-file-memory-migrations.md:21-60`). Ticket `0017` carried the founder-brief single-source rule in a ticket/docs explainer before it was promoted to the governed standard (`cocoder/tickets/closed/0017-promote-founder-brief-single-source-rule-to-shared-standards.md:23-40`). | `already-fixed`. Ticket 0005 items 3-5 (portable) are migrated to the governed base files and base-persona-test-pinned (`d06ae45`). Item 2 is now in `cocoder/AGENTS.md`. Item 1 is closed not-actioned because copying daemon `POST /runs`/CSRF/stale-daemon details into `cocoder/personas/deltas/oscar.md` would create a second owner for a live daemon lifecycle contract. Ticket 0017 was closed by `aa7addc`. |
| Generated-vs-source UI artifact contract (`packages/ui/design-ref` vs `packages/ui/src/renderer`) | `packages/ui/src/renderer` is the maintained source; `packages/ui/design-ref` is historical reference material. | `packages/ui/design-ref/README.md` marks the prototype as historical and says it must not be used as the regeneration source for `packages/ui/src/renderer`; renderer code remains the maintained implementation (`packages/ui/src/renderer/App.tsx`, `packages/ui/src/renderer/model.ts`, `packages/ui/src/renderer/styles/fusion.css`). Ticket `0012` records the Option A closure (`cocoder/tickets/closed/0012-design-ref-rebuild-clobber-guard.md:38-45`). | `already-fixed`. `packages/core/tests/orchestration-contracts.test.ts` fails if the design-ref README again describes `design-ref/` as the app source of truth; ticket 0012 is closed. |
| Ticket authoring and loader format | Core ticket helpers own the machine format: `composeTicketMarkdown`, `loadTicket`, and `readTickets`. Authoring surfaces must call or round-trip through those helpers. | `composeTicketMarkdown` emits full YAML frontmatter (`packages/core/src/tickets/compose.ts:1-13`); `loadTicket` tolerates frontmatter-less historical tickets, validates frontmatter id when present, and warns on malformed ticket files instead of silently dropping them (`packages/core/src/tickets/loader.ts:40-47`, `packages/core/src/tickets/loader.ts:53-73`, `packages/core/src/tickets/loader.ts:84-94`); dashboard ticket creation composes, parses, round-trips, indexes, and commits tickets through the same path (`packages/daemon/src/routes.ts:611-649`, `packages/daemon/src/routes.ts:872-882`); the create-ticket Play says to use `composeTicketMarkdown` and validate with `loadTicket`/`readTickets` (`packages/personas/base/plays/create-ticket.md:13-16`, `packages/personas/base/plays/create-ticket.md:32-42`). | `already-fixed`. Ticket `0015` records the loader/authoring repair (`cocoder/tickets/closed/0015-tickets-silently-dropped-without-frontmatter.md:62-70`); current tests prove frontmatter-less tickets load, malformed tickets warn, and real fallback tickets `0009`/`0011`/`0014` are present (`packages/core/tests/tickets.test.ts:55-120`); authoring-play tests prove create-ticket commits a valid ticket and index row (`packages/daemon/tests/authoring-play.test.ts:86-144`). |
| Post-wrap founder interaction / support edits | Base Oscar plus the shared Surface-A rule own the permission; daemon support-commit owns the post-wrap commit path. | Oscar states post-wrap support edits are allowed and the support-commit command should be run by Oscar (`packages/personas/base/oscar.md:74-93`); generated runner prompts restate the same rule (`packages/core/src/runner/prompts.ts:199-207`, `packages/core/src/runner/prompts.ts:411-421`); Deb status projection can make the state visible (`packages/core/src/runner/status.ts:178-203`); daemon `requestSupportCommitRun` performs the post-wrap commit and records the event/audit (`packages/daemon/src/launcher.ts:660-708`); HTTP and Oz chat route to it (`packages/daemon/src/routes.ts:810-812`, `packages/daemon/src/oz-chat.ts:162-167`). | `already-fixed`. Closed ticket `0008` records the owner map and tests for this repair (`cocoder/tickets/closed/0008-post-wrap-founder-interaction-contract.md:53-70`), including the later same-wrapped-run addendum (`cocoder/tickets/closed/0008-post-wrap-founder-interaction-contract.md:72-97`); current tests pin HTTP and Oz chat support commits (`packages/daemon/tests/mutations.test.ts:1120-1195`). |

## Ticket Review

- `0017` - `subsumed`. The priority itself says 0017 is now subsumed and should be closed by this repair
  (`cocoder/priorities/founder-brief-format-durability.md:55-60`). Its content is one live drifting
  occurrence: the founder-brief single-source rule lives in a ticket/docs explainer instead of
  `shared-standards.md` (`cocoder/tickets/open/0017-promote-founder-brief-single-source-rule-to-shared-standards.md:23-40`).
- `0005` - `folded-in and closed`. It is the side-channel-memory flavour named by this priority
  (`cocoder/priorities/founder-brief-format-durability.md:61-62`), and it carries concrete rules whose
  rightful homes are persona/standards/governance files (`cocoder/tickets/closed/0005-persona-file-memory-migrations.md:21-60`).
  Items 3-5 are applied to base persona/standards files, item 2 is applied to `cocoder/AGENTS.md`, and
  item 1 is closed not-actioned to preserve the daemon run-launch contract's single owner.
- `0012` - `folded-in and closed`. It is the generated-vs-source flavour named by this priority
  (`cocoder/priorities/founder-brief-format-durability.md:63-64`); Option A was applied, making
  `packages/ui/src/renderer` the maintained source and `design-ref/` historical.
- `0015` - `folded-in and closed`, with the runtime defect already fixed. The priority names it as the
  authoring-format-enforcement flavour (`cocoder/priorities/founder-brief-format-durability.md:65-66`),
  and `tickets-review` records the durable loader fix as landed (`cocoder/priorities/tickets-review.md:128-134`).
  The closed ticket records the loader fallback, visible warnings, and authoring-template enforcer.
- `0008` - `already-closed precedent`. It is explicitly listed as the closed durable-orchestration pattern
  to copy (`cocoder/priorities/founder-brief-format-durability.md:67-69`), and its closed record documents
  prompt, wrap delivery, Deb status, daemon, and test alignment (`cocoder/tickets/closed/0008-post-wrap-founder-interaction-contract.md:53-70`).

## Run_145 Direct-Commit Observation

Disposition (run_148): **considered and deliberately not actioned** (ticket `0018`, closed). The
triggering commits (`90599db`, `aa7addc`) were correct, green, and founder-kept — not a correctness
failure — so this is not a catalogued failure (the earlier F23 row was removed). And any guard strong
enough to enforce routing-through-the-gate would have to block or strand a commit, reintroducing
commit-withholding — the ADR-0023 / F21 anti-pattern the rebuilds removed. A detection-only version is
governance-of-governance (F5). No guard is warranted.

Recommendation: `IN-CLASS`, but the enforcement shape is a founder scoping call.

Reason: the contract under review is "agent edits land only through the intended gate/receipt." ADR-0023
says machinery code is verified before the spine commits and that the receipt is derived from the spine's
actual result (`cocoder/decisions/0023-workspace-commit-spine.md:115-128`,
`cocoder/decisions/0023-workspace-commit-spine.md:150-156`). The observed commit `90599db83d5a701cb88b80b290bc3a4c3b910afe`
is on `main`, is authored as a direct git commit, and touched `packages/core/src/runner/runner.ts`,
`packages/core/tests/runner.test.ts`, and `docs/founder-brief-format-durability.md` (`git show --stat
--oneline --name-only 90599db`; `git branch --contains 90599db`). The durable run_145 commit record lists
the runner-mediated commits as `80f496f`, `0b1d5a5`, and `661f97e`, not `90599db`
(`cocoder/runs/7-run_145/commits.jsonl:1-3`).

This fits the class because a contract existed in governance and prompt text, but a path still let
machinery code reach the branch without the runner's verify/receipt surface. The founder call is whether
this priority should add an enforcement atom now, because a true guard may touch git workflow, commit-spine
policy, or host-side controls rather than only prompt/runtime text.

## Work Queue Status

1. **Done** (`aa7addc`). The founder-brief single-source rule lives in `packages/personas/base/shared-standards.md` (Durable Orchestration Changes), pinned by `packages/core/tests/orchestration-contracts.test.ts` + base-persona tests; ticket 0017 is closed. The red→green proof is now a standalone harness, `scripts/proof-orchestration-enforcer.mjs` (`dfe5477`).
2. **Done** (`d06ae45`, run_149 closeout). Ticket 0005 items 3-5 (adversarial plan review, design-seam discussion style, launchability/green-claims) are applied to `oscar.md`/`shared-standards.md`/`bob.md`, ADR-0012-portable, base-persona-test-pinned. Item 2 is applied to `cocoder/AGENTS.md`. Item 1 is intentionally not actioned because Oscar daemon-launch prompt text would duplicate a live daemon lifecycle contract.
3. **Done.** Ticket 0012 resolved with Option A: `packages/ui/design-ref` is marked historical and the enforcer fails if it is described as the app source of truth again; ticket 0012 is closed.
