// Clinic Operations ▸ Import from VetAssist (owners and admins). Until go-live, VetAssist's files are
// brought in here as often as needed: each import adds what's new and updates what changed (VetAssist wins),
// and never deletes. Every file is read on this computer and checked first (a preview), then imported in
// small batches. Rules: lib/vetassist-sync.js. The files come from the PC tools (tools/medical-records-download)
// or VetAssist's own Export buttons.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, FileUp, RefreshCw, TriangleAlert } from 'lucide-react'
import { ErrorNote, PageHead, PawLoader, useToast } from '../components/ui.jsx'
import { api } from '../lib/api.js'
import { useApi } from '../lib/useApi.js'
import { canManage, useStaff } from '../lib/staff.js'
import { prettyDay } from '../lib/format.js'
import { clockTime } from '../lib/appointments.js'
import { readAppointments, readDeceased, readOwners, readPets, readPhotos, readProducts, readRecords, readServices } from '../../lib/vetassist.js'

const fileText = async (f) => (/\.gz$/i.test(f.name) ? new Response(f.stream().pipeThrough(new DecompressionStream('gzip'))).text() : f.text())
const dayIn = (name) => String(name || '').match(/\d{4}-\d{2}-\d{2}/)?.[0] || null
const manilaToday = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
const manilaDay = (iso) => new Date(Date.parse(iso) + 8 * 3600e3).toISOString().slice(0, 10)

// Split rows into batches; rows sharing a group (a customer's pets) stay in one batch.
function batches(rows, size, groupOf) {
  const out = []
  let cur = []
  let last = null
  for (const r of rows) {
    const g = groupOf ? groupOf(r) : null
    if (cur.length >= size && (!groupOf || g !== last)) { out.push(cur); cur = [] }
    cur.push(r)
    last = g
  }
  if (cur.length) out.push(cur)
  return out
}

// What each step reads. parts: [{ kind, rows, size, group, label }] in the order they must run.
const STEPS = [
  {
    id: 'owners_pets', title: 'Owners and Pets', files: [
      { key: 'owners', label: 'Owners file', hint: 'Masterlist ▸ Owners ▸ Export (masterlist_owners_….csv)', accept: '.csv' },
      { key: 'pets', label: 'Pets file', hint: 'Masterlist ▸ Pets ▸ Export (masterlist_pets_….csv)', accept: '.csv' },
    ],
    note: 'Export both on the same day. Owners are matched by customer number, pets by customer number and name. Website clients are never changed.',
    read: async ({ owners, pets }) => {
      const o = readOwners(await fileText(owners))
      const p = readPets(await fileText(pets)).sort((a, b) => a.customerNo.localeCompare(b.customerNo))
      return [{ kind: 'owners', label: 'Owners', rows: o, size: 500 }, { kind: 'pets', label: 'Pets', rows: p, size: 500, group: (r) => r.customerNo }]
    },
  },
  {
    id: 'deceased', title: 'Passed Away Pets', files: [{ key: 'csv', label: 'Deceased pets file', hint: 'Masterlist ▸ Deceased Pets ▸ Export', accept: '.csv' }],
    note: 'VetAssist doesn’t give a date, so “Passed Away On” is the date in the file name (or today). It can be corrected on the pet’s page.',
    read: async ({ csv }) => [{ kind: 'deceased', label: 'Pets', rows: readDeceased(await fileText(csv)), size: 500, on: dayIn(csv.name) || manilaToday() }],
  },
  {
    id: 'appointments', title: 'Appointments', files: [{ key: 'jsonl', label: 'Appointments file', hint: 'From the PC tool: output-appointments ▸ appointments.jsonl', accept: '.jsonl,.json' }],
    note: 'Import Owners and Pets first. A status only changes when it changed in VetAssist, so visits already settled stay settled.',
    read: async ({ jsonl }) => {
      const { rows, unreadable } = readAppointments(await fileText(jsonl))
      return [{ kind: 'appointments', label: 'Appointments', rows, size: 400, skipped: unreadable }]
    },
  },
  {
    id: 'records', title: 'Medical Records', files: [{ key: 'gz', label: 'Medical records file', hint: 'From the PC tool: output-records ▸ records.jsonl.gz', accept: '.gz,.jsonl' }],
    note: 'Import Appointments first. Records are matched by VetAssist’s record number; only changed ones are rewritten, and their photos stay.',
    read: async ({ gz }) => {
      const { rows, skipped } = readRecords(await fileText(gz))
      return [{ kind: 'records', label: 'Records', rows, size: 100, skipped: Object.values(skipped).reduce((a, b) => a + b, 0) }]
    },
  },
  {
    id: 'photos', title: 'Medical Record Photos', files: [
      { key: 'jsonl', label: 'Photos list', hint: 'output-photos ▸ photos.jsonl', accept: '.jsonl' },
      { key: 'uploaded', label: 'Uploaded list', hint: 'output-photos ▸ uploaded.txt (after npm run upload:photos)', accept: '.txt' },
    ],
    note: 'Upload new photos from the PC first (npm run upload:photos). This links the uploaded ones to their records.',
    read: async ({ jsonl, uploaded }) => [{ kind: 'photos', label: 'Photos', rows: readPhotos(await fileText(jsonl), await fileText(uploaded)), size: 500 }],
  },
  {
    id: 'services', title: 'Services', files: [{ key: 'json', label: 'Services file', hint: 'From the PC tool: output-services ▸ services.json', accept: '.json' }],
    note: 'New services only. Prices, variations and weight ranges already set in the app are kept.',
    read: async ({ json }) => [{ kind: 'services', label: 'Services', rows: readServices(await fileText(json)), size: 100 }],
  },
  {
    id: 'products', title: 'Products', files: [{ key: 'csv', label: 'Products file', hint: 'Inventory ▸ Export (…_products.csv)', accept: '.csv' }],
    note: 'New products only. Stock comes from the Stock Count, not VetAssist.',
    read: async ({ csv }) => [{ kind: 'products', label: 'Products', rows: readProducts(await fileText(csv)), size: 500 }],
  },
]

const zero = () => ({ new: 0, updated: 0, same: 0, reviewCount: 0, review: [] })
function add(t, r) {
  t.new += r.new; t.updated += r.updated; t.same += r.same; t.reviewCount += r.reviewCount || r.review.length
  if (t.review.length < 200) t.review.push(...r.review.slice(0, 200 - t.review.length))
}

function Step({ n, step, last, onDone }) {
  const toast = useToast()
  const [files, setFiles] = useState({})
  const [parts, setParts] = useState(null) // read from the files
  const [preview, setPreview] = useState(null) // { [kind]: totals }
  const [phase, setPhase] = useState('idle') // idle | reading | checking | ready | importing | done
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState(null)
  const ready = step.files.every((f) => files[f.key])
  const reset = () => { setParts(null); setPreview(null); setPhase('idle'); setError(null); setProgress(null) }

  async function go(apply) {
    setError(null)
    try {
      let ps = parts
      if (!ps) { setPhase('reading'); ps = await step.read(files); setParts(ps) }
      setPhase(apply ? 'importing' : 'checking')
      const startedAt = new Date().toISOString()
      const totals = {}
      const all = ps.reduce((n, p) => n + p.rows.length, 0)
      let done = 0
      let newOwners = []
      for (const p of ps) {
        totals[p.kind] = zero()
        for (const rows of batches(p.rows, p.size, p.group)) {
          const body = { rows, apply, on: p.on }
          if (p.kind === 'pets' && !apply) { const nos = new Set(rows.map((r) => r.customerNo)); body.pendingOwners = newOwners.filter((x) => nos.has(x)) }
          const r = await api(`vetassist/${p.kind}`, { method: 'POST', body })
          if (r.newNos) newOwners = newOwners.concat(r.newNos)
          add(totals[p.kind], r)
          done += rows.length
          setProgress({ done, all })
        }
        if (apply) {
          const t = totals[p.kind]
          await api(`vetassist/${p.kind}`, { method: 'POST', body: { finish: true, startedAt, fileName: Object.values(files).map((f) => f.name).join(', '), counts: { new: t.new, updated: t.updated, same: t.same, review: t.reviewCount, skipped: p.skipped || 0 } } })
        }
      }
      setPreview(totals)
      setPhase(apply ? 'done' : 'ready')
      if (apply) { toast(`${step.title} imported`); onDone() }
    } catch (err) {
      setError(err)
      setPhase(parts ? 'ready' : 'idle')
    }
  }

  const changes = preview ? Object.values(preview).reduce((n, t) => n + t.new + t.updated, 0) : 0
  const busy = ['reading', 'checking', 'importing'].includes(phase)
  return (
    <section className="card card-pad va-step">
      <div className="va-step-head">
        <span className="va-num" aria-hidden>{n}</span>
        <div>
          <h2>{step.title}</h2>
          <p className="cell-sub">{last ? `Last imported ${prettyDay(manilaDay(last.at))}, ${clockTime(last.at)} by ${last.by}: ${last.counts.new || 0} new, ${last.counts.updated || 0} updated` : 'Not imported with this page yet.'}</p>
        </div>
      </div>
      <p className="field-hint" style={{ margin: 0 }}>{step.note}</p>
      <div className="va-files">
        {step.files.map((f) => (
          <label key={f.key} className="va-file">
            <span className="field-label">{f.label}</span>
            <span className="cell-sub">{f.hint}</span>
            <input type="file" accept={f.accept} disabled={busy} onChange={(e) => { const file = e.target.files?.[0]; setFiles((x) => ({ ...x, [f.key]: file })); reset() }} />
          </label>
        ))}
      </div>
      <ErrorNote error={error} />
      {busy && <PawLoader small label={phase === 'reading' ? 'Reading the file…' : `${phase === 'checking' ? 'Checking' : 'Importing'} ${progress ? `${progress.done.toLocaleString()} of ${progress.all.toLocaleString()}` : ''}…`} />}
      {preview && !busy && (
        <div className="va-result">
          {(parts || []).map((p) => {
            const t = preview[p.kind]
            return (
              <div key={p.kind}>
                <strong>{p.label}{phase === 'done' ? ' imported' : ''}:</strong>{' '}
                <span>{t.new.toLocaleString()} new · {t.updated.toLocaleString()} {phase === 'done' ? 'updated' : 'to update'} · {t.same.toLocaleString()} unchanged{t.reviewCount ? ` · ${t.reviewCount} need a look` : ''}{p.skipped ? ` · ${p.skipped} left out (unreadable or empty)` : ''}</span>
                {t.review.length > 0 && (
                  <details className="va-review">
                    <summary><TriangleAlert size={14} aria-hidden /> {t.reviewCount} need a look{t.reviewCount > t.review.length ? ` (first ${t.review.length} shown)` : ''}</summary>
                    <ul>{t.review.map((x, i) => <li key={i}><strong>{x.what}</strong><span className="cell-sub">{x.why}</span></li>)}</ul>
                  </details>
                )}
              </div>
            )
          })}
        </div>
      )}
      <div className="inline-row">
        {phase !== 'ready' && phase !== 'done' && <button type="button" className="btn btn-quiet" onClick={() => go(false)} disabled={!ready || busy}><RefreshCw aria-hidden /> Check for Changes</button>}
        {phase === 'ready' && <button type="button" className="btn" onClick={() => go(true)} disabled={!changes}><FileUp aria-hidden /> {changes ? `Import ${changes.toLocaleString()} Change${changes === 1 ? '' : 's'}` : 'Nothing to Import'}</button>}
        {phase === 'ready' && <button type="button" className="btn btn-quiet" onClick={reset}>Cancel</button>}
        {phase === 'done' && <span className="va-done"><Check aria-hidden /> Done. Check again any time with a newer file.</span>}
      </div>
    </section>
  )
}

export default function VetAssistImportPage() {
  const staff = useStaff()
  const { data, error, reload } = useApi(canManage(staff) ? 'vetassist' : null)
  if (!canManage(staff)) return <><PageHead crumbs={[{ label: 'Clinic Operations' }, { label: 'Import from VetAssist' }]} title="Import from VetAssist" /><ErrorNote error={new Error('Only an owner or admin can import from VetAssist.')} /></>
  return (
    <>
      <PageHead crumbs={[{ label: 'Clinic Operations' }, { label: 'Import from VetAssist' }]} title="Import from VetAssist"
        intro="Until go-live, bring VetAssist’s latest files in here as often as you like. Each import adds what’s new and updates what changed. Nothing is deleted. Go in this order." />
      <ErrorNote error={error} />
      {!data && !error ? <PawLoader label="Loading…" /> : (
        <div className="va-steps">
          {STEPS.map((s, i) => <Step key={s.id} n={i + 1} step={s} last={data?.last?.[s.id]} onDone={reload} />)}
          <section className="card card-pad va-step">
            <h2>Also from VetAssist</h2>
            <p className="field-hint" style={{ margin: 0 }}>
              Invoices and payments: <Link to="/finances/transactions">Finances ▸ Transactions</Link> ▸ Import. Medications: <Link to="/prescription/medications">Smart Prescription ▸ Medication List</Link> ▸ Import. Both update what’s already there.
            </p>
          </section>
        </div>
      )}
    </>
  )
}
