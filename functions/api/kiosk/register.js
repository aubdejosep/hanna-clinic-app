// POST /api/kiosk/register  (open: clients use the kiosk without logging in)
//
// A pet owner registers themselves and their pets from the QR code at the clinic.
// Guarded by: the kiosk switch on the Clinic profile, Cloudflare Turnstile ("I'm human"),
// and at most 10 sign-ups per network per hour. It never reveals whether someone is already
// a client: a sign-up whose mobile is already on file is saved with a "Check" flag for staff.

import { json, fail, readJson, clean, cleanMultiline, normalizeMobile, isEmail, audit } from '../../../lib/http.js'
import { petInput, nextCustomerNo } from '../../../lib/clients.js'
import { sha256 } from '../../../lib/auth.js'

const PER_HOUR = 10

async function human(env, token, ip) {
  if (!token || !env.TURNSTILE_SECRET_KEY) return false
  const form = new FormData()
  form.append('secret', env.TURNSTILE_SECRET_KEY)
  form.append('response', token)
  if (ip) form.append('remoteip', ip)
  try {
    // TURNSTILE_VERIFY_URL is only for local testing (pointing at a stand-in); never set it on the live site.
    const res = await fetch(env.TURNSTILE_VERIFY_URL || 'https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form })
    return (await res.json()).success === true
  } catch {
    return false
  }
}

export async function onRequestPost({ request, env }) {
  const settings = await env.DB.prepare('SELECT kiosk_enabled, kiosk_agreement, kiosk_agreement_enabled FROM clinic WHERE id = 1').first()
  if (!settings?.kiosk_enabled || !env.TURNSTILE_SECRET_KEY) return fail(503, 'Sign-up at the kiosk is closed right now. Please ask the front desk.')

  const body = await readJson(request)
  if (!body) return fail(400, 'Something went wrong sending the form. Please try again.')
  const ip = request.headers.get('CF-Connecting-IP') || ''
  const actor = `kiosk:${(await sha256(`kiosk:${ip}`)).slice(0, 16)}`
  const since = new Date(Date.now() - 3600 * 1000).toISOString()
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE actor = ? AND action = 'kiosk_register' AND at > ?").bind(actor, since).first()
  if (recent.n >= PER_HOUR) return fail(429, 'Lots of sign-ups from this connection. Please ask the front desk to help you.')
  if (!(await human(env, body.turnstileToken, ip))) return fail(400, "Please tick the \"I'm human\" check again, then press Register.", { code: 'turnstile' })

  // --- Owner ---
  const o = body.owner || {}
  const errors = {}
  const first = clean(o.firstName, 50)
  const last = clean(o.lastName, 50)
  if (!first) errors['owner.firstName'] = 'Enter your first name.'
  if (!last) errors['owner.lastName'] = 'Enter your last name.'
  const mobile = normalizeMobile(o.mobile)
  if (!mobile) errors['owner.mobile'] = 'Enter your mobile number, like 0917 123 4567.'
  const email = clean(o.email, 100).toLowerCase()
  if (email && !isEmail(email)) errors['owner.email'] = 'Check your email address, e.g. name@gmail.com.'
  if (!o.reminders) errors['owner.reminders'] = 'Tick the box to get appointment reminders.'
  if (settings.kiosk_agreement_enabled && settings.kiosk_agreement && !body.agreed) errors.agreed = 'Please read and accept the agreement.'

  // --- Pets ---
  const petsIn = Array.isArray(body.pets) ? body.pets.slice(0, 5) : []
  if (!petsIn.length) errors['pets'] = 'Add at least one pet.'
  const pets = petsIn.map((p, i) => {
    const r = petInput(p || {})
    Object.entries(r.errors).forEach(([k, v]) => { errors[`pets.${i}.${k}`] = v })
    return r.values
  })
  if (Object.keys(errors).length) return fail(400, 'Some details need fixing.', { errors })

  const address = [clean(o.street, 100), clean(o.city, 50), [clean(o.province, 30), clean(o.postalCode, 10)].filter(Boolean).join(' '), clean(o.country, 40) || 'Philippines']
    .filter(Boolean).join(', ')
  const existing = await env.DB.prepare('SELECT COUNT(*) AS n FROM owners WHERE mobile = ? AND deleted_at IS NULL').bind(mobile).first()
  const flags = ['kiosk', ...(existing.n ? ['shared_phone'] : [])]

  let owner
  for (let attempt = 0; attempt < 2 && !owner; attempt++) {
    try {
      owner = await env.DB.prepare(`INSERT INTO owners (customer_no, full_name, mobile, email, messenger, address, reminders_opt_in, source, review_flags)
        VALUES (?, ?, ?, ?, ?, ?, 1, 'walk_in', ?) RETURNING id, customer_no`)
        .bind(await nextCustomerNo(env), `${first} ${last}`, mobile, email || null, clean(o.messenger, 200) || null, address, JSON.stringify(flags)).first()
    } catch (err) {
      if (attempt === 0 && /UNIQUE.*customer_no/i.test(String(err))) continue
      throw err
    }
  }
  await env.DB.batch(pets.map((p) => {
    const cols = { ...p, owner_id: owner.id, notes: p.notes ? cleanMultiline(p.notes, 2000) : null }
    return env.DB.prepare(`INSERT INTO pets (${Object.keys(cols).join(', ')}) VALUES (${Object.keys(cols).map(() => '?').join(', ')})`).bind(...Object.values(cols))
  }))
  await audit(env, actor, 'kiosk_register', 'owner', owner.id, { pets: pets.length, sharedPhone: !!existing.n })
  return json({ ok: true, firstName: first, pets: pets.map((p) => p.name) }, 201)
}
