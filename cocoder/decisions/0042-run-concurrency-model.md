# ADR-0042 — Run concurrency model: per-workspace today, cross-workspace next, intra-workspace deferred to v2

**Status:** Accepted (founder + Claude, 2026-06-25). Records the concurrency model and **defers intra-workspace concurrency to v2.**
**Seam:** how many runs may execute at once, and what shared mutable state forces serialization.
**Builds on:** [0023](./0023-workspace-commit-spine.md) (direct-to-branch commit spine; no live worktree
or run-branch lane) · [0041](./0041-orchestration-ownership-and-actor-authority.md) (per-workspace
`inFlight`, actor authority, run-wrap audit).
**Revisits:** [0015](../zArchive/v2/decisions/0015-isolated-working-state-per-run.md) (run-branch isolation + auto-merge, archived) and [0034](./0034-retire-adr0015-merge-machinery.md) (retired 0015's merge/landing code). Intra-workspace concurrency (below) re-opens what 0034 closed — knowingly, and only when the value justifies the merge complexity.

## Context

The orchestration engine serializes work much more tightly than founders expect. Three distinct concurrency needs surfaced (2026-06-25):

1. **Author a priority/ticket *during* a run** (same workspace) — highly likely day-to-day; today refused.
2. **Concurrent runs in the *same* workspace** on disjoint surfaces — desirable but not urgent.
3. **Concurrent runs across *different* workspaces / repos** — a primary reason CoCoder exists (run multiple repos at once).

The serialization is **not** a global single-run lock. The guard is **per-workspace**: `ctx.inFlight` is a `Map<workspaceId, runId>`, and every refusal checks `inFlight.has(workspaceId)`. What actually forces serialization is **shared mutable state**, of which there are exactly two kinds:

- **The working tree** — one checkout, one branch *per workspace*. ADR-0023 made runs commit directly to
  the active branch; its original opt-in isolation lane was removed by Amendment 2, and ADR-0034 removed
  the merge machinery. This is what makes two writers in one workspace unsafe.
- **The daemon process** — a single Node process. Some checks gate globally on `inFlight.size > 0` (e.g. daemon self-reload) even though the run model is per-workspace.

Mapping the three needs onto those two shared resources is the whole decision.

## Decision

**The concurrency model is three-tier, sequenced by cost and risk:**

### Tier 1 — Author governance during a run (near-term; a ticket)
Authoring spawns an agent and **commits to the shared working tree**; a commit mid-run interleaves with atom commits and lands out-of-ledger in the run's wrap-audit window (the run_238 churn). The fix does **not** touch the run model: **queue the authoring request and execute it at a safe boundary** (wrap, or a quiescent atom-commit seam), and for founder-supplied bodies skip the authoring agent entirely (a deferred lightweight governed write). Governance files (`cocoder/tickets`, `cocoder/priorities`, `cocoder/decisions`) are disjoint from the run's code lane — the only conflict is commit *timing*, not file overlap. Tracked as a ticket; the dashboard must also surface/queue the 409 rather than fail silently.

### Tier 2 — Concurrent runs across different workspaces (next; a priority)
**Different workspace = different repo = no shared working tree.** The thing that forces serialization in Tiers 1 and 3 is simply absent across workspaces, and the model already keys on it (`inFlight` per workspace, atomic run-counter, WAL store keyed by workspace/run, per-workspace cmux surfaces). The remaining work is **not** an architecture change — it is: (a) audit the daemon for global mutable state that assumes one active run; (b) make the few `inFlight.size`-coupled global checks per-workspace where they should be; (c) load-test two repos running at once; (d) bound resource/cost (N runs ≈ 3N agents + model spend). Tracked as a priority — this is the strategic unlock.

### Tier 3 — Concurrent runs in one workspace, disjoint surfaces (v2; this ADR)
This is the genuinely hard one, and it is hard **because of ADR-0023**: two runs editing different files
but committing to one branch/tree cross-contaminate (the commit-gate commits the whole changed tree;
quarantine/self-commit detection assumes one writer; there is no isolation to keep them apart).
Supporting it requires **re-introducing per-run isolation** — designing a new worktree lane (or per-run
branches) **plus a landing/merge step**, i.e. partially reversing ADR-0034. "Disjoint surfaces" is also
hard to prove safe statically. **Deferred to v2.** When taken up, it becomes its own priority; the
merge/landing design must be re-derived, not resurrected from ADR-0015 verbatim.

## Consequences

- **Near-term:** founders can author during a run once Tier 1 ships; until then, author between runs (no run active) or expect a clear "a run is active — queued" message.
- **Strategic:** multi-repo concurrency (Tier 2) is achievable without re-architecting — it is validation + hardening, and should be prioritized as the capability that defines CoCoder.
- **Deferred cost:** intra-workspace parallelism (Tier 3) stays single-threaded until v2; this is the deliberate price of ADR-0023's direct-to-branch simplicity. Re-opening it is a real merge-complexity project, entered only when disjoint-surface parallelism proves worth it.
- **Invariant preserved:** the per-workspace `inFlight` guard, the run-wrap audit, and direct-to-branch commits all stay as-is for Tiers 1 and 2; only Tier 3 disturbs them.
