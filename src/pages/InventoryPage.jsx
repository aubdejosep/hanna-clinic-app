// Inventory ▸ Product List: stock on hand for every medicine and product, with Receive Stock,
// Adjust Stock and Sell Items. Prices and costs are visible to everyone; owners edit details.
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowDownToLine, ClipboardList, Package, PackagePlus, Pencil, Plus, Search, ShoppingBag, SlidersHorizontal } from 'lucide-react'
import { Empty, ErrorNote, Field, PageHead, Panel, PawLoader, useToast } from '../components/ui.jsx'
import { SellPanel } from '../components/SellPanel.jsx'
import { api, query } from '../lib/api.js'
import { useApi, useDebounced } from '../lib/useApi.js'
import { canManage, useStaff } from '../lib/staff.js'
import { prettyDay } from '../lib/format.js'
import { clockTime } from '../lib/appointments.js'

export const UNITS = ['tablet', 'capsule', 'ml', 'vial', 'dose', 'piece', 'sachet', 'tube', 'bottle', 'bar', 'pack', 'box']
export const ADJUST_REASONS = ['Expired', 'Damaged', 'Used in Clinic', 'Lost or Missing', 'Found', 'Returned to Supplier', 'Correction']
export const KIND_LABEL = { count: 'Stock Count', receive: 'Received', visit: 'Visit', sale: 'Sale', adjust: 'Adjustment', reversal: 'Put Back' }
export const peso = (n) => (n == null ? '—' : `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
export const unitWord = (unit, n) => (!unit ? '' : n === 1 || unit === 'ml' ? unit : unit === 'box' ? 'boxes' : `${unit}s`)
export const qtyText = (n, unit) => `${Number(n || 0).toLocaleString('en-PH', { maximumFractionDigits: 3 })} ${unitWord(unit, Number(n))}`.trim()
const FILTERS = [['', 'All'], ['low', 'Low or Out'], ['expiring', 'Expiring Soon'], ['uncounted', 'Not Counted Yet'], ['inactive', 'Inactive']]

export function StockBadge({ p }) {
  if (p.status === 'uncounted') return <span className="badge badge-soft">Not Counted</span>
  if (p.status === 'out') return <span className="badge badge-warn">Out of Stock</span>
  if (p.status === 'low') return <span className="badge badge-warn">Low</span>
  return <span className="badge">In Stock</span>
}

export function MovementWhy({ m }) {
  const link = m.appointmentId ? <Link to={`/appointments/${m.appointmentId}`} onClick={(e) => e.stopPropagation()}>{m.petName ? `${m.petName}'s visit` : 'Visit'}</Link> : null
  return (
    <span>
      <strong>{KIND_LABEL[m.kind]}</strong>
      {(link || m.reason || m.saleId) && <span className="cell-sub">{link}{link && m.reason ? ' · ' : ''}{m.reason}{m.saleId && !m.reason ? `Sale #${m.saleId}` : ''}</span>}
    </span>
  )
}

export function Change({ qty }) {
  return <span className={qty < 0 ? 'qty-out' : 'qty-in'}>{qty > 0 ? '+' : ''}{Number(qty).toLocaleString('en-PH', { maximumFractionDigits: 3 })}</span>
}

function ProductForm({ product, categories, onClose, onDone }) {
  const editing = !!product
  const [v, setV] = useState({
    name: product?.name || '', category: product?.category || '', unit: product?.unit || 'piece', packName: product?.packName || '',
    packSize: product?.packSize ?? '', price: product?.price ?? '', cost: product?.cost ?? '', reorderLevel: product?.reorderLevel ?? '', active: product ? product.active : true,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const errors = error?.body?.errors || {}
  const set = (patch) => setV((x) => ({ ...x, ...patch }))
  async function save() {
    setBusy(true)
    setError(null)
    try {
      const res = await api(editing ? `inventory/${product.id}` : 'inventory', { method: editing ? 'PATCH' : 'POST', body: v })
      onDone(res.product, editing ? `${v.name} updated` : `${v.name} added`)
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }
  return (
    <Panel title={editing ? `Edit ${product.name}` : 'Add Product'} intro="Prices and costs are per unit: the smallest amount given (a tablet, 1 ml, a vial)." onClose={onClose} busy={busy}
      footer={<><button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="btn" onClick={save} disabled={busy}>{busy ? 'Saving…' : editing ? 'Save Changes' : 'Add Product'}</button></>}>
      <ErrorNote error={error && !Object.keys(errors).length ? error : null} />
      <datalist id="product-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
      <section className="form-section">
        <Field label="Product Name" error={errors.name}>{(a) => <input {...a} value={v.name} onChange={(e) => set({ name: e.target.value })} maxLength={60} />}</Field>
        <div className="form-row">
          <Field label="Category" optional>{(a) => <input {...a} value={v.category} onChange={(e) => set({ category: e.target.value })} list="product-categories" maxLength={40} autoComplete="off" />}</Field>
          <Field label="Unit" hint="What's counted and given: one tablet, 1 ml…">{(a) => (
            <select {...a} value={v.unit} onChange={(e) => set({ unit: e.target.value })}>{UNITS.map((u) => <option key={u} value={u}>{u}</option>)}</select>
          )}</Field>
        </div>
        <div className="form-row">
          <Field label="Bought In" optional hint="e.g. box, bottle">{(a) => <input {...a} value={v.packName} onChange={(e) => set({ packName: e.target.value })} maxLength={20} />}</Field>
          <Field label={`${v.unit}s per ${v.packName || 'pack'}`} optional error={errors.packSize} hint="Lets Receive Stock take whole boxes.">{(a) => <input {...a} value={v.packSize} onChange={(e) => set({ packSize: e.target.value })} inputMode="decimal" />}</Field>
        </div>
        <div className="form-row">
          <Field label={`Price per ${v.unit} (₱)`} optional error={errors.price}>{(a) => <input {...a} value={v.price} onChange={(e) => set({ price: e.target.value })} inputMode="decimal" />}</Field>
          <Field label={`Cost per ${v.unit} (₱)`} optional error={errors.cost} hint="Updated by each delivery with a cost.">{(a) => <input {...a} value={v.cost} onChange={(e) => set({ cost: e.target.value })} inputMode="decimal" />}</Field>
        </div>
        <Field label="Reorder Level" optional error={errors.reorderLevel} hint={`Alert when ${v.unit}s on hand fall to this.`}>{(a) => <input {...a} value={v.reorderLevel} onChange={(e) => set({ reorderLevel: e.target.value })} inputMode="decimal" style={{ maxWidth: 160 }} />}</Field>
        {editing && <label className="check"><input type="checkbox" checked={v.active} onChange={(e) => set({ active: e.target.checked })} /> <span><strong>Active</strong><br />Shown when adding items to a visit or a sale.</span></label>}
      </section>
    </Panel>
  )
}

function ReceivePanel({ product: p, onClose, onDone }) {
  const [v, setV] = useState({ packs: '', qty: '', packCost: '', unitCost: '', expiry: '', batchNo: '', supplier: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const errors = error?.body?.errors || {}
  const set = (patch) => setV((x) => ({ ...x, ...patch }))
  const byPack = !!p.packSize
  const units = byPack && v.packs ? Number(v.packs) * p.packSize : Number(v.qty)
  async function save() {
    setBusy(true)
    setError(null)
    try {
      const res = await api(`inventory/${p.id}/receive`, { method: 'POST', body: byPack ? { packs: v.packs || undefined, qty: v.qty, packCost: v.packCost, unitCost: v.unitCost, expiry: v.expiry, batchNo: v.batchNo, supplier: v.supplier } : v })
      onDone(res.product, `${qtyText(units, p.unit)} of ${p.name} received`)
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }
  return (
    <Panel dirty={!!(v.packs || v.qty)} title={`Receive ${p.name}`} intro={`On hand now: ${qtyText(p.onHand, p.unit)}. Adds a delivery with its expiry date.`} onClose={onClose} busy={busy}
      footer={<><button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="btn" onClick={save} disabled={busy || !(units > 0)}>{busy ? 'Saving…' : units > 0 ? `Receive ${qtyText(units, p.unit)}` : 'Receive Stock'}</button></>}>
      <ErrorNote error={error && !Object.keys(errors).length ? error : null} />
      <section className="form-section">
        {byPack ? (
          <div className="form-row">
            <Field label={`How Many ${p.packName || 'Pack'}s`} error={errors.qty} hint={`${p.packSize} ${p.unit}s each`}>{(a) => <input {...a} value={v.packs} onChange={(e) => set({ packs: e.target.value, qty: '' })} inputMode="decimal" autoFocus />}</Field>
            <Field label={`Cost per ${p.packName || 'Pack'} (₱)`} optional>{(a) => <input {...a} value={v.packCost} onChange={(e) => set({ packCost: e.target.value })} inputMode="decimal" />}</Field>
          </div>
        ) : (
          <div className="form-row">
            <Field label={`How Many ${p.unit}s`} error={errors.qty}>{(a) => <input {...a} value={v.qty} onChange={(e) => set({ qty: e.target.value })} inputMode="decimal" autoFocus />}</Field>
            <Field label={`Cost per ${p.unit} (₱)`} optional>{(a) => <input {...a} value={v.unitCost} onChange={(e) => set({ unitCost: e.target.value })} inputMode="decimal" />}</Field>
          </div>
        )}
        <div className="form-row">
          <Field label="Expiry Date" optional error={errors.expiry}>{(a) => <input {...a} type="date" value={v.expiry} onChange={(e) => set({ expiry: e.target.value })} />}</Field>
          <Field label="Batch or Lot No." optional>{(a) => <input {...a} value={v.batchNo} onChange={(e) => set({ batchNo: e.target.value })} maxLength={40} />}</Field>
        </div>
        <Field label="Supplier" optional>{(a) => <input {...a} value={v.supplier} onChange={(e) => set({ supplier: e.target.value })} maxLength={60} />}</Field>
      </section>
    </Panel>
  )
}

function AdjustPanel({ product: p, onClose, onDone }) {
  const [reason, setReason] = useState('')
  const [qty, setQty] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const errors = error?.body?.errors || {}
  const comesIn = reason === 'Found'
  async function save() {
    setBusy(true)
    setError(null)
    try {
      const res = await api(`inventory/${p.id}/adjust`, { method: 'POST', body: { qty, reason, note, direction: comesIn ? 'in' : 'out' } })
      onDone(res.product, `${p.name}: ${comesIn ? '+' : '−'}${qtyText(qty, p.unit)} (${reason})`)
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }
  return (
    <Panel dirty={!!(reason || qty)} title={`Adjust ${p.name}`} intro={`On hand now: ${qtyText(p.onHand, p.unit)}. For stock that left or came back outside a visit or a sale. Your name and the reason are kept.`} onClose={onClose} busy={busy}
      footer={<><button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="btn" onClick={save} disabled={busy || !reason || !(Number(qty) > 0)}>{busy ? 'Saving…' : 'Save Adjustment'}</button></>}>
      <ErrorNote error={error && !Object.keys(errors).length ? error : null} />
      <section className="form-section">
        <span className="field-label">Reason</span>
        <div className="seg seg-stack" role="radiogroup" aria-label="Reason">
          {ADJUST_REASONS.map((r) => <label key={r}><input type="radio" name="adj" checked={reason === r} onChange={() => setReason(r)} /><span>{r}{r === 'Found' ? ' (adds stock)' : ''}</span></label>)}
        </div>
        {errors.reason && <span className="field-error">{errors.reason}</span>}
        <Field label={`How Many ${p.unit}s ${comesIn ? 'Found' : 'Out'}`} error={errors.qty}>{(a) => <input {...a} value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" style={{ maxWidth: 160 }} />}</Field>
        <Field label="Note" optional={!['Lost or Missing', 'Correction'].includes(reason)} error={errors.note}>{(a) => <input {...a} value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="e.g. vial dropped during vaccination" />}</Field>
      </section>
    </Panel>
  )
}

// One product: stock, batches, what uses it, and its movements. Opens Receive, Adjust and Edit.
function ProductPanel({ id, categories, onClose, onChanged }) {
  const { data, error, setData } = useApi(`inventory/${id}`)
  const p = data?.product
  const [sub, setSub] = useState(null)
  const toast = useToast()
  const owner = canManage(useStaff())
  const done = (product, msg) => { setSub(null); setData({ product }); toast(msg); onChanged() }
  // One panel at a time: Edit, Receive and Adjust replace this one and come back to it.
  if (sub === 'edit') return <ProductForm product={p} categories={categories} onClose={() => setSub(null)} onDone={done} />
  if (sub === 'receive') return <ReceivePanel product={p} onClose={() => setSub(null)} onDone={done} />
  if (sub === 'adjust') return <AdjustPanel product={p} onClose={() => setSub(null)} onDone={done} />
  return (
    <>
      <Panel title={p ? p.name : 'Product'} intro={p ? `${p.category || 'Other'} · counted in ${p.unit}s${p.packSize ? ` · ${p.packSize} per ${p.packName || 'pack'}` : ''}` : ''} onClose={onClose}
        footer={p && <>
          {owner && <button type="button" className="btn btn-quiet" onClick={() => setSub('edit')}><Pencil aria-hidden /> Edit</button>}
          <button type="button" className="btn btn-quiet" onClick={() => setSub('adjust')}><SlidersHorizontal aria-hidden /> Adjust</button>
          <button type="button" className="btn" onClick={() => setSub('receive')}><ArrowDownToLine aria-hidden /> Receive Stock</button>
        </>}>
        <ErrorNote error={error} />
        {!p ? <PawLoader small /> : (
          <>
            <div className="facts inv-facts">
              <div className="fact"><span className="label">On Hand</span><span className="fact-value">{p.countedAt ? qtyText(p.onHand, p.unit) : 'Not counted yet'}</span></div>
              <div className="fact"><span className="label">Price</span><span className="fact-value">{peso(p.price)}</span></div>
              <div className="fact"><span className="label">Cost</span><span className="fact-value">{peso(p.cost)}</span></div>
              <div className="fact"><span className="label">Reorder At</span><span className="fact-value">{p.reorderLevel ?? '—'}</span></div>
            </div>
            {p.batches.length > 0 && (
              <section className="form-section">
                <h3 className="label">On the Shelf</h3>
                <ul className="mini-list">{p.batches.map((b) => <li key={b.id}>{qtyText(b.remaining, p.unit)} · {b.expiry ? `expires ${prettyDay(b.expiry)}` : 'no expiry date'}{b.batchNo && !b.batchNo.startsWith('COUNT-') ? ` · lot ${b.batchNo}` : ''}</li>)}</ul>
              </section>
            )}
            {p.usedBy.length > 0 && (
              <section className="form-section">
                <h3 className="label">Used by Services</h3>
                <ul className="mini-list">{p.usedBy.map((u, i) => <li key={i}>{u.service}{u.variation ? ` · ${u.variation}` : ''}: {qtyText(u.qty, p.unit)}</li>)}</ul>
              </section>
            )}
            <section className="form-section">
              <h3 className="label">Stock Movements</h3>
              {p.movements.length ? (
                <ul className="move-list">
                  {p.movements.map((m) => (
                    <li key={m.id}>
                      <MovementWhy m={m} />
                      <span className="move-num"><Change qty={m.qty} /><span className="cell-sub">left {Number(m.balance).toLocaleString('en-PH', { maximumFractionDigits: 3 })}</span></span>
                      <span className="cell-sub move-when">{prettyDay(new Date(Date.parse(m.at) + 8 * 3600e3).toISOString().slice(0, 10))} {clockTime(m.at)} · {m.by || '—'}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="field-hint" style={{ margin: 0 }}>No movements yet. The first stock count sets the opening stock.</p>}
            </section>
          </>
        )}
      </Panel>
    </>
  )
}

export default function InventoryPage() {
  const [params, setParams] = useSearchParams()
  const filter = params.get('filter') || ''
  const category = params.get('category') || ''
  const [text, setText] = useState('')
  const q = useDebounced(text.trim())
  const { data, error, loading, reload } = useApi(`inventory${query({ q, filter, category })}`)
  const [open, setOpen] = useState(null)
  const [adding, setAdding] = useState(false)
  const [selling, setSelling] = useState(false)
  const toast = useToast()
  const owner = canManage(useStaff())
  const update = (patch) => setParams((p) => { const n = new URLSearchParams(p); Object.entries(patch).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k))); return n }, { replace: true })
  const s = data?.summary
  useEffect(() => { const id = Number(params.get('product')); if (id) setOpen(id) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const cats = useMemo(() => data?.categories || [], [data])
  return (
    <>
      <PageHead crumbs={[{ label: 'Inventory' }, { label: 'Product List' }]} title="Product List" intro="Stock on hand, updated by every paid visit, sale, delivery and count.">
        <div className="head-actions">
          <button type="button" className="btn btn-quiet" onClick={() => setSelling(true)}><ShoppingBag aria-hidden /> Sell Items</button>
          {owner && <button type="button" className="btn btn-quiet" onClick={() => setAdding(true)}><Plus aria-hidden /> Add Product</button>}
          <Link className="btn" to="/inventory/counts"><ClipboardList aria-hidden /> Stock Count</Link>
        </div>
      </PageHead>
      {s && !s.lastCount && (
        <div className="alert" role="note" style={{ marginBottom: 16 }}>
          <ClipboardList aria-hidden />
          <span><strong>Start with a baseline count.</strong> The old system's numbers aren't trusted, so nothing is in stock here until the shelves are counted once. {s.openCount ? <Link to={`/inventory/counts/${s.openCount.id}`}>Continue the count</Link> : <Link to="/inventory/counts">Open Stock Count</Link>}.</span>
        </div>
      )}
      <div className="stat-grid inv-stats">
        <div className="card stat"><div className="stat-top"><span className="label">Stock Value at Cost</span><Package aria-hidden /></div><div className="stat-value">{s ? peso(s.value) : '…'}</div><span className="stat-note">{s ? `${s.products} products` : ''}</span></div>
        <button type="button" className="card stat stat-btn" onClick={() => update({ filter: 'low' })}><div className="stat-top"><span className="label">Low or Out</span><PackagePlus aria-hidden /></div><div className="stat-value">{s ? s.low + s.out : '…'}</div><span className="stat-note">{s ? `${s.out} out of stock` : ''}</span></button>
        <button type="button" className="card stat stat-btn" onClick={() => update({ filter: 'expiring' })}><div className="stat-top"><span className="label">Expiring in 60 Days</span><ArrowDownToLine aria-hidden /></div><div className="stat-value">{s ? s.expiring : '…'}</div><span className="stat-note">Use these first</span></button>
        <Link className="card stat stat-btn" to="/inventory/counts"><div className="stat-top"><span className="label">Last Count</span><ClipboardList aria-hidden /></div><div className="stat-value stat-value-sm">{s?.lastCount ? prettyDay(s.lastCount.slice(0, 10)) : 'Never'}</div><span className="stat-note">{s ? `${s.uncounted} not counted yet` : ''}</span></Link>
      </div>
      <section className="card">
        <div className="toolbar">
          <div className="search">
            <Search aria-hidden />
            <label className="sr-only" htmlFor="inv-search">Search Products</label>
            <input id="inv-search" type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Search products" autoComplete="off" />
          </div>
          <label className="sr-only" htmlFor="inv-cat">Category</label>
          <select id="inv-cat" className="select" value={category} onChange={(e) => update({ category: e.target.value })}>
            <option value="">All Categories</option>
            {cats.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <div className="tabs tab-scroll" role="group" aria-label="Show">
            {FILTERS.map(([k, l]) => <button key={l} type="button" className="tab" aria-pressed={filter === k} onClick={() => update({ filter: k })}>{l}</button>)}
          </div>
        </div>
        <ErrorNote error={error} />
        {data && !data.products.length ? (
          <Empty icon={Package} title="No products here" text={q ? `Nothing matches “${q}”.` : 'Try another filter.'} />
        ) : (
          <table className="table">
            <thead><tr><th>Product</th><th className="num">On Hand</th><th className="num hide-sm">Price</th><th className="num hide-sm">Cost</th><th className="hide-sm">Nearest Expiry</th><th>Status</th></tr></thead>
            <tbody aria-busy={loading}>
              {!data && <tr className="no-hover"><td colSpan={6}><PawLoader label="Loading products…" /></td></tr>}
              {(data?.products || []).map((p) => (
                <tr key={p.id} onClick={() => setOpen(p.id)}>
                  <td><strong>{p.name}</strong><span className="cell-sub">{p.category || 'Other'} · per {p.unit}</span></td>
                  <td className="num nowrap" data-label="On Hand">{p.countedAt ? <span className={p.onHand < 0 ? 'qty-out' : undefined}>{qtyText(p.onHand, p.unit)}</span> : '—'}</td>
                  <td className="num hide-sm">{peso(p.price)}</td>
                  <td className="num hide-sm">{peso(p.cost)}</td>
                  <td className="hide-sm">{p.nearestExpiry ? <span className={p.expiringSoon ? 'qty-out' : undefined}>{prettyDay(p.nearestExpiry)}</span> : '—'}</td>
                  <td data-label="Status"><StockBadge p={p} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {open && <ProductPanel id={open} categories={cats} onClose={() => { setOpen(null); if (params.get('product')) update({ product: '' }) }} onChanged={reload} />}
      {adding && <ProductForm categories={cats} onClose={() => setAdding(false)} onDone={(p, msg) => { setAdding(false); toast(msg); reload(); setOpen(p.id) }} />}
      {selling && <SellPanel onClose={() => setSelling(false)} onDone={(msg) => { setSelling(false); toast(msg); reload() }} />}
    </>
  )
}
