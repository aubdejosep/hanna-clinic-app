// Smart Prescription ▸ Add Medication and Edit Medication (the same panel, filled in): Basic Information
// (name, formatted description, picture), Dosages (amount, unit, type) and optional Medication Variations,
// each with its own dosages. Owners, admins and vets.
import { useEffect, useState } from 'react'
import { ImageUp, Plus, Trash2, X } from 'lucide-react'
import { ErrorNote, Field, Panel, PawLoader } from '../components/ui.jsx'
import RichText from '../components/RichText.jsx'
import { api, ApiError } from '../lib/api.js'
import { useApi } from '../lib/useApi.js'
import { useStaff } from '../lib/staff.js'
import { canEditMeds } from './MedicationsPage.jsx'

const UNITS = ['ml', 'mg', 'mcg', 'g', 'IU', 'tablet', 'capsule', 'drop', 'puff', 'sachet', 'application']
const TYPES = ['Per Kg', 'Per Animal']
const blankDose = () => ({ amount: '', unit: '', type: 'Per Kg' })

function Choice({ value, options, onChange, ...a }) { // keeps an imported value that isn't on the list
  const list = value && !options.includes(value) ? [value, ...options] : options
  return (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value)} {...a}>
      <option value="">Choose…</option>
      {list.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}

function Dosages({ list, setList, errors, prefix }) {
  const upd = (i, patch) => setList(list.map((d, j) => (j === i ? { ...d, ...patch } : d)))
  return (
    <div className="dose-rows">
      {list.map((d, i) => (
        <div className="dose-row" key={i}>
          <Field label="Dosage Amount" error={errors[`${prefix}.${i}.amount`]}>{(a) => <input {...a} value={d.amount} onChange={(e) => upd(i, { amount: e.target.value })} inputMode="decimal" placeholder="e.g. 0.6" maxLength={20} />}</Field>
          <Field label="Unit" error={errors[`${prefix}.${i}.unit`]}>{(a) => <Choice {...a} value={d.unit} options={UNITS} onChange={(v) => upd(i, { unit: v })} />}</Field>
          <Field label="Dosage Type" error={errors[`${prefix}.${i}.type`]}>{(a) => <Choice {...a} value={d.type} options={TYPES} onChange={(v) => upd(i, { type: v })} />}</Field>
          <button type="button" className="icon-btn" onClick={() => setList(list.filter((_, j) => j !== i))} aria-label={`Remove dosage ${i + 1}`} title="Remove Dosage"><Trash2 /></button>
        </div>
      ))}
    </div>
  )
}

// Add Medication / Edit Medication: a wide slide-out panel over the Medication List, like the other panels.
// id: the medication to edit, or null to add one. Closing with unsaved changes asks first (Panel).
export default function MedicationPanel({ id, onClose, onDone }) {
  const editing = !!id
  const staff = useStaff()
  const { data, error: loadError } = useApi(editing ? `medications/${id}` : null)
  const [form, setForm] = useState(editing ? null : { name: '', descriptionHtml: '', dosages: [blankDose()], variations: [] })
  const [picture, setPicture] = useState(undefined) // undefined: unchanged; null: remove; File: new
  const [preview, setPreview] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const errors = error instanceof ApiError ? error.body.errors || {} : {}
  useEffect(() => {
    const m = data?.medication
    if (m) setForm({ name: m.name, descriptionHtml: m.descriptionHtml, dosages: m.dosages.map(({ amount, unit, type }) => ({ amount, unit, type })), variations: m.variations.map((v) => ({ name: v.name, details: v.details || '', dosages: v.dosages.map(({ amount, unit, type }) => ({ amount, unit, type })) })) })
  }, [data])
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])
  const set = (patch) => { setForm((f) => ({ ...f, ...patch })); setDirty(true) }

  const m = data?.medication
  const currentImg = picture === undefined ? (m?.hasImage ? `/api/medications/${m.id}/image?v=${encodeURIComponent(m.imageVersion || '')}` : null) : preview
  function pickPicture(f) {
    if (!f) return
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) { setError(new ApiError(400, { error: 'Use a JPG, PNG or WebP picture.' })); return }
    if (f.size > 5 * 1024 * 1024) { setError(new ApiError(400, { error: 'This picture is over 5 MB. Use a smaller one.' })); return }
    setPicture(f); setPreview(URL.createObjectURL(f)); setDirty(true)
  }
  async function save() {
    setBusy(true)
    setError(null)
    try {
      const res = await api(editing ? `medications/${id}` : 'medications', { method: editing ? 'PATCH' : 'POST', body: form })
      const mid = res.medication.id
      if (picture instanceof File) {
        const r = await fetch(`/api/medications/${mid}/image`, { method: 'PUT', body: picture, headers: { 'Content-Type': picture.type }, credentials: 'same-origin' })
        if (!r.ok) throw new ApiError(r.status, (await r.json().catch(() => null)) || { error: 'The picture didn’t upload. Try again from Edit.' })
      } else if (picture === null) await api(`medications/${mid}/image`, { method: 'DELETE' })
      onDone(editing ? `${form.name} updated` : `${form.name} added`)
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }
  const title = editing ? (m ? `Edit ${m.name}` : 'Edit Medication') : 'Add Medication'
  return (
    <Panel wide title={title} intro={editing ? 'Update the medication’s details, dosages and variations.' : 'Add a medicine with its details, dosages and variations.'}
      onClose={onClose} busy={busy} dirty={dirty} discardTitle="Close without saving the medication?"
      footer={canEditMeds(staff) && form ? <>
        <button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="btn" onClick={save} disabled={busy}>{busy ? 'Saving…' : editing ? 'Update Medication' : 'Add Medication'}</button>
      </> : null}>
      {!canEditMeds(staff) ? <ErrorNote error={new Error('Only vets, owners and admins can add or change medications.')} />
        : loadError ? <ErrorNote error={loadError} />
          : !form ? <PawLoader label="Loading the medication…" /> : (
            <>
              <ErrorNote error={error && !Object.keys(errors).length ? error : null} />
              {Object.keys(errors).length > 0 && <ErrorNote error={new Error('Some details need fixing. They’re marked below.')} />}
              <section className="form-section">
                <h3 className="label">Basic Information</h3>
                <Field label="Medication Name" error={errors.name}>{(a) => <input {...a} value={form.name} onChange={(e) => set({ name: e.target.value })} maxLength={150} placeholder="e.g. Scourvet Oral Anti-diarrheal Suspension" />}</Field>
                <div className="field">
                  <span className="field-label" id="med-desc-label">Description</span>
                  <RichText id="med-desc" label="Description" value={form.descriptionHtml} onChange={(html) => set({ descriptionHtml: html })} />
                  <span className="field-hint">Usage instructions, contraindications and anything else the vets should know.</span>
                </div>
                <div className="field">
                  <span className="field-label">Medication Image <small>(optional)</small></span>
                  {currentImg ? (
                    <div className="med-picture">
                      <img src={currentImg} alt="Medication" />
                      <div className="inline-row">
                        <label className="btn btn-quiet"><ImageUp aria-hidden /> Change Picture<input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => { pickPicture(e.target.files?.[0]); e.target.value = '' }} /></label>
                        <button type="button" className="btn btn-quiet" onClick={() => { setPicture(null); setPreview(null); setDirty(true) }}><X aria-hidden /> Remove</button>
                      </div>
                    </div>
                  ) : (
                    <label className="drop-zone" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pickPicture(e.dataTransfer.files?.[0]) }}>
                      <ImageUp aria-hidden />
                      <span>Drag and drop a picture, or click to browse</span>
                      <span className="cell-sub">JPG, PNG or WebP up to 5 MB</span>
                      <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => { pickPicture(e.target.files?.[0]); e.target.value = '' }} />
                    </label>
                  )}
                </div>
              </section>

              <section className="form-section">
                <div className="form-section-head"><h3 className="label">Dosages</h3>
                  <button type="button" className="btn btn-quiet" onClick={() => set({ dosages: [...form.dosages, blankDose()] })}><Plus aria-hidden /> Add Dosage</button></div>
                {form.dosages.length ? <Dosages list={form.dosages} setList={(l) => set({ dosages: l })} errors={errors} prefix="dosages" /> : <p className="field-hint" style={{ margin: 0 }}>No general dosage. Use Add Dosage, or give each variation its own.</p>}
              </section>

              <section className="form-section">
                <div className="form-section-head"><h3 className="label">Medication Variations <small>(optional)</small></h3>
                  <button type="button" className="btn btn-quiet" onClick={() => set({ variations: [...form.variations, { name: '', details: '', dosages: [] }] })}><Plus aria-hidden /> Add Variation</button></div>
                {!form.variations.length ? <p className="field-hint" style={{ margin: 0 }}>No variations yet. Use Add Variation for other forms or strengths.</p> : form.variations.map((v, i) => {
                  const upd = (patch) => set({ variations: form.variations.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
                  return (
                    <div key={i} className="med-variation">
                      <div className="form-row">
                        <Field label="Variation Name" error={errors[`variations.${i}.name`]}>{(a) => <input {...a} value={v.name} onChange={(e) => upd({ name: e.target.value })} maxLength={120} placeholder="e.g. 250 mg tablet" />}</Field>
                        <Field label="Details" optional>{(a) => <input {...a} value={v.details} onChange={(e) => upd({ details: e.target.value })} maxLength={300} placeholder="e.g. for cats under 4 kg" />}</Field>
                        <button type="button" className="icon-btn" style={{ alignSelf: 'end' }} onClick={() => set({ variations: form.variations.filter((_, j) => j !== i) })} aria-label={`Remove variation ${i + 1}`} title="Remove Variation"><Trash2 /></button>
                      </div>
                      {v.dosages.length > 0 && <Dosages list={v.dosages} setList={(l) => upd({ dosages: l })} errors={errors} prefix={`variations.${i}.dosages`} />}
                      <button type="button" className="text-btn" style={{ justifySelf: 'start' }} onClick={() => upd({ dosages: [...v.dosages, blankDose()] })}><Plus size={14} aria-hidden /> Add Dosage for This Variation</button>
                    </div>
                  )
                })}
              </section>
            </>
          )}
    </Panel>
  )
}
