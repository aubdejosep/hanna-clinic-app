// GET /api/inbox?tab=open|mine|done|spam|all&q=&page= -> conversations, newest first (every staff member)

import { json } from '../../../lib/http.js'
import { visible } from '../../../lib/inbox.js'

export async function onRequestGet({ env, request, data }) {
  const u = new URL(request.url).searchParams
  const tab = ['open', 'mine', 'done', 'spam', 'all'].includes(u.get('tab')) ? u.get('tab') : 'open'
  const q = (u.get('q') || '').trim().slice(0, 60)
  const page = Math.max(1, Number(u.get('page')) || 1)
  const size = 30
  const where = [`t.deleted_at IS NULL${visible(data.staff)}`]
  const binds = []
  if (tab === 'open') where.push("t.status = 'open'")
  if (tab === 'mine') { where.push("t.status = 'open' AND t.assigned_to = ?"); binds.push(data.staff.id) }
  if (tab === 'done') where.push("t.status = 'done'")
  if (tab === 'spam') where.push("t.status = 'spam'")
  if (tab === 'all') where.push("t.status <> 'spam'")
  if (q) { where.push('(t.contact_email LIKE ? OR t.contact_name LIKE ? OR t.subject LIKE ? OR o.full_name LIKE ?)'); binds.push(...Array(4).fill(`%${q}%`)) }
  const w = where.join(' AND ')
  const [rows, count, counts] = await env.DB.batch([
    env.DB.prepare(`SELECT t.*, o.full_name AS owner_name, s.first_name AS assigned_name FROM inbox_threads t LEFT JOIN owners o ON o.id = t.owner_id LEFT JOIN staff s ON s.id = t.assigned_to
      WHERE ${w} ORDER BY t.last_message_at DESC, t.id DESC LIMIT ? OFFSET ?`).bind(...binds, size, (page - 1) * size),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM inbox_threads t LEFT JOIN owners o ON o.id = t.owner_id WHERE ${w}`).bind(...binds),
    env.DB.prepare(`SELECT SUM(status = 'open') AS open, SUM(status = 'open' AND unread = 1) AS unread, SUM(status = 'open' AND assigned_to = ?) AS mine FROM inbox_threads t WHERE deleted_at IS NULL${visible(data.staff)}`).bind(data.staff.id),
  ])
  const c = counts.results[0]
  return json({
    total: count.results[0].n, page, size, counts: { open: c.open || 0, unread: c.unread || 0, mine: c.mine || 0 },
    threads: rows.results.map((t) => ({
      id: t.id, channel: t.channel, subject: t.subject, contactEmail: t.contact_email, contactName: t.contact_name,
      owner: t.owner_id ? { id: t.owner_id, name: t.owner_name } : null, status: t.status, unread: !!t.unread,
      assignedTo: t.assigned_to ? { id: t.assigned_to, name: t.assigned_name } : null, messageCount: t.message_count,
      lastMessageAt: t.last_message_at, lastDirection: t.last_direction, snippet: t.snippet, restricted: !!t.restricted,
    })),
  })
}
