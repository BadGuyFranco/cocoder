import { FormEvent, useEffect, useState } from "react";
import type { OzWorkspaceResponse } from "schemas";
import {
  createWorkspace,
  deleteWorkspace,
  listWorkspaces,
  updateWorkspace
} from "../api/workspaces.js";

type WorkspaceForm = {
  id: string;
  name: string;
  path: string;
  tmuxSocket: string;
};

const emptyForm = (): WorkspaceForm => ({
  id: "",
  name: "",
  path: "${COCODER_HOME}/workspaces/",
  tmuxSocket: ""
});

export function WorkspacesPage() {
  const [workspaces, setWorkspaces] = useState<OzWorkspaceResponse[]>([]);
  const [form, setForm] = useState<WorkspaceForm>(emptyForm());
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      setWorkspaces(await listWorkspaces());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    try {
      const tmuxSocket = form.tmuxSocket.trim() || `cocoder-${form.id.trim()}`;
      await createWorkspace({
        id: form.id.trim(),
        name: form.name.trim() || form.id.trim(),
        path: form.path.trim(),
        tmuxSocket
      });
      setForm(emptyForm());
      setMessage("Workspace registered.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function onDelete(id: string) {
    if (!window.confirm(`Remove workspace "${id}" from the Oz registry?`)) return;
    setError(null);
    setMessage(null);
    try {
      await deleteWorkspace(id);
      setMessage(`Removed ${id}.`);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function onUpdate(workspace: OzWorkspaceResponse, patch: { name?: string; path?: string; tmuxSocket?: string }) {
    setError(null);
    setMessage(null);
    try {
      await updateWorkspace(workspace.id, patch);
      setMessage(`Updated ${workspace.id}.`);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <section>
      <h1>Workspaces</h1>
      <p className="muted">Manual registry entries for Oz launch and observation (PC-Q6=A).</p>

      <div className="panel">
        <h2>Register workspace</h2>
        <form onSubmit={onCreate}>
          <label htmlFor="ws-id">ID (slug)</label>
          <input
            id="ws-id"
            value={form.id}
            onChange={(event) => setForm({ ...form, id: event.target.value })}
            required
          />
          <label htmlFor="ws-name">Display name</label>
          <input
            id="ws-name"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
          <label htmlFor="ws-path">Tokenized path</label>
          <input
            id="ws-path"
            value={form.path}
            onChange={(event) => setForm({ ...form, path: event.target.value })}
            required
          />
          <label htmlFor="ws-socket">tmux socket (optional)</label>
          <input
            id="ws-socket"
            value={form.tmuxSocket}
            onChange={(event) => setForm({ ...form, tmuxSocket: event.target.value })}
            placeholder="cocoder-{id}"
          />
          <button type="submit">Register</button>
        </form>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {message ? <p className="success">{message}</p> : null}

      <div className="panel">
        <h2>Registered</h2>
        {loading ? <p className="muted">Loading…</p> : null}
        {!loading && workspaces.length === 0 ? <p className="muted">No workspaces registered yet.</p> : null}
        {workspaces.map((workspace) => (
          <WorkspaceCard key={workspace.id} workspace={workspace} onDelete={onDelete} onUpdate={onUpdate} />
        ))}
      </div>
    </section>
  );
}

function WorkspaceCard(props: {
  workspace: OzWorkspaceResponse;
  onDelete: (id: string) => void;
  onUpdate: (workspace: OzWorkspaceResponse, patch: { name?: string; path?: string; tmuxSocket?: string }) => void;
}) {
  const { workspace, onDelete, onUpdate } = props;
  const [name, setName] = useState(workspace.name ?? workspace.id);
  const [path, setPath] = useState(workspace.path);
  const [tmuxSocket, setTmuxSocket] = useState(workspace.tmuxSocket ?? "");

  useEffect(() => {
    setName(workspace.name ?? workspace.id);
    setPath(workspace.path);
    setTmuxSocket(workspace.tmuxSocket ?? "");
  }, [workspace]);

  return (
    <article className="workspace-card">
      <h3>{workspace.id}</h3>
      <p className="mono muted">Resolved: {workspace.resolvedPath}</p>
      <label htmlFor={`name-${workspace.id}`}>Name</label>
      <input id={`name-${workspace.id}`} value={name} onChange={(event) => setName(event.target.value)} />
      <label htmlFor={`path-${workspace.id}`}>Path</label>
      <input id={`path-${workspace.id}`} value={path} onChange={(event) => setPath(event.target.value)} />
      <label htmlFor={`socket-${workspace.id}`}>tmux socket</label>
      <input id={`socket-${workspace.id}`} value={tmuxSocket} onChange={(event) => setTmuxSocket(event.target.value)} />
      <div className="row">
        <button type="button" onClick={() => onUpdate(workspace, { name, path, tmuxSocket })}>
          Save
        </button>
        <button type="button" className="danger" onClick={() => onDelete(workspace.id)}>
          Remove
        </button>
      </div>
    </article>
  );
}
