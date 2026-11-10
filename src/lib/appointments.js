import { BedDouble, CalendarCheck, CalendarX, CircleCheck, CircleX, Clock, LogIn, Pill, Stethoscope } from 'lucide-react'

// The old system's status names, plus No Show.
export const STATUS = {
  pending: { label: 'Pending', icon: Clock, tone: 'booked' },
  accepted: { label: 'Accepted', icon: CalendarCheck, tone: 'booked' },
  arrived: { label: 'Arrived', icon: LogIn, tone: 'in' },
  started: { label: 'Started', icon: Stethoscope, tone: 'in' },
  inpatient: { label: 'Inpatient', icon: BedDouble, tone: 'stay' },
  dispense: { label: 'Dispense', icon: Pill, tone: 'in' },
  completed: { label: 'Completed', icon: CircleCheck, tone: 'done' },
  cancelled: { label: 'Cancelled', icon: CircleX, tone: 'off' },
  no_show: { label: 'No Show', icon: CalendarX, tone: 'off' },
}

// Tabs on the Appointments list, in the old order.
export const TABS = [
  ['all', 'All'], ['accepted', 'Accepted'], ['arrived', 'Arrived'], ['started', 'Started'], ['inpatient', 'Inpatient'],
  ['dispense', 'Dispense'], ['completed', 'Completed'], ['cancelled', 'Cancelled'], ['no_show', 'No Show'],
]

// What the buttons on an appointment do, by status: [to, label, hint] — the first is the main step.
export const ACTIONS = {
  pending: [['arrived', 'Check In', 'Same as tapping the pet’s tag']],
  accepted: [['arrived', 'Check In', 'Same as tapping the pet’s tag']],
  no_show: [['arrived', 'Check In', 'They came after all'], ['accepted', 'Back to Accepted', null]],
  arrived: [['started', 'Start Consultation', 'The vet is seeing the pet'], ['completed', 'Check Out', 'For grooming or a quick visit: same as tapping out']],
  started: [['dispense', 'Send to Dispense', 'Front desk prepares medicines and the bill'], ['inpatient', 'Admit as Inpatient', 'The pet stays: confinement or recovery'], ['completed', 'Check Out', 'Same as tapping out']],
  inpatient: [['dispense', 'Send to Dispense', 'Going home: medicines and the bill'], ['completed', 'Check Out', 'Same as tapping out']],
  dispense: [['completed', 'Check Out', 'Same as tapping out']],
  completed: [],
  cancelled: [],
}

export const CANCEL_REASONS = ['Owner asked to cancel', 'Owner can’t make it', 'Pet is unwell', 'Clinic schedule change', 'Pet passed away']

export function prettyTime(hhmm) { // "14:05" -> "2:05 PM"
  if (!hhmm) return ''
  const [h, m] = hhmm.split(':').map(Number)
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}
export function clockTime(iso) { // UTC ISO -> "2:05 PM" Manila
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' })
}
export function longDay(day) { // "2026-11-10" -> "Tuesday, November 10, 2026"
  return new Date(`${day}T12:00:00+08:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' })
}
export function shortDay(day) { // "Nov 10"
  return new Date(`${day}T12:00:00+08:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'Asia/Manila' })
}
export function since(iso, now = Date.now()) { // "35 min", "2 h 10 min", "3 days"
  if (!iso) return ''
  const mins = Math.max(0, Math.round((now - Date.parse(iso)) / 60000))
  if (mins < 60) return `${mins} min`
  if (mins < 24 * 60) return `${Math.floor(mins / 60)} h${mins % 60 ? ` ${mins % 60} min` : ''}`
  const days = Math.floor(mins / (24 * 60))
  return `${days} day${days > 1 ? 's' : ''}`
}
export function manilaToday() {
  return new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
}
export function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
export function weekday(day) { // 0 = Monday
  return (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7
}

// 10-minute slots between opening and closing. hours: the clinic's {mon: {open, close, closed}} or null.
const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
export function timeSlots(day, hours) {
  const h = hours?.[DAY_KEYS[weekday(day)]]
  if (hours && Object.keys(hours).length && !h) return [] // closed that day
  const open = h && !h.closed && h.open ? h.open : '08:00'
  const close = h && !h.closed && h.close ? h.close : '20:00'
  const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
  const out = []
  const breaks = (h?.breaks || []).map((b) => [toMin(b.start), toMin(b.end)])
  for (let m = toMin(open); m < toMin(close); m += 10) if (!breaks.some(([a, b]) => m >= a && m < b)) out.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`)
  return out
}
