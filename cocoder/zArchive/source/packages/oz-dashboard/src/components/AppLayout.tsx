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
          <NavLink to="/priorities" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
            Priorities
          </NavLink>
          <NavLink to="/runs" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
            Runs
          </NavLink>
          <NavLink to="/settings" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
            Settings
          </NavLink>
        </nav>
      </aside>
      <main className="main-pane">
        <Outlet />
      </main>
    </div>
  );
}
