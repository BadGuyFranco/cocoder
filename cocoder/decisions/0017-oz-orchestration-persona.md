# ADR-0017 — Oz orchestration: Oz is a CLI-backed persona in a window, with a bounded tool surface

**Status:** Accepted (founder + Claude, 2026-06-09). **Amended 2026-06-12** (founder + Claude, run_59 post-wrap): hosting decided, verb surface extended, Refresh Oz added — see the Amendment section. **Amended 2026-06-23 ([0040](./0040-oz-write-side-autonomy.md))**: the bounded tool surface gains the `oz-action` self-direct *write* actions (reversible edits to existing governance) and a conversational `author` round; the read-from-disk doctrine and lifecycle bounding are unchanged — the surface stays a fixed, gated vocabulary, not free rein.
**Builds on:** [0005](./0005-personas-and-subtasks.md) (personas run as CLI sessions via an adapter), [0006](./0006-adapter-contract.md) (adapter contract), [0013](./0013-orchestration-observation.md) (the three-tier observation hierarchy; Oz = tier 3).
**Relates to:** [ADR-0008 (v1 tree)](../zArchive/v1/decisions/0008-oz-control-plane-architecture.md) (Oz control plane). **Supersedes** the run_46 `parseOzCommand` daemon stub *as the human-facing interface* (that stub is retained as Oz's action layer — see Consequences).

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
  *(The hosting question is no longer deferred — resolved by the 2026-06-12 Amendment below.)*

## Amendment — 2026-06-12 (founder + Claude, decided in conversation at run_59 wrap)

Four decisions, extending — not reversing — the 2026-06-09 acceptance:

1. **Hosting resolved: the DAEMON owns Oz's session, lifecycle-synced.** Oz starts when the daemon
   boots and restarts when the daemon restarts; the Electron app is only a window into that session
   (consistent with the standing "daemon stays headless and UI-independent" decision — a cron-driven
   or UI-less CoCoder still has Oz). This resolves the question the original ADR deferred.

2. **"Refresh Oz" is a first-class action** (founder-named), answering the context-accumulation worry
   for an agent overseeing many sessions: (i) restart the daemon; (ii) start a fresh Oz session, then
   close the old one; (iii) re-derive priorities and run statuses from current on-disk/DB state;
   (iv) re-display any live sessions. **v1 is idle-only** — it refuses while a run is in flight, the
   same guard the daemon's restart endpoint already enforces, because the loop driving a run lives in
   the daemon process and restarting would orphan it. *Adopting a live run across a restart is a
   distinct future capability with its own ADR, not part of this amendment.* Refresh doubles as the
   code-refresh path (the daemon serves code loaded at boot) and as the tail of Oz's self-repair loop.

3. **Verb surface extended.** Beyond the existing gated lifecycle verbs (launch / show / stop /
   teardown / status / adhoc / resolve / create-priority / reorder), Oz gains:
   - **nudge** — delivered by the RUNNER to a session's OSCAR only, reusing the existing Deb-nudge
     channel mechanics. This is sanctioned by ADR-0013's authority rule as written: Oscar IS Oz's
     immediate primary ("you direct only your immediate primary; you may observe deeper"). The hard
     line stands: Oz never writes into Bob's or Deb's panes — one manager per agent.
   - **repair** — Oz-level repair only: daemon config, assignments, governance docs, and Oz's own
     operation. In-run orchestration faults remain DEB's (ADR-0016); where an Oz repair touches
     machinery code it reuses the same repair primitive and gate-commit discipline (one repair
     system, two tiers — the same way tier-2/3 oversight reuses the tier-1 monitor primitive).
     The self-repair loop is: diagnose → fix files → Refresh Oz (the restart makes the fix live) →
     relaunch/resume affected work.
   - **refresh** — the Refresh Oz action above.

4. **Information-source doctrine.** For session FACTS (status, progress, verdicts, faults) Oz reads
   the runner-produced artifacts directly — run records, event streams, status feeds, directive/verify
   files — never burning a model call or another agent's context for what disk already knows. For
   INTERPRETATION ("why does this run feel stuck?") Oz asks DEB, the idle observer with the session's
   context. Oscar is nudged through the runner channel, never queried mid-run: his input channel
   carries the loop's verify/next-or-wrap protocol and free-form questions would interleave with it.

**Tier-boundary restatement (current truth, replacing looser summaries):** "Oz never orchestrates"
means **Oz never bypasses a session's manager** — he directs Oscars (his immediate primaries), observes
anyone, and runs lifecycle + system-level repair. It has never meant Oz is passive: every verb above is
an action.

**Build note for the next slice:** Oz needs a long-lived *conversational* session; the adapter contract
(ADR-0006) today covers launch-and-run, so slice 1 may need a deliberate contract extension (the run_59
headless-Oscar machinery — captured one-shot turns reconstructing state from artifacts — is most of the
host). The slice's Objective lives in the full-oz-dashboard Playbook ("Recommended next slice").
