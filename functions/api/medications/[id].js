// GET    /api/medications/:id -> one medication with dosages and variations (every staff member)
// PATCH  /api/medications/:id {name, descriptionHtml, dosages, variations} -> owners, admins and vets
// DELETE /api/medications/:id -> owners and admins; hidden, never erased

import { json, fail, readJson, canManage, audit } from '../../../lib/http.js'
import { canEditMeds, childWrites, loadMed, medInput } from '../../../lib/medications.js'

export async function onRequestGet({ env, params }) {
  const m = await loadMed(env, Number(params.id))
  return m ? json({ medication: m }) : fail(404, 'This medication was not found. It may have been removed.')
}

export async function onRequestPatch({ request, env, params, data }) {
  if (!canEditMeds(data.staff)) return fail(403, 'Only vets, owners and admins can change medications.')
  const id = Number(params.id)
  const before = await loadMed(env, id)
  if (!before) return fail(404, 'This medication was not found. It may have been removed.')
  const { values: v, dosages, variations, errors } = medInput(await readJson(request))
  if (Object.keys(errors).length) return fail(400, 'Some details need fixing.', { errors })
  await env.DB.batch([
    env.DB.prepare('UPDATE medications SET name = ?, description_html = ?, description_text = ?, updated_at = ?, updated_by = ? WHERE id = ?')
      .bind(v.name, v.description_html, v.description_text, new Date().toISOString(), data.staff.name, id),
    ...childWrites(env, id, dosages, variations),
  ])
  // The previous version is kept in the change log, dosages and variations included.
  await audit(env, data.staff.email, 'update', 'medication', id, { before: { name: before.name, dosages: before.dosages, variations: before.variations } })
  return json({ medication: await loadMed(env, id) })
}

export async function onRequestDelete({ env, params, data }) {
  if (!canManage(data.staff)) return fail(403, 'Only an owner or admin can remove medications.')
  const id = Number(params.id)
  const r = await env.DB.prepare('UPDATE medications SET deleted_at = ?, deleted_by = ? WHERE id = ? AND deleted_at IS NULL').bind(new Date().toISOString(), data.staff.name, id).run()
  if (!r.meta.changes) return fail(404, 'This medication was not found.')
  await audit(env, data.staff.email, 'delete', 'medication', id)
  return json({ ok: true })
}
