import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { MotionConfig } from 'motion/react'
import 'leaflet/dist/leaflet.css'
import './styles/app.css'
import App from './App'
import { applyPrefs } from './lib/prefs'

// Before the first paint, so a saved dark theme never flashes light.
applyPrefs()
// Pages slide out before the next one arrives; App restores scroll itself
// once the exit is done, so the leaving page holds still.
if ('scrollRestoration' in history) history.scrollRestoration = 'manual'

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Offline support is a progressive enhancement; the app still works.
    })
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      {/* Every spring in the app collapses to an instant change when the OS asks for less motion. */}
      <MotionConfig reducedMotion="user">
        <App />
      </MotionConfig>
    </BrowserRouter>
  </React.StrictMode>,
)
