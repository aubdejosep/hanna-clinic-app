// GET /api/search?q= -> the header's search box: partial matches across owners (name, customer no.,
//   mobile, email), pets (name, breed, microchip), products and services (with their variations and
//   prices), up to 6 of each. Two letters at least. With a number (3+ digits): receipts in Finances ▸ Receipts / Ledger
//   by OR or QR number (05337), the app's visit invoices (#2026A7280) and the old system's invoices (INV2026A0004).

import { json, likePattern, normalizeMobile, canManage } from '../../lib/http.js'
import { localMobile } from '../../lib/clients.js'

export async function onRequestGet({ env, request, data }) {
  const q = String(new URL(request.url).searchParams.get('q') || '').trim().slice(0, 60)
  if (q.length < 2) return json({ q, owners: [], pets: [], products: [], services: [], receipts: [], invoices: [] })
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
  const { receipts, invoices } = await numbers(env, q, canManage(data.staff))
  return json({
    q, receipts, invoices,
    owners: owners.results.map((o) => ({ id: o.id, name: o.full_name, customerNo: o.customer_no, mobile: localMobile(o.mobile), email: o.email, pets: o.pets })),
    pets: pets.results.map((p) => ({ id: p.id, name: p.name, species: p.species, breed: p.breed, owner: p.owner_name, deceased: !!p.deceased_on })),
    products: products.results.map((p) => ({ id: p.id, name: p.name, category: p.category, unit: p.unit, price: p.price_cents == null ? null : p.price_cents / 100, onHand: p.counted_at ? p.on_hand : null })),
    services: services.results.map((s) => ({ id: s.id, name: s.name, category: s.category, price: s.price_cents / 100,
      variations: JSON.parse(s.vars || '[]').map((v) => ({ name: v.name, price: v.price / 100 })) })),
  })
}

// Receipt and invoice numbers: only when the search has 3+ digits.
async function numbers(env, q, manager) {
  const bare = q.replace(/^#\s*/, '').replace(/\s+/g, '')
  if ((bare.match(/\d/g) || []).length < 3) return { receipts: [], invoices: [] }
  const app = bare.match(/^(\d{4})A(\d+)$/i)
  const stmts = [
    env.DB.prepare(`SELECT id, day, receipt_no, receipt_qr, client_name, pet_names, amount_cents, photo_key FROM cash_lines
      WHERE branch_id = 1 AND deleted_at IS NULL AND (receipt_no LIKE ?1 OR receipt_qr LIKE ?1) ORDER BY day DESC LIMIT 6`).bind(`${bare}%`),
    env.DB.prepare(`SELECT i.id, i.day, i.invoice_no, i.owner_id, COALESCE(o.full_name, i.customer_name) AS client, i.pet_name, i.amount_cents, i.status FROM old_invoices i
      LEFT JOIN owners o ON o.id = i.owner_id WHERE replace(i.invoice_no, '#', '') LIKE ?1 ORDER BY i.day DESC LIMIT 6`).bind(`%${bare}%`),
  ]
  if (app) {
    stmts.push(env.DB.prepare(`SELECT a.id, a.day, a.owner_id, o.full_name AS client, p.name AS pet_name FROM appointments a JOIN owners o ON o.id = a.owner_id JOIN pets p ON p.id = a.pet_id
      WHERE a.id = ? AND substr(a.day, 1, 4) = ? AND a.deleted_at IS NULL`).bind(Number(app[2]), app[1]))
  }
  const [r, old, visit] = await env.DB.batch(stmts)
  const invoices = [
    ...(visit?.results || []).map((v) => ({ key: `a${v.id}`, invoiceNo: `#${v.day.slice(0, 4)}A${v.id}`, day: v.day, client: v.client, pet: v.pet_name, source: 'app', to: `/appointments/${v.id}` })),
    ...old.results.map((i) => ({ key: `i${i.id}`, invoiceNo: i.invoice_no, day: i.day, client: i.client, pet: i.pet_name, amount: i.amount_cents / 100, unpaid: i.status === 'UNPAID', source: 'old',
      to: manager ? `/finances/transactions?q=${encodeURIComponent(String(i.invoice_no).replace(/^#/, ''))}` : i.owner_id ? `/clients/${i.owner_id}` : null })).filter((i) => i.to),
  ]
  return {
    receipts: r.results.map((x) => ({ id: x.id, day: x.day, receiptNo: x.receipt_no, receiptQr: x.receipt_qr, client: x.client_name, pets: x.pet_names, amount: x.amount_cents / 100, photo: !!x.photo_key })),
    invoices,
  }
}
