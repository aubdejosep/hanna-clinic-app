// GET /api/inbox/attachments/:id -> an email attachment: pictures and PDFs open in the browser for every
//   staff member; other files download, for owners and admins only (logged).

import { fail, canManage, audit } from '../../../../lib/http.js'

export async function onRequestGet({ env, params, data }) {
  const a = await env.DB.prepare('SELECT r2_key, filename, content_type FROM inbox_attachments WHERE id = ?').bind(Number(params.id)).first()
  if (!a || !env.PHOTOS) return fail(404, 'This attachment was not found.')
  const obj = await env.PHOTOS.get(a.r2_key)
  if (!obj) return fail(404, 'This attachment was not found.')
  const type = a.content_type || 'application/octet-stream'
  // Images and PDFs open in the browser; anything else is offered as a file. Never run as a page.
  const inline = /^image\/(png|jpeg|gif|webp)$|^application\/pdf$/.test(type)
  // Other files can only be saved, and downloads of client files are for owners and admins (CLAUDE.md).
  if (!inline && !canManage(data.staff)) return fail(403, 'This kind of file can only be downloaded by an owner or admin.')
  if (!inline) await audit(env, data.staff.email, 'download', 'inbox_attachment', Number(params.id))
  return new Response(obj.body, { headers: {
    'Content-Type': inline ? type : 'application/octet-stream', 'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${String(a.filename || 'attachment').replace(/"/g, '')}"`,
    'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
  } })
}
