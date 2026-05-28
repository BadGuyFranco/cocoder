# v0.6 — CoCoder IDE (embedded Electron terminal harness, "v2")

**Status:** Draft — reserved; depends on `v0.4-oz-control-plane` shipping first. **Owner:** Bob + founder.
**Relates to:** [`v0.4-oz-control-plane`](../v0.4-oz-control-plane/README.md) (the control-plane app this extends), [ADR-0008](../../decisions/0008-oz-control-plane-architecture.md) (deferred the embedded Electron terminal harness).

## Why

The Oz control-plane design spec (realized under **v0.4**) explicitly defers one thing to **"v2"**: replacing the **external iTerm orchestration sessions** with an **embedded Electron terminal harness** inside the app — so the founder watches *and runs* sessions in-app rather than Oz being a read-only window onto iTerm.

This priority is that "v2": the CoCoder IDE proper — the Electron app shell hosting the v0.4 control-plane surfaces **plus** embedded live terminals and (eventually) editor surfaces.

## Scope (provisional — refine after v0.4 ships)

- Embedded terminal harness that **drives and observes** orchestration sessions in-app (today external in iTerm — ADR-0008 decision 5). Keep the v0.4 **Run Detail contract stable** so the transcript/evidence/stop/attach surface works whether the session is external (v0.4) or embedded (v0.6).
- Electron app shell hosting the five v0.4 surfaces; editor surfaces as the IDE grows.
- Reuses the v0.4 build (`packages/cocoder-ide` or whatever v0.4 establishes) — this is a phase *within* the same app, not a separate product.

## Not yet

This stays a reserved stub until v0.4 (the control plane) is built and shipped. The `cocoder attach <run-id>` CLI + pause/resume primitive landed in v0.4 are prerequisites the embedded harness builds on. Slug/sequencing provisional (founder).
