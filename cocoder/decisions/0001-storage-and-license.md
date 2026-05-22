---
id: ADR-0001
title: "Storage zones, license, and CoBuilder relationship"
status: accepted
date: 2026-05-21
---

# ADR-0001: Storage zones, license, and CoBuilder relationship

## Context

CoCoder must be public OSS with user preferences that survive upstream updates, work across multiple machines, and stay recognizable to contributors and commercial users.

## Decision

1. **License:** Apache-2.0. Standard attribution via `LICENSE` + `NOTICE`. Contribution back is encouraged via `CONTRIBUTING.md`, not copyleft enforcement.

2. **Install preferences:** `<CoCoder>/local/` at repo root, gitignored. Not `~/.config/cocoder/`.

3. **Workspace folder:** Visible `cocoder/` in each target repo; private overrides in `cocoder/local/`.

4. **Phil:** Example custom persona only under `examples/personas/`.

5. **Oz:** Master orchestration persona; no separate brand. UI uses Fusion design tokens only.

6. **Platform v0.1:** macOS-first (iTerm2 + `.command` wrappers); git clone + pnpm distribution.

7. **Multi-workspace:** Per-workspace tmux socket namespace, managed by Oz registry.

8. **CoBuilder:** Independent OSS. CoBuilder migrates to CoCoder build process after CoCoder v0.1; until then CoBuilder is extraction source only.

## Consequences

- Document multi-machine sync of `local/` via filesystem sync, not git.
- MPL/custom license FAQ deferred; Apache FAQ covers commercial use of CoCoder as a tool.
- Talia/Quinn split documented in ADR-0002 (persona boundaries).
