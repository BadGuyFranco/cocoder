# ADR-0008 — Repository topology + one-home enforcement (seam S3)

**Status:** Accepted (founder + Claude, 2026-05-28)
**Seam:** S3 — topology / one concept, one home
**Charter:** [0001](./0001-rebuild-charter.md) · **Builds on:** all prior ADRs · **Relates to:** [0005](./0005-personas-and-subtasks.md) (persona home) · **Resolves S8 / absorbs** [ADR-0009](./0009-extensibility.md) (extensibility, merged here 2026-05-30)
**Amended by:** [0012](./0012-living-base-personas.md) — the default persona set is no longer *copied* on `cocoder init`; it is a **living base** referenced from the install (improvements propagate to all installs), with repos layering deltas merged at load.
**Amended (founder, 2026-06-10 — the reorg):** the zone model collapses **four → three** — the
workspace-private zone (`cocoder/local/`) is **eliminated**. A workspace governance directory is
fully git-tracked and *never* contains machine-local state; the install's `local/` is the **only**
local zone, one per machine, spanning ALL managed workspaces (DB, runs, worktrees, secrets,
settings, and the `local/workspace/` definition files per [0019](./0019-multi-root-workspaces.md)).
Same reorg: **one live decisions tree** (this one, at `cocoder/decisions/` — the v1 tree archived to
`cocoder/zArchive/v1/decisions/`), the `rebuild/` directory dissolved (PLAYBOOK/failure-catalog/
spikes live directly under `cocoder/`), **one archive home** (`cocoder/zArchive/`), and dead v1
machinery (plans/profiles/routes/priority-boundaries/personas-prompts/playbooks) archived.

## Context

The founder values "every concern has exactly one home"; v1's F1/F4 were home/topology
failures. All components are now named by ADRs 0002–0007, so the topology is derivable.

## Decision

### Storage zones — three (as amended 2026-06-10; originally four, retained from v1)
- **Install-public** (this repo): `packages/`, `templates/`, `docs/`, root docs, and the dogfood's
  `cocoder/` governance.
- **Install-private** (`local/`, gitignored, one per machine): SQLite operational DB, runs,
  worktrees, secrets, settings, workspace definition files — spans ALL managed workspaces.
- **Workspace-tracked** (each primary root's `cocoder/`): governance — priorities, personas
  extensions, decisions, standards extensions, tickets. Fully tracked; never contains local state.
- ~~**Workspace-private** (`cocoder/local/`)~~ — **eliminated** (2026-06-10): machine state lives
  only in the install's `local/`.

### Code topology — six packages, all stood up now
```
packages/
├── core/            I/O-agnostic (pure, testable): runner · composition · data-model schema ·
│                      SessionHost port · Adapter interface · persona/Play loader ·
│                      write-scope + commit-gate · preflight
├── adapters/        per-CLI drivers + probe specs (claude, codex, cursor-agent)      [I/O]
├── session-hosts/   SessionHost drivers (cmux now; tmux later)                       [I/O]
├── daemon/          Oz: owns DB write-conn + cmux connection + live runs; serves clients
├── cli/             `cocoder` binary (standalone + client modes)
└── ui/              Oz dashboard
```

### Inward dependency rule (makes "one home" enforceable)
`core` depends on nothing; `adapters`, `session-hosts`, `daemon`, `cli`, `ui` depend on `core`;
the daemon/cli wire drivers in. **No cycles, no lateral deps, nothing imports outward.** This is
the hexagonal shape S4 committed us to, made explicit at the folder level.

### Enforced invariant (earned guardrail — D3/D4, not F5)
A deterministic check asserts: (a) every source file lives under exactly one concern, and (b) the
dependency direction holds (`core` imports no driver; nothing imports outward). It **fails CI**.
This points at *structure*, never at governance docs — so it is not the F5 governance-of-
governance trap.

### Personas live as flat governance files (relates to ADR-0005)
- **Persona definition = flat markdown (+ optional scripts)** — human-readable and auditable (role,
  mental model, rules). **Not** code built-ins.
- The **base persona set is a referenced package** (`@cocoder/personas`), the single source improved
  centrally (ADR-0012) — *not* copied on `cocoder init`. A repo's **extensions** (deltas on a base
  persona, and repo-only personas) are flat files in its `cocoder/personas/` zone (`deltas/<id>.md`
  and top-level `<id>.md`); the **loader/validator lives in `core`** and merges base+delta at load.
- **CLI+model assignment** (per persona / per Play) stays an Oz-edited setting referencing the
  persona by ID (ADR-0005). **Write-scope default** can live in the persona file's frontmatter —
  co-located, one home.
- Play registry + default scopes are likewise flat/readable governance files.

### Extensibility — extend by files; new CLIs need a driver (absorbs ADR-0009, seam S8)
Adopters extend CoCoder by **adding governance files, no core fork:** a custom persona (a delta on a
base persona, or a repo-only persona), a custom Play type (a registry entry — default prompt + scope),
or a custom scope (in the persona file / priority). The base set is referenced and propagates to all
installs (ADR-0012); a repo adds or layers in its own `cocoder/` zone — nothing requires touching
`packages/`. **The one exception:** a brand-new model CLI needs an **adapter driver** (code in
`packages/adapters/`, ADR-0006) — data-driven adapter declarations were deferred as unearned (the
built-in CLIs cover the common case; adapter-as-data is a future earned feature).

### Carry-forward action
**Audit CoBuilder's persona definitions** (e.g. Bob's componentization/elegance coding rules,
Oscar's governance mental model) and bring the good rules into v2 personas. Tracked as a rebuild
task (see [`../PLAYBOOK.md`](../PLAYBOOK.md)).

## Consequences

- Personas-as-files makes **extensibility (S8) mostly "add a file"** — see the S8 note.
- The topology check is the deterministic enforcement of the founder's core value.
- The persona-rule audit becomes a Phase-1 persona-authoring task, fed by CoBuilder.
