# Security Policy

CoCoder takes security seriously. This document tells you how to report a vulnerability privately and what to expect after you do.

## Reporting a vulnerability

**Do not file a public GitHub issue for security problems.** Public disclosure before a fix lands gives attackers a window against every CoCoder user.

Use one of these private channels:

1. **GitHub private vulnerability reporting (preferred):** open an advisory via the [Security tab](https://github.com/BadGuyFranco/cocoder/security/advisories/new). GitHub handles the private thread and tracks the fix and disclosure.
2. **Email:** `security@francoinc.com`. Include "CoCoder" in the subject line. PGP is not required.

When you report, please include (as much as you can — none of this is required to file):

- A description of the vulnerability and the impact you observed or expect.
- The minimal reproduction (commands, config, repo shape) needed to confirm it.
- The commit SHA (`git rev-parse HEAD`) you reproduced on.
- Your suggested fix or mitigation, if you have one.

## What to expect

- **Acknowledgment within 5 business days.** If you don't hear back, the report may have been missed — please follow up directly.
- **Fix timeline depends on severity.** Critical issues (remote code execution, secret exposure, sandbox escape) are prioritized above all current work. Lower-severity issues land in the next reasonable Playbook iteration.
- **Coordinated disclosure.** Once a fix is available, the advisory will be made public alongside the patch. Credit the reporter (unless they prefer anonymity).
- **No bounty program.** CoCoder is solo-maintained early-stage OSS. We can offer credit and our gratitude.

## In scope

- `packages/core/` — orchestration runtime, contract validation, run lifecycle.
- `packages/cli/` — the user-facing `cocoder` binary.
- `packages/daemon/` and `packages/ui/` — the local HTTP daemon + Electron dashboard and their security model (see [`ARCHITECTURE.md`](./ARCHITECTURE.md) "Oz daemon security model").
- `packages/core/` — the engine: commit-gate, write-scope enforcement, run lifecycle.
- Default `templates/workspace-cocoder/` *(when shipped in Sub-Playbook B)*.
- Documentation in `docs/` to the extent it describes incorrect security posture.

## Out of scope

- User-installed adapter CLIs (Codex, Claude, Grok, etc.) — report security issues to those vendors directly.
- Vulnerabilities in user-authored personas, profiles, routes, or priority boundaries in their own `cocoder/` workspace — those are user-zone, not product surface (see [ADR-0005](./cocoder/zArchive/v1/decisions/0005-oz-improvement-target-routing.md)).
- Vulnerabilities that require an attacker to already have local filesystem write access to `<CoCoder>/local/` (that zone holds secrets by design; protecting it is the user's responsibility per [ARCHITECTURE.md](./ARCHITECTURE.md)).
- Social-engineering attacks against project maintainers.

## Hardening notes for users

- **`<CoCoder>/local/secrets/`** stores API keys and the Oz daemon session token. Treat the whole `local/` directory as sensitive; do not sync it through public channels or commit it to any git repo.
- **The Oz daemon binds to `127.0.0.1` only** and requires a session token on every state-changing endpoint. If you reverse-proxy Oz onto a public address, you are operating outside the documented threat model — review the "Oz daemon security model" section of `ARCHITECTURE.md` before doing so.
- **Run CoCoder under your own user account, not `root`.** The orchestration runtime spawns tmux panes that can execute arbitrary shell commands within the workspace; `root`-level execution is a needless privilege escalation.
