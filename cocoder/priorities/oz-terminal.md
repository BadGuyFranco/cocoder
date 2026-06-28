---
id: oz-terminal
title: Oz terminal — replace the chat-window stub with a real streaming terminal, workspace-aware
---
## Objective

Replace the inert Oz chat-window stub with a **real, streaming terminal** that is the founder's live window onto the Oz persona session — so Oz output streams token-by-token (the chat stub never could: it is unwired mock state, `App.tsx` fakes a reply after 650ms and the `/oz/stream` endpoint was never built). This **completes the deferred streaming/SSE slice of ADR-0017** ("Oz is surfaced as the Oz Terminal panel — the window to the CLI"; streaming was explicitly deferred, not refused) and lands the terminal host as a sanctioned `SessionHost` driver (ADR-0002 C2 names "an Electron-hosted driver … added later without touching core").

**Verified when** the founder types into the Oz terminal panel and sees Oz's real persona-session output stream live (not a canned reply), and Oz performs each Iteration-1 capability below from that terminal with a runnable artifact as proof. The chat-stub mock path (`ozReply`, the 650ms timer) is deleted, not left beside the real path.

**Boundary:** this priority builds the **terminal surface + workspace-aware targeting + drag-drop**, riding the *existing* gated Oz authority (ADR-0040 `oz-action` + ADR-0017 lifecycle/read). It does **not** by itself grant Oz any new write authority. Every capability that would expand Oz's authority (Iteration 2) is fenced behind the Governance gate below and lands no build atom until its ADR is founder-approved.

## Iteration 1 — within Oz's existing approved authority (no new ADR)

These ride ADR-0040 (`oz-action`: tickets, `order.json`, narrow doc fixes, non-Objective priority edits —
built + proven) and ADR-0017 (lifecycle verbs + read-from-disk doctrine). The new work is the *terminal
surface* and *targeting*, not new authority:

- **a. Answer questions about what is running** — Oz reads run records / event streams / status feeds per
  ADR-0017 §4 information-source doctrine; the terminal just makes the conversation live.
- **b. File priorities and tickets in the right workspace** — conversational authoring already exists
  (ADR-0040 §3 + the `author` spine / `cocoder oz create-priority` CLI). The **new** part is
  *workspace-targeting*: Oz reads the active-workspace panel state, **discerns** the intended workspace,
  and **asks when unsure** rather than defaulting silently.
- **c. Make minor CoCoder fixes — governance/doc/config only.** Narrow doc fixes, ticket state, reorders,
  non-Objective priority edits — all already in `oz-action` scope (ADR-0040 §1). **Product/machinery code
  (`packages/*/src`) is excluded by ADR-0040 §4** and stays excluded in Iteration 1.
- **d. Fix an unlaunchable priority or ticket** — a governance-file repair (bad frontmatter, missing
  Objective, stale `order.json` entry, broken ticket fields). This is `oz-action`/Oz-repair governance
  surface (ADR-0017 repair verb, ADR-0040 §1), not target code.
- **e. Accept drag-and-drop from the workspace panel** — the founder drags a priority / ticket / run from
  the workspace panel onto the terminal to ask about it. The dropped payload carries **the workspace id +
  the item kind + the item slug** as a reference Oz resolves and reads. Pure new dashboard/IPC UI; no new
  authority.

## Iteration 2 — authority expansion, behind the Governance gate (post-launch)

Each of these **reverses or extends a standing decision** and must not ship in Iteration 1:

- **f. Autonomously orchestrate runs** (answer obvious founder questions in a run, fix a minor CoBuilder
  orchestration issue, teardown a wrapped run, start the next priority/ticket). Collides with the **tier-3
  boundary** (ADR-0017: Oz never bypasses a session's manager) and the **interference rail** (ADR-0041
  §3.1: anything touching the runner or target code routes to the founder; even Deb may not commit it).
- **g. Notice and fix documentation drift.** The *detection mechanism* is owned by
  `harden-documentation-process` (active) and `agentic-pattern-drift-detection` (backlog), and the founder
  notes this should also be a Deb/Oscar attribute. Oz's role here is limited to **acting on findings**
  within `oz-action` doc scope; this priority must not fork drift detection.
- **h. Discernment about what SHOULD need a founder decision.** ADR-0040 and ADR-0041 deliberately made the
  reversible/irreversible and interference lines **code-level / mechanical, not agent judgment**. Letting
  Oz judge the boundary is a philosophical reversal of that posture and needs explicit founder sign-off.
- **i. Per-workspace autonomy flag** — grant Oz autonomy per workspace. New governance mechanism touching
  ADR-0019 (multi-root), ADR-0027 (workspace storage), and the active `multi-workspace-concurrency`
  priority.

## Governance gate (first deliverable, before any Iteration-2 build atom)

Following the `oz-autonomy` precedent (a priority that reversed standing decisions opened with one new
founder-approved ADR before any build atom): Iteration 2 is gated by **one new ADR** that amends/extends
**ADR-0017** (tier-3 boundary + bounded tool surface), **ADR-0040** (reversible/irreversible code-level
line; product-code exclusion), and **ADR-0041** (the mechanical interference rail; founder is the
disposition authority for interfering changes). The ADR must define: which run-lifecycle actions Oz may
take autonomously vs. founder-gated; whether/how the per-workspace autonomy flag (i) sets that line; and
whether "discernment" (h) is admissible at all or stays mechanical. **No Iteration-2 build atom lands
before this ADR is founder-approved.** Iteration 1 needs no new ADR and may proceed.

## First research gate (Iteration 1 open questions — resolve in the first run)

- **Terminal mechanism (the real architecture fork).** Two candidates: (1) **xterm.js + node-pty embedded
  in Electron** — a new Electron-hosted `SessionHost` driver (ADR-0002 C2), but a **native module**
  (electron-rebuild per Electron version *and* per arch, vs the app's `sandbox: true`/`contextIsolation:
  true` posture, plus mac signing/notarization cost); vs (2) **stream the existing daemon-hosted Oz
  persona session** (cmux `SessionHost`, ADR-0017 amendment "the daemon owns Oz's session") into the panel
  over SSE — no new native module, reuses the substrate. Pick before building; do not assume xterm.js.
- **Targeting mental model.** The founder's note: the Oz terminal may **not** need to be restricted to a
  single target/workspace — Oz is long-lived and cross-workspace by design (ADR-0017). Resolve how Oz
  *discerns* the active workspace for (b)/(e) and when it must ask, without imposing a `scopeNarrowing`
  restriction that contradicts its cross-workspace nature.
