// GET  /api/reminders            -> the workflow reminders for the logged-in staff member (the bell)
// POST /api/reminders {key, reason} -> "Not Needed": hides that reminder for everyone

import { json, fail, readJson, clean, audit } from '../../../lib/http.js'
import { computeReminders, forStaff } from '../../../lib/reminders.js'

export async function onRequestGet({ env, data }) {
  const reminders = forStaff(await computeReminders(env), data.staff)
  return json({ reminders })
}

export async function onRequestPost({ request, env, data }) {
  const body = (await readJson(request)) || {}
  const key = clean(body.key, 60)
  if (!/^(follow_up|dispense|no_services|no_vet|pet_info|owner_info):\d+$/.test(key)) return fail(400, 'This reminder was not found.')
  await env.DB.prepare('INSERT OR REPLACE INTO reminder_dismissals (key, dismissed_by, reason) VALUES (?, ?, ?)').bind(key, data.staff.name, clean(body.reason, 200) || null).run()
  await audit(env, data.staff.email, 'dismiss_reminder', 'reminder', key, { reason: clean(body.reason, 200) || null })
  return json({ ok: true })
}
