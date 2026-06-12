# Priorities Pane Design Audit

Scope: current renderer implementation under `packages/ui/app/sections/dashboard/`, `packages/ui/app/App.tsx`, the shared primitives/model/adapter used by that surface, compared to the authoritative reference under `packages/ui/design-ref/`.

## Mismatch List

1. **Major - selected-run handoff geometry is interrupted by the resize handle.**
   - Design: the dashboard grid switches directly between `380px 460px 1fr` when a run is selected, putting the run detail drawer immediately between priorities and chat (`packages/ui/design-ref/dashboard.jsx:1122-1160`). The selected priority row also draws a notch from the right edge into the drawer (`packages/ui/design-ref/dashboard.jsx:38-48`).
   - App: `Dashboard` inserts a separate `6px` resize-handle track between the priorities column and the run drawer (`packages/ui/app/sections/dashboard/Dashboard.tsx:157-165`), while `PriorityRow` still draws the selected notch at the priority row edge (`packages/ui/app/sections/dashboard/Priorities.tsx:23-31`). The drawer is still in-place, but the handle/gap sits between the notch and drawer, weakening the gold-notch handoff called out by the design.

2. **Major - `not-landed` runs are linked to priority rows but are not treated as active row expansions.**
   - Design: active priority execution expands inline with live state, and clicking it opens the run drawer (`packages/ui/design-ref/dev-notes.js:46-49`; `packages/ui/design-ref/dashboard.jsx:105-149`).
   - App data model: the live adapter intentionally maps `pending-landing` / non-merged completed runs to `not-landed` (`packages/ui/app/adapter.ts:52-70`) and includes `not-landed` in the adapter's active-run join (`packages/ui/app/adapter.ts:72` and `packages/ui/app/adapter.ts:149-158`).
   - App row rendering: `PriorityRow` only considers `running` and `blocked` active (`packages/ui/app/sections/dashboard/Priorities.tsx:13-16`), so a `not-landed` linked run gets a status chip but no inline run summary (`packages/ui/app/sections/dashboard/Priorities.tsx:48-58`) and still shows the Launch button because `!isRunning` is true (`packages/ui/app/sections/dashboard/Priorities.tsx:43-47`). This creates a misleading relaunch affordance for an existing founder-visible run.

3. **Major - ad-hoc pinned row drops `not-landed` ad-hoc runs.**
   - Design: the ad-hoc row is pinned, always first, and can hold many concurrent runs inline (`packages/ui/design-ref/dev-notes.js:21-24`; `packages/ui/design-ref/dashboard.jsx:155-263`).
   - App data model: ad-hoc daemon runs are converted to `priorityId: null` (`packages/ui/app/adapter.ts:191-205`), and `not-landed` is a founder-attention status (`packages/ui/app/model.ts:10`; `packages/ui/app/adapter.ts:58-64`).
   - App row rendering: `AdhocPriorityRow` only counts `running` and `blocked` as active (`packages/ui/app/sections/dashboard/Priorities.tsx:64-66`), and `PrioritiesPanel` only passes `running` / `blocked` ad-hoc runs into it (`packages/ui/app/sections/dashboard/Priorities.tsx:113-128`). A `not-landed` ad-hoc run will disappear from the pinned row even though the dashboard's `Awaiting you` strip treats `not-landed` as founder-attention work (`packages/ui/app/sections/dashboard/Dashboard.tsx:32-40`).

4. **Major - live inline run summaries lack personas, real progress, and real last-event data until the drawer is opened.**
   - Design: the priority row summary shows run id, started time, persona badges, last event with blocked indicator, and progress (`packages/ui/design-ref/dashboard.jsx:105-149`). The seed data supplies those fields on run summaries (`packages/ui/design-ref/data.js:100-111`).
   - App rendering: `PriorityRow` can render all of these fields when present (`packages/ui/app/sections/dashboard/Priorities.tsx:48-58`).
   - Live data seam: `adaptRunSummary` sets `personas: []`, `cli: ''`, `progress: null`, and only a generic `lastEvent` for list rows (`packages/ui/app/adapter.ts:191-205`). Real personas, transcript/evidence, and detailed last event are only filled by `adaptRunDetail` after fetching `/runs/:id` (`packages/ui/app/adapter.ts:336-354`), and `App` polls run detail only for the selected run (`packages/ui/app/App.tsx:147-162`). Therefore active priority rows can render an empty persona badge area and no progress until selected.

5. **Major - first-run state is inferred from empty data, so the designed `Nothing queued` state is not reachable for a configured workspace with no priorities or runs.**
   - Design: first-run is an explicit dashboard state (`emptyState === "first-run"`) (`packages/ui/design-ref/dashboard.jsx:1071-1118`), while the priorities panel separately owns an empty queue state with "Nothing queued" and an Add priority button (`packages/ui/design-ref/dashboard.jsx:332-340`).
   - App: `Dashboard` returns `FirstRun` whenever `priorities.length === 0 && runs.length === 0` (`packages/ui/app/sections/dashboard/Dashboard.tsx:147-152`). That bypasses `PrioritiesPanel` entirely, so `PrioritiesPanel`'s own `Nothing queued` branch (`packages/ui/app/sections/dashboard/Priorities.tsx:129-135`) only appears when there are runs but no priorities. The live daemon does not currently provide an explicit first-run/configured flag in the renderer model (`packages/ui/app/model.ts:22-25`; `packages/ui/app/live.ts:52-65`).

6. **Minor - the post-design `Awaiting you` strip is in the right broad zone, but it changes the designed left-column stack.**
   - Design: the grid's first column is the priorities panel itself (`packages/ui/design-ref/dashboard.jsx:1131-1141`).
   - App: `AwaitingYouPanel` is rendered above `PrioritiesPanel` inside the left column (`packages/ui/app/sections/dashboard/Dashboard.tsx:36-85` and `packages/ui/app/sections/dashboard/Dashboard.tsx:157-163`). This is a reasonable home for the post-design addition because it belongs to queue/founder-attention work, but it shortens and shifts the priority queue. Keep it in the queue column; the rebuild should account for it rather than remove it.

7. **Minor - chat inline run cards omit the design's status chip.**
   - Design: chat run-card attachments include `StatusChip`, run id, title, personas, started time, and a right arrow (`packages/ui/design-ref/dashboard.jsx:398-428`).
   - App: `ChatMessageView` renders id, title, personas/started time, and arrow, but no `StatusChip` (`packages/ui/app/sections/dashboard/OzChat.tsx:20-33`). This affects the run-detail pivot surface, not the priority list itself.

8. **Minor - selected row border details are slightly simplified.**
   - Design: selected rows explicitly keep the right border accent while changing border radius and negative margin (`packages/ui/design-ref/dashboard.jsx:21-29`; `packages/ui/design-ref/dashboard.jsx:162-170`).
   - App: priority and ad-hoc selected rows use the selected full border and radius/margin behavior but omit the explicit `borderRight` override (`packages/ui/app/sections/dashboard/Priorities.tsx:21-31`; `packages/ui/app/sections/dashboard/Priorities.tsx:68-70`). This is visually small, but it matters if the handoff notch is being tuned.

9. **Minor - ad-hoc sub-run hover affordance is reduced.**
   - Design: ad-hoc sub-run cards transition background and add hover styling (`packages/ui/design-ref/dashboard.jsx:221-233`).
   - App: ad-hoc sub-run cards are clickable and bordered but do not include the hover transition handlers (`packages/ui/app/sections/dashboard/Priorities.tsx:83-93`). This is a polish gap, not a behavior gap.

10. **Data-model divergence to preserve honestly - design seed has fields the daemon list endpoint does not currently serve.**
    - Design seed: runs include `personas`, `cli`, `progress`, `lastEvent`, `attachCmd`, `evidence`, and `transcript` in the same seed object (`packages/ui/design-ref/data.js:100-124`).
    - App live data: workspace load fetches priority list, run summaries, and personas separately (`packages/ui/app/live.ts:50-65`). Detail-only fields are enriched by a later `/runs/:id` fetch (`packages/ui/app/live.ts:68-73`; `packages/ui/app/adapter.ts:336-354`). A rebuild must not fake missing summary fields; either fetch/enrich active rows deliberately or add a real daemon summary field.

## Conformances

1. **Dashboard is dashboard-only, not separate Priorities/Runs pages.** The design says runs and priorities are dashboard panels, not nav items (`packages/ui/design-ref/dev-notes.js:5-9`). The app composes Dashboard as the route content and keeps Workspaces/CLIs/Personas/Settings as the other top-level routes (`packages/ui/app/App.tsx:473-510`).

2. **The core three-zone layout is mostly present.** Design uses priorities, optional run drawer, and Oz chat in one grid (`packages/ui/design-ref/dashboard.jsx:1122-1160`). App uses priorities, optional `RunDetail`, and `OzChatPanel` in the same dashboard grid (`packages/ui/app/sections/dashboard/Dashboard.tsx:157-167`). The mismatch is the added resize handle, not drawer placement.

3. **Priority row anatomy is largely faithful.** Design row anatomy includes drag handle, index badge, title, summary, status chip, labels, and Launch button (`packages/ui/design-ref/dashboard.jsx:60-103`). App implements the same elements in `PriorityRow` (`packages/ui/app/sections/dashboard/Priorities.tsx:33-47`).

4. **Running/blocked inline summary anatomy exists.** Design row expansion includes id/started time, persona badges, blocked warning, last event, and progress (`packages/ui/design-ref/dashboard.jsx:105-149`). App renders the same structure when `isRunning` is true and data is present (`packages/ui/app/sections/dashboard/Priorities.tsx:48-58`).

5. **Ad-hoc is pinned and first.** Design renders `AdhocPriorityRow` before queued priorities (`packages/ui/design-ref/dashboard.jsx:323-330`) and describes it as pinned/always-first (`packages/ui/design-ref/dev-notes.js:21-24`). App renders `AdhocPriorityRow` before the queue (`packages/ui/app/sections/dashboard/Priorities.tsx:127-141`).

6. **Drag-reorder affordances and persistence seam exist.** Design specifies top = next up and drag reorder updates the ordered-list service (`packages/ui/design-ref/dev-notes.js:16-19`; `packages/ui/design-ref/dashboard.jsx:273-280`). App implements drag state/drop-target styling and `QUEUE · ↑ TOP = NEXT UP` (`packages/ui/app/sections/dashboard/Priorities.tsx:106-141`), then persists order through `App.reorder` and the daemon-backed seam (`packages/ui/app/App.tsx:249-256`; `packages/ui/electron/priorities-sync.ts:8-12`; `packages/ui/app/live.ts:158-165`).

7. **Add-priority affordance placement matches.** Design has a header plus icon and an empty-state Add priority button (`packages/ui/design-ref/dashboard.jsx:317-319`; `packages/ui/design-ref/dashboard.jsx:332-340`). App mirrors both (`packages/ui/app/sections/dashboard/Priorities.tsx:120-135`).

8. **Run detail drawer anatomy is close.** Design has context strip, status/title header, meta strip, Transcript/Evidence/Attach tabs, and adaptive footer actions (`packages/ui/design-ref/dashboard.jsx:693-949`). App implements the same drawer structure (`packages/ui/app/sections/dashboard/RunDetail.tsx:16-145`) with additional live-product actions for parked runs and teardown.

9. **Oz chat keeps the command-center shape and live wiring.** Design positions Oz chat as the command interface (`packages/ui/design-ref/dev-notes.js:26-29`) with quick prompts (`packages/ui/design-ref/dev-notes.js:41-44`). App preserves the chat panel and quick-prompt area (`packages/ui/app/sections/dashboard/OzChat.tsx:77-124`) and wires live sends through the daemon bridge (`packages/ui/app/App.tsx:224-247`; `packages/ui/electron/chat-send.ts:5-8`; `packages/ui/electron/daemon-client.ts:101-120`).

10. **First-run component exists and follows the visual language.** Design shows a framed first-run card with setup steps (`packages/ui/design-ref/dashboard.jsx:1071-1118`). App has a matching `FirstRun` component (`packages/ui/app/sections/dashboard/FirstRun.tsx:14-38`). The mismatch is state selection, not the visual component.

## Recommended Atom Split

1. **Atom A - restore selected-run handoff geometry.**
   - Scope: renderer-only.
   - Files: `packages/ui/app/sections/dashboard/Dashboard.tsx`, `packages/ui/app/sections/dashboard/Priorities.tsx`, and CSS only if needed.
   - Work: make the selected priority notch point directly into the run drawer despite the resize handle. Either move the resize handle so it does not sit between selected row and drawer, or adapt the selected-row/drawer edge treatment to include the handle as part of the handoff.
   - Exit criterion: with a selected priority run, the visible order is priorities -> run detail drawer -> Oz chat, the drawer remains 460px, and the gold notch visually lands on the drawer edge.
   - Must not break: live run polling (`packages/ui/app/App.tsx:147-162`), run action handlers (`packages/ui/app/App.tsx:384-414`), and chat send wiring (`packages/ui/app/App.tsx:224-247`).

2. **Atom B - normalize active-run semantics for row rendering.**
   - Scope: renderer-only.
   - Files: `packages/ui/app/sections/dashboard/Priorities.tsx`, possibly `packages/ui/app/adapter.ts` if a shared `isActiveRun` helper is extracted.
   - Work: treat `not-landed` consistently with other founder-attention active states in priority rows and ad-hoc rows. A linked `not-landed` run should open/select like an active run, suppress Launch, and appear in the ad-hoc sub-list when ad-hoc.
   - Exit criterion: a `not-landed` priority run expands inline or otherwise presents as active; a `not-landed` ad-hoc run remains visible under Ad-hoc; Launch is not shown for a priority with a linked active/founder-attention run.
   - Must not break: reorder callbacks (`packages/ui/app/sections/dashboard/Priorities.tsx:106-141`) and launch paths (`packages/ui/app/App.tsx:367-383`).

3. **Atom C - supply real inline summary data for active rows.**
   - Scope: needs-new-data unless the renderer chooses to fetch detail for active rows opportunistically.
   - Files: likely `packages/ui/app/live.ts`, `packages/ui/app/adapter.ts`, `packages/ui/app/App.tsx`, plus IPC/daemon contract files if the run list is enriched.
   - Work: make active priority/ad-hoc rows receive real personas, progress if available, and recent event text without faking design seed fields. Prefer a daemon summary contract if this should scale; otherwise fetch `/runs/:id` for currently active rows with a bounded polling policy.
   - Exit criterion: active rows show non-empty persona badges when sessions exist, real latest event text when events exist, and progress only when real progress exists; no placeholder progress is invented.
   - Must not break: selected-run detail polling (`packages/ui/app/App.tsx:147-162`) or the existing run detail enrichment path (`packages/ui/app/live.ts:68-73`; `packages/ui/app/adapter.ts:336-354`).

4. **Atom D - distinguish first-run setup from an empty configured queue.**
   - Scope: likely needs-new-data.
   - Files: `packages/ui/app/sections/dashboard/Dashboard.tsx`, `packages/ui/app/model.ts`, `packages/ui/app/live.ts`, and possibly daemon workspace response/adapter files.
   - Work: replace the `priorities.length === 0 && runs.length === 0` heuristic with an explicit first-run/configured signal, or another real source of truth. Keep `FirstRun` for true setup and let `PrioritiesPanel` show `Nothing queued` for configured workspaces with no priorities.
   - Exit criterion: a freshly unconfigured workspace shows first-run; a configured workspace with zero queued priorities shows the designed `Nothing queued` priorities empty state.
   - Must not break: workspace create/edit wiring (`packages/ui/app/App.tsx:318-340`; `packages/ui/app/live.ts:144-152`) and priority creation modal flow (`packages/ui/app/App.tsx:341-365`).

5. **Atom E - small row/card polish pass.**
   - Scope: renderer-only.
   - Files: `packages/ui/app/sections/dashboard/Priorities.tsx`, `packages/ui/app/sections/dashboard/OzChat.tsx`.
   - Work: add the missing chat run-card status chip, restore ad-hoc sub-run hover feedback, and tune selected-row border details while preserving the current typed React structure.
   - Exit criterion: chat run cards include status, ad-hoc sub-runs visibly hover, and selected priority/ad-hoc rows match the reference edge treatment.
   - Must not break: run-card click-to-select (`packages/ui/app/sections/dashboard/OzChat.tsx:20-33`) and ad-hoc launch/select behavior (`packages/ui/app/sections/dashboard/Priorities.tsx:64-99`).

6. **Atom F - add focused renderer regression coverage.**
   - Scope: renderer tests only.
   - Files: `packages/ui/tests/*` plus test fixtures if needed.
   - Work: add tests for `not-landed` row behavior, ad-hoc multi-run visibility, first-run versus empty queue, and preservation of reorder/chat action seams.
   - Exit criterion: tests fail on the current mismatches above and pass after Atoms A-E.
   - Must not break: existing live daemon bridge tests and fixture-mode rendering.
