import { describe, expect, it } from "vitest";

import { ozWorkspaceListResponseSchema, ozWorkspaceResponseSchema } from "../src/oz/workspace-http.js";

describe("Oz workspace HTTP schemas", () => {
  it("accepts response entries with a description", () => {
    const parsed = ozWorkspaceResponseSchema.parse({
      id: "docs",
      path: "${root:cocoder}/docs",
      resolvedPath: "/workspaces/cocoder/docs",
      description: "Helper: public documentation root"
    });

    expect(parsed.description).toBe("Helper: public documentation root");
  });

  it("keeps list response entries without descriptions backward-compatible", () => {
    const parsed = ozWorkspaceListResponseSchema.parse({
      workspaces: [
        {
          id: "cocoder",
          path: "${COCODER_HOME}",
          resolvedPath: "/workspaces/cocoder"
        }
      ]
    });

    expect(parsed.workspaces[0].description).toBeUndefined();
  });
});
