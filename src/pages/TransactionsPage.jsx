// Finances ▸ Transactions (owners and admins): every payment taken in the app and every invoice imported
// from the old system, newest first, with filters and totals. Import from Old System loads the old
// system's invoice export (CSV); re-importing updates by invoice number.
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { FileUp, Receipt, Search } from 'lucide-react'
import { Empty, ErrorNote, Field, PageHead, Pager, Panel, PawLoader, useToast } from '../components/ui.jsx'
import { METHODS, peso } from '../components/QuickAdd.jsx'
import { api, ApiError, query } from '../lib/api.js'
import { useApi, useDebounced } from '../lib/useApi.js'
import { prettyDay } from '../lib/format.js'

const METHOD_LABEL = Object.fromEntries(METHODS)
const KIND_LABEL = { visit: 'Visit', sale: 'Quick Sale', balance: 'Balance Payment', invoice: 'Old System Invoice' }

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

const COLUMNS = { invoiceNo: 'invoice number', date: 'invoice date', customer: 'customer name', pet: 'pet name', status: 'payment status', paid: 'paid amount', amount: 'invoice amount', refunded: 'refunded amount', method: 'payment method', staff: 'assigned staff' }

function ImportPanel({ onClose, onDone }) {
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
    const at = Object.fromEntries(Object.entries(COLUMNS).map(([k, h]) => [k, head.indexOf(h)]))
    if (at.invoiceNo < 0 || at.amount < 0) { setError(new ApiError(400, { error: 'This doesn’t look like the old system’s invoice export: it needs “Invoice Number” and “Invoice Amount” columns.' })); return }
    setRows(cells.slice(1).map((c) => Object.fromEntries(Object.entries(at).map(([k, i]) => [k, i >= 0 ? c[i] : '']))))
  }
  async function run() {
    setBusy(true)
    setError(null)
    try {
      const res = await api('finances/import', { method: 'POST', body: { rows } })
      onDone(`${res.imported} invoices imported: ${res.matched} matched to owners${res.unmatched ? `, ${res.unmatched} not matched` : ''}${res.unpaid ? `, ${res.unpaid} unpaid now in Balances` : ''}${res.badDates ? `. ${res.badDates} had no usable date` : ''}.`)
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }
  const unpaid = rows ? rows.filter((r) => String(r.status).toUpperCase() === 'UNPAID').length : 0
  return (
    <Panel title="Import from Old System" intro="The invoice export (CSV) from the old system." onClose={onClose} busy={busy} dirty={!!rows}
      footer={<><button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="btn" onClick={run} disabled={busy || !rows?.length}><FileUp aria-hidden /> {busy ? 'Importing…' : rows ? `Import ${rows.length} Invoices` : 'Import'}</button></>}>
      <div className="stack">
        <p style={{ margin: 0 }}>Each invoice is matched to an owner and pet by name when exactly one fits. Unpaid ones go to <strong>Finances ▸ Balances</strong>. Importing the same export again updates it by invoice number.</p>
        <label className="btn btn-quiet" style={{ justifySelf: 'start' }}>
          <FileUp aria-hidden /> Choose CSV File
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={pick} disabled={busy} />
        </label>
        <ErrorNote error={error} />
        {rows && <div className="content-box"><strong>{rows.length} invoices</strong><span className="cell-sub">{rows.length - unpaid} paid · {unpaid} unpaid</span></div>}
      </div>
    </Panel>
  )
}

export default function TransactionsPage() {
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const set = (patch) => setParams((p) => { const n = new URLSearchParams(p); Object.entries(patch).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k))); if (!('page' in patch)) n.delete('page'); return n }, { replace: true })
  const [text, setText] = useState(params.get('q') || '')
  const q = useDebounced(text.trim(), 300)
  const source = params.get('source') || ''
  const from = params.get('from') || ''
  const to = params.get('to') || ''
  const page = Number(params.get('page')) || 1
  const { data, error, reload } = useApi(`finances/transactions${query({ q, source, from, to, page, size: 25 })}`)
  const [importing, setImporting] = useState(false)
  return (
    <>
      <PageHead crumbs={[{ label: 'Finances' }, { label: 'Transactions' }]} title="Transactions" intro="Every payment taken in the app, and the invoices imported from the old system.">
        <div className="head-actions"><button type="button" className="btn btn-quiet" onClick={() => setImporting(true)}><FileUp aria-hidden /> Import from Old System</button></div>
      </PageHead>
      <section className="card">
        <div className="toolbar tx-filters">
          <div className="search"><Search aria-hidden /><input type="search" value={text} onChange={(e) => { setText(e.target.value); set({ q: '' }) }} placeholder="Search client, pet or invoice no." aria-label="Search transactions" /></div>
          <div className="tabs" role="group" aria-label="Source">
            {[['', 'All'], ['app', 'In the App'], ['old', 'Old System']].map(([k, l]) => <button key={k} type="button" className="tab" aria-pressed={source === k} onClick={() => set({ source: k })}>{l}</button>)}
          </div>
          <Field label="From">{(a) => <input {...a} type="date" value={from} onChange={(e) => set({ from: e.target.value })} />}</Field>
          <Field label="To">{(a) => <input {...a} type="date" value={to} onChange={(e) => set({ to: e.target.value })} />}</Field>
        </div>
        <ErrorNote error={error} />
        {data && (
          <div className="tx-totals">
            <span><span className="label">Collected</span><strong>{peso(data.paid)}</strong></span>
            <span><span className="label">Old System Unpaid</span><strong>{peso(data.oldUnpaid)}</strong></span>
            <span className="cell-sub">{data.total.toLocaleString()} transaction{data.total === 1 ? '' : 's'}{from || to ? ` · ${from ? prettyDay(from) : 'start'} to ${to ? prettyDay(to) : 'today'}` : ''}</span>
          </div>
        )}
        {!data ? <PawLoader label="Loading transactions…" /> : !data.rows.length ? (
          <Empty icon={Receipt} title="No transactions" text={q || source || from || to ? 'Nothing matches these filters.' : 'Payments taken in the app show here. Import the old system’s invoices to add its history.'} />
        ) : (
          <>
            <table className="table">
              <thead><tr><th>Date</th><th>Client</th><th className="hide-sm">Type</th><th className="num">Total</th><th className="num">Paid</th><th className="hide-sm">Method</th><th>Status</th><th className="hide-sm">Staff</th></tr></thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={`${r.source}${r.id}`} className="no-hover">
                    <td className="nowrap">{r.day ? prettyDay(r.day) : 'No date'}<span className="cell-sub">{r.invoiceNo || (r.appointmentId ? <Link to={`/appointments/${r.appointmentId}`}>Open Visit</Link> : '')}</span></td>
                    <td>{r.ownerId ? <Link className="row-link" to={`/clients/${r.ownerId}`}><strong>{r.client || '—'}</strong></Link> : <strong>{r.client || 'Walk-in'}</strong>}<span className="cell-sub">{r.pet || ''}</span></td>
                    <td className="hide-sm">{KIND_LABEL[r.kind]}</td>
                    <td className="num" data-label="Total">{peso(r.total)}</td>
                    <td className="num" data-label="Paid">{peso(r.paid)}</td>
                    <td className="hide-sm">{METHOD_LABEL[r.method] || r.method || '—'}</td>
                    <td data-label="Status"><span className={`badge ${r.status === 'Paid' || r.status === 'Balance Payment' ? 'badge-soft' : 'badge-warm'}`}>{r.status}</span></td>
                    <td className="hide-sm">{r.staff || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pager page={page} pageSize={25} total={data.total} onPage={(n) => set({ page: n > 1 ? String(n) : '' })} noun="transactions" />
          </>
        )}
      </section>
      {importing && <ImportPanel onClose={() => setImporting(false)} onDone={(msg) => { setImporting(false); toast(msg); reload() }} />}
    </>
  )
}
