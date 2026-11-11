// GET /api/appointments/by-ref?ref=BK-XXXXXX -> the appointments made from one website booking
//   (one per pet). The website's staff email links here, so if the booking hasn't been picked up yet,
//   this fetches the website's new bookings first.

import { json, fail, clean } from '../../../lib/http.js'
import { pullWebsiteBookings } from '../../../lib/website.js'

const find = (env, ref) => env.DB.prepare(`SELECT a.id, a.day, a.time, a.status, p.name AS pet_name FROM appointments a INDEXED BY idx_appointments_external
  JOIN pets p ON p.id = a.pet_id WHERE a.external_ref >= ? AND a.external_ref < ? AND +a.deleted_at IS NULL ORDER BY a.external_ref`)
  .bind(`${ref}#`, `${ref}$`).all()

export async function onRequestGet({ request, env }) {
  const ref = clean(new URL(request.url).searchParams.get('ref'), 20).toUpperCase()
  if (!/^BK-[A-Z0-9]{4,12}$/.test(ref)) return fail(400, 'That booking reference doesn’t look right. It starts with BK-.')
  let { results } = await find(env, ref)
  if (!results.length) {
    await pullWebsiteBookings(env, { force: true }).catch((err) => console.log('Website bookings', String(err).slice(0, 300)))
    results = (await find(env, ref)).results
  }
  return json({ ref, appointments: results.map((r) => ({ id: r.id, day: r.day, time: r.time, status: r.status, pet: r.pet_name })) })
}
