import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bell, CalendarPlus, Globe, ClipboardCheck, PawPrint, Pill, Stethoscope, UserRound, X } from 'lucide-react'
import { useToast } from './ui.jsx'
import { useAppointmentsChanged } from './TagCheckIn.jsx'
import { api } from '../lib/api.js'
import { useApi } from '../lib/useApi.js'
import { prettyDay } from '../lib/format.js'

const KIND = {
  follow_up: { icon: CalendarPlus, label: 'Follow-Ups' },
  dispense: { icon: Pill, label: 'Dispensed Items' },
  no_services: { icon: ClipboardCheck, label: 'Services' },
  no_vet: { icon: Stethoscope, label: 'Staff' },
  pet_info: { icon: PawPrint, label: 'Pet Details' },
  owner_info: { icon: UserRound, label: 'Owner Details' },
  website_client: { icon: Globe, label: 'Online Clients' },
}
const linkOf = (r) => (r.kind === 'pet_info' ? `/pets/${r.pet.id}` : ['owner_info', 'website_client'].includes(r.kind) ? `/clients/${r.owner.id}` : `/appointments/${r.appointmentId}`)

// The bell: workflow steps still to finish. Each one clears itself once the step is done.
export default function ReminderBell({ align = 'right' }) {
  const { data, reload, setData } = useApi('reminders')
  // Opening the bell asks for the latest (the server otherwise shares results for 2 minutes).
  const refresh = () => api('reminders?fresh=1').then(setData).catch(() => {})
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(null)
  const box = useRef(null)
  const toast = useToast()
  useAppointmentsChanged(reload)
  useEffect(() => {
    // Every 2 minutes, and only while this tab is visible (saves database reads).
    const t = setInterval(() => { if (!document.hidden) reload() }, 2 * 60000)
    const onVisible = () => { if (!document.hidden) reload() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible) }
  }, [reload])
  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  async function notNeeded(r) {
    setBusy(r.key)
    try {
      await api('reminders', { method: 'POST', body: { key: r.key } })
      toast('Reminder cleared')
      refresh()
    } catch (err) {
      toast(err.message)
    } finally {
      setBusy(null)
    }
  }
  const list = data?.reminders || []
  return (
    <div className="bell" ref={box}>
      <button type="button" className="icon-btn bell-btn" onClick={() => { setOpen(!open); if (!open) refresh() }} aria-expanded={open}
        aria-label={list.length ? `${list.length} reminders` : 'Reminders'} title="Reminders">
        <Bell />
        {list.length > 0 && <span className="bell-count">{list.length > 99 ? '99+' : list.length}</span>}
      </button>
      {open && (
        <div className={`bell-panel card bell-${align}`} role="dialog" aria-label="Reminders">
          <div className="bell-head">
            <strong>Reminders</strong>
            <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Close" title="Close"><X /></button>
          </div>
          {!list.length ? <p className="muted bell-empty">All caught up. Steps that are missed on a visit show here until they're done.</p> : (
            <ul className="bell-list">
              {list.map((r) => {
                const K = KIND[r.kind]
                return (
                  <li key={r.key}>
                    <K.icon aria-hidden />
                    <div>
                      <strong>{r.title}</strong>
                      <span className="cell-sub">{r.text}{r.day ? ` · Visit ${prettyDay(r.day)}` : ''}</span>
                      <div className="bell-actions">
                        <Link className="text-btn" to={linkOf(r)} onClick={() => setOpen(false)}>{r.action}</Link>
                        <button type="button" className="text-btn" onClick={() => notNeeded(r)} disabled={busy === r.key}>Not Needed</button>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
