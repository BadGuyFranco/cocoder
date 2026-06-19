import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Three src/ build targets: main (Node), preload (sandboxed bridge), renderer (React in the BrowserWindow).
// Build output paths stay under out/ so Electron runtime path joins remain unchanged.
export default defineConfig({
  main: {
    build: {
      outDir: 'out/main',
      lib: { entry: resolve(__dirname, 'src/main/main.ts') },
      rollupOptions: { external: ['electron'] },
    },
  },
  preload: {
    build: {
      outDir: 'out/preload',
      // Sandboxed preloads (sandbox:true) MUST be CommonJS — an ESM .mjs preload silently fails to
      // load, leaving window.oz undefined. The package is type:module, so force a .cjs CommonJS bundle.
      lib: { entry: resolve(__dirname, 'src/preload/preload.ts'), formats: ['cjs'], fileName: () => 'preload.cjs' },
      rollupOptions: { external: ['electron'], output: { entryFileNames: 'preload.cjs' } },
    },
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react()],
    build: {
      outDir: 'out/renderer',
      rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') },
    },
  },
})
