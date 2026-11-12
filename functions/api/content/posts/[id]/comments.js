// POST /api/content/posts/:id/comments {body, images} -> adds a comment to a post (every staff member);
//   images: how many will follow (PUT /api/content/comments/:id/images)

import { json, fail, readJson, audit } from '../../../../../lib/http.js'
import { commentBody, commentOut } from '../../../../../lib/content.js'

export async function onRequestPost({ request, env, params, data }) {
  const id = Number(params.id)
  const { text: body, images } = commentBody(await readJson(request))
  if (!body && !images) return fail(400, 'Type a comment or add an image first.')
  const p = await env.DB.prepare('SELECT id FROM content_posts WHERE id = ? AND deleted_at IS NULL').bind(id).first()
  if (!p) return fail(404, 'This post was not found. It may have been removed.')
  const c = await env.DB.prepare('INSERT INTO content_comments (post_id, body, staff_id, author) VALUES (?, ?, ?, ?) RETURNING *').bind(id, body, data.staff.id, data.staff.name).first()
  await audit(env, data.staff.email, 'comment', 'content_post', id)
  return json({ comment: commentOut(c, data.staff) }, 201)
}
