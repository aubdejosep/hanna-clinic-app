// GET /api/board -> today's clinic, station by station, like an assembly line:
//   waiting (tapped in, in arrival order, emergencies first) -> with vet -> inpatient -> dispense -> done today.
//   Each visit carries its unfinished steps, so they stay in view until done.
//   upcoming: bookings not yet tapped in, from later today through the next 5 days (no further),
//   so the front desk sees what's coming without the far future.

import { json, manilaToday } from '../../lib/http.js'
import { sweep, LIST_SELECT, apptOut } from '../../lib/appointments.js'
import { computeReminders } from '../../lib/reminders.js'

export async function onRequestGet({ env }) {
  await sweep(env)
  const today = manilaToday()
  const until = new Date(Date.parse(`${today}T00:00:00Z`) + 5 * 864e5).toISOString().slice(0, 10)
  const { results } = await env.DB.prepare(`${LIST_SELECT}
    WHERE a.id IN (SELECT id FROM appointments WHERE day = ?1 AND status IN ('arrived', 'started', 'dispense', 'completed')
      UNION SELECT id FROM appointments WHERE status = 'inpatient') AND +a.deleted_at IS NULL
    ORDER BY a.emergency DESC, COALESCE(a.checked_in_at, a.starts_at), a.id`).bind(today).all()
  const ids = results.map((r) => r.id)
  const extra = ids.length ? (await env.DB.prepare(`SELECT a.id, a.follow_up_days, a.weight_kg, p.breed, p.weight_kg AS pet_weight, o.mobile, o.email
    FROM appointments a JOIN pets p ON p.id = a.pet_id JOIN owners o ON o.id = a.owner_id WHERE a.id IN (${ids.join(',')})`).all()).results : []
  const byId = Object.fromEntries(extra.map((e) => [e.id, e]))
  const reminders = ids.length ? await computeReminders(env, { appointmentIds: ids }) : []
  const stations = { waiting: [], with_vet: [], inpatient: [], dispense: [], done: [] }
  const station = { arrived: 'waiting', started: 'with_vet', inpatient: 'inpatient', dispense: 'dispense', completed: 'done' }
  for (const r of results) {
    const a = apptOut(r)
    const x = byId[r.id] || {}
    const steps = reminders.filter((m) => m.appointmentId === r.id).map((m) => ({ kind: m.kind, text: m.action }))
    if (!x.breed) steps.push({ kind: 'pet_info', text: 'Add Breed' })
    if (x.weight_kg == null && x.pet_weight == null) steps.push({ kind: 'pet_info', text: 'Weigh Pet' })
    else if (x.weight_kg == null && ['arrived', 'started'].includes(a.status)) steps.push({ kind: 'weight', text: 'Weigh Today' })
    if (!x.mobile) steps.push({ kind: 'owner_info', text: 'Add Mobile' })
    if (!x.email) steps.push({ kind: 'owner_info', text: 'Add Email' })
    if (a.status === 'started' && !a.staff.length) steps.push({ kind: 'no_vet', text: 'Assign Vet' })
    stations[station[a.status]].push({ ...a, weightKg: x.weight_kg ?? null, petWeightKg: x.pet_weight ?? null, followUpDays: x.follow_up_days ?? null, steps })
  }
  const { results: soon } = await env.DB.prepare(`${LIST_SELECT}
    WHERE a.id IN (SELECT id FROM appointments INDEXED BY idx_appointments_day WHERE day BETWEEN ?1 AND ?2 AND status IN ('pending', 'accepted'))
      AND +a.deleted_at IS NULL ORDER BY a.day, a.emergency DESC, a.time, a.id LIMIT 200`).bind(today, until).all()
  return json({ today, until, stations, upcoming: soon.map(apptOut) })
}
