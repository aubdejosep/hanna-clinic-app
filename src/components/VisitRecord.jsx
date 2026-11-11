// The visit's medical record on the appointment page: what the vet writes (Note, Diagnosis,
// Prescription, Treatment Plan) and what's added by itself at check-out (services and products, vaccines).
// Below it, the pet's whole Medical History.
import { useMemo, useState } from 'react'
import { ClipboardList, NotebookPen, Pencil, Pill, Plus, Stethoscope, Trash2 } from 'lucide-react'
import { ErrorNote, Field, Panel, PawLoader } from './ui.jsx'
import { Entry, MedicalHistory } from './MedicalRecords.jsx'
import { api } from '../lib/api.js'
import { useApi } from '../lib/useApi.js'
import { useStaff } from '../lib/staff.js'

const WRITERS = ['vet', 'owner', 'admin']
const KINDS = {
  note: { label: 'Note', icon: NotebookPen, hint: 'General observations' },
  diagnosis: { label: 'Diagnosis', icon: Stethoscope, hint: 'Findings, e.g. PE, Dx and Rx' },
  prescription: { label: 'Prescription', icon: Pill, hint: 'Medicines to give or take home' },
  treatment_plan: { label: 'Treatment Plan', icon: ClipboardList, hint: 'A plan over days or weeks' },
}
const blankMed = () => ({ name: '', productId: null, dose: '', qty: '1', dispense: true })

function WritePanel({ a, kind, entry, onClose, onDone }) {
  const editing = !!entry
  const K = KINDS[kind]
  const products = useApi(kind === 'prescription' && !editing ? 'services/picker' : null).data?.products || []
  const byName = useMemo(() => Object.fromEntries(products.map((p) => [p.name.toLowerCase(), p])), [products])
  const d = entry?.details || {}
  const [v, setV] = useState({
    title: entry?.title || '', description: entry?.description || '',
    status: d.status || 'active', priority: d.priority || 'medium', start: d.start || a.day, targetEnd: d.targetEnd || '', objectives: d.objectives || '', protocol: d.protocol || '',
  })
  const [meds, setMeds] = useState([blankMed()])
  const [busy, setBusy] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [error, setError] = useState(null)
  const errors = error?.body?.errors || {}
  const set = (patch) => setV((x) => ({ ...x, ...patch }))
  const setMed = (i, patch) => setMeds((m) => m.map((x, k) => (k === i ? { ...x, ...patch } : x)))

  async function save() {
    setBusy(true)
    setError(null)
    const details = kind === 'treatment_plan' ? { status: v.status, priority: v.priority, start: v.start, targetEnd: v.targetEnd, objectives: v.objectives, protocol: v.protocol } : undefined
    try {
      if (editing) await api(`appointments/${a.id}/record/${entry.id}`, { method: 'PATCH', body: { title: v.title, description: v.description, ...(details ? { details } : {}) } })
      else {
        await api(`appointments/${a.id}/record`, { method: 'POST', body: {
          type: kind, title: v.title, description: v.description, details,
          medicines: kind === 'prescription' ? meds.filter((m) => m.name.trim()).map((m) => ({ productId: m.productId, name: m.name.trim(), dose: m.dose, qty: m.qty, dispense: m.dispense })) : undefined,
        } })
      }
      onDone(editing ? `${K.label} updated` : `${K.label} added to ${a.pet.name}'s record`)
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }
  async function remove() {
    setBusy(true)
    try {
      await api(`appointments/${a.id}/record/${entry.id}`, { method: 'DELETE' })
      onDone(`${K.label} removed`)
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }
  const given = meds.filter((m) => m.name.trim() && m.dispense && Number(m.qty) > 0)
  return (
    <Panel wide title={`${editing ? 'Edit' : 'Add'} ${K.label}`} intro={`${a.pet.name} · this visit's medical record`} onClose={onClose} busy={busy}
      footer={confirmRemove ? (
        <>
          <span className="field-hint" style={{ marginRight: 'auto' }}>Take this {K.label.toLowerCase()} off the record? It's kept in the activity log.</span>
          <button type="button" className="btn btn-quiet" onClick={() => setConfirmRemove(false)} disabled={busy}>Keep It</button>
          <button type="button" className="btn btn-dark" onClick={remove} disabled={busy}>Remove {K.label}</button>
        </>
      ) : (
        <>
          {editing && <button type="button" className="icon-btn" style={{ marginRight: 'auto' }} onClick={() => setConfirmRemove(true)} aria-label={`Remove ${K.label}`} title={`Remove ${K.label}`}><Trash2 /></button>}
          <button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn" onClick={save} disabled={busy}>{busy ? 'Saving…' : editing ? 'Save Changes' : `Add ${K.label}`}</button>
        </>
      )}>
      <ErrorNote error={error && !Object.keys(errors).length ? error : null} />
      <section className="form-section">
        <Field label="Title" optional={kind === 'prescription'} error={errors.title}>{(f) => <input {...f} value={v.title} onChange={(e) => set({ title: e.target.value })} maxLength={120}
          placeholder={{ note: 'e.g. Post-op check', diagnosis: 'e.g. Skin check: dermatitis', prescription: 'Prescription', treatment_plan: 'e.g. Pulse dosing, itraconazole' }[kind]} autoFocus />}</Field>
        {kind === 'treatment_plan' && (
          <>
            <div className="form-row">
              <Field label="Status">{(f) => <select {...f} value={v.status} onChange={(e) => set({ status: e.target.value })}>{['active', 'on hold', 'completed', 'cancelled'].map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}</select>}</Field>
              <Field label="Priority">{(f) => <select {...f} value={v.priority} onChange={(e) => set({ priority: e.target.value })}>{['low', 'medium', 'high'].map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}</select>}</Field>
            </div>
            <div className="form-row">
              <Field label="Start">{(f) => <input {...f} type="date" value={v.start} onChange={(e) => set({ start: e.target.value })} />}</Field>
              <Field label="Target End" optional>{(f) => <input {...f} type="date" value={v.targetEnd} onChange={(e) => set({ targetEnd: e.target.value })} />}</Field>
            </div>
            <Field label="Objectives" optional>{(f) => <textarea {...f} rows={3} value={v.objectives} onChange={(e) => set({ objectives: e.target.value })} />}</Field>
            <Field label="Protocol" optional>{(f) => <textarea {...f} rows={4} value={v.protocol} onChange={(e) => set({ protocol: e.target.value })} />}</Field>
          </>
        )}
        {kind === 'prescription' && !editing && (
          <div className="stack" style={{ gap: 10 }}>
            <span className="field-label">Medicines</span>
            <datalist id="rx-products">{products.map((p) => <option key={p.id} value={p.name} />)}</datalist>
            {meds.map((m, i) => (
              <div key={i} className="rx-row">
                <Field label="Medicine">{(f) => <input {...f} list="rx-products" value={m.name} autoComplete="off" placeholder="Search the medicines list, or type one"
                  onChange={(e) => { const p = byName[e.target.value.toLowerCase()]; setMed(i, { name: e.target.value, productId: p?.id || null }) }} />}</Field>
                <Field label="Dose or Instructions" optional>{(f) => <input {...f} value={m.dose} onChange={(e) => setMed(i, { dose: e.target.value })} maxLength={120} placeholder="e.g. ½ tab twice a day, 7 days" />}</Field>
                <Field label={`Quantity${m.productId && byName[m.name.toLowerCase()]?.unit ? ` (${byName[m.name.toLowerCase()].unit}s)` : ''}`}>{(f) => <input {...f} value={m.qty} onChange={(e) => setMed(i, { qty: e.target.value.replace(/[^\d.]/g, '') })} inputMode="decimal" style={{ width: 80 }} />}</Field>
                <label className="check rx-dispense"><input type="checkbox" checked={m.dispense} onChange={(e) => setMed(i, { dispense: e.target.checked })} /> <span>Given from clinic stock</span></label>
                {meds.length > 1 && <button type="button" className="icon-btn" onClick={() => setMeds(meds.filter((_, k) => k !== i))} aria-label="Remove Medicine"><Trash2 /></button>}
              </div>
            ))}
            {errors.medicines && <span className="field-error">{errors.medicines}</span>}
            <button type="button" className="btn btn-quiet" style={{ justifySelf: 'start' }} onClick={() => setMeds([...meds, blankMed()])}><Plus aria-hidden /> Add Medicine</button>
            {given.length > 0 && <p className="field-hint" style={{ margin: 0 }}>{given.length} medicine{given.length > 1 ? 's' : ''} will also be added to the visit, so they're on the bill and come off stock at check-out.</p>}
          </div>
        )}
        {kind === 'prescription' && editing && entry.items.length > 0 && (
          <p className="field-hint" style={{ margin: 0 }}>Medicines: {entry.items.map((i) => `${i.name}${i.detail ? ` · ${i.detail}` : ''}`).join(', ')}. To change them, remove this prescription and add a new one (and update Services &amp; Products if something wasn't given).</p>
        )}
        <Field label={kind === 'prescription' ? 'Notes' : kind === 'treatment_plan' ? 'Notes' : 'Description'} optional={kind !== 'note' && kind !== 'diagnosis'} error={errors.description}>
          {(f) => <textarea {...f} rows={kind === 'diagnosis' || kind === 'note' ? 8 : 4} value={v.description} onChange={(e) => set({ description: e.target.value })}
            placeholder={kind === 'diagnosis' ? 'PE: …\nDx: …\nRx: …\nFF UP: …' : undefined} />}
        </Field>
      </section>
    </Panel>
  )
}

function VisitRecordCard({ a, record, canWrite, onWrite }) {
  const entries = record?.entries || []
  const written = entries.filter((e) => !e.auto)
  const auto = entries.filter((e) => e.auto)
  const open = !['cancelled', 'no_show', 'accepted', 'pending'].includes(a.status)
  return (
    <section className="card">
      <div className="card-head">
        <div><h2>Medical Record</h2><p>{entries.length ? `This visit · ${written.length} written${auto.length ? `, ${auto.length} added at check-out` : ''}` : open ? 'Nothing written for this visit yet' : 'Written once the pet is checked in'}</p></div>
      </div>
      {canWrite && open && (
        <div className="card-pad write-buttons">
          {Object.entries(KINDS).map(([k, K]) => (
            <button key={k} type="button" className="write-btn" onClick={() => onWrite(k, null)}>
              <K.icon aria-hidden /><span><strong>Add {K.label}</strong><span className="cell-sub">{K.hint}</span></span>
            </button>
          ))}
        </div>
      )}
      {entries.length > 0 && (
        <div className="card-pad" style={{ paddingTop: canWrite && open ? 0 : undefined }}><ul className="entries rec-entries">
          {[...written, ...auto].map((e) => (
            <li key={e.id} className="visit-entry">
              <Entry e={e} as="div" />
              {canWrite && !e.auto && <button type="button" className="icon-btn visit-entry-edit" onClick={() => onWrite(e.type, e)} aria-label={`Edit ${e.title || 'entry'}`} title="Edit"><Pencil /></button>}
            </li>
          ))}
        </ul></div>
      )}
      {!entries.length && !(canWrite && open) && <p className="card-pad muted" style={{ margin: 0 }}>{a.status === 'completed' ? 'Nothing was recorded for this visit.' : 'The visit record starts when the pet is checked in.'}</p>}
    </section>
  )
}

// Appointment page: this visit's record, then the pet's whole history (one load for both).
export function VisitMedical({ a, onVisitChanged, toast }) {
  const staff = useStaff()
  const { data, error, reload } = useApi(`pets/${a.pet.id}/records`)
  const [writing, setWriting] = useState(null) // {kind, entry}
  const record = (data?.records || []).find((r) => r.appointmentId === a.id && r.source === 'staff')
  const canWrite = WRITERS.includes(staff?.role)
  return (
    <>
      {!data && !error ? <section className="card"><PawLoader small label="Loading the medical record…" /></section>
        : <VisitRecordCard a={a} record={record} canWrite={canWrite} onWrite={(kind, entry) => setWriting({ kind, entry })} />}
      <MedicalHistory pet={a.pet} data={data} error={error} currentDay={a.day} currentAppointmentId={a.id} />
      {writing && <WritePanel a={a} kind={writing.kind} entry={writing.entry} onClose={() => setWriting(null)}
        onDone={(msg) => { setWriting(null); reload(); onVisitChanged(); toast(msg) }} />}
    </>
  )
}
