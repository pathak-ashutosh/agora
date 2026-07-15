import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { createLogger } from './lib/log'

// Last-resort visibility: anything that escapes React lands in the log ring.
const log = createLogger('global')
window.addEventListener('error', (e) => {
  log.error(`uncaught: ${e.message}`, e.error)
})
window.addEventListener('unhandledrejection', (e) => {
  log.error('unhandled rejection', e.reason)
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
