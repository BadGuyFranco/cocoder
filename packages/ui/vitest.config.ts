import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Component tests render each surface against fixtures via a MOCK client (jsdom).
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
    globals: true,
  },
})
