# Accepted Reference Baseline

Frozen reference snapshot of the persona / shared-prompt surface under `cocoder/personas/`. Compared against live state by `cocoder check-immutable-baseline`. Drift here means either (a) an unauthorized mutation of the persona library or (b) a founder-approved change that needs the baseline regenerated + committed in the same PR. See `packages/core/baselines/regenerate.mjs` for the regenerator + the rationale.

| status | kind | bytes | sha256 | path |
|--------|------|-------|--------|------|
| directory | dir | 0 | - | `cocoder/personas` |
| tracked | file | 671 | 0e39c727c98ce083d0ecfe1da3edd728d516ce4ce8badfdfd6d9318fe7c64ace | `cocoder/personas/AGENTS.md` |
| tracked | file | 957 | 4aea870940f194c1bb5192ece61bd063975636731b3ca513197d0444a6a7a121 | `cocoder/personas/bob.json` |
| directory | dir | 0 | - | `cocoder/personas/custom` |
| tracked | file | 0 | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 | `cocoder/personas/custom/.gitkeep` |
| tracked | file | 10215 | d5f2456da7a9af34bfc0120a4545c066cf91950612c540e278b358ad1635be2e | `cocoder/personas/PORT-NOTES.md` |
| directory | dir | 0 | - | `cocoder/personas/prompts` |
| tracked | file | 559 | 01d89790a2ec130a024dedfc0acfcf5b305f2e85bbabc2e1ba9d65a86ba055b7 | `cocoder/personas/prompts/manifest.json` |
| directory | dir | 0 | - | `cocoder/personas/prompts/personas` |
| tracked | file | 291 | 4125b776bf1494b434d54293473e3df26ac6b0a0eb98bc38ca16880a495fc98d | `cocoder/personas/prompts/personas/bob.md` |
| tracked | file | 250 | 52795271c622e8ab87cb92f6bf363642b7d5673aecfb18d424cded058ba95f2a | `cocoder/personas/prompts/personas/talia.md` |
| directory | dir | 0 | - | `cocoder/personas/prompts/shared` |
| tracked | file | 340 | f1c534a892fb98db81646aa394ac74b753cc95f2b5f6c4c359356fb7a81b8df9 | `cocoder/personas/prompts/shared/closeout.md` |
| tracked | file | 491 | a5774fbf85b5c257dc64e5d9dabb29143c6c555008c67dd99c3d38cb932b1e16 | `cocoder/personas/prompts/shared/evidence-classes.md` |
| tracked | file | 777 | d018810be0dc13e383e18981566784177bd201d65e2e79e5518b9627be3e7e90 | `cocoder/personas/prompts/shared/private-playbook-boundary.md` |
| tracked | file | 1372 | 896284b79d282c5d94d57955f1f695e65b309ea11309cd7becfd422dff904f80 | `cocoder/personas/prompts/shared/result-contract.md` |
| tracked | file | 694 | 41f4935be970a6a6f8c1af2a4b818c9d4c79872c9de4fccf8614bd576b69b472 | `cocoder/personas/prompts/shared/startup-packet.md` |
| tracked | file | 908 | 9963bf8da6c8982e4434df2c8fb49c05c873e2a6ded845f1f80c84778d6f3d62 | `cocoder/personas/prompts/shared/write-boundaries.md` |
| tracked | file | 875 | ad156e1ef5e55641a0b26e9864a3812b12775261d42c6ed7f58452657defce95 | `cocoder/personas/talia.json` |
