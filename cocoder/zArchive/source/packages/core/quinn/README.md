---
component: cocoder-orchestration-quinn
last-verified: 2026-05-18
verified-by: Oscar (founder-authorized cross-boundary build)
---

# Quinn Driver

CDP-driven IDE QA harness. Quinn attaches (or spawns) the cocoder-ide
desktop app over the Chrome DevTools Protocol, captures real evidence
artifacts (screenshots, DOM snapshots, console + exception streams), and
drives use cases — environment switches, sign-in flows, arbitrary UI
interactions — through composable JavaScript primitives.

This replaces the Phase 10 acceptance-harness "Quinn CDP smoke" which only
proved that a CDP endpoint was reachable.

## Files

| Path | Purpose |
|------|---------|
| `cdp-client.mjs` | Minimal JSON-RPC client over the native WebSocket (Node 22.4+). |
| `driver.mjs` | High-level CDP primitives (evaluate, screenshot, DOM, console, waitFor, fillInput, click, env switch, sign-in). |
| `launch-ide.mjs` | Spawns `pnpm dev` in `cocoder-ide/` with `VITE_AUTH_ENABLED=1` and `COCODER_CDP_PORT=19222`, or attaches to a running IDE. |
| `credentials.mjs` | Loader for the gitignored credentials file. Redacts passwords. |
| `run-case.mjs` | CLI entry point. Loads a case module and writes evidence. |
| `cases/` | Test cases. Each exports `meta` and `async run(driver, ctx)`. |

## Requirements

* Node 22.4+ (native `WebSocket`). `node --version` should print `v22.4` or higher.
* `pnpm` on `PATH` (used to spawn `pnpm dev` inside `cocoder-ide/`).
* For sign-in flows: the IDE must be started with `VITE_AUTH_ENABLED=1`,
  otherwise the renderer uses the dev-bypass `AuthProvider` and there is no
  sign-in form to drive. The Quinn launcher sets this for you when it spawns
  the IDE.

## Credentials

The repo ships an example file:

```
cocoder/.quinn-credentials.example.json   (tracked template)
```

Copy it to `cocoder/local/.quinn-credentials.json` (the workspace-private zone,
gitignored automatically by the inner `cocoder/local/.gitignore`) and fill in
real values. Schema:

```json
{
  "<environment>": {
    "<email>": { "password": "<plain-text>" }
  }
}
```

The loader never logs passwords. `CredentialsStore.redact()` returns a
copy with `password: "[REDACTED]"` if you want to dump state for debugging.
The driver also pushes each used password into its redaction list, so
`run-result.json`, `actions.json`, and `console.json` are scrubbed before
being written.

If you need a per-machine override, pass `--credentials <path>` to `run-case.mjs`.

## Running a case

```bash
# Quinn spawns its own IDE (recommended — guarantees VITE_AUTH_ENABLED=1).
node packages/core/quinn/run-case.mjs \
  --case staging-login-smoke \
  --output /tmp/quinn-staging-login-$(date +%s)
```

```bash
# Attach to an IDE you started yourself (skip Quinn spawn).
node packages/core/quinn/run-case.mjs \
  --case cdp-attach-smoke \
  --output /tmp/quinn-attach-$(date +%s) \
  --cdp-url http://127.0.0.1:19222/json/version \
  --no-spawn
```

```bash
# Drive a real app flow: type a prompt into the chat input, press Enter,
# wait for the assistant to respond, assert non-empty + console-clean.
# Requires the IDE to already be signed in (run staging-login-smoke first
# or sign in manually).
node packages/core/quinn/run-case.mjs \
  --case chat-send-message \
  --output /tmp/quinn-chat-$(date +%s) \
  --cdp-url http://127.0.0.1:19222/json/version \
  --no-spawn
```

### Output structure

```
<output>/
├── run-result.json    # case status + actions + console (redacted)
├── actions.json       # ordered driver actions (redacted)
├── console.json       # full Runtime.consoleAPICalled / exceptionThrown log
├── ide-dev.<ts>.log   # if spawned by Quinn — IDE stdout/stderr
├── screenshots/*.png  # Page.captureScreenshot frames
└── dom/*.json         # DOM.getDocument snapshots (depth=-1, pierce=true)
```

`run-result.json.status` is `"PASS"`, `"FAILED"`, or `"NEEDS_FOUNDER"`.
Process exit code matches: 0 PASS, 1 FAILED, 2 internal error.

## Writing a case

A case is a `.mjs` file under `cases/` (or anywhere on disk; pass an absolute
path). Required exports:

```js
export const meta = {
  id: 'my-case',
  description: 'One-sentence what-this-does.',
  requires: []                      // 'staging-credentials' if you need them
};

export async function run(driver, ctx) {
  // driver — QuinnDriver instance, already attached and ready.
  // ctx.credentials — CredentialsStore or null (if not needed).
  // ctx.args — parsed CLI args, in case you want extras like --signInEmail.

  await driver.captureScreenshot('start.png');
  // ... drive the UI ...
  return {
    status: 'PASS',                 // or FAILED, NEEDS_FOUNDER
    assertions: [                   // optional, surfaced in run-result.json
      { name: '...', passed: true }
    ],
    observed: { /* freeform */ }
  };
}
```

## Driver vocabulary

### Navigation, capture, and state

| Method | Purpose |
|--------|---------|
| `attach()` | Discovers the renderer target, opens WS, enables Page/Runtime/DOM/Log. |
| `evaluate(expr, opts)` | `Runtime.evaluate` with `awaitPromise` + `userGesture` on by default. |
| `captureScreenshot(name)` | Writes `screenshots/<name>.png` as raw PNG. |
| `captureDom(name)` | Writes `dom/<name>.json` (full DOM tree, deep + pierced; password inputs auto-redacted). |
| `setLocalStorage(key, value)` / `getLocalStorage(key)` | Persistent state. |
| `reload({ waitForSelector })` | `Page.reload` + optional resync. |
| `setEnvironment(env)` | Writes `cocoder-dev-console-env`, reloads, asserts. |
| `signIn(email, password, opts)` | Fills email/password, clicks submit, waits for post-login or error. |
| `detach()` | Closes the CDP WS. |
| `exportRunSummary()` | Snapshot used in `run-result.json`. |

### Waits

| Method | Purpose |
|--------|---------|
| `waitFor(selector, opts)` | Polls `document.querySelector`. Set `absent: true` to wait for removal. |
| `waitForEither(a, b, opts)` | Resolves on the first of two selectors. Returns `{ matched: 'first'\|'second' }`. |
| `waitForAny(predicates, opts)` | N-way race. Each predicate is a CSS selector or `{ name, expr }`. Returns `{ matched, index }`. |
| `waitForCondition(expr, { label, ... })` | Generic state poll. The expression is wrapped in an IIFE so multi-statement bodies work. |

### Interaction

| Method | Purpose |
|--------|---------|
| `mouseClick(selector, opts)` | **Real-user click.** Dispatches `Input.dispatchMouseEvent` `mousePressed`+`mouseReleased` at the element's bounding-rect center, through Chromium's full pointer pipeline. Fires real mousedown → mouseup → focus → click. Use this for everything that mimics a user (buttons, links, focusing inputs, opening menus, dismissing overlays). Options: `{ button: 'left'\|'middle'\|'right', clickCount }`. |
| `click(selector)` | **Synthetic-event escape hatch.** Calls `el.click()` in the renderer. Fires only a `click` event — no pointer events, no focus change, no drag detection. Use only when `mouseClick` can't reach the element (e.g. it's covered by an overlay that intercepts pointer events but the click handler is wired to fire synthetically). When in doubt, prefer `mouseClick`. |
| `fillInput(selector, value)` | React-controlled-input safe (uses `nativeInputValueSetter` and dispatches bubbled input/change). Sets a value directly — does not type. |
| `type(text)` | Dispatches one `Input.insertText` per character so React controlled inputs see real input events. **Requires the target to be focused** (call `mouseClick(selector)` first). |
| `pressKey(key, { modifiers })` | Single key or chord against the focused element. Examples: `'Enter'`, `'Escape'`, `'Meta+S'`, `'Control+Shift+P'`. |
| `hover(selector)` | Dispatches `Input.dispatchMouseEvent` (`type='mouseMoved'`) at the element's bounding-rect center. |

#### Picking the right click

The two click primitives exist because Chromium's `HTMLElement.click()` and a
real mouse click are not the same thing:

* A real mouse click runs the full pointer pipeline:
  `mousedown` → focus → `mouseup` → `click`. Drag thresholds are evaluated,
  focus rings appear, click-outside-to-dismiss handlers fire.
* `HTMLElement.click()` dispatches only the `click` event. **No focus change.**
  No pointer events. No drag detection.

This matters because some IDE bugs only reproduce through the real pipeline
(focus rings missing, hover-then-click sequences failing, drag-vs-click
ambiguity, dismiss-on-outside-click handlers not firing). `mouseClick()` is
the one to reach for by default; `click()` is the escape hatch.

```js
// Correct — drives the IDE like a user.
await driver.mouseClick('[data-testid="chat-input"]');  // sets focus
await driver.type('Hello');
await driver.pressKey('Enter');

// Wrong for a textarea — synthetic click does not move focus.
await driver.click('[data-testid="chat-input"]');
await driver.type('Hello');  // typing goes nowhere
```

### Assertion vocabulary

Every `expect*` records a structured result on `driver.assertions` (timestamped,
included in `exportRunSummary()`). They are **non-throwing by default** so a case
can collect multiple findings before deciding pass/fail; pass
`{ throwOnFail: true }` to make a single assertion hard-fail the case.

| Method | Purpose |
|--------|---------|
| `expectVisible(selector, opts)` | Element present (querySelector matches). |
| `expectAbsent(selector, opts)` | Element absent. |
| `expectText(selector, matcher, opts)` | `textContent` matches. `matcher` is a string (substring), `RegExp`, or `(text) => boolean`. |
| `expectCount(selector, expected, opts)` | `querySelectorAll().length`. `expected` is a number or `(n) => boolean`. |
| `expectValue(selector, expected, opts)` | `.value` of an `<input>`/`<textarea>`. Same matcher rules as `expectText`. |
| `expectNoConsoleErrors(since, opts)` | No `console.error` / `exceptionThrown` entries since the supplied marker (pass `driver.consoleEntries.length` before the action you want to gate). |
| `recordAssertion(record)` | Lower-level: push an arbitrary `{ name, passed, ... }` record to `driver.assertions`. Useful for cases that need bespoke checks. |

## Boundary note

This module was extracted verbatim from CoBuilder per ADR-0004 and now lives
at `packages/core/quinn/`. Future Quinn evolution lands through Sub-Playbook B
(persona library) and Sub-Playbook C (Oz Run Inspector). Cases that target a
specific application (sign-in flows, env switches, etc.) should live alongside
that application's workspace; this directory ships the generic driver only.
