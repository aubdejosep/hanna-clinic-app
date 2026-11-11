// GET /api/pets/:id/records?day=YYYY-MM-DD
//   -> the pet's medical history (records with their entries, newest first) and its vaccinations.
//      day limits the records to one day (the appointment page uses it).

import { json, fail, isoDay, manilaToday } from '../../../../lib/http.js'
import { recordsWithEntries, entryOut } from '../../../../lib/records.js'

export async function onRequestGet({ request, env, params }) {
  const id = Number(params.id)
  const pet = await env.DB.prepare('SELECT id FROM pets WHERE id = ?').bind(id).first()
  if (!pet) return fail(404, 'This pet was not found.')
  const day = isoDay(new URL(request.url).searchParams.get('day'))
  // Booking-only records for future days are upcoming bookings (under Appointments), not history.
  const records = await recordsWithEntries(env, day ? 'pet_id = ? AND day = ?' : 'pet_id = ? AND NOT (booking_only = 1 AND day > ?)', day ? [id, day] : [id, manilaToday()])
  if (day) return json({ records })
  const { results: vacc } = await env.DB.prepare(`SELECT * FROM medical_entries WHERE pet_id = ? AND type = 'vaccination' AND deleted_at IS NULL
    ORDER BY day DESC, id DESC`).bind(id).all()
  return json({ records, vaccinations: vacc.map(entryOut) })
}
