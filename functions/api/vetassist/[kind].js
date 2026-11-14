// POST /api/vetassist/:kind -> owners and admins: one batch of cleaned rows from a VetAssist file.
//   {rows, apply: false}            -> what would change (nothing is written)
//   {rows, apply: true}             -> applies it
//   {finish: true, counts, fileName} -> after the last batch: the follow-up steps (appointments: link
//                                       reschedules; records: link visits, settle open bookings), then
//                                       the run is logged (shown on the page) and audited.
// kind: owners, pets, deceased, appointments, records, photos, services, products. Rules: lib/vetassist-sync.js.

import { json, fail, readJson, canManage, audit, clean } from '../../../lib/http.js'
import { finishAppointments, finishRecords, syncAppointments, syncDeceased, syncOwners, syncPets, syncPhotos, syncProducts, syncRecords, syncServices } from '../../../lib/vetassist-sync.js'

const KINDS = { owners: syncOwners, pets: syncPets, deceased: syncDeceased, appointments: syncAppointments, records: syncRecords, photos: syncPhotos, services: syncServices, products: syncProducts }
const LOGGED = { owners: 'owners_pets', pets: 'owners_pets' }
const MAX_ROWS = 1000

export async function onRequestPost({ request, env, params, data }) {
  if (!canManage(data.staff)) return fail(403, 'Only an owner or admin can import from VetAssist.')
  const kind = String(params.kind)
  if (!KINDS[kind]) return fail(404, 'This import was not found.')
  const b = (await readJson(request)) || {}
  if (b.finish) {
    const extra = kind === 'appointments' ? await finishAppointments(env) : kind === 'records' ? await finishRecords(env) : {}
    const now = new Date().toISOString()
    const counts = { ...(b.counts && typeof b.counts === 'object' ? b.counts : {}), ...extra }
    await env.DB.prepare('INSERT INTO vetassist_syncs (kind, file_name, counts, started_at, finished_at, staff_id, staff_name) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(LOGGED[kind] || kind, clean(b.fileName, 200) || null, JSON.stringify(counts).slice(0, 2000), clean(b.startedAt, 40) || now, now, data.staff.id, data.staff.name).run()
    await audit(env, data.staff.email, 'vetassist_import', kind, null, counts)
    return json({ done: true, ...extra })
  }
  const rows = b.rows
  if (!Array.isArray(rows) || !rows.length) return fail(400, 'Nothing to import in this batch.')
  if (rows.length > MAX_ROWS) return fail(400, `Send up to ${MAX_ROWS} rows at a time.`)
  try {
    return json(await KINDS[kind](env, rows, { apply: !!b.apply, on: b.on, pendingOwners: Array.isArray(b.pendingOwners) ? b.pendingOwners.slice(0, 5000) : [] }))
  } catch (err) {
    console.log('vetassist import', kind, String(err?.stack || err).slice(0, 500))
    return fail(500, `This batch didn’t go through (${String(err.message || err).slice(0, 120)}). Run the import again: rows already saved are skipped.`)
  }
}
