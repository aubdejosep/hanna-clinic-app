// Inventory ▸ Stock Movements (every change: who, when, why) and Stock Count (the baseline, then
// regular counts that show what went missing).
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Check, ClipboardList, Search } from 'lucide-react'
import { Empty, ErrorNote, PageHead, Pager, PawLoader, useToast } from '../components/ui.jsx'
import { Change, KIND_LABEL, MovementWhy, UNITS, peso, qtyText, unitWord } from './InventoryPage.jsx'
import { api, query } from '../lib/api.js'
import { useApi, useDebounced } from '../lib/useApi.js'
import { canManage, useStaff } from '../lib/staff.js'
import { prettyDay } from '../lib/format.js'
import { clockTime, manilaToday } from '../lib/appointments.js'

const manilaDay = (iso) => new Date(Date.parse(iso) + 8 * 3600e3).toISOString().slice(0, 10)

export function MovementsPage() {
  const [params, setParams] = useSearchParams()
  const update = (patch) => setParams((p) => { const n = new URLSearchParams(p); Object.entries(patch).forEach(([k, v]) => (v ? n.set(k, String(v)) : n.delete(k))); return n }, { replace: true })
  const kind = params.get('kind') || ''
  const from = params.get('from') || ''
  const to = params.get('to') || ''
  const page = Number(params.get('page')) || 1
  const [text, setText] = useState(params.get('q') || '')
  const q = useDebounced(text.trim())
  useEffect(() => { if (q !== (params.get('q') || '')) update({ q, page: '' }) }, [q]) // eslint-disable-line react-hooks/exhaustive-deps
  const { data, error, loading } = useApi(`inventory/movements${query({ kind, from, to, q: params.get('q') || '', page, productId: params.get('productId') || '' })}`)
  return (
    <>
      <PageHead crumbs={[{ label: 'Inventory' }, { label: 'Stock Movements' }]} title="Stock Movements" intro="Every change to stock, newest first: what, how many, why, and who. Nothing here can be edited or deleted." />
      <section className="card">
        <div className="toolbar">
          <div className="search">
            <Search aria-hidden />
            <label className="sr-only" htmlFor="mv-search">Search</label>
            <input id="mv-search" type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Product, staff or reason" autoComplete="off" />
          </div>
          <label className="sr-only" htmlFor="mv-from">From</label>
          <input id="mv-from" className="select" type="date" value={from} max={manilaToday()} onChange={(e) => update({ from: e.target.value, page: '' })} />
          <label className="sr-only" htmlFor="mv-to">To</label>
          <input id="mv-to" className="select" type="date" value={to} max={manilaToday()} onChange={(e) => update({ to: e.target.value, page: '' })} />
          <div className="tabs tab-scroll" role="group" aria-label="Kind">
            {[['', 'All'], ...Object.entries(KIND_LABEL)].map(([k, l]) => <button key={l} type="button" className="tab" aria-pressed={kind === k} onClick={() => update({ kind: k, page: '' })}>{l}</button>)}
          </div>
        </div>
        <ErrorNote error={error} />
        {data && !data.total ? <Empty icon={ClipboardList} title="No movements here" text="Stock moves with each paid visit, sale, delivery, adjustment and count." /> : (
          <>
            <table className="table">
              <thead><tr><th>When</th><th>Product</th><th className="num">Change</th><th className="num hide-sm">Left</th><th>Why</th><th className="hide-sm">By</th></tr></thead>
              <tbody aria-busy={loading}>
                {!data && <tr className="no-hover"><td colSpan={6}><PawLoader label="Loading movements…" /></td></tr>}
                {(data?.movements || []).map((m) => (
                  <tr key={m.id} className="no-hover" style={{ cursor: 'default' }}>
                    <td data-label="When" style={{ whiteSpace: 'nowrap' }}>{prettyDay(manilaDay(m.at))}<span className="cell-sub">{clockTime(m.at)}</span></td>
                    <td><Link className="row-link" to={`/inventory?product=${m.product.id}`}><strong>{m.product.name}</strong></Link><span className="cell-sub">per {m.product.unit}</span></td>
                    <td className="num" data-label="Change"><Change qty={m.qty} /></td>
                    <td className="num hide-sm">{Number(m.balance).toLocaleString('en-PH', { maximumFractionDigits: 3 })}</td>
                    <td data-label="Why"><MovementWhy m={m} /></td>
                    <td className="hide-sm">{m.by || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data && <Pager page={page} pageSize={data.pageSize} total={data.total} onPage={(n) => update({ page: n > 1 ? n : '' })} noun="movements" />}
          </>
        )}
      </section>
    </>
  )
}

export function CountsPage() {
  const { data, error } = useApi('inventory/counts')
  const owner = canManage(useStaff())
  const navigate = useNavigate()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const open = data?.counts.find((c) => !c.finishedAt)
  const baselineDone = data?.counts.some((c) => c.finishedAt)
  async function start() {
    setBusy(true)
    try {
      const res = await api('inventory/counts', { method: 'POST', body: {} })
      navigate(`/inventory/counts/${res.count.id}`)
    } catch (err) {
      toast(err.message)
      setBusy(false)
    }
  }
  return (
    <>
      <PageHead crumbs={[{ label: 'Inventory' }, { label: 'Stock Count' }]} title="Stock Count"
        intro={baselineDone ? 'Count the shelves now and then. The difference from what the app expected is what went missing (or was never recorded).' : 'The first count is the baseline: the real opening stock. Everything after it is tracked from there.'}>
        {owner && !open && <button type="button" className="btn" onClick={start} disabled={busy || !data}><ClipboardList aria-hidden /> {baselineDone ? 'Start a Count' : 'Start the Baseline Count'}</button>}
        {open && <Link className="btn" to={`/inventory/counts/${open.id}`}><ClipboardList aria-hidden /> Continue the Count</Link>}
      </PageHead>
      <ErrorNote error={error} />
      <section className="card">
        {!data ? <PawLoader /> : !data.counts.length ? (
          <Empty icon={ClipboardList} title="No counts yet" text={owner ? 'Start the baseline count: staff count each product on the shelf from their phones, then an owner finishes it.' : 'An owner starts the first count. Then everyone can help count from their phones.'} />
        ) : (
          <table className="table">
            <thead><tr><th>Count</th><th>Products Counted</th><th className="num">Missing (at Cost)</th><th className="num hide-sm">Extra</th><th>Status</th></tr></thead>
            <tbody>
              {data.counts.map((c) => (
                <tr key={c.id} onClick={() => navigate(`/inventory/counts/${c.id}`)}>
                  <td><strong>{c.kind === 'baseline' ? 'Baseline Count' : 'Stock Count'}</strong><span className="cell-sub">Started {prettyDay(manilaDay(c.startedAt))} by {c.startedBy}</span></td>
                  <td data-label="Products Counted">{c.lines}</td>
                  <td className="num" data-label="Missing">{c.kind === 'baseline' || !c.finishedAt ? '—' : <span className={c.missingValue ? 'qty-out' : undefined}>{peso(c.missingValue)}</span>}</td>
                  <td className="num hide-sm">{c.kind === 'baseline' || !c.finishedAt ? '—' : peso(c.extraValue)}</td>
                  <td data-label="Status">{c.finishedAt ? <span className="badge">Finished {prettyDay(manilaDay(c.finishedAt))}</span> : <span className="badge badge-warn">Open</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  )
}

// One line of an open count: the number on the shelf (saved when the field is left) and the expiry.
function CountLine({ p, countId, baseline, onSaved }) {
  const [counted, setCounted] = useState(p.counted ?? '')
  const [expiry, setExpiry] = useState(p.expiry || '')
  const [unit, setUnit] = useState(p.unit)
  const [state, setState] = useState(p.counted != null ? 'saved' : '')
  const last = useRef({ counted: p.counted ?? '', expiry: p.expiry || '', unit: p.unit })
  async function save(patch) {
    const next = { counted, expiry, unit, ...patch }
    const unitChanged = baseline && next.unit !== last.current.unit
    const countChanged = next.counted !== '' && (next.counted !== last.current.counted || next.expiry !== last.current.expiry)
    if (!unitChanged && !countChanged) return
    setState('saving')
    try {
      await api(`inventory/counts/${countId}/lines`, { method: 'PUT', body: { productId: p.id, ...(countChanged ? { counted: next.counted, expiry: next.expiry } : {}), ...(unitChanged ? { unit: next.unit } : {}) } })
      last.current = { ...last.current, ...(countChanged ? { counted: next.counted, expiry: next.expiry } : {}), ...(unitChanged ? { unit: next.unit } : {}) }
      const isDone = last.current.counted !== ''
      setState(isDone ? 'saved' : '')
      onSaved(p.id, isDone)
    } catch (err) {
      setState(err.message)
    }
  }
  return (
    <li className={`count-line ${state === 'saved' ? 'is-done' : ''}`}>
      <span className="count-name"><strong>{p.name}</strong><span className="cell-sub">{p.category}</span></span>
      {baseline ? (
        <select className="select count-unit" value={unit} onChange={(e) => { setUnit(e.target.value); save({ unit: e.target.value }) }} aria-label={`${p.name} unit`}>
          {UNITS.map((u) => <option key={u} value={u}>{unitWord(u, 2)}</option>)}
        </select>
      ) : <span className="cell-sub count-unit">{unitWord(p.unit, 2)}</span>}
      <input className="count-qty" value={counted} onChange={(e) => setCounted(e.target.value.replace(/[^\d.]/g, ''))} onBlur={() => save({})} inputMode="decimal" placeholder="Count" aria-label={`${p.name}: how many on the shelf`} />
      <input className="count-exp" type="date" value={expiry} onChange={(e) => { setExpiry(e.target.value); if (counted !== '') save({ expiry: e.target.value }) }} aria-label={`${p.name}: nearest expiry date`} title="Nearest expiry date (optional)" />
      <span className="count-state" aria-live="polite">{state === 'saved' ? <Check aria-label="Saved" /> : state === 'saving' ? '…' : state ? <span className="field-error">{state}</span> : null}</span>
    </li>
  )
}

export function CountPage() {
  const { id } = useParams()
  const { data, error, setData, reload } = useApi(`inventory/counts/${id}`)
  const c = data?.count
  const owner = canManage(useStaff())
  const toast = useToast()
  const navigate = useNavigate()
  const [text, setText] = useState('')
  const [show, setShow] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [done, setDone] = useState({})
  useEffect(() => { if (c) setDone(Object.fromEntries(c.products.filter((p) => p.counted != null).map((p) => [p.id, true]))) }, [c?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const words = text.toLowerCase().split(/\s+/).filter(Boolean)
  const list = useMemo(() => (c?.products || []).filter((p) => words.every((w) => `${p.name} ${p.category}`.toLowerCase().includes(w))
    && (show === 'todo' ? !done[p.id] : show === 'done' ? done[p.id] : true)), [c, text, show, done]) // eslint-disable-line react-hooks/exhaustive-deps
  const counted = Object.values(done).filter(Boolean).length
  async function finish() {
    setBusy(true)
    try {
      const res = await api(`inventory/counts/${id}/finish`, { method: 'POST' })
      setData({ count: res.count })
      toast('Count finished. Stock is now set from it.')
    } catch (err) {
      toast(err.message)
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }
  async function cancel() {
    if (!window.confirm('Cancel this count? What was typed is kept in the history but stock does not change.')) return
    try { await api(`inventory/counts/${id}`, { method: 'DELETE' }); navigate('/inventory/counts') } catch (err) { toast(err.message) }
  }
  const crumbs = [{ label: 'Inventory' }, { label: 'Stock Count', to: '/inventory/counts' }, { label: c?.kind === 'baseline' ? 'Baseline' : 'Count' }]
  if (error) return <><PageHead crumbs={crumbs} title="Stock Count" /><ErrorNote error={error} /></>
  if (!c) return <><PageHead crumbs={crumbs} title=" " /><PawLoader /></>
  if (c.finishedAt) return <CountResult c={c} crumbs={crumbs} />
  const baseline = c.kind === 'baseline'
  return (
    <>
      <PageHead crumbs={crumbs} title={baseline ? 'Baseline Count' : 'Stock Count'}
        intro={baseline ? 'Count what is on the shelf, in the smallest unit you give (tablets, ml, vials). Set the unit while you count. Each number saves when you leave the field, so several people can count at once.' : 'Count what is on the shelf. The app’s own number stays hidden until the count is finished, so the count is honest. Each number saves when you leave the field.'}>
        {owner && <div className="head-actions">
          <button type="button" className="btn btn-quiet" onClick={cancel}>Cancel Count</button>
          <button type="button" className="btn" onClick={() => setConfirming(true)} disabled={!counted}>Finish Count</button>
        </div>}
      </PageHead>
      {confirming && (
        <div className="alert" role="alertdialog" style={{ marginBottom: 16 }}>
          <ClipboardList aria-hidden />
          <span style={{ flex: 1 }}>Finish with <strong>{counted} of {c.products.length}</strong> products counted? Their stock is set to what was counted{baseline ? '' : ' and the differences are recorded as missing or extra'}. Products not counted stay as they are.</span>
          <button type="button" className="btn btn-quiet" onClick={() => setConfirming(false)} disabled={busy}>Keep Counting</button>
          <button type="button" className="btn" onClick={finish} disabled={busy}>{busy ? 'Finishing…' : 'Finish Count'}</button>
        </div>
      )}
      <section className="card">
        <div className="toolbar">
          <div className="search">
            <Search aria-hidden />
            <label className="sr-only" htmlFor="cnt-search">Search</label>
            <input id="cnt-search" type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Find a product" autoComplete="off" />
          </div>
          <div className="tabs" role="group" aria-label="Show">
            {[['', `All ${c.products.length}`], ['todo', `To Count ${c.products.length - counted}`], ['done', `Counted ${counted}`]].map(([k, l]) => <button key={k} type="button" className="tab" aria-pressed={show === k} onClick={() => setShow(k)}>{l}</button>)}
          </div>
          <button type="button" className="text-btn" onClick={reload}>Refresh</button>
        </div>
        <div className="count-head" aria-hidden><span>Product</span><span>Unit</span><span>On Shelf</span><span>Nearest Expiry</span><span /></div>
        <ul className="count-list">
          {list.map((p) => <CountLine key={p.id} p={p} countId={c.id} baseline={baseline} onSaved={(pid, ok) => setDone((d) => ({ ...d, [pid]: ok }))} />)}
        </ul>
        {!list.length && <p className="card-pad muted" style={{ margin: 0 }}>Nothing here.</p>}
      </section>
    </>
  )
}

function CountResult({ c, crumbs }) {
  const baseline = c.kind === 'baseline'
  const rows = c.products.map((p) => ({ ...p, diff: Math.round((p.counted - p.expected) * 1000) / 1000 })).sort((a, b) => (a.diff * (a.cost || 0)) - (b.diff * (b.cost || 0)))
  return (
    <>
      <PageHead crumbs={crumbs} title={baseline ? 'Baseline Count' : 'Stock Count'} intro={`Finished ${prettyDay(manilaDay(c.finishedAt))} by ${c.finishedBy}. ${c.lines} products counted.`} />
      {!baseline && (
        <div className="stat-grid inv-stats" style={{ marginBottom: 16 }}>
          <div className="card stat"><div className="stat-top"><span className="label">Missing at Cost</span></div><div className="stat-value">{peso(c.missingValue)}</div><span className="stat-note">{c.missingLines} products short</span></div>
          <div className="card stat"><div className="stat-top"><span className="label">Extra at Cost</span></div><div className="stat-value">{peso(c.extraValue)}</div><span className="stat-note">More on the shelf than expected</span></div>
        </div>
      )}
      <section className="card">
        <table className="table">
          <thead><tr><th>Product</th>{!baseline && <th className="num">Expected</th>}<th className="num">Counted</th>{!baseline && <th className="num">Difference</th>}{!baseline && <th className="num hide-sm">Value</th>}<th className="hide-sm">By</th></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="no-hover" style={{ cursor: 'default' }}>
                <td><strong>{p.name}</strong><span className="cell-sub">{p.category}</span></td>
                {!baseline && <td className="num" data-label="Expected">{qtyText(p.expected, p.unit)}</td>}
                <td className="num" data-label="Counted">{qtyText(p.counted, p.unit)}</td>
                {!baseline && <td className="num" data-label="Difference">{p.diff ? <Change qty={p.diff} /> : '—'}</td>}
                {!baseline && <td className="num hide-sm">{p.diff && p.cost != null ? peso(p.diff * p.cost) : '—'}</td>}
                <td className="hide-sm">{p.countedBy}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  )
}
