// GET /api/vetassist -> owners and admins: the last import of each kind (Clinic Operations ▸ Import from VetAssist)

import { json, fail, canManage } from '../../../lib/http.js'

export async function onRequestGet({ env, data }) {
  if (!canManage(data.staff)) return fail(403, 'Only an owner or admin can import from VetAssist.')
  const { results } = await env.DB.prepare(`SELECT s.* FROM vetassist_syncs s WHERE s.finished_at IS NOT NULL AND s.id = (SELECT MAX(id) FROM vetassist_syncs x WHERE x.kind = s.kind AND x.finished_at IS NOT NULL)`).all()
  return json({ last: Object.fromEntries(results.map((r) => [r.kind, { at: r.finished_at, by: r.staff_name, file: r.file_name, counts: JSON.parse(r.counts || '{}') }])) })
}
