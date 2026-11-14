// The day-before visit reminder (Account ▸ Settings ▸ Messages ▸ Visit Reminder). Run once a day at 9 AM Manila
// by the inbox intake Worker's schedule (workers/inbox-intake). Off until the template's Text or Email is on.
// One message per owner and channel for all their pets booked tomorrow (Accepted or Pending, not passed
// away), never twice (message_log). Email only to real addresses; texts once texting is set up.

import { sendEmail } from './email.js'
import { sendSms, smsReady } from './sms.js'
import { fillIn, niceName, petList, windowText } from './messages.js'
import { clientEmail } from './client-email.js'

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const realEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e || '') && !/noemail/i.test(e)

export async function sendVisitReminders(env, { now = new Date() } = {}) {
  const t = await env.DB.prepare("SELECT * FROM message_templates WHERE key = 'visit_reminder'").first().catch(() => null)
  const useSms = !!t?.sms_enabled && smsReady(env)
  const useEmail = !!t?.email_enabled && !!env.RESEND_API_KEY
  if (!useSms && !useEmail) return { skipped: 'switched off' }
  const tomorrow = new Date(now.getTime() + 8 * 3600e3 + 864e5).toISOString().slice(0, 10)
  const branch = await env.DB.prepare('SELECT hours FROM branches WHERE id = 1').first()
  let hours = {}
  try { hours = JSON.parse(branch?.hours || '{}')[DAY_KEYS[new Date(`${tomorrow}T12:00:00Z`).getUTCDay()]] || {} } catch { /* default hours */ }
  const special = await env.DB.prepare('SELECT open, close FROM closed_dates WHERE day = ? AND deleted_at IS NULL').bind(tomorrow).first().catch(() => null)
  if (special?.open && special?.close) hours = { open: special.open, close: special.close }
  const { results } = await env.DB.prepare(`SELECT a.time, a.reason, o.id AS owner_id, o.full_name, o.email, o.mobile, p.name AS pet
    FROM appointments a JOIN pets p ON p.id = a.pet_id JOIN owners o ON o.id = a.owner_id
    WHERE a.day = ? AND a.status IN ('accepted', 'pending') AND a.deleted_at IS NULL AND o.deleted_at IS NULL AND p.deleted_at IS NULL AND p.deceased_on IS NULL
    ORDER BY o.id, a.time`).bind(tomorrow).all()
  const owners = new Map()
  for (const r of results) {
    if (!owners.has(r.owner_id)) owners.set(r.owner_id, { ...r, pets: [], when: null })
    const o = owners.get(r.owner_id)
    if (!o.pets.includes(r.pet)) o.pets.push(r.pet)
    const asked = /Preferred time: (Morning|Afternoon|Any time)/i.exec(r.reason || '')?.[1]?.toLowerCase().replace('any time', 'any')
    o.when = o.when || asked || r.time // website bookings keep the window they picked; others go by the time of day
  }
  const date = new Date(`${tomorrow}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
  const out = { day: tomorrow, owners: owners.size, sms: 0, email: 0, failed: 0, skipped: 0 }
  const done = new Set((await env.DB.prepare("SELECT channel || '|' || ref AS k FROM message_log WHERE template_key = 'visit_reminder' AND status = 'sent' AND ref LIKE ?").bind(`%:${tomorrow}`).all()).results.map((r) => r.k))
  for (const o of owners.values()) {
    const vars = { first_name: niceName(String(o.full_name || '').trim().split(/\s+/)[0]), pets: petList(o.pets), date, window: windowText(hours, o.when) }
    const ref = `${o.owner_id}:${tomorrow}`
    const jobs = []
    if (useSms && o.mobile) jobs.push(['sms', o.mobile, fillIn(t.sms_text, vars), () => sendSms(env, o.mobile, fillIn(t.sms_text, vars))])
    if (useEmail && realEmail(o.email)) {
      const mail = clientEmail({ subject: fillIn(t.email_subject, vars), intro: fillIn(t.email_intro, vars), firstName: vars.first_name, details: [['Date', `${date}, ${vars.window}`], ['Pets', vars.pets]] })
      jobs.push(['email', o.email, mail.subject, () => sendEmail(env, { to: o.email, ...mail })])
    }
    if (!jobs.length) { out.skipped++; continue }
    for (const [channel, to, body, send] of jobs) {
      if (done.has(`${channel}|${ref}`)) continue
      let id = null
      let error = null
      try { id = (await send()).id } catch (err) { error = String(err.message || err).slice(0, 300) }
      await env.DB.prepare(`INSERT INTO message_log (template_key, channel, to_addr, owner_id, ref, body, status, provider_id, error, sent_by) VALUES ('visit_reminder', ?, ?, ?, ?, ?, ?, ?, ?, 'Reminder')`)
        .bind(channel, to, o.owner_id, ref, body, error ? 'failed' : 'sent', id, error).run().catch(() => {})
      if (error) out.failed++
      else out[channel]++
    }
  }
  return out
}
