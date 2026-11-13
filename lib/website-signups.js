// Free consult sign-ups (hannapetwellnesscenter.com/free-consult) -> the Inbox.
//
// Reads the website's database (binding LEADS, read only), at most once every 2 minutes while staff have
// the app open (called with the website bookings pull). One conversation per sign-up (all its pets), to
// the owner's email, so staff can welcome them and help them book. Sign-ups from the last 14 days only;
// ones already used or expired come in as Done. Deleted sign-ups (on /staff) are left out.
// Saved as an email conversation whose first message is marked message_id "website:free-consult:<code>"
// (shown as "Website Sign-Up"; replies don't quote it). Nothing is ever written to the website's database.

import { localMobile } from './clients.js'
import { snippetOf } from './inbox.js'

export const WEB_PREFIX = 'website:'
const EVERY_MS = 2 * 60 * 1000
const DAYS = 14
const longDay = (iso) => new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' })
const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1)

export async function pullFreeConsults(env, { force = false } = {}) {
  if (!env.LEADS) return { skipped: 'not linked' }
  const now = new Date()
  if (!force) {
    const last = await env.DB.prepare("SELECT at FROM sync_state WHERE key = 'website_signups'").first()
    if (last && now - Date.parse(last.at) < EVERY_MS) return { skipped: 'recent' }
  }
  await env.DB.prepare("INSERT OR REPLACE INTO sync_state (key, value, at) VALUES ('website_signups', NULL, ?)").bind(now.toISOString()).run()

  const { results } = await env.LEADS.prepare(`SELECT code, created_at, expires_at, owner_name, mobile, email, pet_name, species, source, used_at, marketing_consent
    FROM free_consult_signups WHERE created_at >= ? AND deleted_at IS NULL ORDER BY created_at, id`).bind(new Date(now - DAYS * 864e5).toISOString()).all()
  const groups = new Map() // one sign-up = same email, same moment (up to 5 pets)
  for (const r of results) {
    const k = `${String(r.email).toLowerCase()}|${r.created_at}`
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(r)
  }
  let added = 0
  for (const list of groups.values()) {
    const r = list[0]
    const mid = `${WEB_PREFIX}free-consult:${r.code}`
    if (await env.DB.prepare('SELECT 1 FROM inbox_messages WHERE message_id = ? LIMIT 1').bind(mid).first()) continue
    const email = String(r.email || '').toLowerCase()
    const owner = await env.DB.prepare(`SELECT CASE WHEN COUNT(*) = 1 THEN MAX(id) END AS id FROM owners WHERE deleted_at IS NULL AND lower(email) = ?`).bind(email).first()
      .then((o) => o?.id || env.DB.prepare(`SELECT CASE WHEN COUNT(*) = 1 THEN MAX(id) END AS id FROM owners WHERE deleted_at IS NULL AND mobile = ?`).bind(r.mobile).first().then((x) => x?.id || null))
    const usable = list.filter((x) => !x.used_at && Date.parse(x.expires_at) > now)
    const pets = list.map((x) => `${x.pet_name} (${cap(x.species)})`)
    const text = [
      'New free consult sign-up on the website.',
      '',
      `Owner: ${r.owner_name}`,
      `Mobile: ${localMobile(r.mobile) || r.mobile}`,
      `Email: ${email}`,
      `Pet${list.length > 1 ? 's' : ''}:`,
      ...list.map((x) => `• ${x.pet_name} (${cap(x.species)}): ${x.code}${x.used_at ? ' (used)' : Date.parse(x.expires_at) <= now ? ' (expired)' : ''}`),
      `Valid until: ${longDay(r.expires_at)}`,
      r.source && `Came from: ${r.source}`,
      `Promos: ${r.marketing_consent ? 'Opted in' : 'No'}`,
      '',
      usable.length ? 'Their code was emailed to them. Reply here to welcome them and help them book.' : 'Already used or expired.',
    ].filter((x) => x !== null && x !== undefined && x !== false).join('\n')
    const open = usable.length > 0
    const t = await env.DB.prepare(`INSERT INTO inbox_threads (channel, subject, contact_email, contact_name, owner_id, status, unread, message_count, last_message_at, last_direction, snippet, created_at)
      VALUES ('email', ?, ?, ?, ?, ?, ?, 1, ?, 'in', ?, ?) RETURNING id`)
      .bind(`Free consult sign-up: ${pets.join(', ')}`.slice(0, 300), email, r.owner_name, owner, open ? 'open' : 'done', open ? 1 : 0, r.created_at, snippetOf(`${r.owner_name} signed up for a free consult for ${pets.join(', ')}.`), r.created_at).first()
    await env.DB.prepare(`INSERT INTO inbox_messages (thread_id, direction, message_id, from_email, from_name, to_emails, subject, text_body, status, created_at)
      VALUES (?, 'in', ?, NULL, 'Website Sign-Up', NULL, ?, ?, 'received', ?)`).bind(t.id, mid, `Free consult sign-up: ${pets.join(', ')}`, text, r.created_at).run()
    added++
  }
  return { added }
}
