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
    // Ids from two index lookups: an OR across day and status would read every appointment.
    env.DB.prepare(`${LIST_SELECT} WHERE a.id IN (SELECT id FROM appointments WHERE day = ?1 AND status IN ('arrived', 'started', 'dispense')
        UNION SELECT id FROM appointments WHERE status = 'inpatient') AND +a.deleted_at IS NULL
      ORDER BY a.emergency DESC, COALESCE(a.checked_in_at, a.starts_at)`).bind(today),
    env.DB.prepare(`${LIST_SELECT} WHERE +a.deleted_at IS NULL AND a.legacy_unclosed = 0 AND a.day < ? AND a.status IN ('arrived', 'started', 'dispense')
      ORDER BY a.day DESC, a.time LIMIT 50`).bind(today),
    env.DB.prepare(`${LIST_SELECT} WHERE +a.deleted_at IS NULL AND a.day = ? AND a.status IN ('pending', 'accepted')
      ORDER BY a.emergency DESC, a.time, a.id`).bind(today),
    env.DB.prepare(`SELECT status, COUNT(*) AS n FROM appointments INDEXED BY idx_appointments_day WHERE day = ? AND deleted_at IS NULL GROUP BY status`).bind(today),
  ])
  return json({
    today,
    inClinic: inClinic.results.map(apptOut),
    notCheckedOut: stale.results.map(apptOut),
    upcoming: upcoming.results.map(apptOut),
    counts: Object.fromEntries(counts.results.map((c) => [c.status, c.n])),
  })
}
