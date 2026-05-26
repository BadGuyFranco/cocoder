import { FormEvent, useEffect, useState } from "react";
import type { OzWorkspacePriority, OzWorkspaceResponse } from "schemas";
import { launchRun, listWorkspacePriorities } from "../api/priorities.js";
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
        <p className="muted" style={{ marginTop: "0.75rem" }}>
          Source: {prioritiesPath}
        </p>
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
            <th>Slug</th>
            <th>Section</th>
            <th>Status</th>
            <th>Description</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {priorities.map((priority) => (
            <tr key={priority.slug}>
              <td>{priority.slug}</td>
              <td>{priority.section}</td>
              <td>{priority.status}</td>
              <td>{priority.description}</td>
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
