// The search box beside the bell: owners, pets, medicines and products, and services (with their
// variations and prices) in one list. "/" jumps to it; arrows and Enter pick a result.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Package, PawPrint, Search, Stethoscope, UserRound, X } from 'lucide-react'
import { PetAvatar } from './ui.jsx'
import { api } from '../lib/api.js'
import { useDebounced } from '../lib/useApi.js'

const peso = (n) => (n == null ? '—' : `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`)
const plural = (unit, n) => (!unit ? '' : n === 1 || unit === 'ml' ? unit : unit === 'box' ? 'boxes' : `${unit}s`)

export default function OmniSearch({ mobile }) {
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(false)
  const [at, setAt] = useState(0)
  const q = useDebounced(text.trim(), 200)
  const box = useRef(null)
  const input = useRef(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (q.length < 2) { setData(null); return undefined }
    let live = true
    setBusy(true)
    api(`search?q=${encodeURIComponent(q)}`).then((d) => { if (live) { setData(d); setAt(0) } }).catch(() => {}).finally(() => { if (live) setBusy(false) })
    return () => { live = false }
  }, [q])

  // "/" focuses the search from anywhere except a field.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable) return
      e.preventDefault()
      setOpen(true)
      setTimeout(() => input.current?.focus(), 0)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => {
    if (!open || mobile) return undefined
    const onDown = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, mobile])

  // One flat list for the arrow keys, in the order shown.
  const items = useMemo(() => !data ? [] : [
    ...data.owners.map((o) => ({ key: `o${o.id}`, group: 'Pet Owners', to: `/clients/${o.id}`, o })),
    ...data.pets.map((p) => ({ key: `p${p.id}`, group: 'Pets', to: `/pets/${p.id}`, p })),
    ...data.products.map((p) => ({ key: `i${p.id}`, group: 'Medicines & Products', to: `/inventory?product=${p.id}`, i: p })),
    ...data.services.map((s) => ({ key: `s${s.id}`, group: 'Services', to: `/clinic/services?q=${encodeURIComponent(s.name)}`, s })),
  ], [data])
  const go = (it) => { setOpen(false); setText(''); setData(null); input.current?.blur(); navigate(it.to) }
  function onKey(e) {
    if (e.key === 'Escape') { setOpen(false); input.current?.blur(); return }
    if (!items.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setAt((n) => (n + 1) % items.length) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setAt((n) => (n - 1 + items.length) % items.length) }
    if (e.key === 'Enter') { e.preventDefault(); go(items[at]) }
  }
  useEffect(() => { document.getElementById(`omni-${items[at]?.key}`)?.scrollIntoView({ block: 'nearest' }) }, [at, items])

  const showList = open && q.length >= 2
  const results = showList && (
    <div className="omni-results" role="listbox" id="omni-list" aria-label="Search results">
      {data && !items.length && !busy && <p className="omni-empty">Nothing matches “{q}”. Try part of a name, a mobile number or a product.</p>}
      {!data && busy && <p className="omni-empty">Searching…</p>}
      {['Pet Owners', 'Pets', 'Medicines & Products', 'Services'].map((g) => {
        const list = items.filter((it) => it.group === g)
        if (!list.length) return null
        return (
          <section key={g} className="omni-group">
            <h3 className="label">{g}</h3>
            {list.map((it) => {
              const i = items.indexOf(it)
              return (
                <button key={it.key} id={`omni-${it.key}`} type="button" role="option" aria-selected={i === at} className="omni-item" onMouseEnter={() => setAt(i)} onClick={() => go(it)}>
                  {it.o && <><span className="omni-icon"><UserRound aria-hidden /></span><span><strong>{it.o.name}</strong><span className="cell-sub">{[it.o.customerNo, it.o.mobile, it.o.email, `${it.o.pets} pet${it.o.pets === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</span></span></>}
                  {it.p && <><PetAvatar species={it.p.species} /><span><strong>{it.p.name}</strong><span className="cell-sub">{[it.p.breed, it.p.owner, it.p.deceased && 'Passed away'].filter(Boolean).join(' · ')}</span></span></>}
                  {it.i && <><span className="omni-icon"><Package aria-hidden /></span><span><strong>{it.i.name}</strong><span className="cell-sub">{[it.i.category, it.i.price != null && `${peso(it.i.price)} per ${it.i.unit}`, it.i.onHand != null && `${it.i.onHand} ${plural(it.i.unit, it.i.onHand)} in stock`].filter(Boolean).join(' · ')}</span></span></>}
                  {it.s && (
                    <>
                      <span className="omni-icon"><Stethoscope aria-hidden /></span>
                      <span>
                        <strong>{it.s.name}</strong>
                        <span className="cell-sub">{it.s.category}{!it.s.variations.length && ` · ${peso(it.s.price)}`}</span>
                        {it.s.variations.length > 0 && (
                          <span className="omni-vars">
                            {it.s.variations.slice(0, 8).map((v, n) => <span key={n} className="omni-var"><span>{v.name}</span><span>{peso(v.price)}</span></span>)}
                            {it.s.variations.length > 8 && <span className="cell-sub">+{it.s.variations.length - 8} more</span>}
                          </span>
                        )}
                      </span>
                    </>
                  )}
                </button>
              )
            })}
          </section>
        )
      })}
    </div>
  )
  const field = (
    <div className="search omni-field">
      <Search aria-hidden />
      <label className="sr-only" htmlFor="omni">Search Everything</label>
      <input id="omni" ref={input} type="search" value={text} autoComplete="off" autoFocus={!!mobile} placeholder="Search owners, pets, products, services"
        onChange={(e) => { setText(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)} onKeyDown={onKey}
        role="combobox" aria-expanded={!!showList} aria-controls="omni-list" aria-activedescendant={items[at] ? `omni-${items[at].key}` : undefined} />
      {!mobile && !text && <kbd className="omni-kbd" aria-hidden>/</kbd>}
    </div>
  )
  if (mobile) {
    return (
      <>
        <button type="button" className="icon-btn" onClick={() => { setOpen(true); setTimeout(() => input.current?.focus(), 0) }} aria-label="Search" title="Search"><Search /></button>
        {open && (
          <div className="omni-sheet" role="dialog" aria-label="Search">
            <div className="omni-sheet-head">
              {field}
              <button type="button" className="icon-btn" onClick={() => { setOpen(false); setText('') }} aria-label="Close Search"><X /></button>
            </div>
            {results || <p className="omni-empty"><PawPrint size={14} aria-hidden /> Type at least 2 letters: a name, mobile number, product or service.</p>}
          </div>
        )}
      </>
    )
  }
  return <div className="omni" ref={box}>{field}{results}</div>
}
