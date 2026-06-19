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
