---
id: ADR-0003
title: "CLI binary name and environment variable prefix"
status: accepted
date: 2026-05-21
supersedes: none
relates-to: ADR-0001
---

# ADR-0003: CLI binary name and environment variable prefix

## Context

The foundation Playbook (v0.1 program) deferred the CLI binary name as `coder` or `cocoder — TBD` and proposed the env prefix `CODER_ORCH_*` as a mechanical rename of CoBuilder's `COB_ORCH_*`. Both choices have collision risk and would force a refactor across every package, prompt, route, and doc if changed mid-port.

**Collision survey:**

- `coder` is the binary published by [Coder.com](https://coder.com) (self-hosted dev environments) and is widely installed on developer machines. A CoCoder user who already runs Coder.com would have a silent shadowing conflict in `$PATH`.
- `CODER_*` is reserved by the same Coder.com tooling and by VS Code-derived editors that expose `CODER_HOME`, `CODER_AGENT_TOKEN`, etc.

## Decision

1. **Binary name:** `cocoder` is the canonical CLI command. No `coder` alias is shipped. Users who want a short alias can add their own shell alias.

2. **Env var prefix:** `COCODER_*` for all runtime variables. The orchestration-namespaced variables use `COCODER_ORCH_*` (replacing CoBuilder's `COB_ORCH_*`).

3. **Package binary entry (two-tier per ADR-0004):**
   - **Public binary:** `packages/cocoder-cli/bin/cocoder` (TypeScript-built; exposed to users on `$PATH` via `pnpm` workspace bin resolution)
   - **Internal core entry:** `packages/core/cli.mjs` (extracted verbatim from CoBuilder per ADR-0004; not a public binary)
   - The TS CLI wrapper invokes core subcommands. Users never call `cli.mjs` directly.

4. **Documentation tone:** README, getting-started, and prompt fragments refer to the tool as **CoCoder** (product) and `cocoder` (command). Never abbreviate to `coder` in any tracked artifact.

5. **Reserved future env names:** `COCODER_HOME`, `COCODER_WORKSPACE`, `COCODER_PROFILE`, `COCODER_ORCH_RUN_ID`, `COCODER_ORCH_PERSONA`, `COCODER_LOG_LEVEL`.

## Consequences

- The mechanical rename pass in Sub-Playbook A's extraction manifest maps `COB_ORCH_*` → `COCODER_ORCH_*` (not `CODER_ORCH_*` as drafted in V1 of the Playbook).
- No symlink or alias shipping; documented as a user-level customization in `docs/faq.md`.
- Any third-party plugin or persona contract that embeds the env prefix string must reference a shared constant, not hardcode `COCODER_` — see `packages/core/lib/env.mjs` (to be created in Sub-Playbook A).
- Prompts and playbook fragments ported from CoBuilder must scrub `coder` references that came from the original prompts; regression test in Sub-Playbook B covers this.

## Alternatives considered

| Option | Rejected because |
|---|---|
| `coder` binary (no prefix collision risk in CoCoder's own files, but...) | Shadowing of Coder.com binary on widely-deployed dev machines; ambiguity in docs and support channels |
| `cocoder` binary + `coder` symlink alias | Re-introduces collision; user surprise when alias breaks after a Coder.com install |
| `cc` short binary | Collides with the C compiler on every Unix system |
| `COCO_*` env prefix | Cute but ambiguous; "coco" used in JS test frameworks and Cocoa tooling |
