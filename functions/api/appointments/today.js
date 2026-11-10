// GET /api/appointments/today
//   -> inClinic:       every pet tapped in and not yet tapped out (today's visits, plus inpatients from any day)
//      notCheckedOut:  visits from earlier days that were never tapped out, for the front desk to close
//      upcoming:       today's bookings not yet tapped in
//      counts:         today's numbers by status

import { json, manilaToday } from '../../../lib/http.js'
import { sweep, LIST_SELECT, apptOut } from '../../../lib/appointments.js'

export async function onRequestGet({ env }) {
  await sweep(env)
  const today = manilaToday()
  const [inClinic, stale, upcoming, counts] = await env.DB.batch([
    env.DB.prepare(`${LIST_SELECT} WHERE a.deleted_at IS NULL AND (
        (a.day = ? AND a.status IN ('arrived', 'started', 'dispense')) OR a.status = 'inpatient')
      ORDER BY a.emergency DESC, COALESCE(a.checked_in_at, a.starts_at)`).bind(today),
    env.DB.prepare(`${LIST_SELECT} WHERE a.deleted_at IS NULL AND a.legacy_unclosed = 0 AND a.day < ? AND a.status IN ('arrived', 'started', 'dispense')
      ORDER BY a.day DESC, a.time LIMIT 50`).bind(today),
    env.DB.prepare(`${LIST_SELECT} WHERE a.deleted_at IS NULL AND a.day = ? AND a.status IN ('pending', 'accepted')
      ORDER BY a.emergency DESC, a.time, a.id`).bind(today),
    env.DB.prepare(`SELECT status, COUNT(*) AS n FROM appointments WHERE deleted_at IS NULL AND day = ? GROUP BY status`).bind(today),
  ])
  return json({
    today,
    inClinic: inClinic.results.map(apptOut),
    notCheckedOut: stale.results.map(apptOut),
    upcoming: upcoming.results.map(apptOut),
    counts: Object.fromEntries(counts.results.map((c) => [c.status, c.n])),
  })
}
