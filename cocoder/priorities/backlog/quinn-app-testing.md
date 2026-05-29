---
id: quinn-app-testing
title: "Quinn — app testing Plays (deferred: Phase 5)"
---

## Objective
A "Quinn" (experience) persona exists with **Plays for testing browser and Electron apps** via cmux's
embedded scriptable browser. **Verified** when Quinn validates a real UI flow (e.g. a login or a core
screen) in an onboarded app and reports pass/fail with evidence. Boundary: the Quinn persona + the test
Plays; not a general test framework.

**Deferred — blocked on:** the Plays mechanism ([`plays-documentation`](../plays-documentation.md))
**and** Phase 5 (an onboarded repo that actually has a browser/Electron app — CoCoder is a CLI/daemon,
so there's nothing to dogfood Quinn against yet). Authored now so the intent isn't lost; promote out of
`backlog/` (a `git mv` up to `priorities/`) when unblocked.
