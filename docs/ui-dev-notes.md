# packages/ui dev notes — launchability hard lessons

Migrated 2026-06-12 (run_70) from session memory. Both lessons bit for real; both share one moral:
**green build artifacts ≠ a launchable app — only a real launch smoke proves launchability.**

1. **A sandboxed preload MUST be CommonJS.** With `"type": "module"` in the package, electron-vite
   emits `preload.mjs` by default; under `sandbox: true` an ESM preload **silently fails to load**
   → `window.oz` (the contextBridge API) never appears → the renderer hangs on a blank window.
   The fix lives in `electron.vite.config.ts`: `lib.formats: ['cjs']`,
   `fileName: () => 'preload.cjs'`, `output.entryFileNames: 'preload.cjs'`, and point
   `BrowserWindow.webPreferences.preload` at `preload.cjs`.

2. **`electron-vite dev` leaves a PARTIAL `out/`.** Dev mode writes `out/main` + `out/preload`
   but serves the renderer from its dev server — it never writes `out/renderer`. Anything probing
   "is there a built app here?" must check for `out/renderer/index.html` (the file the built main
   process actually loads), not just `out/main/main.js` existing. This fooled the daemon's
   dashboard-launch probe into launching a renderer-less "built" app → silent blank window
   (failure-catalog F16, found live 2026-06-12). **Fixed run_72 (`88888d7`):**
   `resolveDashboardLaunch` requires both files before choosing built mode, else dev.

3. **What a launch smoke needs:** a hard watchdog timeout + reject-if-bridge-missing (assert
   `window.oz` appears), never an infinite poll. Unit/jsdom tests inject the bridge directly, so
   they cannot catch either failure above.

4. **A built bundle can be stale while still "complete".** Both `out/main/main.js` and
   `out/renderer/index.html` can exist yet be older than `packages/ui` source — the daemon used to
   launch that stale bundle silently. **Fixed run_206 (`38182b3`):** built-mode launch compares source
   vs built mtimes; stale → refuse with 409 and `pnpm build:ui` (root script aliases
   `pnpm --filter @cocoder/ui build`); fresh → launch as before. Dev mode unchanged.
