// Finances ▸ Transactions (owners and admins), laid out like the old system: Invoices, Invoice Items and
// Payments tabs, each with what was done in the app and what was imported from the old system (CSV exports;
// re-importing updates the same rows). Search, source and date filters, totals.
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CreditCard, FileUp, ListOrdered, Receipt, Search } from 'lucide-react'
import { Empty, ErrorNote, Field, PageHead, Pager, Panel, PawLoader, useToast } from '../components/ui.jsx'
import { METHODS, peso } from '../components/QuickAdd.jsx'
import { api, ApiError, query } from '../lib/api.js'
import { useApi, useDebounced } from '../lib/useApi.js'
import { prettyDay } from '../lib/format.js'

const METHOD_LABEL = Object.fromEntries(METHODS)

// A CSV file -> rows of cells (quotes, commas and line breaks inside quotes handled).
export function parseCsv(text) {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1 } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { row.push(cell); cell = '' } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += ch
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows.filter((r) => r.some((c) => c.trim()))
}

// The old system's exports, by tab: column headings -> fields, and what to say after importing.
const IMPORTS = {
  invoices: {
    title: 'Import Invoices', intro: 'The old system’s invoice export (CSV).', endpoint: 'finances/import', noun: 'invoices',
    columns: { invoiceNo: 'invoice number', date: 'invoice date', customer: 'customer name', pet: 'pet name', status: 'payment status', paid: 'paid amount', amount: 'invoice amount', refunded: 'refunded amount', method: 'payment method', staff: 'assigned staff' },
    needs: ['invoiceNo', 'amount'], needText: '“Invoice Number” and “Invoice Amount”',
    about: <>Each invoice is matched to an owner and pet by name when exactly one fits. Unpaid ones go to <strong>Finances ▸ Balances</strong>. Importing the same export again updates it by invoice number.</>,
    preview: (rows) => { const unpaid = rows.filter((r) => String(r.status).toUpperCase() === 'UNPAID').length; return `${rows.length - unpaid} paid · ${unpaid} unpaid` },
    done: (res) => `${res.imported} invoices imported: ${res.matched} matched to owners${res.unmatched ? `, ${res.unmatched} not matched` : ''}${res.unpaid ? `, ${res.unpaid} unpaid now in Balances` : ''}${res.badDates ? `. ${res.badDates} had no usable date` : ''}.`,
  },
  payments: {
    title: 'Import Payments', intro: 'The old system’s payment transactions export (CSV).', endpoint: 'finances/import-payments', noun: 'payments',
    columns: { invoiceNo: 'invoice number', txnNo: 'transaction number', reference: 'reference number', customer: 'customer name', pet: 'pet name', method: 'payment method', amount: 'amount', date: 'payment date', time: 'payment time', reason: 'reason', creator: 'creator' },
    needs: ['invoiceNo', 'amount', 'date'], needText: '“Invoice Number”, “Amount” and “Payment Date”',
    about: <>Import the invoices first, so each payment links to its invoice. The export rounds big amounts (e.g. “₱23.7K”); those are worked out from the invoice where possible. Importing again updates the same rows.</>,
    preview: (rows) => `${rows.filter((r) => /k$/i.test(String(r.amount).trim())).length} with rounded amounts`,
    done: (res) => `${res.imported} payments imported (${peso(res.total)}), ${res.linked} linked to invoices${res.rounded ? `. ${res.rounded} rounded amount${res.rounded > 1 ? 's' : ''}, ${res.workedOut} worked out from the invoice` : ''}.`,
  },
}

function ImportPanel({ kind, onClose, onDone }) {
  const cfg = IMPORTS[kind]
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  async function pick(e) {
    setError(null)
    setRows(null)
    const f = e.target.files?.[0]
    if (!f) return
    const cells = parseCsv((await f.text()).replace(/^﻿/, ''))
    const head = (cells[0] || []).map((h) => h.trim().toLowerCase())
    const at = Object.fromEntries(Object.entries(cfg.columns).map(([k, h]) => [k, head.indexOf(h)]))
    if (cfg.needs.some((k) => at[k] < 0)) { setError(new ApiError(400, { error: `This doesn’t look like the right export: it needs ${cfg.needText} columns.` })); return }
    setRows(cells.slice(1).map((c) => Object.fromEntries(Object.entries(at).map(([k, i]) => [k, i >= 0 ? c[i] : '']))))
  }
  async function run() {
    setBusy(true)
    setError(null)
    try {
      onDone(cfg.done(await api(cfg.endpoint, { method: 'POST', body: { rows } })))
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }
  return (
    <Panel title={cfg.title} intro={cfg.intro} onClose={onClose} busy={busy} dirty={!!rows}
      footer={<><button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="btn" onClick={run} disabled={busy || !rows?.length}><FileUp aria-hidden /> {busy ? 'Importing…' : rows ? `Import ${rows.length} ${cfg.noun[0].toUpperCase()}${cfg.noun.slice(1)}` : 'Import'}</button></>}>
      <div className="stack">
        <p style={{ margin: 0 }}>{cfg.about}</p>
        <label className="btn btn-quiet" style={{ justifySelf: 'start' }}>
          <FileUp aria-hidden /> Choose CSV File
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={pick} disabled={busy} />
        </label>
        <ErrorNote error={error} />
        {rows && <div className="content-box"><strong>{rows.length} {cfg.noun}</strong><span className="cell-sub">{cfg.preview(rows)}</span></div>}
      </div>
    </Panel>
  )
}

const TABS = [['invoices', 'Invoices', Receipt], ['items', 'Invoice Items', ListOrdered], ['payments', 'Payments', CreditCard]]
const STATUS_TONE = { Paid: 'badge-soft', 'No Charge': 'badge-soft', 'Balance Payment': 'badge-soft' }
const Client = ({ r }) => (r.ownerId ? <Link className="row-link" to={`/clients/${r.ownerId}`}><strong>{r.client || '—'}</strong></Link> : <strong>{r.client || 'Walk-in'}</strong>)
const When = ({ r }) => <>{r.day ? prettyDay(r.day) : 'No date'}<span className="cell-sub">{r.kind === 'visit' && r.source === 'app' && (r.refId || r.id) ? <Link to={`/appointments/${r.refId || r.id}`}>{r.invoiceNo}</Link> : r.invoiceNo || ''}</span></>

function InvoicesTable({ data }) {
  return (
    <table className="table">
      <thead><tr><th>Invoice</th><th>Customer</th><th className="num">Total</th><th className="num">Paid</th><th className="hide-sm">Method</th><th>Status</th><th className="hide-sm">Staff</th></tr></thead>
      <tbody>
        {data.rows.map((r) => (
          <tr key={`${r.source}${r.kind}${r.id}`} className="no-hover">
            <td className="nowrap"><When r={r} /></td>
            <td><Client r={r} /><span className="cell-sub">{[r.pet, r.source === 'old' ? 'Old system' : r.kind === 'sale' ? 'Quick sale' : null].filter(Boolean).join(' · ')}</span></td>
            <td className="num" data-label="Total">{peso(r.total)}</td>
            <td className="num" data-label="Paid">{peso(r.paid)}</td>
            <td className="hide-sm">{METHOD_LABEL[r.method] || r.method || '—'}</td>
            <td data-label="Status"><span className={`badge ${STATUS_TONE[r.status] || 'badge-warm'}`}>{r.status}</span></td>
            <td className="hide-sm">{r.staff || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function ItemsTable({ data }) {
  return (
    <table className="table">
      <thead><tr><th>Invoice</th><th>Customer</th><th>Item</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Amount</th></tr></thead>
      <tbody>
        {data.rows.map((r) => (
          <tr key={`${r.source}${r.kind}${r.id}`} className="no-hover">
            <td className="nowrap"><When r={r} /></td>
            <td><Client r={r} /><span className="cell-sub">{r.pet || ''}</span></td>
            <td data-label="Item"><strong>{r.item}</strong><span className="cell-sub">{[r.detail, r.itemKind === 'product' ? 'Product' : r.itemKind === 'service' ? 'Service' : null].filter(Boolean).join(' · ')}</span></td>
            <td className="num" data-label="Qty">{r.qty}</td>
            <td className="num" data-label="Price">{r.price == null ? '—' : peso(r.price)}</td>
            <td className="num" data-label="Amount">{r.amount == null ? '—' : peso(r.amount)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

const PAY_KIND = { visit: 'Visit', sale: 'Quick sale', balance: 'Balance payment', old: 'Old system' }
function PaymentsTable({ data }) {
  return (
    <table className="table">
      <thead><tr><th>Date</th><th>Customer</th><th className="num">Amount</th><th className="hide-sm">Method</th><th className="hide-sm">For</th><th>Status</th><th className="hide-sm">By</th></tr></thead>
      <tbody>
        {data.rows.map((r) => (
          <tr key={`${r.source}${r.id}`} className="no-hover">
            <td className="nowrap">{r.day ? prettyDay(r.day) : 'No date'}<span className="cell-sub">{r.invoiceNo || ''}</span></td>
            <td><Client r={r} /><span className="cell-sub">{r.pet || ''}</span></td>
            <td className="num" data-label="Amount">{peso(r.amount)}{r.amountNote && <span className="cell-sub" title={r.amountNote}>Worked out*</span>}</td>
            <td className="hide-sm">{METHOD_LABEL[r.method] || r.method || '—'}{r.reference && <span className="cell-sub">Ref. {r.reference}</span>}</td>
            <td className="hide-sm">{PAY_KIND[r.kind] || r.kind}{r.note && <span className="cell-sub">{r.note}</span>}</td>
            <td data-label="Status"><span className={`badge ${r.status === 'Paid' ? 'badge-soft' : 'badge-warm'}`}>{r.status}</span></td>
            <td className="hide-sm">{r.staff || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default function TransactionsPage() {
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const set = (patch) => setParams((p) => { const n = new URLSearchParams(p); Object.entries(patch).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k))); if (!('page' in patch)) n.delete('page'); return n }, { replace: true })
  const tab = TABS.some(([k]) => k === params.get('tab')) ? params.get('tab') : 'invoices'
  const [text, setText] = useState(params.get('q') || '')
  const q = useDebounced(text.trim(), 300)
  const source = params.get('source') || ''
  const from = params.get('from') || ''
  const to = params.get('to') || ''
  const page = Number(params.get('page')) || 1
  const { data, error, reload } = useApi(`finances/${tab}${query({ q, source, from, to, page, size: 25 })}`)
  const [importing, setImporting] = useState(null)
  const noun = { invoices: 'invoices', items: 'items', payments: 'payments' }[tab]
  return (
    <>
      <PageHead crumbs={[{ label: 'Finances' }, { label: 'Transactions' }]} title="Transactions" intro="Invoices, the items on them, and payments: from the app and from the old system.">
        <div className="tabs" role="group" aria-label="Show">
          {TABS.map(([k, l, Icon]) => <button key={k} type="button" className="tab" aria-pressed={tab === k} onClick={() => set({ tab: k === 'invoices' ? '' : k })}><Icon size={14} aria-hidden /> {l}</button>)}
        </div>
      </PageHead>
      <section className="card">
        <div className="toolbar tx-filters">
          <div className="search"><Search aria-hidden /><input type="search" value={text} onChange={(e) => { setText(e.target.value); set({ q: '' }) }} placeholder="Search customer, pet or invoice no." aria-label={`Search ${noun}`} /></div>
          <div className="tabs" role="group" aria-label="Source">
            {[['', 'All'], ['app', 'In the App'], ['old', 'Old System']].map(([k, l]) => <button key={k} type="button" className="tab" aria-pressed={source === k} onClick={() => set({ source: k })}>{l}</button>)}
          </div>
          <Field label="From">{(a) => <input {...a} type="date" value={from} onChange={(e) => set({ from: e.target.value })} />}</Field>
          <Field label="To">{(a) => <input {...a} type="date" value={to} onChange={(e) => set({ to: e.target.value })} />}</Field>
          {IMPORTS[tab] && <button type="button" className="btn btn-quiet tx-import" onClick={() => setImporting(tab)}><FileUp aria-hidden /> {IMPORTS[tab].title}</button>}
        </div>
        <ErrorNote error={error} />
        {data && (
          <div className="tx-totals">
            {tab === 'invoices' && <><span><span className="label">Billed</span><strong>{peso(data.billed)}</strong></span><span><span className="label">Paid</span><strong>{peso(data.paid)}</strong></span><span><span className="label">Unpaid</span><strong>{peso(data.unpaid)}</strong></span></>}
            {tab === 'items' && <span><span className="label">Amount</span><strong>{peso(data.amount)}</strong></span>}
            {tab === 'payments' && <span><span className="label">Collected</span><strong>{peso(data.amount)}</strong></span>}
            <span className="cell-sub">{data.total.toLocaleString()} {noun}{from || to ? ` · ${from ? prettyDay(from) : 'start'} to ${to ? prettyDay(to) : 'today'}` : ''}</span>
          </div>
        )}
        {!data ? <PawLoader label="Loading…" /> : !data.rows.length ? (
          <Empty icon={Receipt} title={`No ${noun}`} text={q || source || from || to ? 'Nothing matches these filters.'
            : tab === 'items' ? 'Items billed on visits and quick sales show here. The old system’s invoice items can be added once its export is ready.'
              : `${tab === 'invoices' ? 'Visits and quick sales billed in the app' : 'Payments taken in the app'} show here. Use ${IMPORTS[tab].title} to add the old system’s.`} />
        ) : (
          <>
            {tab === 'invoices' ? <InvoicesTable data={data} /> : tab === 'items' ? <ItemsTable data={data} /> : <PaymentsTable data={data} />}
            <Pager page={page} pageSize={25} total={data.total} onPage={(n) => set({ page: n > 1 ? String(n) : '' })} noun={noun} />
          </>
        )}
      </section>
      {importing && <ImportPanel kind={importing} onClose={() => setImporting(null)} onDone={(msg) => { setImporting(null); toast(msg); reload() }} />}
    </>
  )
}
