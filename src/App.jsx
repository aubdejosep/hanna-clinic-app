import { useEffect, useState } from 'react'
import { Route, Routes } from 'react-router-dom'
import { TriangleAlert } from 'lucide-react'
import Layout from './components/Layout.jsx'
import { Empty, PawLoader } from './components/ui.jsx'
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
import InventoryPage from './pages/InventoryPage.jsx'
import CustomerAnalyticsPage from './pages/CustomerAnalyticsPage.jsx'
import ContentPage from './pages/ContentPage.jsx'
import NotificationsPage from './pages/NotificationsPage.jsx'
import SettingsPage from './pages/SettingsPage.jsx'
import DevicesPage from './pages/DevicesPage.jsx'
import BalancesPage from './pages/BalancesPage.jsx'
import TransactionsPage from './pages/TransactionsPage.jsx'
import MedicationsPage from './pages/MedicationsPage.jsx'
import MedicationFormPage from './pages/MedicationFormPage.jsx'
import { applyDisplay } from './lib/theme.js'
import { setLogoVersion } from './lib/logo.js'
import { CountPage, CountsPage, MovementsPage } from './pages/StockPages.jsx'
import { StaffContext } from './lib/staff.js'

export default function App() {
  const { data, error, reload, setData } = useApi('me')
  // The person's theme and text size (Settings) follow their login to any device.
  useEffect(() => { if (data?.staff) applyDisplay(data.staff) }, [data?.staff?.theme, data?.staff?.textSize]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (data) setLogoVersion(data.logoVersion) }, [data?.logoVersion]) // eslint-disable-line react-hooks/exhaustive-deps
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
  if (!data) return <main className="page-loading"><PawLoader label="Opening the clinic app…" /></main>

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
        <Route path="analytics/customers" element={<CustomerAnalyticsPage />} />
        <Route path="inventory" element={<InventoryPage />} />
        <Route path="inventory/movements" element={<MovementsPage />} />
        <Route path="inventory/counts" element={<CountsPage />} />
        <Route path="inventory/counts/:id" element={<CountPage />} />
        <Route path="content" element={<ContentPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="settings" element={<SettingsPage onStaff={(staff) => setData({ ...data, staff })} />} />
        <Route path="devices" element={<DevicesPage />} />
        <Route path="finances/balances" element={<BalancesPage />} />
        <Route path="finances/transactions" element={<TransactionsPage />} />
        <Route path="prescription/medications" element={<MedicationsPage />} />
        <Route path="prescription/medications/new" element={<MedicationFormPage key="new" />} />
        <Route path="prescription/medications/:id/edit" element={<MedicationFormPage />} />
        <Route path="inbox/*" element={<ComingSoon module="inbox" />} />
        <Route path="*" element={<ComingSoon module="missing" />} />
      </Route>
    </Routes>
    </StaffContext.Provider>
  )
}
