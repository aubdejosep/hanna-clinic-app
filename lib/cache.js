// A small shared cache in the sync_state table: one result worked out at most once per `ttlMs`
// for everyone, instead of on every open tab. Costs one row read when fresh.

export async function cached(env, key, ttlMs, compute, { fresh = false } = {}) {
  if (!fresh) {
    const row = await env.DB.prepare('SELECT value, at FROM sync_state WHERE key = ?').bind(key).first()
    if (row && Date.now() - Date.parse(row.at) < ttlMs) {
      try { return JSON.parse(row.value) } catch { /* recompute */ }
    }
  }
  const value = await compute()
  await env.DB.prepare('INSERT OR REPLACE INTO sync_state (key, value, at) VALUES (?, ?, ?)').bind(key, JSON.stringify(value), new Date().toISOString()).run()
  return value
}

// After a change that the cached lists show (a booking, a status step), drop those results.
export async function forget(env, ...keys) {
  if (!keys.length) return
  await env.DB.prepare(`DELETE FROM sync_state WHERE key IN (${keys.map(() => '?').join(',')})`).bind(...keys).run()
}
