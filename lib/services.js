// Services price list: checking input and shaping output. Prices are whole centavos.

import { clean, cleanMultiline } from './http.js'

export function toCents(value) { // "2,500.00" | 2500 | "2500" -> 250000, or null if not a price
  const n = Number(String(value ?? '').replace(/[₱,\s]/g, ''))
  return Number.isFinite(n) && n >= 0 && n < 10_000_000 ? Math.round(n * 100) : null
}

export function serviceOut(r, variations = []) {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    price: r.price_cents / 100,
    categoryId: r.category_id,
    category: r.category_name || null,
    active: !!r.active,
    featuredOnline: !!r.featured_online,
    variations: variations.map((v) => ({ id: v.id, name: v.name, price: v.price_cents / 100, active: !!v.active })),
    variationCount: r.variation_count ?? variations.length,
    updatedAt: r.updated_at || r.created_at,
  }
}

// -> { values, variations (array or undefined), category (name or undefined), errors }
export function serviceInput(body, partial = false) {
  const values = {}
  const errors = {}
  const has = (k) => !partial || Object.prototype.hasOwnProperty.call(body, k)

  if (has('name')) {
    values.name = clean(body.name, 60)
    if (!values.name) errors.name = 'Enter the service name.'
  }
  if (has('description')) values.description = cleanMultiline(body.description, 300) || null
  if (has('price')) {
    const cents = toCents(body.price)
    if (cents === null) errors.price = 'Enter a price, e.g. 2500.'
    else values.price_cents = cents
  }
  if (has('active')) values.active = body.active ? 1 : 0
  if (has('featuredOnline')) values.featured_online = body.featuredOnline ? 1 : 0

  let category
  if (has('category')) {
    category = clean(body.category, 50)
    if (!category) errors.category = 'Choose a category, or type a new one.'
  }

  let variations
  if (Array.isArray(body.variations)) {
    variations = []
    body.variations.slice(0, 30).forEach((v, i) => {
      const name = clean(v?.name, 60)
      const cents = toCents(v?.price)
      if (!name && (v?.price === '' || v?.price == null)) return // empty row
      if (!name) errors[`variations.${i}.name`] = 'Name this variation, e.g. 1–3 kg.'
      if (cents === null) errors[`variations.${i}.price`] = 'Enter a price.'
      variations.push({ id: Number(v?.id) || null, name, price_cents: cents ?? 0, active: v?.active === false ? 0 : 1 })
    })
  }
  return { values, variations, category, errors }
}

// Finds a category by name (any capitalisation) or creates it. -> id
export async function categoryId(env, name) {
  const found = await env.DB.prepare('SELECT id FROM service_categories WHERE name = ?').bind(name).first()
  if (found) return found.id
  const row = await env.DB.prepare('INSERT INTO service_categories (name) VALUES (?) RETURNING id').bind(name).first()
  return row.id
}

// Replaces a service's variations: updates those with ids, adds new ones, switches off the rest.
export async function saveVariations(env, serviceId, variations) {
  const { results: current } = await env.DB.prepare('SELECT id FROM service_variations WHERE service_id = ?').bind(serviceId).all()
  const keep = new Set(variations.map((v) => v.id).filter(Boolean))
  const writes = []
  variations.forEach((v, i) => {
    if (v.id && current.some((c) => c.id === v.id)) {
      writes.push(env.DB.prepare('UPDATE service_variations SET name = ?, price_cents = ?, sort = ?, active = ? WHERE id = ? AND service_id = ?')
        .bind(v.name, v.price_cents, i, v.active, v.id, serviceId))
    } else {
      writes.push(env.DB.prepare('INSERT INTO service_variations (service_id, name, price_cents, sort, active) VALUES (?, ?, ?, ?, ?)')
        .bind(serviceId, v.name, v.price_cents, i, v.active))
    }
  })
  for (const c of current) {
    if (!keep.has(c.id)) writes.push(env.DB.prepare('UPDATE service_variations SET active = 0 WHERE id = ?').bind(c.id))
  }
  if (writes.length) await env.DB.batch(writes)
}
