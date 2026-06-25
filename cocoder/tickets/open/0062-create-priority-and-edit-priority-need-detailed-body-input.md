---
id: 0062
title: create-priority and edit-priority need detailed body input
type: task
status: Open
priority: none
owner: founder-session
created: 2026-06-25
---

# 0062 — create-priority and edit-priority need detailed body input

## Context

The first filing of `ticket-launchability` through `cocoder oz create-priority` only accepted `--id`, `--title`, and `--objective`. The generated priority was valid, but it did not preserve the founder-provided detailed Phase A/B/C requirements, exact badge text, verification gates, and non-goals. That forced a separate corrective edit.

Create/edit priority authoring needs a way to carry full priority detail at creation time and during later governed edits, without requiring a second edit-priority pass just to add the body.

## Proposal

Extend the governed create/edit priority surfaces to accept detailed markdown body content after the Objective. Prefer file/stdin inputs over giant shell arguments.

Recommended create-priority shape:
- keep required `--id`, `--title`, and `--objective`;
- add `--details-file <path>` for large markdown sections after Objective;
- optionally add `--details-stdin` for piped markdown;
- compose one priority file with frontmatter, `## Objective`, the approved Objective text, then the provided details exactly.

Recommended edit-priority shape:
- add a governed CLI wrapper for `cocoder oz edit-priority <id>`;
- support `--details-file <path>` with modes such as `replace-body` and `append-section`;
- require explicit `--objective` only when changing the Objective;
- preserve Objective by default.

## Acceptance

- `cocoder oz create-priority` can create a priority with a detailed markdown body in one governed call.
- The details body is preserved without summarization and lands after the Objective.
- `cocoder oz edit-priority` can update non-Objective priority body details through the governed path.
- Objective edits remain founder-approved and explicitly gated.
- Tests cover details from file/stdin, Objective preservation, loadPriority round-trip, committed file lists, and rejection of malformed input.
- Existing create-priority/edit-priority authoring Play behavior remains compatible.
