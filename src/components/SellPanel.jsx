// Sell Items: an over-the-counter sale with no pet visit (shampoo, vitamins…). Paid and handed
// over, so the stock comes off at once. Who sold it is kept with the sale.
import { useMemo, useRef, useState } from 'react'
import { Minus, Plus, Search, X } from 'lucide-react'
import { ErrorNote, Field, Panel, PawLoader } from './ui.jsx'
import { api } from '../lib/api.js'
import { useApi } from '../lib/useApi.js'
import { METHOD_LABEL, peso } from './QuickAdd.jsx'

export function SellPanel({ onClose, onDone }) {
  const { data, error: loadError } = useApi('services/picker')
  const [find, setFind] = useState('')
  const [lines, setLines] = useState([]) // {product, qty}
  const [customer, setCustomer] = useState('')
  const [method, setMethod] = useState('')
  const [amount, setAmount] = useState(null)
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const box = useRef(null)
  const errors = error?.body?.errors || {}
  // Products, and services sold over the counter (e.g. Bravecto, each size), in one list.
  const catalog = useMemo(() => {
    if (!data) return []
    const out = (data.products || []).map((p) => ({ ...p, key: `p${p.id}`, kind: 'Product' }))
    for (const sv of data.services || []) {
      if (sv.variations?.length) for (const v of sv.variations) out.push({ key: `v${v.id}`, kind: 'Service', serviceId: sv.id, variationId: v.id, name: `${sv.name} · ${v.name}`, category: sv.category, price: v.price ?? sv.price, unit: 'item', onHand: null })
      else out.push({ key: `s${sv.id}`, kind: 'Service', serviceId: sv.id, name: sv.name, category: sv.category, price: sv.price, unit: 'item', onHand: null })
    }
    return out
  }, [data])
  const words = find.toLowerCase().split(/\s+/).filter(Boolean)
  const rows = useMemo(() => (words.length ? catalog.filter((p) => words.every((w) => `${p.name} ${p.category || ''}`.toLowerCase().includes(w))).slice(0, 12) : []), [catalog, find]) // eslint-disable-line react-hooks/exhaustive-deps
  const total = Math.round(lines.reduce((n, l) => n + (l.product.price || 0) * (Number(l.qty) || 0), 0) * 100) / 100
  const shown = method === 'no_charge' ? '0' : amount ?? String(total)
  const differs = method && Number(shown) !== total

  function add(p) {
    setLines((prev) => (prev.some((l) => l.product.key === p.key) ? prev.map((l) => (l.product.key === p.key ? { ...l, qty: String(Number(l.qty) + 1) } : l)) : [...prev, { product: p, qty: '1' }]))
    setFind('')
    box.current?.focus()
  }
  const setQty = (key, qty) => setLines((prev) => prev.map((l) => (l.product.key === key ? { ...l, qty } : l)))
  async function save() {
    setBusy(true)
    setError(null)
    try {
      const res = await api('sales', { method: 'POST', body: { items: lines.map((l) => (l.product.serviceId ? { serviceId: l.product.serviceId, variationId: l.product.variationId, qty: l.qty } : { productId: l.product.id, qty: l.qty })), customer, method, amount: shown, reference, note } })
      onDone(`Sold: ${res.sale.items}`)
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }
  return (
    <Panel dirty={lines.length > 0} discardTitle="Discard this sale?" title="Sell Items" intro="For items sold without a pet visit. The stock comes off when you save." onClose={onClose} busy={busy}
      footer={<><button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="btn" onClick={save} disabled={busy || !lines.length || !method}>{busy ? 'Saving…' : `Paid ${peso(Number(shown) || 0)}`}</button></>}>
      <ErrorNote error={loadError || (error && !Object.keys(errors).length ? error : null)} />
      {!data ? <PawLoader small /> : (
        <>
          <div className="sticky-search">
            <div className="search" style={{ maxWidth: 'none' }}>
              <Search aria-hidden />
              <label className="sr-only" htmlFor="sell-search">Search Products and Services</label>
              <input id="sell-search" ref={box} type="search" value={find} onChange={(e) => setFind(e.target.value)} autoComplete="off" autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter' && rows[0]) { e.preventDefault(); add(rows[0]) } }} placeholder="Search products and services, e.g. shampoo, bravecto" />
            </div>
          </div>
          {rows.length > 0 && (
            <ul className="qa-list">
              {rows.map((p) => (
                <li key={p.key}>
                  <button type="button" className="qa-row" onClick={() => add(p)}>
                    <Plus aria-hidden />
                    <span><strong>{p.name}</strong><span className="cell-sub">{[p.kind === 'Service' ? 'Service' : p.category, p.price != null && `${peso(p.price)}${p.kind === 'Service' ? '' : ` per ${p.unit}`}`, p.onHand != null && `${p.onHand} in stock`].filter(Boolean).join(' · ')}</span></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {find && !rows.length && <p className="field-hint" style={{ margin: 0 }}>Nothing matches “{find}”. An owner can add it in the Product List or Services.</p>}
          <section className="form-section">
            <h3 className="label">Items</h3>
            {!lines.length && <p className="field-hint" style={{ margin: 0 }}>Search above and tap a product or service to add it.</p>}
            {lines.map((l) => (
              <div key={l.product.key} className="sell-line">
                <span><strong>{l.product.name}</strong><span className="cell-sub">{peso(l.product.price || 0)}{l.product.kind === 'Service' ? ' each' : ` per ${l.product.unit}`}</span></span>
                <span className="stepper">
                  <button type="button" className="icon-btn" onClick={() => setQty(l.product.key, String(Math.max(1, Number(l.qty) - 1)))} aria-label="One Less"><Minus /></button>
                  <input value={l.qty} onChange={(e) => setQty(l.product.key, e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" aria-label={`${l.product.name} quantity`} />
                  <button type="button" className="icon-btn" onClick={() => setQty(l.product.key, String(Number(l.qty) + 1))} aria-label="One More"><Plus /></button>
                </span>
                <strong className="qa-price">{peso((l.product.price || 0) * (Number(l.qty) || 0))}</strong>
                <button type="button" className="icon-btn" onClick={() => setLines(lines.filter((x) => x !== l))} aria-label={`Remove ${l.product.name}`}><X /></button>
              </div>
            ))}
          </section>
          {lines.length > 0 && (
            <section className="form-section pay-box">
              <div className="pay-total"><span className="label">Total</span><strong>{peso(total)}</strong></div>
              <Field label="Customer" optional>{(a) => <input {...a} value={customer} onChange={(e) => setCustomer(e.target.value)} maxLength={80} placeholder="Name, if you'd like it on record" />}</Field>
              <div>
                <span className="field-label">Paid With</span>
                <div className="chips pay-methods" role="radiogroup" aria-label="Paid With">
                  {Object.entries(METHOD_LABEL).map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={method === k} className="choice pay-method" onClick={() => setMethod(k)}>{l}</button>)}
                </div>
              </div>
              {method && method !== 'no_charge' && (
                <div className="form-row">
                  <Field label="Amount Paid (₱)" error={errors.amount}>{(a) => <input {...a} value={shown} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" />}</Field>
                  {method !== 'cash' && <Field label="Reference No." optional>{(a) => <input {...a} value={reference} onChange={(e) => setReference(e.target.value)} maxLength={60} />}</Field>}
                </div>
              )}
              {(differs || method === 'no_charge') && <Field label={method === 'no_charge' ? 'Why No Charge' : 'Why the Amount Differs'} error={errors.note}>{(a) => <input {...a} value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />}</Field>}
            </section>
          )}
        </>
      )}
    </Panel>
  )
}
