# Recommendation: keep `rg` optional, not a declared CoCoder dependency.

CoCoder should treat ripgrep (`rg`) as an optional developer/agent convenience, not as a required runtime dependency and not as a dependency to declare in `package.json` today.

## Rationale

- Atom 0 found no live `rg` usage in `packages/**`, `scripts/**`, runtime code, or tests; it also found no live wrapper that directly shells out to `rg` (`cocoder/runs/57-run_201/ripgrep-usage-evidence.md:10`-`15`).
- Atom 0 found no declared ripgrep package in any `package.json`, no `pnpm-lock.yaml` entry, and no installed node_modules ripgrep package; its dependency conclusion is that `rg` is assumed on `PATH` only for manual/run-command usage (`cocoder/runs/57-run_201/ripgrep-usage-evidence.md:44`-`52`).
- Live CI does not install or run `rg`; it runs install, typecheck, tests, and topology only, and the evidence notes that old stale-reference gates were deleted (`cocoder/runs/57-run_201/ripgrep-usage-evidence.md:54`-`60`).
- Current `rg` reliance is docs/governance/manual-run evidence: contributor docs, the PR template, one design-note pipeline, an ADR phrase, session history, and generated run acceptance text (`cocoder/runs/57-run_201/ripgrep-usage-evidence.md:17`-`31`).

Required is too strong for the current artifact: no live runtime path, package script, test suite, or CI gate depends on `rg`. Auto-detected is premature because there is no code path to detect it. Optional matches the evidence: keep using `rg` where it is handy for humans and agents, but do not make install success or runtime behavior depend on it yet.

## Install / Onboarding Impact

If `rg` stays optional, new contributors need no new required setup. People who already have `rg` can keep using the documented/manual search commands; people who do not can use slower equivalents for those manual checks. Atom 0 found no live onboarding install step for `rg` in README, docs, templates, GitHub config, devcontainer/Docker/setup files, or install scripts (`cocoder/runs/57-run_201/ripgrep-usage-evidence.md:58`-`60`).

If `rg` becomes required, onboarding must add an install step and CI must install or provide it before any gate runs. Do not assume stock macOS or Windows machines have `rg`: atom 0 cites the archived macOS runner note that `rg` was absent, and it found no live Windows setup/install path (`cocoder/runs/57-run_201/ripgrep-usage-evidence.md:58`-`60`, `cocoder/runs/57-run_201/ripgrep-usage-evidence.md:75`-`78`). The archived CI precedent installed ripgrep with Homebrew on macOS (`cocoder/runs/57-run_201/ripgrep-usage-evidence.md:37`, `cocoder/runs/57-run_201/ripgrep-usage-evidence.md:60`, `cocoder/runs/57-run_201/ripgrep-usage-evidence.md:75`-`76`). For a real required policy, the install path would need to cover macOS, Linux, and Windows. Candidate vectors are platform package managers such as `brew`, `apt`, `choco`, `scoop`, `cargo`, or an npm package such as `@vscode/ripgrep`; atom 0 found no current repo declaration for any ripgrep package or lockfile entry (`cocoder/runs/57-run_201/ripgrep-usage-evidence.md:46`-`52`).

If `rg` becomes auto-detected later, onboarding can still remain optional, but code or scripts would need to detect `rg` and choose a fallback. Atom 0 found no such guard/catch today because it found no live source/script/test usage (`cocoder/runs/57-run_201/ripgrep-usage-evidence.md:64`-`71`).

## Cross-Platform Availability And Fallback

The current live CI runner is macOS and does not use `rg` (`cocoder/runs/57-run_201/ripgrep-usage-evidence.md:75`). The archived CI install step was Homebrew-specific, and the archived gate syntax used POSIX shell `if ...; then` blocks and line continuations that are not PowerShell-native on Windows (`cocoder/runs/57-run_201/ripgrep-usage-evidence.md:76`-`78`).

Atom 0 found no documented fallback for the live manual/doc uses: the contributor doc, PR template, design-note pipeline, ADR phrase, and generated run acceptance commands either assume `rg` or record commands that would fail if `rg` is absent (`cocoder/runs/57-run_201/ripgrep-usage-evidence.md:64`-`71`). For the current use cases, a POSIX `grep` or `git grep` fallback is enough because these are manual stale-reference and evidence-gathering searches, not product runtime behavior; atom 0 found no runtime code dependency to preserve (`cocoder/runs/57-run_201/ripgrep-usage-evidence.md:12`-`15`, `cocoder/runs/57-run_201/ripgrep-usage-evidence.md:66`).

The important failure mode is CI-like shell control flow: the archived workflow comments say that without the install, `if rg ...` exited 127 and bash treated it as "no match," turning the gate into a no-op (`cocoder/runs/57-run_201/ripgrep-usage-evidence.md:71`). If a future CI or commit-gate check uses `rg`, it must either install it first or fail closed when the binary is missing.

## Changes Needed If The Founder Adopts This Recommendation

- Resolve the stale doc/CI mismatch regardless of dependency policy: `CONTRIBUTING.md:26` and `.github/pull_request_template.md:24` still reference an `rg` stale-reference CI gate, while live `.github/workflows/ci.yml` no longer runs or installs `rg` (`cocoder/runs/57-run_201/ripgrep-usage-evidence.md:21`-`22`, `cocoder/runs/57-run_201/ripgrep-usage-evidence.md:56`-`57`).
- If keeping `rg` optional, rewrite those docs/checklists so they describe `rg` as a manual convenience or replace the gate wording with the current CI checks (`cocoder/runs/57-run_201/ripgrep-usage-evidence.md:54`-`60`).
- If making `rg` required later, add explicit install/setup guidance, add CI installation or a checked binary source, and make missing `rg` fail closed instead of silently bypassing gates (`cocoder/runs/57-run_201/ripgrep-usage-evidence.md:37`, `cocoder/runs/57-run_201/ripgrep-usage-evidence.md:60`, `cocoder/runs/57-run_201/ripgrep-usage-evidence.md:71`).
- If making `rg` auto-detected later, add one owner for detection and fallback behavior before any runtime, CI, or agent gate depends on it; atom 0 found no current fallback owner (`cocoder/runs/57-run_201/ripgrep-usage-evidence.md:64`-`71`).
- Do not add `@vscode/ripgrep`, `vscode-ripgrep`, lockfile entries, CI install steps, or package scripts unless the founder chooses a required or auto-detected policy; atom 0 found none today (`cocoder/runs/57-run_201/ripgrep-usage-evidence.md:44`-`52`).

## Founder Decision

This atom is research-only. It changes no dependency policy, package manifest, lockfile, CI config, install script, CONTRIBUTING.md text, PR-template text, code, or governance file.

Founder call: adopt `rg` as optional/developer convenience, required dependency, or auto-detected tool; separately decide whether to fix the stale CONTRIBUTING.md / PR-template CI-gate wording now.
