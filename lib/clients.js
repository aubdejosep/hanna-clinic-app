// Owners and pets: how rows are checked on the way in and shaped on the way out.

import { clean, cleanMultiline, isEmail, normalizeMobile, isoDay, manilaToday } from './http.js'

export const SPECIES = ['dog', 'cat', 'other']
export const SEXES = ['male', 'female', 'unknown']
export const REVIEW_FLAGS = {
  no_phone: 'No phone number',
  check_phone: "Phone isn't a valid PH mobile",
  shared_phone: 'Same mobile as another owner',
  same_name: 'Same name as another owner',
  same_name_same_owner: 'Same name as another pet of this owner',
  kiosk: 'Signed up at the kiosk: check their details',
  website: 'Booked online: check their details',
}

export function localMobile(mobile) { // +639171234567 -> 0917 123 4567
  return mobile ? ('0' + String(mobile).slice(3)).replace(/^(\d{4})(\d{3})(\d{4})$/, '$1 $2 $3') : null
}
function flags(text) {
  try {
    return JSON.parse(text || '[]')
  } catch {
    return []
  }
}

export function ownerOut(r) {
  return {
    id: r.id,
    customerNo: r.customer_no,
    name: r.full_name,
    additionalOwner: r.additional_owner,
    mobile: r.mobile,
    mobileLocal: localMobile(r.mobile),
    mobileRaw: r.mobile_raw,
    email: r.email,
    messenger: r.messenger,
    address: r.address,
    vip: !!r.vip,
    remindersOptIn: !!r.reminders_opt_in,
    marketingConsent: !!r.marketing_consent,
    notes: r.notes,
    source: r.source,
    since: r.legacy_added_on || String(r.created_at).slice(0, 10),
    reviewFlags: flags(r.review_flags),
    removedAt: r.deleted_at || null,
    removedBy: r.deleted_by || null,
  }
}

export function petOut(r) {
  return {
    id: r.id,
    ownerId: r.owner_id,
    name: r.name,
    species: r.species,
    breed: r.breed,
    breedRaw: r.breed_raw,
    sex: r.sex,
    birthdate: r.birthdate,
    microchip: r.microchip,
    colorMarkings: r.color_markings,
    weightKg: r.weight_kg ?? null,
    weightOn: r.weight_on ?? null,
    allergies: r.allergies,
    notes: r.notes,
    deceasedOn: r.deceased_on,
    since: r.legacy_added_on || String(r.created_at).slice(0, 10),
    reviewFlags: flags(r.review_flags),
    removedAt: r.deleted_at || null,
    removedBy: r.deleted_by || null,
  }
}

// Checks owner fields from a form. partial = only the fields present (for edits).
// -> { values: {column: value}, errors: {field: message} }
export function ownerInput(body, partial = false) {
  const values = {}
  const errors = {}
  const has = (k) => !partial || Object.prototype.hasOwnProperty.call(body, k)

  if (has('name')) {
    const name = clean(body.name, 100)
    if (!name) errors.name = "Enter the owner's name."
    values.full_name = name
  }
  if (has('mobile')) {
    const raw = clean(body.mobile, 30)
    const mobile = normalizeMobile(raw)
    if (raw && !mobile) errors.mobile = 'Enter a PH mobile number, like 0917 123 4567.'
    values.mobile = mobile || null
    if (mobile) values.mobile_raw = null
  }
  if (has('email')) {
    const email = clean(body.email, 100).toLowerCase()
    if (email && !isEmail(email)) errors.email = 'Check the email address, e.g. name@gmail.com.'
    values.email = email || null
  }
  if (has('additionalOwner')) values.additional_owner = clean(body.additionalOwner, 100) || null
  if (has('messenger')) values.messenger = clean(body.messenger, 200) || null
  if (has('address')) values.address = cleanMultiline(body.address, 300) || null
  if (has('notes')) values.notes = cleanMultiline(body.notes, 2000) || null
  if (has('vip')) values.vip = body.vip ? 1 : 0
  if (has('remindersOptIn')) values.reminders_opt_in = body.remindersOptIn ? 1 : 0
  if (has('reviewFlags') && Array.isArray(body.reviewFlags)) {
    values.review_flags = JSON.stringify(body.reviewFlags.filter((f) => f in REVIEW_FLAGS))
  }
  return { values, errors }
}

export function petInput(body, partial = false) {
  const values = {}
  const errors = {}
  const has = (k) => !partial || Object.prototype.hasOwnProperty.call(body, k)

  if (has('name')) {
    const name = clean(body.name, 50)
    if (!name) errors.name = "Enter the pet's name."
    values.name = name
  }
  if (has('species')) {
    if (!SPECIES.includes(body.species)) errors.species = 'Choose dog, cat or other.'
    values.species = body.species
  }
  if (has('sex')) values.sex = SEXES.includes(body.sex) ? body.sex : 'unknown'
  if (has('breed')) {
    values.breed = clean(body.breed, 60) || null
    values.breed_raw = null
  }
  if (has('birthdate')) {
    const raw = clean(body.birthdate, 10)
    const day = isoDay(raw)
    if (raw && (!day || day > manilaToday())) errors.birthdate = "Enter a birthdate that isn't in the future."
    values.birthdate = day
  }
  if (has('microchip')) values.microchip = clean(body.microchip, 30).replace(/\s/g, '') || null
  if (has('colorMarkings')) values.color_markings = clean(body.colorMarkings, 100) || null
  if (has('weightKg')) {
    const raw = String(body.weightKg ?? '').trim()
    const kg = raw === '' ? null : Number(raw.replace(/kg$/i, '').trim())
    if (kg !== null && !(kg > 0 && kg < 150)) errors.weightKg = 'Enter the weight in kg, e.g. 4.5.'
    else { values.weight_kg = kg === null ? null : Math.round(kg * 100) / 100; values.weight_on = kg === null ? null : manilaToday() }
  }
  if (has('allergies')) values.allergies = cleanMultiline(body.allergies, 500) || null
  if (has('notes')) values.notes = cleanMultiline(body.notes, 2000) || null
  if (has('deceasedOn')) {
    const raw = clean(body.deceasedOn, 10)
    const day = isoDay(raw)
    if (raw && (!day || day > manilaToday())) errors.deceasedOn = "Enter a date that isn't in the future."
    values.deceased_on = day
  }
  if (has('reviewFlags') && Array.isArray(body.reviewFlags)) {
    values.review_flags = JSON.stringify(body.reviewFlags.filter((f) => f in REVIEW_FLAGS))
  }
  return { values, errors }
}

// "UPDATE t SET a = ?, b = ? ..." pieces from a {column: value} object.
export function setClause(values) {
  const cols = Object.keys(values)
  return { sql: cols.map((c) => `${c} = ?`).join(', '), binds: cols.map((c) => values[c]) }
}

export async function nextCustomerNo(env) {
  const row = await env.DB.prepare(
    "SELECT MAX(CAST(substr(customer_no, 2) AS INTEGER)) AS n FROM owners WHERE customer_no GLOB 'C[0-9]*'",
  ).first()
  return 'C' + String((row?.n || 0) + 1).padStart(6, '0')
}
