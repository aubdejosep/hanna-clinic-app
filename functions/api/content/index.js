// GET /api/content?from=YYYY-MM-DD&to=YYYY-MM-DD -> the content calendar for those days (every staff member):
//   posts (with their media and comment counts), events (promos) overlapping the days, and the
//   clinic's closed dates and special hours from Clinic Profile.

import { json, fail, manilaToday } from '../../../lib/http.js'
import { DAY, eventOut, loadMedia, postOut } from '../../../lib/content.js'

export async function onRequestGet({ env, request }) {
  const url = new URL(request.url)
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')
  if (!DAY.test(from || '') || !DAY.test(to || '') || to < from) return fail(400, 'Choose the days to show.')
  const [posts, events, closed, notes] = await env.DB.batch([
    env.DB.prepare(`SELECT p.*, (SELECT COUNT(*) FROM content_comments c WHERE c.post_id = p.id AND c.deleted_at IS NULL) AS comments
      FROM content_posts p WHERE p.branch_id = 1 AND p.deleted_at IS NULL AND p.day BETWEEN ? AND ? ORDER BY p.day, p.id`).bind(from, to),
    env.DB.prepare(`SELECT * FROM content_events WHERE branch_id = 1 AND deleted_at IS NULL AND start_day <= ? AND end_day >= ? ORDER BY start_day, id`).bind(to, from),
    env.DB.prepare(`SELECT day, open, close, reason FROM closed_dates WHERE branch_id = 1 AND deleted_at IS NULL AND day BETWEEN ? AND ? ORDER BY day`).bind(from, to),
    env.DB.prepare('SELECT COUNT(*) AS n FROM content_comments WHERE post_id IS NULL AND deleted_at IS NULL'),
  ])
  const media = await loadMedia(env, posts.results.map((p) => p.id))
  return json({
    today: manilaToday(),
    posts: posts.results.map((p) => postOut(p, media[p.id] || [], { comments: p.comments })),
    events: events.results.map(eventOut),
    closed: closed.results.map((d) => ({ day: d.day, open: d.open, close: d.close, reason: d.reason })),
    teamNotes: notes.results[0]?.n || 0,
  })
}
