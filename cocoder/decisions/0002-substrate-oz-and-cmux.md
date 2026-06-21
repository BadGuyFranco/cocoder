# ADR-0002 — Substrate: Oz brain + cmux terminal host (seam S1)

**Status:** Accepted (founder + Claude, 2026-05-28)
**Seam:** S1 — Terminal host & substrate
**Charter:** [0001](./0001-rebuild-charter.md) · **Touches seams:** S2 (data model), S4 (Oz↔runner), S6 (adapter/sandbox)

## Context

v2 runs model **CLIs as visible processes** (charter locked decision: Path B). S1 asks *who
owns the terminal sessions and how does the founder watch them*. Options weighed:
Oz-Electron hosting terminals itself · Oz + cmux · Oz + tmux (durable) · Oz-Electron viewer
over tmux.

cmux is a native macOS terminal purpose-built for AI coding agents (vertical tabs with git
status, read-screen, notification rings, a Unix socket API). It is **AGPL-3.0** and
**macOS-only**, and its session survival is weaker than tmux's detach/reattach.

## Decision

**Oz is the brain** (priorities, runs, persona→CLI/model, run records). **cmux is the
terminal host** where agents run and the founder watches, driven over its Unix socket API.
Adopted with three commitments that make the adoption safe and reversible:

### C1 — The terminal is disposable; run-state is durable and owned by Oz.
The system of record for a run (its identity, open work-items, produced commits, evidence)
lives in Oz's data model (seam S2), **never** in the terminal session. On interruption (cmux
or laptop restart), Oz **relaunches the agent into a fresh pane** and the agent re-reads its
run state and continues. The terminal is a *view onto* a run, not its source of truth. This
neutralizes cmux's weak session survival and directly attacks the F6/F8 run-lifecycle failure
class. **Founder accepted relaunch-from-durable-state over true (tmux-style) session
survival.**

### C2 — cmux sits behind a thin `SessionHost` port, as a driver.
Core depends on an interface, not on cmux. Minimal port surface:

```
SessionHost {
  spawn({ persona, command, args, cwd }) -> sessionRef
  readScreen(sessionRef)                 -> text          // current pane contents
  status(sessionRef)                     -> running|exited(code)
  onExit(sessionRef, cb)                 // or polled via status()
  show(sessionRef)                       // surface/focus the pane in the UI
  kill(sessionRef)
}
```

`cmux` is one implementation. A `tmux` driver (durability) or an Electron-hosted driver can be
added later **without touching core** — so the dependency, macOS-only, and AGPL risks are
structurally contained, and the rejected S1 options remain reachable.

### C3 — AGPL stays arm's-length.
CoCoder *launches* and *talks to* cmux over its socket/CLI only. It does **not** fork, embed,
vendor, or link cmux's code. CoCoder remains cleanly Apache-2.0.

## Verification gate (Phase-0 exit) — ✅ PASSED 2026-05-28

Spiked cmux's socket API against the `SessionHost` port: **headless spawn, command run, screen
capture, and exit/completion detection all confirmed.** See
[`../zArchive/spikes/2026-05-28-cmux-socket-api.md`](../zArchive/spikes/2026-05-28-cmux-socket-api.md). Two
findings folded into the driver design:

1. **External control needs a non-default socket mode** — default `socketControlMode: "cmuxOnly"`
   blocks external processes. CoCoder sets **`automation`** mode (verified: external control with
   **no password**). The socket is already owner-only (`srw-------`, 0600), so `automation` relies
   on filesystem perms — sufficient for a solo builder. `password` mode (a `socketPassword` in
   `local/secrets`) is **optional defense-in-depth** against other same-user processes; adopt only
   if earned, not by default (avoid speculative ceremony).
2. **`open <dir>` does not set the shell cwd** — the cmux driver's `spawn({cwd})` must prepend
   `cd '<cwd>'`.

Verb mapping: `open` (spawn) · `send`/`send-key` (run) · `read-screen`/`capture-pane` (output) ·
`wait-for --signal` + `events` (completion) · `close-workspace` (kill). The decision stands.

## Consequences

- **MVP is macOS-only.** Consistent with v1's "macOS first" posture; acceptable for MVP.
  Cross-platform is a future driver (C2), not a rewrite.
- **External dependency** on cmux's roadmap is bounded to the `cmux` driver behind C2.
- Run durability now depends on getting the **S2 data model** right — C1 makes S2 the next and
  most load-bearing seam.
- We bet on cmux now without marrying it; reversal cost is one new driver, not a core rewrite.
