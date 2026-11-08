// Password hashing that runs the same in Cloudflare Workers and in Node (scripts/set-password.mjs).
// PBKDF2-SHA256 with a random salt; 100,000 rounds is the most Workers allows.

const ITERATIONS = 100000
const enc = new TextEncoder()
const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
const unb64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0))

async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256)
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  return `pbkdf2-sha256$${ITERATIONS}$${b64(salt)}$${b64(await derive(password, salt, ITERATIONS))}`
}

export async function checkPassword(password, stored) {
  const [scheme, iter, salt, hash] = String(stored || '').split('$')
  if (scheme !== 'pbkdf2-sha256' || !hash) return false
  const got = new Uint8Array(await derive(password, unb64(salt), Number(iter)))
  const want = unb64(hash)
  if (got.length !== want.length) return false
  let diff = 0
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i] // same time whether it matches early or late
  return diff === 0
}

// -> error message, or '' when the password is acceptable.
const COMMON = ['password', '1234567890', '0123456789', 'qwertyuiop', 'iloveyou', 'hanna', 'hannapet', 'wellness', 'letmein', 'welcome']
export function passwordProblem(password) {
  const p = String(password || '')
  if (p.length < 10) return 'Use at least 10 characters. A short sentence is easy to remember.'
  if (p.length > 200) return 'Use 200 characters or fewer.'
  const lower = p.toLowerCase()
  if (/^(.)\1+$/.test(p) || COMMON.some((w) => lower.startsWith(w) && lower.replace(/[^a-z]/g, '').length <= w.length + 2)) {
    return 'That password is too easy to guess. Try a short sentence instead.'
  }
  return ''
}
