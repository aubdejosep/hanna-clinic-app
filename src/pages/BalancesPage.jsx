// Finances ▸ Balances (every staff member): who still owes the clinic, biggest first, with what each item
// is and the last time they paid. Cleared: the latest payments against balances, and clears.
import { Fragment, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ChevronDown, ChevronRight, Search, Wallet } from 'lucide-react'
import { Empty, ErrorNote, PageHead, PawLoader } from '../components/ui.jsx'
import { BalanceItems } from '../components/Balances.jsx'
import { METHODS, peso } from '../components/QuickAdd.jsx'
import { useApi } from '../lib/useApi.js'
import { prettyDay } from '../lib/format.js'

const METHOD_LABEL = Object.fromEntries(METHODS)

function Open() {
  const { data, error, reload } = useApi('balances')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(null)
  const list = useMemo(() => (data?.owners || []).filter((o) => !q.trim() || `${o.name} ${o.customerNo} ${o.mobile || ''}`.toLowerCase().includes(q.trim().toLowerCase())), [data, q])
  if (error) return <ErrorNote error={error} />
  if (!data) return <PawLoader label="Adding up balances…" />
  if (!data.owners.length) return <Empty icon={Wallet} title="No open balances" text="When a visit is paid in part, checked out without a payment, or an old-system invoice is unpaid, the owner shows here." />
  return (
    <>
      <div className="toolbar">
        <div className="search"><Search aria-hidden /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search owner, customer no. or mobile" aria-label="Search balances" /></div>
        <span className="cell-sub" style={{ display: 'inline' }}>{data.owners.length} owner{data.owners.length > 1 ? 's' : ''} owe <strong>{peso(data.total)}</strong> in all</span>
      </div>
      <table className="table">
        <thead><tr><th>Owner</th><th>Mobile</th><th className="num">Items</th><th className="num">Balance</th><th className="hide-sm">Last Payment</th><th aria-label="Details" /></tr></thead>
        <tbody>
          {list.map((o) => (
            <Fragment key={o.id}>
              <tr className="row-click" onClick={() => setOpen(open === o.id ? null : o.id)}>
                <td><Link className="row-link" to={`/clients/${o.id}`} onClick={(e) => e.stopPropagation()}><strong>{o.name}</strong></Link><span className="cell-sub">{o.customerNo}</span></td>
                <td data-label="Mobile" className="nowrap">{o.mobile ? <a href={`tel:${o.mobile.replace(/\s/g, '')}`} onClick={(e) => e.stopPropagation()}>{o.mobile}</a> : '—'}</td>
                <td className="num" data-label="Items">{o.items.length}</td>
                <td className="num" data-label="Balance"><strong>{peso(o.total)}</strong></td>
                <td className="hide-sm nowrap">{o.lastPayment ? prettyDay(o.lastPayment) : 'None on record'}</td>
                <td className="num">{open === o.id ? <ChevronDown size={16} aria-label="Hide" /> : <ChevronRight size={16} aria-label="Show" />}</td>
              </tr>
              {open === o.id && <tr className="no-hover"><td colSpan={6} className="balance-detail"><BalanceItems items={o.items} onChanged={reload} /></td></tr>}
            </Fragment>
          ))}
        </tbody>
      </table>
    </>
  )
}

function Cleared() {
  const { data, error } = useApi('balances/cleared')
  if (error) return <ErrorNote error={error} />
  if (!data) return <PawLoader label="Loading…" />
  if (!data.cleared.length) return <Empty icon={Wallet} title="Nothing cleared yet" text="Payments against balances, and balances cleared by an owner, show here." />
  return (
    <table className="table">
      <thead><tr><th>Date</th><th>Owner</th><th>What</th><th className="num">Amount</th><th className="hide-sm">By</th></tr></thead>
      <tbody>
        {data.cleared.map((c) => (
          <tr key={c.id} className="no-hover">
            <td className="nowrap">{prettyDay(c.at.slice(0, 10))}</td>
            <td><Link className="row-link" to={`/clients/${c.owner.id}`}><strong>{c.owner.name}</strong></Link></td>
            <td data-label="What">{c.kind === 'payment' ? `Paid by ${METHOD_LABEL[c.method] || c.method}` : `Cleared: ${c.reason}`}<span className="cell-sub">{c.invoiceNo ? `Old system invoice ${c.invoiceNo}` : c.appointmentId ? <Link to={`/appointments/${c.appointmentId}`}>Visit</Link> : ''}</span></td>
            <td className="num" data-label="Amount">{peso(c.amount)}</td>
            <td className="hide-sm">{c.by}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default function BalancesPage() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'cleared' ? 'cleared' : 'open'
  return (
    <>
      <PageHead crumbs={[{ label: 'Finances' }, { label: 'Balances' }]} title="Balances" intro="What clients still owe. The front desk sees it on the owner’s page and in Notifications when they check in." />
      <section className="card">
        <div className="toolbar" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="tabs" role="group" aria-label="Show">
            <button type="button" className="tab" aria-pressed={tab === 'open'} onClick={() => setParams({}, { replace: true })}>Open Balances</button>
            <button type="button" className="tab" aria-pressed={tab === 'cleared'} onClick={() => setParams({ tab: 'cleared' }, { replace: true })}>Cleared</button>
          </div>
        </div>
        {tab === 'open' ? <Open /> : <Cleared />}
      </section>
    </>
  )
}
