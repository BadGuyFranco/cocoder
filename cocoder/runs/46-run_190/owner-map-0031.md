# Owner Map - Ticket 0031 Founder Stop Control Lane

## 1. RUNNER LOOP

The runner loop is owned by `packages/core/src/runner/runner.ts`. Its header states the execution model: `await directive -> delegate atom -> MONITOR Bob live -> verify (gate) -> commit per atom -> ask next` (`packages/core/src/runner/runner.ts:6-9`). The loop entry point is `runRun` (`packages/core/src/runner/runner.ts:596`), and it creates the run dir from `runsRoot` plus the run id (`packages/core/src/runner/runner.ts:611-614`).

The loop waits for `directive-N.json` inside the main `for (;;)`: `const directivePath = join(runDir, \`directive-${n}.json\`)` (`packages/core/src/runner/runner.ts:1356-1358`), then calls `io.awaitDirective(...)` through the Oscar nudge watchdog (`packages/core/src/runner/runner.ts:1360-1363`). A `delegate` directive goes into `executeAgentStep` (`packages/core/src/runner/runner.ts:1452-1491`); a `wrapup` directive breaks the loop after wrap-up preparation (`packages/core/src/runner/runner.ts:1371-1449`). Continuation is decided after each atom: reject backstop checks may break (`packages/core/src/runner/runner.ts:1512-1523`), otherwise the runner prompts Oscar for the next directive using `buildNextOrWrapDispatch(join(runDir, \`directive-${n}.json\`), step.outcomeLine)` (`packages/core/src/runner/runner.ts:1525-1528`).

Verification is inside `executeAgentStep`: it computes `verifyPath = join(runDir, \`verify-${atomIndex}.json\`)` (`packages/core/src/runner/agent-step.ts:230`), sends Oscar `buildVerifyDispatch(directivePath, verifyPath)` (`packages/core/src/runner/agent-step.ts:231-233`), and waits for `io.awaitVerification(...)` through the same Oscar nudge watchdog (`packages/core/src/runner/agent-step.ts:235-239`). Only `verdict: "pass"` runs `runCommitGate` (`packages/core/src/runner/agent-step.ts:253-270`).

Nudges originate from three `runMonitor` usages:

- Bob monitor in `executeAgentStep`: `nudge: (text) => bobDriver.nudge(text)` and event type `nudge` (`packages/core/src/runner/agent-step.ts:153-164`).
- Deb full-run watcher: reads `deb-nudge.json`, returns a stuck assessment, then sends `oscarDriver.nudge(text)` (`packages/core/src/runner/runner.ts:1038-1085`).
- Oscar directive/verify watchdog: reads `oz-nudge.json`, emits generic idle nudges when Deb is present, and sends `oscarDriver.nudge(text)` (`packages/core/src/runner/runner.ts:1101-1185`).

Existing stop handling is already modeled as `StopRequestedError`: the `try` around the loop catches it and returns `stopRun()` (`packages/core/src/runner/runner.ts:1529-1532`). `stopRun()` records `run-stopped`, abandons the active atom, quarantines active-atom output, writes terminal history, and returns status `stopped` (`packages/core/src/runner/runner.ts:1314-1350`). The current stop signal is an `AbortSignal`; `RunnerDeps.signal` exists (`packages/core/src/runner/runner.ts:118`) and is threaded into directive waits, monitors, verify waits, triage waits, and wrap Play dispatches (`packages/core/src/runner/runner.ts:1085`, `packages/core/src/runner/runner.ts:1174`, `packages/core/src/runner/runner.ts:1362`, `packages/core/src/runner/runner.ts:1489`, `packages/core/src/runner/runner.ts:1393`).

**Recommended insertion point:** wire the file-based founder stop signal into the existing `StopRequestedError` path at the reusable wait primitive boundary, starting with `runMonitor` before it judges or nudges (`packages/core/src/runner/monitor.ts:102-103`) and `pollFile` before each artifact poll (`packages/core/src/runner/io.ts:90-94`). That keeps one runner-owned stop disposition while cutting off all monitor-sourced nudges before they can call `deps.nudge(...)` (`packages/core/src/runner/monitor.ts:135-140`).

## 2. STOP/TEARDOWN SURFACES TODAY

`cocoder oz teardown` is parsed in the CLI at `packages/cli/src/run.ts:87-106`; it probes the daemon and calls `teardownViaDaemon(...)` (`packages/cli/src/run.ts:99-105`). The client posts to `/runs/:id/teardown` with loopback bearer + CSRF headers (`packages/cli/src/client.ts:28-43`). The HTTP route dispatches `POST /runs/:id/teardown` to `teardownRun(...)` (`packages/daemon/src/routes.ts:901-909`).

`teardownRun` aborts the live stop controller if present, closes run surfaces, records a `teardown` event, appends audit, and emits `run-torn-down` (`packages/daemon/src/launcher.ts:758-777`). Its close primitive is `closeRunSurfaces(...)`, which closes stored session refs by durable ref/workspaceRef (`packages/daemon/src/launcher.ts:656-750`). The code comment names this the one kill primitive for teardown and orphan sweep, not a loop-only halt (`packages/daemon/src/launcher.ts:608-614`).

`POST /runs/:id/stop` is routed separately to `requestStopRun(...)` (`packages/daemon/src/routes.ts:911-913`). `requestStopRun` gets the run's `AbortController`, rejects non-live/non-running rows, calls `controller.abort()`, appends a stop audit entry, emits `stop-requested`, and returns `202 {stopping:true}` (`packages/daemon/src/launcher.ts:780-793`). The controller is created per launched run and passed into `runRun` as `signal` (`packages/daemon/src/launcher.ts:553-563`); `onRunCreated` stores it in `ctx.stopControllers` (`packages/daemon/src/launcher.ts:563-568`).

The important difference: teardown closes panes immediately via `closeRunSurfaces`; stop first signals the runner. But current daemon stop is not a pure "halt loop and leave panes open" path: `attachRunLifecycle` closes run surfaces after a stopped run settles when the controller was aborted, recording `stop-teardown` (`packages/daemon/src/launcher.ts:434-445`). Daemon tests pin that today: the stop test expects status `stopped`, killed surfaces, `run-stopped`, and `stop-teardown` (`packages/daemon/tests/mutations.test.ts:912-949`).

No persona-accessible halt-the-loop-only file path exists today. Search evidence: `rg -n "stop-signal|stop signal|founder stop|stop the run|run-stop|stop-request|stop-requested|stop.json|stop-.*json|halt.*loop" packages/core/src packages/daemon/src packages/personas/base cocoder/personas cocoder/standards docs cocoder/decisions cocoder/tickets` found only ticket 0031, daemon `stop-requested`, and existing `StopRequestedError`/stop docs; no `stop.json` or persona file artifact owner exists.

## 3. WATCHER/NUDGE OWNER

ADR-0013 owns the tier model: Oscar monitors Bob, Deb monitors/nudges Oscar, Oz monitors/nudges Oscars, and the invariant is "you direct only your immediate primary" (`cocoder/decisions/0013-orchestration-observation.md:46-54`). It also clarifies the mechanical owner: `readScreen`/`sendInput` belong to runner-held `SessionHost` handles, not the agent pane (`cocoder/decisions/0013-orchestration-observation.md:56-63`).

ADR-0016 owns Deb's status and nudge surfaces. It says Deb gets runner-owned file surfaces like `directive-n.json` / `verify-n.json` / `triage-i.json` (`cocoder/decisions/0016-deb-scoped-repair-fallback.md:32-35`) and writes `deb-nudge.json` with `{target:"oscar", message, rationale, seq}` for the runner to deliver (`cocoder/decisions/0016-deb-scoped-repair-fallback.md:45-50`). `nudge.ts` enforces `target: "oscar"` and rejects other targets (`packages/core/src/runner/nudge.ts:1-4`, `packages/core/src/runner/nudge.ts:22-27`).

Runtime watcher ownership lives in `runner.ts`. The runner defines `debNudgePath = join(runDir, 'deb-nudge.json')` and `ozNudgePath = join(runDir, 'oz-nudge.json')` (`packages/core/src/runner/runner.ts:911-918`). `wakeDeb` records `deb-watch-dispatch` and sends Deb a `DEB WATCH` prompt naming `deb-status.json` and `deb-nudge.json` (`packages/core/src/runner/runner.ts:920-930`). `refreshStatus` writes `deb-status.json` / `.md`, records `deb-status`, and wakes Deb (`packages/core/src/runner/runner.ts:932-945`).

The full-run Deb watcher starts at `startDebWatcher()` (`packages/core/src/runner/runner.ts:1038-1042`), reads `deb-nudge.json` (`packages/core/src/runner/runner.ts:1049-1055`), delivers to Oscar via `oscarDriver.nudge` (`packages/core/src/runner/runner.ts:1059-1060`), and records `oscar-nudge` with `source:"deb"` (`packages/core/src/runner/runner.ts:1066-1075`). Oz-authored nudges are written by the daemon to `oz-nudge.json` using atomic JSON (`packages/daemon/src/launcher.ts:811-820`) and consumed by the Oscar watchdog (`packages/core/src/runner/runner.ts:1132-1138`).

State to gate off on registered stop: stop must disable the monitor loops before `deps.nudge(text)` executes (`packages/core/src/runner/monitor.ts:135-140`), skip `wakeDeb(...)` dispatches inside `refreshStatus` (`packages/core/src/runner/runner.ts:932-945`), and prevent the post-atom `NEXT` dispatch to Oscar (`packages/core/src/runner/runner.ts:1525-1528`). Tests already pin Deb watcher startup/stop and nudge delivery (`packages/core/tests/runner.test.ts:2271-2295`, `packages/core/tests/runner.test.ts:2314-2380`, `packages/core/tests/runner.test.ts:2383-2457`).

## 4. DIRECTIVE/SIGNAL ARTIFACT CONVENTION

Directive artifacts are explicitly numbered transient IPC files. `directive.ts` says Oscar writes one directive file per loop turn, numbered `directive-<n>.json`, so there is no in-place mutation/staleness race (`packages/core/src/runner/directive.ts:1-5`). The directive schema currently allows only `{kind:"delegate", task, loop?}` or `{kind:"wrapup", pickup}` (`packages/core/src/runner/directive.ts:15-18`), and parsing rejects any other `kind` (`packages/core/src/runner/directive.ts:69-87`).

The launch prompt tells Oscar the first exact directive path (`packages/core/src/runner/prompts.ts:165-169`) and says chat is invisible because the runner is polling for the file (`packages/core/src/runner/prompts.ts:62-67`). The runner then awaits `directive-${n}.json` (`packages/core/src/runner/runner.ts:1356-1363`). After each atom it sends `NEXT` naming the next directive path (`packages/core/src/runner/prompts.ts:575-578`; `packages/core/src/runner/runner.ts:1525-1528`).

Verify artifacts follow the same path convention. `executeAgentStep` writes `verify-${atomIndex}.json` path into the verify dispatch (`packages/core/src/runner/agent-step.ts:230-238`), and `buildVerifyDispatch` tells Oscar to write `{"verdict":"pass"|"fail","reason":"<one line>"}` to that exact path (`packages/core/src/runner/prompts.ts:569-572`). `RunnerIO.awaitVerification` polls that file (`packages/core/src/runner/io.ts:29-35`, `packages/core/src/runner/io.ts:113-115`).

Polling convention lives in `pollFile`: parse exceptions mean "not ready yet", it checks stop signal before and after reads, fast-fails if the session exits, and sleeps `pollMs` between attempts (`packages/core/src/runner/io.ts:72-102`). Write helpers place runner-owned outputs in the same run dir: `fault-i.json`, `disposition-i.md`, `deb-status.json`, `pickup.md`, and `record.md` (`packages/core/src/runner/io.ts:119-150`).

A file-based stop signal should follow the same convention: persona writes a run-dir artifact; the runner reads/parses it and performs the actual stop. Ticket 0031 requires exactly that: persona writes a signal artifact and the runner performs the stop (`cocoder/tickets/open/0031-founder-stop-the-run-control-for-personas.md:31-44`).

## 5. PERSONA STOP CONTRACTS

The shared cross-persona host/process guardrail is in `packages/personas/base/shared-standards.md`. It says personas act on files, not host processes, and must not start/stop/restart/kill the Oz daemon, launch dashboard/browser with `open`, or drive `cmux` panes; the only sanctioned lifecycle command is documented run teardown and only when explicitly asked (`packages/personas/base/shared-standards.md:117-123`).

Oscar owns the wrap-up vs teardown distinction. `oscar.md` says wrap-up is content-only and no terminals are closed (`packages/personas/base/oscar.md:181-195`). It separately defines teardown as lifecycle, founder-explicit-only F20, and says never tear down proactively (`packages/personas/base/oscar.md:199-204`). The hard guardrail says use the provided mechanism and never kill processes or close windows by hand (`packages/personas/base/oscar.md:210-214`).

The wrap-up Play pins that teardown is explicit founder action: wrap-up is not teardown, no terminals are closed, and the founder may later explicitly say "kill" / "tear down" (`packages/personas/base/plays/wrap-up.md:30-32`). Its closeout contract requires "teardown requires an explicit founder request" (`packages/personas/base/plays/wrap-up.md:71-77`).

Bob inherits shared process safety and has no stop-specific role contract beyond completion evidence and scoped work (`packages/personas/base/bob.md:45-51`). Deb's role contract explicitly forbids process operation: "Touch the machinery as a PROCESS" is prohibited, including `scripts/oz.sh`, restarting/killing the daemon, opening the dashboard, or driving cmux (`packages/personas/base/deb.md:75-79`).

Oz is the exception because its authority is a daemon-gated tool surface. Oz's base persona says its tools include `stop` and `teardown`, and if no tool exists it must not perform the action another way (`packages/personas/base/oz.md:16-21`). ADR-0017 likewise defines Oz's bounded tools as daemon lifecycle operations (`cocoder/decisions/0017-oz-orchestration-persona.md:34-41`).

Ticket 0031 asks the new stop lane to reuse teardown's founder-explicit-only bar, but forbid persona self-stop: founder direction to any pane counts as approval; the persona writes a file signal; the runner stops (`cocoder/tickets/open/0031-founder-stop-the-run-control-for-personas.md:31-40`, `cocoder/tickets/open/0031-founder-stop-the-run-control-for-personas.md:46-53`).

## 6. TEST SURFACES

Core stop behavior is already partly pinned in `packages/core/tests/runner.test.ts`. It imports `StopRequestedError` (`packages/core/tests/runner.test.ts:7-31`) and defines fault events that must not happen on stop (`packages/core/tests/runner.test.ts:400`). Existing tests cover:

- abort while awaiting directive => status `stopped`, no work items, no fault/triage/integration (`packages/core/tests/runner.test.ts:850-877`);
- abort while monitoring Bob => active atom abandoned and quarantined (`packages/core/tests/runner.test.ts:879-931`);
- abort while awaiting verify => active atom abandoned and quarantined (`packages/core/tests/runner.test.ts:933-979`).

`packages/core/tests/runner-direct.test.ts` pins terminal portable history for stopped runs: an `awaitDirective` throwing `StopRequestedError` returns status `stopped`, writes terminal portable history, and records `run-stopped`/`run-end` (`packages/core/tests/runner-direct.test.ts:258-275`). Lower-level stop propagation is pinned in `io.test.ts` for aborted directive polling (`packages/core/tests/io.test.ts:52-57`) and `monitor.test.ts` for aborted monitor loops (`packages/core/tests/monitor.test.ts:71-75`).

Nudge/watcher patterns to extend are in `runner.test.ts`: idle Oscar nudge with Deb present (`packages/core/tests/runner.test.ts:1956-1989`), Deb status feed and watcher lifecycle (`packages/core/tests/runner.test.ts:2271-2295`), nonblocking Deb watch dispatch (`packages/core/tests/runner.test.ts:2297-2312`), Deb-authored nudge delivery (`packages/core/tests/runner.test.ts:2314-2336`), Deb watcher nudge during Bob build (`packages/core/tests/runner.test.ts:2338-2380`), and Oz/Deb nudge ordering (`packages/core/tests/runner.test.ts:2383-2457`).

Daemon HTTP stop is pinned in `packages/daemon/tests/mutations.test.ts`: cooperative stop of live launched run (`packages/daemon/tests/mutations.test.ts:912-949`), unknown run 404 (`packages/daemon/tests/mutations.test.ts:951-954`), terminal run 409 (`packages/daemon/tests/mutations.test.ts:956-966`), running row without controller 409 (`packages/daemon/tests/mutations.test.ts:968-977`), and CSRF 403 (`packages/daemon/tests/mutations.test.ts:979-983`). Teardown tests live in the same file and cover durable surface closure (`packages/daemon/tests/mutations.test.ts:1699-1867`).

Recommended new runner tests: extend `packages/core/tests/runner.test.ts` with a fake run-dir stop signal reader/writer pattern near the existing stop tests, then assert that after the signal is registered the run reaches `stopped` and event history contains no later `nudge`, `oscar-nudge`, `deb-watch-dispatch`, `builder-dispatch`, `verify-dispatch`, or `NEXT`-caused directive wait. Extend `packages/core/tests/io.test.ts` if the stop signal gets its own parser/poller, matching the existing directive/verify/nudge parser tests (`packages/core/tests/io.test.ts:16-115`).

## 7. ADR LANDSCAPE

ADRs and current-truth surfaces to align:

- ADR-0013: owns multi-atom loop, verify gate, monitor primitive, and tier authority rule (`cocoder/decisions/0013-orchestration-observation.md:20-54`). It also clarifies runner-held monitor handles (`cocoder/decisions/0013-orchestration-observation.md:56-63`).
- ADR-0016: owns Deb status, nudge, repair authority, and runner-owned file surfaces (`cocoder/decisions/0016-deb-scoped-repair-fallback.md:30-60`, `cocoder/decisions/0016-deb-scoped-repair-fallback.md:98-110`).
- ADR-0017: owns Oz as a bounded daemon-tool persona, including `stop`, `teardown`, `nudge`, and tier-3 boundaries (`cocoder/decisions/0017-oz-orchestration-persona.md:23-41`, `cocoder/decisions/0017-oz-orchestration-persona.md:76-95`).
- ADR-0023: owns the direct commit spine and names F20 as part of the strand/orchestrator-vanished failure lineage (`cocoder/decisions/0023-workspace-commit-spine.md:15-18`, `cocoder/decisions/0023-workspace-commit-spine.md:34-42`).
- ADR-0036: owns Oscar-Deb repair dialogue and explicitly keeps it daemon-resident, Bob-free, not a build-loop directive, and aligned with ADR-0013/0016 (`cocoder/decisions/0036-oscar-deb-repair-dialogue.md:1-7`, `cocoder/decisions/0036-oscar-deb-repair-dialogue.md:38-56`).
- `docs/orchestration-contract-ownership.md` already records the watcher/nudge owners and current loop execution path (`docs/orchestration-contract-ownership.md:56-60`, `docs/orchestration-contract-ownership.md:138-157`) and should be the current-truth surface to update after any accepted ADR/design.
- `docs/oz.md` / `docs/oz-launch.md` document current cooperative stop vs teardown behavior (`docs/oz.md:79-87`, `docs/oz-launch.md:68-75`), but they describe operator/Oz stop, not persona-authored file stop.
