// GET /api/analytics/customers?range=mtd|7d|30d|last_month|ytd -> Client Portal ▸ Customer Analytics (owners only).
//
// A visit is an owner seen on a day: a medical record (the old history) or a checked-out appointment.
// A client is "added" on the day they joined (old system date for imported clients).
// Spending comes only from payments taken in the app (they started with the Inventory release).
// Worked out at most every 10 minutes per period: it reads the whole visit history.

import { json, fail, canManage, manilaToday } from '../../../lib/http.js'
import { cached } from '../../../lib/cache.js'
import { localMobile } from '../../../lib/clients.js'
import { addDays, ranges } from '../dashboard.js'

const SOURCE = { legacy: 'Old System', staff: 'Registered at the Desk', website: 'Website Booking', walk_in: 'Kiosk Sign-Up' }
const span = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5)
const monthAdd = (ym, k) => { const d = new Date(`${ym}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + k); return d.toISOString().slice(0, 7) }

export async function onRequestGet({ request, env, data }) {
  if (!canManage(data.staff)) return fail(403, 'Customer Analytics is for the clinic owners.')
  const today = manilaToday()
  const key = new URL(request.url).searchParams.get('range') || 'mtd'
  const r = ranges(key, today)
  return json(await cached(env, `cust:${today}:${key}`, 10 * 60 * 1000, async () => {
    const [ownersQ, visitsQ, paidQ, petsQ] = await env.DB.batch([
      env.DB.prepare(`SELECT id, full_name, customer_no, mobile, source, COALESCE(legacy_added_on, substr(created_at, 1, 10)) AS added FROM owners WHERE deleted_at IS NULL`),
      env.DB.prepare(`SELECT owner_id, day FROM medical_records WHERE deleted_at IS NULL AND booking_only = 0 AND day <= ?1
        UNION SELECT owner_id, day FROM appointments WHERE status = 'completed' AND deleted_at IS NULL AND day <= ?1`).bind(today),
      env.DB.prepare(`SELECT a.owner_id, SUM(p.amount_cents) AS cents, MIN(p.day) AS first FROM payments p JOIN appointments a ON a.id = p.appointment_id
        WHERE p.voided_at IS NULL AND p.day BETWEEN ?1 AND ?2 GROUP BY a.owner_id`).bind(r.from, r.to),
      env.DB.prepare('SELECT owner_id, COUNT(*) AS n FROM pets WHERE deleted_at IS NULL AND deceased_on IS NULL GROUP BY owner_id'),
    ])
    const owners = new Map(ownersQ.results.map((o) => [o.id, o]))
    const days = new Map() // owner -> sorted visit days
    for (const v of visitsQ.results) if (owners.has(v.owner_id)) (days.get(v.owner_id) || days.set(v.owner_id, []).get(v.owner_id)).push(v.day)
    for (const list of days.values()) list.sort()
    const inRange = (d, a, b) => d >= a && d <= b
    const pets = Object.fromEntries(petsQ.results.map((p) => [p.owner_id, p.n]))

    // Tiles
    const added = (a, b) => ownersQ.results.filter((o) => inRange(o.added, a, b))
    const seen = (a, b) => [...days.entries()].filter(([, l]) => l.some((d) => inRange(d, a, b)))
    const seenCur = seen(r.from, r.to)
    const seenPrev = seen(r.prevFrom, r.prevTo)
    const returning = seenCur.filter(([, l]) => l[0] < r.from).length
    const repeat = seenCur.filter(([, l]) => l.filter((d) => inRange(d, r.from, r.to)).length >= 2).length
    const paid = paidQ.results
    const revenue = paid.reduce((n, p) => n + p.cents, 0)
    const active = [...days.values()].filter((l) => span(l[l.length - 1], today) <= 180).length
    const lapsedList = [...days.entries()].filter(([, l]) => { const g = span(l[l.length - 1], today); return g > 180 && g <= 548 })
    const never = ownersQ.results.filter((o) => !days.has(o.id)).length

    // Cohorts: clients added each month (the last 13 months), and the share seen again in each later month.
    const thisMonth = today.slice(0, 7)
    const cohorts = []
    for (let k = 12; k >= 0; k--) {
      const ym = monthAdd(thisMonth, -k)
      const members = ownersQ.results.filter((o) => o.added?.slice(0, 7) === ym)
      const months = []
      for (let m = 1; m <= 12; m++) {
        const target = monthAdd(ym, m)
        if (target > thisMonth) break
        const back = members.filter((o) => (days.get(o.id) || []).some((d) => d.slice(0, 7) === target)).length
        months.push({ m, n: back, pct: members.length ? Math.round((back / members.length) * 1000) / 10 : 0, partial: target === thisMonth })
      }
      cohorts.push({ month: ym, size: members.length, months })
    }

    // New clients per day (this period and the one before), and where they came from.
    const series = (a, b) => Array.from({ length: span(a, b) + 1 }, (_, i) => addDays(a, i))
    const perDay = {}
    for (const o of ownersQ.results) perDay[o.added] = (perDay[o.added] || 0) + 1
    const sources = {}
    for (const o of added(r.from, r.to)) sources[o.source] = (sources[o.source] || 0) + 1

    // Top clients this period: most visit days, then spending.
    const spent = Object.fromEntries(paid.map((p) => [p.owner_id, p.cents / 100]))
    const person = (id) => { const o = owners.get(id); return { id, name: o.full_name, customerNo: o.customer_no, mobile: localMobile(o.mobile) } }
    const top = seenCur.map(([id, l]) => ({ ...person(id), visits: l.filter((d) => inRange(d, r.from, r.to)).length, spent: spent[id] || 0, lastVisit: l[l.length - 1] }))
      .sort((a, b) => b.visits - a.visits || b.spent - a.spent || a.name.localeCompare(b.name)).slice(0, 10)

    // Win back: came at least twice, last seen 6 to 18 months ago, still with a pet on file.
    const winBack = lapsedList.filter(([id, l]) => l.length >= 2 && pets[id])
      .map(([id, l]) => ({ ...person(id), visits: l.length, lastVisit: l[l.length - 1], pets: pets[id] }))
      .sort((a, b) => b.visits - a.visits || b.lastVisit.localeCompare(a.lastVisit)).slice(0, 10)

    return {
      range: r,
      tiles: {
        newClients: { cur: added(r.from, r.to).length, prev: added(r.prevFrom, r.prevTo).length },
        clientsSeen: { cur: seenCur.length, prev: seenPrev.length },
        returning: { n: returning, of: seenCur.length },
        repeat: { n: repeat, of: seenCur.length },
        revenuePerClient: paid.length ? Math.round(revenue / paid.length) / 100 : null,
        paidClients: paid.length,
        active, lapsed: lapsedList.length, never, total: ownersQ.results.length,
      },
      cohorts,
      acquisition: { current: series(r.from, r.to).map((day) => ({ day, n: perDay[day] || 0 })), previous: series(r.prevFrom, r.prevTo).map((day) => ({ day, n: perDay[day] || 0 })) },
      sources: Object.entries(sources).map(([k, n]) => ({ name: SOURCE[k] || k, n })).sort((a, b) => b.n - a.n),
      top,
      winBack,
    }
  }))
}
