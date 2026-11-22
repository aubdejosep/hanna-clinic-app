// GET /api/sms-logs?page=&from=YYYY-MM-DD&to=YYYY-MM-DD -> Clinic Operations ▸ SMS Logs (owners and admins): the texts
// sent from the clinic's Semaphore account (by the app, the website and the day-before reminders), newest first,
// 100 a page, with their delivery status, the owner each went to (matched by mobile), and the credit balance.
// Read from Semaphore (it keeps every text); the key never leaves the server.

import { json, fail, canManage, audit } from '../../lib/http.js'

const API = 'https://api.semaphore.co/api/v4'
const PAGE = 100
const isDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '')
const last10 = (m) => String(m || '').replace(/\D/g, '').slice(-10)

export async function onRequestGet({ env, request, data }) {
  if (!canManage(data.staff)) return fail(403, 'Only an owner or admin can open the SMS logs.')
  if (!env.SEMAPHORE_API_KEY) return json({ ready: false, messages: [] })
  const u = new URL(request.url).searchParams
  const page = Math.max(1, Number(u.get('page')) || 1)
  const q = new URLSearchParams({ apikey: env.SEMAPHORE_API_KEY, limit: String(PAGE), page: String(page) })
  if (isDay(u.get('from'))) q.set('startDate', u.get('from'))
  if (isDay(u.get('to'))) q.set('endDate', u.get('to'))
  const base = env.SEMAPHORE_API_URL ? env.SEMAPHORE_API_URL.replace(/\/messages$/, '') : API
  let list
  let account = null
  try {
    const [m, a] = await Promise.all([fetch(`${base}/messages?${q}`), page === 1 ? fetch(`${base}/account?apikey=${encodeURIComponent(env.SEMAPHORE_API_KEY)}`) : null])
    if (!m.ok) throw new Error(`messages ${m.status}`)
    list = await m.json()
    if (!Array.isArray(list)) throw new Error('not a list')
    if (a?.ok) account = await a.json().catch(() => null)
  } catch (err) {
    console.log('sms logs', String(err).slice(0, 200))
    return fail(502, 'Semaphore didn’t answer. Try again in a minute.')
  }
  // Which owner each text went to.
  const nums = [...new Set(list.map((x) => last10(x.recipient)).filter((n) => n.length === 10))]
  const owners = {}
  for (let i = 0; i < nums.length; i += 50) {
    const part = nums.slice(i, i + 50)
    const { results } = await env.DB.prepare(`SELECT id, full_name, substr(mobile, -10) AS m FROM owners WHERE deleted_at IS NULL AND substr(mobile, -10) IN (${part.map(() => '?').join(',')})`).bind(...part).all()
    for (const r of results) owners[r.m] ||= { id: r.id, name: r.full_name }
  }
  if (page === 1) await audit(env, data.staff.email, 'view', 'sms_logs', null)
  return json({
    ready: true, page, pageSize: PAGE, more: list.length === PAGE,
    balance: account && account.credit_balance != null ? Number(account.credit_balance) : null,
    messages: list.map((x) => ({ id: String(x.message_id ?? ''), at: x.created_at || null, to: x.recipient || '', owner: owners[last10(x.recipient)] || null,
      text: x.message || '', status: x.status || '', network: x.network || '', sender: x.sender_name || '' })),
  })
}
