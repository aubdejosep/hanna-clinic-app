// Runs before every /api route: only logged-in, active staff get through.
// The route then finds the caller in context.data.staff.
// Open without logging in: /api/auth/login (to log in) and the two kiosk routes (clients sign
// themselves up from the QR code; those check the kiosk switch, Turnstile and a per-network limit).

import { currentStaff, AUTH_ERRORS } from '../../lib/auth.js'
import { fail } from '../../lib/http.js'

const OPEN = new Set(['/api/auth/login', '/api/kiosk/config', '/api/kiosk/register'])

export async function onRequest(context) {
  const { request } = context
  const url = new URL(request.url)

  // Changes must come from the app's own pages, not from another website.
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const origin = request.headers.get('Origin')
    if (origin && origin !== url.origin) return fail(403, 'This request came from another website and was blocked.')
  }
  if (OPEN.has(url.pathname)) return runRoute(context)

  let result
  try {
    result = await currentStaff(request, context.env)
  } catch (err) {
    console.log('Login check failed', String(err?.stack || err).slice(0, 800))
    return fail(503, "The clinic app can't reach its database right now. Please try again in a minute.")
  }
  if (result.error) {
    const [status, message] = AUTH_ERRORS[result.error]
    return fail(status, message, { code: result.error })
  }
  context.data.staff = result.staff
  context.data.sessionId = result.sessionId
  const response = await runRoute(context)
  if (result.setCookie) {
    const copy = new Response(response.body, response)
    copy.headers.append('Set-Cookie', result.setCookie)
    return copy
  }
  return response
}

async function runRoute(context) {
  try {
    return await context.next()
  } catch (err) {
    console.log('API error', context.request.method, new URL(context.request.url).pathname, String(err?.stack || err).slice(0, 800))
    return fail(500, 'Something went wrong on our side. Please try again.')
  }
}
