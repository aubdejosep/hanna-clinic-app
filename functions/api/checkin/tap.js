// POST /api/checkin/tap {uid}  -> what an NFC tag tap at the front desk did
//
// One reader for both directions:
//   * the pet has a visit open today (or is an inpatient) -> tap out: Completed, but only from
//       Dispense with the payment taken (a checked-out visit is final). Otherwise nothing changes:
//       not_ready (still Waiting, With Vet or Inpatient) or not_paid (at Dispense, Take Payment first).
//       A tap less than 5 minutes after check-in is a double tap: ignored.
//   * the pet has a booking today -> tap in: Arrived
//   * neither -> no_booking: the screen offers a one-tap Walk In
//   * the tag isn't assigned -> unknown_tag: the screen offers Assign Tag
// result: checked_in | checked_out | ignored | not_ready | not_paid | no_booking | unknown_tag | pet_unavailable

import { json, fail, readJson, clean, manilaToday, audit } from '../../../lib/http.js'
import { moveTo, loadAppointment } from '../../../lib/appointments.js'

const DOUBLE_TAP_MS = 5 * 60 * 1000

export async function onRequestPost({ request, env, data }) {
  const body = (await readJson(request)) || {}
  const uid = clean(body.uid, 64).toUpperCase()
  if (!uid) return fail(400, 'No tag was read. Tap it again.')
  const actor = `${data.staff.name} (tag)`

  const pet = await env.DB.prepare(`SELECT p.id, p.name, p.species, p.deceased_on, p.deleted_at, o.full_name AS owner_name, o.deleted_at AS owner_removed
    FROM pet_tags t JOIN pets p ON p.id = t.pet_id JOIN owners o ON o.id = p.owner_id
    WHERE t.uid = ? AND t.retired_at IS NULL`).bind(uid).first()
  if (!pet) return json({ result: 'unknown_tag', uid })
  const petInfo = { id: pet.id, name: pet.name, species: pet.species, ownerName: pet.owner_name }
  if (pet.deleted_at || pet.owner_removed || pet.deceased_on) return json({ result: 'pet_unavailable', uid, pet: petInfo })

  const today = manilaToday()
  const open = await env.DB.prepare(`SELECT * FROM appointments WHERE pet_id = ? AND deleted_at IS NULL
    AND ((day = ? AND status IN ('arrived', 'started', 'dispense')) OR status = 'inpatient')
    ORDER BY COALESCE(checked_in_at, starts_at) DESC LIMIT 1`).bind(pet.id, today).first()
  if (open) {
    if (open.checked_in_at && Date.now() - Date.parse(open.checked_in_at) < DOUBLE_TAP_MS) {
      return json({ result: 'ignored', uid, pet: petInfo, appointment: await loadAppointment(env, open.id) })
    }
    if (open.status !== 'dispense') return json({ result: 'not_ready', uid, pet: petInfo, appointment: await loadAppointment(env, open.id) })
    if (!['paid', 'not_tracked'].includes(open.payment_status)) return json({ result: 'not_paid', uid, pet: petInfo, appointment: await loadAppointment(env, open.id) })
    const res = await moveTo(env, open, 'completed', { via: 'tag', actor, staffId: data.staff.id })
    if (res.error) return fail(400, res.error)
    await audit(env, data.staff.email, 'tap_out', 'appointment', open.id, { uid })
    return json({ result: 'checked_out', uid, pet: petInfo, appointment: await loadAppointment(env, open.id) })
  }

  const booked = await env.DB.prepare(`SELECT * FROM appointments WHERE pet_id = ? AND day = ? AND deleted_at IS NULL
    AND status IN ('pending', 'accepted', 'no_show') ORDER BY time, id LIMIT 1`).bind(pet.id, today).first()
  if (booked) {
    const res = await moveTo(env, booked, 'arrived', { via: 'tag', actor })
    if (res.error) return fail(400, res.error)
    await audit(env, data.staff.email, 'tap_in', 'appointment', booked.id, { uid })
    return json({ result: 'checked_in', uid, pet: petInfo, appointment: await loadAppointment(env, booked.id) })
  }
  const done = await env.DB.prepare(`SELECT id FROM appointments WHERE pet_id = ? AND day = ? AND status = 'completed' AND deleted_at IS NULL LIMIT 1`).bind(pet.id, today).first()
  return json({ result: 'no_booking', uid, pet: petInfo, completedToday: !!done })
}
