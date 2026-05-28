# Spike — cmux socket API satisfies the SessionHost port

**Date:** 2026-05-28 · **Gate:** ADR-0002 Phase-0 exit · **Result:** ✅ PASS · **cmux:** 0.64.10

## Question
Can cmux's Unix socket API headlessly **spawn** a session in a chosen cwd, **capture** its
output, and **detect completion** — i.e. satisfy the `SessionHost` port (ADR-0002 C2)?

## Verb mapping (confirmed working)
| SessionHost need | cmux command | Notes |
|---|---|---|
| spawn session | `cmux open <path>` | creates a workspace + terminal surface |
| run command | `cmux send --surface <ref> "<cmd>\n"` | also `send-key`, `send-panel` |
| readScreen | `cmux read-screen --surface <ref> [--lines N] [--scrollback]` | captured full output incl. exit code |
| status / onExit | `cmux wait-for [--signal] <name> [--timeout]` + `cmux events` | first-class completion primitive |
| enumerate | `cmux list-panes` / `list-pane-surfaces` | refs like `surface:2` + UUIDs |
| show / focus | `--focus true` / `cmux focus-window` | |
| kill | `cmux close-workspace` / `close-window` | confirmed `OK` |

Evidence: a `send` of `pwd; …; echo "EXIT=$?"; echo <sentinel>` produced, via `read-screen`,
the full transcript including `EXIT=0` and the sentinel — so the driver can read both **output**
and **exit code** off the screen, and `wait-for --signal` gives a cleaner barrier than scraping.

## Two findings that shape the driver

1. **External control needs a non-default socket mode.** Default
   `automation.socketControlMode: "cmuxOnly"` rejects external CLI connections (every command →
   `broken pipe`). Modes: `off · cmuxOnly · automation · password · allowAll · openAccess · …`.
   **`automation` mode works with NO password** (verified: `ping → PONG`,
   `access_mode: "automation"`). The socket is owner-only (`0600`), so `automation` relies on
   filesystem perms — sufficient for a solo builder.
   → **Implication:** CoCoder onboarding sets cmux to **`automation`** mode (no secret to manage).
   `password` mode is optional defense-in-depth against other same-user processes — adopt only if
   earned. The "Test CLI permissions" setup flow (ADR-0006) is the place to set the mode.

2. **`open <dir>` does NOT set the shell cwd** — it opens the workspace but the shell starts in
   `~` (verified: a relative file landed in HOME, not the target dir). The `cd '<cwd>' && …`
   approach landed it correctly (`pwd` confirmed the temp dir).
   → **Implication:** `SessionHost.spawn({cwd})` for the cmux driver must **prepend `cd '<cwd>'`**
   (or send it as the first command), not rely on `open`'s path.

## Verdict
The cmux driver behind the `SessionHost` port is **viable** — all four capabilities
(spawn-in-cwd, run, readScreen, exit-detect) are achievable with the socket API. ADR-0002 stands;
the two findings above are folded into the driver design. Phase-0 exit gate cleared.

## Follow-up — cmux browser as Quinn's instrument ✅

Drove cmux's embedded browser against a live page (`cmux browser --surface <ref> <cmd>` —
surface handle goes **before** the subcommand):

- `get title` → "Example Domains"; `get text --selector h1` → text extracted; `get count
  --selector a` → `28` (Quinn's "count everything," free).
- `snapshot --compact` → a full **accessibility tree with referenceable element handles**
  (`link "Domains" [ref=e3]`, `heading … [ref=e10]`) — structural, role-labeled, assertable, and
  the refs are reusable for follow-up actions. This is precisely Quinn's "structural assertions
  over visual; correlate visual with internal state" model.
- `screenshot --out <path>` → wrote a 106 KB PNG (visual evidence on demand).
- `find <role|text|testid|...>`, `eval`, `console list`, `errors list` all available.

**Verdict:** cmux's browser is a Playwright-class instrument out of the box. The v2 **experience
layer (Quinn) rides cmux's browser** rather than hand-rolling CDP scripts (v1's approach). Strong
candidate for a *deliberate* cmux coupling (ADR-0002 C2) given the value. macOS-only is accepted.
