---
id: 0084
title: Oscar-Deb repair dialogue 500s when the Oscar-evaluation turn wraps its JSON verdict in prose
type: bug
priority: local-cache-retention
owner: founder-session
created: 2026-06-28
---

# 0084 — Repair-dialogue Oscar-evaluation turn rejects prose-wrapped JSON

## Context

Surfaced in run_279 (CoCoder run 137) while routing live retention enablement through the Oscar–Deb
machinery-repair dialogue (ADR-0036) via `cocoder oz request-deb-repair cocoder --problem …`.

Deb produced a correct `proposal` (`disposition: cocoder-bug`, `needsFounder: true`), and the automated
Oscar-evaluation turn reached the **correct decision** (`verdict: escalate-founder`) with sound
reasoning and a well-formed JSON block. But the turn emitted that JSON **wrapped in prose** — it began
`Verdict: **escalate-founder**. Deb's proposal is correct …` and appended a trailing paragraph. The
daemon parser expects the evaluation artifact to **be** pure JSON, so it threw and the whole request
failed:

```
Deb repair request failed (500): {"ok":false,"error":"Oscar evaluation turn produced malformed
artifact: Unexpected token 'V', \"Verdict: *\"... is not valid JSON","state":"failed", …}
```

Dialogue id `repair-1782658067323-02d79a`; artifacts under
`local/oz/cocoder/repair-dialogues/repair-1782658067323-02d79a/` (`deb-response.json` good,
`oscar-evaluation.json` empty, decision visible only in `oscar-turn.log`). Nothing was committed
(`committedPaths: []`, `commitSha: null`) — safe, but the dialogue is dead and the correct
`escalate-founder` outcome was lost to a parse error rather than surfaced as a `FounderEscalation`.

## Impact

Any repair that reaches the Oscar-evaluation turn fails whenever the model prefaces or follows its JSON
with prose — a common LLM output shape — converting a correct decision into a 500. The failure is the
**transport/contract**, not the judgment.

## Acceptance

The Oscar-evaluation turn no longer fails on prose-wrapped JSON, via one (and only one) owner of the
fix:

- Constrain the evaluation-turn prompt to emit a bare JSON object (no prose, no code fence), **or**
- Make the daemon parser robustly extract the JSON artifact (e.g. the fenced/last JSON object) before
  `JSON.parse`, rejecting only when no JSON object is present.

Add a regression test feeding a prose-wrapped `escalate-founder` evaluation and asserting the dialogue
surfaces a `FounderEscalation` artifact instead of a 500. Do not duplicate the contract in a second
local copy (elegance: one owner for the artifact shape).
