// POST   /api/pets/:id/tag {uid, move}  -> gives this pet the NFC tag (its old tag is retired).
//        If the tag belongs to another pet, answers 409 unless move is true.
// DELETE /api/pets/:id/tag              -> retires this pet's tag (lost or broken)

import { json, fail, readJson, clean, audit } from '../../../../lib/http.js'

export async function onRequestPost({ request, env, params, data }) {
  const id = Number(params.id)
  const body = (await readJson(request)) || {}
  const uid = clean(body.uid, 64).toUpperCase()
  if (!uid) return fail(400, 'No tag was read. Tap it again.')
  const pet = await env.DB.prepare('SELECT id, name FROM pets WHERE id = ? AND deleted_at IS NULL').bind(id).first()
  if (!pet) return fail(404, 'This pet was not found. It may have been removed.')

  const current = await env.DB.prepare(`SELECT t.uid, t.pet_id, t.retired_at, p.name FROM pet_tags t JOIN pets p ON p.id = t.pet_id WHERE t.uid = ?`).bind(uid).first()
  if (current && current.pet_id === id) {
    if (!current.retired_at) return json({ ok: true, uid })
  }
  if (current && current.pet_id !== id && !body.move) {
    const live = await env.DB.prepare('SELECT 1 FROM pet_tags WHERE uid = ? AND retired_at IS NULL').bind(uid).first()
    if (live) return fail(409, `This tag belongs to ${current.name}. Move it to ${pet.name}?`, { otherPet: { id: current.pet_id, name: current.name } })
  }
  const now = new Date().toISOString()
  await env.DB.batch([
    env.DB.prepare('UPDATE pet_tags SET retired_at = ? WHERE pet_id = ? AND retired_at IS NULL').bind(now, id),
    env.DB.prepare('DELETE FROM pet_tags WHERE uid = ?').bind(uid), // the uid is the key: the row moves to this pet
    env.DB.prepare('INSERT INTO pet_tags (uid, pet_id, assigned_at, assigned_by) VALUES (?, ?, ?, ?)').bind(uid, id, now, data.staff.email),
  ])
  await audit(env, data.staff.email, 'assign_tag', 'pet', id, { uid, from: current && current.pet_id !== id ? current.pet_id : null })
  return json({ ok: true, uid })
}

export async function onRequestDelete({ env, params, data }) {
  const id = Number(params.id)
  const res = await env.DB.prepare('UPDATE pet_tags SET retired_at = ? WHERE pet_id = ? AND retired_at IS NULL').bind(new Date().toISOString(), id).run()
  if (!res.meta.changes) return fail(404, 'This pet has no tag.')
  await audit(env, data.staff.email, 'retire_tag', 'pet', id, null)
  return json({ ok: true })
}
