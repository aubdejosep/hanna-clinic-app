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
  }
}

export function recordOut(r, entries = []) {
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
  const by = {}
  for (const e of ents) (by[e.record_id] ||= []).push(e)
  return recs.map((r) => recordOut(r, by[r.id] || []))
}
