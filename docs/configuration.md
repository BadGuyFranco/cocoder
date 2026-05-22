# CoCoder Configuration

**Status:** Draft, implemented by Sub-Playbook A Solve  
**Last verified:** 2026-05-22 (Sub-Playbook E dogfood exercised the workspace-root path end-to-end across 4 autonomous runs)

CoCoder configuration is split across tracked defaults and private `local/` overrides. Git can update the engine and templates without overwriting user preferences because real preferences live only in ignored `local/` paths.

## Load Order

The resolver loads files in this order, with later files overriding earlier files:

1. Built-in defaults from `packages/core/lib/config.mjs`
2. Install template: `<CoCoder>/templates/install-local/config.example.yaml`
3. Install-private files: `<CoCoder>/local/config.yaml`, `config.json`, `overrides.yaml`, `overrides.json`
4. Workspace-shared files: `<workspace>/cocoder/config.yaml`, `config.json`
5. Workspace-private files: `<workspace>/cocoder/local/config.yaml`, `config.json`, `overrides.yaml`, `overrides.json`

## `cocoder config get` / `cocoder config set`

By default, both subcommands resolve the CoCoder install root by walking up from the current directory looking for `cocoder/AGENTS.md` + `ARCHITECTURE.md`. If no install root is found in the ancestor chain, the command fails closed with a friendly error — there is no silent `process.cwd()` fallback. Pass `--cocoder-home=<path>` to override the resolved install root explicitly.

- **`cocoder config get [key]`** — reads the merged configuration. Without `--workspace-root` it shows install + defaults only; with `--workspace-root <path>` it folds in that workspace's shared and private overrides per the load order above.
- **`cocoder config set <key> <value>`** — writes to `<CoCoder>/local/config.yaml` (install-local zone). This is the dominant case: account, model, default editor, theme.
- **`cocoder config set <key> <value> --workspace-root <path>`** — writes to `<path>/cocoder/local/config.yaml` (workspace-private zone). Use this when the preference is specific to a single workspace.
- **`cocoder config set ... --install`** — accepted as a no-op alias for the default zone.

Oz settings route through the same resolver path. Use `--workspace-root` whenever you want a setting to live with one workspace; otherwise it survives in install-local across all workspaces.

## Workspaces and the install repo

**CoCoder does not support workspaces nested inside its own install repository** (see [ADR-0006](../cocoder/decisions/0006-no-nested-workspaces-inside-install.md)).

The install repo already contains exactly one workspace — the dogfood meta-project at `<CoCoder>/cocoder/`. Any other CoCoder workspace must live **outside** the install tree. Running `cocoder init` inside an existing install (or anywhere under it) refuses with a clear error and asks you to move the target directory out, or pass `--workspace-root` pointing at an out-of-tree path.

Why: `findCocoderHome()` resolves the install root via an ancestor walk, and a nested workspace would cause CLI defaults, run paths, and orchestrator-commit surfaces to silently bind to install state. The constraint is enforced at `cocoder init` and at every workspace-scoped command in v0.1. The v0.2 plan is to lift this restriction via a workspaces registry; see ADR-0005 + Sub-Playbook C.

If you need to run CoCoder against its own dogfood (the one legitimate "workspace inside install" instance), pass `--workspace-root="<CoCoder>"` AND `--workspace-slug=cocoder-dogfood` explicitly — never rely on cwd resolution.

**Important:** the workspace-root for the dogfood case is the **install root itself**, not `<CoCoder>/cocoder/`. The config resolver expects `<workspaceRoot>/cocoder/<file>`, so passing `<CoCoder>/cocoder` would make every workspace-tracked lookup miss. The install's own `cocoder/` subdirectory IS the meta-project workspace per ADR-0006; the workspace root is therefore one level up. The Sub-Playbook E dogfood invocations confirm the working shape:

```sh
cd <CoCoder>
pnpm exec cocoder launch \
  --profile cocoder/profiles/cocoder-dogfood.profile.json \
  --route cocoder/routes/dogfood-port-tests.json \
  --priority-slug v0.1-foundation \
  --workspace-root "<CoCoder>" \
  --workspace-slug cocoder-dogfood \
  --developer-mode \
  --execute true
```

## File Formats

YAML is the primary user format. JSON is accepted for generated tools or sync systems. YAML and JSON are interchangeable as long as the content matches `packages/schemas/dist/config.schema.json`.

## Merge Semantics

Objects deep-merge. Scalars replace. Arrays replace by default so profile, adapter, or route lists do not unexpectedly concatenate.

Advanced array merges can use an explicit directive:

```yaml
someArray:
  __merge: append
  items:
    - new-value
```

Use `__merge: replace` with `items` to make replacement explicit.

## Secret References

Config files may reference secrets without storing secret values:

```yaml
secrets:
  openai: ${env:OPENAI_API_KEY}
  localToken: ${file:secrets/oz-token}
  futureKeychain: ${keychain:service/account}
```

`${env:NAME}` resolves from the process environment. `${file:relative/path}` resolves relative to the configured base directory. `${keychain:service/account}` is reserved for v0.2 and fails gracefully in v0.1.

## Path Tokens

Workspace registry paths may use portable tokens:

```yaml
roots:
  nas: "/path/to/your/synced-drive"
  dev: "~/dev"
```

(For a complete working example, see [`templates/install-local/roots.example.yaml`](../templates/install-local/roots.example.yaml).)

Supported path forms:

- `${COCODER_HOME}/relative/path`
- `${root:nas}/CoBuilder`
- Absolute paths as a fallback

When a path cannot be expressed through `${COCODER_HOME}` or a named root, CoCoder stores the absolute path and returns a warning. This keeps behavior explicit instead of silently creating a non-portable registry entry.

## Validation Failures

CoCoder validates config through JSON Schema generated from the Zod schemas in `packages/schemas/src/`. Invalid config refuses to start and reports the failing JSON Pointer plus the violated constraint.

Run:

```sh
pnpm -F schemas build
pnpm -F core test config-resolver
```
