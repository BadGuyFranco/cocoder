import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Bundled fonts (offline, CSP-safe) — Josefin is @font-face'd in fusion.css; Inter + JetBrains here.
import '@fontsource/inter/300.css'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
// Phosphor thin icon webfont — vendored locally into app/assets/phosphor (the package's exports map
// blocks the deep src/thin/style.css path under Rollup, so we ship the thin weight ourselves).
import './assets/phosphor/style.css'
import './styles/fusion.css'
import './styles/oz.css'
import { App } from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
