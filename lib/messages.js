// Messages to clients (Account ▸ Settings ▸ Messages): fill-ins, SMS length, sample details.
// Shared by the screens and the server (no imports).

// How many SMS a text costs. Plain (GSM-7) texts: 160 characters, or 153 per part when longer. Any other
// character (₱, emoji, curly quotes) switches the whole text to 70 per SMS (67 per part).
const GSM = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'
const GSM_EXTENDED = '^{}\\[~]|€'
export function smsInfo(text) {
  const chars = [...String(text ?? '')]
  const special = [...new Set(chars.filter((c) => !GSM.includes(c) && !GSM_EXTENDED.includes(c)))]
  const length = special.length ? chars.length : chars.reduce((n, c) => n + (GSM_EXTENDED.includes(c) ? 2 : 1), 0)
  const single = special.length ? 70 : 160
  const part = special.length ? 67 : 153
  return { length, limit: single, parts: length === 0 ? 0 : length <= single ? 1 : Math.ceil(length / part), special }
}
// Curly quotes and dashes from a phone keyboard become plain ones, so a text stays one SMS.
export const smsSafe = (t) => String(t ?? '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...').replace(/₱/g, 'PHP ')

export const SAMPLE = {
  first_name: 'Maria', pets: 'Coco and Max', date: 'Sat, Nov 15', window: 'Morning (8AM-12NN)', ref: 'BK-7K3P2A',
  codes: 'HPW-7K3P2A', valid_until: 'Fri, Nov 20', pet: 'Coco', what: 'Anti-rabies vaccine', due_date: 'Mon, Dec 1',
}
// Email must stay on for these: the booking email has the Change or Cancel link, and the code only goes by email.
export const EMAIL_REQUIRED = ['booking', 'free_consult']
export const FILL_IN_HELP = {
  first_name: 'Owner’s first name', pets: 'Pet names (“Coco and Max”)', date: 'Visit day (“Sat, Nov 15”)',
  window: 'Time window with that day’s hours (“Morning (8AM-12NN)”)', ref: 'Booking number (BK-…)', codes: 'Free consult code(s)',
  valid_until: 'Code valid until', pet: 'Pet name', what: 'What’s due (“Anti-rabies vaccine”)', due_date: 'Due date',
}
export const fillIn = (text, vars = SAMPLE) => String(text ?? '').replace(/\{(\w+)\}/g, (m, k) => (k in vars && vars[k] != null ? vars[k] : m))
export const unknownFillIns = (text, allowed) => [...new Set([...String(text ?? '').matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((k) => !allowed.includes(k)))]
// VetAssist names are often in capitals ("DENISE", "HUNTER"): those read as "Denise", "Hunter" in messages.
export const niceName = (s) => { const t = String(s ?? '').trim(); return t && t === t.toUpperCase() && /[A-Z]/.test(t) ? t.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()) : t }
export const petList = (names) => { const n = names.filter(Boolean).map(niceName); return n.length <= 1 ? n[0] || '' : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}` }

// "Morning (8AM-12NN)" for a day's hours ({open: "08:00", close: "20:00"}) and an HH:MM time or window.
const short = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h === 12 && !m ? '12NN' : `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'AM' : 'PM'}` }
export function windowText(hours, when) {
  const open = hours?.open || '08:00'
  const close = hours?.close || '20:00'
  const w = when === 'morning' || when === 'afternoon' || when === 'any' ? when : String(when || '') < '12:00' ? 'morning' : 'afternoon'
  if (w === 'morning') return `Morning (${short(open)}-12NN)`
  if (w === 'afternoon') return `Afternoon (1PM-${short(close)})`
  return `Any time (${short(open)}-${short(close)})`
}
