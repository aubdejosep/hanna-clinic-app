// GET  /api/reminders            -> the workflow reminders for the logged-in staff member (the bell)
// POST /api/reminders {key, reason} -> "Not Needed": hides that reminder for everyone

import { json, fail, readJson, clean, audit } from '../../../lib/http.js'
import { computeReminders, forStaff } from '../../../lib/reminders.js'
import { pullWebsiteBookings } from '../../../lib/website.js'
import { pullFreeConsults } from '../../../lib/website-signups.js'
import { cached } from '../../../lib/cache.js'

// Worked out at most every 2 minutes for everyone (?fresh=1 when the bell is opened).
export async function onRequestGet({ request, env, data }) {
  const fresh = new URL(request.url).searchParams.get('fresh') === '1'
  const all = await cached(env, 'reminders', 2 * 60 * 1000, async () => {
    await pullWebsiteBookings(env).catch((err) => console.log('Website bookings', String(err).slice(0, 300)))
    await pullFreeConsults(env).catch((err) => console.log('Website sign-ups', String(err).slice(0, 300)))
    return computeReminders(env)
  }, { fresh })
  return json({ reminders: forStaff(all, data.staff) })
}

export async function onRequestPost({ request, env, data }) {
  const body = (await readJson(request)) || {}
  const key = clean(body.key, 60)
  if (!/^((follow_up|dispense|no_services|no_vet|pet_info|owner_info|website_client|online_booking):\d+|(low_stock|expiring):\d{4}-\d\d-\d\d)$/.test(key)) return fail(400, 'This reminder was not found.')
  await env.DB.prepare('INSERT OR REPLACE INTO reminder_dismissals (key, dismissed_by, reason) VALUES (?, ?, ?)').bind(key, data.staff.name, clean(body.reason, 200) || null).run()
  await audit(env, data.staff.email, 'dismiss_reminder', 'reminder', key, { reason: clean(body.reason, 200) || null })
  return json({ ok: true })
}
