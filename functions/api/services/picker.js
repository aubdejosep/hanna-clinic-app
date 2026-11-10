// GET /api/services/picker -> active services with their active variations, for booking and
// Services & Products on an appointment (every staff member).

import { json } from '../../../lib/http.js'

export async function onRequestGet({ env }) {
  const [services, variations] = await env.DB.batch([
    env.DB.prepare(`SELECT s.id, s.name, s.price_cents, c.name AS category FROM services s
      LEFT JOIN service_categories c ON c.id = s.category_id
      WHERE s.deleted_at IS NULL AND s.active = 1 ORDER BY c.name COLLATE NOCASE, s.name COLLATE NOCASE`),
    env.DB.prepare(`SELECT v.id, v.service_id, v.name, v.price_cents FROM service_variations v
      JOIN services s ON s.id = v.service_id WHERE v.active = 1 AND s.deleted_at IS NULL ORDER BY v.sort, v.id`),
  ])
  const byService = {}
  for (const v of variations.results) (byService[v.service_id] ||= []).push({ id: v.id, name: v.name, price: v.price_cents / 100 })
  return json({
    services: services.results.map((s) => ({ id: s.id, name: s.name, category: s.category || 'Other', price: s.price_cents / 100, variations: byService[s.id] || [] })),
  })
}
