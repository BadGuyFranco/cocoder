# CoCoder FAQ

## Can I use CoCoder commercially?

Yes. CoCoder's code is licensed under Apache-2.0, which permits commercial use, modification, distribution, and private use subject to the license terms.

The license covers the tool and code. It does not grant rights to imply endorsement, sponsorship, or ownership of the "CoCoder" name, logo, or product identity. If you fork or ship a derivative, make the product name and provenance clear.

Commit guidance:

- Keep Apache-2.0 license notices and required attribution intact.
- Commit your workspace's public governance files under `cocoder/` when they are part of the project.
- Do not commit private secrets, local credentials, or machine-specific overrides.

## What should I commit?

Commit shared project state:

- `cocoder/PRIORITIES.md`
- `cocoder/SESSION_LOG.md`
- `cocoder/decisions/`
- `cocoder/memory/`
- Public routes, profiles, priority boundaries, persona contracts, and prompt fragments you intentionally maintain for the workspace

Do not commit private or generated state:

- `<CoCoder>/local/`
- `<workspace>/cocoder/local/`
- Secret files, tokens, API keys, `.env*`, and private playbooks
- `node_modules/`, `dist/`, `.turbo/`, and other dependency, build, or cache artifacts

See [`getting-started.md`](./getting-started.md) for the install-level and workspace-level storage diagram.

## Can I use the CoCoder name?

Use the name "CoCoder" to identify the upstream project and to preserve attribution. Do not use it to brand a fork, hosted service, plugin, or integration in a way that suggests official status unless you have permission from the project owner.

For derivatives, choose a distinct name and state that it is based on CoCoder.

## Does CoCoder collect telemetry?

No. CoCoder v0.1 collects zero analytics and ships no telemetry. Local commands may write local run records, audit files, and result artifacts under ignored `local/` paths so the operator can inspect what happened on that machine.

## Can I sync CoCoder with Syncthing or another file sync tool?

Be careful. Syncing tracked project files is fine, but do not sync `local/` secrets broadly across machines. In particular:

- Do not sync `<CoCoder>/local/secrets/`.
- Do not sync `<workspace>/cocoder/local/secrets/`.
- Review any sync rule that includes `local/`, run transcripts, or private playbooks.

If you need multi-machine setup, copy only the tracked repo state first, then recreate secrets and machine-local config on each machine.

## Where do I learn the first launch flow?

Start with [`getting-started.md`](./getting-started.md). For the Oz browser launch surface, see [`oz-launch.md`](./oz-launch.md). For local daemon security checks, see [`oz-security-checklist.md`](./oz-security-checklist.md).
