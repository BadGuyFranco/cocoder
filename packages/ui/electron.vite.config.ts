import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Three build targets: main (Node), preload (sandboxed bridge), renderer (React in the BrowserWindow).
// Renderer root is app/ so index.html + *.tsx live together, out of packages/ui/src (Node-only typecheck).
export default defineConfig({
  main: {
    build: {
      outDir: 'out/main',
      lib: { entry: resolve(__dirname, 'electron/main.ts') },
      rollupOptions: { external: ['electron'] },
    },
  },
  preload: {
    build: {
      outDir: 'out/preload',
      lib: { entry: resolve(__dirname, 'electron/preload.ts') },
      rollupOptions: { external: ['electron'] },
    },
  },
  renderer: {
    root: 'app',
    plugins: [react()],
    build: {
      outDir: 'out/renderer',
      rollupOptions: { input: resolve(__dirname, 'app/index.html') },
    },
  },
})
