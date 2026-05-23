import { NavLink, Outlet } from "react-router-dom";

export function AppLayout() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">Oz</div>
        <nav>
          <NavLink to="/workspaces" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
            Workspaces
          </NavLink>
          <NavLink to="/settings" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
            Settings
          </NavLink>
        </nav>
        <p className="muted" style={{ marginTop: "2rem" }}>
          Runs and Priorities land in Batch 4.
        </p>
      </aside>
      <main className="main-pane">
        <Outlet />
      </main>
    </div>
  );
}
