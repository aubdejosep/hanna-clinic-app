import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import KioskPage from './pages/KioskPage.jsx'
import { ToastProvider } from './components/ui.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import './styles.css'

// Lets Chrome install the app full-screen (public/sw.js stores nothing; it only shows an offline page).
if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register('/sw.js').catch(() => {})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <ErrorBoundary>
        <ToastProvider>
          {window.location.pathname.startsWith('/kiosk') ? <KioskPage /> : <App />}
        </ToastProvider>
      </ErrorBoundary>
    </BrowserRouter>
  </StrictMode>,
)
