// Sending email from hello@ through Resend (the domain is already verified for the website).
// Needs the RESEND_API_KEY secret on the clinic app (README). RESEND_API_URL is for tests only.

import { INBOX_ADDRESS } from './inbox.js'
import { htmlText, sanitizeSignature } from './html.js'

export const FROM = `Hanna Pet Wellness Center <${INBOX_ADDRESS}>`
export const SIGNATURE = // the default; owners and admins can change it in Inbox ▸ Settings (app_settings 'email_signature')
  'Hanna Pet Wellness Center\nVeterinary and Grooming Services\n1266 Unit B Marian Townhouse, Pablo Ocampo St. cor. G. Del Pilar St., Malate, Manila\n(02) 8899-8194 · 0968 661 0021 · 0916 415 8426\nhannapetwellnesscenter.com'
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
export const textToHtml = (t) => esc(t).replace(/\n/g, '<br>')

// The signature on emails sent from the app: the one saved in Inbox Settings (formatted, cleaned), else the
// default. -> { html, text, saved } (text is for the plain-text copy of the email).
export async function getSignature(env) {
  const row = await env.DB.prepare("SELECT value FROM app_settings WHERE key = 'email_signature'").first().catch(() => null)
  const v = row?.value?.trim()
  if (!v) return { html: textToHtml(SIGNATURE), text: SIGNATURE, saved: false }
  const html = /<[a-z]/i.test(v) ? sanitizeSignature(v) : textToHtml(v) // older saves were plain text
  return { html, text: htmlText(html.replace(/<(div|p|tr|table)\b[^>]*>/g, '\n$&').replace(/<a href="([^"]+)">([^<]*)<\/a>/g, (m, h, t) => (t.trim() && !h.includes(t.trim()) && !/^(mailto|tel):/.test(h) ? `${t} (${h.replace(/&amp;/g, '&')})` : t))).replace(/ *\n */g, '\n'), saved: true }
}

// -> { id } from Resend, or throws an Error with a plain-English message
export async function sendEmail(env, { to, subject, text, html, headers }) {
  if (!env.RESEND_API_KEY) throw Object.assign(new Error('Email sending isn’t set up yet. Add the RESEND_API_KEY secret (see the README).'), { status: 503 })
  const res = await fetch(env.RESEND_API_URL || 'https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], reply_to: INBOX_ADDRESS, subject, text, html, headers }),
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw Object.assign(new Error(`The email didn’t go out: ${body?.message || `error ${res.status}`}. Try again in a moment.`), { status: 502 })
  return { id: body?.id || null }
}
