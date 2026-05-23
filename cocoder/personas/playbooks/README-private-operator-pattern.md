# Private operator playbooks (`cocoder/local/playbooks/`)

CoCoder ships **public** persona summaries in the install repo at `cocoder/personas/playbooks/`. Those files describe role, boundaries, and when to invoke each persona. They are intentionally short and CoCoder-neutral.

**Private playbooks** hold operator-specific depth: session rituals, domain checklists, escalation habits, and founder preferences that should not be committed to a public repository.

## Layout

```
<your-app>/
└── cocoder/
    └── local/                 # gitignored except README + .gitignore
        └── playbooks/
            ├── bob.md           # optional; operator-authored
            ├── oscar.md
            ├── talia.md
            └── phil.md
```

Create only the files you need. Missing private playbooks are normal; runtime sessions use public prompt fragments from the CoCoder install (or workspace `personas/custom/` for fully custom personas).

## How private playbooks relate to runtime prompts

| Surface | Tracked? | Consumed at launch? |
|---|---|---|
| Install `cocoder/personas/prompts/` | Yes (CoCoder repo) | Yes — composed into lane prompts |
| Workspace `cocoder/personas/custom/` | Yes (your repo) | Yes — when registered in routes/profiles |
| Workspace `cocoder/local/playbooks/` | No (private zone) | No — operator reference only unless you explicitly wire a custom integration |

Private playbooks must not duplicate or override runtime prompt fragments. If a private note changes behavior, promote the change through a persona contract or prompt fragment update with founder review.

## Authoring guidelines

1. Start from the public summary in `cocoder/personas/playbooks/<persona>.md`.
2. Add operator-specific checklists, commands, and escalation paths.
3. Never paste upstream private playbooks from other products verbatim; redact customer names, internal paths, and vendor-specific runbooks.
4. Keep private playbooks out of CI, public docs, and prompt manifests.

## Custom personas

Phil demonstrates the custom-persona contract under `examples/personas/phil-primitive-builder/`. Workspace-local custom personas live in `cocoder/personas/custom/` (tracked). Their private operational depth still belongs under `cocoder/local/playbooks/` when needed.

See `docs/custom-personas.md` for schema, checklist conventions, and route eligibility.
