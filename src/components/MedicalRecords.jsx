import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ClipboardList, FileHeart, Image, NotebookPen, Pill, Stethoscope, Syringe } from 'lucide-react'
import { Empty, ErrorNote } from './ui.jsx'
import { useApi } from '../lib/useApi.js'
import { prettyDay } from '../lib/format.js'

export const ENTRY = {
  note: { label: 'Note', icon: NotebookPen },
  vaccination: { label: 'Vaccination', icon: Syringe },
  diagnosis: { label: 'Diagnosis', icon: Stethoscope },
  treatment_plan: { label: 'Treatment Plan', icon: ClipboardList },
  prescription: { label: 'Prescription', icon: Pill },
  other: { label: 'Entry', icon: FileHeart },
}
const itemText = (i) => `${i.name}${i.detail ? ` · ${i.detail}` : ''}${i.qty && i.qty !== 1 ? ` × ${i.qty}` : ''}`

export function EntryBadge({ type }) {
  const t = ENTRY[type] || ENTRY.other
  return <span className={`badge entry-badge entry-${type}`}><t.icon aria-hidden /> {t.label}</span>
}

function Entry({ e }) {
  const d = e.details || {}
  const plan = [['Status', d.status && `${d.status[0].toUpperCase()}${d.status.slice(1)}${d.priority ? ` · ${d.priority} priority` : ''}`],
    ['Start', d.start && prettyDay(d.start)], ['Target End', d.targetEnd && prettyDay(d.targetEnd)],
    ['Objectives', d.objectives], ['Protocol', d.protocol], ['Veterinarian', d.vet]].filter(([, v]) => v)
  return (
    <li className="entry">
      <div className="entry-head">
        <EntryBadge type={e.type} />
        {e.title && <strong>{e.title}</strong>}
      </div>
      {e.description && <p className="entry-text">{e.description}</p>}
      {plan.length > 0 && (
        <dl className="entry-plan">
          {plan.map(([k, v]) => <div key={k}><dt className="label">{k}</dt><dd>{v}</dd></div>)}
        </dl>
      )}
      {e.items.length > 0 && <div className="chips">{e.items.map((i, n) => <span key={n} className="chip" title={i.notes || undefined}>{itemText(i)}</span>)}</div>}
      {(d.assigned || e.imageCount > 0) && (
        <p className="cell-sub entry-foot">
          {d.assigned && <>Assigned: {d.assigned}</>}
          {d.assigned && e.imageCount > 0 && ' · '}
          {e.imageCount > 0 && <><Image size={13} aria-hidden /> {e.imageCount} image{e.imageCount > 1 ? 's' : ''} (arriving with the photo upload)</>}
        </p>
      )}
    </li>
  )
}

export function RecordCard({ r, showPetLink }) {
  return (
    <article className="record" id={`record-${r.id}`}>
      <header className="record-head">
        <strong>{prettyDay(r.day)}</strong>
        <span className="cell-sub">
          {r.kind === 'visit' ? 'Visit' : 'Record'}
          {r.appointmentNo && <> · {r.appointmentId ? <Link to={`/appointments/${r.appointmentId}`}>#{r.appointmentNo}</Link> : `#${r.appointmentNo}`}</>}
          {r.source === 'legacy' && ' · from the old system'}
          {r.source === 'legacy' && r.day > new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10) && ' · dated by a future booking (written early in the old system)'}
        </span>
        {showPetLink}
      </header>
      <ul className="entries">{r.entries.map((e) => <Entry key={e.id} e={e} />)}</ul>
    </article>
  )
}

const FILTERS = [['', 'All'], ['vaccination', 'Vaccinations'], ['diagnosis', 'Diagnoses'], ['note', 'Notes'], ['treatment_plan', 'Treatment Plans']]

// Pet page: the whole history, newest first, with a filter by entry type.
export function MedicalHistory({ pet, data, error }) {
  const [filter, setFilter] = useState('')
  const [shown, setShown] = useState(8)
  const { hash } = useLocation()
  const records = useMemo(() => (data?.records || [])
    .map((r) => (filter ? { ...r, entries: r.entries.filter((e) => e.type === filter) } : r))
    .filter((r) => r.entries.length), [data, filter])
  const counts = useMemo(() => {
    const c = {}
    for (const r of data?.records || []) for (const e of r.entries) c[e.type] = (c[e.type] || 0) + 1
    return c
  }, [data])
  useEffect(() => { // opened from the Records List: show and scroll to that record
    const m = hash.match(/^#record-(\d+)$/)
    if (!m || !data) return
    const i = (data.records || []).findIndex((r) => String(r.id) === m[1])
    if (i >= 0) {
      setFilter('')
      setShown((s) => Math.max(s, i + 1))
      setTimeout(() => document.getElementById(`record-${m[1]}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100)
    }
  }, [hash, data])
  return (
    <section className="card">
      <div className="card-head">
        <div><h2>Medical History</h2><p>{data ? `${data.records.length} record${data.records.length === 1 ? '' : 's'} · notes, diagnoses, vaccinations and treatment plans` : '…'}</p></div>
      </div>
      {error ? <div className="card-pad"><ErrorNote error={error} /></div> : data && !data.records.length ? (
        <Empty icon={FileHeart} title="No medical records" text={`The old system had no records for ${pet.name}.`} />
      ) : (
        <>
          <div className="toolbar tab-scroll">
            <div className="tabs" role="group" aria-label="Show">
              {FILTERS.filter(([k]) => !k || counts[k]).map(([k, l]) => (
                <button key={l} type="button" className="tab" aria-pressed={filter === k} onClick={() => { setFilter(k); setShown(8) }}>
                  {l}{k && <span className="tab-count">{counts[k]}</span>}
                </button>
              ))}
            </div>
          </div>
          <div className="records">
            {records.slice(0, shown).map((r) => <RecordCard key={r.id} r={r} />)}
          </div>
          {records.length > shown && (
            <div className="card-pad" style={{ paddingTop: 0 }}>
              <button type="button" className="btn btn-quiet" onClick={() => setShown(shown + 20)}>Show More ({records.length - shown} older)</button>
            </div>
          )}
        </>
      )}
    </section>
  )
}

export function VaccinationsCard({ data }) {
  const [all, setAll] = useState(false)
  const list = data?.vaccinations || []
  return (
    <section className="card">
      <div className="card-head"><div><h2>Vaccinations</h2><p>{data ? `${list.length} on record` : '…'}</p></div></div>
      {data && !list.length ? <p className="card-pad muted" style={{ margin: 0 }}>No vaccinations on record.</p> : (
        <ul className="vacc-list">
          {list.slice(0, all ? list.length : 6).map((v) => (
            <li key={v.id}>
              <span className="vacc-day">{prettyDay(v.day)}</span>
              <span>
                <strong>{v.title || 'Vaccination'}</strong>
                {v.items.length > 0 && <span className="cell-sub">{v.items.map(itemText).join(', ')}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {list.length > 6 && <div className="card-pad" style={{ paddingTop: 0 }}><button type="button" className="text-btn" onClick={() => setAll(!all)}>{all ? 'Show Fewer' : `Show All ${list.length}`}</button></div>}
    </section>
  )
}

// Appointment page: the medical record written for this pet on the appointment's day.
export function VisitRecord({ petId, day, showEmpty }) {
  const { data, error } = useApi(`pets/${petId}/records?day=${day}`)
  if (error) return <ErrorNote error={error} />
  if (!data || (!data.records.length && !showEmpty)) return null
  return (
    <section className="card">
      <div className="card-head"><div><h2>Medical Record</h2><p>{data.records.length ? 'Written for this pet on this day' : 'Nothing written for this pet on this day'}</p></div>
        <Link className="btn btn-quiet" to={`/pets/${petId}`}>Full History</Link></div>
      {data.records.length > 0 && <div className="records">{data.records.map((r) => <RecordCard key={r.id} r={r} />)}</div>}
    </section>
  )
}
