# Ripgrep Usage Evidence

Atom 0 searched the repo for `\brg\b`, `ripgrep`, `@vscode/ripgrep`,
`vscode-ripgrep`, shell wrappers that could invoke `rg`, package manifests,
lockfiles, CI/onboarding surfaces, and node_modules package manifests. This is
evidence only; it does not recommend a dependency policy.

## 1. Direct invocations and mentions

### Live source, scripts, runtime code, and tests

- None found in live `packages/**` source, `scripts/**`, or test files. Search
  command: `rg -n --hidden --glob '!local/**' --glob '!node_modules/**' --glob '!cocoder/zArchive/**' --glob '!.git/**' -e '\brg\b' -e 'ripgrep' -e '@vscode/ripgrep' -e 'vscode-ripgrep' packages scripts`; result: none found.
- None found for wrappers that directly shell out to `rg`. Search command:
  `rg -n --hidden --glob '!local/**' --glob '!node_modules/**' --glob '!cocoder/zArchive/**' --glob '!.git/**' -e 'execFile\([^\n]*rg' -e 'spawn\([^\n]*rg' -e 'exec\([^\n]*rg' -e 'rg --' -e "'rg" -e '"rg' packages scripts .github docs templates README.md CONTRIBUTING.md AGENTS.md cocoder`; live code hits were generic `exec`/`spawn` helpers for other commands, not `rg`.

### Live docs, governance, and generated run records

| Site | Evidence | Usage classification |
| --- | --- | --- |
| `CONTRIBUTING.md:26` | "stale-reference gate (`rg 'cobuilder\|COB_ORCH_'` / `rg '/Volumes/'`)" | Live contributor doc states CI/manual verification uses `rg`, but the live workflow no longer contains that gate. |
| `.github/pull_request_template.md:24` | "Stale-reference CI gate (`rg 'cobuilder\|COB_ORCH_'` / `rg '/Volumes/'`)" | Live PR checklist asks authors to expect/use `rg` checks. |
| `docs/oz-streaming-design.md:18` | "`codex exec --help \| rg -n -- ...`" | Live design note records a command-line pipeline that uses `rg` to inspect Codex CLI help. |
| `cocoder/decisions/0020-addendum-phase-executor.md:156` | "`rg --files` style file enumeration" | Live ADR text names an `rg`-style enumeration pattern, but no implementation was found in live code. |
| `cocoder/SESSION_LOG.md:254` | "Live `rg -li talia` gate empty" | Session history records a completed manual `rg` verification; not runtime code. |
| `cocoder/runs/46-run_190/owner-map-0031.md:31` | "Search evidence: `rg -n ...`" | Run evidence records a manual search command; not runtime code. |
| `cocoder/runs/30-run_171/work-items.jsonl:2` and `cocoder/runs/30-run_171/events.jsonl:17` | Acceptance text includes `rg -n 'ADR-0015...` | Generated run records show agents are sometimes instructed to prove work with `rg`. |
| `cocoder/runs/32-run_173/work-items.jsonl:3` and `cocoder/runs/32-run_173/events.jsonl:31` | Acceptance text includes `rg -li 'talia' ...` | Generated run records show live orchestration tasks can require `rg` gates. |
| `cocoder/runs/51-run_195/work-items.jsonl:1` and `cocoder/runs/51-run_195/events.jsonl:40` | Task text references `ripgrep-dependency-research` | False positive for tool usage: priority id/name, not an `rg` invocation. |
| `cocoder/priorities/ripgrep-dependency-research.md:8` | "Determine whether CoCoder should treat `ripgrep` (`rg`)..." | This priority owns the research question; it is not a current code dependency. |
| `cocoder/priorities/order.json:2` | "`ripgrep-dependency-research`" | False positive for tool usage: priority id only. |

### Archived or historical surfaces

| Site | Evidence | Usage classification |
| --- | --- | --- |
| `cocoder/zArchive/source/.github/workflows/ci.yml:20`-`27` | Comments say the stale-reference gate uses `rg`; step runs `brew install ripgrep`. | Historical CI installed `ripgrep` before using it. This is archived, not live CI. |
| `cocoder/zArchive/source/.github/workflows/ci.yml:55`-`63` | `if rg --no-messages ...`; second gate scans `/Volumes/`. | Historical executable CI `rg` gate. |
| `cocoder/zArchive/source/.github/workflows/ci.yml:66`-`73` | Third `if rg --no-messages ...` gate. | Historical executable CI `rg` gate. |
| `cocoder/zArchive/source/CONTRIBUTING.md:26` | Same stale-reference `rg` wording as live `CONTRIBUTING.md`. | Historical contributor doc copy. |
| `cocoder/zArchive/priorities/v0.1-foundation/plans/2026-05-22-foundation-audit.md:68` | "add CI gate `rg 'cobuilder' packages/ ...`" | Historical plan/audit reference. |
| `cocoder/priorities/archive/surface-reduction.md:196`, `:198`, `:231`, `:235`, `:450` | Multiple `rg -n` / `rg -li` audit commands. | Archived priority evidence, not current runtime. |

## 2. Declared and transitive dependency

- No declared ripgrep package was found in any `package.json`. Search command:
  `rg -n --hidden --glob '!local/**' --glob '!.git/**' --glob 'package.json' -e 'ripgrep|@vscode/ripgrep|vscode-ripgrep' .`; result: none found.
- No lockfile entry was found in `pnpm-lock.yaml`. Search command:
  `rg -n --hidden --glob '!local/**' --glob '!.git/**' --glob 'pnpm-lock.yaml' -e 'ripgrep|@vscode/ripgrep|vscode-ripgrep' .`; result: none found.
- No installed node_modules manifest matched a ripgrep package. Search command:
  `find node_modules -maxdepth 7 -name package.json -print | rg -n 'ripgrep|@vscode/ripgrep|vscode-ripgrep'`; result: none found. The local install currently has 184 package manifests under `node_modules` at `find node_modules -maxdepth 5 -name package.json -print | wc -l`.
- Conclusion for dependency evidence: `rg` is assumed present on `PATH` for manual/run-command usage; it is not shipped through a Node dependency in this repo. This follows from the no-match manifest and lockfile searches above.

## 3. CI and onboarding

- Live CI does not install or run `rg`. `.github/workflows/ci.yml:23`-`27` runs `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`, and `node scripts/check-topology.mjs`; there is no `ripgrep`, `brew install ripgrep`, or `rg` step in the live workflow. `.github/workflows/ci.yml:7`-`10` also says the old stale-reference gates were deleted.
- Live contributor/onboarding docs still mention an `rg` stale-reference gate: `CONTRIBUTING.md:26` and `.github/pull_request_template.md:24`.
- No live install/onboarding step for `rg` was found in `README.md`, `docs/**`, `templates/**`, `.github/**`, `.devcontainer/**`, Dockerfiles, or setup files. Search command:
  `rg -n --hidden --glob '!local/**' --glob '!node_modules/**' --glob '!.git/**' -e 'brew install ripgrep' -e 'apt.*ripgrep' -e 'choco.*ripgrep' -e 'scoop.*ripgrep' -e 'cargo install ripgrep' .`; live result: none found. The only match is archived at `cocoder/zArchive/source/.github/workflows/ci.yml:27`.
- Historical CI explicitly installed ripgrep on macOS: `cocoder/zArchive/source/.github/workflows/ci.yml:20`-`27` says macOS runners did not ship `rg` and runs `brew install ripgrep`.

## 4. Fallback behavior if `rg` is absent

| Usage site | Fallback behavior |
| --- | --- |
| Live source/scripts/tests | None found, because no live code usage found. |
| `CONTRIBUTING.md:26` and `.github/pull_request_template.md:24` | No fallback is documented. A shell user running the stated `rg` gate without `rg` on `PATH` would get command-not-found behavior; no `grep`/`git grep` alternative is stated. |
| `docs/oz-streaming-design.md:18` | No fallback is documented for the pipeline. If `rg` is absent, the pipeline cannot complete as written. |
| `cocoder/decisions/0020-addendum-phase-executor.md:156` | No fallback is specified for the proposed `rg --files`-style enumeration. No implementation was found to inspect for a guard/catch. |
| Generated run acceptance commands, e.g. `cocoder/runs/30-run_171/work-items.jsonl:2`, `cocoder/runs/32-run_173/work-items.jsonl:3`, and `cocoder/runs/46-run_190/owner-map-0031.md:31` | No fallback is encoded in the task text. If an agent runs the command without `rg`, the command fails at the shell. |
| Archived CI at `cocoder/zArchive/source/.github/workflows/ci.yml:20`-`27` | Historical fallback was an explicit install step, not a search fallback. The archived comments state that without the install, `if rg ...` exits 127 and bash treats that as "no match", turning the gate into a no-op (`cocoder/zArchive/source/.github/workflows/ci.yml:20`-`23`). |

## 5. Cross-platform notes

- Live CI runs on `macos-14` (`.github/workflows/ci.yml:13`) and does not use `rg` today.
- The archived CI relied on macOS Homebrew (`brew install ripgrep`) at `cocoder/zArchive/source/.github/workflows/ci.yml:26`-`27`, so that historical install step was macOS-specific.
- Archived CI gate commands used POSIX shell control flow and line continuations (`if rg ...; then`) at `cocoder/zArchive/source/.github/workflows/ci.yml:55`-`63` and `:66`-`:73`; that form is not PowerShell-native on Windows.
- Live manual commands use POSIX-style pipelines or quoting: `docs/oz-streaming-design.md:18` pipes `codex exec --help` into `rg`, while `CONTRIBUTING.md:26` and `.github/pull_request_template.md:24` show single-quoted search expressions. These are ordinary Unix-shell examples and assume `rg` is on `PATH`.
- The named `rg` flags found in current or archived surfaces are `-n`, `-li`, `--no-messages`, `--glob`, `--files`, and `--`. The flags are ripgrep flags, but their surrounding shell syntax and path assumptions differ across shells.
