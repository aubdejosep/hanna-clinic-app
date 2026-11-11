// Medical records: shaping rows for the screens. Read-only for now (imported from the old system).

function json(text, fallback) {
  try {
    return text ? JSON.parse(text) : fallback
  } catch {
    return fallback
  }
}

export const ENTRY_TYPES = ['note', 'vaccination', 'diagnosis', 'treatment_plan', 'prescription', 'other']

export function entryOut(e) {
  return {
    id: e.id,
    recordId: e.record_id,
    day: e.day,
    type: e.type,
    title: e.title,
    description: e.description,
    items: json(e.items, []),
    details: json(e.details, null),
    imageCount: e.image_count,
    images: e.images || [],
    auto: e.auto || null,
    by: e.created_by || null,
    at: e.source_staff ? e.created_at : null,
    edited: e.updated_at && !e.auto ? { at: e.updated_at, by: e.updated_by } : null,
  }
}

export function recordOut(r, entries = []) {
  for (const e of entries) e.source_staff = r.source === 'staff'
  return {
    id: r.id,
    day: r.day,
    kind: r.kind,
    bookingOnly: !!r.booking_only,
    // A booking the old system never closed was settled as No Show by the import: say that, not "no show".
    appointmentStatus: r.appt_status === 'no_show' && ['Accepted', 'Pending'].includes(r.appt_legacy_status) ? 'unclosed' : r.appt_status || null,
    source: r.source,
    appointmentId: r.appointment_id,
    appointmentNo: r.legacy_appointment_no,
    legacyRecordId: r.legacy_record_id,
    entries: entries.map(entryOut),
  }
}

// Records with their entries, newest first.
export async function recordsWithEntries(env, where, binds, { limit = 500, offset = 0 } = {}) {
  const { results: recs } = await env.DB.prepare(`SELECT *, (SELECT a.status FROM appointments a WHERE a.id = medical_records.appointment_id) AS appt_status,
      (SELECT a.legacy_status FROM appointments a WHERE a.id = medical_records.appointment_id) AS appt_legacy_status
    FROM medical_records WHERE deleted_at IS NULL AND ${where}
    ORDER BY day DESC, id DESC LIMIT ? OFFSET ?`).bind(...binds, limit, offset).all()
  if (!recs.length) return []
  const ids = recs.map((r) => r.id)
  const { results: ents } = await env.DB.prepare(`SELECT * FROM medical_entries WHERE deleted_at IS NULL
    AND record_id IN (${ids.map(() => '?').join(',')}) ORDER BY record_id, sort, id`).bind(...ids).all()
  await attachImages(env, ents)
  const by = {}
  for (const e of ents) (by[e.record_id] ||= []).push(e)
  // A visit record whose entries were all removed isn't shown.
  return recs.map((r) => recordOut(r, by[r.id] || [])).filter((r) => r.entries.length)
}

// Photos for these entries: [{id, width, height, bytes}] on each entry, in order.
export async function attachImages(env, ents) {
  const ids = ents.filter((e) => e.image_count > 0).map((e) => e.id)
  if (!ids.length) return
  const rows = []
  for (let i = 0; i < ids.length; i += 90) {
    const part = ids.slice(i, i + 90)
    rows.push(...(await env.DB.prepare(`SELECT id, entry_id, width, height, bytes FROM medical_images WHERE deleted_at IS NULL AND entry_id IN (${part.map(() => '?').join(',')}) ORDER BY entry_id, sort, id`).bind(...part).all()).results)
  }
  const by = {}
  for (const r of rows) (by[r.entry_id] ||= []).push({ id: r.id, width: r.width, height: r.height, bytes: r.bytes })
  for (const e of ents) e.images = by[e.id] || []
}
