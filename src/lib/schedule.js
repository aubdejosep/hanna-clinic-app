export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
export const DAY_NAMES = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' }
// The old system's day chips: M T W TH F S SU
export const DAY_CHIPS = { mon: 'M', tue: 'T', wed: 'W', thu: 'TH', fri: 'F', sat: 'S', sun: 'SU' }

export function prettyTime(hhmm) { // "09:30" -> "9:30 AM"
  if (!hhmm) return ''
  const [h, m] = hhmm.split(':').map(Number)
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

// "9:30 AM – 8:00 PM", "Hours vary", or null when there are no working days.
export function hoursSummary(schedule) {
  const days = DAY_KEYS.filter((d) => schedule?.[d])
  if (!days.length) return null
  const ranges = new Set(days.map((d) => `${schedule[d].start}-${schedule[d].end}`))
  if (ranges.size > 1) return 'Hours vary by day'
  const { start, end } = schedule[days[0]]
  return `${prettyTime(start)} – ${prettyTime(end)}`
}
