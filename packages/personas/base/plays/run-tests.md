---
id: run-tests
label: Run tests
kind: headless
executionModel: hybrid
triggerClass: persona-requested
purpose: Run the repo test command and triage the results.
deterministicStep: scripts/checks/run-tests-preflight.mjs
allowedCallers:
  - oz
  - oscar
  - bob
  - deb
  - quinn
writeScope: []
---

# Run-tests Play

This Play runs headless on its per-(persona, Play) assigned model.

The deterministic step runs the repo test command. The model step is read-only: triage the resulting
output into a structured verdict with evidence, and do not edit source, tests, specs, or fixtures.
`run-tests` is the persona-requested catalog capability for running and triaging tests; `integration-verify`
remains the lifecycle landing gate on the commit spine.

Do this:

1. Read the deterministic-step output. Treat the exit code and command output as the source of truth.
2. If the command passed, report the command, exit code, and the test suites or packages that ran.
3. If the command failed, identify the first actionable failure, the failing package or test file when
   available, and the smallest next diagnostic step. Do not infer a root cause without evidence.
4. Separate infrastructure failures from assertion failures. Missing dependencies, launch failures,
   timeouts, and command errors are not product-test failures unless the output proves that.
5. As your final output, use this structure:
   - `Verdict` — pass or fail.
   - `Command` — the exact command run by the deterministic step.
   - `Evidence` — relevant output lines and exit code.
   - `Triage` — actionable failure summary or residual risk.
