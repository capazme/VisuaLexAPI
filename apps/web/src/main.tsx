import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Self-hosted faces (spec 2026-10-18-redesign-inchiostro §4.2): no request to a third-party font server.
import '@fontsource-variable/newsreader/opsz.css'
import '@fontsource-variable/newsreader/opsz-italic.css'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
