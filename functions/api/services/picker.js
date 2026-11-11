// GET /api/services/picker -> active services with their active variations, for booking and
// Services & Products on an appointment (every staff member).
// popular: the 3 service/variation pairs used most on visits in the last 180 days. Items typed in
// (and the imported history) count when their names match the price list.

import { json } from '../../../lib/http.js'

export async function onRequestGet({ env }) {
  const since = new Date(Date.now() + 8 * 3600e3 - 180 * 864e5).toISOString().slice(0, 10)
  const [services, variations, popular] = await env.DB.batch([
    env.DB.prepare(`SELECT s.id, s.name, s.price_cents, c.name AS category FROM services s
      LEFT JOIN service_categories c ON c.id = s.category_id
      WHERE s.deleted_at IS NULL AND s.active = 1 ORDER BY c.name COLLATE NOCASE, s.name COLLATE NOCASE`),
    env.DB.prepare(`SELECT v.id, v.service_id, v.name, v.price_cents FROM service_variations v
      JOIN services s ON s.id = v.service_id WHERE v.active = 1 AND s.deleted_at IS NULL ORDER BY v.sort, v.id`),
    env.DB.prepare(`SELECT s.id AS sid, v.id AS vid, COUNT(*) AS n
      FROM appointment_items i JOIN appointments a ON a.id = i.appointment_id
      JOIN services s ON s.deleted_at IS NULL AND s.active = 1 AND (s.id = i.service_id OR (i.service_id IS NULL AND s.name = TRIM(i.name) COLLATE NOCASE))
      LEFT JOIN service_variations v ON v.service_id = s.id AND v.active = 1
        AND (v.id = i.variation_id OR (i.variation_id IS NULL AND i.detail IS NOT NULL AND v.name = TRIM(i.detail) COLLATE NOCASE))
      WHERE i.deleted_at IS NULL AND a.deleted_at IS NULL AND a.day >= ? AND a.status <> 'cancelled'
      GROUP BY s.id, v.id ORDER BY n DESC LIMIT 3`).bind(since),
  ])
  const byService = {}
  for (const v of variations.results) (byService[v.service_id] ||= []).push({ id: v.id, name: v.name, price: v.price_cents / 100 })
  return json({
    popular: popular.results.map((p) => ({ serviceId: p.sid, variationId: p.vid, count: p.n })),
    services: services.results.map((s) => ({ id: s.id, name: s.name, category: s.category || 'Other', price: s.price_cents / 100, variations: byService[s.id] || [] })),
  })
}
