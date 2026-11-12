// POST /api/content/events {kind: promo|event, title, from, to, note} -> owners and admins: a promo
//   or clinic event shown across those days on the content calendar.

import { json, fail, readJson, clean, cleanMultiline, canManage, audit } from '../../../../lib/http.js'
import { DAY, eventOut } from '../../../../lib/content.js'

export function eventInput(b) {
  const errors = {}
  const title = clean(b?.title, 120)
  if (!title) errors.title = 'Name it, e.g. 50% off spay/neuter and dental.'
  if (!DAY.test(b?.from || '')) errors.from = 'Choose the first day.'
  if (!DAY.test(b?.to || '')) errors.to = 'Choose the last day.'
  else if (b.to < b.from) errors.to = 'Make the last day the same as or after the first.'
  return { errors, values: { kind: b?.kind === 'event' ? 'event' : 'promo', title, start_day: b?.from, end_day: b?.to, note: cleanMultiline(b?.note, 500) || null } }
}

export async function onRequestPost({ request, env, data }) {
  if (!canManage(data.staff)) return fail(403, 'Only an owner or admin can add promos and events.')
  const { errors, values: v } = eventInput(await readJson(request))
  if (Object.keys(errors).length) return fail(400, 'Some details need fixing.', { errors })
  const e = await env.DB.prepare('INSERT INTO content_events (branch_id, kind, title, start_day, end_day, note, created_by) VALUES (1, ?, ?, ?, ?, ?, ?) RETURNING *')
    .bind(v.kind, v.title, v.start_day, v.end_day, v.note, data.staff.name).first()
  await audit(env, data.staff.email, 'create', 'content_event', e.id, { title: v.title })
  return json({ event: eventOut(e) }, 201)
}
