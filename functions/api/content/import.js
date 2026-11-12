// Import Week (owners and admins): posts from a week folder made in the content session.
// GET  /api/content/import?refs=s04,s05 -> which of these posts are already in the app (for the preview)
// POST /api/content/import {posts: [...]} -> adds or updates each post by its ref (e.g. s04). A post
//      already ticked Posted keeps its tick. Its old slides and reel are replaced: the screen then
//      uploads the new files one by one (PUT /api/content/media).
// A post: {id, date, time, pillar, format, title, caption, tags, note, status, shots} as in the
// weekly plan page's data. Format sheet: docs/CONTENT-IMPORT-FORMAT.md.

import { json, fail, readJson, clean, cleanMultiline, canManage, audit } from '../../../lib/http.js'
import { DAY, STATUSES } from '../../../lib/content.js'

const REF = /^[A-Za-z0-9_-]{1,40}$/

export async function onRequestGet({ env, request, data }) {
  if (!canManage(data.staff)) return fail(403, 'Only an owner or admin can import posts.')
  const refs = (new URL(request.url).searchParams.get('refs') || '').split(',').filter((r) => REF.test(r)).slice(0, 100)
  if (!refs.length) return json({ existing: [] })
  const { results } = await env.DB.prepare(`SELECT ref, title, day, posted_at FROM content_posts WHERE branch_id = 1 AND deleted_at IS NULL AND ref IN (${refs.map(() => '?').join(',')})`).bind(...refs).all()
  return json({ existing: results.map((r) => ({ ref: r.ref, title: r.title, day: r.day, posted: !!r.posted_at })) })
}

export function postInput(p, i) {
  const errors = []
  const ref = String(p?.id ?? '')
  if (!REF.test(ref)) errors.push(`Post ${i + 1}: its id is missing or has odd characters.`)
  if (!DAY.test(String(p?.date || ''))) errors.push(`Post ${ref || i + 1}: the date must look like 2026-11-16.`)
  const title = clean(p?.title, 120)
  if (!title) errors.push(`Post ${ref || i + 1}: it has no title.`)
  const tags = Array.isArray(p?.tags) ? p.tags : String(p?.tags || '').split(/\s+/)
  const shots = Array.isArray(p?.shots) ? p.shots.map((s) => clean(String(s), 200)).filter(Boolean).slice(0, 30) : []
  return {
    errors,
    row: {
      ref, day: p?.date, time: clean(p?.time, 20) || null, pillar: clean(p?.pillar, 40) || null, format: clean(p?.format, 40) || null, title,
      caption: cleanMultiline(p?.caption, 5000) || null,
      hashtags: tags.map((t) => clean(String(t), 60)).filter((t) => /^#\S+$/.test(t)).slice(0, 30).join(' ') || null,
      note: cleanMultiline(p?.note, 2000) || null,
      shot_list: shots.length ? JSON.stringify(shots) : null,
      status: STATUSES.includes(p?.status) ? p.status : 'ready',
    },
  }
}

export async function onRequestPost({ request, env, data }) {
  if (!canManage(data.staff)) return fail(403, 'Only an owner or admin can import posts.')
  const body = await readJson(request)
  const list = Array.isArray(body?.posts) ? body.posts : null
  if (!list?.length) return fail(400, 'The week folder has no posts in it.')
  if (list.length > 60) return fail(400, 'Import up to 60 posts at a time.')
  const rows = []
  const errors = []
  list.forEach((p, i) => { const r = postInput(p, i); errors.push(...r.errors); rows.push(r.row) })
  if (new Set(rows.map((r) => r.ref)).size !== rows.length) errors.push('Two posts share the same id.')
  if (errors.length) return fail(400, 'The week folder needs fixing before it can be imported.', { problems: errors.slice(0, 20) })

  const now = new Date().toISOString()
  const actor = data.staff.name
  const out = []
  for (const r of rows) {
    const saved = await env.DB.prepare(`INSERT INTO content_posts (branch_id, ref, day, time, pillar, format, title, caption, hashtags, note, shot_list, status, created_by)
      VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
      ON CONFLICT (branch_id, ref) DO UPDATE SET day = ?2, time = ?3, pillar = ?4, format = ?5, title = ?6, caption = ?7, hashtags = ?8, note = ?9,
        shot_list = ?10, status = ?11, updated_at = ?13, updated_by = ?12, deleted_at = NULL, deleted_by = NULL
      RETURNING id, (created_at <> ?13 AND updated_at = ?13) AS updated`)
      .bind(r.ref, r.day, r.time, r.pillar, r.format, r.title, r.caption, r.hashtags, r.note, r.shot_list, r.status, actor, now).first()
    // The new files replace the old ones (kept in the database, hidden).
    await env.DB.prepare('UPDATE content_media SET deleted_at = ?, deleted_by = ? WHERE post_id = ? AND deleted_at IS NULL').bind(now, `${actor} (import)`, saved.id).run()
    out.push({ ref: r.ref, id: saved.id, updated: !!saved.updated })
  }
  await audit(env, data.staff.email, 'import', 'content_posts', null, { posts: rows.map((r) => r.ref) })
  return json({ posts: out }, 201)
}
