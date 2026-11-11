import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, BedDouble, Wallet, CircleCheck, Hourglass, LogOut, Megaphone, Pill, Siren, Stethoscope, TriangleAlert } from 'lucide-react'
import { ErrorNote, PetAvatar, useToast, PawLoader } from './ui.jsx'
import { appointmentsChanged, useAppointmentsChanged } from './TagCheckIn.jsx'
import { PaymentPanel } from './QuickAdd.jsx'
import { api } from '../lib/api.js'
import { useApi } from '../lib/useApi.js'
import { clockTime, since } from '../lib/appointments.js'

// The stations a visit moves through, left to right, with what happens next at each.
const STATIONS = [
  { key: 'waiting', title: 'Waiting', hint: 'Tapped in. First come, first served; emergencies on top.', icon: Hourglass },
  { key: 'with_vet', title: 'With Vet', hint: 'Consultation started.', icon: Stethoscope },
  { key: 'inpatient', title: 'Inpatient', hint: 'Confined or recovering.', icon: BedDouble },
  { key: 'dispense', title: 'Dispense', hint: 'Front desk: anything else given, then Take Payment. Tap the tag on the way out.', icon: Pill },
  { key: 'done', title: 'Done Today', hint: 'Checked out. Unfinished steps stay here until done.', icon: CircleCheck },
]
const NEXT = { with_vet: ['dispense', 'Send to Dispense'], inpatient: ['dispense', 'Send to Dispense'], dispense: ['completed', 'Check Out'] }
const PAID = new Set(['paid', 'not_tracked'])

function Card({ a, station, position, onMove, onCheckOut, busy }) {
  const next = station === 'dispense' && !PAID.has(a.paymentStatus) ? ['pay', 'Take Payment'] : NEXT[station]
  const at = station === 'waiting' ? a.checkedInAt : station === 'with_vet' ? a.startedAt : station === 'inpatient' ? (a.admittedAt || a.checkedInAt) : station === 'dispense' ? a.dispenseAt : a.checkedOutAt
  return (
    <li className={`board-card ${a.emergency ? 'is-urgent' : ''}`}>
      <Link to={`/appointments/${a.id}`} className="board-card-main">
        <PetAvatar species={a.pet.species} />
        <span className="board-who">
          <strong>{station === 'waiting' && <span className="queue-no">{position}</span>}{a.pet.name}</strong>
          <span className="cell-sub">{a.owner.name}</span>
          <span className="cell-sub">
            {a.emergency && <><Siren size={12} aria-hidden /> Emergency · </>}
            {station === 'done' ? `Out ${clockTime(at)}` : station === 'inpatient' ? `Admitted ${since(at)} ago` : `${since(at)} ${station === 'waiting' ? 'waiting' : 'here'}`}
            {a.staff.length > 0 && ` · ${a.staff.join(', ')}`}
          </span>
          {a.items.length > 0 && <span className="cell-sub board-items">{a.items.join(', ')}</span>}
        </span>
      </Link>
      {a.steps.length > 0 && (
        <ul className="steps" aria-label="Still to do">
          {a.steps.map((s, i) => (
            <li key={i}><Link to={s.kind === 'pet_info' ? `/pets/${a.pet.id}` : s.kind === 'owner_info' ? `/clients/${a.owner.id}` : `/appointments/${a.id}${s.kind === 'unpaid' ? '?pay=1' : s.kind === 'follow_up' ? '?followup=1' : ''}`} className="step-chip"><TriangleAlert aria-hidden /> {s.text}</Link></li>
          ))}
        </ul>
      )}
      {next && (
        <button type="button" className="btn btn-quiet board-move" onClick={() => (next[0] === 'pay' ? onCheckOut(a) : onMove(a, next[0]))} disabled={busy}>
          {next[0] === 'pay' ? <Wallet aria-hidden /> : next[0] === 'completed' ? <LogOut aria-hidden /> : <ArrowRight aria-hidden />} {next[1]}
        </button>
      )}
    </li>
  )
}

export default function ClinicBoard() {
  const { data, error, reload } = useApi('board')
  const [busy, setBusy] = useState(null)
  const [checkOut, setCheckOut] = useState(null)
  const toast = useToast()
  useAppointmentsChanged(reload)
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) reload() }, 60000) // taps on another PC and waiting times; not while hidden
    return () => clearInterval(t)
  }, [reload])

  async function move(a, to, extra = {}) {
    setBusy(a.id)
    try {
      await api(`appointments/${a.id}/status`, { method: 'POST', body: { to, ...extra } })
      toast(to === 'started' ? `${a.pet.name} is with you now` : to === 'completed' ? `${a.pet.name} checked out` : `${a.pet.name} sent to Dispense`)
      appointmentsChanged()
    } catch (err) {
      toast(err.message)
    } finally {
      setBusy(null)
    }
  }
  if (error) return <ErrorNote error={error} />
  const s = data?.stations
  const waiting = s?.waiting || []
  const openSteps = s ? Object.values(s).flat().reduce((n, a) => n + a.steps.length, 0) : 0
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>Clinic Board</h2>
          <p>{s ? `${waiting.length} waiting · ${s.with_vet.length} with a vet · ${s.dispense.length} at Dispense · ${s.done.length} done today${openSteps ? ` · ${openSteps} step${openSteps > 1 ? 's' : ''} to finish` : ''}` : '…'}</p>
        </div>
        <button type="button" className="btn" onClick={() => move(waiting[0], 'started', { assignMe: true })} disabled={!waiting.length || !!busy}
          title={waiting.length ? `Take ${waiting[0].pet.name} and start the consultation` : 'Nobody is waiting'}>
          <Megaphone aria-hidden /> {waiting.length ? `Call Next: ${waiting[0].pet.name}` : 'Call Next'}
        </button>
      </div>
      {!data && <PawLoader label="Loading the clinic board…" />}
      {data && <div className="board">
        {STATIONS.map((st) => {
          const list = s?.[st.key] || []
          return (
            <div key={st.key} className={`station station-${st.key}`}>
              <div className="station-head">
                <st.icon aria-hidden />
                <strong>{st.title}</strong>
                <span className="tab-count">{list.length}</span>
              </div>
              <p className="station-hint">{st.hint}</p>
              {list.length ? (
                <ol className="station-list">
                  {list.map((a, i) => <Card key={a.id} a={a} station={st.key} position={i + 1} onMove={move} onCheckOut={setCheckOut} busy={busy === a.id} />)}
                </ol>
              ) : <p className="station-empty">{data ? 'No one here.' : '…'}</p>}
            </div>
          )
        })}
      </div>}
      {checkOut && <PaymentPanel appointmentId={checkOut.id} onClose={() => setCheckOut(null)} onDone={(n, msg) => { setCheckOut(null); toast(msg); appointmentsChanged() }} />}
    </section>
  )
}
