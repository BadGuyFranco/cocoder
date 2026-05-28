import { describe, expect, it } from "vitest";

import { workspaceRegistryEntrySchema } from "../src/workspaces-registry.js";

describe("workspaceRegistryEntrySchema", () => {
  it("accepts a workspace description for multi-root entries", () => {
    const parsed = workspaceRegistryEntrySchema.parse({
      id: "helper-docs",
      path: "${root:cocoder}/docs",
      description: "Helper: public documentation root"
    });

    expect(parsed.description).toBe("Helper: public documentation root");
  });

  it("accepts entries without a description for backward compatibility", () => {
    const parsed = workspaceRegistryEntrySchema.parse({
      id: "cocoder",
      path: "/Users/example/CoCoder"
    });

    expect(parsed.description).toBeUndefined();
  });
});
