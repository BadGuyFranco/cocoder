# ADR-0017 — Oz orchestration: Oz is a CLI-backed persona in a window, with a bounded tool surface

**Status:** Accepted (founder + Claude, 2026-06-09).
**Builds on:** [0005](./0005-personas-and-subtasks.md) (personas run as CLI sessions via an adapter), [0006](./0006-adapter-contract.md) (adapter contract), [0013](./0013-orchestration-observation.md) (the three-tier observation hierarchy; Oz = tier 3).
**Relates to:** [ADR-0008 (v1 tree)](../../decisions/0008-oz-control-plane-architecture.md) (Oz control plane). **Supersedes** the run_46 `parseOzCommand` daemon stub *as the human-facing interface* (that stub is retained as Oz's action layer — see Consequences).

## Context

Every other persona — Oscar, Bob (codex), Deb — runs as a **CLI session in a pane**, backed by a
chosen CLI + model, launched by the daemon through an adapter ([ADR-0005](./0005-personas-and-subtasks.md)/[0006](./0006-adapter-contract.md)).
**Oz was the odd one out:** there is no Oz persona definition and no Oz session. What `run_46` shipped
for "Oz chat" (`POST /oz/messages` → `parseOzCommand`) is a **regex command parser inside the daemon**
standing in for Oz — the human must speak exact verbs (`launch <id>`, `stop <id>`, …) and there is no
agent on the other end.

The earlier framing (run_43 "Q1") posed a **false binary**: "a bounded command interface" *vs* "a
heavyweight in-daemon LLM agent." Both are wrong. The first is a syntax the human must learn; the
second implies inventing a custom LLM host inside the daemon. The founder's own mental model — "a
window to whatever CLI backs the Oz persona, inside the app" — is the correct third option, and it
dissolves the binary: a **real conversational agent** *and* **bounded authority**, built by **reusing
the persona → adapter → session machinery that already exists**, not by inventing a new one.

## Decision

**Oz is a first-class persona, backed by a CLI + model the founder chooses (like every other persona),
run as a long-lived session, surfaced as the chat window in the app — with a bounded set of tools that
map to the daemon's existing run-lifecycle operations.**

1. **Oz is a persona.** It gains a persona definition (an `oz` base persona) and a CLI+model
   assignment, exactly like Oscar/Bob/Deb. It is no longer a UI-only concept or a daemon parser.
2. **The app surfaces Oz's session as the chat window.** The Electron dashboard streams Oz's
   (long-lived, cross-workspace) session into the Dashboard's Oz Terminal panel — the "window to the
   CLI" the founder described. The dashboard already renders panes; this is that, pointed at Oz.
3. **Authority is a bounded tool surface, not free rein.** Oz acts only through a fixed vocabulary of
   tools that map 1:1 to daemon run-lifecycle ops (`launch` / `show` / `stop` / `teardown` / `status`,
   extended deliberately). The verbs `run_46` built become **Oz's tools**, invoked by the agent — not a
   grammar the human types. This preserves the existing loopback/Bearer/CSRF posture: every Oz action
   is one of the daemon's already-gated operations.
4. **TIER-3 is preserved ([ADR-0013](./0013-orchestration-observation.md)).** Oz commands run
   *lifecycle* and *observes* (polls) Oscars/Bobs/Debs across sessions; it **never** reaches in and
   orchestrates a Bob directly. The bounded tool surface is the enforcement of that boundary.

## Consequences

- **The `run_46` command-parser is not wasted** — it is retained as Oz's **action layer** (the safe,
  gated operations the agent calls). What changes is *who speaks the verbs*: the agent, not the human.
- **The real work is session hosting, not an LLM.** Unlike the per-run agent panes (one per run), Oz's
  session is **long-lived and cross-workspace** — the daemon (or the app as a client) must host it and
  the app must stream it. That hosting is the design/build effort this ADR authorizes; there is **no**
  custom in-daemon LLM.
- **Boundary holds:** rides the existing `core` ports + daemon/ui; no fork. New surface = an Oz persona
  definition + a long-lived-session host + the app's stream into the Oz Terminal panel.
- **Deferred:** streaming/SSE polish, and the exact division of "daemon hosts the session" vs "app
  hosts it as a client" are earned during build, not fixed here. The minimal first slice is an Oz
  persona + session host + the existing tool surface wired as the agent's tools.
