---
id: electron-test
label: Electron test
kind: headless
executionModel: prompt-only
triggerClass: persona-requested
purpose: Drive an Electron app user path and return observed QA evidence without editing code.
allowedCallers:
  - quinn
  - oscar
writeScope: []
---

# Electron-test Play

This Play runs headless on its per-(persona, Play) assigned model.

Drive an Electron app as a user-simulation QA run. You are read-only: capture evidence to the
dispatch-provided output directory, report findings, and do not edit source, tests, specs, or fixtures.
A fix you find belongs to a separate builder task.

Do this:

1. Identify the launch command for the Electron app under test from this invocation or the repo delta.
   If no launch path is provided or discoverable, fail closed.
2. Launch the app in a drivable mode and connect an automation driver to the running process. Wait for
   the main window and renderer to be ready; if the window never appears, never finishes loading, or
   cannot be driven, record the failure evidence and return `NEEDS_FOUNDER`.
3. Drive the user path or paths named in the task using real pointer and keyboard interactions: click,
   type, focus, navigate, submit, resize, and switch visible state through the same surface a person
   would use.
4. Capture structured evidence to the dispatch-provided output directory: screenshots, DOM snapshots,
   console logs, an action log, and any driver/runtime diagnostics needed to interpret the result.
5. Decide the verdict only from observed evidence:
   - `PASS` — the named user path behaved as specified, with visual or DOM proof.
   - `FAILED` — a user-visible defect occurred, with reproduction steps and evidence.
   - `NEEDS_FOUNDER` — evidence could not be obtained or the expected behavior is ambiguous.
6. As your final output, emit exactly one verdict line with the status and the evidence directory. Do
   not claim a UI state without screenshot or DOM proof.
