---
id: founder-brief-format-durability
title: "Founder brief format durability — one source of truth for orchestration brief output"
---

## Objective
Diagnose and repair the orchestration-design failure behind repeated founder brief format drift. A
founder-requested change to an orchestration brief or authoring Play should be small, direct, and durable:
the next run must read the changed contract from one owner, every runtime surface that can emit the brief
must derive from that owner, and tests must fail when an old format reappears.

Verified when a run produces an owner map and evidence pack for the six observed founder-brief format
mismatches; identifies every source that can shape the founder brief or equivalent Play output; names the
single source of truth that should own the format; removes or aligns competing contracts; and adds tests or
fixtures that prove the requested format is enforced end to end. The closeout must include the specific
reason the prior change was hard to make stick and the smallest follow-on architecture rule, if any, needed
to prevent the same multi-owner pattern from recurring.

Boundary: this is about orchestration brief/Play-output durability and elegance, not a broad redesign of
the runner, commit spine, dashboard, or persona model unless the owner map proves one of those surfaces is
directly emitting or overriding the founder brief contract.

## Required Ticket Review
The first diagnostic atom must review related tickets before proposing a fix, starting with
[0005](../tickets/open/0005-persona-file-memory-migrations.md). Treat `0005` as direct evidence because
it carries unmigrated persona/shared-standards lessons and the same governed-file-vs-side-channel-memory
failure mode.

Also review any ticket whose body indicates source-of-truth drift, authoring-format enforcement, founder
brief/wrap/closeout behavior, Play output, persona/standards memory, or generated-artifact clobbering.
Known likely inputs at creation time:

- [0012](../tickets/open/0012-design-ref-rebuild-clobber-guard.md) — generated UI/design references can
  clobber committed fixes when the generator is not the aligned source of truth.
- [0015](../tickets/open/0015-tickets-silently-dropped-without-frontmatter.md) — authoring format and
  loader enforcement drift caused ticket artifacts to disappear from the system's read surface.
- [0008](../tickets/closed/0008-post-wrap-founder-interaction-contract.md) — prior durable-orchestration
  repair where persona prompts, wrap delivery, Deb status projection, daemon mutation, and tests had to be
  aligned around one founder-interaction contract.

The closeout must say which related tickets were reviewed, whether each was folded in, left as a sibling,
or closed by the repair, and why.
