// Clinic Operations ▸ Backups (owners and admins): the nightly backups (lib/backup.js) kept in the separate backup
// bucket: what each one holds, Download (a copy for your own computer, logged), and Back Up Now.
// The photos' own copy on your computer uses rclone: README ▸ Backups and recovery.
import { useState } from 'react'
import { DatabaseBackup, Download, HardDriveDownload, RefreshCw } from 'lucide-react'
import { ErrorNote, PageHead, PawLoader, useToast } from '../components/ui.jsx'
import { api } from '../lib/api.js'
import { useApi } from '../lib/useApi.js'
import { canManage, useStaff } from '../lib/staff.js'
import { prettyDay } from '../lib/format.js'

const size = (b) => (b == null ? '' : b > 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`)
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' }) : '')
const LABEL = { 'hanna-clinic.sql.gz': 'Clinic App', 'hanna-leads.sql.gz': 'Website', 'photos.json.gz': 'Photo List' }
const daysSince = (iso) => (iso ? Math.floor((Date.now() - Date.parse(iso)) / 864e5) : null)

export default function BackupsPage() {
  const staff = useStaff()
  const toast = useToast()
  const { data, error, reload } = useApi(canManage(staff) ? 'backups' : null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const head = <PageHead crumbs={[{ label: 'Clinic Operations' }, { label: 'Backups' }]} title="Backups"
    intro="A copy of everything (owners, pets, records, visits, inventory, finances, settings, and the website's bookings) is saved every night at 2 AM, separate from the app. Download one each week to keep on your own computer." />
  if (!canManage(staff)) return <>{head}<ErrorNote error={new Error('Only an owner or admin can open backups.')} /></>
  async function now() {
    setBusy(true); setErr(null)
    try { const r = await api('backups/run', { method: 'POST' }); toast(`Backup saved (${r.report.seconds} s)`); reload() } catch (e) { setErr(e) }
    setBusy(false)
  }
  const latest = data?.backups?.[0]
  const since = daysSince(data?.lastDownload?.at)
  const stale = latest && daysSince(latest.at) > 1
  return (
    <>
      {head}
      <ErrorNote error={error} />
      {!data ? <PawLoader label="Loading backups…" /> : !data.ready ? (
        <div className="card card-pad"><p style={{ margin: 0 }}>Backups aren’t switched on yet: the backup bucket needs connecting in Cloudflare. See the README, Backups and Recovery.</p></div>
      ) : (
        <div className="stack" style={{ gap: 16 }}>
          <section className="card card-pad bk-status">
            <div className="bk-row">
              <DatabaseBackup aria-hidden />
              <div>
                <h2>{latest ? `Last backup: ${when(latest.at)}` : 'No backups yet'}</h2>
                <p className="cell-sub">{latest ? `${latest.by === 'schedule' ? 'Nightly' : `Made by ${latest.by}`} · ${latest.files?.map((f) => size(f.bytes)).join(' + ') || ''}` : 'The first one is made tonight at 2 AM, or now with Back Up Now.'}</p>
              </div>
              <button type="button" className="btn btn-quiet" onClick={now} disabled={busy}><RefreshCw aria-hidden /> {busy ? 'Backing Up…' : 'Back Up Now'}</button>
            </div>
            {stale && <p className="lg-off" style={{ margin: 0 }}>The last nightly backup is more than a day old. Check the Worker's logs (README, Backups and Recovery).</p>}
            {latest?.counts && (
              <dl className="bk-counts">
                {Object.entries(latest.counts).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{Number(v).toLocaleString('en-PH')}</dd></div>)}
                {latest.photos && <div><dt>Photos</dt><dd>{latest.photos.count.toLocaleString('en-PH')} ({size(latest.photos.bytes)})</dd></div>}
              </dl>
            )}
            <p className={since == null || since > 7 ? 'lg-off' : 'cell-sub'} style={{ margin: 0 }}>
              <HardDriveDownload aria-hidden className="bk-ic" /> {since == null ? 'No backup has been downloaded to a computer yet.' : `Last downloaded ${since === 0 ? 'today' : `${since} day${since === 1 ? '' : 's'} ago`} (${when(data.lastDownload.at)}).`}
              {(since == null || since > 7) && ' Download the latest one and keep it on your own computer.'}
            </p>
            <ErrorNote error={err} />
          </section>
          <section className="card">
            <table className="table">
              <thead><tr><th>Date</th><th>Made</th><th>Download</th></tr></thead>
              <tbody>
                {data.backups.map((b) => (
                  <tr key={b.day}>
                    <td>{prettyDay(b.day)}</td>
                    <td><span className="cell-sub">{b.at ? `${when(b.at)}${b.by && b.by !== 'schedule' ? ` · ${b.by}` : ''}` : '—'}</span></td>
                    <td><span className="bk-files">{(b.files || []).map((f) => (
                      <a key={f.name} className="btn btn-sm btn-quiet" href={`/api/backups/${b.day}/${f.name}`} download onClick={() => setTimeout(reload, 1500)}><Download aria-hidden /> {LABEL[f.name] || f.name} <span className="cell-sub">{size(f.bytes)}</span></a>
                    ))}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="field-hint card-pad" style={{ margin: 0 }}>Kept: every night for 30 days, then the first of each month for a year. Downloads hold client details: keep them on a computer with drive encryption on, never on a shared PC.</p>
          </section>
        </div>
      )}
    </>
  )
}
