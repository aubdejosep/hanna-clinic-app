// GET /api/balances[?ownerId=] -> open balances by owner (every staff member: the front desk collects them)
//   owners: [{ id, name, customerNo, mobile, total, items, lastPayment }], biggest first; total of all.
// Each item says what it is and what's left (lib/balances.js).

import { json, manilaToday } from '../../../lib/http.js'
import { localMobile } from '../../../lib/clients.js'
import { openItems } from '../../../lib/balances.js'

export async function onRequestGet({ env, request }) {
  const ownerId = Number(new URL(request.url).searchParams.get('ownerId')) || null
  const items = await openItems(env, ownerId ? { ownerIds: [ownerId] } : {})
  const ids = [...new Set(items.map((i) => i.ownerId))]
  const owners = {}
  if (ids.length) {
    const list = ids.join(',')
    const [rows, lastPay, lastOld] = await env.DB.batch([
      env.DB.prepare(`SELECT id, full_name, customer_no, mobile FROM owners WHERE id IN (${list})`),
      env.DB.prepare(`SELECT COALESCE(y.owner_id, a.owner_id) AS owner_id, MAX(y.day) AS day FROM payments y LEFT JOIN appointments a ON a.id = y.appointment_id
        WHERE y.voided_at IS NULL AND y.amount_cents > 0 AND (y.owner_id IN (${list}) OR a.owner_id IN (${list})) GROUP BY 1`),
      env.DB.prepare(`SELECT owner_id, MAX(day) AS day FROM old_invoices WHERE owner_id IN (${list}) AND paid_cents > 0 GROUP BY owner_id`),
    ])
    for (const o of rows.results) owners[o.id] = { id: o.id, name: o.full_name, customerNo: o.customer_no, mobile: localMobile(o.mobile), total: 0, items: [], lastPayment: null }
    for (const r of [...lastPay.results, ...lastOld.results]) if (owners[r.owner_id] && r.day && (!owners[r.owner_id].lastPayment || r.day > owners[r.owner_id].lastPayment)) owners[r.owner_id].lastPayment = r.day
  }
  for (const i of items) if (owners[i.ownerId]) { owners[i.ownerId].items.push(i); owners[i.ownerId].total += i.left }
  const list = Object.values(owners).map((o) => ({ ...o, total: Math.round(o.total * 100) / 100 })).sort((a, b) => b.total - a.total)
  return json({ today: manilaToday(), owners: list, total: Math.round(list.reduce((s, o) => s + o.total, 0) * 100) / 100 })
}
