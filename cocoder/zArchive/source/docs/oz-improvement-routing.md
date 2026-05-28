# Oz Improvement Routing

**Status:** Draft for Sub-Playbook C  
**Last verified:** 2026-05-22

Oz must distinguish product improvements from workspace customization.

## Targets

| Target | Meaning |
|---|---|
| `cocoder-product` | A change to CoCoder itself: `packages/`, `templates/`, public docs, schemas, shipped prompts, Oz |
| `workspace-shared` | A tracked change to the active repo's `cocoder/` folder |
| `workspace-local` | A private change to the active repo's `cocoder/local/` folder |
| `install-local` | A private change to `<CoCoder>/local/` |
| `upstream-candidate` | A workspace finding that may belong in CoCoder product, but needs contributor review |

For normal users, Oz customizes their workspace. It does not edit CoCoder product files. If Oz sees something generally useful, it records an `upstream-candidate`.

For CoCoder contributors, product improvements are allowed only when the active workspace is the CoCoder repo dogfood workspace and developer mode is enabled. Even then, product changes still go through the active Playbook, ADR, and test gates.
