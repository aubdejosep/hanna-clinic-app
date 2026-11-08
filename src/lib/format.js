const TZ = 'Asia/Manila'

export function prettyDay(isoDay) { // "2026-11-08" -> "Nov 8, 2026"
  if (!isoDay) return '—'
  return new Date(`${isoDay}T12:00:00+08:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: TZ })
}

export function age(birthdate, today = new Date()) { // "3 yrs 2 mos", "4 mos", or null
  if (!birthdate) return null
  const b = new Date(`${birthdate}T00:00:00+08:00`)
  let months = (today.getFullYear() - b.getFullYear()) * 12 + (today.getMonth() - b.getMonth())
  if (today.getDate() < b.getDate()) months -= 1
  if (months < 0) return null
  if (months < 1) return 'Under 1 mo'
  const y = Math.floor(months / 12)
  const m = months % 12
  const yrs = y ? `${y} yr${y > 1 ? 's' : ''}` : ''
  const mos = m ? `${m} mo${m > 1 ? 's' : ''}` : ''
  return [yrs, mos].filter(Boolean).join(' ')
}

export function initials(name) {
  return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('')
}

export const SPECIES_LABEL = { dog: 'Dog', cat: 'Cat', other: 'Other' }
export const SEX_LABEL = { male: 'Male', female: 'Female', unknown: 'Unknown' }

export function percentChange(now, before) {
  if (!before) return null
  return Math.round(((now - before) / before) * 100)
}
