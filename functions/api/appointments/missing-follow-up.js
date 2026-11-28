// GET /api/appointments/missing-follow-up?when=all|today|week&q=&staffId=&page=&size=&countOnly=1
//
// Completed clinic visits (not legacy imports) for living pets where no later non-cancelled,
// non-no-show appointment exists for that pet. Strictly grooming-only visits are excluded
// unless a vet explicitly flagged Needs a Follow-Up on the visit.

import { json, likePattern, manilaToday } from '../../../lib/http.js'
import { LIST_SELECT, apptOut } from '../../../lib/appointments.js'
import { cached } from '../../../lib/cache.js'

const GROOMING_ITEM = `(
  i.kind <> 'product' AND (
    LOWER(COALESCE(c.name, c2.name, '')) LIKE '%groom%'
    OR LOWER(i.name) LIKE '%groom%'
    OR LOWER(i.name) LIKE '%bath%'
    OR LOWER(i.name) LIKE '%haircut%'
    OR LOWER(i.name) LIKE '%hair cut%'
    OR LOWER(i.name) LIKE '%trim%'
  )
)`

const STRICTLY_GROOMING = `(
  EXISTS (
    SELECT 1 FROM appointment_items i
    WHERE i.appointment_id = a.id AND i.deleted_at IS NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM appointment_items i
    LEFT JOIN services s ON s.id = i.service_id
    LEFT JOIN service_categories c ON c.id = s.category_id
    LEFT JOIN services s2 ON i.service_id IS NULL AND s2.name = i.name COLLATE NOCASE AND s2.deleted_at IS NULL
    LEFT JOIN service_categories c2 ON c2.id = s2.category_id
    WHERE i.appointment_id = a.id AND i.deleted_at IS NULL AND NOT ${GROOMING_ITEM}
  )
)`

const LATER_BOOKING = `EXISTS (
  SELECT 1 FROM appointments b
  WHERE b.pet_id = a.pet_id
    AND b.id <> a.id
    AND b.deleted_at IS NULL
    AND b.day > a.day
    AND b.status NOT IN ('cancelled', 'no_show')
)`

const BASE_WHERE = `
  a.deleted_at IS NULL
  AND a.source <> 'legacy'
  AND a.status = 'completed'
  AND p.deleted_at IS NULL
  AND p.deceased_on IS NULL
  AND o.deleted_at IS NULL
  AND NOT ${LATER_BOOKING}
  AND (a.follow_up_days IS NOT NULL OR NOT ${STRICTLY_GROOMING})
`

function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

async function computeCounts(env, today, extraWhere = '', binds = []) {
  const weekFrom = addDays(today, -6)
  const row = await env.DB.prepare(`
    SELECT
      COUNT(*) AS all_count,
      COALESCE(SUM(CASE WHEN a.day = ? THEN 1 ELSE 0 END), 0) AS today_count,
      COALESCE(SUM(CASE WHEN a.day >= ? AND a.day <= ? THEN 1 ELSE 0 END), 0) AS week_count
    FROM appointments a
    JOIN pets p ON p.id = a.pet_id
    JOIN owners o ON o.id = a.owner_id
    WHERE ${BASE_WHERE}${extraWhere}
  `).bind(today, weekFrom, today, ...binds).first()
  return {
    all: Number(row?.all_count || 0),
    today: Number(row?.today_count || 0),
    week: Number(row?.week_count || 0),
  }
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url)
  const p = url.searchParams
  const today = manilaToday()
  const fresh = p.get('fresh') === '1'

  if (p.get('countOnly') === '1') {
    const counts = await cached(env, 'missing_follow_up', 60 * 1000, () => computeCounts(env, today), { fresh })
    return json({ total: counts.all, counts, today })
  }

  const when = ['today', 'week', 'all'].includes(p.get('when')) ? p.get('when') : 'all'
  const extraWhere = []
  const extraBinds = []

  const like = likePattern(p.get('q'))
  if (like) {
    const { results } = await env.DB.prepare(`
      SELECT a.id FROM appointments a WHERE a.pet_id IN (SELECT id FROM pets WHERE name LIKE ?1)
      UNION SELECT a.id FROM appointments a WHERE a.owner_id IN (SELECT id FROM owners WHERE full_name LIKE ?1 OR customer_no LIKE ?1)
      UNION SELECT appointment_id FROM appointment_items WHERE deleted_at IS NULL AND (name LIKE ?1 OR detail LIKE ?1)
      LIMIT 5000
    `).bind(like).all()
    extraWhere.push(results.length ? `a.id IN (${results.map((r) => Number(r.id)).join(',')})` : '0')
  }

  const staffId = Number(p.get('staffId'))
  if (staffId) {
    extraWhere.push('EXISTS (SELECT 1 FROM appointment_staff x WHERE x.appointment_id = a.id AND x.staff_id = ?)')
    extraBinds.push(staffId)
  }

  const extraSql = extraWhere.length ? ` AND ${extraWhere.join(' AND ')}` : ''
  const filtered = extraWhere.length > 0

  const counts = filtered
    ? await computeCounts(env, today, extraSql, extraBinds)
    : await cached(env, 'missing_follow_up', 60 * 1000, () => computeCounts(env, today), { fresh })

  const listWhere = [BASE_WHERE]
  const listBinds = []
  if (extraWhere.length) {
    listWhere.push(...extraWhere)
    listBinds.push(...extraBinds)
  }
  if (when === 'today') {
    listWhere.push('a.day = ?')
    listBinds.push(today)
  } else if (when === 'week') {
    listWhere.push('a.day >= ? AND a.day <= ?')
    listBinds.push(addDays(today, -6), today)
  }

  const size = Math.min(100, Math.max(1, Number(p.get('size')) || 25))
  const page = Math.max(1, Number(p.get('page')) || 1)
  const total = counts[when] ?? counts.all

  const { results: rows } = await env.DB.prepare(`
    ${LIST_SELECT}
    WHERE ${listWhere.join(' AND ')}
    ORDER BY a.day DESC, a.time DESC, a.id DESC
    LIMIT ? OFFSET ?
  `).bind(...listBinds, size, (page - 1) * size).all()

  return json({
    page,
    pageSize: size,
    total,
    counts,
    today,
    appointments: rows.map(apptOut),
  })
}
