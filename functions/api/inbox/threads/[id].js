// GET   /api/inbox/threads/:id -> one conversation: messages, attachments, notes, the matched owner (marks it read)
// PATCH /api/inbox/threads/:id {status: open|done|spam, assignedTo: staffId|null, ownerId: id|null} -> every staff member;
//   {restricted: true|false} -> owners and admins only (Owners and Admins Only hides it from everyone else)

import { json, fail, readJson, audit } from '../../../../lib/http.js'
import { localMobile } from '../../../../lib/clients.js'
import { seesRestricted, visible } from '../../../../lib/inbox.js'
import { replyWindow } from '../../../../lib/messenger.js'

export async function loadThread(env, id, staff) {
  const t = await env.DB.prepare(`SELECT t.*, s.first_name AS assigned_name FROM inbox_threads t LEFT JOIN staff s ON s.id = t.assigned_to WHERE t.id = ? AND t.deleted_at IS NULL${visible(staff)}`).bind(id).first()
  if (!t) return null
  const [msgs, atts, notes, owner, pets] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM inbox_messages WHERE thread_id = ? ORDER BY created_at, id').bind(id),
    env.DB.prepare('SELECT a.* FROM inbox_attachments a JOIN inbox_messages m ON m.id = a.message_id WHERE m.thread_id = ?').bind(id),
    env.DB.prepare('SELECT * FROM inbox_notes WHERE thread_id = ? AND deleted_at IS NULL ORDER BY created_at').bind(id),
    env.DB.prepare('SELECT id, full_name, customer_no, mobile, email FROM owners WHERE id = ?').bind(t.owner_id || 0),
    env.DB.prepare('SELECT id, name, species FROM pets WHERE owner_id = ? AND deleted_at IS NULL ORDER BY name').bind(t.owner_id || 0),
  ])
  const o = owner.results[0]
  return {
    id: t.id, channel: t.channel, subject: t.subject, contactEmail: t.contact_email, contactName: t.contact_name, status: t.status,
    replyWindow: t.channel === 'messenger' ? replyWindow(t, env) : null,
    restricted: !!t.restricted, restrictedBy: t.restricted_by, restrictedAt: t.restricted_at, canRestrict: seesRestricted(staff),
    assignedTo: t.assigned_to ? { id: t.assigned_to, name: t.assigned_name } : null,
    owner: o ? { id: o.id, name: o.full_name, customerNo: o.customer_no, mobile: localMobile(o.mobile), email: o.email, pets: pets.results } : null,
    messages: msgs.results.map((m) => ({
      id: m.id, direction: m.direction, fromEmail: m.from_email, fromName: m.from_name, to: m.to_emails, cc: m.cc_emails, subject: m.subject,
      text: m.text_body, html: m.html_body, status: m.status, error: m.error, sentBy: m.sent_by, at: m.created_at,
      attachments: atts.results.filter((a) => a.message_id === m.id).map((a) => ({ id: a.id, name: a.filename, type: a.content_type, bytes: a.bytes })),
    })),
    notes: notes.results.map((n) => ({ id: n.id, body: n.body, author: n.author, at: n.created_at, mine: n.staff_id === staff.id })),
  }
}

export async function onRequestGet({ env, params, data }) {
  const id = Number(params.id)
  const t = await loadThread(env, id, data.staff)
  if (!t) return fail(404, 'This conversation was not found.')
  await env.DB.prepare('UPDATE inbox_threads SET unread = 0 WHERE id = ? AND unread = 1').bind(id).run()
  return json({ thread: t })
}

export async function onRequestPatch({ request, env, params, data }) {
  const id = Number(params.id)
  const b = (await readJson(request)) || {}
  const sets = []
  const binds = []
  if ('status' in b) { if (!['open', 'done', 'spam'].includes(b.status)) return fail(400, 'Choose a status.'); sets.push('status = ?'); binds.push(b.status) }
  if ('assignedTo' in b) {
    const sid = b.assignedTo ? Number(b.assignedTo) : null
    if (sid && !(await env.DB.prepare('SELECT id FROM staff WHERE id = ? AND active = 1').bind(sid).first())) return fail(400, 'Choose someone on the staff list.')
    sets.push('assigned_to = ?'); binds.push(sid)
  }
  if ('ownerId' in b) {
    const oid = b.ownerId ? Number(b.ownerId) : null
    if (oid && !(await env.DB.prepare('SELECT id FROM owners WHERE id = ? AND deleted_at IS NULL').bind(oid).first())) return fail(400, 'Choose an owner from the Masterlist.')
    sets.push('owner_id = ?'); binds.push(oid)
  }
  if ('unread' in b) { sets.push('unread = ?'); binds.push(b.unread ? 1 : 0) }
  if ('restricted' in b) {
    if (!seesRestricted(data.staff)) return fail(403, 'Only an owner or admin can change who sees a conversation.')
    sets.push('restricted = ?', 'restricted_by = ?', 'restricted_at = ?'); binds.push(b.restricted ? 1 : 0, b.restricted ? data.staff.name : null, b.restricted ? new Date().toISOString() : null)
  }
  if (!sets.length) return fail(400, 'Nothing to change.')
  const r = await env.DB.prepare(`UPDATE inbox_threads SET ${sets.join(', ')}, updated_at = ? WHERE id = ? AND deleted_at IS NULL${seesRestricted(data.staff) ? '' : ' AND restricted = 0'}`).bind(...binds, new Date().toISOString(), id).run()
  if (!r.meta.changes) return fail(404, 'This conversation was not found.')
  await audit(env, data.staff.email, 'update', 'inbox_thread', id, b)
  return json({ thread: await loadThread(env, id, data.staff) })
}
