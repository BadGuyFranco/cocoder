import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { SettingsPage } from "./SettingsPage.js";

describe("SettingsPage", () => {
  it("renders config refs verbatim without resolving secrets", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        if (url.includes("/auth/session")) {
          return new Response(JSON.stringify({ bearerToken: "b", csrfToken: "c" }), { status: 200 });
        }
        if (url.includes("/settings") && !url.includes("PUT")) {
          return new Response(
            JSON.stringify({ config: { secrets: { openai: "${env:OPENAI_API_KEY}" } } }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      })
    );

    render(<SettingsPage />);

    await waitFor(() => {
      const textarea = screen.getByLabelText(/Current install config/i) as HTMLTextAreaElement;
      expect(textarea.value).toContain("${env:OPENAI_API_KEY}");
    });
  });
});
