import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, History, ListChecks, Pill, Plus, Scale, Search, Sparkles, Stethoscope, X } from 'lucide-react'
import { ErrorNote, Field, Panel, PawLoader } from './ui.jsx'
import { api } from '../lib/api.js'
import { useApi } from '../lib/useApi.js'
import { prettyDay } from '../lib/format.js'
import { sizeFor, sizeOptions } from '../../lib/sizing.js'

// Quick Add: one search for services and medicines, suggestions learned from the clinic's own
// visits ("usually goes with"), Same as Last Visit, and sizes picked from the pet's weight.
// An item: {serviceId, variationId} | {productId, name, detail, qty, kind: 'product'} | {name, detail, kind}.

export const peso = (n) => `₱${Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
const norm = (s) => String(s || '').trim().toLowerCase()
const SPECIES_WORD = { dog: 'Dogs', cat: 'Cats' }
const OTHER_SPECIES = { dog: /\bcats?\b/i, cat: /\bdogs?\b/i }

export function sameItem(a, b) {
  if (a.serviceId || b.serviceId) return a.serviceId === b.serviceId && (a.variationId || null) === (b.variationId || null)
  if (a.productId || b.productId) return a.productId === b.productId
  return norm(a.name) === norm(b.name) && (a.kind || 'custom') === (b.kind || 'custom')
}

// Everything the screen needs to turn names, keys and weights into items.
function useCatalog(data) {
  return useMemo(() => {
    if (!data) return null
    const services = data.services || []
    const sById = Object.fromEntries(services.map((s) => [s.id, s]))
    const sByName = {}
    const vById = {}
    for (const s of services) {
      sByName[norm(s.name)] ||= s
      for (const v of s.variations) vById[v.id] = { s, v }
    }
    const pById = Object.fromEntries((data.products || []).map((p) => [p.id, p]))
    const pByName = Object.fromEntries((data.products || []).map((p) => [norm(p.name), p]))
    const sized = new Set(services.filter((s) => sizeOptions(s)).map((s) => s.id))
    return { services, products: data.products || [], sById, sByName, vById, pById, pByName, sized }
  }, [data])
}

function labelOf(c, it) {
  if (it.serviceId) {
    const s = c.sById[it.serviceId]
    const v = it.variationId ? c.vById[it.variationId]?.v : null
    return `${s?.name || it.name}${v ? ` · ${v.name}` : ''}`
  }
  return `${it.name}${it.detail ? ` · ${it.detail}` : ''}${it.qty > 1 ? ` × ${it.qty}` : ''}`
}

// A service item, sized from the weight when the service goes by weight.
function serviceItem(c, s, variationId, weight, species) {
  if (c.sized.has(s.id)) {
    const auto = sizeFor(s, weight, species)
    if (auto !== undefined) return { serviceId: s.id, variationId: auto, auto: true }
    return { serviceId: s.id, variationId: variationId ?? null, needsSize: variationId == null }
  }
  return { serviceId: s.id, variationId: variationId ?? null }
}

// Price from the lists: a service at its size's price, a product per unit × quantity.
function priceOf(c, it) {
  if (it.serviceId) return (it.variationId ? c.vById[it.variationId]?.v.price : c.sById[it.serviceId]?.price) || 0
  if (it.productId) return (c.pById[it.productId]?.price || 0) * (it.qty || 1)
  return 0
}
const unitWord = (unit, n) => (unit ? `${unit}${n === 1 || ['ml'].includes(unit) ? '' : unit === 'box' ? 'es' : 's'}` : '')

// The key used by the server's cohorts (lib/catalog.js) for an item, and back.
function keyOf(c, it) {
  if (it.productId) return `p:${it.productId}`
  const s = it.serviceId ? c.sById[it.serviceId] : c.sByName[norm(it.name)]
  if (!s) return it.kind === 'product' && c.pByName[norm(it.name)] ? `p:${c.pByName[norm(it.name)].id}` : null
  if (c.sized.has(s.id)) return `s:${s.id}`
  const vid = it.serviceId ? it.variationId : s.variations.find((v) => norm(v.name) === norm(it.detail))?.id
  return vid ? `v:${vid}` : `s:${s.id}`
}
function fromKey(c, key, weight, species) {
  const [t, raw] = key.split(':')
  const id = Number(raw)
  if (t === 'p') return c.pById[id] ? { productId: id, name: c.pById[id].name, kind: 'product', qty: 1 } : null
  if (t === 'v') return c.vById[id] ? serviceItem(c, c.vById[id].s, id, weight, species) : null
  return c.sById[id] ? serviceItem(c, c.sById[id], null, weight, species) : null
}
// A past item (Same as Last Visit) -> today's item: on the lists when it can be, re-sized for today's weight.
function fromPast(c, it, weight, species) {
  const key = keyOf(c, it.serviceId ? { ...it } : it)
  if (key) {
    const item = fromKey(c, key, weight, species)
    if (item?.productId) return { ...item, detail: it.detail || '', qty: it.qty || 1 }
    if (item?.needsSize) { // no weight today: keep last visit's size
      const s = c.sById[item.serviceId]
      const v = s.variations.find((x) => x.id === it.variationId || norm(x.name) === norm(it.detail))
      if (v) return { serviceId: s.id, variationId: v.id }
    }
    if (item) return item
  }
  return { name: it.name, detail: it.detail || '', kind: it.kind === 'product' ? 'product' : 'custom', qty: it.qty || 1 }
}

// Search rows: a sized service is one row (size from weight); other services list each variation.
function searchRows(c, find, species, rank) {
  const words = norm(find).split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const rows = []
  for (const s of c.services) {
    if (c.sized.has(s.id) || !s.variations.length) rows.push({ type: 'service', s, v: null, text: [s.name, s.category, s.description, ...s.variations.map((v) => v.name)].join(' ') })
    else for (const v of s.variations) rows.push({ type: 'service', s, v, text: [s.name, v.name, s.category].join(' ') })
  }
  for (const p of c.products) rows.push({ type: 'product', p, text: [p.name, p.category].join(' ') })
  const scored = []
  for (const r of rows) {
    const t = r.text.toLowerCase()
    if (!words.every((w) => t.includes(w))) continue
    const main = (r.type === 'product' ? r.p.name : r.v ? `${r.v.name} ${r.s.name}` : r.s.name).toLowerCase()
    let score = 0
    if (main.startsWith(words[0])) score += 4
    else if (main.split(/[\s·-]+/).some((w) => w.startsWith(words[0]))) score += 2
    const key = r.type === 'product' ? `p:${r.p.id}` : r.v ? `v:${r.v.id}` : `s:${r.s.id}`
    if (rank[key] !== undefined) score += 3 - Math.min(3, rank[key] / 3)
    if (species && OTHER_SPECIES[species]?.test(r.type === 'product' ? r.p.name : `${r.s.name} ${r.v?.name || ''}`)) score -= 5
    scored.push({ ...r, key, score })
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, 14)
}

export function ServicePicker({ items, setItems, products, petId, appointmentId, existing = [], onWeightSaved, onTotal }) {
  const { data, error } = useApi(`services/picker${appointmentId ? `?appointmentId=${appointmentId}` : petId ? `?petId=${petId}` : ''}`)
  const c = useCatalog(data)
  const pet = data?.pet || null
  const species = pet?.species
  const [typedKg, setTypedKg] = useState('')
  const weight = Number(typedKg) > 0 ? Number(typedKg) : pet?.weightKg ?? null
  const [find, setFind] = useState('')
  const box = useRef(null)
  const cohort = data?.cohorts?.[species] || null
  const rank = useMemo(() => Object.fromEntries((cohort?.popular || []).map((k, i) => [k, i])), [cohort])

  // A weight typed here sizes what's already picked (only items sized automatically or not yet sized).
  useEffect(() => {
    if (!c || !(weight > 0)) return
    setItems((prev) => prev.map((it) => (it.serviceId && (it.auto || it.needsSize) ? serviceItem(c, c.sById[it.serviceId], null, weight, species) : it)))
  }, [weight, c]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (c) onTotal?.(items.reduce((n, it) => n + priceOf(c, it), 0)) }, [items, c]) // eslint-disable-line react-hooks/exhaustive-deps

  const has = (it) => items.some((x) => sameItem(x, it)) || existing.some((x) => sameItem(x, it))
  const add = (list) => setItems((prev) => [...prev, ...list.filter((it) => it && !prev.some((x) => sameItem(x, it)) && !existing.some((x) => sameItem(x, it)))])
  const toggle = (it) => setItems((prev) => (prev.some((x) => sameItem(x, it)) ? prev.filter((x) => !sameItem(x, it)) : [...prev, it]))
  const update = (n, patch) => setItems((prev) => prev.map((x, k) => (k === n ? { ...x, ...patch } : x)))

  // What usually goes with what's picked (and already on the visit); before anything is picked, the most used.
  const suggestions = useMemo(() => {
    if (!c) return { title: '', list: [] }
    const base = [...existing, ...items].map((it) => keyOf(c, it)).filter(Boolean)
    const have = new Set(base)
    const score = {}
    for (const k of base) for (const [b, pct] of cohort?.goesWith?.[k] || []) if (!have.has(b)) score[b] = Math.max(score[b] || 0, pct)
    let keys = Object.entries(score).sort((a, b) => b[1] - a[1]).map(([k]) => k)
    let title = base.length ? 'Usually Goes With These' : ''
    if (!keys.length && !base.length) {
      keys = (cohort?.popular || data?.cohorts?.dog?.popular || []).filter((k) => !have.has(k))
      title = species ? `Most Used for ${SPECIES_WORD[species] || 'Pets'}` : 'Most Used'
    }
    const list = keys.map((k) => ({ key: k, item: fromKey(c, k, weight, species), pct: score[k] })).filter((x) => x.item && (products || !x.item.productId)).slice(0, 6)
    return { title, list }
  }, [c, cohort, items, existing, weight, species, products, data])

  const lastItems = useMemo(() => (c && pet?.lastVisit ? pet.lastVisit.items.map((it) => fromPast(c, it, weight, species)).filter((it) => products || !(it.productId || it.kind === 'product')) : []), [c, pet, weight, species, products])
  const lastMissing = lastItems.filter((it) => !has(it))
  const rows = useMemo(() => (c ? searchRows(c, find, species, rank).filter((r) => products || r.type !== 'product') : []), [c, find, species, rank, products])

  function pickRow(r) {
    if (r.type === 'product') toggle({ productId: r.p.id, name: r.p.name, kind: 'product', qty: 1, detail: '' })
    else toggle(serviceItem(c, r.s, r.v?.id ?? null, weight, species))
  }
  function onSearchKey(e) {
    if (e.key === 'Enter' && rows.length) {
      e.preventDefault()
      pickRow(rows[0])
      setFind('')
    }
  }
  function addTyped(kind) {
    const name = find.trim().slice(0, 60)
    if (!name) return
    add([{ name, detail: '', kind, qty: 1 }])
    setFind('')
    box.current?.focus()
  }
  async function saveWeight() {
    const kg = Number(typedKg)
    if (!appointmentId || !(kg > 0)) return
    try {
      const res = await api(`appointments/${appointmentId}`, { method: 'PATCH', body: { weightKg: kg } })
      onWeightSaved?.(res.appointment)
    } catch { /* the weight still sizes the picks; it can be saved on the appointment page */ }
  }

  // On a computer the search is ready to type in; on a phone the keyboard would hide the suggestions.
  const ready = !!c
  useEffect(() => { if (ready && window.matchMedia('(min-width: 861px)').matches) setTimeout(() => box.current?.focus(), 50) }, [ready])

  if (error) return <ErrorNote error={error} />
  if (!c) return <PawLoader small label="Loading services…" />
  const details = items.map((it, n) => [it, n]).filter(([it]) => it.kind === 'product' || it.needsSize)
  const sizedPicked = items.some((it) => it.serviceId && c.sized.has(it.serviceId))
  return (
    <div className="stack qa" style={{ gap: 14 }}>
      <div className="sticky-search">
        {items.length > 0 && (
          <div className="chips" aria-label="Picked">
            {items.map((it, n) => (
              <span key={n} className={`chip ${it.needsSize ? 'chip-warn' : ''}`}>{labelOf(c, it)}{it.needsSize && ' · choose size'}
                <button type="button" className="chip-x" onClick={() => setItems(items.filter((_, k) => k !== n))} aria-label={`Remove ${labelOf(c, it)}`}><X /></button>
              </span>
            ))}
          </div>
        )}
        <div className="search" style={{ maxWidth: 'none' }}>
          <Search aria-hidden />
          <label className="sr-only" htmlFor="qa-search">{products ? 'Search Services and Medicines' : 'Search Services'}</label>
          <input id="qa-search" ref={box} type="search" value={find} onChange={(e) => setFind(e.target.value)} onKeyDown={onSearchKey} autoComplete="off"
            placeholder={products ? 'Search services and medicines, e.g. rabies, liv 52' : 'Search services, e.g. rabies or dental'} />
        </div>
      </div>

      {pet && (
        <div className="qa-weight">
          <Scale aria-hidden />
          {pet.weightKg != null && !typedKg ? (
            <span>Sizes picked for <strong>{pet.weightKg} kg</strong>{appointmentId ? '' : ` (${pet.name}'s latest weight)`}.{' '}
              <button type="button" className="text-btn" onClick={() => setTypedKg(String(pet.weightKg))}>Change Weight</button></span>
          ) : (
            <span className="qa-weight-field">
              <label htmlFor="qa-kg">{pet.weightKg == null && !typedKg ? `No weight yet. Weigh ${pet.name} to pick sizes automatically:` : 'Weight today:'}</label>
              <span className="qa-kg">
                <input id="qa-kg" value={typedKg} onChange={(e) => setTypedKg(e.target.value.replace(/[^\d.]/g, '').slice(0, 5))} onBlur={saveWeight} inputMode="decimal" placeholder="e.g. 4.5" />
                <span>kg</span>
              </span>
              {appointmentId && <span className="cell-sub">Saves to the visit</span>}
            </span>
          )}
        </div>
      )}

      {find ? (
        <section className="form-section qa-results" aria-label="Search results">
          {rows.length > 0 && (
            <ul className="qa-list">
              {rows.map((r) => {
                const it = r.type === 'product' ? { productId: r.p.id } : serviceItem(c, r.s, r.v?.id ?? null, weight, species)
                const on = r.type === 'product' ? items.some((x) => x.productId === r.p.id) : items.some((x) => x.serviceId === r.s.id && (!r.v || x.variationId === r.v.id))
                const sizedHint = r.type === 'service' && c.sized.has(r.s.id) ? (it.variationId ? c.vById[it.variationId]?.v.name : it.auto ? 'Base size' : 'Size from weight') : null
                return (
                  <li key={r.key}>
                    <button type="button" className="qa-row" aria-pressed={on} onClick={() => pickRow(r)}>
                      {r.type === 'product' ? <Pill aria-hidden /> : <Stethoscope aria-hidden />}
                      <span>
                        <strong>{r.type === 'product' ? r.p.name : r.v ? `${r.s.name} · ${r.v.name}` : r.s.name}</strong>
                        <span className="cell-sub">{r.type === 'product' ? [r.p.category, r.p.price != null && `${peso(r.p.price)} per ${r.p.unit}`, r.p.onHand != null && `${r.p.onHand} ${unitWord(r.p.unit, r.p.onHand)} in stock`].filter(Boolean).join(' · ') : [sizedHint && weight ? `${sizedHint} for ${weight} kg` : sizedHint, r.s.category, peso(r.v ? r.v.price : r.s.price)].filter(Boolean).join(' · ')}</span>
                      </span>
                      {on ? <Check className="qa-tick" aria-hidden /> : <Plus className="qa-plus" aria-hidden />}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          <p className="field-hint" style={{ margin: 0 }}>{rows.length ? <>Press <kbd>Enter</kbd> to add the top one.</> : <>Nothing on the lists matches “{find}”.</>}</p>
          <div className="inline-row">
            {products && <button type="button" className="btn btn-quiet" onClick={() => addTyped('product')}><Plus aria-hidden /> Add “{find.trim()}” as Medicine</button>}
            <button type="button" className="btn btn-quiet" onClick={() => addTyped('custom')}><Plus aria-hidden /> Add as Other Service</button>
          </div>
        </section>
      ) : (
        <>
          {lastMissing.length > 0 && (
            <button type="button" className="qa-repeat" onClick={() => add(lastItems)}>
              <History aria-hidden />
              <span>
                <strong>Same as Last Visit</strong>
                <span className="cell-sub">{prettyDay(pet.lastVisit.day)}: {lastItems.map((it) => labelOf(c, it)).join(', ')}</span>
              </span>
              <Plus className="qa-plus" aria-hidden />
            </button>
          )}
          {suggestions.list.length > 0 && (
            <section className="form-section popular">
              <h3 className="label"><Sparkles size={13} aria-hidden /> {suggestions.title}</h3>
              <div className="choice-grid">
                {suggestions.list.map(({ key, item, pct }) => (
                  <button key={key} type="button" className="choice" aria-pressed={items.some((x) => sameItem(x, item))} onClick={() => toggle(item)}>
                    <strong>{labelOf(c, item)}</strong>
                    <span className="cell-sub">{item.productId ? c.pById[item.productId]?.category : pct ? `On ${pct}% of these visits` : item.auto ? `Sized for ${weight} kg` : peso(item.variationId ? c.vById[item.variationId]?.v.price : c.sById[item.serviceId]?.price)}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {details.length > 0 && (
        <section className="form-section">
          <h3 className="label">Details</h3>
          {details.map(([it, n]) => it.needsSize ? (
            <SizeChoice key={n} c={c} it={it} onPick={(variationId) => update(n, { variationId, needsSize: false })} />
          ) : (
            <div key={n} className="qa-med">
              <strong>{it.name}</strong>
              <Field label="Dose or Instructions" optional>{(a) => <input {...a} value={it.detail || ''} onChange={(e) => update(n, { detail: e.target.value.slice(0, 80) })} placeholder="e.g. ½ tab twice a day, 3 days" />}</Field>
              <Field label={`Quantity${c.pById[it.productId]?.unit ? ` (${unitWord(c.pById[it.productId].unit, 2)})` : ''}`}>{(a) => <input {...a} value={it.qty || 1} onChange={(e) => update(n, { qty: Math.max(1, Math.min(99, Number(e.target.value.replace(/[^\d]/g, '')) || 1)) })} inputMode="numeric" style={{ width: 72 }} />}</Field>
            </div>
          ))}
        </section>
      )}

      {!find && (
        <details className="form-section qa-all" open={!products && !items.length && !suggestions.list.length}>
          <summary><strong>All Services</strong> <span className="cell-sub">{c.services.length} on the price list</span></summary>
          <div className="svc-grid">
            {c.services.map((s) => <ServiceCard key={s.id} s={s} items={items} existing={existing} toggle={toggle} quick={c.sized.has(s.id) && weight > 0 ? serviceItem(c, s, null, weight, species) : null} c={c} weight={weight} />)}
          </div>
        </details>
      )}
      {!find && products && c.products.length > 0 && <ProductBrowser c={c} items={items} toggle={toggle} />}
      {sizedPicked && !(weight > 0) && <p className="field-hint" style={{ margin: 0 }}>Doses go by weight: enter the weight above and the sizes are picked for you.</p>}
    </div>
  )
}

function SizeChoice({ c, it, onPick }) {
  const s = c.sById[it.serviceId]
  return (
    <div className="qa-size">
      <strong>{s.name}</strong>
      <div className="chips" role="group" aria-label={`${s.name} size`}>
        {[...(sizeOptions(s) || [])].map((o) => (
          <button key={o.variationId || 'base'} type="button" className="choice qa-size-btn" onClick={() => onPick(o.variationId)}>
            {o.variationId ? c.vById[o.variationId].v.name : s.name}
          </button>
        ))}
      </div>
    </div>
  )
}

function ProductBrowser({ c, items, toggle }) {
  const groups = useMemo(() => {
    const g = {}
    for (const p of c.products) (g[p.category || 'Other'] ||= []).push(p)
    return Object.entries(g).sort((a, b) => b[1].length - a[1].length)
  }, [c])
  const [cat, setCat] = useState(groups[0]?.[0] || '')
  const list = groups.find(([k]) => k === cat)?.[1] || []
  return (
    <details className="form-section qa-all">
      <summary><strong>All Medicines &amp; Products</strong> <span className="cell-sub">{c.products.length} on the list</span></summary>
      <div className="tabs tab-scroll" role="group" aria-label="Category">
        {groups.map(([k, l]) => <button key={k} type="button" className="tab" aria-pressed={cat === k} onClick={() => setCat(k)}>{k}<span className="tab-count">{l.length}</span></button>)}
      </div>
      <div className="choice-grid">
        {list.map((p) => (
          <button key={p.id} type="button" className="choice" aria-pressed={items.some((x) => x.productId === p.id)} onClick={() => toggle({ productId: p.id, name: p.name, kind: 'product', qty: 1, detail: '' })}>
            <strong>{p.name}</strong>
          </button>
        ))}
      </div>
    </details>
  )
}

// One service, like the old picker: the circle picks the service itself (base price); a service with
// variations has "Choose variations", a list with search, All and a checkbox per variation.
// A service sized by weight also offers its size for this pet in one tap.
function ServiceCard({ s, items, existing, toggle, quick, c, weight }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const box = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey, true) }
  }, [open])
  const has = (v) => items.some((i) => i.serviceId === s.id && (i.variationId || null) === (v?.id || null))
  const onVisit = (v) => existing.some((i) => i.serviceId === s.id && (i.variationId || null) === (v?.id || null))
  const pick = (v) => toggle({ serviceId: s.id, variationId: v?.id || null })
  const picked = s.variations.filter((v) => has(v))
  const listed = s.variations.filter((v) => v.name.toLowerCase().includes(q.trim().toLowerCase()))
  const allOn = listed.length > 0 && listed.every((v) => has(v))
  const setAll = () => listed.forEach((v) => { if (has(v) === allOn) pick(v) })
  const quickOn = quick && items.some((i) => sameItem(i, quick))
  return (
    <div className={`svc-card ${has(null) || picked.length ? 'is-picked' : ''}`}>
      <div className="svc-card-head">
        <div>
          <strong>{s.name}</strong>
          <span className="badge badge-soft svc-cat">{s.category}</span>
        </div>
        <button type="button" className="svc-radio" role="checkbox" aria-checked={has(null)} onClick={() => pick(null)}
          aria-label={`${s.name}${s.variations.length ? ' (base price)' : ''} ${peso(s.price)}`} title={`${s.variations.length ? 'Base price' : 'Pick'}: ${peso(s.price)}`}>
          {has(null) && <Check aria-hidden />}
        </button>
      </div>
      {s.description && <p className="svc-desc">{s.description}</p>}
      {quick && (
        <button type="button" className="choice qa-quick" aria-pressed={quickOn} onClick={() => toggle(quick)}>
          <strong>For {weight} kg: {quick.variationId ? c.vById[quick.variationId].v.name : s.name}</strong>
        </button>
      )}
      {(onVisit(null) || s.variations.some(onVisit)) && <span className="cell-sub">Already on this visit</span>}
      <div className="svc-foot">
        {s.variations.length ? (
          <div className="svc-vars" ref={box}>
            <span className="cell-sub">Select Variations (Multiple allowed)</span>
            <button type="button" className="svc-select" onClick={() => setOpen(!open)} aria-expanded={open}>
              <span>{picked.length ? picked.map((v) => v.name).join(', ') : 'Choose variations'}</span>
              <ChevronDown aria-hidden />
            </button>
            {open && (
              <div className="svc-pop card" role="listbox" aria-multiselectable="true" aria-label={`${s.name} variations`}>
                {s.variations.length > 5 && (
                  <div className="search svc-pop-search"><Search aria-hidden /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" aria-label="Search variations" autoFocus /></div>
                )}
                <label className="svc-opt svc-all"><input type="checkbox" checked={allOn} onChange={setAll} /> <span>All</span> <span className="cell-sub">({listed.length})</span></label>
                {listed.map((v) => (
                  <label key={v.id} className="svc-opt"><input type="checkbox" checked={has(v)} onChange={() => pick(v)} /> <span>{v.name}</span> <span className="cell-sub">{peso(v.price)}</span></label>
                ))}
                <button type="button" className="svc-close" onClick={() => setOpen(false)}>Close</button>
              </div>
            )}
          </div>
        ) : <span className="cell-sub">Standard service · {peso(s.price)}</span>}
      </div>
    </div>
  )
}

// Items as the server wants them (labels and screen-only flags dropped).
export const toSend = (items) => items.map(({ serviceId, variationId, productId, name, detail, kind, qty }) => (
  serviceId ? { serviceId, variationId } : { productId, name, detail, kind: productId ? 'product' : kind, qty }))

const METHODS = [['cash', 'Cash'], ['gcash', 'GCash'], ['maya', 'Maya'], ['card', 'Card'], ['bank', 'Bank Transfer'], ['no_charge', 'No Charge']]
export const METHOD_LABEL = Object.fromEntries(METHODS)

// Take Payment at the front desk: "Anything else given?" (the list so far, what usually goes with it,
// one search), the total from the price list, and how they paid. Stock comes off once the visit is
// paid and checked out: with Paid & Check Out, or later at the tag tap-out.
export function PaymentPanel({ appointmentId, onClose, onDone }) {
  const { data, error: loadError } = useApi(`appointments/${appointmentId}`)
  const a = data?.appointment
  const [picked, setPicked] = useState([])
  const [extra, setExtra] = useState(0)
  const [method, setMethod] = useState('')
  const [amount, setAmount] = useState(null) // null: follows the total
  const [cash, setCash] = useState('')
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const errors = error?.body?.errors || {}
  const paid = a?.paymentStatus === 'paid'
  const total = Math.round(((a?.due || 0) + extra) * 100) / 100
  const shownAmount = method === 'no_charge' ? '0' : amount ?? String(total)
  const differs = method && Number(shownAmount) !== total
  const change = method === 'cash' && Number(cash) > Number(shownAmount) ? Number(cash) - Number(shownAmount) : null
  const canCheckOut = a && a.status !== 'completed'

  async function save(checkOut) {
    setBusy(checkOut ? 'out' : 'paid')
    setError(null)
    try {
      const res = paid
        ? await api(`appointments/${appointmentId}/status`, { method: 'POST', body: { to: 'completed' } })
        : await api(`appointments/${appointmentId}/pay`, { method: 'POST', body: { items: toSend(picked), method, amount: shownAmount, reference, note, checkOut } })
      onDone(res.appointment, paid || checkOut ? `${a.pet.name} checked out` : `${a.pet.name}: paid. Tap the tag on the way out.`)
    } catch (err) {
      setError(err)
      setBusy(null)
    }
  }
  const total0 = (a?.items.length || 0) + picked.length
  return (
    <Panel dirty={picked.length > 0 || !!method} discardTitle="Close without taking the payment?" busy={!!busy} onClose={onClose}
      title={a ? (paid ? `Check Out ${a.pet.name}` : `Take Payment: ${a.pet.name}`) : 'Take Payment'}
      intro={paid ? 'Already paid. Check them out when they leave.' : 'Anything else given today? Vitamins, medicines to take home, an extra service. Add it before taking the payment so the record and the stock are right.'}
      footer={<><button type="button" className="btn btn-quiet" onClick={onClose} disabled={!!busy}>Cancel</button>
        {paid ? (
          canCheckOut && <button type="button" className="btn" onClick={() => save(true)} disabled={!!busy}>{busy ? 'Saving…' : 'Check Out'}</button>
        ) : (
          <>
            <button type="button" className={`btn ${canCheckOut ? 'btn-quiet' : ''}`} onClick={() => save(false)} disabled={!!busy || !a || !total0 || !method}>{busy === 'paid' ? 'Saving…' : 'Mark as Paid'}</button>
            {canCheckOut && <button type="button" className="btn" onClick={() => save(true)} disabled={!!busy || !total0 || !method}>{busy === 'out' ? 'Saving…' : 'Paid & Check Out'}</button>}
          </>
        )}</>}>
      <ErrorNote error={loadError || (error && !Object.keys(errors).length ? error : null)} />
      {!a ? <PawLoader small label="Loading the visit…" /> : (
        <>
          <section className="form-section">
            <h3 className="label">On This Visit</h3>
            {a.items.length ? (
              <ul className="qa-onvisit">{a.items.map((it) => (
                <li key={it.id}><Check aria-hidden /> <span>{it.name}{it.detail ? ` · ${it.detail}` : ''}{it.qty > 1 ? ` × ${it.qty}` : ''}</span>
                  <span className="qa-price">{it.price != null ? peso(it.price * (it.qty || 1)) : '—'}</span></li>
              ))}</ul>
            ) : <p className="field-hint" style={{ margin: 0 }}>Nothing yet. Add at least the main service below.</p>}
          </section>
          {!paid && <ServicePicker items={picked} setItems={setPicked} products appointmentId={a.id} existing={a.items} onTotal={setExtra} />}
          {!paid && (
            <section className="form-section pay-box">
              <div className="pay-total"><span className="label">Total</span><strong>{peso(total)}</strong></div>
              {picked.length > 0 && <p className="field-hint" style={{ margin: 0 }}>Includes {picked.length} item{picked.length > 1 ? 's' : ''} added now. Items with no price on the list count as ₱0.</p>}
              <div>
                <span className="field-label">Paid With</span>
                <div className="chips pay-methods" role="radiogroup" aria-label="Paid With">
                  {METHODS.map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={method === k} className="choice pay-method" onClick={() => setMethod(k)}>{l}</button>)}
                </div>
                {errors.method && <span className="field-error">{errors.method}</span>}
              </div>
              {method && method !== 'no_charge' && (
                <div className="form-row">
                  <Field label="Amount Paid (₱)" error={errors.amount}>{(f) => <input {...f} value={shownAmount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" />}</Field>
                  {method === 'cash'
                    ? <Field label="Cash Received (₱)" optional hint={change != null ? `Change: ${peso(change)}` : undefined}>{(f) => <input {...f} value={cash} onChange={(e) => setCash(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" />}</Field>
                    : <Field label="Reference No." optional>{(f) => <input {...f} value={reference} onChange={(e) => setReference(e.target.value)} maxLength={60} />}</Field>}
                </div>
              )}
              {(differs || method === 'no_charge') && (
                <Field label={method === 'no_charge' ? 'Why No Charge' : 'Why the Amount Differs'} error={errors.note}>{(f) => <input {...f} value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder={method === 'no_charge' ? 'e.g. free first consultation' : 'e.g. senior discount 10%'} />}</Field>
              )}
            </section>
          )}
          {paid && <PaymentSummary a={a} />}
        </>
      )}
    </Panel>
  )
}
export const CheckOutPanel = PaymentPanel

export function PaymentSummary({ a }) {
  const live = a.payments.filter((p) => !p.voidedAt)
  return (
    <ul className="pay-list">
      {a.payments.map((p) => (
        <li key={p.id} className={p.voidedAt ? 'is-void' : ''}>
          <strong>{peso(p.amount)}</strong> {METHOD_LABEL[p.method]}{p.reference ? ` · Ref ${p.reference}` : ''}
          <span className="cell-sub">{p.by} · {prettyDay(p.at.slice(0, 10))}{p.amount !== p.due ? ` · total was ${peso(p.due)}` : ''}{p.note ? ` · ${p.note}` : ''}</span>
          {p.voidedAt && <span className="cell-sub">Voided by {p.voidedBy}: {p.voidReason}</span>}
        </li>
      ))}
      {!live.length && !a.payments.length && <li className="cell-sub">No payment yet.</li>}
    </ul>
  )
}
