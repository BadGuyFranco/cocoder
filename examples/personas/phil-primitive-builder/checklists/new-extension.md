# New Workshop extension checklist

Use this checklist before Phil creates files under `workshop/extensions/`.

## 1. Name the extension

- [ ] Extension id is kebab-case and unique under `workshop/extensions/`
- [ ] Purpose fits the extension boundary (checklist, template, metadata), not core app code

## 2. Scaffold

- [ ] Create directory `workshop/extensions/<id>/`
- [ ] Add `README.md` with purpose, inputs, outputs, and owner persona
- [ ] Add `AGENTS.md` with routing table if the extension has subfolders

## 3. Metadata

- [ ] Frontmatter or manifest lists version, status (`draft` until founder review), and dependencies
- [ ] Cross-links use repo-relative paths only

## 4. Validation

- [ ] No edits outside `workshop/extensions/` unless Bob is dispatched separately
- [ ] Oscar receives a plain-English completion brief with residual risk

## 5. Handoff

- [ ] Document how Bob or operators consume the extension in the Workshop app docs (escalate if app wiring is required)
