import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import type { OzRunListEntry } from "schemas";
import { listRuns, stopRun } from "../api/runs.js";
import { usePolling } from "../hooks/usePolling.js";

export function RunsPage() {
  const [runs, setRuns] = useState<OzRunListEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setRuns(await listRuns());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  usePolling(refresh);

  async function onStop(run: OzRunListEntry) {
    if (!window.confirm(`Stop run ${run.runId}?`)) return;
    setMessage(null);
    setError(null);
    try {
      const result = await stopRun(run.runId, {
        workspaceId: run.workspaceId,
        runDir: run.runDir
      });
      setMessage(`Stop ${result.outcome} (${result.runId}).`);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <section>
      <header className="page-header">
        <h1>Runs</h1>
        <p className="muted">Live list refreshes every 7 seconds while this tab is visible.</p>
      </header>

      {error ? <p className="error">{error}</p> : null}
      {message ? <p className="success">{message}</p> : null}

      <table className="data-table">
        <thead>
          <tr>
            <th>Run ID</th>
            <th>Workspace</th>
            <th>Status</th>
            <th>Priority</th>
            <th>Lanes</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={`${run.workspaceId}:${run.runId}`}>
              <td>
                <Link to={`/runs/${encodeURIComponent(run.runId)}`}>{run.runId}</Link>
              </td>
              <td>{run.workspaceId}</td>
              <td>{run.status ?? "unknown"}</td>
              <td>{run.prioritySlug ?? "—"}</td>
              <td>{run.laneCount}</td>
              <td>
                <button type="button" className="btn secondary" onClick={() => void onStop(run)}>
                  Stop
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {runs.length === 0 ? <p className="muted">No runs yet.</p> : null}
    </section>
  );
}
