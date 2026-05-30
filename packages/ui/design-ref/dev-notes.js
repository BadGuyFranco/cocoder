// Dev annotations registry. Each numbered note documents a UI surface for the dev team.
// Numbering is sequential — every entry MUST have a corresponding <DevNote n={N} /> placed in the UI.

window.DEV_NOTES = [
  {
    n: 1,
    title: "Five-section nav",
    body: "Exactly: Dashboard · Workspaces · CLIs · Personas · Settings. Runs and Priorities are panels INSIDE Dashboard, never top-level. The dashboard badge counts running + blocked runs in the active workspace.",
  },
  {
    n: 2,
    title: "Workspace tabs",
    body: "Browser-tab style. Each tab is an independently loaded workspace — own Oz, own priorities, own runs. Switching tabs swaps the entire Dashboard context. The pulsing dot on a tab means that workspace has 1+ running or blocked runs (lets the founder spot attention across loaded workspaces). + button loads another workspace or creates a new one.",
  },
  {
    n: 3,
    title: "Priorities panel",
    body: "Workspace-scoped ordered list. Top = next up. Drag-reorder updates the ordered-list service. Each priority can be linked to an in-flight run via priority.runId; that link drives the status chip on the row.",
  },
  {
    n: 4,
    title: "Ad-hoc priority",
    body: "Pinned, always-first priority — same class as any other but can't be reordered or deleted. Clicking Launch run opens an Oz prompt to describe the task. Resulting runs appear inline beneath the row, exactly like a regular priority's inline run summary. Unlike normal priorities (typically 1:1 with a run), Ad-hoc can hold many concurrent runs.",
  },
  {
    n: 5,
    title: "Oz Terminal",
    body: "THE command interface. The founder talks to the workspace's headless Oz persona to launch runs, reorder priorities, kick off ad-hoc tasks, and ask for status. Everything else on the Dashboard is a shortcut for something the founder could ask Oz to do — keep parity.",
  },
  {
    n: 6,
    title: "Decision callout",
    body: "Inline component shown when Oz flags a message with flag:'decision'. The run that needs the call is paused; clicking a button resolves the decision and unblocks the run. Surfaces from Oz so the founder can resolve without leaving the conversation.",
  },
  {
    n: 7,
    title: "Inline run card",
    body: "When Oz mentions a run, attach a run-card to the message (attachments: [{kind:'run-card', runId}]). Clicking opens the Run Detail drawer on the right. Lets the founder pivot from chat to inspection without losing the thread.",
  },
  {
    n: 8,
    title: "Quick-prompt pills",
    body: "Pre-filled prompts for common operations. Tap to populate the input; the founder still presses send so they can edit. Recommended set: Status check · Launch next · Ad-hoc run · Reorder.",
  },
  {
    n: 9,
    title: "Inline run summary",
    body: "When a priority has an active run, the row expands to show live state — personas, last event, progress, blocked-on-decision indicator. Click anywhere on it to open the run drawer. Replaces the old standalone runs panel; matches the mental model that a run is a priority being executed.",
  },
  {
    n: 10,
    title: "Run Detail drawer",
    body: "Opens in-place (replaces the Runs panel column). Tabs: Transcript · Evidence · Attach. Footer actions adapt to status: stop / attach when live; retry when failed; re-run when complete.",
  },
  {
    n: 11,
    title: "Transcript stream",
    body: "Read-only — the actual orchestration session runs externally (iTerm today, embedded Electron terminal in v2). This view subscribes to the session's output stream and renders per-persona lines.",
  },
  {
    n: 12,
    title: "CLI health probe",
    body: "Per-CLI test that runs a check and returns Success or the exact stderr (auth failed, not on PATH, version mismatch). Status feeds the persona screen — a persona on a non-ok CLI is flagged.",
  },
  {
    n: 13,
    title: "Persona config",
    body: "CLI + Model are linked dropdowns — picking a CLI repopulates the model list (Default is always available). Run mode: visible (opens an iTerm window) or headless. Oz is locked headless and cannot be set visible.",
  },
  {
    n: 14,
    title: "Sub-agent hierarchy",
    body: "A persona may delegate to sub-agents, each with its own CLI + Model. Nested under the persona in the data model and the UI. Useful when heavy work can be offloaded (e.g. Bob → formatter sub on Haiku).",
  },
  {
    n: 15,
    title: "Craft new persona",
    body: "Opens a spec form, not a config form. Submit files the spec as a workspace priority — the team (Oscar + Bob + Talia + Quinn + Doc) actually builds the persona: drafts the prompt, scaffolds sub-agents, writes tests. The persona appears in this list only after that priority completes.",
  },
  {
    n: 16,
    title: "Run history",
    body: "One-click access from the priorities header to every run in the workspace — active, complete, failed, stopped. Filterable. Opens a modal so it stays out of the way until needed. Selecting a run closes the modal and opens the Run Detail drawer in place.",
  },
  {
    n: 17,
    title: "Oz is workspace-bound",
    body: "ARCHITECTURE — there is exactly ONE Oz per workspace. Switching workspace tabs swaps Oz, the priority list, the runs, the conversation history. Multiple workspaces loaded = multiple independent headless Oz instances running in parallel, each with its own context. They share nothing. Persist Oz state (conversation, watchers, retention settings) keyed on workspace.id.",
  },
  {
    n: 18,
    title: "System dependencies",
    body: "Settings → System dependencies. Probes for iTerm2 and cmux (and any future system-level tools). Each row shows install state, the exact install command, and a copy button. Surfaces on first run as step 1 of setup. Re-checking re-runs the probe. CLI-level auth lives separately on the CLIs screen — different concern.",
  },
];
