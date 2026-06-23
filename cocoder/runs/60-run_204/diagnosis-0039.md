# Ticket 0039 Launch Delay Diagnosis

## Ordered Launch Path

1. `launchRun` enters in `packages/daemon/src/launcher.ts`.
   - I/O: none before validation and the in-flight reservation.
   - Expected cost: negligible.

2. Run input is assembled.
   - Priority launch: `findWorkspace`, `loadPriority`, `readFile(shared-standards.md)`, `loadAssignments`, `listEffectivePlays`, `resolveMandatoryPlay`, `resolveEffectivePersona` for Oscar/Bob/Deb, and optional pickup read on resume.
   - Ticket launch also reads the ticket tree before the same assembly path.
   - I/O: filesystem reads and markdown/JSON parsing.
   - Expected cost: low tens of ms on a local disk; higher on NAS-backed storage but not normally seconds.

3. The stale-daemon guard runs before the run row exists.
   - `headShaOrUnknown` shells through the git adapter for the install root HEAD.
   - `daemonRuntimeStale` is cheap when `bootSha === headSha`; if stale, it runs `git diff --name-only bootSha headSha`.
   - I/O: git subprocesses; the diff path is conditional.
   - Expected cost: tens to low hundreds of ms when not stale; potentially more if stale over a large range.

4. `runRun` creates the run row and records early runner state.
   - Synchronous run creation triggers `onRunCreated`, then the runner ensures the run dir and records `run-start`.
   - I/O: DB write and run directory creation.
   - Expected cost: low ms.

5. Runner preflight checks Oscar and Bob.
   - I/O: adapter-specific CLI readiness checks.
   - Expected cost: adapter dependent; should be bounded and visible through existing `preflight` events.

6. Direct-mode git and pre-run integrity checks run.
   - `git.isGitRepo`, `git.headSha`, `git.currentBranch`, `git.changedFiles`, governance integrity checks, and possible pre-run snapshot commits for founder/governance dirt.
   - I/O: git subprocesses plus filesystem reads of governed files.
   - Expected cost: tens to hundreds of ms on a clean repo; can be seconds if pre-run snapshot commits are required.

7. Portable run history is written.
   - I/O: filesystem writes under `cocoder/runs/<display>-<runId>/`.
   - Expected cost: low ms to low tens of ms.

8. Effective Play manifests and launch prompts are built.
   - I/O: `listEffectivePlays` reads Play surfaces; prompt rendering is CPU/string work.
   - Expected cost: low tens of ms.

9. Oscar spawn starts through `trackingHost(...).spawn`.
   - New instrumentation records `launch-spawn-start` and `launch-spawn-end` around this whole call.
   - I/O: delegated to the session host.
   - Expected cost: dominated by cmux below when Oscar is visible.

10. `CmuxSessionHost.spawn` ensures the host is reachable.
    - It first runs `cmux ping`.
    - If the socket is down, it runs `open -a cmux`, then polls `cmux ping` every 1000 ms until success or 15 s.
    - I/O: one or more cmux CLI subprocesses plus the macOS app launch.
    - Expected cost: warm host is one CLI round trip; cold host has an intentional 1000 ms polling granularity and can add multiple seconds before any pane appears.

11. Oscar's first visible cmux pane is created.
    - Serial cmux calls: `new-workspace`, `list-pane-surfaces`, best-effort `rename-tab`, `send`, `send-key`, best-effort `focus-pane`.
    - I/O: six serial cmux CLI subprocess round trips after the initial `ping`; script file write also occurs before `send`.
    - Expected cost: each subprocess round trip is individually small, but serial launch of 6-7 calls is a plausible multi-second contributor on a slow host/NAS-backed shell environment.

12. Bob spawn starts after Oscar spawn finishes.
    - Serial cmux calls: `ping`, `list-panes`, `new-split`, `list-panes`, `list-pane-surfaces`, best-effort `rename-tab`, `send`, `send-key`, best-effort `focus-pane`.
    - I/O: nine serial cmux CLI subprocess round trips plus a script file write.
    - Expected cost: likely larger than Oscar's first pane because split discovery uses two `list-panes` calls around `new-split`.

13. Deb spawn, when enabled, starts after Bob spawn finishes.
    - It repeats the split path: `ping`, `list-panes`, `new-split`, `list-panes`, `list-pane-surfaces`, best-effort `rename-tab`, `send`, `send-key`, best-effort `focus-pane`.
    - I/O: another nine serial cmux CLI subprocess round trips plus a script file write.
    - Expected cost: same class as Bob.

14. The runner focuses Oscar and waits for the first directive.
    - I/O: another best-effort focus through the session host, then file polling for the directive.
    - Expected cost before pane visibility: not the reported click-to-pane gap unless the founder is measuring until Oscar is refocused rather than until any pane appears.

## Dominant-Cost Verdict

The code trace points to branch **(b): genuine fixable inefficiency**.

The strongest explanation for a warm-host ~6 s click-to-pane delay is the serialized cmux CLI subprocess chain. A normal Oscar + Bob launch performs about 16 serial cmux CLI round trips before both panes are ready. With Deb enabled, that rises to about 25 serial round trips. The first pane does not appear until after the warm `ping`, `new-workspace`, `list-pane-surfaces`, optional `rename-tab`, script write, `send`, `send-key`, and `focus-pane` sequence completes.

Cold cmux startup is a separate dominant case: if the socket is down, `#ensureHost` intentionally adds `open -a cmux` plus a 1000 ms polling loop up to 15 s. That can easily exceed 6 s, but it should only happen when cmux is not already reachable.

Run-input assembly and stale-daemon git checks are real pre-spawn work, but the code path is mostly filesystem reads and a small number of git calls. They are worth measuring, especially on the NAS path, but they are unlikely to dominate a repeatable ~6 s delay unless the repo is dirty enough to trigger pre-run snapshot commits.

## Instrumentation Added

New store events:

- `launch-entry`: recorded once the run row exists, with elapsed ms from `launchRun` entry.
- `launch-run-input-assembled`: elapsed ms after run-input assembly.
- `launch-stale-check-finished`: elapsed ms plus `bootSha`, `headSha`, and stale verdict.
- `launch-run-created`: elapsed ms at run-row creation.
- `launch-spawn-start`: per visible persona, just before session-host spawn.
- `launch-spawn-end`: per visible persona, with `persona`, `ref`, `workspaceRef`, `ms`, and `ok`.
- `cmux-spawn-timing`: real cmux launches only, one aggregate payload per spawn with `totalMs`, `hostLaunched`, `hostReadyMs`, and ordered `{ cmd, ms }` entries for each cmux CLI call.

## Recommendation

Follow branch **(b)**.

Use the new `cmux-spawn-timing` events from the next real launch to confirm which calls dominate. If the warm-host data shows multiple similar subprocess costs, reduce or parallelize the cmux call chain:

- Elide or defer best-effort `rename-tab` and `focus-pane` from the critical path.
- Avoid the second `list-panes` round trip if cmux exposes the new pane/surface reliably from `new-split` or another structured command.
- Consider spawning Bob/Deb only after Oscar is visible, or show Oscar immediately and continue secondary pane setup asynchronously, if orchestration semantics allow it.
- Keep the cold-launch path separate: if `hostLaunched: true` and `hostReadyMs` dominates, replace the fixed 1000 ms readiness poll with a shorter bounded cadence or preflight cmux earlier from Oz.
