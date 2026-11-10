// GET /api/staff/directory -> active staff names and roles, for Staff Assignment (every staff member).
// The full staff list (/api/staff) stays owners-only.

import { json } from '../../../lib/http.js'

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(`SELECT id, first_name, last_name, title, role FROM staff WHERE active = 1
    ORDER BY CASE role WHEN 'vet' THEN 0 WHEN 'owner' THEN 1 ELSE 2 END, first_name COLLATE NOCASE`).all()
  return json({ staff: results.map((s) => ({ id: s.id, name: `${s.first_name} ${s.last_name}`.trim(), title: s.title, role: s.role })) })
}
