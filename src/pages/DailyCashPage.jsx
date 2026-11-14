// Finances ▸ Daily Cash (owners and admins): the clinic's daily cash book, like the paper ledger. One line per
// receipt (payments taken in the app appear by themselves; others are added by hand), expenses from the drawer,
// the 1st (3 PM) and 2nd (end of day) remits, and the summary: Total - Onlines - Expenses - 1st Remit =
// Cash On Hand, checked against the 2nd Remit. Vet commission per receipt and per vet. Math: lib/daily-cash.js.
import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Pencil, Plus, Printer, Trash2, Wallet } from 'lucide-react'
import { Empty, ErrorNote, Field, PageHead, Panel, PawLoader, useToast } from '../components/ui.jsx'
import { api, ApiError } from '../lib/api.js'
import { useApi } from '../lib/useApi.js'
import { canManage, useStaff } from '../lib/staff.js'
import { prettyDay } from '../lib/format.js'
import { EXPENSE_TYPES, METHODS, calcCommission, commissionOf, methodOf, summarize } from '../../lib/daily-cash.js'

const peso = (c) => `₱${(Number(c || 0) / 100).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
const toPesos = (c) => (c == null ? '' : String(Math.round(c) / 100))
const toCents = (v) => { const t = String(v ?? '').replace(/[₱,\s]/g, ''); if (t === '') return null; const n = Number(t); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN }
const manilaToday = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
const shift = (day, n) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const lineBody = (l) => ({ receiptNo: l.receiptNo, clientName: l.clientName, petNames: l.petNames, vetStaffId: l.vetStaffId, method: l.method, amountCents: l.amountCents, medsCents: l.medsCents, doctorCents: l.doctorCents, surgeryCents: l.surgeryCents, labTests: l.labTests, commissionCents: l.commissionCents, note: l.note })

// Saves a line: an edit, or the first save of a payment taken in the app (or a new hand-written line).
async function saveLine(day, line, patch) {
  const body = { ...lineBody(line), ...patch }
  if (line.id) return api(`finances/daily/lines/${line.id}`, { method: 'PATCH', body })
  return api('finances/daily/lines', { method: 'POST', body: { ...body, day, paymentId: line.paymentId || null } })
}

function ReceiptCell({ day, line, onSaved }) {
  const [v, setV] = useState(line.receiptNo || '')
  const toast = useToast()
  useEffect(() => setV(line.receiptNo || ''), [line.receiptNo])
  async function commit() {
    if (v.trim() === (line.receiptNo || '')) return
    try { await saveLine(day, line, { receiptNo: v.trim() }); onSaved() } catch (err) { toast(err.message); setV(line.receiptNo || '') }
  }
  return <input className="dc-receipt" value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} placeholder="No." aria-label={`Receipt number for ${line.clientName || 'this line'}`} maxLength={40} />
}

function LinePanel({ day, line, vets, rates, onClose, onDone }) {
  const blank = { receiptNo: '', clientName: '', petNames: '', vetStaffId: null, method: 'cash', amountCents: null, medsCents: 0, doctorCents: 0, surgeryCents: 0, labTests: 0, commissionCents: null, note: '' }
  const start = line || blank
  const [f, setF] = useState({ ...start, amount: toPesos(start.amountCents), meds: toPesos(start.medsCents), doctor: toPesos(start.doctorCents), surgery: toPesos(start.surgeryCents), labs: String(start.labTests || 0), commission: toPesos(start.commissionCents) })
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const errors = error instanceof ApiError ? error.body.errors || {} : {}
  const set = (p) => { setF((x) => ({ ...x, ...p })); setDirty(true) }
  const parts = { medsCents: toCents(f.meds) || 0, doctorCents: toCents(f.doctor) || 0, surgeryCents: toCents(f.surgery) || 0, labTests: Math.max(0, Math.round(Number(f.labs) || 0)) }
  const calc = calcCommission(parts, rates)
  async function save() {
    setBusy(true); setError(null)
    const amountCents = toCents(f.amount)
    const typed = f.commission === '' ? null : toCents(f.commission)
    try {
      await saveLine(day, line || {}, { receiptNo: f.receiptNo, clientName: f.clientName, petNames: f.petNames, vetStaffId: f.vetStaffId || null, method: f.method, amountCents: Number.isNaN(amountCents) ? -1 : amountCents, ...parts, commissionCents: Number.isNaN(typed) ? -1 : typed, note: f.note })
      onDone(line ? 'Line saved' : 'Line added')
    } catch (err) { setError(err); setBusy(false) }
  }
  async function remove() {
    if (!line?.id) return
    setBusy(true)
    try { await api(`finances/daily/lines/${line.id}`, { method: 'DELETE' }); onDone('Line removed') } catch (err) { setError(err); setBusy(false) }
  }
  return (
    <Panel title={line ? (line.id ? 'Edit Line' : 'Check Payment Line') : 'Add Line'} intro={line?.fromApp ? 'Taken in the app. Add the receipt number and check the commission.' : 'A receipt from today’s Messenger group, entered by hand.'}
      onClose={onClose} busy={busy} dirty={dirty} discardTitle="Close without saving the line?"
      footer={<>
        {line?.id && !line.fromApp && <button type="button" className="btn btn-quiet" onClick={remove} disabled={busy}><Trash2 aria-hidden /> Remove Line</button>}
        <button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="btn" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save Line'}</button>
      </>}>
      <ErrorNote error={error && !Object.keys(errors).length ? error : null} />
      <div className="form-row">
        <Field label="Receipt No." optional>{(a) => <input {...a} value={f.receiptNo} onChange={(e) => set({ receiptNo: e.target.value })} maxLength={40} placeholder="e.g. 05237" />}</Field>
        <Field label="Amount (₱)" error={errors.amountCents}>{(a) => <input {...a} inputMode="decimal" value={f.amount} onChange={(e) => set({ amount: e.target.value })} placeholder="e.g. 1500" disabled={line?.fromApp} />}</Field>
      </div>
      <div className="form-row">
        <Field label="Client" optional>{(a) => <input {...a} value={f.clientName} onChange={(e) => set({ clientName: e.target.value })} maxLength={120} placeholder="Surname" />}</Field>
        <Field label="Pets" optional>{(a) => <input {...a} value={f.petNames} onChange={(e) => set({ petNames: e.target.value })} maxLength={200} placeholder="e.g. Coco, Max" />}</Field>
      </div>
      <div className="form-row">
        <Field label="Paid By" error={errors.method}>{(a) => <select {...a} className="select" value={f.method} onChange={(e) => set({ method: e.target.value })}>{METHODS.map((m) => <option key={m.key} value={m.key}>{m.label}{m.online ? ' (online)' : ''}</option>)}</select>}</Field>
        <Field label="Vet" optional error={errors.vetStaffId}>{(a) => <select {...a} className="select" value={f.vetStaffId || ''} onChange={(e) => set({ vetStaffId: e.target.value ? Number(e.target.value) : null })}><option value="">No vet</option>{vets.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>}</Field>
      </div>
      <section className="form-section">
        <h3 className="label">Vet Commission</h3>
        <div className="form-row">
          <Field label={`Generic Meds (₱) × ${rates.medsPct}%`} error={errors.medsCents}>{(a) => <input {...a} inputMode="decimal" value={f.meds} onChange={(e) => set({ meds: e.target.value })} placeholder="0" />}</Field>
          <Field label={`Doctor’s Fee (₱) × ${rates.doctorPct}%`} error={errors.doctorCents}>{(a) => <input {...a} inputMode="decimal" value={f.doctor} onChange={(e) => set({ doctor: e.target.value })} placeholder="0" />}</Field>
        </div>
        <div className="form-row">
          <Field label={`Surgery (₱) × ${rates.surgeryPct}%`} error={errors.surgeryCents}>{(a) => <input {...a} inputMode="decimal" value={f.surgery} onChange={(e) => set({ surgery: e.target.value })} placeholder="0" />}</Field>
          <Field label={`Lab Tests (Count) × ${peso(rates.labCents)}`} error={errors.labTests}>{(a) => <input {...a} inputMode="numeric" value={f.labs} onChange={(e) => set({ labs: e.target.value.replace(/\D/g, '') })} placeholder="0" />}</Field>
        </div>
        <div className="form-row">
          <Field label="Commission (₱)" optional error={errors.commissionCents} hint={f.commission === '' ? `Calculated: ${peso(calc)}. Type a figure to use your own.` : `Calculated would be ${peso(calc)}.`}>
            {(a) => <input {...a} inputMode="decimal" value={f.commission} onChange={(e) => set({ commission: e.target.value })} placeholder={toPesos(calc)} />}
          </Field>
          {f.commission !== '' && <button type="button" className="btn btn-quiet" style={{ alignSelf: 'center' }} onClick={() => set({ commission: '' })}>Use Calculated</button>}
        </div>
      </section>
      <Field label="Note" optional>{(a) => <input {...a} value={f.note} onChange={(e) => set({ note: e.target.value })} maxLength={300} placeholder="e.g. Balance 3,200, downpayment today" />}</Field>
    </Panel>
  )
}

function Expenses({ day, list, onChanged }) {
  const toast = useToast()
  const [f, setF] = useState({ category: '', description: '', amount: '' })
  const [error, setError] = useState(null)
  const errors = error instanceof ApiError ? error.body.errors || {} : {}
  async function add() {
    setError(null)
    try { await api('finances/daily/expenses', { method: 'POST', body: { day, category: f.category, description: f.description, amountCents: toCents(f.amount) } }); setF({ category: f.category, description: '', amount: '' }); onChanged(); toast('Expense added') } catch (err) { setError(err) }
  }
  async function remove(e) { try { await api(`finances/daily/expenses/${e.id}`, { method: 'DELETE' }); onChanged(); toast('Expense removed') } catch (err) { toast(err.message) } }
  return (
    <section className="card">
      <div className="card-head"><h2>Expenses</h2><span className="cell-sub">Cash taken from the drawer</span></div>
      <div className="card-pad stack" style={{ gap: 10 }}>
        {list.length > 0 && (
          <ul className="dc-list">
            {list.map((e) => <li key={e.id}><span><strong>{e.category}</strong>{e.description && <span className="cell-sub"> · {e.description}</span>}</span><span className="dc-amt">{peso(e.amountCents)}</span>
              <button type="button" className="icon-btn" onClick={() => remove(e)} aria-label={`Remove ${e.category} expense`} title="Remove"><Trash2 /></button></li>)}
          </ul>
        )}
        <div className="dc-add">
          <Field label="Type" error={errors.category}>{(a) => <select {...a} className="select" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}><option value="">Choose…</option>{EXPENSE_TYPES.map((t) => <option key={t}>{t}</option>)}</select>}</Field>
          <Field label="What For" optional>{(a) => <input {...a} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={200} placeholder="e.g. Cotton, alcohol" />}</Field>
          <Field label="Amount (₱)" error={errors.amountCents}>{(a) => <input {...a} inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="e.g. 160" />}</Field>
          <button type="button" className="btn btn-quiet" onClick={add} disabled={!f.category || !f.amount}><Plus aria-hidden /> Add Expense</button>
        </div>
      </div>
    </section>
  )
}

function Remit({ day, kind, label, hint, list, suggest, onChanged }) {
  const toast = useToast()
  const mine = list.filter((r) => r.kind === kind)
  const [f, setF] = useState({ amount: '', by: '' })
  async function add() {
    try { await api('finances/daily/remits', { method: 'POST', body: { day, kind, amountCents: toCents(f.amount), remittedBy: f.by } }); setF({ amount: '', by: '' }); onChanged(); toast(`${label} saved`) } catch (err) { toast(err.message) }
  }
  async function remove(r) { try { await api(`finances/daily/remits/${r.id}`, { method: 'DELETE' }); onChanged(); toast(`${label} removed`) } catch (err) { toast(err.message) } }
  return (
    <div className="dc-remit">
      <div><strong>{label}</strong><span className="cell-sub">{hint}</span></div>
      {mine.map((r) => <div key={r.id} className="dc-remit-row"><span className="dc-amt">{peso(r.amountCents)}</span><span className="cell-sub">{r.remittedBy ? `by ${r.remittedBy}` : ''}</span>
        <button type="button" className="icon-btn" onClick={() => remove(r)} aria-label={`Remove ${label}`} title="Remove"><Trash2 /></button></div>)}
      {!mine.length && (
        <div className="dc-add dc-add-tight">
          <Field label="Amount (₱)">{(a) => <input {...a} inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder={suggest != null ? toPesos(suggest) : 'e.g. 9820'} />}</Field>
          <Field label="Remitted By" optional>{(a) => <input {...a} value={f.by} onChange={(e) => setF({ ...f, by: e.target.value })} maxLength={80} placeholder="Name" />}</Field>
          <button type="button" className="btn btn-quiet" onClick={add} disabled={!f.amount}>Save {label}</button>
        </div>
      )}
    </div>
  )
}

function Rates({ rates, onSaved }) {
  const toast = useToast()
  const [f, setF] = useState({ medsPct: String(rates.medsPct), doctorPct: String(rates.doctorPct), surgeryPct: String(rates.surgeryPct), lab: toPesos(rates.labCents) })
  const changed = String(rates.medsPct) !== f.medsPct || String(rates.doctorPct) !== f.doctorPct || String(rates.surgeryPct) !== f.surgeryPct || toPesos(rates.labCents) !== f.lab
  async function save() {
    try { await api('finances/daily/rates', { method: 'PUT', body: { medsPct: Number(f.medsPct), doctorPct: Number(f.doctorPct), surgeryPct: Number(f.surgeryPct), labCents: toCents(f.lab) } }); toast('Commission rates saved'); onSaved() } catch (err) { toast(err.message) }
  }
  return (
    <details className="dc-rates">
      <summary>Commission Rates</summary>
      <div className="dc-rates-grid">
        <Field label="Generic Meds (%)">{(a) => <input {...a} inputMode="decimal" value={f.medsPct} onChange={(e) => setF({ ...f, medsPct: e.target.value })} />}</Field>
        <Field label="Doctor’s Fee (%)">{(a) => <input {...a} inputMode="decimal" value={f.doctorPct} onChange={(e) => setF({ ...f, doctorPct: e.target.value })} />}</Field>
        <Field label="Surgery (%)">{(a) => <input {...a} inputMode="decimal" value={f.surgeryPct} onChange={(e) => setF({ ...f, surgeryPct: e.target.value })} />}</Field>
        <Field label="Per Lab Test (₱)">{(a) => <input {...a} inputMode="decimal" value={f.lab} onChange={(e) => setF({ ...f, lab: e.target.value })} />}</Field>
      </div>
      <button type="button" className="btn btn-quiet" onClick={save} disabled={!changed}>Save Rates</button>
      <p className="field-hint" style={{ margin: 0 }}>Lines with a typed commission keep it. Everything else updates straight away.</p>
    </details>
  )
}

export default function DailyCashPage() {
  const staff = useStaff()
  const toast = useToast()
  const [day, setDay] = useState(manilaToday())
  const { data, error, reload } = useApi(canManage(staff) ? `finances/daily?day=${day}` : null)
  const month = useApi(canManage(staff) ? `finances/daily/days?month=${day.slice(0, 7)}` : null)
  const [panel, setPanel] = useState(null) // { line } or { line: null } for a new one
  const refresh = () => { reload(); month.reload() }
  const head = <PageHead crumbs={[{ label: 'Finances' }, { label: 'Daily Cash' }]} title="Daily Cash" intro="The day’s cash book: every receipt, expenses, remits and the cash that should be in the drawer." />
  if (!canManage(staff)) return <>{head}<ErrorNote error={new Error('Only an owner or admin can open Daily Cash.')} /></>
  const s = data ? summarize(data, data.rates) : null
  const onlineMethods = METHODS.filter((m) => m.online && s?.byMethod[m.key])
  return (
    <>
      {head}
      <div className="dc-daybar">
        <button type="button" className="icon-btn" onClick={() => setDay(shift(day, -1))} aria-label="Day before" title="Day Before"><ChevronLeft /></button>
        <input type="date" className="dc-date" value={day} max={manilaToday()} onChange={(e) => e.target.value && setDay(e.target.value)} aria-label="Day" />
        <button type="button" className="icon-btn" onClick={() => setDay(shift(day, 1))} disabled={day >= manilaToday()} aria-label="Next day" title="Next Day"><ChevronRight /></button>
        <strong className="dc-dayname">{prettyDay(day)}</strong>
        {day !== manilaToday() && <button type="button" className="text-btn" onClick={() => setDay(manilaToday())}>Today</button>}
        <button type="button" className="btn btn-quiet dc-print" onClick={() => window.print()}><Printer aria-hidden /> Print</button>
      </div>
      <ErrorNote error={error} />
      {!data ? <PawLoader label="Loading the day…" /> : (
        <div className="dc-grid">
          <div className="stack" style={{ gap: 16, minWidth: 0 }}>
            <section className="card">
              <div className="card-head"><h2>Receipts</h2><button type="button" className="btn" onClick={() => setPanel({ line: null })}><Plus aria-hidden /> Add Line</button></div>
              {!data.lines.length ? <Empty icon={Wallet} title="No receipts yet" text="Payments taken in the app show here. Add receipts from the Messenger group with Add Line." /> : (
                <div className="table-wrap">
                  <table className="table dc-table">
                    <thead><tr><th>Receipt No.</th><th>Client / Pets</th><th className="hide-sm">Vet</th><th>Paid By</th><th className="num">Amount</th><th className="num">Commission</th><th><span className="sr-only">Edit</span></th></tr></thead>
                    <tbody>
                      {data.lines.map((l) => {
                        const m = methodOf(l.method)
                        const c = commissionOf(l, data.rates)
                        return (
                          <tr key={l.id || `p${l.paymentId}`} className={l.voided ? 'dc-voided' : ''}>
                            <td><ReceiptCell day={day} line={l} onSaved={refresh} /></td>
                            <td><strong>{l.clientName || '—'}</strong>{l.petNames && <span className="cell-sub"> / {l.petNames}</span>}
                              {(l.fromApp || l.voided || l.note) && <span className="cell-sub dc-tags">{l.voided ? 'Payment voided: not counted' : l.unsaved ? 'From the app' : l.fromApp ? 'From the app' : ''}{l.note ? `${l.fromApp || l.voided ? ' · ' : ''}${l.note}` : ''}</span>}</td>
                            <td className="hide-sm">{l.vetName || <span className="cell-sub">—</span>}</td>
                            <td><span className={`badge ${m.online ? 'badge-soft' : 'badge-warm'}`} title={m.label}>{m.code}</span>{m.online && <span className="cell-sub"> Online</span>}</td>
                            <td className="num">{peso(l.amountCents)}</td>
                            <td className="num">{c ? peso(c) : <span className="cell-sub">—</span>}{l.commissionCents != null && <span className="cell-sub" title="Typed by hand"> ✎</span>}</td>
                            <td><button type="button" className="icon-btn" onClick={() => setPanel({ line: l })} aria-label={`Edit line for ${l.clientName || 'receipt'}`} title="Edit Line"><Pencil /></button></td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            <Expenses day={day} list={data.expenses} onChanged={refresh} />
            <section className="card">
              <div className="card-head"><h2>Remits</h2></div>
              <div className="card-pad dc-remits">
                <Remit day={day} kind="first" label="1st Remit" hint="3 PM" list={data.remits} onChanged={refresh} />
                <Remit day={day} kind="second" label="2nd Remit" hint="End of day: should match Cash On Hand" list={data.remits} suggest={s.cashOnHand} onChanged={refresh} />
              </div>
            </section>
          </div>

          <aside className="stack dc-side" style={{ gap: 16 }}>
            <section className="card card-pad dc-summary">
              <h2>Summary</h2>
              <dl>
                <div><dt>Total ({s.receipts} receipt{s.receipts === 1 ? '' : 's'})</dt><dd>{peso(s.total)}</dd></div>
                <div><dt>Less Onlines</dt><dd>− {peso(s.onlines)}</dd></div>
                {onlineMethods.map((m) => <div key={m.key} className="dc-sub"><dt>{m.label}</dt><dd>{peso(s.byMethod[m.key])}</dd></div>)}
                <div><dt>Less Expenses</dt><dd>− {peso(s.expenses)}</dd></div>
                <div><dt>Less 1st Remit</dt><dd>− {peso(s.firstRemit)}</dd></div>
                <div className="dc-coh"><dt>Cash On Hand</dt><dd>{peso(s.cashOnHand)}</dd></div>
                <div><dt>2nd Remit</dt><dd>{s.hasSecond ? peso(s.secondRemit) : '—'}</dd></div>
              </dl>
              {s.hasSecond && (s.difference === 0
                ? <p className="dc-ok">✓ The 2nd Remit matches Cash On Hand.</p>
                : <p className="dc-off">{s.difference < 0 ? `Short by ${peso(-s.difference)}` : `Over by ${peso(s.difference)}`}. Check the receipts, expenses and remits.</p>)}
            </section>
            <section className="card card-pad dc-summary">
              <h2>Vet Commission</h2>
              <dl>
                {Object.entries(s.commission).map(([vet, c]) => <div key={vet}><dt>{vet}</dt><dd>{peso(c)}</dd></div>)}
                <div className="dc-coh"><dt>Total</dt><dd>{peso(s.commissionTotal)}</dd></div>
              </dl>
              <p className="field-hint" style={{ margin: 0 }}>Not taken out of the cash. Pay it out as an expense (type Vet Commission) when it’s given.</p>
              <Rates key={JSON.stringify(data.rates)} rates={data.rates} onSaved={refresh} />
            </section>
            <section className="card card-pad dc-summary dc-days">
              <h2>{new Date(`${day.slice(0, 7)}-01T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</h2>
              {!month.data ? <PawLoader small label="Loading…" /> : !month.data.days.length ? <p className="cell-sub" style={{ margin: 0 }}>No days with entries yet this month.</p> : (
                <ul className="dc-list">
                  {month.data.days.map((d) => (
                    <li key={d.day}><button type="button" className={`text-btn ${d.day === day ? 'is-on' : ''}`} onClick={() => setDay(d.day)}>{prettyDay(d.day)}</button>
                      <span className="cell-sub">{peso(d.total)}</span>
                      <span className="dc-amt">{!d.hasSecond ? <span className="cell-sub">Open</span> : d.difference === 0 ? '✓' : d.difference < 0 ? `−${peso(-d.difference)}` : `+${peso(d.difference)}`}</span></li>
                  ))}
                </ul>
              )}
            </section>
          </aside>
        </div>
      )}
      {panel && data && <LinePanel day={day} line={panel.line} vets={data.vets} rates={data.rates} onClose={() => setPanel(null)} onDone={(msg) => { setPanel(null); toast(msg); refresh() }} />}
    </>
  )
}
