# `cocoder/local/` — private workspace overrides

**This directory is mostly gitignored.** Only this `README.md` and `.gitignore` are tracked.

## Purpose

Per-machine, per-user, or sensitive workspace state that should NOT be committed to the repo. Distinct from `<CoCoder>/local/` (install-level prefs at the repo root) which holds CoCoder-install-level state.

## What goes here

| File / directory | Purpose | Sensitivity |
|---|---|---|
| `secrets/` | Workspace-specific API keys, tokens | Never commit |
| `persona-overrides.json` | Local model preferences per persona | Personal |
| `config.yaml` | Local config overrides (highest precedence in resolver chain) | Personal |
| `scratch/` | WIP notes, exploratory writing | Personal |
| `audit/` | Local action audit logs (if any) | Personal |

## What does NOT go here

- Priorities, plans, tickets, ADRs, memory, standards, personas — these are tracked under `cocoder/`
- API keys for CoCoder itself running OSS — those live at `<CoCoder>/local/secrets/` (install level)

## CoCoder's own dogfood

For CoCoder building itself, this directory is typically **empty**. CoCoder-as-OSS has no per-workspace secrets at the meta-project level. The directory exists as documentation of the pattern that will appear in every user's workspace via `templates/workspace-cocoder/`.

## Recovery

If you lose this directory and need to restore from a sync peer (Syncthing, iCloud Drive):

1. Stop any running Oz daemon
2. Restore `cocoder/local/` directory from peer
3. Restart Oz; it re-reads tokens through `packages/core/lib/paths.mjs`

See `../../ARCHITECTURE.md` "Multi-machine path portability" for details.
