// Weight-based sizes from the price list's own names, e.g. "DW 1-10KG", "Bravecto 4.5kg-10kg",
// "PROHEART 10.1 - 15 KG", "Dog spay 25kg and up", "ADVOCATE UP TO 4KG". Shared by the screens
// and the server (no imports, plain functions).

const NUM = '(\\d+(?:\\.\\d+)?)'
const RANGE = new RegExp(`${NUM}\\s*(?:kg)?\\s*(?:-|to)\\s*-?\\s*${NUM}\\s*-?\\s*kg`, 'i')
const UP = new RegExp(`${NUM}\\s*kg\\s*(?:-|and|to)?\\s*(?:to\\s*)?up`, 'i')
const UP_TO = new RegExp(`up\\s*to\\s*${NUM}\\s*kg`, 'i')
const BELOW = new RegExp(`${NUM}\\s*kg\\s*(?:and\\s*)?below`, 'i')

// -> [from, to] in kg, or null when the name has no weight in it
export function kgRange(name) {
  const s = String(name || '')
  let m = s.match(RANGE)
  if (m) {
    const lo = Number(m[1])
    let hi = Number(m[2])
    if (hi < lo) hi *= 10 // "20KG-4KG" in the old list means 20-40 kg
    return [lo, hi]
  }
  if ((m = s.match(UP))) return [Number(m[1]), Infinity]
  if ((m = s.match(UP_TO)) || (m = s.match(BELOW))) return [0, Number(m[1])]
  return null
}

// A variation's weight band: the kg range set in Services, else one named in it ("1-10KG").
export function variationRange(v) {
  if (v.minKg != null || v.maxKg != null) return [v.minKg ?? 0, v.maxKg ?? Infinity]
  return kgRange(v.name)
}

const SPECIES_WORD = { dog: /\bdogs?\b/i, cat: /\bcats?\b/i }

// A service is sized by weight when at least two of its choices (the base and its variations)
// have a weight band. -> [{variationId|null, range}] or null. A variation without a band that
// names a species ("GROOMING CAT") is offered too, with range null and that species: it is the
// size for that species whatever the weight. Other variations (Haircut, Bath and Dry) aren't sizes.
export function sizeOptions(service) {
  const opts = []
  const base = kgRange(service.name)
  if (base) opts.push({ variationId: null, range: base })
  for (const v of service.variations || []) {
    const r = variationRange(v)
    if (r) opts.push({ variationId: v.id, range: r })
  }
  if (opts.length < 2) return null
  for (const v of service.variations || []) {
    if (variationRange(v)) continue
    const species = Object.keys(SPECIES_WORD).find((k) => SPECIES_WORD[k].test(v.name))
    if (species) opts.push({ variationId: v.id, range: null, species })
  }
  return opts
}

// Is this variation one of the service's sizes? (Not: Haircut, Medicated Bath.)
export function isSize(service, variationId) {
  return !!sizeOptions(service)?.some((o) => o.variationId === variationId)
}

const OTHER = { dog: /\bcat\b/i, cat: /\bdog\b/i }

// The size for this weight: the range it falls in, else the nearest one. -> variationId|null, or
// undefined when the service isn't sized by weight or the weight isn't known.
export function sizeFor(service, kg, species) {
  const all = sizeOptions(service)
  if (!all) return undefined
  const own = all.find((o) => !o.range && o.species === species)
  if (own) return own.variationId // e.g. a cat: GROOMING CAT, whatever the weight
  const opts = all.filter((o) => o.range)
  if (!(kg > 0)) return undefined
  const names = Object.fromEntries((service.variations || []).map((v) => [v.id, v.name]))
  const fit = opts.filter((o) => !(OTHER[species] && OTHER[species].test(o.variationId ? names[o.variationId] : service.name)))
  const list = fit.length ? fit : opts
  const inside = list.find((o) => kg >= o.range[0] && kg <= o.range[1])
  if (inside) return inside.variationId
  const gap = (o) => (kg < o.range[0] ? o.range[0] - kg : kg - o.range[1])
  return list.reduce((a, b) => (gap(b) < gap(a) ? b : a)).variationId
}
