// POST /api/inbox/threads/:id/notes {body} -> a staff-only note on the conversation (never sent)

import { json, fail, readJson, cleanMultiline } from '../../../../../lib/http.js'
import { loadThread } from '../[id].js'

export async function onRequestPost({ request, env, params, data }) {
  const id = Number(params.id)
  const body = cleanMultiline((await readJson(request))?.body, 2000)
  if (!body) return fail(400, 'Type a note first.')
  if (!(await env.DB.prepare('SELECT id FROM inbox_threads WHERE id = ? AND deleted_at IS NULL').bind(id).first())) return fail(404, 'This conversation was not found.')
  await env.DB.prepare('INSERT INTO inbox_notes (thread_id, body, staff_id, author) VALUES (?, ?, ?, ?)').bind(id, body, data.staff.id, data.staff.name).run()
  return json({ thread: await loadThread(env, id, data.staff) }, 201)
}
