import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/AppLayout.js";
import { PrioritiesPage } from "./pages/PrioritiesPage.js";
import { RunInspectorPage } from "./pages/RunInspectorPage.js";
import { RunsPage } from "./pages/RunsPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { WorkspacesPage } from "./pages/WorkspacesPage.js";
import "./styles/fusion.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HashRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="/workspaces" replace />} />
          <Route path="/workspaces" element={<WorkspacesPage />} />
          <Route path="/priorities" element={<PrioritiesPage />} />
          <Route path="/runs" element={<RunsPage />} />
          <Route path="/runs/:runId" element={<RunInspectorPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </HashRouter>
  </StrictMode>
);
