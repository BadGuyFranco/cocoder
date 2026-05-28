import { FormEvent, useEffect, useState } from "react";
import type { OzWorkspacePriority, OzWorkspaceResponse } from "schemas";
import { launchRun, listWorkspacePriorities } from "../api/priorities.js";
import { launchDebugger } from "../api/runs.js";
import { listWorkspaces } from "../api/workspaces.js";

type LaunchForm = {
  profile: string;
  route: string;
};

const defaultLaunchForm = (): LaunchForm => ({
  // Default to the Oscar-led pair so "pick a priority -> Launch" spawns an
  // Oscar/Bob orchestration session. Editable per launch; the bob-lead
  // dogfood-port-tests route remains available by typing it here.
  profile: "cocoder/profiles/cocoder-oscar.profile.json",
  route: "cocoder/routes/oscar-lead.json"
});

export function PrioritiesPage() {
  const [workspaces, setWorkspaces] = useState<OzWorkspaceResponse[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [priorities, setPriorities] = useState<OzWorkspacePriority[]>([]);
  const [prioritiesPath, setPrioritiesPath] = useState("");
  const [launchForm, setLaunchForm] = useState<LaunchForm>(defaultLaunchForm());
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [debuggerLaunching, setDebuggerLaunching] = useState(false);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const entries = await listWorkspaces();
        setWorkspaces(entries);
        if (entries.length > 0) {
          setWorkspaceId((current) => current || entries[0].id);
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!workspaceId) {
      setPriorities([]);
      setPrioritiesPath("");
      return;
    }
    void (async () => {
      setError(null);
      try {
        const body = await listWorkspacePriorities(workspaceId);
        setPriorities(body.priorities);
        setPrioritiesPath(body.prioritiesPath);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setPriorities([]);
        setPrioritiesPath("");
      }
    })();
  }, [workspaceId]);

  async function onLaunch(prioritySlug: string) {
    if (!workspaceId) return;
    setError(null);
    setMessage(null);
    try {
      const result = await launchRun({
        workspaceId,
        profile: launchForm.profile.trim(),
        route: launchForm.route.trim(),
        prioritySlug
      });
      setMessage(`Launch ${result.outcome} (${result.runId}).`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function onLaunchDebugger() {
    if (!workspaceId || debuggerLaunching) return;
    setError(null);
    setMessage(null);
    setDebuggerLaunching(true);
    try {
      const result = await launchDebugger({ workspaceId, mode: "repo-audit", openTerminal: true });
      setMessage(
        result.terminalOpened
          ? `Clean debugger launched for ${result.workspaceId} (${result.sessionId}).`
          : `Clean debugger prepared for ${result.workspaceId} at ${result.wrapperPath}; Terminal did not open.`
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDebuggerLaunching(false);
    }
  }

  function onLaunchDefaultsSubmit(event: FormEvent) {
    event.preventDefault();
  }

  return (
    <section>
      <header className="page-header">
        <h1>Priorities</h1>
        <p className="muted">Scan `cocoder/PRIORITIES.md` and launch runs for a registered workspace.</p>
      </header>

      {error ? <p className="error">{error}</p> : null}
      {message ? <p className="success">{message}</p> : null}

      <label className="field">
        <span>Workspace</span>
        <select value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)} disabled={loading}>
          <option value="">Select workspace</option>
          {workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>
              {workspace.name} ({workspace.id})
            </option>
          ))}
        </select>
      </label>

      {prioritiesPath ? (
        <div style={{ alignItems: "center", display: "flex", gap: "0.75rem", marginTop: "0.75rem" }}>
          <p className="muted" style={{ margin: 0 }}>
            Source: {prioritiesPath}
          </p>
          <button
            type="button"
            className="btn"
            onClick={() => void onLaunchDebugger()}
            disabled={!workspaceId || debuggerLaunching}
          >
            {debuggerLaunching ? "Launching debugger" : "Launch debugger"}
          </button>
        </div>
      ) : null}

      <form className="card" onSubmit={onLaunchDefaultsSubmit} style={{ marginTop: "1rem" }}>
        <h2>Launch defaults</h2>
        <label className="field">
          <span>Profile (relative to workspace root)</span>
          <input
            value={launchForm.profile}
            onChange={(event) => setLaunchForm((current) => ({ ...current, profile: event.target.value }))}
          />
        </label>
        <label className="field">
          <span>Route (relative to workspace root)</span>
          <input
            value={launchForm.route}
            onChange={(event) => setLaunchForm((current) => ({ ...current, route: event.target.value }))}
          />
        </label>
      </form>

      <table className="data-table" style={{ marginTop: "1.5rem" }}>
        <thead>
          <tr>
            <th>Priority</th>
            <th>Section</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {priorities.map((priority) => (
            <tr key={priority.slug}>
              <td>
                <div>{priority.description || priority.slug}</div>
                <code className="muted" style={{ fontSize: "0.8em" }}>
                  {priority.slug}
                </code>
              </td>
              <td>{priority.section}</td>
              <td>{priority.status}</td>
              <td>
                <button type="button" className="btn" onClick={() => void onLaunch(priority.slug)}>
                  Launch
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!loading && workspaceId && priorities.length === 0 ? (
        <p className="muted">No priorities found in Active or Draft tables.</p>
      ) : null}
    </section>
  );
}
