import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ChevronLeft, ChevronRight, ClipboardList, FileHeart, Image, LayoutGrid, List, NotebookPen, Package, Pill, Search, Stethoscope, Syringe, X } from 'lucide-react'
import { Empty, ErrorNote, Pager, Panel, PawLoader } from './ui.jsx'
import { useApi } from '../lib/useApi.js'
import { prettyDay } from '../lib/format.js'

export const ENTRY = {
  note: { label: 'Note', icon: NotebookPen },
  vaccination: { label: 'Vaccination', icon: Syringe },
  diagnosis: { label: 'Diagnosis', icon: Stethoscope },
  treatment_plan: { label: 'Treatment Plan', icon: ClipboardList },
  prescription: { label: 'Prescription', icon: Pill },
  services: { label: 'Services', icon: Package },
  other: { label: 'Entry', icon: FileHeart },
}
const BOOKING_STATUS = { completed: 'visit completed', unclosed: 'never closed in the old system', no_show: 'no show', cancelled: 'cancelled', accepted: 'booked', arrived: 'in clinic', started: 'in clinic' }
const itemText = (i) => `${i.name}${i.detail ? ` · ${i.detail}` : ''}${i.qty && i.qty !== 1 ? ` × ${i.qty}` : ''}`

export function EntryBadge({ type }) {
  const t = ENTRY[type] || ENTRY.other
  return <span className={`badge entry-badge entry-${type}`}><t.icon aria-hidden /> {t.label}</span>
}

const kb = (n) => (n ? `${Math.round(n / 1024).toLocaleString()} KB` : '')

// Photos on an entry: thumbnails like the old system; one opens full screen with arrows.
function Photos({ images }) {
  const [open, setOpen] = useState(null)
  return (
    <>
      <ul className="photo-grid">
        {images.map((im, i) => (
          <li key={im.id}>
            <button type="button" className="photo-thumb" onClick={() => setOpen(i)} aria-label={`Open image ${i + 1} of ${images.length}`}>
              <img src={`/api/photos/${im.id}`} alt="" loading="lazy" width={im.width || undefined} height={im.height || undefined} />
              <span className="photo-tag">Image {i + 1}{im.bytes ? <span className="cell-sub">{kb(im.bytes)}</span> : null}</span>
            </button>
          </li>
        ))}
      </ul>
      {open !== null && <Lightbox images={images} at={open} setAt={setOpen} />}
    </>
  )
}

function Lightbox({ images, at, setAt }) {
  const im = images[at]
  useEffect(() => {
    const onKey = (e) => {
      if (!['Escape', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return
      e.stopPropagation()
      e.preventDefault()
      if (e.key === 'Escape') setAt(null)
      if (e.key === 'ArrowLeft') setAt((n) => (n - 1 + images.length) % images.length)
      if (e.key === 'ArrowRight') setAt((n) => (n + 1) % images.length)
    }
    document.addEventListener('keydown', onKey, true) // before the panel's own Escape
    return () => document.removeEventListener('keydown', onKey, true)
  }, [images.length, setAt])
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={`Image ${at + 1} of ${images.length}`} onClick={() => setAt(null)}>
      <img src={`/api/photos/${im.id}`} alt={`Image ${at + 1} of ${images.length}`} onClick={(e) => e.stopPropagation()} />
      <div className="lightbox-bar" onClick={(e) => e.stopPropagation()}>
        {images.length > 1 && <button type="button" className="icon-btn" onClick={() => setAt((at - 1 + images.length) % images.length)} aria-label="Previous Image"><ChevronLeft /></button>}
        <span>Image {at + 1} of {images.length}</span>
        {images.length > 1 && <button type="button" className="icon-btn" onClick={() => setAt((at + 1) % images.length)} aria-label="Next Image"><ChevronRight /></button>}
        <a className="btn btn-quiet" href={`/api/photos/${im.id}`} target="_blank" rel="noreferrer">Open Full Size</a>
        <button type="button" className="icon-btn" onClick={() => setAt(null)} aria-label="Close Image"><X /></button>
      </div>
    </div>
  )
}

export function Entry({ e, as: Tag = 'li' }) {
  const d = e.details || {}
  const plan = [['Weight', d.weightKg != null && `${d.weightKg} kg`], ['Follow-Up', d.followUpDays && `In ${d.followUpDays} day${d.followUpDays === 1 ? '' : 's'}${d.followUpReason ? `: ${d.followUpReason}` : ''}`],
    ['Status', d.status && `${d.status[0].toUpperCase()}${d.status.slice(1)}${d.priority ? ` · ${d.priority} priority` : ''}`],
    ['Start', d.start && prettyDay(d.start)], ['Target End', d.targetEnd && prettyDay(d.targetEnd)],
    ['Objectives', d.objectives], ['Protocol', d.protocol], ['Veterinarian', d.vet]].filter(([, v]) => v)
  return (
    <Tag className="entry">
      <div className="entry-head">
        <EntryBadge type={d.booked ? 'services' : e.type} />
        {e.title && <strong>{e.title}</strong>}
      </div>
      {e.description && <p className="entry-text">{e.description}</p>}
      {plan.length > 0 && (
        <dl className="entry-plan">
          {plan.map(([k, v]) => <div key={k}><dt className="label">{k}</dt><dd>{v}</dd></div>)}
        </dl>
      )}
      {e.items.length > 0 && <div className="chips">{e.items.map((i, n) => <span key={n} className="chip" title={i.notes || undefined}>{itemText(i)}</span>)}</div>}
      {e.images?.length > 0 && <Photos images={e.images} />}
      {(e.by || e.auto) && e.at && (
        <p className="cell-sub entry-foot">{e.auto ? 'Added at check-out' : `By ${e.by}`} · {prettyDay(new Date(Date.parse(e.at) + 8 * 3600e3).toISOString().slice(0, 10))} {new Date(e.at).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' })}
          {e.edited && ` · edited by ${e.edited.by}`}</p>
      )}
      {(d.assigned || e.imageCount > (e.images?.length || 0)) && (
        <p className="cell-sub entry-foot">
          {d.assigned && <>Assigned: {d.assigned}</>}
          {d.assigned && e.imageCount > (e.images?.length || 0) && ' · '}
          {e.imageCount > (e.images?.length || 0) && <><Image size={13} aria-hidden /> {e.imageCount - (e.images?.length || 0)} image{e.imageCount - (e.images?.length || 0) > 1 ? 's' : ''} not uploaded yet</>}
        </p>
      )}
    </Tag>
  )
}

export function RecordCard({ r, showPetLink, current }) {
  return (
    <article className={`record ${current ? 'is-current' : ''}`} id={`record-${r.id}`}>
      <header className="record-head">
        <strong>{prettyDay(r.day)}</strong>{current && <span className="badge">This Visit</span>}
        <span className="cell-sub">
          {r.kind === 'visit' ? 'Visit' : 'Record'}
          {r.appointmentNo && <> · {r.appointmentId ? <Link to={`/appointments/${r.appointmentId}`}>#{r.appointmentNo}</Link> : `#${r.appointmentNo}`}</>}
          {r.source === 'legacy' && ' · from the old system'}
          {r.bookingOnly && ` · booked services only${r.appointmentStatus ? ` · ${BOOKING_STATUS[r.appointmentStatus] || r.appointmentStatus}` : ''}`}
          {r.source === 'legacy' && r.day > new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10) && ' · dated by a future booking (written early in the old system)'}
        </span>
        {showPetLink}
      </header>
      <ul className="entries">{r.entries.map((e) => <Entry key={e.id} e={e} />)}</ul>
    </article>
  )
}

const TABS = [['note', 'Notes', 'General observations'], ['diagnosis', 'Diagnosis', 'Medical findings'], ['vaccination', 'Vaccination', 'Immunization records'],
  ['treatment_plan', 'Treatment Plans', 'Treatment protocol'], ['prescription', 'Prescriptions', 'Medications prescribed']]
const SIZES = [6, 12, 24]

// What a card shows as its title: the first entry with a real title, else the services list.
const headline = (r) => r.entries.find((e) => e.title && !e.details?.booked) || r.entries[0]
// A services list is titled by what's on it, e.g. "PROHEART, VACCINE · FLUVACCINE".
const cardTitle = (h) => (h?.details?.booked && h.items.length ? h.items.slice(0, 2).map((i) => `${i.name}${i.detail ? ` · ${i.detail}` : ''}`).join(', ') + (h.items.length > 2 ? ` +${h.items.length - 2}` : '') : h?.title || 'Record')
const images = (r) => r.entries.reduce((n, e) => n + (e.imageCount || 0), 0)
const words = (r) => [r.appointmentNo, ...r.entries.flatMap((e) => [e.title, e.description, ...e.items.map((i) => `${i.name} ${i.detail || ''}`)])].join(' ').toLowerCase()

// One record, like the old system's Medical Record window: a tab per kind of entry with its count.
function RecordPanel({ r, onClose }) {
  const counts = {}
  for (const e of r.entries) counts[e.type] = (counts[e.type] || 0) + 1
  const [tab, setTab] = useState(() => (TABS.find(([k]) => counts[k]) || TABS[0])[0])
  const list = r.entries.filter((e) => e.type === tab)
  return (
    <Panel wide onClose={onClose} title="Medical Record"
      intro={<>{prettyDay(r.day)}{r.appointmentNo && <> · {r.appointmentId ? <Link to={`/appointments/${r.appointmentId}`} onClick={onClose}>#{r.appointmentNo}</Link> : `#${r.appointmentNo}`}</>}
        {r.source === 'legacy' && ' · from the old system'}{r.bookingOnly && ` · booked services only${r.appointmentStatus ? ` · ${BOOKING_STATUS[r.appointmentStatus] || r.appointmentStatus}` : ''}`}</>}>
      <div className="rec-tabs" role="tablist" aria-label="Kind of entry">
        {TABS.map(([k, label, hint]) => {
          const T = ENTRY[k]
          return (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className="rec-tab" onClick={() => setTab(k)} disabled={!counts[k]}>
              <span className="rec-tab-top"><T.icon aria-hidden /> <strong>{label}</strong> <span className="tab-count">{counts[k] || 0}</span></span>
              <span className="cell-sub">{hint}</span>
            </button>
          )
        })}
      </div>
      {list.length ? <ul className="entries rec-entries">{list.map((e) => <Entry key={e.id} e={e} />)}</ul> : <p className="muted" style={{ margin: 0 }}>Nothing of this kind in this record.</p>}
    </Panel>
  )
}

// The pet's whole history, newest first, as cards (or a table) with search and pages, like the old
// system. A card opens the record. On an appointment, the record from its day is marked This Visit.
export function MedicalHistory({ pet, data, error, currentDay, currentAppointmentId }) {
  const [find, setFind] = useState('')
  const [view, setView] = useState('cards')
  const [size, setSize] = useState(6)
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState(null)
  const { hash } = useLocation()
  const q = find.trim().toLowerCase()
  const all = data?.records || []
  const shown = useMemo(() => (q ? all.filter((r) => q.split(/\s+/).every((w) => words(r).includes(w))) : all), [all, q])
  const pages = Math.max(1, Math.ceil(shown.length / size))
  const at = Math.min(page, pages)
  const slice = shown.slice((at - 1) * size, at * size)
  useEffect(() => { // opened from the Records List: open that record
    const m = hash.match(/^#record-(\d+)$/)
    if (!m || !data) return
    const r = all.find((x) => String(x.id) === m[1])
    if (r) setOpen(r)
  }, [hash, data]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className="card">
      <div className="card-head">
        <div><h2>Medical History</h2><p>{data ? `${all.length} record${all.length === 1 ? '' : 's'} for ${pet.name} · notes, diagnoses, vaccinations and prescriptions` : '…'}</p></div>
      </div>
      {error ? <div className="card-pad"><ErrorNote error={error} /></div> : !data ? <PawLoader label="Loading the medical history…" /> : !all.length ? (
        <Empty icon={FileHeart} title="No medical records" text={`The old system had no records for ${pet.name}.`} />
      ) : (
        <>
          <div className="toolbar">
            <div className="search">
              <Search aria-hidden />
              <label className="sr-only" htmlFor={`mh-${pet.id}`}>Search Medical Records</label>
              <input id={`mh-${pet.id}`} type="search" value={find} onChange={(e) => { setFind(e.target.value); setPage(1) }} placeholder="Search medical records" autoComplete="off" />
            </div>
            <div className="tabs" role="group" aria-label="View">
              <button type="button" className="tab" aria-pressed={view === 'cards'} onClick={() => setView('cards')}><LayoutGrid size={14} aria-hidden /> Cards</button>
              <button type="button" className="tab" aria-pressed={view === 'table'} onClick={() => setView('table')}><List size={14} aria-hidden /> Table</button>
            </div>
          </div>
          {!shown.length ? <p className="card-pad muted" style={{ margin: 0 }}>No record matches “{find}”.</p> : view === 'cards' ? (
            <ul className="rec-cards">
              {slice.map((r) => {
                const h = headline(r)
                const img = images(r)
                const current = currentAppointmentId ? r.appointmentId === currentAppointmentId : currentDay && r.day === currentDay
                return (
                  <li key={r.id}>
                    <button type="button" className={`rec-card ${current ? 'is-current' : ''}`} onClick={() => setOpen(r)} id={`record-${r.id}`}>
                      <span className="rec-card-top">
                        <span className="badge badge-soft">{prettyDay(r.day)}</span>
                        {current && <span className="badge">This Visit</span>}
                        <EntryBadge type={h?.details?.booked ? 'services' : h?.type} />
                      </span>
                      <span className="chips">
                        <span className="chip"><FileHeart aria-hidden /> {r.entries.length} {r.entries.length === 1 ? 'Entry' : 'Entries'}</span>
                        {img > 0 && <span className="chip"><Image aria-hidden /> {img}</span>}
                      </span>
                      <strong className="rec-card-title">{cardTitle(h)}</strong>
                      <span className="cell-sub">{r.appointmentNo ? `#${r.appointmentNo}` : 'Record'}{r.bookingOnly ? ` · booked services only${r.appointmentStatus ? ` · ${BOOKING_STATUS[r.appointmentStatus] || r.appointmentStatus}` : ''}` : ''}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : (
            <table className="table">
              <thead><tr><th>Date</th><th>Title</th><th className="hide-sm">Kinds</th><th className="num">Entries</th></tr></thead>
              <tbody>
                {slice.map((r) => {
                  const h = headline(r)
                  return (
                    <tr key={r.id} onClick={() => setOpen(r)} className={(currentAppointmentId ? r.appointmentId === currentAppointmentId : currentDay && r.day === currentDay) ? 'is-current-row' : undefined}>
                      <td className="nowrap" data-label="Date">{prettyDay(r.day)}</td>
                      <td><strong>{cardTitle(h)}</strong>{r.bookingOnly && <span className="cell-sub">Booked services only</span>}</td>
                      <td className="hide-sm">{[...new Set(r.entries.map((e) => (e.details?.booked ? 'services' : e.type)))].map((t) => <EntryBadge key={t} type={t} />)}</td>
                      <td className="num" data-label="Entries">{r.entries.length}{images(r) ? ` · ${images(r)} img` : ''}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          <Pager page={at} pageSize={size} total={shown.length} onPage={setPage} noun="records"
            right={<label className="inline-row" style={{ gap: 8 }}>Rows per page
              <select className="select" value={size} onChange={(e) => { setSize(Number(e.target.value)); setPage(1) }}>{SIZES.map((n) => <option key={n} value={n}>{n}</option>)}</select>
            </label>} />
        </>
      )}
      {open && <RecordPanel r={open} onClose={() => setOpen(null)} />}
    </section>
  )
}

// Appointment page: the pet's whole history, with this visit's record marked.
export function AppointmentHistory({ pet, day }) {
  const { data, error } = useApi(`pets/${pet.id}/records`)
  return <MedicalHistory pet={pet} data={data} error={error} currentDay={day} />
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
