---
id: quinn-app-testing
title: "Quinn — browser app-testing Play (deferred: Phase 5)"
---

## Objective
Quinn (experience persona) gains a **`browser-test`** Play for validating browser-based apps via cmux's
embedded scriptable browser. **Verified** when Quinn validates a real browser UI flow (e.g. a login or a
core screen) in an onboarded app and reports pass/fail with evidence. Boundary: the browser-test Play;
not a general test framework.

**Deferred — blocked on:** Phase 5 (an onboarded repo with a real *browser* app — CoCoder has no website
yet; one is planned). Promote out of `backlog/` (a `git mv` up to `priorities/`) when there's a browser
app to test.

**Scope moved (2026-05-31):** base Quinn + the **`electron-test`** Play are now in
[`no-brainer-plays`](../no-brainer-plays.md) — that half is unblocked because the Oz dashboard IS an
Electron app to dogfood against. This backlog item is now browser-testing only.
