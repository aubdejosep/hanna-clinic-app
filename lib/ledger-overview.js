// Dashboard ▸ Overview ▸ Ledger (owners and admins): Finances ▸ Ledger per day for a period, with the period
// before. Income and Commissions from the receipts (Total Income, Commissions), Expenses from the expenses;
// rows removed (bin icon, Undo Import) left out.

const addDays = (day, n) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

export async function ledgerOverview(env, r) {
  const lo = r.prevFrom < r.from ? r.prevFrom : r.from
  const [lines, expenses] = await env.DB.batch([
    env.DB.prepare(`SELECT day, SUM(COALESCE(income_cents, 0)) AS income, SUM(COALESCE(commission_cents, 0)) AS commissions
      FROM cash_lines WHERE branch_id = 1 AND deleted_at IS NULL AND day BETWEEN ?1 AND ?2 GROUP BY day`).bind(lo, r.to),
    env.DB.prepare('SELECT day, SUM(amount_cents) AS expenses FROM cash_expenses WHERE branch_id = 1 AND deleted_at IS NULL AND day BETWEEN ?1 AND ?2 GROUP BY day').bind(lo, r.to),
  ])
  const by = {}
  for (const x of lines.results) by[x.day] = { income: x.income / 100, commissions: x.commissions / 100, expenses: 0 }
  for (const x of expenses.results) (by[x.day] ||= { income: 0, commissions: 0, expenses: 0 }).expenses = x.expenses / 100
  const perDay = []
  for (let d = r.from; d <= r.to; d = addDays(d, 1)) perDay.push({ day: d, income: 0, expenses: 0, commissions: 0, ...by[d] })
  const total = (from, to) => Object.entries(by).filter(([d]) => d >= from && d <= to).reduce((t, [, v]) => ({
    income: t.income + v.income, expenses: t.expenses + v.expenses, commissions: t.commissions + v.commissions }), { income: 0, expenses: 0, commissions: 0 })
  return { range: r, cur: total(r.from, r.to), prev: total(r.prevFrom, r.prevTo), perDay, days: perDay.filter((d) => by[d.day]).length }
}
