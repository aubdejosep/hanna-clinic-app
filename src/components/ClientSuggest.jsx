// Finances ▸ Receipts and Ledger: owner & pet autocomplete from Client Portal ▸ Masterlist.
// Picking an owner fills Owner's Name, links ownerId (used for Finances ▸ Balances), and fills Pet's Name when the
// owner has one pet. Picking a pet with a linked owner shows that owner's pets first; without an owner, it searches
// all pets and fills Owner's Name + ownerId too. Free-text typing is always allowed for walk-ins.
import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.js'

const ownerCache = new Map()
const petCache = new Map()
const ownerPetsCache = new Map()

const norm = (s) => String(s || '').toLowerCase().trim()

// When typing multiple pets (e.g. "Onyx & Bli"), match only the part after the last comma / "&" / "and".
export function mergePetName(current, picked) {
  const m = String(current || '').match(/^(.*?(?:,\s*|\s+&\s+|\s+and\s+))([^,&]*)$/i)
  return m ? `${m[1]}${picked}` : picked
}
function petFragment(text) {
  const m = String(text || '').match(/^(?:.*?(?:,\s*|\s+&\s+|\s+and\s+))([^,&]*)$/i)
  return norm(m ? m[1] : text)
}

function useDropdown(items, active, onPick, resetKey) {
  const [at, setAt] = useState(0)
  const [closed, setClosed] = useState(false)
  const anchor = useRef(null)
  useEffect(() => { setAt(0); setClosed(false) }, [resetKey, active])
  const shown = active && !closed ? items : []
  const pick = (e) => { setClosed(true); onPick(e) }
  const keys = (ev) => {
    if (!shown.length) return false
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); setAt((i) => (i + (ev.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length); return true }
    if (ev.key === 'Enter' || ev.key === 'Tab') { if (ev.key === 'Enter') ev.preventDefault(); pick(shown[at] || shown[0]); return ev.key === 'Enter' }
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); setClosed(true); return true }
    return false
  }
  const rect = shown.length && anchor.current ? anchor.current.getBoundingClientRect() : null
  const style = rect ? { top: rect.bottom + 2, left: rect.left, minWidth: Math.max(rect.width, 280) } : null
  return { anchor, keys, shown, at, setAt, pick, style }
}

export function useOwnerSuggest({ text, active, onPick }) {
  const q = String(text || '').trim()
  const [items, setItems] = useState([])
  useEffect(() => {
    if (!active || q.length < 2) { setItems([]); return undefined }
    const key = norm(q)
    if (ownerCache.has(key)) { setItems(ownerCache.get(key)); return undefined }
    let live = true
    const t = setTimeout(() => {
      api(`finances/daily/clients?kind=owner&q=${encodeURIComponent(q)}`).then((r) => {
        const list = r.owners || []
        ownerCache.set(key, list)
        if (live) setItems(list)
      }).catch(() => {})
    }, 150)
    return () => { live = false; clearTimeout(t) }
  }, [q, active])
  const filtered = items.filter((o) => norm(o.name) !== norm(q))
  const d = useDropdown(filtered, active, onPick, q)
  const popup = d.style && d.shown.length > 0 && (
    <ul className="sg-list" role="listbox" style={d.style} onMouseDown={(e) => e.preventDefault()}>
      {d.shown.map((o, i) => (
        <li key={o.id} role="option" aria-selected={i === d.at} className={i === d.at ? 'is-on' : ''} onMouseEnter={() => d.setAt(i)} onClick={() => d.pick(o)}>
          <span className="sg-name">{o.name}</span>
          <span className="sg-kind">{o.pets.length ? o.pets.map((p) => p.name).join(', ') : o.customerNo || ''}</span>
          <span className="sg-price">{o.mobile || o.customerNo || ''}</span>
        </li>
      ))}
    </ul>
  )
  return { anchor: d.anchor, keys: d.keys, popup, open: d.shown.length > 0 }
}

export function usePetSuggest({ text, active, ownerId, onPick }) {
  const q = String(text || '').trim()
  const [ownerPets, setOwnerPets] = useState([])
  const [searchPets, setSearchPets] = useState([])
  useEffect(() => {
    if (!active || !ownerId) { setOwnerPets([]); return undefined }
    if (ownerPetsCache.has(ownerId)) { setOwnerPets(ownerPetsCache.get(ownerId)); return undefined }
    let live = true
    api(`finances/daily/clients?ownerId=${ownerId}`).then((r) => {
      const list = r.pets || []
      ownerPetsCache.set(ownerId, list)
      if (live) setOwnerPets(list)
    }).catch(() => {})
    return () => { live = false }
  }, [ownerId, active])
  useEffect(() => {
    if (!active || ownerId || q.length < 2) { setSearchPets([]); return undefined }
    const key = norm(q)
    if (petCache.has(key)) { setSearchPets(petCache.get(key)); return undefined }
    let live = true
    const t = setTimeout(() => {
      api(`finances/daily/clients?kind=pet&q=${encodeURIComponent(q)}`).then((r) => {
        const list = r.pets || []
        petCache.set(key, list)
        if (live) setSearchPets(list)
      }).catch(() => {})
    }, 150)
    return () => { live = false; clearTimeout(t) }
  }, [q, active, ownerId])
  const frag = petFragment(text)
  const items = ownerId
    ? ownerPets.filter((p) => !frag || norm(p.name).includes(frag)).filter((p) => norm(p.name) !== norm(q))
    : searchPets.filter((p) => norm(p.name) !== norm(q))
  const d = useDropdown(items, active, onPick, `${ownerId || ''}|${q}`)
  const popup = d.style && d.shown.length > 0 && (
    <ul className="sg-list" role="listbox" style={d.style} onMouseDown={(e) => e.preventDefault()}>
      {d.shown.map((p, i) => (
        <li key={p.id} role="option" aria-selected={i === d.at} className={i === d.at ? 'is-on' : ''} onMouseEnter={() => d.setAt(i)} onClick={() => d.pick(p)}>
          <span className="sg-name">{p.name}</span>
          <span className="sg-kind">{ownerId ? (p.species || '') : (p.ownerName || '')}</span>
          <span className="sg-price">{p.deceased ? 'Deceased' : (ownerId ? '' : (p.species || ''))}</span>
        </li>
      ))}
    </ul>
  )
  return { anchor: d.anchor, keys: d.keys, popup, open: d.shown.length > 0 }
}
