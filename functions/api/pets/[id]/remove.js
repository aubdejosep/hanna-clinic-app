// POST /api/pets/:id/remove {reason: 'passed_away', date} -> keeps the pet and its history, marked as passed away
// POST /api/pets/:id/remove {reason: 'mistake'}            -> hides the pet (added by mistake or a duplicate)
// Nothing is erased. Owners and admins only. A passed-away pet is undone from Edit (clear the date);
// a hidden pet comes back with POST /api/pets/:id/restore.

import { json, fail, readJson, canManage, audit, isoDay, manilaToday } from '../../../../lib/http.js'

export async function onRequestPost({ request, env, params, data }) {
  if (!canManage(data.staff)) return fail(403, 'Only a clinic owner can remove pets. Ask one of them to do it.')
  const id = Number(params.id)
  const body = (await readJson(request)) || {}

  if (body.reason === 'passed_away') {
    const day = body.date ? isoDay(body.date) : manilaToday()
    if (!day || day > manilaToday()) return fail(400, "Enter a date that isn't in the future.", { errors: { date: "Enter a date that isn't in the future." } })
    const res = await env.DB.prepare('UPDATE pets SET deceased_on = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
      .bind(day, new Date().toISOString(), id).run()
    if (!res.meta.changes) return fail(404, 'This pet was not found. It may have been removed.')
    await audit(env, data.staff.email, 'passed_away', 'pet', id, { date: day })
    return json({ ok: true })
  }
  if (body.reason !== 'mistake') return fail(400, 'Choose why this pet is being removed.')

  const res = await env.DB.prepare('UPDATE pets SET deleted_at = ?, deleted_by = ? WHERE id = ? AND deleted_at IS NULL')
    .bind(new Date().toISOString(), data.staff.name, id).run()
  if (!res.meta.changes) return fail(404, 'This pet was not found, or was already removed.')
  await audit(env, data.staff.email, 'remove', 'pet', id)
  return json({ ok: true })
}
