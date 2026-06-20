---
id: 0003
title: Public docs/ tree is v1-stale (commands, PRIORITIES.md, cocoder/local, routes)
type: task
status: Closed
priority: none
owner: founder-session 2026-06-10
created: 2026-06-10
closed: 2026-06-20
---

> **Closed 2026-06-20.** All named adopter-facing docs rewritten to v2 reality against the code:
> getting-started, configuration, faq, custom-personas, oz-improvement-routing, dogfood-evidence,
> plus orchestration, oz-launch, oz, freshness-policy, README, and ARCHITECTURE's concurrency section.
> **tmux fully scrubbed** from all live docs (cmux/ADR-0002). **v1 constructs removed:** `cocoder/local/`
> zone, `cocoder/PRIORITIES.md`, route/profile/lane vocabulary. **Fictional commands removed/replaced**
> (verified against `packages/cli/src/run.ts`): `cocoder init`, `cocoder config get`, `cocoder launch`,
> `cocoder oz register`, `cocoder oz status|stop`, `cocoder validate-contracts`, `cocoder check-doc-refs`,
> `pnpm -F @cocoder/cli build` (CLI runs via tsx, no build). Real registration = dashboard Add Workspace
> (`scaffoldWorkspaceGovernance` + `.code-workspace`); real lifecycle = `scripts/oz.sh`. ADR-0029
> `--strict-dirt`/snapshot narrative added to launch docs. freshness-policy now points at the real CI gate.
> **Out of scope (left as-is):** deep internal diagnostic docs (orchestration-contract-ownership,
> loop-packets-*, *-owner-map, design briefs) — engineering artifacts, not adopter docs.

# 0003 — Public docs/ tree is v1-stale

## Context
The 2026-06-10 reorg (one decisions tree, three zones, `cocoder/local/` eliminated — ADR-0008
amendment + ADR-0019) updated the live governance and signage (AGENTS.md, ARCHITECTURE.md,
templates). The public `docs/` tree was deliberately NOT half-fixed: most files describe **v1-era
behavior wholesale** — `cocoder/PRIORITIES.md` workflows, `cocoder/local/` zones, route/launch
commands that no longer exist (`getting-started.md`, `configuration.md`, `faq.md`,
`custom-personas.md`, `oz-improvement-routing.md`, `dogfood-evidence.md`). Patching only the path
strings would leave confidently-wrong commands next to corrected paths.

## Ask
Rewrite the affected docs against the v2 reality (daemon + dashboard + priorities-as-stubs + three
zones), or stub them to short pointers at ARCHITECTURE.md/AGENTS.md until real adopter docs are
owed. Candidate for a `documentation` Play atom inside a future run; `docs/**` is in Oscar's
support scope and Bob's build scope.

**Folded in (2026-06-12, run_70 memory-migration sweep) — the tmux scrub.** Founder standing
rule: tmux is v1-only (frozen zArchive); the rebuild's session host is cmux (ADR-0002), and
**tmux must not appear anywhere in live documentation**. Currently violated: `ARCHITECTURE.md`
still carries tmux sections ("Multi-workspace concurrency", `--tmux-socket` references). Scrub
tmux from all live docs as part of this rewrite; never describe the rebuild in tmux terms.
