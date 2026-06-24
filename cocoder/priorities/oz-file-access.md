---
id: oz-file-access
title: Oz repo read access — read broadly, write stays gated
---

## Objective

Give Oz broad read access to the CoCoder repo working tree so it can answer founder questions and craft
priorities/tickets with real knowledge of the code, tests, docs, and governance — never working in the
dark — while **write stays gated** (governance/repair verbs unchanged). The constraint on *read* is not
"governance only"; it is **secrets and host-escape only**.

**Read model (founder-ratified, 2026-06-24, run_76):**

- **Default-allow** read of any path Oz requests inside the repo working tree: product code
  (`packages/*/src/**`), tests, `docs/**`, `ARCHITECTURE.md`, ADRs, personas, standards, configs — the
  whole tracked tree. Rule of thumb: **Oz may read anything git tracks.**
- **Hard denylist** (the only things hidden — they are what `.gitignore` deliberately keeps out of the
  repo, i.e. secrets and runtime state surfaced into a persisted chat transcript would leak):
  - `local/**` — auth token (`local/secrets/oz-token`), sqlite DB, audit logs, PIDs, runtime state
  - `**/.env*`, `**/secrets/**`, `**/*credentials*` (incl. `.quinn-credentials.json`)
  - `.git/**`, `node_modules/**` — escape surface / noise
- **Repo-root boundary stays hard.** Reject absolute paths, `..` traversal, and anything resolving
  outside the repo root. Oz reading `~/.ssh/id_rsa`, `/etc/...`, or a sibling repo via `..` must remain
  impossible — that guard is non-negotiable and already exists.

The model is a **denylist, not an allowlist**: read is open by default and closes only for the named
hazard classes. This deletes the drift surface — new doc dirs, packages, or ADRs become readable with no
maintenance; the denylist only grows when a genuinely new *secret* class appears.

**Verified when:** the founder can ask Oz about any tracked file — a governed doc ("what does ADR-0017
say about the refresh verb?"), `ARCHITECTURE.md`, or product code — and Oz answers correctly in-session
without an adhoc launch; **and** a proof shows a secret/runtime path (e.g. `local/secrets/oz-token`) and a
host-escape attempt (`../`, absolute) are rejected without reading the file, while a product-code path
(`packages/core/src/index.ts`) now reads successfully.

**Boundary:** read-only. Oz gains no write/commit access to any file through this surface (repair writes
remain the existing repair verb). This Objective **deliberately supersedes** the earlier "read = governed
flat files only; scope does not extend to product code" boundary (see History): the founder's call is that
limiting *read* never made sense — only *write* warrants gating, and the sole read hazard is
secret/host exfiltration, which the denylist + repo-root boundary close.

### Next atom — invert the read model (SHIPPED run_77, `3dd5871`)
1. **Replace the scope contract.** In `packages/core/src/write-scope/governed-read.ts`, replace the
   `GOVERNED_READ_SCOPE` allowlist with a `GOVERNED_READ_DENY` denylist constant covering the hazard
   classes above; export from `@cocoder/core`. Update `packages/core/src/index.ts` accordingly.
2. **Flip the handler.** In `packages/daemon/src/launcher.ts` `readGoverned()`: keep the existing
   repo-root/normalize/traversal/absolute/NUL guards, then **default-allow** and reject only when the
   normalized path `matchesAny(path, GOVERNED_READ_DENY)`. Reuse the tested `matchesAny` helper; write no
   new glob code. Still read-only — no write/commit path.
3. **Flip the tests.** Rewrite `governed-read-scope.test.ts` + `read-governed.test.ts` so they prove the
   new contract in both directions: product code (`packages/core/src/index.ts`) and `ARCHITECTURE.md`
   now **read** live content; `local/secrets/oz-token`, `**/.env`, traversal (`../`), and absolute paths
   are **rejected without reading** (assert the secret's content never appears in the result). Keep the
   no-content-leak assertions.
4. **Tool instructions.** Update the `read-governed` description in `oz-host.ts` so Oz knows it may read
   any tracked repo file (not just governed zones), and that secrets/runtime/host paths are refused.

Mechanism: product-code change → delegate as a verified build atom (Oscar verifies the diff + reruns
core/daemon typecheck and the flipped suites before commit). After commit, the founder refreshes the
daemon so Oz loads it — **no dashboard rebuild** (UI is a thin HTTP client; daemon runs from TS source
via tsx).

## History — Option B (allowlist) shipped run_76, now superseded

The first run (run_75) researched two delivery mechanisms and the founder ratified **Option B** — a
scoped `read-governed(path)` tool reading **live from disk** (no TOC/index/digest enrichment; the repo is
the single source of truth). Run_76 shipped it end-to-end (`18c5607`): a `GOVERNED_READ_SCOPE` allowlist
(`cocoder/decisions|priorities|personas|standards/**`, `packages/personas/base/**`), the `read-governed`
tool surface across `oz-host.ts`/`oz-chat.ts`, the `readGoverned()` handler in `launcher.ts`, and passing
tests. The live test then exposed the design flaw: an allowlist hides too much (`ARCHITECTURE.md`,
`docs/**`, product code) and drifts as governed files grow — which is why this Objective inverts it to a
denylist. The tool surface, the repo-root guards, the live-from-disk principle, and the `matchesAny`
reuse all carry forward; only the allowlist→denylist contract and its tests change.

## Founder-added follow-up — surface the launch disposition in Oz (run_200, 2026-06-23)

**Status: DONE (run_75).** `DebStatus.wrapDisposition` projects the latest recorded `wrap-disposition`
event into Oz's founder-facing run surface (`renderDebStatus` in `packages/core/src/runner/status.ts`);
no recomputation — `deriveWrapDisposition` remains the single owner. Verified by status tests.

**Disposition: `continue` (run_76).** The founder ratified the broadened read model on 2026-06-24; the
shipped allowlist is superseded. Next session relaunches this priority as a build run and delegates the
single **invert the read model** atom above. No remaining founder decision — the read-hazard boundary
(secrets/runtime/host only) is settled. On a successful live exchange after the inversion lands (Oz reads
a product-code file and a governed doc, and refuses `local/secrets/oz-token`), this priority is
archive-ready. Optional follow-on (founder choice): record the read model in an ADR amendment.

**Disposition: `archive-candidate` (run_77).** Denylist inversion shipped (`3dd5871`): `GOVERNED_READ_DENY`
replaces the run_76 allowlist; `readGoverned()` default-allows tracked paths and rejects only denylist
matches; tests prove both directions. Automated proof green; no build atoms remain. Archive awaits founder
live Oz proof per **Verified when** (daemon `refresh {}`, then in-session read of product code + governed
doc and refusal of `local/secrets/oz-token`). Optional founder choice: ADR amendment for the broadened read
model.
