import { defineConfig } from "vitest/config";

export default defineConfig({
  // Source uses NodeNext-style `.js` extensions on relative imports; map them
  // to the `.ts` sources so vitest can run against src/ without a build step.
  resolve: {
    extensionAlias: {
      ".js": [".ts", ".js"]
    }
  },
  test: {
    include: ["test/**/*.test.ts"]
  }
});
