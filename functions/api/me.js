// GET /api/me -> the logged-in staff member
import { json } from '../../lib/http.js'

export function onRequestGet({ data }) {
  return json({ staff: data.staff })
}
