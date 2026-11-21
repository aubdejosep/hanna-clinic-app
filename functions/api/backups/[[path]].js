// Clinic Operations ▸ Backups (owners and admins only, checked here): the nightly backups in the backup bucket.
//   GET  /api/backups                    -> each backup's day and report, and when one was last downloaded
//   GET  /api/backups/:day/:file         -> download one backup file (logged with audit())
//   POST /api/backups/run                -> Back Up Now (today's backup again)
// The backups themselves are made by lib/backup.js (the inbox intake Worker runs it every night at 2 AM).

import { json, fail, canManage, audit } from '../../../lib/http.js'
import { backupDays, runBackup } from '../../../lib/backup.js'

const FILES = ['hanna-clinic.sql.gz', 'hanna-leads.sql.gz', 'photos.json.gz', 'report.json']

export async function onRequest({ request, env, params, data }) {
  if (!canManage(data.staff)) return fail(403, 'Only an owner or admin can open backups.')
  const [a, b] = [].concat(params.path || [])
  if (!env.BACKUPS) return request.method === 'GET' && !a ? json({ ready: false, backups: [] }) : fail(503, 'The backup bucket isn’t connected yet. See README ▸ Backups and recovery.')

  if (request.method === 'POST' && a === 'run') {
    try {
      const report = await runBackup(env, { by: data.staff.name })
      await audit(env, data.staff.email, 'backup_now', 'backup', report.day)
      return json({ report })
    } catch (err) { return fail(err.status || 500, err.status ? err.message : 'The backup didn’t finish. Try again in a few minutes.') }
  }
  if (request.method !== 'GET') return fail(405, 'Not allowed.')

  if (a && b) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !FILES.includes(b)) return fail(404, 'Not found.')
    const obj = await env.BACKUPS.get(`backups/${a}/${b}`)
    if (!obj) return fail(404, 'This backup file isn’t there any more. Reload the page.')
    await audit(env, data.staff.email, 'download_backup', 'backup', a, { file: b })
    return new Response(obj.body, { headers: { 'Content-Type': b.endsWith('.gz') ? 'application/gzip' : 'application/json', 'Content-Disposition': `attachment; filename="${a} ${b}"`, 'Cache-Control': 'no-store' } })
  }

  const days = (await backupDays(env.BACKUPS)).reverse().slice(0, 60)
  const reports = await Promise.all(days.map(async (d) => {
    const r = await env.BACKUPS.get(`backups/${d}/report.json`)
    try { return r ? await r.json() : { day: d } } catch { return { day: d } }
  }))
  const last = await env.DB.prepare("SELECT at, actor FROM audit_log WHERE action = 'download_backup' AND entity = 'backup' ORDER BY id DESC LIMIT 1").first()
  return json({ ready: true, backups: reports, lastDownload: last ? { at: last.at, by: last.actor } : null })
}
