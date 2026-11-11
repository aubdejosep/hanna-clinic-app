import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { CalendarDays, ChevronRight, Crown, Hash, Mail, Pencil, Phone, Plus, Trash2, TriangleAlert } from 'lucide-react'
import { Empty, ErrorNote, PageHead, PetAvatar, useToast, PawLoader } from '../components/ui.jsx'
import { EditOwnerPanel, PetPanel } from '../components/ClientForms.jsx'
import { RemoveOwnerPanel } from '../components/RemovePanels.jsx'
import { canManage, useStaff } from '../lib/staff.js'
import { api } from '../lib/api.js'
import { useApi } from '../lib/useApi.js'
import { REVIEW_LABELS } from '../lib/labels.js'
import { age, initials, prettyDay, SPECIES_LABEL } from '../lib/format.js'
import { StatusBadge } from '../components/AppointmentPanels.jsx'
import { prettyTime } from '../lib/appointments.js'

function OwnerVisits({ ownerId }) {
  const { data, error } = useApi(`appointments?ownerId=${ownerId}&size=10`)
  return (
    <section className="card">
      <div className="card-head"><div><h2>Visit History</h2><p>{data ? `${data.total} appointment${data.total === 1 ? '' : 's'} for this owner's pets` : '…'}</p></div></div>
      {error ? <div className="card-pad"><ErrorNote error={error} /></div> : data && !data.total ? (
        <Empty icon={CalendarDays} title="No appointments yet" text="Book a visit from one of the pets' pages." />
      ) : (
        <ul className="appt-mini">
          {(data?.appointments || []).map((a) => (
            <li key={a.id}>
              <Link to={`/appointments/${a.id}`}>
                <span><strong>{a.pet.name}</strong> <span className="cell-sub">{prettyDay(a.day)} · {prettyTime(a.time)}{a.items.length ? ` · ${a.items[0]}` : ''}</span></span>
                <StatusBadge status={a.status} emergency={a.emergency} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default function OwnerPage() {
  const { id } = useParams()
  const { data, error, setData, reload } = useApi(`owners/${id}`)
  const [panel, setPanel] = useState(null)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const navigate = useNavigate()
  const staff = useStaff()
  const o = data?.owner
  const crumbs = [{ label: 'Client Portal' }, { label: 'Masterlist', to: '/clients' }, { label: o?.name || '…' }]

  if (error) return <><PageHead crumbs={crumbs} title="Owner" /><ErrorNote error={error} /></>
  if (!o) return <><PageHead crumbs={crumbs} title=" " /><PawLoader label="Loading the owner…" /></>

  async function markChecked() {
    setBusy(true)
    try {
      const res = await api(`owners/${o.id}`, { method: 'PATCH', body: { reviewFlags: [] } })
      setData(res)
      toast('Marked as checked')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHead crumbs={crumbs} title={o.name} />

      {o.reviewFlags.length > 0 && (
        <div className="alert" role="note" style={{ marginBottom: 16 }}>
          <TriangleAlert aria-hidden />
          <div style={{ flex: 1 }}>
            <strong>Please Check:</strong> {o.reviewFlags.map((f) => REVIEW_LABELS[f] || f).join(' · ')}.
            {o.reviewFlags.includes('shared_phone') && ' If it\'s a family member, that\'s fine. If it\'s the same person registered twice, tell the clinic owner so the records can be merged.'}
          </div>
          <button type="button" className="btn btn-quiet" onClick={markChecked} disabled={busy}>Mark as Checked</button>
        </div>
      )}

      <div className="layout-2">
        <div className="stack">
          <section className="card">
            <div className="profile">
              <span className="avatar avatar-lg" aria-hidden>{initials(o.name)}</span>
              <div>
                <div className="profile-name">
                  <h2>{o.name}</h2>
                  {o.vip && <span className="badge badge-warm"><Crown aria-hidden /> VIP</span>}
                </div>
                <div className="profile-meta">
                  <span><Hash aria-hidden /> {o.customerNo}</span>
                  <span><Phone aria-hidden /> {o.mobileLocal ? <a href={`tel:${o.mobile}`}>{o.mobileLocal}</a> : (o.mobileRaw || 'No mobile')}</span>
                  {o.email && <span><Mail aria-hidden /> <a href={`mailto:${o.email}`}>{o.email}</a></span>}
                  <span><CalendarDays aria-hidden /> Client since {prettyDay(o.since)}</span>
                </div>
              </div>
              <div className="profile-actions">
                <button type="button" className="btn btn-quiet" onClick={() => setPanel({ kind: 'owner' })}><Pencil aria-hidden /> Edit</button>
                {canManage(staff) && (
                  <button type="button" className="icon-btn" onClick={() => setPanel({ kind: 'remove' })} aria-label={`Remove ${o.name}`} title="Remove Owner">
                    <Trash2 />
                  </button>
                )}
              </div>
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <div><h2>Pets</h2><p>{o.pets.length} on file</p></div>
              <button type="button" className="btn" onClick={() => setPanel({ kind: 'pet' })}><Plus aria-hidden /> Add Pet</button>
            </div>
            {o.pets.length ? (
              <ul className="pet-list">
                {o.pets.map((p) => (
                  <li key={p.id}>
                    <Link to={`/pets/${p.id}`}>
                      <PetAvatar species={p.species} />
                      <span>
                        <strong>{p.name}</strong>
                        <span className="cell-sub">
                          {[SPECIES_LABEL[p.species], p.breed, age(p.birthdate)].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      {p.deceasedOn && <span className="badge badge-soft">Passed Away</span>}
                      {p.allergies && !p.deceasedOn && <span className="badge badge-warm">Allergies</span>}
                      <ChevronRight className="chev" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty title="No Pets Yet" text="Add this owner's first pet." />
            )}
          </section>

          <OwnerVisits ownerId={id} />
        </div>

        <section className="card">
          <div className="card-head"><div><h2>Details</h2></div></div>
          <div className="facts" style={{ paddingTop: 16, gridTemplateColumns: '1fr' }}>
            <div className="fact"><span className="label">Additional Owner</span><span className="fact-value">{o.additionalOwner || '—'}</span></div>
            <div className="fact"><span className="label">Messenger</span><span className="fact-value">{o.messenger || '—'}</span></div>
            <div className="fact"><span className="label">Address</span><span className="fact-value">{o.address || '—'}</span></div>
            <div className="fact"><span className="label">Reminders</span><span className="fact-value">{o.remindersOptIn ? (o.mobile ? 'On (SMS)' : 'On, but no mobile on file') : 'Off'}</span></div>
            <div className="fact"><span className="label">Notes</span><span className="fact-value" style={{ whiteSpace: 'pre-line' }}>{o.notes || '—'}</span></div>
          </div>
        </section>
      </div>

      {panel?.kind === 'remove' && (
        <RemoveOwnerPanel owner={o} onClose={() => setPanel(null)} onDone={() => { toast(`${o.name} removed. Restore from Masterlist → Removed.`); navigate('/clients') }} />
      )}
      {panel?.kind === 'owner' && (
        <EditOwnerPanel owner={o} onClose={() => setPanel(null)} onDone={(owner) => { setData({ owner }); setPanel(null); toast('Owner details saved') }} />
      )}
      {panel?.kind === 'pet' && (
        <PetPanel ownerId={o.id} onClose={() => setPanel(null)} onDone={(pet) => { setPanel(null); reload(); toast(`${pet.name} added`) }} />
      )}
    </>
  )
}
