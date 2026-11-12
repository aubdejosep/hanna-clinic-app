// GET /api/content/media/:id -> a post's slide, reel or cover (logged-in staff only, like every /api route).
//   Supports Range requests so reels play and seek. ?download=1 saves it under its file name.

import { fail } from '../../../../lib/http.js'

export async function onRequestGet({ env, params, request }) {
  const row = await env.DB.prepare('SELECT r2_key, content_type, save_as FROM content_media WHERE id = ?').bind(Number(params.id)).first()
  if (!row) return fail(404, 'This file was not found.')
  if (!env.PHOTOS) return fail(503, "File storage isn't connected yet.")
  const head = await env.PHOTOS.head(row.r2_key)
  if (!head) return fail(404, "This file hasn't been uploaded yet. Import the week again.")
  const size = head.size
  const headers = { 'Content-Type': row.content_type, 'Cache-Control': 'private, max-age=86400', 'Accept-Ranges': 'bytes' }
  if (new URL(request.url).searchParams.get('download') === '1') {
    headers['Content-Disposition'] = `attachment; filename="${(row.save_as || row.r2_key.split('/').pop()).replace(/"/g, '')}"`
  }
  const m = (request.headers.get('Range') || '').match(/^bytes=(\d*)-(\d*)$/)
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : size - Number(m[2])
    let end = m[1] && m[2] ? Number(m[2]) : size - 1
    if (!m[1]) end = size - 1
    start = Math.max(0, start); end = Math.min(size - 1, end)
    if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    const obj = await env.PHOTOS.get(row.r2_key, { range: { offset: start, length: end - start + 1 } })
    return new Response(obj.body, { status: 206, headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) } })
  }
  const obj = await env.PHOTOS.get(row.r2_key)
  return new Response(obj.body, { headers: { ...headers, 'Content-Length': String(size) } })
}
