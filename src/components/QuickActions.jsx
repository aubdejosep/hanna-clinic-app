import { useEffect, useRef, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { ArrowLeft, BedDouble, CalendarDays, CalendarPlus, Mail, ShoppingBag, UserCheck, UserPlus, X } from 'lucide-react'
import { useApi } from '../lib/useApi.js'
import { useToast } from './ui.jsx'
import { BookPanel, WalkInPanel } from './AppointmentPanels.jsx'
import { appointmentsChanged } from './TagCheckIn.jsx'
import { SellPanel } from './SellPanel.jsx'
import { prettyDay } from '../lib/format.js'
import { prettyTime } from '../lib/appointments.js'

// Unread conversations in the Inbox, shown on the floating Inbox button, with a sound when new messages arrive.
function InboxBadge() {
  const { data, reload } = useApi('inbox/count')
  const prev = useRef(null)
  const chime = useRef(null)
  useEffect(() => {
    const a = new Audio('/sounds/inbox-notification.mp3')
    a.preload = 'auto'
    chime.current = a
    const t = setInterval(() => { if (!document.hidden) reload() }, 30000)
    const onVis = () => { if (!document.hidden) reload() }
    window.addEventListener('clinic:inbox-changed', reload)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      clearInterval(t)
      window.removeEventListener('clinic:inbox-changed', reload)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [reload])
  useEffect(() => {
    if (data?.unread == null) return
    if (prev.current !== null && data.unread > prev.current && chime.current) {
      chime.current.currentTime = 0
      chime.current.play().catch(() => {})
    }
    prev.current = data.unread
  }, [data?.unread])
  return data?.unread ? <span className="fab-badge" aria-label={`${data.unread} unread`}>{data.unread > 99 ? '99+' : data.unread}</span> : null
}

// The old system's floating button, bottom right on every page: Appointment (Book Appointment,
// Walk In, Admit Inpatient), Register Pet Owner/Pets, and Sell Items (over the counter),
// with the Inbox button stacked right above it (and above the menu when open).
export default function QuickActions() {
  const [menu, setMenu] = useState(null) // null | 'main' | 'appointment'
  const [panel, setPanel] = useState(null) // 'book' | 'walkin' | 'admit'
  const box = useRef(null)
  const navigate = useNavigate()
  const toast = useToast()
  useEffect(() => {
    if (!menu) return undefined
    const onDown = (e) => { if (box.current && !box.current.contains(e.target)) setMenu(null) }
    const onKey = (e) => { if (e.key === 'Escape') setMenu(null) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [menu])

  const open = (p) => { setMenu(null); setPanel(p) }
  const done = (a, message) => { setPanel(null); appointmentsChanged(); toast(message); navigate(`/appointments/${a.id}`) }
  const items = menu === 'appointment'
    ? [['Book Appointment', CalendarPlus, () => open('book')], ['Walk In', UserCheck, () => open('walkin')], ['Admit Inpatient', BedDouble, () => open('admit')]]
    : [['Appointment', CalendarDays, () => setMenu('appointment')], ['Register Pet Owner/Pets', UserPlus, () => { setMenu(null); navigate('/clients?new=1') }], ['Sell Items', ShoppingBag, () => open('sell')]]

  return (
    <>
      <div className="fab-wrap" ref={box}>
        <NavLink to="/inbox" className="fab fab-inbox" onClick={() => setMenu(null)} aria-label="Inbox" title="Inbox">
          <Mail aria-hidden />
          <InboxBadge />
        </NavLink>
        {menu && (
          <ul className="fab-menu" role="menu">
            {items.map(([label, Icon, run]) => (
              <li key={label}>
                <button type="button" role="menuitem" className="fab-item" onClick={run}>
                  <span className="fab-label">{label}</span>
                  <span className="fab-icon"><Icon aria-hidden /></span>
                </button>
              </li>
            ))}
            {menu === 'appointment' && (
              <li><button type="button" className="fab-back" onClick={() => setMenu('main')}><ArrowLeft aria-hidden /> Change Action</button></li>
            )}
          </ul>
        )}
        <button type="button" className="fab" onClick={() => setMenu(menu ? null : 'main')} aria-expanded={!!menu} aria-label={menu ? 'Close Quick Actions' : 'Quick Actions'} title={menu ? 'Close' : 'Book, walk in, admit or register'}>
          {menu ? <X /> : <CalendarDays />}
        </button>
      </div>
      {panel === 'book' && <BookPanel onClose={() => setPanel(null)} onDone={(a) => done(a, `${a.pet.name} booked for ${prettyDay(a.day)}, ${prettyTime(a.time)}`)} />}
      {panel === 'walkin' && <WalkInPanel onClose={() => setPanel(null)} onDone={(a) => done(a, `${a.pet.name} checked in`)} />}
      {panel === 'sell' && <SellPanel onClose={() => setPanel(null)} onDone={(msg) => { setPanel(null); toast(msg) }} />}
      {panel === 'admit' && <WalkInPanel admit onClose={() => setPanel(null)} onDone={(a) => done(a, `${a.pet.name} admitted as inpatient`)} />}
    </>
  )
}
