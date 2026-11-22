// POST   /api/appointments/:id/record/:entryId/photos (the image as the body) -> adds a photo to what a vet wrote
//        (a diagnosis, note, prescription or treatment plan): lab results, X-rays, skin, wounds…
// DELETE /api/appointments/:id/record/:entryId/photos?imageId= -> takes a photo off (kept in storage, marked removed)
// Vets, owners and admins, like writing the record. Shown with the entry (lib/records.js attachImages); viewed and,
// for owners and admins, downloaded through /api/photos/:id.

import { json, fail, audit } from '../../../../../../lib/http.js'
import { WRITERS } from '../../../../../../lib/recordInput.js'

const MAX = 8 * 1024 * 1024
const TYPES = ['image/jpeg', 'image/png', 'image/webp']

async function load(env, params) {
  return env.DB.prepare(`SELECT e.*, m.id AS rec_id FROM medical_entries e JOIN medical_records m ON m.id = e.record_id
    WHERE e.id = ? AND m.appointment_id = ? AND m.source = 'staff' AND e.deleted_at IS NULL`).bind(Number(params.entryId), Number(params.id)).first()
}
const recount = (env, entryId) => env.DB.prepare('UPDATE medical_entries SET image_count = (SELECT COUNT(*) FROM medical_images WHERE entry_id = ?1 AND deleted_at IS NULL) WHERE id = ?1').bind(entryId)

export async function onRequestPost({ request, env, params, data }) {
  if (!WRITERS.includes(data.staff.role)) return fail(403, 'Only vets and clinic owners add photos to medical records.')
  if (!env.PHOTOS) return fail(503, "Photo storage isn't connected yet.")
  const e = await load(env, params)
  if (!e) return fail(404, 'This entry was not found. Reload the page.')
  if (e.auto) return fail(400, 'Photos go on what a vet wrote (a diagnosis or note).')
  const type = (request.headers.get('Content-Type') || '').split(';')[0].trim()
  if (!TYPES.includes(type)) return fail(400, 'Upload a photo (JPG, PNG or WebP).')
  const body = await request.arrayBuffer()
  if (!body.byteLength) return fail(400, 'The photo was empty. Try again.')
  if (body.byteLength > MAX) return fail(400, 'This photo is too big (over 8 MB). Try again: the app makes photos smaller first.')
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM medical_images WHERE entry_id = ? AND deleted_at IS NULL').bind(e.id).first()
  if (n.n >= 20) return fail(400, 'Up to 20 photos per entry. Add a new entry for more.')
  const key = `staff/${e.rec_id}/${e.id}-${Date.now()}.${type.split('/')[1].replace('jpeg', 'jpg')}`
  await env.PHOTOS.put(key, body, { httpMetadata: { contentType: type } })
  const w = Number(request.headers.get('X-Width')) || null
  const h = Number(request.headers.get('X-Height')) || null
  const [row] = await env.DB.batch([
    env.DB.prepare(`INSERT INTO medical_images (record_id, entry_id, pet_id, key, content_type, bytes, width, height, sort, source, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'staff', ?) RETURNING id`).bind(e.rec_id, e.id, e.pet_id, key, type, body.byteLength, w, h, n.n, data.staff.name),
    recount(env, e.id),
  ])
  const id = row.results[0].id
  await audit(env, data.staff.email, 'add_photo', 'medical_image', id, { entry: e.id, appointment: Number(params.id) })
  return json({ image: { id, width: w, height: h, bytes: body.byteLength } }, 201)
}

export async function onRequestDelete({ request, env, params, data }) {
  if (!WRITERS.includes(data.staff.role)) return fail(403, 'Only vets and clinic owners edit medical records.')
  const e = await load(env, params)
  if (!e) return fail(404, 'This entry was not found. Reload the page.')
  const imageId = Number(new URL(request.url).searchParams.get('imageId'))
  const gone = await env.DB.prepare('UPDATE medical_images SET deleted_at = ?, deleted_by = ? WHERE id = ? AND entry_id = ? AND deleted_at IS NULL').bind(new Date().toISOString(), data.staff.name, imageId, e.id).run()
  if (!gone.meta?.changes) return fail(404, 'This photo was not found. Reload the page.')
  await recount(env, e.id).run()
  await audit(env, data.staff.email, 'remove_photo', 'medical_image', imageId, { entry: e.id })
  return json({ ok: true })
}
