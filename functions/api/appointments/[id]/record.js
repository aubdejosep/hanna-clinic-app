// POST /api/appointments/:id/record {type: note|diagnosis|prescription|treatment_plan, title, description,
//   details (treatment plan), medicines: [{productId|name, dose, qty, dispense}]}
//   -> a vet writes on the visit's medical record (vets, owners and admins). A prescription's medicines
//      given from the clinic's stock are also added to the visit (so they're paid for and come off stock).

import { json, fail, readJson, audit } from '../../../../lib/http.js'
import { itemRows, insertItems } from '../../../../lib/appointments.js'
import { syncVisit, visitRecordId } from '../../../../lib/visitRecord.js'
import { WRITERS, entryInput } from '../../../../lib/recordInput.js'

export async function onRequestPost({ request, env, params, data }) {
  if (!WRITERS.includes(data.staff.role)) return fail(403, 'Only vets and clinic owners write medical records.')
  const id = Number(params.id)
  const appt = await env.DB.prepare('SELECT * FROM appointments WHERE id = ? AND deleted_at IS NULL').bind(id).first()
  if (!appt) return fail(404, 'This appointment was not found.')
  if (['cancelled', 'no_show', 'accepted', 'pending'].includes(appt.status)) return fail(400, 'Medical records are written once the pet is in the clinic. Check them in first.')
  const body = (await readJson(request)) || {}
  const { values: v, errors } = entryInput(body)
  if (Object.keys(errors).length) return fail(400, 'Some details need fixing.', { errors })

  let items = []
  if (v.type === 'prescription') {
    const given = v.medicines.filter((m) => m.dispense && m.qty > 0)
    const rows = await itemRows(env, given.map((m) => ({ productId: m.productId, name: m.name, kind: 'product', detail: m.dose, qty: m.qty })), { actor: data.staff.name })
    if (rows.length) await env.DB.batch(insertItems(env, id, rows, data.staff.name))
    // Names as the list has them (a typed medicine is now on the list too).
    items = v.medicines.map((m) => {
      const r = rows.find((x) => (m.productId && x.product_id === m.productId) || x.name.toLowerCase() === (m.name || '').toLowerCase())
      return { kind: 'product', name: r?.name || m.name, detail: m.dose, qty: m.qty || null, ...(r?.product_id || m.productId ? { productId: r?.product_id || m.productId } : {}), ...(m.dispense ? {} : { notes: 'Not given from the clinic' }) }
    })
  }
  const recId = await visitRecordId(env, appt, true)
  const sort = await env.DB.prepare('SELECT COALESCE(MAX(sort), -1) + 1 AS n FROM medical_entries WHERE record_id = ? AND auto IS NULL').bind(recId).first()
  const row = await env.DB.prepare(`INSERT INTO medical_entries (record_id, pet_id, day, type, title, description, items, details, sort, created_by, staff_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`).bind(recId, appt.pet_id, appt.day, v.type, v.title || (v.type === 'prescription' ? 'Prescription' : null),
    v.description, JSON.stringify(items), v.details && Object.keys(v.details).length ? JSON.stringify(v.details) : null, Math.min(sort.n, 999), data.staff.name, data.staff.id).first()
  if (items.length) await syncVisit(env, id, data.staff) // medicines given now: stock and the services entry follow if already checked out
  await audit(env, data.staff.email, 'write_record', 'medical_entry', row.id, { appointment: id, type: v.type, title: v.title })
  return json({ ok: true, entryId: row.id }, 201)
}
