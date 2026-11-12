// Account ▸ Notifications: everything in the bell, as a page, grouped by kind. Each one clears itself
// once its step is done; "Not Needed" clears it by hand.
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BellOff } from 'lucide-react'
import { Empty, ErrorNote, PageHead, PawLoader, useToast } from '../components/ui.jsx'
import { KIND, linkOf } from '../components/ReminderBell.jsx'
import { useAppointmentsChanged } from '../components/TagCheckIn.jsx'
import { api } from '../lib/api.js'
import { useApi } from '../lib/useApi.js'
import { prettyDay } from '../lib/format.js'

export default function NotificationsPage() {
  const { data, error, reload } = useApi('reminders?fresh=1')
  const [busy, setBusy] = useState(null)
  const [kind, setKind] = useState('all')
  const toast = useToast()
  useAppointmentsChanged(reload)
  const list = data?.reminders || []
  const groups = useMemo(() => {
    const g = {}
    for (const r of list) (g[KIND[r.kind]?.label || 'Other'] ||= []).push(r)
    return Object.entries(g).sort((a, b) => b[1].length - a[1].length)
  }, [list])
  const shown = kind === 'all' ? list : groups.find(([l]) => l === kind)?.[1] || []
  async function notNeeded(r) {
    setBusy(r.key)
    try {
      await api('reminders', { method: 'POST', body: { key: r.key } })
      toast('Notification cleared')
      reload()
    } catch (err) {
      toast(err.message)
    } finally {
      setBusy(null)
    }
  }
  return (
    <>
      <PageHead crumbs={[{ label: 'Account' }, { label: 'Notifications' }]} title="Notifications" intro="Steps still to finish across the clinic. Each one clears itself once it’s done." />
      <ErrorNote error={error} />
      {!data ? <PawLoader label="Loading notifications…" /> : !list.length ? (
        <section className="card"><Empty icon={BellOff} title="All caught up" text="Missed steps from visits, payments, stock and new online clients show here until they’re done." /></section>
      ) : (
        <section className="card">
          <div className="toolbar" style={{ borderBottom: '1px solid var(--border)' }}>
            <div className="tabs tab-scroll" role="group" aria-label="Kind">
              <button type="button" className="tab" aria-pressed={kind === 'all'} onClick={() => setKind('all')}>All<span className="tab-count">{list.length}</span></button>
              {groups.map(([l, items]) => <button key={l} type="button" className="tab" aria-pressed={kind === l} onClick={() => setKind(l)}>{l}<span className="tab-count">{items.length}</span></button>)}
            </div>
          </div>
          <ul className="bell-list notif-list">
            {shown.map((r) => {
              const K = KIND[r.kind] || KIND.follow_up
              return (
                <li key={r.key}>
                  <K.icon aria-hidden />
                  <div>
                    <strong>{r.title}</strong>
                    <span className="cell-sub">{r.text}{r.day ? ` · Visit ${prettyDay(r.day)}` : ''}</span>
                    <div className="bell-actions">
                      <Link className="text-btn" to={linkOf(r)}>{r.action}</Link>
                      {r.kind !== 'unpaid' && <button type="button" className="text-btn" onClick={() => notNeeded(r)} disabled={busy === r.key}>{['low_stock', 'expiring'].includes(r.kind) ? 'Hide for Today' : 'Not Needed'}</button>}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </>
  )
}
