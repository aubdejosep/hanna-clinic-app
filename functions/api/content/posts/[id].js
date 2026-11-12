// GET    /api/content/posts/:id -> one post with its media and comments (every staff member)
// PATCH  /api/content/posts/:id {posted, postUrl, day, status} -> owners and admins
//        posted true/false ticks or unticks Posted (who and when are recorded)
// DELETE /api/content/posts/:id -> owners and admins; hidden, never erased

import { json, fail, readJson, clean, canManage, audit } from '../../../../lib/http.js'
import { DAY, STATUSES, commentsOut, loadMedia, postOut } from '../../../../lib/content.js'

export async function loadPost(env, id, staff) {
  const p = await env.DB.prepare('SELECT * FROM content_posts WHERE id = ? AND deleted_at IS NULL').bind(id).first()
  if (!p) return null
  const [media, comments] = await Promise.all([
    loadMedia(env, [id]),
    env.DB.prepare('SELECT * FROM content_comments WHERE post_id = ? AND deleted_at IS NULL ORDER BY created_at, id').bind(id).all(),
  ])
  return postOut(p, media[id] || [], { comments: await commentsOut(env, comments.results, staff) })
}

export async function onRequestGet({ env, params, data }) {
  const post = await loadPost(env, Number(params.id), data.staff)
  return post ? json({ post }) : fail(404, 'This post was not found. It may have been removed.')
}

export async function onRequestPatch({ request, env, params, data }) {
  if (!canManage(data.staff)) return fail(403, 'Only an owner or admin can change posts. Add a comment instead.')
  const id = Number(params.id)
  const body = (await readJson(request)) || {}
  const p = await env.DB.prepare('SELECT * FROM content_posts WHERE id = ? AND deleted_at IS NULL').bind(id).first()
  if (!p) return fail(404, 'This post was not found. It may have been removed.')
  const sets = []
  const binds = []
  const now = new Date().toISOString()
  if ('posted' in body) {
    if (body.posted) { sets.push('posted_at = COALESCE(posted_at, ?)', 'posted_by = COALESCE(posted_by, ?)'); binds.push(now, data.staff.name) }
    else sets.push('posted_at = NULL', 'posted_by = NULL')
  }
  if ('postUrl' in body) {
    const u = clean(body.postUrl, 300)
    if (u && !/^https:\/\//.test(u)) return fail(400, 'Paste the post’s link, starting with https://')
    sets.push('post_url = ?'); binds.push(u || null)
  }
  if ('day' in body) {
    if (!DAY.test(body.day || '')) return fail(400, 'Choose a day.')
    sets.push('day = ?'); binds.push(body.day)
  }
  if ('status' in body) {
    if (!STATUSES.includes(body.status)) return fail(400, 'Choose a status.')
    sets.push('status = ?'); binds.push(body.status)
  }
  if (!sets.length) return fail(400, 'Nothing to change.')
  await env.DB.prepare(`UPDATE content_posts SET ${sets.join(', ')}, updated_at = ?, updated_by = ? WHERE id = ?`).bind(...binds, now, data.staff.name, id).run()
  await audit(env, data.staff.email, 'update', 'content_post', id, { fields: Object.keys(body) })
  return json({ post: await loadPost(env, id, data.staff) })
}

export async function onRequestDelete({ env, params, data }) {
  if (!canManage(data.staff)) return fail(403, 'Only an owner or admin can remove posts.')
  const id = Number(params.id)
  const r = await env.DB.prepare('UPDATE content_posts SET deleted_at = ?, deleted_by = ? WHERE id = ? AND deleted_at IS NULL').bind(new Date().toISOString(), data.staff.name, id).run()
  if (!r.meta.changes) return fail(404, 'This post was not found. It may have been removed.')
  await audit(env, data.staff.email, 'delete', 'content_post', id)
  return json({ ok: true })
}
