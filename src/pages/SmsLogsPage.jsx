// Clinic Operations ▸ SMS Logs (owners and admins): every text sent from the clinic's Semaphore account (bookings and
// cancellations from the website, day-before reminders, tests), newest first, with its status and credit balance.
// Each text links to the appointment(s) it was about, when known. Server: functions/api/sms-logs.js.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { MessageSquareText } from 'lucide-react'
import { ErrorNote, PageHead, PawLoader } from '../components/ui.jsx'
import { api } from '../lib/api.js'
import { canManage, useStaff } from '../lib/staff.js'

const today = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
const shift = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const RANGES = [['all', 'All'], ['today', 'Today'], ['week', 'Last 7 Days'], ['month', 'This Month']]
const rangeOf = (k) => ({ today: [today(), today()], week: [shift(today(), -6), today()], month: [`${today().slice(0, 8)}01`, today()] }[k] || [null, null])
const when = (s) => { if (!s) return '—'; const d = new Date(String(s).includes('T') ? s : `${String(s).replace(' ', 'T')}+08:00`); return Number.isNaN(d.getTime()) ? s : d.toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' }) }
const local = (n) => { const m = String(n).replace(/\D/g, '').slice(-10); return m.length === 10 ? `0${m.slice(0, 3)} ${m.slice(3, 6)} ${m.slice(6)}` : n }
const tone = (s) => (/sent|success/i.test(s) ? '' : /fail|refund|reject/i.test(s) ? 'badge-warn' : 'badge-soft')

export default function SmsLogsPage() {
  const staff = useStaff()
  const [range, setRange] = useState('all')
  const [page, setPage] = useState(1)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { setPage(1) }, [range])
  useEffect(() => {
    if (!canManage(staff)) return undefined
    let live = true
    const [from, to] = rangeOf(range)
    setBusy(true); setError(null)
    api(`sms-logs?page=${page}${from ? `&from=${from}&to=${to}` : ''}`)
      .then((d) => { if (live) setData((old) => (page > 1 && old ? { ...d, balance: old.balance, messages: [...old.messages, ...d.messages] } : d)) })
      .catch((e) => live && setError(e)).finally(() => live && setBusy(false))
    return () => { live = false }
  }, [range, page]) // eslint-disable-line react-hooks/exhaustive-deps
  const head = <PageHead crumbs={[{ label: 'Clinic Operations' }, { label: 'SMS Logs' }]} title="SMS Logs" intro="Every text sent to clients from HANNAPETVET: booking and cancellation texts from the website, day-before reminders and tests. The wording is in Account ▸ Settings ▸ Messages." />
  if (!canManage(staff)) return <>{head}<ErrorNote error={new Error('Only an owner or admin can open the SMS logs.')} /></>
  return (
    <>
      {head}
      <div className="ml-bar">
        <div className="ml-chips" role="group" aria-label="Dates">{RANGES.map(([k, l]) => <button key={k} type="button" className={`btn btn-sm ${range === k ? '' : 'btn-quiet'}`} aria-pressed={range === k} onClick={() => setRange(k)}>{l}</button>)}</div>
        {data?.balance != null && <span className="badge">Credits Left: {data.balance.toLocaleString('en-PH')}</span>}
      </div>
      <ErrorNote error={error} />
      {!data ? <PawLoader label="Loading the texts…" /> : !data.ready ? (
        <div className="card card-pad"><p style={{ margin: 0 }}>Texting isn’t set up on the app yet: add <b>SEMAPHORE_API_KEY</b> to hanna-clinic-app in Cloudflare (Settings ▸ Variables and Secrets), then retry the latest deployment.</p></div>
      ) : data.messages.length === 0 ? (
        <div className="card card-pad"><p style={{ margin: 0 }}><MessageSquareText aria-hidden className="bk-ic" /> No texts {range === 'all' ? 'sent yet' : 'for these dates'}.</p></div>
      ) : (
        <section className="card">
          <table className="table sms-table">
            <thead><tr><th>Sent</th><th>To</th><th>Appointment</th><th>Message</th><th>Status</th></tr></thead>
            <tbody>
              {data.messages.map((m, i) => (
                <tr key={m.id || i}>
                  <td data-label="Sent"><span className="cell-sub">{when(m.at)}</span></td>
                  <td data-label="To">{m.owner ? <Link to={`/clients/${m.owner.id}`}>{m.owner.name}</Link> : null}<span className="cell-sub" style={{ display: 'block' }}>{local(m.to)}{m.network ? ` · ${m.network}` : ''}</span></td>
                  <td data-label="Appointment">{m.appointments?.length ? m.appointments.map((a) => <Link key={a.id} to={`/appointments/${a.id}`} className="sms-ref" title="Open the appointment">#{a.no}</Link>) : <span className="cell-sub">—</span>}</td>
                  <td data-label="Message" className="sms-text">{m.text}</td>
                  <td data-label="Status"><span className={`badge ${tone(m.status)}`}>{m.status || '—'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.more && <div className="inline-row card-pad" style={{ justifyContent: 'center' }}><button type="button" className="btn btn-quiet" onClick={() => setPage((p) => p + 1)} disabled={busy}>{busy ? 'Loading…' : 'Show More'}</button></div>}
        </section>
      )}
    </>
  )
}
