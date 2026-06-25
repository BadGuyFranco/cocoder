---
id: 0064
title: Daemon self-reload zombies the old process and wedges Oz; oz.sh stop reaps only the listener
type: bug
status: Open
priority: none
owner: founder-session
created: 2026-06-25
---

# 0064 — Daemon self-reload zombies the old process and wedges Oz; oz.sh stop reaps only the listener

## Context

The Oz daemon auto-reloads itself whenever repo HEAD moves past its boot sha (stale-detection → spawn a replacement on the same port, old process hands off). Because CoCoder dogfoods itself, every engine commit — run-history wraps AND governance commits — trips this. On 2026-06-25 a burst of HEAD-moving commits (a run wrap + four back-to-back governance commits) wedged Oz: the dashboard chat returned "Daemon is restarting. Oz will come back as a fresh session after boot…" indefinitely, and `scripts/oz.sh restart` did not clear it.

Two distinct bugs combined:

1. **The reload handoff does not force the old process to exit.** The replacement daemon took over the listen socket, but the old process (observed PID 39936) still held the Electron dashboard's open event/SSE stream. That open socket kept its event loop alive, so it released `LISTEN` but never exited — a zombie still bound to the dashboard, stuck in the "reload pending" state. The dashboard kept reading the zombie's stream, so Oz appeared permanently "restarting" (the user was talking to the dead daemon, not the live one). SIGTERM did not kill it (its graceful-shutdown handler was wedged); only SIGKILL did.

2. **`scripts/oz.sh stop`/`restart` reaps only the port *listener*.** It runs `lsof -ti :PORT -sTCP:LISTEN | xargs kill` plus the pidfile PID. A zombie that has released its listen socket but is still alive (only `ESTABLISHED`) never matches that filter, so it survives every restart — which is why the manual restart didn't help.

Either fix alone would have prevented the wedge.

## Acceptance

- **Clean reload handoff:** when the daemon self-reloads, the outgoing process must drain/close its lingering client connections (HTTP keep-alive + any SSE/event streams) and **actually exit** — with a hard SIGKILL-self fallback after a short timeout — so it can never linger as a zombie holding the dashboard.
- **Robust SIGTERM:** the daemon's shutdown handler must terminate even when a reload or open stream is in flight (don't block on graceful drain forever; fall back to forced exit).
- **`oz.sh stop` reaps all daemons:** stop/restart must kill **every** `oz.mjs` bound to the port (or matching the daemon pattern), not just the `-sTCP:LISTEN` process — so a restart can never leave an orphaned-but-alive daemon.
- **Dashboard reconnects:** after a reload, the dashboard's stream reconnects to the new daemon (or the client is told to refresh) rather than silently holding a dead stream.
- **Regression test/repro:** simulate a HEAD-move-triggered reload with an open dashboard stream; assert the old process exits (no surviving `oz.mjs` besides the new listener) and the chat is served by the live daemon.

## Out of scope

- The aggressive reload-on-every-HEAD-move cadence is a contributing factor (a burst of commits hammers it). Debouncing/coalescing reloads is a worthwhile follow-up but not required here — the core fix is the clean handoff + full reaping so churn can't wedge anything.

## Notes

- Root paths: `packages/daemon/src/launcher.ts` (`scheduleDaemonReloadForRun` / `drainDaemonReload` / the self-restart spawn), the daemon's SIGTERM/shutdown handler (`packages/daemon/src/server.ts` / `bin`), `scripts/oz.sh` (`stop` reaps only the listener), and `packages/daemon/src/oz-chat.ts:615` (the "Daemon is restarting" reply the dashboard got stuck on).
- Observed 2026-06-25: two `oz.mjs` on :7878 — PID 1806 `LISTEN` (healthy, current HEAD) and PID 39936 `ESTABLISHED` only (zombie holding the dashboard stream). `kill -9 39936` cleared it.
</content>
</invoke>
