// Texts to clients through Semaphore (semaphore.co), from the approved sender name (HANNAPETVET).
// Secrets on the app (and the intake Worker for reminders): SEMAPHORE_API_KEY and SEMAPHORE_SENDER_NAME.
// Until both are set, texting is off and the Text switches in Settings ▸ Messages can't be turned on.

import { smsSafe } from './messages.js'

export const smsReady = (env) => !!(env.SEMAPHORE_API_KEY && env.SEMAPHORE_SENDER_NAME)
const local = (mobile) => { const m = String(mobile || '').replace(/[^\d+]/g, '').match(/^(?:\+?63|0)?(9\d{9})$/); return m ? `0${m[1]}` : null }

// -> { id } or throws an Error with a plain-English message
export async function sendSms(env, mobile, text) {
  if (!smsReady(env)) throw Object.assign(new Error('Texting isn’t set up yet: it starts once the sender name is approved and its keys are added.'), { status: 503 })
  const number = local(mobile)
  if (!number) throw Object.assign(new Error('That isn’t a Philippine mobile number.'), { status: 400 })
  const form = new URLSearchParams({ apikey: env.SEMAPHORE_API_KEY, number, message: smsSafe(text).slice(0, 459), sendername: env.SEMAPHORE_SENDER_NAME })
  const res = await fetch(env.SEMAPHORE_API_URL || 'https://api.semaphore.co/api/v4/messages', { method: 'POST', body: form })
  const body = await res.json().catch(() => null)
  if (!res.ok || !Array.isArray(body) || !body[0]?.message_id) throw Object.assign(new Error(`The text didn’t go out: ${(Array.isArray(body) ? body[0]?.status : null) || JSON.stringify(body || {}).slice(0, 120) || `error ${res.status}`}. Try again in a moment.`), { status: 502 })
  return { id: String(body[0].message_id) }
}
