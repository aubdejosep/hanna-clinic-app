// Content ▸ Calendar: shaping posts, media, comments and events for the screens (docs/CONTENT-PLAN.md).

export const STATUSES = ['ready', 'film', 'info', 'placeholder', 'idea']
const json = (s, d) => { if (!s) return d; try { return JSON.parse(s) ?? d } catch { return d } }

export function mediaOut(m) {
  return { id: m.id, kind: m.kind, sort: m.sort, saveAs: m.save_as, contentType: m.content_type, bytes: m.bytes, silent: !!m.silent }
}

export function postOut(p, media = [], extra = {}) {
  const slides = media.filter((m) => m.kind === 'slide').sort((a, b) => a.sort - b.sort)
  const reel = media.find((m) => m.kind === 'reel') || null
  const poster = media.find((m) => m.kind === 'poster') || null
  return {
    id: p.id,
    ref: p.ref,
    day: p.day,
    time: p.time,
    pillar: p.pillar,
    format: p.format,
    title: p.title,
    caption: p.caption,
    hashtags: p.hashtags ? p.hashtags.split(' ').filter(Boolean) : [],
    note: p.note,
    shots: json(p.shot_list, []),
    status: p.posted_at ? 'posted' : p.status,
    plannedStatus: p.status,
    postedAt: p.posted_at,
    postedBy: p.posted_by,
    postUrl: p.post_url,
    slides: slides.map(mediaOut),
    reel: reel ? mediaOut(reel) : null,
    poster: poster ? mediaOut(poster) : null,
    updatedAt: p.updated_at || p.created_at,
    ...extra,
  }
}

export function commentOut(c, staff) {
  return { id: c.id, postId: c.post_id, body: c.body, author: c.author, staffId: c.staff_id, at: c.created_at, mine: !!staff && c.staff_id === staff.id }
}

export function eventOut(e) {
  return { id: e.id, kind: e.kind, title: e.title, from: e.start_day, to: e.end_day, note: e.note, addedBy: e.created_by }
}

export async function loadMedia(env, postIds) {
  if (!postIds.length) return {}
  const { results } = await env.DB.prepare(`SELECT * FROM content_media WHERE deleted_at IS NULL AND post_id IN (${postIds.map(() => '?').join(',')}) ORDER BY sort, id`).bind(...postIds).all()
  const by = {}
  for (const m of results) (by[m.post_id] ||= []).push(m)
  return by
}

export const DAY = /^\d{4}-\d{2}-\d{2}$/
