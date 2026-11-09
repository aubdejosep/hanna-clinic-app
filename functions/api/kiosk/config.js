// GET /api/kiosk/config  (open: the kiosk page is used without logging in)
// -> what the kiosk page needs: the clinic name, whether the kiosk is on, the agreement text and
//    the "I'm human" (Turnstile) site key. Nothing about clients.

import { json } from '../../../lib/http.js'

export async function onRequestGet({ env }) {
  const c = await env.DB.prepare('SELECT name, kiosk_enabled, kiosk_agreement, kiosk_agreement_enabled FROM clinic WHERE id = 1').first()
  return json({
    clinicName: c?.name || 'Hanna Pet Wellness Center',
    enabled: !!c?.kiosk_enabled && !!env.TURNSTILE_SITE_KEY && !!env.TURNSTILE_SECRET_KEY,
    switchedOff: !c?.kiosk_enabled,
    agreement: (c?.kiosk_agreement_enabled && c?.kiosk_agreement) || null,
    turnstileSiteKey: env.TURNSTILE_SITE_KEY || null,
  })
}
