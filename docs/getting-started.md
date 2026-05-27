# Getting started with CoCoder

This is the shortest v0.1 path from a clean clone to a first orchestrated launch. It assumes you want to run CoCoder against an application repository that lives outside the CoCoder install tree.

Target time: 30 minutes or less on a machine that already has Node.js and pnpm.

## 1. Install CoCoder

Prerequisites:

- Node.js version from `.nvmrc`
- pnpm 10.x
- tmux
- At least one configured CLI adapter named by the selected profile

```bash
git clone <CoCoder-repo-url> ~/dev/CoCoder
cd ~/dev/CoCoder
pnpm install
pnpm -F cocoder-cli build
pnpm exec cocoder validate-contracts
```

Keep the install path handy:

```bash
export COCODER_HOME="$PWD"
```

## 2. Choose an out-of-tree workspace

Do not initialize a normal application workspace inside the CoCoder install. The install repo already contains its own dogfood workspace at `<CoCoder>/cocoder/`; your app should be elsewhere.

Example:

```bash
mkdir -p ~/dev/my-app
cd ~/dev/my-app
git init
```

## 3. Initialize CoCoder in the workspace

Run `cocoder init` from the application repo root:

```bash
pnpm --dir "$COCODER_HOME" exec cocoder init \
  --workspace-root "$PWD" \
  --cocoder-home "$COCODER_HOME"
```

This creates `<app>/cocoder/` from `templates/workspace-cocoder/`. Re-run with `--merge true` after CoCoder updates; user-edited tracked files are preserved.

Storage zones:

```text
CoCoder install repo
  <CoCoder>/
    packages/                  tracked engine code
    docs/                      tracked public docs
    templates/                 tracked workspace templates
    local/                     ignored install-level state
      workspaces/              Oz registry, run records, audit files
      secrets/                 install-level private secrets

Application workspace
  <app>/
    cocoder/                   tracked workspace governance
      PRIORITIES.md            priorities you can launch
      SESSION_LOG.md           recent run notes
      decisions/               workspace decisions
      memory/                  onboarding notes and codebase map
      local/                   ignored workspace-local state
        config.yaml            private per-workspace config
        playbooks/             private operator notes
        secrets/               do not commit or sync broadly
```

Commit the tracked workspace governance files. Do not commit either `local/` zone.

## 4. Run the workspace audit stubs

```bash
pnpm --dir "$COCODER_HOME" exec cocoder audit-workspace --workspace-root "$PWD"
pnpm --dir "$COCODER_HOME" exec cocoder refresh-memory --workspace-root "$PWD"
```

Read and edit the generated memory files enough that a first run has context:

- the onboarding questions file under `cocoder/memory/`
- `cocoder/memory/codebase-map.md`
- `cocoder/memory/tech-stack.md`

Full stack detection is v0.2 scope; in v0.1 these are starter files for the operator to refine.

## 5. Add a first launch priority

For the first v0.1 smoke launch, add an active priority row to `cocoder/PRIORITIES.md` using the starter route's supported slug:

```markdown
| v0.1-foundation | First CoCoder launch smoke test | Active | Oscar |
```

After your own routes and priority boundaries exist, replace this with project-specific slugs. See [`custom-personas.md`](./custom-personas.md) for route and persona extension conventions.

## 6. Dry-run composition

From the application workspace root:

```bash
pnpm --dir "$COCODER_HOME" exec cocoder compose-launch \
  --profile "$COCODER_HOME/cocoder/profiles/cocoder-oscar.profile.json" \
  --route "$COCODER_HOME/cocoder/routes/oscar-lead.json" \
  --priority-slug v0.1-foundation \
  --priority-file "$PWD/cocoder/PRIORITIES.md" \
  --session-log "$PWD/cocoder/SESSION_LOG.md" \
  --workspace-root "$PWD" \
  --workspace-slug my-app
```

The dry run should return `"ok": true`. Fix validation errors before launching. Common causes are a missing active priority row, an unavailable adapter, or a route/profile mismatch.

## 7. First launch from CLI

Start a visible terminal launch:

```bash
pnpm --dir "$COCODER_HOME" exec cocoder launch \
  --profile "$COCODER_HOME/cocoder/profiles/cocoder-oscar.profile.json" \
  --route "$COCODER_HOME/cocoder/routes/oscar-lead.json" \
  --priority-slug v0.1-foundation \
  --priority-file "$PWD/cocoder/PRIORITIES.md" \
  --session-log "$PWD/cocoder/SESSION_LOG.md" \
  --workspace-root "$PWD" \
  --workspace-slug my-app \
  --socket-name cocoder-my-app \
  --execute true \
  --attach iterm
```

`--attach iterm` is best-effort on macOS. If no GUI terminal opens, use the `attachCommands` in the JSON output to attach to the tmux sessions manually.

The first run is successful when the launcher creates a run directory under `<CoCoder>/local/workspaces/my-app/runs/` and both lanes receive their launch prompts. If a lane reports a blocker, keep the result artifacts and use the reported evidence instead of deleting the run directory.

## 8. First launch from Oz

Oz is the browser launch surface for v0.1.

```bash
pnpm --dir "$COCODER_HOME" exec cocoder oz start --cocoder-home "$COCODER_HOME"
pnpm --dir "$COCODER_HOME" exec cocoder oz register \
  --id my-app \
  --workspace-root "$PWD" \
  --tmux-socket cocoder-my-app \
  --cocoder-home "$COCODER_HOME"
```

Open `http://127.0.0.1:7878/`, then use **Priorities** to launch the active priority for `my-app`. The dashboard launch path opens visible panes by default when possible.

For the full dashboard operator flow, see [`oz-launch.md`](./oz-launch.md). For local daemon security expectations before regular use, see [`oz-security-checklist.md`](./oz-security-checklist.md).

## 9. What to commit

Commit:

- `<app>/cocoder/PRIORITIES.md`
- `<app>/cocoder/SESSION_LOG.md`
- `<app>/cocoder/decisions/`
- `<app>/cocoder/memory/`
- Public persona, route, boundary, and prompt files you intentionally add under `<app>/cocoder/`

Do not commit:

- `<CoCoder>/local/`
- `<app>/cocoder/local/`
- Secret files, `.env*`, run transcripts containing private material, or generated dependency/build/cache directories

See [`faq.md`](./faq.md) for commercial-use, trademark, telemetry, and sync cautions.
