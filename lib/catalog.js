// What goes together on a visit, learned from the clinic's own history, for Quick Add.
//
// A "key" names one pickable thing: s:<service> for a service sized by weight (the size is picked
// from the pet's weight on screen), v:<variation> for one variation (e.g. VACCINE · ANTI RABIES),
// s:<service> for a plain service, p:<product> for a medicine or product.
// Visits: the imported medical records (one record = one visit) plus visits checked out in the app.
// Worked out at most once a day for everyone (lib/cache.js), so opening the picker costs one read.

import { cached } from './cache.js'
import { sizeOptions } from './sizing.js'

const MIN_PAIR = 5        // seen together on at least this many visits
const MIN_SHARE = 0.2     // and on at least 20% of the visits with the first item
const KEEP = 6

const norm = (s) => String(s || '').trim().toLowerCase()

export async function loadCatalog(env) {
  const [services, variations, products] = await env.DB.batch([
    env.DB.prepare('SELECT id, name FROM services WHERE deleted_at IS NULL AND active = 1'),
    env.DB.prepare('SELECT v.id, v.service_id, v.name FROM service_variations v JOIN services s ON s.id = v.service_id WHERE v.active = 1 AND s.deleted_at IS NULL ORDER BY v.sort, v.id'),
    env.DB.prepare('SELECT id, name FROM products WHERE deleted_at IS NULL AND active = 1'),
  ])
  const byId = {}
  for (const s of services.results) byId[s.id] = { ...s, variations: [] }
  for (const v of variations.results) byId[v.service_id]?.variations.push(v)
  return { services: Object.values(byId), products: products.results }
}

// Item (from appointment_items or a medical entry) -> key, or null when it isn't on the lists.
function keyer({ services, products }) {
  const sByName = {}
  const sById = {}
  for (const s of services) {
    const sized = !!sizeOptions(s)
    const entry = { s, sized, vByName: {}, vIds: new Set(s.variations.map((v) => v.id)) }
    for (const v of s.variations) entry.vByName[norm(v.name)] ||= v.id
    sByName[norm(s.name)] ||= entry
    sById[s.id] = entry
  }
  const pByName = Object.fromEntries(products.map((p) => [norm(p.name), p.id]))
  const pIds = new Set(products.map((p) => p.id))
  return (it) => {
    if (it.product_id && pIds.has(it.product_id)) return `p:${it.product_id}`
    const e = (it.service_id && sById[it.service_id]) || (!it.service_id && sByName[norm(it.name)])
    if (e) {
      if (e.sized) return `s:${e.s.id}`
      const vid = it.variation_id && e.vIds.has(it.variation_id) ? it.variation_id : it.detail ? e.vByName[norm(it.detail)] : null
      return vid ? `v:${vid}` : `s:${e.s.id}`
    }
    if (it.kind === 'product' && pByName[norm(it.name)]) return `p:${pByName[norm(it.name)]}`
    return null
  }
}

async function compute(env) {
  const catalog = await loadCatalog(env)
  const keyOf = keyer(catalog)
  const since = new Date(Date.now() - 2 * 365 * 864e5).toISOString().slice(0, 10)
  const [entries, appItems] = await env.DB.batch([
    // Booking-only records count when their booking was completed (the services were done).
    env.DB.prepare(`SELECT e.record_id AS visit, p.species, e.items FROM medical_entries e JOIN pets p ON p.id = e.pet_id JOIN medical_records m ON m.id = e.record_id
      WHERE e.items IS NOT NULL AND e.items <> '[]' AND e.day >= ? AND e.day <= date('now', '+8 hours')
        AND (m.booking_only = 0 OR EXISTS (SELECT 1 FROM appointments a WHERE a.id = m.appointment_id AND a.status = 'completed'))`).bind(since),
    env.DB.prepare(`SELECT i.appointment_id AS visit, p.species, i.service_id, i.variation_id, i.product_id, i.name, i.detail, i.kind
      FROM appointment_items i JOIN appointments a ON a.id = i.appointment_id JOIN pets p ON p.id = a.pet_id
      WHERE i.deleted_at IS NULL AND a.deleted_at IS NULL AND a.source <> 'legacy' AND a.status = 'completed' AND a.day >= ?`).bind(since),
  ])
  const visits = new Map() // "r12" / "a34" -> {species, keys}
  const add = (id, species, key) => {
    if (!key || !['dog', 'cat'].includes(species)) return
    if (!visits.has(id)) visits.set(id, { species, keys: new Set() })
    visits.get(id).keys.add(key)
  }
  for (const r of entries.results) {
    let list = []
    try { list = JSON.parse(r.items) } catch { /* skip */ }
    for (const it of list) add(`r${r.visit}`, r.species, keyOf({ name: it.name, detail: it.detail, kind: it.kind }))
  }
  for (const r of appItems.results) add(`a${r.visit}`, r.species, keyOf(r))

  const out = {}
  for (const species of ['dog', 'cat']) {
    const count = {}
    const pair = {}
    for (const v of visits.values()) {
      if (v.species !== species) continue
      const keys = [...v.keys]
      for (const a of keys) {
        count[a] = (count[a] || 0) + 1
        for (const b of keys) if (a !== b) (pair[a] ||= {})[b] = (pair[a][b] || 0) + 1
      }
    }
    const goesWith = {}
    for (const [a, others] of Object.entries(pair)) {
      const list = Object.entries(others).filter(([, n]) => n >= MIN_PAIR && n / count[a] >= MIN_SHARE)
        .sort((x, y) => y[1] - x[1]).slice(0, KEEP).map(([b, n]) => [b, Math.round((n / count[a]) * 100)])
      if (list.length) goesWith[a] = list
    }
    out[species] = {
      popular: Object.entries(count).sort((x, y) => y[1] - x[1]).slice(0, 8).map(([k]) => k),
      goesWith,
    }
  }
  return out
}

export function cohorts(env) {
  return cached(env, 'cohorts', 24 * 3600e3, () => compute(env))
}
