// POST /api/clinic/closed-dates {day, open, close, reason}  -> owners only. Adds a closed date
//      (open and close empty = closed all day) or special hours for one day (both set).
//      The website's /book reads these: closed days can't be booked; special-hours days use those hours.

import { json, fail, readJson, clean, isoDay, canManage, manilaToday, audit } from '../../../lib/http.js'
import { loadClinic } from '../../../lib/clinic.js'

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

export async function onRequestPost({ request, env, data }) {
  if (!canManage(data.staff)) return fail(403, 'Only a clinic owner can change opening hours.')
  const body = (await readJson(request)) || {}
  const day = isoDay(body.day)
  const open = clean(body.open, 5) || null
  const close = clean(body.close, 5) || null
  const reason = clean(body.reason, 80) || null
  const errors = {}
  if (!day) errors.day = 'Choose the date.'
  else if (day < manilaToday()) errors.day = 'Choose today or a later date.'
  if (open || close) {
    if (!TIME.test(open || '') || !TIME.test(close || '') || open >= close) errors.hours = 'Enter an opening time before the closing time, or choose Closed All Day.'
  }
  if (!reason) errors.reason = 'Add a short reason clients will see, e.g. Christmas Day.'
  if (Object.keys(errors).length) return fail(400, 'Some details need fixing.', { errors })
  const clash = await env.DB.prepare('SELECT id FROM closed_dates WHERE branch_id = 1 AND day = ? AND deleted_at IS NULL').bind(day).first()
  if (clash) return fail(409, 'That date is already on the list. Remove it first to change it.', { errors: { day: 'Already on the list.' } })
  const row = await env.DB.prepare('INSERT INTO closed_dates (branch_id, day, open, close, reason, created_by) VALUES (1, ?, ?, ?, ?, ?) RETURNING id')
    .bind(day, open, close, reason, data.staff.name).first()
  await audit(env, data.staff.email, 'create', 'closed_date', row.id, { day, open, close, reason })
  return json({ clinic: await loadClinic(env) }, 201)
}
