// GET /api/dashboard?range=mtd|7d|30d|last_month|ytd -> the clinic overview, for every staff member.
// Counts only, except `money` (payments taken), which is added for owners and admins only and is
// never in the shared cache, so other staff never receive it.
//
// A visit is a pet seen on a day: a checked-out appointment, or a medical record written that day.
// (Most past visits in the old system exist only as medical records.) Every number comes with the
// same-length period before it.

import { json, canManage, manilaToday } from '../../lib/http.js'
import { cached } from '../../lib/cache.js'

export function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const span = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5)
export function ranges(range, today) {
  const y = today.slice(0, 4)
  const monthStart = `${today.slice(0, 7)}-01`
  if (range === '7d') return { from: addDays(today, -6), to: today, prevFrom: addDays(today, -13), prevTo: addDays(today, -7), label: 'Last 7 days' }
  if (range === '30d') return { from: addDays(today, -29), to: today, prevFrom: addDays(today, -59), prevTo: addDays(today, -30), label: 'Last 30 days' }
  if (range === 'last_month') {
    const to = addDays(monthStart, -1)
    const from = `${to.slice(0, 7)}-01`
    const pto = addDays(from, -1)
    return { from, to, prevFrom: `${pto.slice(0, 7)}-01`, prevTo: pto, label: 'Last month' }
  }
  if (range === 'ytd') return { from: `${y}-01-01`, to: today, prevFrom: `${Number(y) - 1}-01-01`, prevTo: `${Number(y) - 1}${today.slice(4)}`, label: 'Year to date' }
  const pm = addDays(monthStart, -1)
  const prevFrom = `${pm.slice(0, 7)}-01`
  const prevTo = [addDays(prevFrom, span(monthStart, today)), pm].sort()[0] // same days of last month
  return { from: monthStart, to: today, prevFrom, prevTo, label: 'Month to date' }
}

const VISITS = `visits AS (
  SELECT pet_id, owner_id, day FROM appointments WHERE status = 'completed' AND deleted_at IS NULL
  UNION SELECT pet_id, owner_id, day FROM medical_records WHERE deleted_at IS NULL AND booking_only = 0)`
const VACCINE_ITEM = "(i.name LIKE '%VACCIN%' OR i.name IN ('ARV', 'KCV') OR i.detail LIKE '%RABIES%')"

export async function onRequestGet({ request, env, data }) {
  const today = manilaToday()
  const r = ranges(new URL(request.url).searchParams.get('range'), today)
  const counts = await overview(env, r, today, new URL(request.url).searchParams.get('range') || 'mtd')
  return json(canManage(data.staff) ? { ...counts, money: await money(env, r) } : counts)
}

// Payments taken in the app (visits, quick sales, balances; not voided) plus paid invoices imported from
// the old system (Finances ▸ Transactions). Owners and admins only.
async function money(env, r) {
  const [byPeriod, byMethod, perDay] = await env.DB.batch([
    env.DB.prepare(`SELECT CASE WHEN day BETWEEN ?1 AND ?2 THEN 'cur' ELSE 'prev' END AS p, SUM(c) AS cents, COUNT(*) AS n FROM (
        SELECT day, amount_cents AS c FROM payments WHERE voided_at IS NULL AND day BETWEEN ?3 AND ?2
        UNION ALL SELECT day, paid_cents FROM old_invoices WHERE paid_cents > 0 AND day BETWEEN ?3 AND ?2) GROUP BY p`).bind(r.from, r.to, r.prevFrom),
    env.DB.prepare(`SELECT method, SUM(c) AS cents, COUNT(*) AS n FROM (
        SELECT method, amount_cents AS c FROM payments WHERE voided_at IS NULL AND day BETWEEN ?1 AND ?2
        UNION ALL SELECT CASE lower(replace(method, ' ', '')) WHEN 'banktransfer' THEN 'bank' ELSE lower(replace(method, ' ', '')) END, paid_cents
          FROM old_invoices WHERE paid_cents > 0 AND day BETWEEN ?1 AND ?2) GROUP BY method ORDER BY cents DESC`).bind(r.from, r.to),
    // Per day: payments in the app, plus paid invoices imported from the old system
    env.DB.prepare(`SELECT day, SUM(c) AS cents FROM (
        SELECT day, amount_cents AS c FROM payments WHERE voided_at IS NULL AND day BETWEEN ?1 AND ?2
        UNION ALL SELECT day, paid_cents FROM old_invoices WHERE day BETWEEN ?1 AND ?2 AND paid_cents > 0) GROUP BY day`).bind(r.prevFrom, r.to),
  ])
  const byDay = Object.fromEntries(perDay.results.map((x) => [x.day, x.cents / 100]))
  const days = (from, to) => { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push({ day: d, n: byDay[d] || 0 }); return out }
  const at = (p) => byPeriod.results.find((x) => x.p === p) || { cents: 0, n: 0 }
  return {
    taken: { cur: at('cur').cents / 100, prev: at('prev').cents / 100 },
    payments: at('cur').n,
    methods: byMethod.results.map((x) => ({ method: x.method, amount: x.cents / 100, n: x.n })),
    perDay: { current: days(r.from, r.to), previous: days(r.prevFrom, r.prevTo) },
  }
}

// Worked out at most every 10 minutes per period (these read the whole history).
function overview(env, r, today, key) {
  return cached(env, `dash:${today}:${key}`, 10 * 60 * 1000, async () => {
  const added = 'COALESCE(legacy_added_on, substr(created_at, 1, 10))'
  const both = [r.from, r.to, r.prevFrom, r.prevTo]
  const period = (col) => `CASE WHEN ${col} BETWEEN ?1 AND ?2 THEN 'cur' WHEN ${col} BETWEEN ?3 AND ?4 THEN 'prev' END`
  const [totals, perDay, categories, outcomes, weekdays, hours, clients] = await env.DB.batch([
    env.DB.prepare(`WITH ${VISITS}
      SELECT 'visits' AS k, ${period('day')} AS p, COUNT(*) AS n FROM visits WHERE day BETWEEN ?3 AND ?2 GROUP BY p
      UNION ALL SELECT 'services', ${period('a.day')}, COUNT(*) FROM appointment_items i JOIN appointments a ON a.id = i.appointment_id
        WHERE i.deleted_at IS NULL AND a.deleted_at IS NULL AND a.status = 'completed' AND a.day BETWEEN ?3 AND ?2 GROUP BY 2
      UNION ALL SELECT 'owners', ${period(added)}, COUNT(*) FROM owners WHERE deleted_at IS NULL AND ${added} BETWEEN ?3 AND ?2 GROUP BY 2
      UNION ALL SELECT 'pets', ${period(added)}, COUNT(*) FROM pets WHERE deleted_at IS NULL AND ${added} BETWEEN ?3 AND ?2 GROUP BY 2
      UNION ALL SELECT 'vaccinations', ${period('day')}, COUNT(*) FROM (
        SELECT pet_id, day FROM medical_entries WHERE type = 'vaccination' AND deleted_at IS NULL
        UNION SELECT a.pet_id, a.day FROM appointments a JOIN appointment_items i ON i.appointment_id = a.id
          WHERE a.status = 'completed' AND a.deleted_at IS NULL AND i.deleted_at IS NULL AND ${VACCINE_ITEM}) WHERE day BETWEEN ?3 AND ?2 GROUP BY 2`).bind(...both),
    env.DB.prepare(`WITH ${VISITS} SELECT day, COUNT(*) AS n FROM visits WHERE day BETWEEN ?1 AND ?2 GROUP BY day`).bind(r.prevFrom, r.to),
    env.DB.prepare(`SELECT COALESCE(c.name, c2.name, UPPER(TRIM(i.name))) AS name, COUNT(*) AS n
      FROM appointment_items i JOIN appointments a ON a.id = i.appointment_id
      LEFT JOIN services s ON s.id = i.service_id LEFT JOIN service_categories c ON c.id = s.category_id
      LEFT JOIN services s2 ON i.service_id IS NULL AND s2.name = i.name COLLATE NOCASE AND s2.deleted_at IS NULL
      LEFT JOIN service_categories c2 ON c2.id = s2.category_id
      WHERE i.deleted_at IS NULL AND a.deleted_at IS NULL AND a.status = 'completed' AND a.day BETWEEN ?1 AND ?2
      GROUP BY 1 ORDER BY n DESC`).bind(r.from, r.to),
    env.DB.prepare(`SELECT CASE WHEN status = 'cancelled' AND cancel_reason LIKE 'Rescheduled%' THEN 'rescheduled' ELSE status END AS s, COUNT(*) AS n
      FROM appointments WHERE deleted_at IS NULL AND day BETWEEN ?1 AND ?2 AND day < ?3 AND status IN ('completed', 'no_show', 'cancelled') GROUP BY 1`).bind(r.from, r.to, today),
    env.DB.prepare(`WITH ${VISITS} SELECT CAST(strftime('%w', day) AS INTEGER) AS d, COUNT(*) AS n FROM visits WHERE day BETWEEN ?1 AND ?2 GROUP BY d`).bind(r.from, r.to),
    env.DB.prepare(`SELECT CAST(strftime('%H', checked_in_at, '+8 hours') AS INTEGER) AS h, COUNT(*) AS n FROM appointments
      WHERE deleted_at IS NULL AND checked_in_at IS NOT NULL AND day BETWEEN ?1 AND ?2 GROUP BY h`).bind(r.from, r.to),
    env.DB.prepare(`WITH ${VISITS}, firsts AS (SELECT owner_id, MIN(day) AS first FROM visits GROUP BY owner_id)
      SELECT CASE WHEN f.first = v.day THEN 'new' ELSE 'returning' END AS k, COUNT(DISTINCT v.owner_id || ':' || v.day) AS n
      FROM visits v JOIN firsts f ON f.owner_id = v.owner_id WHERE v.day BETWEEN ?1 AND ?2 GROUP BY k`).bind(r.from, r.to),
  ])
  const t = {}
  for (const row of totals.results) if (row.p) (t[row.k] ||= { cur: 0, prev: 0 })[row.p] = row.n
  const series = (from, to) => Array.from({ length: span(from, to) + 1 }, (_, i) => addDays(from, i))
  const counts = Object.fromEntries(perDay.results.map((x) => [x.day, x.n]))
  const cats = categories.results
  const outcome = Object.fromEntries(outcomes.results.map((x) => [x.s, x.n]))
  return {
    range: r,
    today,
    totals: Object.fromEntries(['visits', 'services', 'owners', 'pets', 'vaccinations'].map((k) => [k, t[k] || { cur: 0, prev: 0 }])),
    perDay: { current: series(r.from, r.to).map((day) => ({ day, n: counts[day] || 0 })), previous: series(r.prevFrom, r.prevTo).map((day) => ({ day, n: counts[day] || 0 })) },
    categories: [...cats.slice(0, 8), ...(cats.length > 8 ? [{ name: 'Other', n: cats.slice(8).reduce((s, x) => s + x.n, 0) }] : [])],
    outcomes: { completed: outcome.completed || 0, noShow: outcome.no_show || 0, cancelled: outcome.cancelled || 0, rescheduled: outcome.rescheduled || 0 },
    weekdays: [1, 2, 3, 4, 5, 6, 0].map((d) => ({ d, n: weekdays.results.find((x) => x.d === d)?.n || 0 })),
    hours: hours.results.filter((x) => x.h != null),
    clients: { new: clients.results.find((x) => x.k === 'new')?.n || 0, returning: clients.results.find((x) => x.k === 'returning')?.n || 0 },
  }
  })
}
