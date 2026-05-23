import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const daemonTarget = process.env.COCODER_OZ_DEV_PROXY ?? "http://127.0.0.1:7878";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/auth": { target: daemonTarget, changeOrigin: true },
      "/workspaces": { target: daemonTarget, changeOrigin: true },
      "/settings": { target: daemonTarget, changeOrigin: true },
      "/runs": { target: daemonTarget, changeOrigin: true },
      "/health": { target: daemonTarget, changeOrigin: true }
    }
  },
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
});
