// Finances ▸ Transactions: the three lists (Invoices, Invoice Items, Payments), each made of what was
// done in the app plus what was imported from the old system. Shared paging, search and date filters.

const DAY = /^\d{4}-\d{2}-\d{2}$/

// rows: an SQL that yields at least day, at, source, client, pet, invoice_no. sums: SQL aggregate columns.
export async function listOf(env, url, rows, sums) {
  const u = url.searchParams
  const from = DAY.test(u.get('from') || '') ? u.get('from') : null
  const to = DAY.test(u.get('to') || '') ? u.get('to') : null
  const q = (u.get('q') || '').trim().slice(0, 60)
  const source = ['app', 'old'].includes(u.get('source')) ? u.get('source') : null
  const size = Math.min(100, Math.max(10, Number(u.get('size')) || 25))
  const page = Math.max(1, Number(u.get('page')) || 1)
  const where = []
  const binds = []
  if (from) { where.push('day >= ?'); binds.push(from) }
  if (to) { where.push('day <= ?'); binds.push(to) }
  if (source) { where.push('source = ?'); binds.push(source) }
  if (q) { where.push('(client LIKE ? OR pet LIKE ? OR invoice_no LIKE ?)'); binds.push(`%${q}%`, `%${q}%`, `%${q}%`) }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const [list, totals] = await env.DB.batch([
    env.DB.prepare(`SELECT * FROM (${rows}) ${w} ORDER BY day IS NULL, day DESC, at DESC, id DESC LIMIT ? OFFSET ?`).bind(...binds, size, (page - 1) * size),
    env.DB.prepare(`SELECT COUNT(*) AS n${sums ? `, ${sums}` : ''} FROM (${rows}) ${w}`).bind(...binds),
  ])
  return { rows: list.results, totals: totals.results[0], page, size }
}
