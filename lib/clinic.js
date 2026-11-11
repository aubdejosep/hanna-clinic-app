// The clinic's business details, opening hours and kiosk settings.

import { clean, cleanMultiline, isEmail, manilaToday } from './http.js'

export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
export const SOCIAL = ['facebook', 'x', 'instagram', 'tiktok', 'viber', 'whatsapp', 'messenger']
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const json = (text, fallback) => { try { return JSON.parse(text) } catch { return fallback } }

export async function loadClinic(env) {
  const [c, b, cd] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM clinic WHERE id = 1'),
    env.DB.prepare('SELECT * FROM branches WHERE id = 1'),
    env.DB.prepare('SELECT id, day, open, close, reason, created_by FROM closed_dates WHERE branch_id = 1 AND deleted_at IS NULL AND day >= ? ORDER BY day').bind(manilaToday()),
  ])
  const clinic = c.results[0]
  const branch = b.results[0]
  return {
    name: clinic.name,
    tagline: clinic.tagline,
    descriptor: clinic.descriptor,
    email: clinic.email,
    phones: json(clinic.phones, []),
    website: clinic.website,
    about: clinic.about,
    social: json(clinic.social, {}),
    kioskEnabled: !!clinic.kiosk_enabled,
    kioskAgreement: clinic.kiosk_agreement,
    kioskAgreementEnabled: !!clinic.kiosk_agreement_enabled,
    taxRate: clinic.tax_rate,
    ccBusinessEmail: !!clinic.cc_business_email,
    emailBrandColor: clinic.email_brand_color,
    address: branch.address,
    hours: json(branch.hours, {}),
    onlineLimits: json(branch.online_limits, null) || {},
    closedDates: cd.results.map((d) => ({ id: d.id, day: d.day, open: d.open, close: d.close, reason: d.reason, addedBy: d.created_by })),
    updatedAt: clinic.updated_at,
    updatedBy: clinic.updated_by,
  }
}

// -> { clinic: {column: value}, branch: {column: value}, errors }
export function clinicInput(body) {
  const clinic = {}
  const branch = {}
  const errors = {}
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k)

  if (has('name')) {
    clinic.name = clean(body.name, 80)
    if (!clinic.name) errors.name = 'Enter the clinic name.'
  }
  if (has('tagline')) clinic.tagline = clean(body.tagline, 120) || null
  if (has('descriptor')) clinic.descriptor = clean(body.descriptor, 80) || null
  if (has('email')) {
    clinic.email = clean(body.email, 100).toLowerCase() || null
    if (clinic.email && !isEmail(clinic.email)) errors.email = 'Check the email address.'
  }
  if (has('phones')) {
    const list = (Array.isArray(body.phones) ? body.phones : []).map((p) => clean(p, 30)).filter(Boolean).slice(0, 5)
    clinic.phones = JSON.stringify(list)
  }
  if (has('website')) clinic.website = clean(body.website, 200) || null
  if (has('about')) clinic.about = cleanMultiline(body.about, 500) || null
  if (has('social')) {
    const s = body.social && typeof body.social === 'object' ? body.social : {}
    clinic.social = JSON.stringify(Object.fromEntries(SOCIAL.map((k) => [k, clean(s[k], 200)]).filter(([, v]) => v)))
  }
  if (has('kioskEnabled')) clinic.kiosk_enabled = body.kioskEnabled ? 1 : 0
  if (has('kioskAgreement')) clinic.kiosk_agreement = cleanMultiline(body.kioskAgreement, 3000) || null
  if (has('kioskAgreementEnabled')) clinic.kiosk_agreement_enabled = body.kioskAgreementEnabled ? 1 : 0
  if (has('ccBusinessEmail')) clinic.cc_business_email = body.ccBusinessEmail ? 1 : 0
  if (has('taxRate')) {
    const n = Number(String(body.taxRate).replace('%', '').trim())
    if (!Number.isFinite(n) || n < 0 || n > 100) errors.taxRate = 'Enter a tax rate from 0 to 100.'
    else clinic.tax_rate = Math.round(n * 100) / 100
  }
  if (has('emailBrandColor')) {
    const c = clean(body.emailBrandColor, 7)
    if (!/^#[0-9a-f]{6}$/i.test(c)) errors.emailBrandColor = 'Use a colour like #0E7C78.'
    else clinic.email_brand_color = c.toUpperCase()
  }
  if (has('address')) {
    branch.address = cleanMultiline(body.address, 300)
    if (!branch.address) errors.address = 'Enter the clinic address.'
  }
  if (has('hours')) {
    const out = {}
    const h = body.hours && typeof body.hours === 'object' ? body.hours : {}
    for (const day of DAYS) {
      const d = h[day]
      if (!d) continue
      if (!TIME.test(d.open || '') || !TIME.test(d.close || '') || d.open >= d.close) {
        errors.hours = 'Each open day needs an opening time before its closing time.'
        continue
      }
      const breaks = (Array.isArray(d.breaks) ? d.breaks : []).slice(0, 3).filter((b) => b && (b.start || b.end))
      for (const b of breaks) {
        if (!TIME.test(b.start || '') || !TIME.test(b.end || '') || b.start >= b.end || b.start < d.open || b.end > d.close) {
          errors.hours = 'Each break needs a start before its end, inside opening hours.'
        }
      }
      out[day] = { open: d.open, close: d.close, breaks: breaks.map((b) => ({ start: b.start, end: b.end })) }
    }
    branch.hours = JSON.stringify(out)
  }
  if (has('onlineLimits')) {
    const l = body.onlineLimits && typeof body.onlineLimits === 'object' ? body.onlineLimits : {}
    const out = {}
    for (const k of ['day', 'morning', 'afternoon']) {
      const raw = l[k]
      if (raw === '' || raw == null || Number(raw) === 0) continue
      const n = Number(raw)
      if (!Number.isInteger(n) || n < 1 || n > 500) errors.onlineLimits = 'Each limit is a whole number of pets, from 1 to 500, or blank for no limit.'
      else out[k] = n
    }
    branch.online_limits = Object.keys(out).length ? JSON.stringify(out) : null
  }
  return { clinic, branch, errors }
}
