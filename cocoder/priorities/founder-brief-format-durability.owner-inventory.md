# Single-Source Orchestration Contract Owner Inventory

Repair run: `run_147`
Priority: `founder-brief-format-durability`

## Governing Rule

Owner: `packages/personas/base/shared-standards.md`, **Durable Orchestration Changes**.

State: `fixed`.

Change: the governed standard now says that when a Play or governed file owns an orchestration format,
validators, fallback emitters, prompt surfaces, status projections, and tests must parse, import, or
generate from that owner instead of copying labels, fields, allowed values, or section order into a
second local contract.

Enforcer: `packages/core/tests/orchestration-contracts.test.ts`.

## Inventory

| Contract / format | Rightful owner | Surfaces that emit, consume, or can override it | State | Disposition |
|---|---|---|---|---|
| Founder closeout brief | `packages/personas/base/plays/wrap-up.md` fenced founder closeout contract | Runtime parser/fallback in `packages/core/src/runner/runner.ts`; Oscar prompt deferral in `packages/personas/base/oscar.md`; launch/wrap prompt pointers in `packages/core/src/runner/prompts.ts`; tests in `packages/core/tests/runner.test.ts` and `packages/personas/tests/base-personas.test.ts`; diagnosis doc in `docs/founder-brief-format-durability.md` | `already-fixed` by `90599db`, hardened here | Runtime already parses the Play. This run removed test-side hard-coded section lists and added a scan that fails when live consumers restate 3+ owner labels. |
| Oscar/persona prompt restatements | The owned Play or governed standard for the behavior being referenced | `packages/personas/base/oscar.md`; generated Oscar prompt sections in `packages/core/src/runner/prompts.ts`; headless turn prompts | `aligned` | Oscar points to the wrap-up Play instead of restating the closeout shape. The enforcer scans Oscar and runner prompts for closeout-label restatements. |
| Runner prompt surfaces | Specific source owner per contract: wrap-up Play for closeout; shared standards for durable-orchestration rule; ADR-backed runner code for directive/verify/triage JSON shapes | `packages/core/src/runner/prompts.ts`; dispatch strings; tests that assert prompt behavior | `aligned` | No founder-closeout labels are encoded in runner prompts. Directive/verify/triage JSON shapes remain runner protocol, not Play-owned closeout formats. |
| Deb/status projections | Runner event/store projection in `packages/core/src/runner/status.ts`; Deb prompt only describes how to read it | `packages/core/src/runner/status.ts`; `buildObserverPrompt` status-feed prose; Deb base persona | `aligned` | Status projection derives state from store events and runner phase. It does not restate the founder-closeout section contract. |
| Persona/shared-standards rules vs side-channel memory | Governed persona and standards files under `packages/personas/base/**` plus repo deltas under `cocoder/personas/**` | `cocoder/tickets/closed/0017...`; `cocoder/tickets/open/0005...`; `packages/personas/base/shared-standards.md`; `packages/personas/base/oscar.md` | `drifting` for ticket 0005; `fixed` for 0017 | 0017 closed by moving the founder-brief rule into the governed standard. 0005 remains open because it contains broader persona behavior migrations outside this run's narrow structural repair. |
| Generated-vs-source UI/design reference | Maintained app: `packages/ui/app`; historical reference: `packages/ui/design-ref` | `packages/ui/design-ref/README.md`; app comments referencing ported prototype files; `packages/ui/tests/**` | `fixed` | Option A selected. `design-ref/README.md` now marks the prototype historical, and the enforcer fails if it is described as the app source of truth again. Ticket 0012 closed. |
| Ticket authoring markdown/frontmatter | Core ticket composer and loader: `packages/core/src/tickets/compose.ts` and `packages/core/src/tickets/loader.ts` | Dashboard route in `packages/daemon/src/routes.ts`; create-ticket Play in `packages/personas/base/plays/create-ticket.md`; loader tests in `packages/core/tests/tickets.test.ts`; ticket index | `fixed` | Loader already accepts frontmatter-less tickets with fallback metadata and warns on malformed numbered tickets. This run added the contract enforcer that pins create-ticket authoring to `composeTicketMarkdown` and closed ticket 0015. |
| Post-wrap founder interaction contract | Base Oscar + runtime support-commit path recorded in closed ticket 0008 | Oscar base prompt; runner prompt delivery; daemon support commit route; Deb status projection; daemon tests | `already-fixed` | Folded in as precedent only. It already aligned prompts, runtime, daemon surface, status projection, and tests around one contract. |
| Direct repair / verify-gate boundary | ADR-0013 owns per-atom product-code verify; ADR-0016 owns Deb repair fallback; ADR-0023 owns direct-to-branch commit spine | Runner commit gate; Deb repair dispatch; direct founder Deb sessions; support commits | `aligned`, founder may veto | The run_145 `90599db` direct repair is not the same contract as Bob's per-atom product-code verify gate. Deb direct machinery repair is an accepted ADR-0016/0023 path. If the founder wants machinery-code Deb repairs to require an additional orchestrator verify gate, that is a policy change and should be handled by a new ADR/ticket, not silently folded into this repair. |

## Ticket Dispositions

- `0017` — fixed and closed here. The rule now lives in shared standards and is backed by the
  structural enforcer.
- `0015` — fixed and closed here. Loader behavior was already repaired; this run added owner
  enforcement around ticket markdown authoring.
- `0012` — fixed and closed here with Option A. `design-ref/` is historical; app truth is
  `packages/ui/app`.
- `0005` — folded into the inventory as the side-channel-memory flavor, left open. It carries broader
  persona-memory migrations not completed by this narrow structural repair.
- `0008` — folded in as the precedent pattern; remains closed.

## Enforcer Red-Green Proof

Red proof: adding a deliberate duplicate closeout label cluster to `packages/core/src/runner/prompts.ts`
made `packages/core/tests/orchestration-contracts.test.ts` fail with:

`packages/core/src/runner/prompts.ts: **Founder Completion Brief**, **Atom Complete:**, **Run Status:**`

Green proof: after removing the duplicate, the focused suite passes.
