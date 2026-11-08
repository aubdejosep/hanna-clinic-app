// One way to talk to /api. Errors come back as ApiError with the server's plain-English message.

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || 'Something went wrong. Please try again.')
    this.status = status
    this.body = body || {}
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  let res
  try {
    res = await fetch(`/api/${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    })
  } catch {
    throw new ApiError(0, { error: "Can't reach the clinic app. Check the internet connection, then try again." })
  }
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    // Access login ran out: a full reload sends the browser through the PIN login again.
    if (res.status === 401) window.location.reload()
    throw new ApiError(res.status, data)
  }
  return data
}

export function query(params) {
  const q = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => { if (v !== '' && v != null && v !== false) q.set(k, v) })
  const s = q.toString()
  return s ? `?${s}` : ''
}
