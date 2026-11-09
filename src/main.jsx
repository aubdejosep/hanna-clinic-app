import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import KioskPage from './pages/KioskPage.jsx'
import { ToastProvider } from './components/ui.jsx'
import './styles.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        {window.location.pathname.startsWith('/kiosk') ? <KioskPage /> : <App />}
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
)
