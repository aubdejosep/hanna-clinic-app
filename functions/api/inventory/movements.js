// GET /api/inventory/movements?productId=&kind=&from=&to=&q=&page= -> Stock Movements: every change, newest first

import { json, isoDay, pageArgs } from '../../../lib/http.js'
import { moveOut } from './[id].js'

const KINDS = ['count', 'receive', 'visit', 'sale', 'adjust', 'reversal']

export async function onRequestGet({ env, request }) {
  const url = new URL(request.url)
  const { page, size, offset } = pageArgs(url, 50)
  const where = ['1 = 1']
  const binds = []
  const productId = Number(url.searchParams.get('productId'))
  if (productId) { where.push('m.product_id = ?'); binds.push(productId) }
  const kind = url.searchParams.get('kind')
  if (KINDS.includes(kind)) { where.push('m.kind = ?'); binds.push(kind) }
  const from = isoDay(url.searchParams.get('from'))
  const to = isoDay(url.searchParams.get('to'))
  // Manila days -> UTC times
  if (from) { where.push('m.at >= ?'); binds.push(new Date(`${from}T00:00:00+08:00`).toISOString()) }
  if (to) { where.push('m.at < ?'); binds.push(new Date(new Date(`${to}T00:00:00+08:00`).getTime() + 864e5).toISOString()) }
  const q = String(url.searchParams.get('q') || '').trim()
  if (q) { where.push('(p.name LIKE ? OR m.staff_name LIKE ? OR m.reason LIKE ?)'); binds.push(`%${q}%`, `%${q}%`, `%${q}%`) }
  const sql = `FROM stock_movements m JOIN products p ON p.id = m.product_id LEFT JOIN appointments a ON a.id = m.appointment_id LEFT JOIN pets pt ON pt.id = a.pet_id WHERE ${where.join(' AND ')}`
  const [rows, total] = await env.DB.batch([
    env.DB.prepare(`SELECT m.*, p.name AS product_name, p.unit, pt.name AS pet_name ${sql} ORDER BY m.at DESC, m.id DESC LIMIT ? OFFSET ?`).bind(...binds, size, offset),
    env.DB.prepare(`SELECT COUNT(*) AS n ${sql}`).bind(...binds),
  ])
  return json({ movements: rows.results.map(moveOut), total: total.results[0].n, page, pageSize: size })
}
