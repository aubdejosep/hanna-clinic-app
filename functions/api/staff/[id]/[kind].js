// GET    /api/staff/:id/photo | signature  -> the image (any logged-in staff; signatures go on printouts)
// PUT    /api/staff/:id/photo | signature  {dataUrl} -> replaces it (owners only)
// DELETE /api/staff/:id/photo | signature  -> clears it (owners only)

import { json, fail, readJson, canManage, audit } from '../../../../lib/http.js'
import { parseImage } from '../../../../lib/staffing.js'

const KINDS = ['photo', 'signature']

export async function onRequestGet({ env, params }) {
  if (!KINDS.includes(params.kind)) return fail(404, 'Not found.')
  const row = await env.DB.prepare('SELECT mime, data FROM staff_images WHERE staff_id = ? AND kind = ?').bind(Number(params.id), params.kind).first()
  if (!row) return fail(404, 'No image yet.')
  const bytes = Uint8Array.from(atob(row.data), (c) => c.charCodeAt(0))
  return new Response(bytes, { headers: { 'Content-Type': row.mime, 'Cache-Control': 'private, max-age=300' } })
}

export async function onRequestPut({ request, env, params, data }) {
  if (!KINDS.includes(params.kind)) return fail(404, 'Not found.')
  if (!canManage(data.staff)) return fail(403, 'Only a clinic owner can change staff photos and signatures.')
  const img = parseImage((await readJson(request))?.dataUrl)
  if (!img) return fail(400, 'Use a JPG, PNG or WebP image under 300 KB.')
  const id = Number(params.id)
  await env.DB.prepare(`INSERT INTO staff_images (staff_id, kind, mime, data, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (staff_id, kind) DO UPDATE SET mime = excluded.mime, data = excluded.data, updated_at = excluded.updated_at`)
    .bind(id, params.kind, img.mime, img.data, new Date().toISOString()).run()
  await audit(env, data.staff.email, `set_${params.kind}`, 'staff', id)
  return json({ ok: true })
}

export async function onRequestDelete({ env, params, data }) {
  if (!KINDS.includes(params.kind)) return fail(404, 'Not found.')
  if (!canManage(data.staff)) return fail(403, 'Only a clinic owner can change staff photos and signatures.')
  const id = Number(params.id)
  await env.DB.prepare('DELETE FROM staff_images WHERE staff_id = ? AND kind = ?').bind(id, params.kind).run()
  await audit(env, data.staff.email, `clear_${params.kind}`, 'staff', id)
  return json({ ok: true })
}
