import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { CalendarDays, CalendarPlus, LogIn, Nfc, Pencil, Trash2, TriangleAlert, User } from 'lucide-react'
import { Empty, ErrorNote, PageHead, PetAvatar, ReviewBadge, useToast, PawLoader } from '../components/ui.jsx'
import { PetPanel } from '../components/ClientForms.jsx'
import { RemovePetPanel } from '../components/RemovePanels.jsx'
import { canManage, useStaff } from '../lib/staff.js'
import { useApi } from '../lib/useApi.js'
import { age, prettyDay, SEX_LABEL, SPECIES_LABEL } from '../lib/format.js'
import { api } from '../lib/api.js'
import { BookPanel, StatusBadge, WalkInPanel } from '../components/AppointmentPanels.jsx'
import { AssignTagPanel, appointmentsChanged, useAppointmentsChanged } from '../components/TagCheckIn.jsx'
import { prettyTime } from '../lib/appointments.js'
import { MedicalHistory, VaccinationsCard } from '../components/MedicalRecords.jsx'

function PetAppointments({ pet, onBook }) {
  const { data, error, reload } = useApi(`appointments?petId=${pet.id}&size=10`)
  useAppointmentsChanged(reload)
  return (
    <section className="card">
      <div className="card-head">
        <div><h2>Appointments</h2><p>{data ? `${data.total} in all` : '…'}</p></div>
        {!pet.deceasedOn && <button type="button" className="btn btn-quiet" onClick={onBook}><CalendarPlus aria-hidden /> Book</button>}
      </div>
      {error ? <div className="card-pad"><ErrorNote error={error} /></div> : data && !data.total ? (
        <Empty icon={CalendarDays} title="No appointments yet" text={`Book ${pet.name}'s first visit, or check them in as a walk-in.`} />
      ) : (
        <ul className="appt-mini">
          {(data?.appointments || []).map((a) => (
            <li key={a.id}>
              <Link to={`/appointments/${a.id}`}>
                <span><strong>{prettyDay(a.day)}</strong> <span className="cell-sub">{prettyTime(a.time)}{a.items.length ? ` · ${a.items.join(', ')}` : ''}</span></span>
                <StatusBadge status={a.status} emergency={a.emergency} />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {data && data.total > 10 && <div className="card-pad" style={{ paddingTop: 0 }}><Link to={`/appointments?q=${encodeURIComponent(pet.name)}`}>See all {data.total}</Link></div>}
    </section>
  )
}

export default function PetPage() {
  const { id } = useParams()
  const { data, error, reload } = useApi(`pets/${id}`)
  const [editing, setEditing] = useState(false)
  const toast = useToast()
  const navigate = useNavigate()
  const staff = useStaff()
  const [removing, setRemoving] = useState(false)
  const [panel, setPanel] = useState(null)
  const records = useApi(`pets/${id}/records`)
  const p = data?.pet
  const crumbs = [
    { label: 'Client Portal' },
    { label: 'Masterlist', to: '/clients?tab=pets' },
    ...(p ? [{ label: p.owner.name, to: `/clients/${p.owner.id}` }] : []),
    { label: p?.name || '…' },
  ]

  async function retireTag() {
    if (!window.confirm(`Remove ${p.name}'s tag? It will stop checking them in.`)) return
    try {
      await api(`pets/${p.id}/tag`, { method: 'DELETE' })
      reload()
      toast('Tag removed')
    } catch (err) {
      toast(err.message)
    }
  }

  if (error) return <><PageHead crumbs={crumbs} title="Pet" /><ErrorNote error={error} /></>
  if (!p) return <><PageHead crumbs={crumbs} title=" " /><PawLoader label="Loading the pet…" /></>

  const facts = [
    ['Species', SPECIES_LABEL[p.species]],
    ['Breed', p.breed || '—', p.breedRaw ? `Old system: ${p.breedRaw}` : null],
    ['Sex', SEX_LABEL[p.sex]],
    ['Age', age(p.birthdate) || 'Unknown', p.birthdate ? `Born ${prettyDay(p.birthdate)}` : null],
    ['Colour and Markings', p.colorMarkings || '—'],
    ['Weight', p.weightKg ? `${p.weightKg} kg` : '—', p.weightOn ? `Weighed ${prettyDay(p.weightOn)}` : null],
    ['Microchip', p.microchip || '—'],
  ]

  return (
    <>
      <PageHead crumbs={crumbs} title={p.name} />

      {p.allergies && (
        <div className="alert" role="note" style={{ marginBottom: 16 }}>
          <TriangleAlert aria-hidden /> <span><strong>Allergies:</strong> {p.allergies}</span>
        </div>
      )}

      <div className="layout-2">
        <div className="stack">
          <section className="card">
            <div className="profile">
              <PetAvatar species={p.species} large />
              <div>
                <div className="profile-name">
                  <h2>{p.name}</h2>
                  {p.deceasedOn && <span className="badge badge-soft">Passed Away {prettyDay(p.deceasedOn)}</span>}
                  <ReviewBadge flags={p.reviewFlags} />
                </div>
                <div className="profile-meta">
                  <span><User aria-hidden /> <Link to={`/clients/${p.owner.id}`}>{p.owner.name}</Link></span>
                  <span>{p.owner.customerNo}</span>
                  {p.owner.mobileLocal && <span><a href={`tel:${p.owner.mobile}`}>{p.owner.mobileLocal}</a></span>}
                </div>
              </div>
              <div className="profile-actions">
                {!p.deceasedOn && <button type="button" className="btn btn-quiet" onClick={() => setPanel('walkin')}><LogIn aria-hidden /> Walk In</button>}
                <button type="button" className="btn btn-quiet" onClick={() => setEditing(true)}><Pencil aria-hidden /> Edit</button>
                {canManage(staff) && !p.deceasedOn && (
                  <button type="button" className="icon-btn" onClick={() => setRemoving(true)} aria-label={`Remove ${p.name}`} title="Remove or Mark as Passed Away">
                    <Trash2 />
                  </button>
                )}
              </div>
            </div>
            <div className="facts">
              {facts.map(([label, value, sub]) => (
                <div className="fact" key={label}>
                  <span className="label">{label}</span>
                  <span className="fact-value">{value}</span>
                  {sub && <span className="cell-sub">{sub}</span>}
                </div>
              ))}
            </div>
            {p.notes && <p style={{ margin: '0 22px 22px', whiteSpace: 'pre-line' }}><span className="label">Notes</span><br />{p.notes}</p>}
          </section>

          <PetAppointments pet={p} onBook={() => setPanel('book')} />

          <MedicalHistory pet={p} data={records.data} error={records.error} />
        </div>

        <div className="stack">
          <section className="card">
            <div className="card-head">
              <div><h2>NFC Tag</h2><p>Tap at the front desk to check in and out</p></div>
              {!p.deceasedOn && <button type="button" className="btn btn-quiet" onClick={() => setPanel('tag')}><Nfc aria-hidden /> {p.tag ? 'Replace' : 'Assign Tag'}</button>}
            </div>
            <div className="card-pad">
              {p.tag ? (
                <div className="stack" style={{ gap: 8 }}>
                  <p style={{ margin: 0 }}><span className="badge"><Nfc aria-hidden /> {p.tag.uid}</span> <span className="cell-sub">Assigned {prettyDay(p.tag.assigned_at.slice(0, 10))}</span></p>
                  <button type="button" className="text-btn" onClick={retireTag}>Remove Tag (Lost or Broken)</button>
                </div>
              ) : (
                <p className="muted" style={{ margin: 0 }}>No tag yet. Assign one so {p.name} can check in with a tap.</p>
              )}
            </div>
          </section>
          <VaccinationsCard data={records.data} />
        </div>
      </div>

      {removing && (
        <RemovePetPanel
          pet={p}
          onClose={() => setRemoving(false)}
          onDone={(reason) => {
            setRemoving(false)
            if (reason === 'passed_away') { reload(); toast(`${p.name} marked as passed away`) }
            else { toast(`${p.name} removed. Restore from Masterlist → Removed.`); navigate(`/clients/${p.owner.id}`) }
          }}
        />
      )}
      {panel === 'book' && <BookPanel pet={p} onClose={() => setPanel(null)} onDone={(a) => { setPanel(null); appointmentsChanged(); toast(`${p.name} booked for ${prettyDay(a.day)}, ${prettyTime(a.time)}`); navigate(`/appointments/${a.id}`) }} />}
      {panel === 'walkin' && <WalkInPanel pet={p} onClose={() => setPanel(null)} onDone={(a) => { setPanel(null); appointmentsChanged(); toast(`${p.name} checked in`); navigate(`/appointments/${a.id}`) }} />}
      {panel === 'tag' && <AssignTagPanel pet={p} onClose={() => setPanel(null)} onDone={() => { setPanel(null); reload(); toast(`Tag assigned to ${p.name}`) }} />}
      {editing && (
        <PetPanel pet={p} onClose={() => setEditing(false)} onDone={() => { setEditing(false); reload(); toast('Pet details saved') }} />
      )}
    </>
  )
}
