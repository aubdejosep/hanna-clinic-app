import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, BedDouble, CalendarDays, CalendarPlus, UserCheck, UserPlus, X } from 'lucide-react'
import { useToast } from './ui.jsx'
import { BookPanel, WalkInPanel } from './AppointmentPanels.jsx'
import { appointmentsChanged } from './TagCheckIn.jsx'
import { prettyDay } from '../lib/format.js'
import { prettyTime } from '../lib/appointments.js'

// The old system's floating button, bottom right on every page: Appointment (Book Appointment,
// Walk In, Admit Inpatient) and Register Pet Owner/Pets.
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
    : [['Appointment', CalendarDays, () => setMenu('appointment')], ['Register Pet Owner/Pets', UserPlus, () => { setMenu(null); navigate('/clients?new=1') }]]

  return (
    <>
      <div className="fab-wrap" ref={box}>
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
      {panel === 'admit' && <WalkInPanel admit onClose={() => setPanel(null)} onDone={(a) => done(a, `${a.pet.name} admitted as inpatient`)} />}
    </>
  )
}
