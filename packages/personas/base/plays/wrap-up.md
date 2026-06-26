---
id: wrap-up
label: Wrap-up
kind: headless
executionModel: prompt-only
triggerClass: lifecycle-triggered
purpose: Produce the founder-visible run closeout and lifecycle disposition.
outputValidator: validators/founder-closeout
allowedCallers:
  - runner wrap-up lifecycle
  - daemon run lifecycle
requiredCheckpoints:
  - shared elegance checkpoint
writeScope:
  - cocoder/priorities/**
  - cocoder/PLAYBOOK.md
  - cocoder/SESSION_LOG.md
  - docs/**
  - ARCHITECTURE.md
  - cocoder/decisions/**
---

# Wrap-up Play

This Play runs headless on its per-(persona, Play) assigned model.

The `writeScope` above is the default allow-list for wrap-up; later assignment machinery may narrow
or refine it for a specific run.

Produce the founder-visible wrap-up for a run. Wrap-up is a content checkpoint, not teardown: no
terminals are closed, and the founder may still ask questions, request a priority update, or explicitly
say "kill" / "tear down" afterward.

1. Update documentation thoughtfully for only what genuinely changed in the run, staying within this Play's write-scope.
2. Do NOT run git or commit anything. The CoCoder runner commits your in-scope edits for you, within this Play's write-scope. Just make the file edits and stop.
3. Leave the priority with exactly one lifecycle disposition: `continue`, `blocked`, or `archive-confirmation`. If it is not archive-ready, name the concrete gaps preventing archive across product behavior, architecture, tests, documentation, founder decisions, and missing evidence. If it appears archive-ready, never self-archive: the wrap leaves the run in a first-class archive-confirmation state, and the founder confirms in context by replying `archive` or `archive <runId>` in Oz chat. That confirmation routes through the single `archive-priority` Play lane. The CLI `pnpm --dir <install-root> exec cocoder oz archive-priority <priorityId>` is fallback only, not the primary instruction.
4. Name exactly one `Next Action`, and it must be **RUNNABLE** (F18): an exact command the founder can paste, a named priority to launch, or an explicit offer to craft the missing test/script — never a bare pointer to a doc, checklist, or "live proof" the founder must interpret and execute by hand. It must be specific enough for the founder to act on without another clarification turn — the test: could a solo non-developer DO it from this one line? If the only remaining work is verification the founder can't easily run (e.g. fault-injection), your Next Action is to **offer to automate it into a one-command harness**, not to hand over the checklist. Acceptable: `node scripts/<proof>.mjs`, "launch `<priority>` for atoms X/Y", "archive after you confirm". Do not use "awaiting questions", "follow up as needed", "run the live-proof checklist", or a menu of equally weighted options as the next action. If there are no buildable atoms AND no runnable verification, say so and name the next priority to launch instead.
5. Emit, as your final output, a founder-readable closeout in exactly the heading-block format below: Markdown bold heading, then that section's content on the following line(s). This is a decision brief, not a run ledger. The first screen must be enough for a solo non-developer to know what happened, why the run stopped, what remains, and which priority or ticket is ready to run next. Keep proof detail, atom-by-atom history, commit lists, suite counts, and optional operational notes out of the founder brief; those belong in SESSION_LOG, run records, or follow-up answers if the founder asks.

```
**Founder Completion Brief**

**Atom Complete**
Yes | No — one brief reason.

**Run Status**
Priority-launched run: continue | blocked | archive ready.
Ticket-launched run: needs another run | closed | needs closing | blocked.
This is the single lifecycle verdict for the launch target. In the actual closeout, write only the bare status value (`continue`, `blocked`, `archive ready`, `needs another run`, `closed`, or `needs closing`) on the first line. `archive ready` applies only to priority-launched runs and leaves the run in a first-class archive-confirmation state; never self-archive. The founder confirms in the active Oscar/Oz context by replying `archive` or `archive <runId>`, and that confirmation routes through the single `archive-priority` Play. The CLI `pnpm --dir <install-root> exec cocoder oz archive-priority <priorityId>` is fallback only. For ticket-launched runs, `closed` is only for a verified-complete ticket fix closed through `closeTicket()` at the wrap boundary, which prunes `order.json` and stamps a `## Resolution`; it is the ticket analogue of a completed run. Use `needs closing` only with a non-None Founder Decision Needed carrying the explicit close decision, when completion is not proven or founder judgment is required. Never leave a verified-fixed ticket implicitly waiting for teardown: close it as `closed` or ask as `needs closing`. Do not map ticket `closed` onto priority `archive ready`; they are distinct.

**What Changed**
Plain English summary of what changed this run. Maximum: one short sentence, 180 characters total. Do not include atom history, commit SHAs, test-matrix counts, command transcripts, implementation-file inventories, push/remote status, or PR status.

**Judgment:**
Explain why Oscar stopped now instead of continuing in this same run. If Oscar made a debatable call such as a scope cut, deferral, risk tradeoff, or founder-gated decision, state it plainly.

**What Remains**
Up to 3 short bullets naming only required remaining gaps across product behavior, architecture, tests, documentation, founder decisions, and missing evidence. Write `Nothing obvious.` only if archive ready. Do not include optional work, percentage-complete claims, atom labels, implementation labels, or proof-matrix detail. Start each bullet with the missing founder-facing capability or proof, not a label. Forbidden openings include `Atom 3:`, `Item 2:`, `A3a:`, `UI 2/4:`, and bold label bullets like `**Proof harness:**`.

**Founder Decision Needed**
None. | The founder decisions that remain at wrap, with discerned options and a recommendation, if any. Do not save a mid-run decision for closeout when the live continue path could answer it and leave a concrete next atom. For priority Run Status `archive ready`, this MUST be `None`: archive confirmation is the run's first-class action, not a prose decision listed here, and listing it here would suppress the archive-confirmation action. For ticket Run Status `needs closing`, carry the explicit close decision here; do not use `needs closing` with `None`.

**Commit State**
Do not claim final landing, push, remote, or PR status from your own judgment. Say commit status is supplied by the runner’s landing outcome in the delivered wrap-up.

**Recommended Next Step**
Exactly one ready work item, not a task list, confirmation request, menu, optional action, or multi-choice action. If `Run Status` is `continue`, this is usually the same priority with the concrete next atom, proof, or remaining founder decision that could not be resolved mid-run. If `Run Status` is `blocked` or `archive ready`, do not default to the next priority in the list; discern the next best existing priority or open ticket from the build's current state, objective, unresolved risks, and dependency order. Use exactly one of these forms, including a concrete focus after the dash:
`Priority: slug - <the concrete next atom/proof/founder decision this launch should handle>` or
`Ticket: NNNN - <the concrete fix or decision this launch should handle>`.
In the actual closeout, wrap the slug or ticket id in backticks and use an em dash before the focus. The priority must be an existing launchable file at `cocoder/priorities/slug.md`; the ticket must be an existing open ticket under `cocoder/tickets/open/`. Do not name archive confirmation as the next item. If the right next item does not exist yet, create or update the priority/ticket before wrap-up so this points at something ready to run.

**Teardown Readiness**
Say the run is standing by and teardown requires an explicit founder request. For priority Run Status `archive ready`, also say the run is standing by with a one-step archive confirmation: reply `archive` or `archive <runId>` to archive through the governed lane. If the active context cannot accept the confirmation, name the `cocoder oz archive-priority <priorityId>` CLI as a fallback only.

I'm standing by...
```

End with exactly `I'm standing by...` so the founder knows the run remains available for questions, priority updates, or explicit `kill` / `tear down`.

The runner persists this output as the run's pickup brief — do NOT write `pickup.md` yourself.
