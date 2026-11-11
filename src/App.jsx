import { useEffect, useState } from 'react'
import { Route, Routes } from 'react-router-dom'
import { TriangleAlert } from 'lucide-react'
import Layout from './components/Layout.jsx'
import { Empty } from './components/ui.jsx'
import { useApi } from './lib/useApi.js'
import Dashboard from './pages/Dashboard.jsx'
import Clients from './pages/Clients.jsx'
import OwnerPage from './pages/OwnerPage.jsx'
import PetPage from './pages/PetPage.jsx'
import ComingSoon from './pages/ComingSoon.jsx'
import StaffPage from './pages/StaffPage.jsx'
import ClinicProfilePage from './pages/ClinicProfilePage.jsx'
import ServicesPage from './pages/ServicesPage.jsx'
import LoginPage from './pages/LoginPage.jsx'
import AppointmentsPage from './pages/AppointmentsPage.jsx'
import AppointmentPage from './pages/AppointmentPage.jsx'
import RecordsPage from './pages/RecordsPage.jsx'
import { StaffContext } from './lib/staff.js'

export default function App() {
  const { data, error, reload } = useApi('me')
  const [loggedOut, setLoggedOut] = useState(false)
  useEffect(() => {
    const onLoggedOut = () => setLoggedOut(true)
    window.addEventListener('clinic:logged-out', onLoggedOut)
    return () => window.removeEventListener('clinic:logged-out', onLoggedOut)
  }, [])

  if (loggedOut || error?.status === 401) {
    return <LoginPage onLoggedIn={() => { setLoggedOut(false); reload() }} />
  }
  if (error) {
    return (
      <main className="main" style={{ maxWidth: 560, margin: '10vh auto' }}>
        <div className="card">
          <Empty icon={TriangleAlert} title={error.status === 403 ? "You're not on the staff list" : "Can't open the clinic app"} text={error.message}>
            <button type="button" className="btn" onClick={() => window.location.reload()}>Try again</button>
          </Empty>
        </div>
      </main>
    )
  }
  if (!data) return null

  return (
    <StaffContext.Provider value={data.staff}>
    <Routes>
      <Route element={<Layout staff={data.staff} />}>
        <Route index element={<Dashboard staff={data.staff} />} />
        <Route path="clients" element={<Clients />} />
        <Route path="clients/:id" element={<OwnerPage />} />
        <Route path="pets/:id" element={<PetPage />} />
        <Route path="appointments" element={<AppointmentsPage />} />
        <Route path="appointments/:id" element={<AppointmentPage />} />
        <Route path="records" element={<RecordsPage />} />
        <Route path="records/*" element={<ComingSoon module="records" />} />
        <Route path="clinic/staff" element={<StaffPage />} />
        <Route path="clinic/profile" element={<ClinicProfilePage />} />
        <Route path="clinic/services" element={<ServicesPage />} />
        <Route path="clinic" element={<ClinicProfilePage />} />
        <Route path="inbox/*" element={<ComingSoon module="inbox" />} />
        <Route path="*" element={<ComingSoon module="missing" />} />
      </Route>
    </Routes>
    </StaffContext.Provider>
  )
}
