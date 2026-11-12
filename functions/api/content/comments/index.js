// Team Notes on the content calendar: comments not tied to one post (every staff member).
// GET  /api/content/comments -> the latest 100, newest first
// POST /api/content/comments {body} -> adds one

import { json, fail, readJson, cleanMultiline, audit } from '../../../../lib/http.js'
import { commentOut } from '../../../../lib/content.js'

export async function onRequestGet({ env, data }) {
  const { results } = await env.DB.prepare('SELECT * FROM content_comments WHERE post_id IS NULL AND deleted_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 100').all()
  return json({ comments: results.map((c) => commentOut(c, data.staff)) })
}

export async function onRequestPost({ request, env, data }) {
  const body = cleanMultiline((await readJson(request))?.body, 2000)
  if (!body) return fail(400, 'Type a note first.')
  const c = await env.DB.prepare('INSERT INTO content_comments (post_id, body, staff_id, author) VALUES (NULL, ?, ?, ?) RETURNING *').bind(body, data.staff.id, data.staff.name).first()
  await audit(env, data.staff.email, 'comment', 'content_notes', c.id)
  return json({ comment: commentOut(c, data.staff) }, 201)
}
