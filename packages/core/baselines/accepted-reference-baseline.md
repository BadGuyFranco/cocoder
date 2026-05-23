# Accepted Reference Baseline

Frozen reference snapshot of the persona / shared-prompt surface under `cocoder/personas/`. Compared against live state by `cocoder check-immutable-baseline`. Drift here means either (a) an unauthorized mutation of the persona library or (b) a founder-approved change that needs the baseline regenerated + committed in the same PR. See `packages/core/baselines/regenerate.mjs` for the regenerator + the rationale.

| status | kind | bytes | sha256 | path |
|--------|------|-------|--------|------|
| directory | dir | 0 | - | `cocoder/personas` |
| tracked | file | 1252 | 1838da6800ea1b9692616daaddc8a18b0eb33eed5afa24a729a5f00349d09acc | `cocoder/personas/AGENTS.md` |
| tracked | file | 957 | 4aea870940f194c1bb5192ece61bd063975636731b3ca513197d0444a6a7a121 | `cocoder/personas/bob.json` |
| directory | dir | 0 | - | `cocoder/personas/custom` |
| tracked | file | 0 | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 | `cocoder/personas/custom/.gitkeep` |
| untracked | file | 944 | 1d1ee3a3a14b47d33ef38b6f9e6fd4bd555201ab5493b0f4e120cc3317494cc6 | `cocoder/personas/ian.json` |
| untracked | file | 913 | cecb4e96dcaef052f90c2e3606c7f92e53f613deb9741ac7bfb90cbab553d28a | `cocoder/personas/oscar.json` |
| untracked | file | 980 | a29d696713616cd2f5cdabeb1c623d7a5859b1b0804929a9b8c19dd26a68dfdb | `cocoder/personas/phil.json` |
| directory | dir | 0 | - | `cocoder/personas/playbooks` |
| untracked | file | 1178 | 5392ae5dfa34668ee61c25ef984c83dd0fb32223bf1aab5ab213ecfcc1de70d0 | `cocoder/personas/playbooks/bob.md` |
| untracked | file | 1222 | 841cd5db6cdd963abb52784b7232db818c4ba9aea3d337f0921429f44e91960c | `cocoder/personas/playbooks/oscar.md` |
| untracked | file | 1117 | 4ff0fa76f224fb4b17cd50abd732f50c39fb0659df3de023aee727b3f4f588c7 | `cocoder/personas/playbooks/phil.md` |
| untracked | file | 2408 | 841e9087ee0713ce65d8a9aa678bbe66559a92307db84a4f0d8022ab701a78a5 | `cocoder/personas/playbooks/README-private-operator-pattern.md` |
| untracked | file | 1112 | 0832c4198360c069523518001aff988eb6888dcc6ee0f90cbd5f1dd9aab38b2d | `cocoder/personas/playbooks/talia.md` |
| tracked | file | 13108 | 98e43c438dbae646afdd5e89a969bd5cb78163ddf1d3aaa4db6afd4d00263718 | `cocoder/personas/PORT-NOTES.md` |
| directory | dir | 0 | - | `cocoder/personas/prompts` |
| tracked | file | 1113 | c4840c606a2a10c9e0a41dd33979a122f6a4b4ea1aa93caf4b96e7c0a418e762 | `cocoder/personas/prompts/manifest.json` |
| directory | dir | 0 | - | `cocoder/personas/prompts/personas` |
| tracked | file | 291 | 4125b776bf1494b434d54293473e3df26ac6b0a0eb98bc38ca16880a495fc98d | `cocoder/personas/prompts/personas/bob.md` |
| untracked | file | 887 | cba87aa4061580c68b8cf95e391174e67ed83bf6f9fe7ed7029468dee87a6af6 | `cocoder/personas/prompts/personas/oscar.md` |
| untracked | file | 735 | 4aef0967440c172f9e6554465c5bb34d869f2108ecc261ef24855e81310d04f6 | `cocoder/personas/prompts/personas/phil.md` |
| tracked | file | 250 | 52795271c622e8ab87cb92f6bf363642b7d5673aecfb18d424cded058ba95f2a | `cocoder/personas/prompts/personas/talia.md` |
| directory | dir | 0 | - | `cocoder/personas/prompts/shared` |
| tracked | file | 340 | f1c534a892fb98db81646aa394ac74b753cc95f2b5f6c4c359356fb7a81b8df9 | `cocoder/personas/prompts/shared/closeout.md` |
| tracked | file | 491 | a5774fbf85b5c257dc64e5d9dabb29143c6c555008c67dd99c3d38cb932b1e16 | `cocoder/personas/prompts/shared/evidence-classes.md` |
| tracked | file | 777 | d018810be0dc13e383e18981566784177bd201d65e2e79e5518b9627be3e7e90 | `cocoder/personas/prompts/shared/private-playbook-boundary.md` |
| tracked | file | 1372 | 896284b79d282c5d94d57955f1f695e65b309ea11309cd7becfd422dff904f80 | `cocoder/personas/prompts/shared/result-contract.md` |
| untracked | file | 2185 | 0fdba43ba3fdf5b6574f80cbaca3135a4c710af743eae51723535fdda97ec6d4 | `cocoder/personas/prompts/shared/session-wrap.md` |
| tracked | file | 694 | 41f4935be970a6a6f8c1af2a4b818c9d4c79872c9de4fccf8614bd576b69b472 | `cocoder/personas/prompts/shared/startup-packet.md` |
| tracked | file | 908 | 9963bf8da6c8982e4434df2c8fb49c05c873e2a6ded845f1f80c84778d6f3d62 | `cocoder/personas/prompts/shared/write-boundaries.md` |
| untracked | file | 852 | a51cefbabcbbd205dd30044fa3931c94a08a6b44d1f19976bb38e553542825f1 | `cocoder/personas/quinn.json` |
| tracked | file | 875 | ad156e1ef5e55641a0b26e9864a3812b12775261d42c6ed7f58452657defce95 | `cocoder/personas/talia.json` |
| untracked | file | 977 | 79cf649cc0721949b76b879add9c59a067dff53cb109216d7aabc9b55245cadb | `cocoder/personas/verifier.json` |
