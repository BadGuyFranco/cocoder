import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { RunsPage } from "./RunsPage.js";

describe("RunsPage", () => {
  it("renders run rows from GET /runs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        if (url.includes("/auth/session")) {
          return new Response(JSON.stringify({ bearerToken: "b", csrfToken: "c" }), { status: 200 });
        }
        if (url.includes("/runs") && !url.includes("DELETE")) {
          return new Response(
            JSON.stringify({
              runs: [
                {
                  runId: "run-001",
                  workspaceId: "demo",
                  runDir: "/tmp/run-001",
                  status: "running",
                  prioritySlug: "alpha",
                  profile: "p",
                  route: "r",
                  tmuxSocket: "sock",
                  laneCount: 1,
                  sessionsAttached: 1
                }
              ]
            }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      })
    );

    render(
      <MemoryRouter>
        <RunsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("run-001")).toBeTruthy();
      expect(screen.getByText("alpha")).toBeTruthy();
    });
  });
});
