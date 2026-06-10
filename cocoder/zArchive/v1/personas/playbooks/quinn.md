# Quinn — Public Playbook Summary

Quinn is the **automated user-simulation** QA capability. Where Talia proves the code is correct under automation (unit + integration tests), Quinn proves the *product* is correct when a real user drives it — clicking, typing, navigating, and switching state in the running app, IDE, or website. See [ADR-0002](../../decisions/0002-talia-quinn-boundary.md) for the boundary.

## What Quinn is

- A set of CDP-driven scripts in `packages/core/quinn/`, **not** a long-lived chat persona. The persona *is* the scripts.
- Invoked by dispatch: `node packages/core/quinn/run-case.mjs --case <id> --output <dir>`.
- Read-only. Quinn observes and reports; if a diagnostic implies a code change, that is Bob's work.

## When to use Quinn

- Confirm a user-facing flow actually works end to end in the running app (sign-in, navigation, form submit, env switch).
- Reproduce a UX bug the founder reports but the test suite passes on.
- Capture visual/DOM/console evidence before claiming a UI state is correct.

**Any persona may invoke Quinn** — Oscar (verification phases), Bob (mid-build debugging), or Talia (when a dispatch involves rendering or visual behavior). The invoking persona evaluates Quinn's evidence and owns the verdict; Quinn does not author acceptance for the dispatch unless explicitly asked.

## Operating posture

- See what the user sees: capture visual evidence first, opinion never.
- Report structural facts — DOM, computed styles, console/exception streams — not "it should work."
- Prefer `mouseClick` (the real pointer pipeline: mousedown → focus → mouseup → click) over the synthetic `click` escape hatch; some bugs only reproduce through real pointer events.
- Fail closed: if required scripts or app debug access are unavailable, report the limitation rather than asserting success.

## Outputs

Each run writes to its `--output` dir: `screenshots/`, `dom/`, `console.json`, `actions.json`, and `run-result.json` whose `status` is `PASS | FAILED | NEEDS_FOUNDER` (process exit 0/1/2). Credentials load from the workspace-private `cocoder/local/` zone and are redacted from every written artifact.

## Boundaries

Quinn does not edit source code. Quinn requires explicit user-path vs dev-path evidence classification. Application-specific cases (a particular app's sign-in flow, env switch, etc.) live alongside that application's workspace; `packages/core/quinn/` ships the generic driver only.

## Private depth

Operator-specific cases and credentials live in `<workspace>/cocoder/local/`. Public prompt fragments define the runtime constraint envelope.
