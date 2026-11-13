// Staff members: how their details are checked on the way in and shaped on the way out.

import { clean, isEmail, isoDay, normalizeMobile } from './http.js'
import { localMobile } from './clients.js'

export const ROLES = ['owner', 'vet', 'front_desk', 'groomer', 'admin']
export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

function parseSchedule(text) {
  try {
    return JSON.parse(text || '{}')
  } catch {
    return {}
  }
}

export function staffOut(r, images = {}) {
  return {
    id: r.id,
    email: r.email,
    firstName: r.first_name,
    lastName: r.last_name,
    name: `${r.first_name} ${r.last_name}`.trim(),
    title: r.title,
    role: r.role,
    phone: r.phone,
    phoneLocal: localMobile(r.phone),
    active: !!r.active,
    hasPassword: !!r.password_hash,
    lastLoginAt: r.last_login_at,
    lockedUntil: r.locked_until && r.locked_until > new Date().toISOString() ? r.locked_until : null,
    licenseNo: r.license_no,
    licenseExpiry: r.license_expiry,
    ptrNo: r.ptr_no,
    s2No: r.s2_no,
    street: r.street,
    city: r.city,
    province: r.province,
    postalCode: r.postal_code,
    country: r.country,
    maxLeaveDays: r.max_leave_days,
    schedule: parseSchedule(r.schedule),
    birthday: r.birthday || null,
    emergencyName: r.emergency_name || null,
    emergencyPhone: r.emergency_phone || null,
    emergencyPhoneLocal: localMobile(r.emergency_phone),
    hasPhoto: !!images.photo,
    hasSignature: !!images.signature,
    imagesUpdatedAt: images.updatedAt || null,
  }
}

// partial = only the fields present (edits). -> { values, errors }
export function staffInput(body, partial = false) {
  const values = {}
  const errors = {}
  const has = (k) => !partial || Object.prototype.hasOwnProperty.call(body, k)
  const text = (k, col, max) => { if (has(k)) values[col] = clean(body[k], max) || null }

  if (has('firstName')) {
    values.first_name = clean(body.firstName, 50)
    if (!values.first_name) errors.firstName = 'Enter their first name.'
  }
  if (has('lastName')) values.last_name = clean(body.lastName, 50)
  if (has('email')) {
    values.email = clean(body.email, 100).toLowerCase()
    if (!isEmail(values.email)) errors.email = 'Enter the email they will log in with, e.g. name@gmail.com.'
  }
  if (has('phone')) {
    const raw = clean(body.phone, 30)
    values.phone = normalizeMobile(raw) || null
    if (raw && !values.phone) errors.phone = 'Enter a PH mobile number, like 0917 123 4567.'
  }
  if (has('role')) {
    values.role = body.role
    if (!ROLES.includes(body.role)) errors.role = 'Choose a role.'
  }
  text('title', 'title', 60)
  text('licenseNo', 'license_no', 30)
  text('ptrNo', 'ptr_no', 30)
  text('s2No', 's2_no', 30)
  text('street', 'street', 255)
  text('city', 'city', 100)
  text('province', 'province', 100)
  text('postalCode', 'postal_code', 20)
  if (has('country')) values.country = clean(body.country, 60) || 'Philippines'
  if (has('licenseExpiry')) {
    const raw = clean(body.licenseExpiry, 10)
    values.license_expiry = isoDay(raw)
    if (raw && !values.license_expiry) errors.licenseExpiry = 'Pick a date.'
  }
  if (has('maxLeaveDays')) {
    const raw = body.maxLeaveDays
    if (raw === '' || raw === null || raw === undefined) values.max_leave_days = null
    else {
      const n = Number(raw)
      if (!Number.isInteger(n) || n < 0 || n > 365) errors.maxLeaveDays = 'Enter a number of days from 0 to 365.'
      else values.max_leave_days = n
    }
  }
  if (has('schedule')) {
    const out = {}
    const s = body.schedule && typeof body.schedule === 'object' ? body.schedule : {}
    for (const day of DAYS) {
      const d = s[day]
      if (!d) continue
      if (!TIME.test(d.start || '') || !TIME.test(d.end || '') || d.start >= d.end) {
        errors.schedule = 'Each working day needs a start time before its end time.'
        continue
      }
      out[day] = { start: d.start, end: d.end }
    }
    values.schedule = JSON.stringify(out)
  }
  if (has('birthday')) {
    const raw = clean(body.birthday, 10)
    values.birthday = isoDay(raw)
    if (raw && !values.birthday) errors.birthday = 'Pick a date.'
  }
  text('emergencyName', 'emergency_name', 80)
  if (has('emergencyPhone')) {
    const raw = clean(body.emergencyPhone, 30)
    values.emergency_phone = normalizeMobile(raw) || null
    if (raw && !values.emergency_phone) errors.emergencyPhone = 'Enter a PH mobile number, like 0917 123 4567.'
  }
  if (has('active')) values.active = body.active ? 1 : 0
  return { values, errors }
}

// "data:image/png;base64,...." -> { mime, data } or null. Max ~300 KB of image.
export function parseImage(dataUrl) {
  const m = String(dataUrl || '').match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/)
  if (!m || m[2].length > 400000) return null
  return { mime: m[1], data: m[2] }
}
