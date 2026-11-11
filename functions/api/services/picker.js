// GET /api/services/picker?petId=&appointmentId= -> everything Quick Add needs in one call (every staff member):
//   services   active services with their active variations
//   products   medicines and products to dispense (names and categories only)
//   cohorts    learned from past visits, per species: the most used items and what usually goes
//              with each (lib/catalog.js, worked out once a day)
//   pet        with petId or appointmentId: species, today's or latest weight, and the items on the
//              pet's last checked-out visit (for Same as Last Visit)

import { json, manilaToday } from '../../../lib/http.js'
import { cohorts } from '../../../lib/catalog.js'

export async function onRequestGet({ env, request }) {
  const url = new URL(request.url)
  const appointmentId = Number(url.searchParams.get('appointmentId')) || 0
  let petId = Number(url.searchParams.get('petId')) || 0
  let visitWeight = null
  let day = manilaToday()
  if (appointmentId) {
    const a = await env.DB.prepare('SELECT pet_id, weight_kg, day FROM appointments WHERE id = ?').bind(appointmentId).first()
    if (a) { petId = a.pet_id; visitWeight = a.weight_kg; if (a.day > day) day = a.day }
  }
  const [services, variations, products] = await env.DB.batch([
    env.DB.prepare(`SELECT s.id, s.name, s.description, s.price_cents, c.name AS category FROM services s
      LEFT JOIN service_categories c ON c.id = s.category_id
      WHERE s.deleted_at IS NULL AND s.active = 1 ORDER BY c.name COLLATE NOCASE, s.name COLLATE NOCASE`),
    env.DB.prepare(`SELECT v.id, v.service_id, v.name, v.price_cents FROM service_variations v
      JOIN services s ON s.id = v.service_id WHERE v.active = 1 AND s.deleted_at IS NULL ORDER BY v.sort, v.id`),
    env.DB.prepare('SELECT id, name, category, unit, price_cents, on_hand, counted_at FROM products WHERE deleted_at IS NULL AND active = 1 ORDER BY name COLLATE NOCASE'),
  ])
  let pet = null
  if (petId) {
    const [p, last] = await env.DB.batch([
      env.DB.prepare('SELECT id, name, species, weight_kg FROM pets WHERE id = ?').bind(petId),
      env.DB.prepare(`SELECT a.id, a.day FROM appointments a WHERE a.pet_id = ? AND a.id <> ? AND a.status = 'completed' AND a.deleted_at IS NULL AND a.day <= ?
        AND EXISTS (SELECT 1 FROM appointment_items i WHERE i.appointment_id = a.id AND i.deleted_at IS NULL) ORDER BY a.day DESC, a.id DESC LIMIT 1`).bind(petId, appointmentId, day),
    ])
    const row = p.results[0]
    const lastVisit = last.results[0]
    const lastItems = lastVisit ? (await env.DB.prepare(`SELECT service_id, variation_id, product_id, name, detail, kind, qty FROM appointment_items
      WHERE appointment_id = ? AND deleted_at IS NULL ORDER BY id`).bind(lastVisit.id).all()).results : []
    if (row) {
      pet = {
        id: row.id, name: row.name, species: row.species, weightKg: visitWeight ?? row.weight_kg ?? null,
        lastVisit: lastVisit ? { day: lastVisit.day, items: lastItems.map((i) => ({ serviceId: i.service_id, variationId: i.variation_id, productId: i.product_id, name: i.name, detail: i.detail, kind: i.kind, qty: i.qty })) } : null,
      }
    }
  }
  const byService = {}
  for (const v of variations.results) (byService[v.service_id] ||= []).push({ id: v.id, name: v.name, price: v.price_cents / 100 })
  return json({
    services: services.results.map((s) => ({ id: s.id, name: s.name, description: s.description, category: s.category || 'Other', price: s.price_cents / 100, variations: byService[s.id] || [] })),
    products: products.results.map((p) => ({ id: p.id, name: p.name, category: p.category, unit: p.unit, price: p.price_cents == null ? null : p.price_cents / 100, onHand: p.counted_at ? p.on_hand : null })),
    cohorts: await cohorts(env),
    pet,
  })
}
