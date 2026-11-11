// GET /api/search?q= -> the header's search box: partial matches across owners (name, customer no.,
//   mobile, email), pets (name, breed, microchip), products and services (with their variations and
//   prices), up to 6 of each. Two letters at least.

import { json, likePattern, normalizeMobile } from '../../lib/http.js'
import { localMobile } from '../../lib/clients.js'

export async function onRequestGet({ env, request }) {
  const q = String(new URL(request.url).searchParams.get('q') || '').trim().slice(0, 60)
  if (q.length < 2) return json({ q, owners: [], pets: [], products: [], services: [] })
  const like = likePattern(q)
  const digits = q.replace(/\D/g, '')
  const mobile = normalizeMobile(q)
  const phone = digits.length >= 4 ? `%${digits.replace(/^0/, '')}%` : '-'
  const [owners, pets, products, services] = await env.DB.batch([
    env.DB.prepare(`SELECT o.id, o.full_name, o.customer_no, o.mobile, o.email,
        (SELECT COUNT(*) FROM pets p WHERE p.owner_id = o.id AND p.deleted_at IS NULL) AS pets
      FROM owners o WHERE o.deleted_at IS NULL AND (o.full_name LIKE ?1 OR o.customer_no LIKE ?1 OR o.email LIKE ?1 OR o.mobile = ?2 OR o.mobile LIKE ?3)
      ORDER BY o.full_name LIKE ?4 DESC, o.full_name COLLATE NOCASE LIMIT 6`).bind(like, mobile || '-', phone, `${q}%`),
    env.DB.prepare(`SELECT p.id, p.name, p.species, p.breed, p.deceased_on, o.full_name AS owner_name FROM pets p JOIN owners o ON o.id = p.owner_id
      WHERE p.deleted_at IS NULL AND o.deleted_at IS NULL AND (p.name LIKE ?1 OR p.breed LIKE ?1 OR p.microchip LIKE ?1)
      ORDER BY p.deceased_on IS NOT NULL, p.name LIKE ?2 DESC, p.name COLLATE NOCASE LIMIT 6`).bind(like, `${q}%`),
    env.DB.prepare(`SELECT id, name, category, unit, price_cents, on_hand, counted_at FROM products
      WHERE deleted_at IS NULL AND active = 1 AND (name LIKE ?1 OR category LIKE ?1) ORDER BY name LIKE ?2 DESC, name COLLATE NOCASE LIMIT 6`).bind(like, `${q}%`),
    env.DB.prepare(`SELECT s.id, s.name, s.price_cents, c.name AS category,
        (SELECT json_group_array(json_object('name', v.name, 'price', v.price_cents)) FROM (SELECT * FROM service_variations v WHERE v.service_id = s.id AND v.active = 1 ORDER BY v.sort, v.id) v) AS vars
      FROM services s LEFT JOIN service_categories c ON c.id = s.category_id
      WHERE s.deleted_at IS NULL AND s.active = 1 AND (s.name LIKE ?1 OR c.name LIKE ?1 OR s.description LIKE ?1
        OR EXISTS (SELECT 1 FROM service_variations v WHERE v.service_id = s.id AND v.active = 1 AND v.name LIKE ?1))
      ORDER BY s.name LIKE ?2 DESC, s.name COLLATE NOCASE LIMIT 6`).bind(like, `${q}%`),
  ])
  return json({
    q,
    owners: owners.results.map((o) => ({ id: o.id, name: o.full_name, customerNo: o.customer_no, mobile: localMobile(o.mobile), email: o.email, pets: o.pets })),
    pets: pets.results.map((p) => ({ id: p.id, name: p.name, species: p.species, breed: p.breed, owner: p.owner_name, deceased: !!p.deceased_on })),
    products: products.results.map((p) => ({ id: p.id, name: p.name, category: p.category, unit: p.unit, price: p.price_cents == null ? null : p.price_cents / 100, onHand: p.counted_at ? p.on_hand : null })),
    services: services.results.map((s) => ({ id: s.id, name: s.name, category: s.category, price: s.price_cents / 100,
      variations: JSON.parse(s.vars || '[]').map((v) => ({ name: v.name, price: v.price / 100 })) })),
  })
}
