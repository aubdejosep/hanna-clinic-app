// Runs before every /api route: only logged-in, active staff get through.
// The route then finds the caller in context.data.staff.

import { currentStaff, AUTH_ERRORS } from '../../lib/auth.js'
import { fail } from '../../lib/http.js'

export async function onRequest(context) {
  const result = await currentStaff(context.request, context.env)
  if (result.error) {
    const [status, message] = AUTH_ERRORS[result.error]
    return fail(status, message, { code: result.error, email: result.email })
  }
  context.data.staff = result.staff
  try {
    return await context.next()
  } catch (err) {
    console.log('API error', context.request.method, new URL(context.request.url).pathname, String(err?.stack || err).slice(0, 800))
    return fail(500, 'Something went wrong on our side. Please try again.')
  }
}
