# CoCoder FAQ

**Last verified:** 2026-06-20

## Can I use CoCoder commercially?

Yes. CoCoder's code is licensed under Apache-2.0, which permits commercial use, modification,
distribution, and private use subject to the license terms. The license covers the tool and code; it
does not grant rights to imply endorsement or to use the "CoCoder" name, logo, or product identity.
If you fork or ship a derivative, make the product name and provenance clear. See also `NOTICE` for
the CoBuilder extraction attribution.

## What should I commit?

A `cocoder/` governance directory is **fully git-tracked** — priorities, decisions, tickets, memory,
standards, and persona/play extensions are all community-visible:

- `cocoder/priorities/` (one `.md` per priority + `order.json`)
- `cocoder/decisions/`, `cocoder/tickets/`, `cocoder/memory/`, `cocoder/standards/`
- `cocoder/personas/` and `cocoder/plays/` extensions you intentionally maintain

Never commit machine-local state. It all lives in the install's single zone:

- `<CoCoder>/local/` — DB, runs, `workspace/` defs, `settings.json`, `secrets/`, audit (only its
  `README.md` is tracked)
- Secret files, tokens, `.env*`, and `node_modules/`, `dist/`, `.turbo/` build/cache artifacts

There is **no** per-workspace `local/` zone. The canonical ignore matrix is in
[ARCHITECTURE.md → Ignore matrix](../ARCHITECTURE.md#ignore-matrix-canonical).

## What happens if I launch with uncommitted changes?

By default the launch is **not** refused. The founder is a trusted actor
([ADR-0029](../cocoder/decisions/0029-founder-trusted-pre-run-snapshot.md)): the launch guard
snapshots your in-scope uncommitted work to its own attributed commit and proceeds — product/builder
dirt → `founder: pre-run WIP snapshot`, governance dirt → `governance: pre-run snapshot`, mixed dirt
produces both and still proceeds. The snapshot keeps founder WIP out of the agents' atom commits; it
never destroys or mixes your work. Agent gates (verify, quarantine, out-of-lane flagging) stay hard.

To restore the old hard-stop refusal (for shared repos or CI), opt in with `cocoder run <priorityId>
--strict-dirt` (or `strictPreRunDirt` on `POST /runs` / the dashboard strict-dirt checkbox). See
[ARCHITECTURE.md → the commit spine](../ARCHITECTURE.md#how-work-reaches-trunk--the-commit-spine-adr-0023).

## How do I view or attach to a run?

Through the **Oz dashboard**, not the CLI. Start the daemon (`scripts/oz.sh start`, or
`cocoder oz start` in the foreground) and open the printed dashboard URL. A run's **attach** action
focuses that run's live cmux pane. There is no CLI attach command and no auto-opened terminal. See
[`getting-started.md`](./getting-started.md).

## Can I use the CoCoder name?

Use "CoCoder" to identify the upstream project and preserve attribution. Do not use it to brand a
fork, hosted service, plugin, or integration in a way that suggests official status without
permission. For derivatives, choose a distinct name and state that it is based on CoCoder.

## Does CoCoder collect telemetry?

No. CoCoder collects zero analytics and ships no telemetry. Local commands write run records, audit
files, and result artifacts under the install's gitignored `local/` so you can inspect what happened
on that machine.

## Can I sync CoCoder across machines (Syncthing, iCloud, etc.)?

Yes — `local/` is gitignored but lives inside your CoCoder folder, so sync the whole CoCoder
directory the way you sync any dev environment. Git updates the engine; your sync tool keeps `local/`
aligned. Be deliberate about `local/secrets/` (e.g. the `oz-token`) — treat it like any private
credential. See
[ARCHITECTURE.md → Multi-machine sync](../ARCHITECTURE.md#multi-machine-sync) and
[Multi-machine path portability](../ARCHITECTURE.md#multi-machine-path-portability).

## Where do I learn the first run flow?

[`getting-started.md`](./getting-started.md). For the dashboard, see [`oz.md`](./oz.md); for the
daemon security checklist, [`oz-security-checklist.md`](./oz-security-checklist.md).
