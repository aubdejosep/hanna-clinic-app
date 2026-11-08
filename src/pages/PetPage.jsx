import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { FileHeart, Nfc, Pencil, Syringe, TriangleAlert, User } from 'lucide-react'
import { Empty, ErrorNote, PageHead, PetAvatar, ReviewBadge, useToast } from '../components/ui.jsx'
import { PetPanel } from '../components/ClientForms.jsx'
import { useApi } from '../lib/useApi.js'
import { age, prettyDay, SEX_LABEL, SPECIES_LABEL } from '../lib/format.js'

export default function PetPage() {
  const { id } = useParams()
  const { data, error, reload } = useApi(`pets/${id}`)
  const [editing, setEditing] = useState(false)
  const toast = useToast()
  const p = data?.pet
  const crumbs = [
    { label: 'Clients & pets', to: '/clients?tab=pets' },
    ...(p ? [{ label: p.owner.name, to: `/clients/${p.owner.id}` }] : []),
    { label: p?.name || '…' },
  ]

  if (error) return <><PageHead crumbs={crumbs} title="Pet" /><ErrorNote error={error} /></>
  if (!p) return <PageHead crumbs={crumbs} title=" " />

  const facts = [
    ['Species', SPECIES_LABEL[p.species]],
    ['Breed', p.breed || '—', p.breedRaw ? `Old system: ${p.breedRaw}` : null],
    ['Sex', SEX_LABEL[p.sex]],
    ['Age', age(p.birthdate) || 'Unknown', p.birthdate ? `Born ${prettyDay(p.birthdate)}` : null],
    ['Colour and markings', p.colorMarkings || '—'],
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
                  <ReviewBadge flags={p.reviewFlags} />
                </div>
                <div className="profile-meta">
                  <span><User aria-hidden /> <Link to={`/clients/${p.owner.id}`}>{p.owner.name}</Link></span>
                  <span>{p.owner.customerNo}</span>
                  {p.owner.mobileLocal && <span><a href={`tel:${p.owner.mobile}`}>{p.owner.mobileLocal}</a></span>}
                </div>
              </div>
              <div className="profile-actions">
                <button type="button" className="btn btn-quiet" onClick={() => setEditing(true)}><Pencil aria-hidden /> Edit</button>
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

          <section className="card placeholder">
            <div className="card-head"><div><h2>Medical <em>history</em></h2><p>Notes, diagnoses, treatment plans and prescriptions</p></div></div>
            <Empty icon={FileHeart} title="Arrives in phase 3" text="Records from the old system will be matched to this pet once the scraped export is in." />
          </section>
        </div>

        <div className="stack">
          <section className="card">
            <div className="card-head"><div><h2>NFC <em>tag</em></h2><p>Tap at the front desk to check in</p></div></div>
            <div className="card-pad">
              {p.tag ? (
                <p style={{ margin: 0 }}><span className="badge"><Nfc aria-hidden /> {p.tag.uid}</span> <span className="cell-sub">Assigned {prettyDay(p.tag.assigned_at.slice(0, 10))}</span></p>
              ) : (
                <p className="muted" style={{ margin: 0 }}>No tag yet. Assigning a tag arrives with check-in in phase 2.</p>
              )}
            </div>
          </section>
          <section className="card placeholder">
            <div className="card-head"><div><h2><em>Vaccinations</em></h2></div></div>
            <Empty icon={Syringe} title="Arrives in phase 3" text="The vaccination card, with due dates for the next shots." />
          </section>
        </div>
      </div>

      {editing && (
        <PetPanel pet={p} onClose={() => setEditing(false)} onDone={() => { setEditing(false); reload(); toast('Pet details saved') }} />
      )}
    </>
  )
}
