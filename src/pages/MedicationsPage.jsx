// Smart Prescription ▸ Medication List, like the old system: search, sort by name or date added, rows
// per page (10 to 100), each medication's details with its variations and dosages, and View / Edit / Remove.
// Owners and admins can import the old system's list (tools/medical-records-download/medications.mjs).
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowDown, ArrowUp, ArrowUpDown, CalendarDays, Eye, FolderUp, Info, Pencil, Pill, Plus, Scale, Search, ShieldAlert, Trash2 } from 'lucide-react'
import { Empty, ErrorNote, PageHead, Pager, Panel, PawLoader, useToast } from '../components/ui.jsx'
import { RichView } from '../components/RichText.jsx'
import MedicationPanel from './MedicationFormPage.jsx'
import { api, ApiError, query } from '../lib/api.js'
import { useApi, useDebounced } from '../lib/useApi.js'
import { canManage, useStaff } from '../lib/staff.js'
import { prettyDay } from '../lib/format.js'

export const canEditMeds = (staff) => ['owner', 'admin', 'vet'].includes(staff?.role)
const imgSrc = (m) => `/api/medications/${m.id}/image?v=${encodeURIComponent(m.imageVersion || '')}`
const dose = (d) => `${d.amount} ${d.unit}${d.type ? ` · ${d.type}` : ''}`
const plural = (n, one, many) => `${n || 'No'} ${n === 1 ? one : many}`

function MedIcon({ m, large }) {
  return <span className={`med-icon ${large ? 'is-large' : ''}`}>{m.hasImage ? <img src={imgSrc(m)} alt="" loading="lazy" /> : <Pill aria-hidden />}</span>
}

function ViewPanel({ id, onClose, onEdit }) {
  const { data, error } = useApi(`medications/${id}`)
  const staff = useStaff()
  const m = data?.medication
  return (
    <Panel title={m ? m.name : 'Medication'} intro={m ? <><CalendarDays size={13} aria-hidden /> Added on {prettyDay(m.addedOn)}</> : ''} onClose={onClose}
      footer={m && canEditMeds(staff) ? <><button type="button" className="btn btn-quiet" onClick={onClose}>Close</button><button type="button" className="btn" onClick={() => onEdit(m.id)}><Pencil aria-hidden /> Edit Medication</button></> : null}>
      <ErrorNote error={error} />
      {!m ? <PawLoader label="Opening…" /> : (
        <div className="stack med-view">
          {m.hasImage && <img className="med-photo" src={imgSrc(m)} alt={m.name} />}
          <div className="alert" role="note"><ShieldAlert aria-hidden /><div><strong>Important Notice</strong><br />Always consult a qualified veterinarian before giving any medication. Dosages vary with the pet’s weight, condition and other factors.</div></div>
          <section>
            <h3 className="med-h"><Info aria-hidden /> Description</h3>
            {m.descriptionHtml ? <RichView html={m.descriptionHtml} /> : <p className="muted" style={{ margin: 0 }}>No description.</p>}
          </section>
          <section>
            <h3 className="med-h"><Scale aria-hidden /> General Dosage Information</h3>
            {m.dosages.length ? <div className="chips">{m.dosages.map((d) => <span key={d.id} className="dose-chip">{dose(d)}</span>)}</div> : <p className="muted" style={{ margin: 0 }}>No dosage set.</p>}
          </section>
          {m.variations.length > 0 && (
            <section>
              <h3 className="med-h"><Pill aria-hidden /> Variations</h3>
              <ul className="med-vars">
                {m.variations.map((v) => (
                  <li key={v.id}><strong>{v.name}</strong>{v.details && <span className="cell-sub">{v.details}</span>}
                    {v.dosages.length > 0 && <div className="chips">{v.dosages.map((d) => <span key={d.id} className="dose-chip">{dose(d)}</span>)}</div>}</li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </Panel>
  )
}

// Import from Old System: pick the output-medications folder (medications.json + images/).
function ImportPanel({ onClose, onDone }) {
  const input = useRef(null)
  const [found, setFound] = useState(null) // { meds, images: {name: File} }
  const [error, setError] = useState(null)
  const [progress, setProgress] = useState(null)
  useEffect(() => { input.current?.setAttribute('webkitdirectory', ''); input.current?.setAttribute('directory', '') }, [])
  async function pick(e) {
    setError(null)
    setFound(null)
    const files = [...(e.target.files || [])]
    const file = files.find((f) => f.name === 'medications.json')
    if (!file) { setError(new ApiError(400, { error: 'This folder has no medications.json. Pick the output-medications folder from the download tool.' })); return }
    let meds
    try { meds = JSON.parse(await file.text()) } catch { setError(new ApiError(400, { error: 'medications.json couldn’t be read. Run the download tool again.' })); return }
    if (!Array.isArray(meds) || !meds.length) { setError(new ApiError(400, { error: 'medications.json has no medications in it.' })); return }
    setFound({ meds, images: Object.fromEntries(files.filter((f) => /\.(jpe?g|png|webp)$/i.test(f.name)).map((f) => [f.name, f])) })
  }
  async function run() {
    setError(null)
    try {
      setProgress('Saving the medications…')
      const res = await api('medications/import', { method: 'POST', body: { medications: found.meds.map((m) => ({ name: m.name, dateAdded: m.dateAdded, descriptionHtml: m.descriptionHtml, descriptionText: m.descriptionText, dosages: m.dosages, variations: m.variations, image: m.image })) } })
      let n = 0
      for (const m of res.medications) {
        const f = m.image && found.images[m.image]
        if (!f) continue
        n += 1
        setProgress(`Uploading pictures… ${n}`)
        const type = f.type || (/png$/i.test(f.name) ? 'image/png' : /webp$/i.test(f.name) ? 'image/webp' : 'image/jpeg')
        await fetch(`/api/medications/${m.id}/image`, { method: 'PUT', body: f, headers: { 'Content-Type': type }, credentials: 'same-origin' })
      }
      onDone(`${res.imported} medications imported${n ? `, ${n} with pictures` : ''}${res.skipped.length ? `. ${res.skipped.length} skipped (no name)` : ''}.`)
    } catch (err) {
      setProgress(null)
      setError(err)
    }
  }
  const dosages = found ? found.meds.reduce((s, m) => s + (m.dosages?.length || 0), 0) : 0
  const vars = found ? found.meds.reduce((s, m) => s + (m.variations?.length || 0), 0) : 0
  return (
    <Panel title="Import from Old System" intro="The Medication List read by the download tool." onClose={onClose} busy={!!progress} dirty={!!found && !progress}
      footer={<><button type="button" className="btn btn-quiet" onClick={onClose} disabled={!!progress}>Cancel</button>
        <button type="button" className="btn" onClick={run} disabled={!found || !!progress}><FolderUp aria-hidden /> {progress || (found ? `Import ${found.meds.length} Medications` : 'Import')}</button></>}>
      <div className="stack">
        <p style={{ margin: 0 }}>Pick the <code>output-medications</code> folder (it holds <code>medications.json</code> and <code>images</code>). Medications are matched by name, so importing again updates them.</p>
        <label className="btn btn-quiet" style={{ justifySelf: 'start' }}>
          <FolderUp aria-hidden /> Choose Folder
          <input ref={input} type="file" multiple className="sr-only" onChange={pick} disabled={!!progress} />
        </label>
        <ErrorNote error={error} />
        {found && <div className="content-box"><strong>{found.meds.length} medications</strong><span className="cell-sub">{dosages} dosages · {vars} variations · {Object.keys(found.images).length} pictures</span></div>}
      </div>
    </Panel>
  )
}

export default function MedicationsPage() {
  const staff = useStaff()
  const toast = useToast()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const set = (patch) => setParams((p) => { const n = new URLSearchParams(p); Object.entries(patch).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k))); if (!('page' in patch)) n.delete('page'); return n }, { replace: true })
  const [text, setText] = useState(params.get('q') || '')
  const q = useDebounced(text.trim(), 250)
  const size = Number(params.get('size')) || 10
  const page = Number(params.get('page')) || 1
  const sort = params.get('sort') === 'name' ? 'name' : 'added'
  const dir = params.get('dir') === 'asc' ? 'asc' : sort === 'name' && !params.get('dir') ? 'asc' : 'desc'
  const { data, error, reload } = useApi(`medications${query({ q, page, size, sort, dir })}`)
  const [view, setView] = useState(null)
  const [importing, setImporting] = useState(false)
  // Add / Edit open as a panel over the list; their addresses (…/new, …/:id/edit) open it straight away.
  const { id: editId } = useParams()
  const adding = useLocation().pathname.endsWith('/new')
  const panelOpen = adding || !!editId
  const toList = () => navigate(`/prescription/medications${params.toString() ? `?${params}` : ''}`)
  const openEdit = (mid) => { setView(null); navigate(`/prescription/medications/${mid}/edit${params.toString() ? `?${params}` : ''}`) }
  async function remove(m) {
    if (!window.confirm(`Remove ${m.name} from the Medication List?`)) return
    try { await api(`medications/${m.id}`, { method: 'DELETE' }); toast(`${m.name} removed`); reload() } catch (err) { toast(err.message) }
  }
  const SortHead = ({ k, label }) => {
    const on = sort === k
    const Icon = !on ? ArrowUpDown : dir === 'asc' ? ArrowUp : ArrowDown
    return <th aria-sort={on ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}><button type="button" className="th-sort" onClick={() => set({ sort: k === 'added' ? '' : k, dir: on ? (dir === 'asc' ? 'desc' : 'asc') : k === 'name' ? 'asc' : 'desc' })}>{label} <Icon aria-hidden /></button></th>
  }
  return (
    <>
      <PageHead crumbs={[{ label: 'Smart Prescription' }, { label: 'Medication List' }]} title="Medication List" intro="Medicines with their details, variations and dosages.">
        <div className="head-actions">
          {canManage(staff) && <button type="button" className="btn btn-quiet" onClick={() => setImporting(true)}><FolderUp aria-hidden /> Import from Old System</button>}
          {canEditMeds(staff) && <button type="button" className="btn" onClick={() => navigate(`/prescription/medications/new${params.toString() ? `?${params}` : ''}`)}><Plus aria-hidden /> Add Medication</button>}
        </div>
      </PageHead>
      <section className="card">
        <div className="card-head"><div><h2>Medications</h2><p>{data ? `${data.total} medication${data.total === 1 ? '' : 's'} in all` : ' '}</p></div></div>
        <div className="toolbar">
          <div className="search"><Search aria-hidden /><input type="search" value={text} onChange={(e) => { setText(e.target.value); set({}) }} placeholder="Search medications…" aria-label="Search medications" /></div>
        </div>
        <ErrorNote error={error} />
        {!data ? <PawLoader label="Loading medications…" /> : !data.medications.length ? (
          <Empty icon={Pill} title={q ? `No medications match “${q}”` : 'No medications yet'} text={q ? 'Try part of the name or an ingredient.' : 'Add one, or import the old system’s list.'} />
        ) : (
          <>
            <table className="table med-table">
              <thead><tr><SortHead k="name" label="Medication" /><th>Details</th><SortHead k="added" label="Date Added" /><th className="num">Actions</th></tr></thead>
              <tbody>
                {data.medications.map((m) => (
                  <tr key={m.id} className="row-click" onClick={() => setView(m.id)}>
                    <td><div className="cell-main"><MedIcon m={m} /><strong>{m.name}</strong></div></td>
                    <td data-label="Details" className="med-details">
                      <span className="cell-sub">{m.details || 'No description'}</span>
                      <span className="chips">
                        <span className={`badge ${m.variations ? 'badge-soft' : 'badge-warm'}`}>{plural(m.variations, 'variation', 'variations')}</span>
                        <span className="badge badge-soft">{plural(m.dosages, 'dosage', 'dosages')}</span>
                      </span>
                    </td>
                    <td data-label="Date Added" className="nowrap">{prettyDay(m.addedOn)}</td>
                    <td className="num" onClick={(e) => e.stopPropagation()}>
                      <span className="row-actions">
                        <button type="button" className="icon-btn" onClick={() => setView(m.id)} aria-label={`View ${m.name}`} title="View Details"><Eye /></button>
                        {canEditMeds(staff) && <button type="button" className="icon-btn" onClick={() => openEdit(m.id)} aria-label={`Edit ${m.name}`} title="Edit"><Pencil /></button>}
                        {canManage(staff) && <button type="button" className="icon-btn icon-danger" onClick={() => remove(m)} aria-label={`Remove ${m.name}`} title="Remove"><Trash2 /></button>}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pager page={page} pageSize={size} total={data.total} onPage={(n) => set({ page: n > 1 ? String(n) : '' })} noun="medications"
              right={<label className="inline-row" style={{ gap: 8 }}>Rows per page
                <select className="select" value={size} onChange={(e) => set({ size: e.target.value === '10' ? '' : e.target.value })}>
                  {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>} />
          </>
        )}
      </section>
      {view && <ViewPanel id={view} onClose={() => setView(null)} onEdit={openEdit} />}
      {panelOpen && <MedicationPanel key={editId || 'new'} id={editId ? Number(editId) : null} onClose={toList} onDone={(msg) => { toast(msg); reload(); toList() }} />}
      {importing && <ImportPanel onClose={() => setImporting(false)} onDone={(msg) => { setImporting(false); toast(msg); reload() }} />}
    </>
  )
}
