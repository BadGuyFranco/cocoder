# Runner lifecycle & scope hardening — overview & index

**Status:** ready to execute. Split into two playbooks by evidence strength; execute **A first, B after A lands.**

- **Playbook A — `docs/playbook-a-scope-failure-remediation.md`** — the *evidenced, urgent* track (an
  actual run failed: run_287). Ratify the scope model, fix the misleading prose, make scope misses
  non-terminal: committed, flagged, and surfaced for a founder decision — never a stop, never a bounce.
  **Shipped this session** (ADR-0045; 714 core tests green).
- **Playbook B — `docs/playbook-b-scope-adjudication-model.md`** — the *principled* track (no incident yet;
  prevents silent committed drift). The out-of-lane adjudication loop + persona alignment. **Gated behind A.**
- **Tickets (not playbooks):** two items below are design-first and should be filed via the governed
  create-ticket path, not bundled.

The split is deliberate: the speculative half (B) must not pressure or delay the proven half (A).

---

## The one principle (both playbooks)

> The runner converts *recoverable orchestration conditions* into *terminal run failures*, and enforces
> scope at the *wrong layer/mode*. The commit gate already got it right — scope is advisory, every changed
> path commits, out-of-lane is flagged (`gate.ts:5-6`, F21 / ADR-0023 Amendment 2). Propagate
> **recoverable + advisory + surfaced-for-decision** through every layer.

**Invariant:** (1) an allow-list scope miss is never a stop — the write is committed, flagged, and surfaced
for a founder decision (no `fail()`, no bounce); the only hard gates are the **targeted root** and an
**explicit destructive deny-list** (`auditWriteBoundary`);
(2) out-of-lane writes are committed, flagged, then **adjudicated** by Oscar at wrap (ratify or escalate to
founder in plain English); (3) founder-facing surfaces state what actually happened, never a stale
"withheld" claim.

---

## Already shipped this session — DO NOT redo (verify present, build on it)

run_283 stranding fix — **implemented, 707 core tests green, uncommitted on `main`**:
- `runner/status.ts` — delivery-aware `deriveTerminalProjection` (failed-with-delivery → `wrapped`/standing-by),
  `wrapupDeliveryDispatched()`, `terminalWaitCondition(status, deliveryDispatched)`.
- `runner/runner.ts` — wrap-exit passes the delivery flag; WRAP-UP READY send records its **outcome**
  (`delivered: true|false` + `error`).
- `runner/index.ts`, `src/index.ts` exports; tests in `tests/{runner,status}.test.ts`.
If absent, recreate from this session's diff before starting A.

**Playbook A — shipped this session (714 core tests green).** ADR-0045 ratifies the model (root hard,
intra-root advisory, audit-deny the only hard intra-root gate); a scope miss is **write-commit-flag-surface,
not a bounce**. Both scope `fail()`s are gone — pre-dispatch records an advisory and dispatches;
mid-build `authority-scope-conflict` becomes a proceed-nudge (non-scope `reported-blocker` still faults). The
builder prompt no longer primes Bob to self-block on location; the landing prose is honest; `oscar.md` /
`bob.md` routing is reframed to route-and-surface; `ARCHITECTURE.md` and the `multi-workspace-concurrency`
priority are updated. **Playbook B must NOT redo the ADR, the ARCHITECTURE/priority edits, or the
oscar/bob routing reframe** — it only adds the wrap-time adjudication loop (WI-B1) and describes it (WI-B2).

## run_283 reconciliation — NOT needed (decided, with evidence)

Traced the read path: the dashboard surfaces `run.status` from the store (frozen `failed`, which is
**correct**); the UI reads daemon endpoints; **nothing outside the runner re-derives
`deriveTerminalProjection`/`renderDebStatus`.** The stranded `deb-status.json` is an inert, historically
accurate artifact (run_283 genuinely stranded under old code). No reconcile pass — building one would be
low-value and would falsify the bug record. Forward-only fix is the right scope.

## Evidence map (shared by A and B)

- `commit-gate/gate.ts:5-6` "Scope is visibility, not a commit suppressor" (F21); `:72` `committable = changed`;
  `:91-92` `out-of-scope-committed` flag; `:63-69` `auditWriteBoundary` = the ONLY hard gate.
- `runner/runner.ts:1525-1544` pre-dispatch scope check → was `fail()`; **A replaced it with a non-fatal
  `builder-scope-advisory` event + normal dispatch (no stop).**
- `runner/agent-step.ts:291-296, 373-374` mid-build self-block → was `fail('builder-blocked')`; **A made
  `authority-scope-conflict` a one-time proceed-nudge; non-scope `reported-blocker` still faults.**
  Classifier `runner/blocker.ts:12, 34-45` (unchanged — still classifies the category, the runner just
  routes it to a nudge instead of a fault).
- `runner/runner.ts:1115-1120` `absorbGateResult` — out-of-lane files ARE committed (visibility flag).
- `runner/runner.ts:1643-1645` landing prose falsely says out-of-lane "not included in builder atom commits".
- `runner/runner.ts:509, 516-533` pre-run `founder: pre-run WIP snapshot` mis-attributes leftover agent dirt.
- `plays/founder-closeout.ts:77` `replaceFounderCloseoutCommitState()` (commit `0eb2c47`) — commit-state hook.
- `git ef0df5b` removed prose-inferred hard-blocking; `git 921f12a` run_287 Deb oscar.md patch (**reconciled
  in A** — kept "compare target paths to recipient surface," removed the hard-block wording, now route-and-surface).
- `cocoder/decisions/0032` retired the formal "playbooks" genre (these are work-orders, not that genre).

## Required checks (every playbook)
```
pnpm --filter @cocoder/core test
pnpm -w typecheck
node scripts/check-topology.mjs
```
Add `pnpm --filter @cocoder/personas test` for any persona/prompt change.

## Non-goals / do not touch (every playbook)
- No restarting/killing Oz, cmux, browsers, daemon. Files only. `rg` first.
- Do not reopen ticket 0083 or relaunch priorities.
- Do not make scope *more* restrictive anywhere, or re-add a hard intra-root block.
- Keep base personas portable (ADR-0012). Preserve unrelated work.
- Do not weaken a test to make it pass (cf. `git 32785cf`) — pin the new invariant honestly.

## Deferred to tickets (file via the governed create-ticket path — do NOT hand-author ticket files)

- **T-1 — Pre-run dirt mis-attribution.** Leftover *agent* dirt from a failed run is committed as
  `founder: pre-run WIP snapshot` under the founder's identity (`runner.ts:516-533`), never understood.
  Distinguish orphaned agent dirt from founder WIP (by author? prior-run-failed flag? path?) — design-first,
  must not re-add the strictPreRunDirt hard-stop for genuine founder WIP. *The real silent-drift vector;
  genuinely hard; own ticket.*
- **T-2 — Watcher-stop honesty.** A deliberate `stopDebWatcher()` records `deb-watch-stopped: dead`
  (`monitor.ts:113-114`) as if the pane crashed. Cosmetic (only drives `watch.active=false`, already correct)
  but dishonest; distinguish graceful stop from pane death. *Low priority.*
