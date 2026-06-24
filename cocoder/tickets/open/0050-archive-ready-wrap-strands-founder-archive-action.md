---
id: 0050
title: Archive-ready wrap strands founder archive action
type: bug
status: Open
priority: none
owner: deb
created: 2026-06-24
---

# 0050 - Archive-ready wrap strands founder archive action

## Context

Run_224 completed the `local-preferences` priority and Oscar correctly judged it archive-ready:
both atoms landed, the run wrap said `archive ready`, and the founder closeout asked for explicit archive
confirmation. The system still left the actual archive action as a manual out-of-band instruction:

> Confirm archive of the `local-preferences` priority. On confirmation, archive via Oz (`author` tool with
> play `archive-priority`) or `pnpm --dir <install-root> exec cocoder oz archive-priority local-preferences`.

That is the recurring friction. Oscar can identify archive readiness, but the founder-confirmed archive step
is not a first-class continuation of the wrapped run. The founder is handed a command/tool recipe, and Oscar
cannot simply receive "archive it" and complete the governed `archive-priority` flow as the next support
action.

Run_224 also showed format fragility in the same seam: Oscar first produced `Run Status:
Priority-launched run: archive ready.`, which the validator rejected because it reads the first line as the
status value. The repair changed the line to exactly `archive ready`. That validator repair was correct, but
it is more evidence that archive readiness is encoded as brittle prose instead of a clear runtime action
state.

The final run record made the lifecycle ambiguity explicit: `local/runs/run_224/record.md` reports
`Status: awaiting-founder`, the event stream records `wrap-disposition: awaiting-founder` and then
`run-end`, while the closeout tells the founder "I'm standing by..." and asks for archive confirmation.
That leaves the founder-facing promise ("standing by") and the runtime state ("ended, awaiting-founder")
without a single owned archive-confirmation action.

This is not ticket 0023. Ticket 0023 made `archive-priority` reachable as a CLI/daemon authoring lane. This
ticket is about the post-wrap founder-confirmation experience: an archive-ready priority should not require
the founder to translate a closeout sentence into a separate command or authoring-tool invocation.

## Acceptance

- A priority-launched run that wraps `archive ready` exposes a first-class founder archive confirmation
  action while the wrapped run is still standing by.
- When the founder confirms archive in the active Oscar/Oz context, the system routes through the single
  `archive-priority` Play owner. It must not hand-move files, bypass `order.json`, or invent a second archive
  mechanism.
- The closeout no longer relies on manual command/tool recipes as the primary path. It may mention the CLI as
  a fallback, but the recommended path is the in-context archive confirmation action.
- Runtime state distinguishes "archive-ready, awaiting archive confirmation" from generic
  `awaiting-founder` so dashboards/status feeds can present the right next action.
- Lifecycle wording and state agree: if Oscar/Oz is "standing by" for archive confirmation, the runtime must
  expose the corresponding action; if the run is ended, the closeout must route the founder through the owned
  post-run action without implying Oscar can complete it from the same pane.
- Wrap-up validation prevents the brittle `Priority-launched run: archive ready.` failure class, ideally by
  deriving the target label outside the `Run Status` value rather than relying on Oscar prose discipline.
- Tests cover the run_224 case:
  - archive-ready priority wrap produces a coherent archive-confirmation state/action;
  - founder confirmation archives `local-preferences` through the archive-priority lane and prunes
    `order.json`;
  - saying anything other than archive keeps the priority live and does not silently archive.

## Notes

- Observed in run_224 for `local-preferences`.
- Evidence artifacts: `local/runs/run_224/directive-2.json`, `pickup.md`, `wrapup-out.txt`,
  `wrapup-out-retry.txt`, `wrapup-delivery.md`, and `deb-status.json`.
- Related code/tests: `packages/core/src/runner/runner.ts`, `packages/personas/base/plays/wrap-up.md`,
  `packages/daemon/tests/authoring-play.test.ts`, `packages/daemon/tests/mutations.test.ts`, and
  `packages/core/tests/runner.test.ts`.
- Related closed tickets: 0023 made archive-priority reachable; 0041 exempted same wrapped/awaiting-founder
  runs from the authoring-Play in-flight guard. This ticket should build on those mechanisms, not replace
  them.
