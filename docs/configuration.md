# CoCoder configuration

**Status:** v2 (rebuild) — live
**Last verified:** 2026-06-20

All machine-local configuration lives in the install's single gitignored zone, `<CoCoder>/local/`.
Git updates the engine and templates; nothing under `local/` is tracked (only its signage
`README.md`), so `git pull` never touches your settings or secrets. The canonical zone model and
ignore matrix are in [`ARCHITECTURE.md`](../ARCHITECTURE.md) — this page is the operator's view of
where each file lives.

## The three storage zones

| Zone | Location | Tracked? | What it holds |
|------|----------|----------|---------------|
| Install (public) | `<CoCoder>/` — `packages/`, `docs/`, `templates/`, `scripts/`, `cocoder/` | Yes | engine, docs, templates, dogfood governance |
| Install (private) | `<CoCoder>/local/` | **Never** (only its `README.md`) | `cocoder.db`, `runs/`, `workspace/` defs, `settings.json`, `secrets/`, audit logs — spans **all** workspaces |
| Workspace (tracked) | `<primary-root>/cocoder/` | Yes (in that repo) | priorities, decisions, tickets, memory, standards, persona/play extensions |

There is **no** per-workspace `local/` zone — all machine state lives in the install's one `local/`.
See [ARCHITECTURE.md → Mental Model](../ARCHITECTURE.md#mental-model).

## Where configuration lives

```text
<CoCoder>/local/
├── settings.json                 Oz daemon settings (poll interval, default workspace, auto-compact)
├── secrets/
│   └── oz-token                  per-install Bearer token (0600, gitignored) — auto-minted
├── cocoder.db                    Oz-owned operational SQLite (ADR-0003)
├── runs/                         per-run artifacts
├── workspace/
│   └── <id>.code-workspace       one workspace definition per managed workspace (ADR-0019)
└── workspaces.json               legacy registry (superseded by workspace/, ADR-0019)
```

Tracked example/starter files ship under
[`templates/install-local/`](../templates/install-local/): `config.example.yaml`,
`roots.example.yaml`, and `workspaces.example.json` (reference samples — copy what you need into
`local/`).

### Oz daemon settings

`local/settings.json` is owned and written by the Oz daemon
([`packages/daemon/src/settings.ts`](../packages/daemon/src/settings.ts)). The live keys are
`pollIntervalMs`, `defaultWorkspaceId`, `ozAutoCompactRuns`, and `retention`; missing or invalid
values fall back to defaults, with `retention` resolved through the core retention defaults. Edit
these through the **dashboard Settings panel** (the daemon persists them); there is no
`cocoder config` CLI command.

### Secrets

`local/secrets/oz-token` is the per-install loopback Bearer token, minted on first daemon start
(owner-only `0600`, gitignored) and required on every state-changing daemon endpoint
([`packages/daemon/src/secrets.ts`](../packages/daemon/src/secrets.ts)). Settings endpoints never
return secret values. Provider/model API keys are supplied to the underlying CLI adapters
(`claude`, `codex`, `cursor-agent`) through their own auth — CoCoder does not store them. For the
full daemon security posture see
[ARCHITECTURE.md → Oz daemon security model](../ARCHITECTURE.md#oz-daemon-security-model) and
[`oz-security-checklist.md`](./oz-security-checklist.md).

## Workspace definitions and path resolution

Each managed workspace is a `local/workspace/<id>.code-workspace` JSON file listing its `folders`,
each with a `path` and a `role` (`primary` | `writable` | `readonly`); exactly one folder must be
`primary` ([`packages/daemon/src/registry.ts`](../packages/daemon/src/registry.ts),
[ADR-0019](../cocoder/decisions/0019-multi-root-workspaces.md)).

Paths may carry `${VAR}` tokens, expanded at read time. The supported portable token is
`${COCODER_HOME}` (the install root); other `${NAME}` tokens fall back to `process.env`. Relative
paths resolve against the workspace-file directory; absolute paths are taken as-is. This is
path-token expansion only — not secret resolution. Use `${COCODER_HOME}/...` to keep a workspace
entry portable across machines that sync the CoCoder folder to different absolute roots.

```jsonc
// local/workspace/my-app.code-workspace
{
  "folders": [
    { "path": "${COCODER_HOME}/../my-app", "role": "primary" }
  ]
}
```

For the multi-machine sync model (sync the whole CoCoder folder; git handles the engine, your sync
tool handles `local/`), see
[ARCHITECTURE.md → Multi-machine sync](../ARCHITECTURE.md#multi-machine-sync).

## Workspace defaults and the override rule

CoCoder ships **local defaults** for a new workspace — things like the preferred tech stack and the
default design spec — in the workspace template, `templates/workspace-cocoder/cocoder/**`. When a repo
is scaffolded, `scaffoldCocoderZone`
([`packages/core/src/scaffold/scaffold.ts`](../packages/core/src/scaffold/scaffold.ts)) copies that
template into the repo's `cocoder/` zone with `copyFileCreateOnly` — it writes each template file
**only if the repo does not already have one**.

That create-only copy *is* the resolution rule, with no separate config knob:

- **A workspace that specifies its own value wins.** If the repo already has its own
  `cocoder/memory/tech-stack.md` (or its own CSS/design), the seeded file is skipped and never
  overwritten.
- **Otherwise the local default applies.** A repo that defines nothing receives the template default.

**To set or change a default**, edit the file under `templates/workspace-cocoder/cocoder/...`. The two
current defaults:

| Default | Where you edit it |
|---------|-------------------|
| Preferred tech stack | `templates/workspace-cocoder/cocoder/memory/tech-stack.md` (the owner — no product-code source) |
| Default design spec | owner is [`packages/ui/src/renderer/styles/design-spec.md`](../packages/ui/src/renderer/styles/design-spec.md); the template carries a pointer at `templates/workspace-cocoder/cocoder/memory/design-spec.md` |

**Caveat — create-only is forward-only.** Editing a default changes what **newly scaffolded** repos
receive. An already-onboarded workspace that already received the seeded file keeps its copy (the
scaffold skips it), so it will *not* pick up your edit. Pushing a changed default into existing
workspaces is a separate, deliberate migration — not something scaffolding does on its own.

## The dogfood workspace

The CoCoder repo is itself one managed workspace — the dogfood, id `cocoder`, whose primary root is
the install root and whose governance is `<CoCoder>/cocoder/`. `cocoder run <priorityId>` standalone
mode runs against this workspace from the repo root
([`packages/cli/src/run.ts`](../packages/cli/src/run.ts)). See
[ARCHITECTURE.md → The dual nature](../ARCHITECTURE.md#the-dual-nature-cocoder-building-itself).
