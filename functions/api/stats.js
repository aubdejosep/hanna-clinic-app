// GET /api/stats -> numbers for the dashboard cards.
// "New" counts use the date the record was first added (old-system date for imported rows).
import { json, manilaToday } from '../../lib/http.js'

export async function onRequestGet({ env }) {
  const today = manilaToday()
  const monthStart = `${today.slice(0, 7)}-01`
  const prev = new Date(`${monthStart}T00:00:00Z`)
  prev.setUTCMonth(prev.getUTCMonth() - 1)
  const prevStart = prev.toISOString().slice(0, 10)
  // The same day-of-month last month, so "month to date" compares like with like.
  const prevSameDay = `${prevStart.slice(0, 8)}${today.slice(8)}`

  const added = "COALESCE(legacy_added_on, substr(created_at, 1, 10))"
  const row = await env.DB.prepare(`
    SELECT
      (SELECT COUNT(*) FROM owners WHERE deleted_at IS NULL) AS owners,
      (SELECT COUNT(*) FROM pets WHERE deleted_at IS NULL) AS pets,
      (SELECT COUNT(*) FROM owners WHERE deleted_at IS NULL AND ${added} >= ?1) AS owners_mtd,
      (SELECT COUNT(*) FROM owners WHERE deleted_at IS NULL AND ${added} >= ?2 AND ${added} <= ?3) AS owners_prev,
      (SELECT COUNT(*) FROM pets WHERE deleted_at IS NULL AND ${added} >= ?1) AS pets_mtd,
      (SELECT COUNT(*) FROM pets WHERE deleted_at IS NULL AND ${added} >= ?2 AND ${added} <= ?3) AS pets_prev,
      (SELECT COUNT(*) FROM owners WHERE deleted_at IS NULL AND review_flags != '[]') AS owners_to_review,
      (SELECT COUNT(*) FROM pets p JOIN owners o ON o.id = p.owner_id WHERE p.deleted_at IS NULL AND o.deleted_at IS NULL AND p.deceased_on IS NULL) AS pets_active,
      (SELECT COUNT(*) FROM pets p JOIN owners o ON o.id = p.owner_id WHERE p.deleted_at IS NULL AND o.deleted_at IS NULL AND p.deceased_on IS NOT NULL) AS pets_deceased
  `).bind(monthStart, prevStart, prevSameDay).first()

  return json({
    today,
    owners: { total: row.owners, monthToDate: row.owners_mtd, previous: row.owners_prev },
    pets: { total: row.pets, monthToDate: row.pets_mtd, previous: row.pets_prev },
    ownersToReview: row.owners_to_review,
    petsActive: row.pets_active,
    petsDeceased: row.pets_deceased,
  })
}
