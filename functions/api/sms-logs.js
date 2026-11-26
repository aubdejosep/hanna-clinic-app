// GET /api/sms-logs?page=&from=YYYY-MM-DD&to=YYYY-MM-DD -> Clinic Operations ▸ SMS Logs (owners and admins): the texts
// sent from the clinic's Semaphore account (by the app, the website and the day-before reminders), newest first,
// 100 a page, with their delivery status, the owner each went to (matched by mobile), and the credit balance.
// Read from Semaphore (it keeps every text); the key never leaves the server.

import { json, fail, canManage, audit } from '../../lib/http.js'
import { apptNo } from '../../lib/appointments.js'

const API = 'https://api.semaphore.co/api/v4'
const PAGE = 100
const MAX_PAGES = 50
const isDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '')
const last10 = (m) => String(m || '').replace(/\D/g, '').slice(-10)
const dayOf = (x) => String(x.created_at || '').slice(0, 10)
const manilaMs = (s) => { const d = new Date(String(s || '').includes('T') ? s : `${String(s).replace(' ', 'T')}+08:00`); return d.getTime() }
const timeOf = (x) => { const t = manilaMs(x.created_at); return Number.isFinite(t) ? t : 0 }
// Semaphore's GET /messages returns oldest first with no sort parameter, so we fetch the range (1,000 a page) and sort newest first.
const sortNewest = (a, b) => (timeOf(b) - timeOf(a)) || (Number(b.message_id || 0) - Number(a.message_id || 0))

async function fetchAllMessages(base, apikey, from, to) {
  const q = new URLSearchParams({ apikey, limit: '1000' })
  // Semaphore wants the end date after the start (a single day is refused), so ask up to the next day and keep
  // only the texts sent on the dates picked (its times are Manila time, "2026-11-23 09:00:12").
  if (from) q.set('startDate', from)
  if (to) { const d = new Date(`${to}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); q.set('endDate', d.toISOString().slice(0, 10)) }
  const all = []
  let capped = false
  for (let p = 1; ; p++) {
    if (p > MAX_PAGES) { capped = true; break }
    q.set('page', String(p))
    const r = await fetch(`${base}/messages?${q}`)
    const text = await r.text()
    if (!r.ok) throw new Error(`messages ${r.status}: ${text.slice(0, 200)}`)
    const chunk = JSON.parse(text)
    if (!Array.isArray(chunk)) throw new Error(`not a list: ${text.slice(0, 200)}`)
    for (const x of chunk) {
      const d = dayOf(x)
      if ((from || to) && isDay(d) && ((from && d < from) || (to && d > to))) continue
      all.push(x)
    }
    if (chunk.length < 1000) break
  }
  return { all, capped }
}

function summarize(all, capped) {
  const out = { total: 0, sent: 0, pending: 0, failed: 0, capped }
  for (const x of all) {
    out.total++
    const st = String(x.status || '').toLowerCase()
    if (/fail|refund|reject/.test(st)) out.failed++
    else if (/pend|queue/.test(st)) out.pending++
    else out.sent++
  }
  return out
}

export async function onRequestGet({ env, request, data }) {
  if (!canManage(data.staff)) return fail(403, 'Only an owner or admin can open the SMS logs.')
  if (!env.SEMAPHORE_API_KEY) return json({ ready: false, messages: [] })
  const u = new URL(request.url).searchParams
  const page = Math.max(1, Number(u.get('page')) || 1)
  const from = isDay(u.get('from')) ? u.get('from') : null
  const to = isDay(u.get('to')) ? u.get('to') : null
  const base = env.SEMAPHORE_API_URL ? env.SEMAPHORE_API_URL.replace(/\/messages$/, '') : API
  if (u.get('counts')) {
    try {
      const { all, capped } = await fetchAllMessages(base, env.SEMAPHORE_API_KEY, from, to)
      return json(summarize(all, capped))
    } catch (err) {
      console.log('sms counts', String(err).slice(0, 400))
      return fail(503, 'Semaphore didn’t send the totals just now. Try again in a minute.')
    }
  }
  let all
  let capped = false
  let account = null
  try {
    const [fetched, a] = await Promise.all([
      fetchAllMessages(base, env.SEMAPHORE_API_KEY, from, to),
      page === 1 ? fetch(`${base}/account?apikey=${encodeURIComponent(env.SEMAPHORE_API_KEY)}`) : null,
    ])
    all = fetched.all
    capped = fetched.capped
    all.sort(sortNewest)
    if (a?.ok) account = await a.json().catch(() => null)
  } catch (err) {
    console.log('sms logs', String(err).slice(0, 400))
    return fail(503, 'Semaphore didn’t send the list just now. Try again in a minute, or pick another date range.')
  }
  const totals = summarize(all, capped)
  const start = (page - 1) * PAGE
  const list = all.slice(start, start + PAGE)
  // Which owner each text went to.
  const nums = [...new Set(list.map((x) => last10(x.recipient)).filter((n) => n.length === 10))]
  const owners = {}
  for (let i = 0; i < nums.length; i += 50) {
    const part = nums.slice(i, i + 50)
    const { results } = await env.DB.prepare(`SELECT id, full_name, substr(mobile, -10) AS m FROM owners WHERE deleted_at IS NULL AND substr(mobile, -10) IN (${part.map(() => '?').join(',')})`).bind(...part).all()
    for (const r of results) owners[r.m] ||= { id: r.id, name: r.full_name }
  }
  const appts = await appointmentsFor(env, list, owners).catch((err) => { console.log('sms appts', String(err).slice(0, 300)); return {} })
  if (page === 1) await audit(env, data.staff.email, 'view', 'sms_logs', null)
  return json({
    ready: true, page, pageSize: PAGE, more: start + PAGE < all.length, totals,
    balance: account && account.credit_balance != null ? Number(account.credit_balance) : null,
    messages: list.map((x) => ({ id: String(x.message_id ?? ''), at: x.created_at || null, to: x.recipient || '', owner: owners[last10(x.recipient)] || null,
      appointments: appts[String(x.message_id ?? '')] || [],
      text: x.message || '', status: x.status || '', network: x.network || '', sender: x.sender_name || '' })),
  })
}

// Which appointment(s) each text was about (shown as #2026A4511 links, like the old system):
//   1. Day-before reminders: the app logs each one with Semaphore's id (message_log), for one owner and day.
//   2. Website booking and cancellation texts: the website booking for that mobile made or cancelled within
//      10 minutes of the text, and the appointments copied from it (external_ref "BK-XXXXXX#0").
//   3. Otherwise, for an owner's text the app didn't log (tests are logged, so they get none): that owner's
//      appointments on the next day, else on the day it was sent.
const nextDay = (d) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10) }
async function appointmentsFor(env, list, owners) {
  const out = {}
  const ids = [...new Set(list.map((x) => String(x.message_id ?? '')).filter(Boolean))]
  if (!ids.length) return out
  const logged = {}
  for (let i = 0; i < ids.length; i += 90) {
    const part = ids.slice(i, i + 90)
    const { results } = await env.DB.prepare(`SELECT provider_id, template_key, owner_id, ref FROM message_log WHERE channel = 'sms' AND provider_id IN (${part.map(() => '?').join(',')})`).bind(...part).all()
    for (const r of results) logged[r.provider_id] = r
  }
  // Website bookings for these mobiles (made or cancelled around each text's time).
  const nums = [...new Set(list.map((x) => last10(x.recipient)).filter((n) => n.length === 10))]
  const bookings = {}
  if (env.LEADS && nums.length) {
    for (let i = 0; i < nums.length; i += 50) {
      const part = nums.slice(i, i + 50)
      const { results } = await env.LEADS.prepare(`SELECT ref, created_at, status, status_at, substr(mobile, -10) AS m FROM bookings WHERE substr(mobile, -10) IN (${part.map(() => '?').join(',')})`).bind(...part).all().catch(() => ({ results: [] }))
      for (const r of results) (bookings[r.m] ||= []).push(r)
    }
  }
  const want = {} // message id -> { refs: [...] } or { owner, days: [...] }
  for (const x of list) {
    const id = String(x.message_id ?? '')
    if (!id) continue
    const log = logged[id]
    const m = last10(x.recipient)
    if (log) {
      const r = /^(\d+):(\d{4}-\d{2}-\d{2})$/.exec(log.ref || '')
      if (log.template_key === 'visit_reminder' && r) want[id] = { owner: Number(r[1]), days: [r[2]] }
      continue
    }
    const at = manilaMs(x.created_at)
    const near = (t) => t && Math.abs(new Date(t).getTime() - at) <= 10 * 60e3
    const b = (bookings[m] || []).find((k) => near(k.created_at) || (k.status === 'cancelled' && near(k.status_at)))
    if (b) { want[id] = { refs: [b.ref] }; continue }
    const owner = owners[m]
    const day = String(x.created_at || '').slice(0, 10)
    if (owner && /^\d{4}-\d{2}-\d{2}$/.test(day)) want[id] = { owner: owner.id, days: [nextDay(day), day], firstOnly: true }
  }
  // Load them in two queries.
  const refs = [...new Set(Object.values(want).flatMap((w) => w.refs || []))]
  const byRef = {}
  for (let i = 0; i < refs.length; i += 15) {
    const part = refs.slice(i, i + 15).flatMap((r) => [0, 1, 2, 3, 4].map((n) => `${r}#${n}`))
    const { results } = await env.DB.prepare(`SELECT id, day, status, external_ref FROM appointments WHERE deleted_at IS NULL AND external_ref IN (${part.map(() => '?').join(',')}) ORDER BY id`).bind(...part).all()
    for (const a of results) (byRef[a.external_ref.split('#')[0]] ||= []).push(a)
  }
  const pairs = [...new Set(Object.values(want).filter((w) => w.owner).flatMap((w) => w.days.map((d) => `${w.owner}|${d}`)))]
  const byOwnerDay = {}
  for (let i = 0; i < pairs.length; i += 40) {
    const part = pairs.slice(i, i + 40).map((p) => p.split('|'))
    const { results } = await env.DB.prepare(`SELECT id, owner_id, day, status FROM appointments WHERE deleted_at IS NULL AND (${part.map(() => '(owner_id = ? AND day = ?)').join(' OR ')}) ORDER BY id`).bind(...part.flat()).all()
    for (const a of results) (byOwnerDay[`${a.owner_id}|${a.day}`] ||= []).push(a)
  }
  const show = (a) => ({ id: a.id, no: apptNo(a), status: a.status })
  for (const [id, w] of Object.entries(want)) {
    let found = []
    if (w.refs) found = w.refs.flatMap((r) => byRef[r] || [])
    else for (const d of w.days) { const got = byOwnerDay[`${w.owner}|${d}`] || []; found.push(...got); if (w.firstOnly && got.length) break }
    if (found.length) out[id] = found.map(show)
  }
  return out
}
