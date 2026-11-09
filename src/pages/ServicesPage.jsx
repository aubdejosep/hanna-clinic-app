// Clinic operations → Services: the price list, as on the old Services page.
import { useState } from 'react'
import { Plus, Search, Stethoscope, Trash2 } from 'lucide-react'
import { Empty, ErrorNote, Field, PageHead, Panel, useToast } from '../components/ui.jsx'
import { api, ApiError, query } from '../lib/api.js'
import { useApi, useDebounced } from '../lib/useApi.js'
import { canManage, useStaff } from '../lib/staff.js'

export const peso = (n) => `₱${Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function priceLabel(s) {
  return s.variationCount > 0 ? `from ${peso(s.price)}` : peso(s.price)
}

function ServicePanel({ service, categories, onClose, onDone }) {
  const editing = !!service
  const [v, setV] = useState({
    name: service?.name || '', description: service?.description || '', price: service ? String(service.price) : '',
    category: service?.category || '', active: service ? service.active : true, featuredOnline: service?.featuredOnline || false,
    variations: (service?.variations || []).map((x) => ({ ...x, price: String(x.price) })),
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const set = (patch) => setV((x) => ({ ...x, ...patch }))
  const errors = error instanceof ApiError ? error.body.errors || {} : {}

  async function save() {
    setBusy(true)
    setError(null)
    try {
      if (editing) await api(`services/${service.id}`, { method: 'PATCH', body: v })
      else await api('services', { method: 'POST', body: v })
      onDone(editing ? `${v.name} updated` : `${v.name} added`)
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }
  async function remove() {
    setBusy(true)
    try {
      await api(`services/${service.id}`, { method: 'DELETE' })
      onDone(`${service.name} removed`)
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }

  return (
    <Panel
      title={editing ? `Edit ${service.name}` : 'Add service'}
      intro={editing ? 'Update the details of this service.' : 'Services can be added to appointments and billed.'}
      onClose={onClose}
      busy={busy}
      footer={confirmRemove ? (
        <>
          <span className="field-hint" style={{ marginRight: 'auto' }}>Remove {service.name}? Past appointments keep its name.</span>
          <button type="button" className="btn btn-quiet" onClick={() => setConfirmRemove(false)} disabled={busy}>Keep it</button>
          <button type="button" className="btn" onClick={remove} disabled={busy}>Remove service</button>
        </>
      ) : (
        <>
          {editing && <button type="button" className="icon-btn" style={{ marginRight: 'auto' }} onClick={() => setConfirmRemove(true)} aria-label="Remove service" title="Remove service"><Trash2 /></button>}
          <button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn" onClick={save} disabled={busy}>{busy ? 'Saving…' : editing ? 'Update service' : 'Add service'}</button>
        </>
      )}
    >
      <ErrorNote error={error && !Object.keys(errors).length ? error : null} />
      <datalist id="service-categories">{categories.map((c) => <option key={c.id} value={c.name} />)}</datalist>
      <section className="form-section">
        <Field label="Service name" error={errors.name}>{(a) => <input {...a} value={v.name} onChange={(e) => set({ name: e.target.value })} maxLength={60} />}</Field>
        <Field label="Description" optional>{(a) => <textarea {...a} value={v.description} onChange={(e) => set({ description: e.target.value })} rows={2} maxLength={300} />}</Field>
        <div className="form-row">
          <Field label="Base price (₱)" hint={v.variations.length ? 'With variations, each variation has its own price.' : null} error={errors.price}>
            {(a) => <input {...a} value={v.price} onChange={(e) => set({ price: e.target.value })} inputMode="decimal" placeholder="e.g. 2500" />}
          </Field>
          <Field label="Category" hint="Pick one, or type a new category." error={errors.category}>
            {(a) => <input {...a} value={v.category} onChange={(e) => set({ category: e.target.value })} list="service-categories" maxLength={50} autoComplete="off" />}
          </Field>
        </div>
        <label className="check">
          <input type="checkbox" checked={v.active} onChange={(e) => set({ active: e.target.checked })} />
          <span><strong>Service active</strong><br />Available for appointments and billing.</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={v.featuredOnline} onChange={(e) => set({ featuredOnline: e.target.checked })} />
          <span><strong>Featured for online booking</strong><br />Show this service on the website booking form while it’s active.</span>
        </label>
      </section>

      <section className="form-section">
        <div className="form-section-head"><h3 className="label">Variations <small>(optional)</small></h3></div>
        <p className="field-hint" style={{ margin: 0 }}>For prices that depend on size or type, e.g. “1–3 kg” and “3–5 kg”.</p>
        {v.variations.map((x, i) => (
          <div className="variation-row" key={x.id || `new-${i}`}>
            <Field label="Name" error={errors[`variations.${i}.name`]}>
              {(a) => <input {...a} value={x.name} onChange={(e) => set({ variations: v.variations.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)) })} maxLength={60} />}
            </Field>
            <Field label="Price (₱)" error={errors[`variations.${i}.price`]}>
              {(a) => <input {...a} value={x.price} onChange={(e) => set({ variations: v.variations.map((y, j) => (j === i ? { ...y, price: e.target.value } : y)) })} inputMode="decimal" />}
            </Field>
            <button type="button" className="icon-btn" onClick={() => set({ variations: v.variations.filter((_, j) => j !== i) })} aria-label={`Remove variation ${x.name || i + 1}`} title="Remove variation"><Trash2 /></button>
          </div>
        ))}
        <button type="button" className="btn btn-quiet" style={{ justifySelf: 'start' }} onClick={() => set({ variations: [...v.variations, { name: '', price: v.price }] })}><Plus aria-hidden /> New variation</button>
      </section>
    </Panel>
  )
}

export default function ServicesPage() {
  const me = useStaff()
  const toast = useToast()
  const [text, setText] = useState('')
  const q = useDebounced(text.trim())
  const [category, setCategory] = useState('')
  const [status, setStatus] = useState('all')
  const { data, error, loading, reload } = useApi(`services${query({ q, category, status })}`)
  const [panel, setPanel] = useState(null)
  const canEdit = canManage(me)

  async function openService(s) {
    if (!canEdit) return
    try {
      const res = await api(`services/${s.id}`)
      setPanel({ service: res.service })
    } catch (err) {
      toast(err.message)
    }
  }

  return (
    <>
      <PageHead crumbs={[{ label: 'Clinic operations' }, { label: 'Services' }]} title="Services" intro="Create and manage the services offered at the clinic.">
        {canEdit && <button type="button" className="btn" onClick={() => setPanel({ service: null })}><Plus aria-hidden /> Add service</button>}
      </PageHead>
      <ErrorNote error={error} />

      <section className="card">
        <div className="toolbar">
          <div className="search">
            <Search aria-hidden />
            <label className="sr-only" htmlFor="service-search">Search services</label>
            <input id="service-search" type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Search services or categories" autoComplete="off" />
          </div>
          <label className="sr-only" htmlFor="service-category">Category</label>
          <select id="service-category" className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {(data?.categories || []).map((c) => <option key={c.id} value={c.id}>{c.name} ({c.services})</option>)}
          </select>
          <div className="tabs" role="group" aria-label="Status">
            {[['all', 'All'], ['active', 'Active'], ['inactive', 'Inactive']].map(([k, label]) => (
              <button key={k} type="button" className="tab" aria-pressed={status === k} onClick={() => setStatus(k)}>{label}</button>
            ))}
          </div>
        </div>
        {data && !data.services.length ? (
          <Empty icon={Stethoscope} title={q || category || status !== 'all' ? 'No services match' : 'No services yet'}
            text={q || category || status !== 'all' ? 'Try another search or filter.' : 'The old price list will be added here. You can also add services one by one.'}>
            {canEdit && !q && <button type="button" className="btn" onClick={() => setPanel({ service: null })}><Plus aria-hidden /> Add service</button>}
          </Empty>
        ) : (
          <table className="table">
            <thead><tr><th>Service</th><th>Price</th><th>Category</th><th>Status</th><th className="hide-sm">Variations</th></tr></thead>
            <tbody aria-busy={loading}>
              {(data?.services || []).map((s) => (
                <tr key={s.id} onClick={() => openService(s)} style={canEdit ? undefined : { cursor: 'default' }}>
                  <td><strong>{s.name}</strong>{s.description && <span className="cell-sub">{s.description}</span>}</td>
                  <td data-label="Price">{priceLabel(s)}</td>
                  <td data-label="Category">{s.category ? <span className="badge badge-soft">{s.category}</span> : '—'}</td>
                  <td data-label="Status">
                    {s.active ? <span className="badge">Active</span> : <span className="badge badge-soft">Inactive</span>}
                    {s.featuredOnline && <span className="cell-sub">Online booking</span>}
                  </td>
                  <td className="hide-sm">{s.variationCount || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {panel && (
        <ServicePanel
          service={panel.service}
          categories={data?.categories || []}
          onClose={() => setPanel(null)}
          onDone={(msg) => { setPanel(null); reload(); toast(msg) }}
        />
      )}
    </>
  )
}
