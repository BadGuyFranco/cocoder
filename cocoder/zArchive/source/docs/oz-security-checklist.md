# Oz security checklist

Operator checklist for the Oz daemon local attack surface. Each row maps to a security invariant proven in Sub-Playbook C Solve (`oz-security-*.test.mjs`).

## Invariants (C-S1..C-S7)

| ID | Invariant | Verify |
|---|---|---|
| C-S1 | Daemon binds loopback only (`127.0.0.1`) | `pnpm exec cocoder oz start`; confirm listen address is not `0.0.0.0` |
| C-S2 | Per-install Bearer token required on state-changing routes | Mutating request without `Authorization: Bearer` returns 401 |
| C-S3 | Origin/Host rejection on state-changing routes | Cross-origin or mismatched Host rejected (DNS rebinding defense) |
| C-S4 | CSRF token on POST/PUT/DELETE | Missing or invalid `x-oz-csrf-token` rejected |
| C-S5 | Settings never return resolved secret values | `GET /settings` shows `${env:...}` refs verbatim |
| C-S6 | Audit log append on launch/stop | `local/oz-audit.log` gains one JSON line per action |
| C-S7 | No shell-string interpolation in spawn paths | Launch/stop use argv subprocesses only |

## Auth bootstrap (C-D1)

`GET /auth/session` returns `{ csrfToken, bearerToken }` to loopback callers with strict Host required and Origin absent or loopback-only. The dashboard stores both in `sessionStorage`.

### Threat-model amendment (C-D1, founder-ratified)

GET /auth/session returns the Bearer to any loopback HTTP caller. This effectively descopes "malicious npm script" from Oz's threat model. Defensible because any local process already has full code execution (can spawn cocoder directly); Bearer exposure doesn't add new attack surface against that threat. v0.2 may revisit if a more conservative threat model becomes warranted.

## Expand-phase manual checks

- [ ] Dashboard dev proxy (Vite → `:7878`) does not widen Origin allowlist on daemon (C-D2)
- [ ] Production static dashboard served from built `packages/oz-dashboard/dist/` only when `dist/` exists
- [ ] HashRouter in-app routes (`#/workspaces`, `#/runs`, etc.) do not collide with JSON API paths (C-D6)
- [ ] Runs page polling pauses when browser tab is hidden (PC-Q2=A)
- [ ] Run Inspector shows minimum viable evidence only (PC-Q3=A); not full debugger parity

## Automated regression

```bash
pnpm -r test
```

Core Oz security tests live under `packages/core/tests/oz-security-*.test.mjs`. Dashboard API sequence: `packages/core/tests/oz-e2e.test.mjs`.

## Sign-off

| Role | Name | Date | Notes |
|---|---|---|---|
| Operator | | | |
| Founder | | | |
