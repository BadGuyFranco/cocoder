import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PrioritiesPage } from "./PrioritiesPage.js";

describe("PrioritiesPage", () => {
  it("lists priorities and launch defaults for a workspace", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        if (url.includes("/auth/session")) {
          return new Response(JSON.stringify({ bearerToken: "b", csrfToken: "c" }), { status: 200 });
        }
        if (url.includes("/workspaces/demo/priorities")) {
          return new Response(
            JSON.stringify({
              workspaceId: "demo",
              prioritiesPath: "/tmp/demo/cocoder/PRIORITIES.md",
              priorities: [
                {
                  slug: "alpha",
                  description: "First",
                  status: "Active",
                  section: "Active",
                  readmePath: "./priorities/alpha/README.md"
                }
              ]
            }),
            { status: 200 }
          );
        }
        if (url.includes("/runs/debugger")) {
          return new Response(
            JSON.stringify({
              ok: true,
              workspaceId: "demo",
              sessionId: "NO-SESSION",
              noSession: true,
              runDir: null,
              debugDir: "/tmp/debug",
              promptPath: "/tmp/debug/prompt.md",
              wrapperPath: "/tmp/debug/launch-debugger.sh",
              reportPath: "/tmp/debug/debug-report.md",
              resultPath: "/tmp/debug/debug-result.json",
              gitWrite: true,
              terminalOpened: true,
              issues: []
            }),
            { status: 200 }
          );
        }
        if (url.includes("/workspaces")) {
          return new Response(
            JSON.stringify({
              workspaces: [{ id: "demo", name: "Demo", path: "x", resolvedPath: "/tmp/demo", tmuxSocket: "s" }]
            }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      })
    );

    render(
      <MemoryRouter>
        <PrioritiesPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("alpha")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Launch" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Launch debugger" })).toBeTruthy();
    });
  });
});
