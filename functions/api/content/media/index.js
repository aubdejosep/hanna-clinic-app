// PUT /api/content/media?post=ID&kind=slide|reel|poster&sort=N&saveAs=NAME&silent=1  (body: the file)
//   -> owners and admins; stores one slide, reel or reel cover for a post (used by Import Week).
// Files go to R2 under content/; up to 95 MB each (Cloudflare's request limit is 100 MB).

import { json, fail, canManage, clean } from '../../../../lib/http.js'

const TYPES = { slide: /^image\/(jpeg|png|webp)$/, poster: /^image\/(jpeg|png|webp)$/, reel: /^video\/(mp4|quicktime|webm)$/ }
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' }
const MAX = 95 * 1024 * 1024

export async function onRequestPut({ request, env, data }) {
  if (!canManage(data.staff)) return fail(403, 'Only an owner or admin can add files to posts.')
  if (!env.PHOTOS) return fail(503, "File storage isn't connected yet.")
  const url = new URL(request.url)
  const postId = Number(url.searchParams.get('post'))
  const kind = url.searchParams.get('kind')
  const sort = Math.max(0, Math.min(50, Number(url.searchParams.get('sort')) || 0))
  const type = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase()
  if (!TYPES[kind]) return fail(400, 'Say whether this file is a slide, a reel or a reel cover.')
  if (!TYPES[kind].test(type)) return fail(400, kind === 'reel' ? 'A reel must be an MP4, MOV or WebM video.' : 'A slide must be a JPG, PNG or WebP image.')
  const size = Number(request.headers.get('Content-Length')) || 0
  if (size > MAX) return fail(413, 'This file is over 95 MB. Export it smaller, then import again.')
  const post = await env.DB.prepare('SELECT id, ref FROM content_posts WHERE id = ? AND deleted_at IS NULL').bind(postId).first()
  if (!post) return fail(404, 'This post was not found. Import the week again.')
  const key = `content/${post.ref}/${kind}-${sort}-${crypto.randomUUID().slice(0, 8)}.${EXT[type]}`
  const obj = await env.PHOTOS.put(key, request.body, { httpMetadata: { contentType: type } })
  const saveAs = clean(url.searchParams.get('saveAs'), 120).replace(/[^\w.() -]/g, '') || null
  // One file per place: a new upload for the same slide or reel replaces the old one.
  await env.DB.prepare(`UPDATE content_media SET deleted_at = ?, deleted_by = ? WHERE post_id = ? AND kind = ? AND sort = ? AND deleted_at IS NULL`)
    .bind(new Date().toISOString(), data.staff.name, postId, kind, sort).run()
  const row = await env.DB.prepare(`INSERT INTO content_media (post_id, kind, sort, r2_key, content_type, bytes, save_as, silent, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`).bind(postId, kind, sort, key, type, obj?.size ?? size, saveAs, url.searchParams.get('silent') === '1' ? 1 : 0, data.staff.name).first()
  return json({ id: row.id }, 201)
}
