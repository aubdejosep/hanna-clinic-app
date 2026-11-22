// Finances ▸ Receipts and Ledger: suggestions while typing a receipt's item, from Clinic Operations ▸ Services
// (each variation, e.g. "Deworm · 5.1-10 kg") and Inventory ▸ Product List, with their prices, and Smart Prescription ▸
// Medications (names only, left out when the same name is already a product or service). Picking one fills
// the item's name and, when its amount is still empty, the price; the amount can always be changed after.
// The list comes from /api/services/picker (the same one Quick Add uses), loaded once per page visit.
import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.js'

let cache = null
let loading = null
// Smart Prescription ▸ Medications (names only: no prices there), all pages.
async function medications() {
  const out = []
  for (let page = 1; page <= 30; page++) {
    const r = await api(`medications?size=100&sort=name&dir=asc&page=${page}`)
    out.push(...(r.medications || []).map((m) => m.name))
    if (out.length >= r.total || !(r.medications || []).length) break
  }
  return out
}
const listeners = new Set()
// Something added from a receipt (Add to Product List): on the list at once, on every open receipt.
export function addToCatalog(entry) {
  if (!cache) return
  cache = [entry, ...cache.filter((e) => norm(e.name) !== norm(entry.name))]
  listeners.forEach((l) => l(cache))
}
function load() {
  loading ||= Promise.all([api('services/picker'), medications().catch(() => []), api('finances/daily/typed-items').catch(() => ({ items: [] }))]).then(([d, meds, typed]) => {
    const out = []
    for (const s of d.services || []) {
      if (s.variations?.length) for (const v of s.variations) out.push({ name: `${s.name} · ${v.name}`, price: v.price || s.price || null, kind: 'Service' })
      else out.push({ name: s.name, price: s.price || null, kind: 'Service' })
    }
    for (const p of d.products || []) out.push({ name: p.name, price: p.price || null, kind: 'Product' })
    // A medication already on the Product List or Services (same name, ignoring case and spaces) isn't listed twice.
    const have = new Set([...(d.products || []).map((p) => norm(p.name)), ...(d.services || []).map((x) => norm(x.name))])
    for (const name of meds) if (name && !have.has(norm(name))) { have.add(norm(name)); out.push({ name: name.trim(), price: null, kind: 'Medication' }) }
    // Items typed on receipts before (not on any list), with the price used last time.
    for (const t of typed.items || []) if (t.name && !have.has(norm(t.name))) { have.add(norm(t.name)); out.push({ name: t.name, price: t.priceCents == null ? null : t.priceCents / 100, kind: 'Typed Before' }) }
    cache = out
    return out
  }).catch(() => { loading = null; return null })
  return loading
}
export function useCatalog() {
  const [list, setList] = useState(cache)
  useEffect(() => {
    if (!cache) load().then((l) => l && setList(l))
    listeners.add(setList)
    return () => listeners.delete(setList)
  }, [])
  return list
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
// Every typed word must appear; names starting with what's typed come first.
export function suggestions(list, text, max = 8) {
  const q = norm(text)
  if (!list || q.length < 2) return []
  const words = q.split(' ')
  return list.map((e, i) => ({ e, i, n: norm(e.name) }))
    .filter(({ n }) => words.every((w) => n.includes(w)) && n !== q)
    .sort((a, b) => (b.n.startsWith(q) - a.n.startsWith(q)) || (b.n.split(' ').some((w) => w.startsWith(words[0])) - a.n.split(' ').some((w) => w.startsWith(words[0]))) || a.i - b.i)
    .slice(0, max).map(({ e }) => e)
}

const peso = (n) => `₱${Number(n).toLocaleString('en-PH', { maximumFractionDigits: 2 })}`

// The suggestion list under an input. It's fixed to the screen (so a scrolling table doesn't cut it off).
// keys(e) handles ArrowUp/ArrowDown/Enter/Escape while the list is open and returns true if it used the key.
// When nothing matches (3+ letters, not already on the list): "Add to Product List" (with its price: it's on the list
// next time) or "Just This Once" (it's still suggested next time, as Typed Before, at the price used).
export function useSuggest({ text, onPick, active, price }) {
  const list = useCatalog()
  const [at, setAt] = useState(0)
  const [closed, setClosed] = useState(false)
  const [adding, setAdding] = useState(null) // {name, price, busy, error}
  const anchor = useRef(null)
  const items = active && !closed ? suggestions(list, text) : []
  const typed = String(text || '').trim()
  const known = !list || list.some((e) => norm(e.name) === norm(typed))
  const offer = active && !closed && !adding && list && !items.length && typed.length >= 3 && !known
  useEffect(() => { setAt(0); setClosed(false) }, [text])
  async function addProduct() {
    const cents = String(adding.price).trim() === '' ? null : Math.round(Number(String(adding.price).replace(/[₱,\s]/g, '')) * 100)
    if (cents != null && !(cents >= 0)) { setAdding({ ...adding, error: 'Enter the price as a number, e.g. 15.' }); return }
    setAdding({ ...adding, busy: true, error: null })
    try {
      const r = await api('finances/daily/quick-product', { method: 'POST', body: { name: adding.name, priceCents: cents } })
      const entry = { name: r.product.name, price: r.product.price, kind: 'Product' }
      addToCatalog(entry)
      setAdding(null); setClosed(true); onPick(entry)
    } catch (err) { setAdding({ ...adding, busy: false, error: err.message }) }
  }
  const pick = (e) => { setClosed(true); onPick(e) }
  const keys = (ev) => {
    if (!items.length) return false
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); setAt((i) => (i + (ev.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length); return true }
    if (ev.key === 'Enter' || ev.key === 'Tab') { if (ev.key === 'Enter') ev.preventDefault(); pick(items[at]); return ev.key === 'Enter' }
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); setClosed(true); return true }
    return false
  }
  const rect = (items.length || offer || adding) && anchor.current ? anchor.current.getBoundingClientRect() : null
  const style = rect ? { top: rect.bottom + 2, left: rect.left, minWidth: Math.max(rect.width, 300) } : null
  if (rect && (offer || adding)) {
    return { anchor, keys: (ev) => { if (ev.key === 'Escape' && (offer || adding)) { ev.preventDefault(); ev.stopPropagation(); setAdding(null); setClosed(true); return true } return false }, open: true, popup: (
      <div className="sg-list sg-new" style={style} onMouseDown={(e) => { if (e.target.tagName !== 'INPUT') e.preventDefault() }}>
        {!adding ? (
          <>
            <p><b>“{typed}”</b> isn’t on the list.</p>
            <div className="sg-new-actions">
              <button type="button" className="btn btn-sm" onClick={() => setAdding({ name: typed, price: price ?? '' })}>Add to Product List</button>
              <button type="button" className="btn btn-sm btn-quiet" onClick={() => setClosed(true)}>Just This Once</button>
            </div>
            <span className="cell-sub">Either way, it’s suggested next time with the price you type.</span>
          </>
        ) : (
          <>
            <p>Add <b>{adding.name}</b> to the Product List</p>
            <label className="sg-new-price"><span>Price (₱)</span>
              <input autoFocus inputMode="decimal" value={adding.price} onChange={(e) => setAdding({ ...adding, price: e.target.value })} placeholder="e.g. 15"
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addProduct() } if (e.key === 'Escape') { e.preventDefault(); setAdding(null); setClosed(true) } }} /></label>
            {adding.error && <span className="field-error">{adding.error}</span>}
            <div className="sg-new-actions">
              <button type="button" className="btn btn-sm" onClick={addProduct} disabled={adding.busy}>{adding.busy ? 'Adding…' : 'Add Product'}</button>
              <button type="button" className="btn btn-sm btn-quiet" onClick={() => { setAdding(null); setClosed(true) }} disabled={adding.busy}>Cancel</button>
            </div>
            <span className="cell-sub">An owner can finish it later in Inventory ▸ Product List.</span>
          </>
        )}
      </div>
    ) }
  }
  const popup = rect && items.length > 0 && (
    <ul className="sg-list" role="listbox" style={style} onMouseDown={(e) => e.preventDefault()}>
      {items.map((e, i) => (
        <li key={`${e.kind}-${e.name}`} role="option" aria-selected={i === at} className={i === at ? 'is-on' : ''} onMouseEnter={() => setAt(i)} onClick={() => pick(e)}>
          <span className="sg-name">{e.name}</span>
          <span className="sg-kind">{e.kind}</span>
          <span className="sg-price">{e.price != null ? peso(e.price) : e.kind === 'Medication' ? '' : 'No price'}</span>
        </li>
      ))}
    </ul>
  )
  return { anchor, keys, popup, open: items.length > 0 }
}
