// Balances on an owner's page (and a visit's): what they still owe, with Record Payment, and for owners
// and admins, Clear. Also the panels used by Finances ▸ Balances.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Wallet, X } from 'lucide-react'
import { ErrorNote, Field, Panel, useToast } from './ui.jsx'
import { METHODS, peso } from './QuickAdd.jsx'
import { api, ApiError } from '../lib/api.js'
import { useApi } from '../lib/useApi.js'
import { canManage, useStaff } from '../lib/staff.js'
import { prettyDay } from '../lib/format.js'
import { useCheckIns } from '../lib/checkin-alert.js'

const TYPE_LABEL = { unpaid: 'Not paid', owed: 'Part paid', invoice: 'Old system', ledger: 'Receipt balance' }

export function BalanceItems({ items, onChanged }) {
  const staff = useStaff()
  const [panel, setPanel] = useState(null) // {pay|clear, item}
  return (
    <>
      <ul className="balance-items">
        {items.map((i) => (
          <li key={`${i.type}${i.id}`}>
            <span className="balance-what">
              <strong>{peso(i.left)}</strong>
              <span className="cell-sub">{i.label}{i.petName ? ` · ${i.petName}` : ''}{i.day ? ` · since ${prettyDay(i.day)}` : ''}{i.paid ? ` · ${peso(i.paid)} of ${peso(i.total)} paid` : ''}</span>
            </span>
            <span className="badge badge-soft">{TYPE_LABEL[i.type]}</span>
            <span className="balance-actions">
              {i.type === 'unpaid'
                ? <Link className="btn btn-quiet" to={`/appointments/${i.id}?pay=1`}><Wallet aria-hidden /> Take Payment</Link>
                : <button type="button" className="btn btn-quiet" onClick={() => setPanel({ kind: 'pay', item: i })}><Wallet aria-hidden /> Record Payment</button>}
              {i.type !== 'unpaid' && canManage(staff) && <button type="button" className="text-btn" onClick={() => setPanel({ kind: 'clear', item: i })}>Clear</button>}
              {i.type === 'ledger' && i.day && <Link className="text-btn" to={i.book === 'owner' && canManage(staff) ? `/finances/daily?day=${i.day}` : `/finances/receipts?day=${i.day}&r=${i.id}`}>Open Receipt</Link>}
              {i.type !== 'invoice' && i.type !== 'ledger' && <Link className="text-btn" to={`/appointments/${i.id}`}>Open Visit</Link>}
            </span>
          </li>
        ))}
      </ul>
      {panel?.kind === 'pay' && <PayBalancePanel item={panel.item} onClose={() => setPanel(null)} onDone={() => { setPanel(null); onChanged() }} />}
      {panel?.kind === 'clear' && <ClearBalancePanel item={panel.item} onClose={() => setPanel(null)} onDone={() => { setPanel(null); onChanged() }} />}
    </>
  )
}

// The callout on an owner's page or a visit: nothing when they owe nothing.
export function BalanceCallout({ ownerId, ownerName, compact }) {
  const { data, reload } = useApi(ownerId ? `balances?ownerId=${ownerId}` : null)
  const [open, setOpen] = useState(!compact)
  const o = data?.owners?.[0]
  if (!o) return null
  return (
    <section className="card balance-callout" aria-label="Open balance">
      <div className="balance-head">
        <span className="balance-icon"><Wallet aria-hidden /></span>
        <div>
          <strong>{compact ? `${ownerName || o.name} has an open balance: ${peso(o.total)}` : `Open Balance: ${peso(o.total)}`}</strong>
          <span className="cell-sub">{o.items.length} unpaid item{o.items.length > 1 ? 's' : ''}{o.lastPayment ? ` · last payment ${prettyDay(o.lastPayment)}` : ''}. Remind the owner and collect it with their next payment.</span>
        </div>
        {compact && <button type="button" className="text-btn" onClick={() => setOpen(!open)} style={{ marginLeft: 'auto' }}>{open ? 'Hide' : 'Show'}</button>}
      </div>
      {open && <BalanceItems items={o.items} onChanged={reload} />}
    </section>
  )
}

export function PayBalancePanel({ item, onClose, onDone }) {
  const toast = useToast()
  const [method, setMethod] = useState('')
  const [amount, setAmount] = useState(String(item.left))
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const errors = error instanceof ApiError ? error.body.errors || {} : {}
  async function save() {
    setBusy(true)
    setError(null)
    try {
      const res = await api('balances/pay', { method: 'POST', body: { type: item.type, id: item.id, amount, method, reference, note } })
      toast(res.left > 0 ? `Payment recorded. ${peso(res.left)} still owed.` : 'Payment recorded. This balance is cleared.')
      onDone()
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }
  return (
    <Panel title="Record Payment" intro={`${item.label}${item.petName ? ` · ${item.petName}` : ''} · ${peso(item.left)} left`} onClose={onClose} busy={busy} dirty={!!method}
      footer={<><button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="btn" onClick={save} disabled={busy || !method || !Number(amount)}>{busy ? 'Saving…' : 'Record Payment'}</button></>}>
      <div className="stack">
        <ErrorNote error={error && !Object.keys(errors).length ? error : null} />
        <div>
          <span className="field-label">Paid With</span>
          <div className="chips pay-methods" role="radiogroup" aria-label="Paid With">
            {METHODS.filter(([k]) => k !== 'no_charge').map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={method === k} className="choice pay-method" onClick={() => setMethod(k)}>{l}</button>)}
          </div>
          {errors.method && <span className="field-error">{errors.method}</span>}
        </div>
        <div className="form-row">
          <Field label="Amount Paid (₱)" hint="Part of it is fine: the rest stays on the balance." error={errors.amount}>{(f) => <input {...f} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" />}</Field>
          <Field label="Reference No." optional>{(f) => <input {...f} value={reference} onChange={(e) => setReference(e.target.value)} maxLength={60} />}</Field>
        </div>
        <Field label="Note" optional>{(f) => <input {...f} value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="e.g. paid at the follow-up visit" />}</Field>
      </div>
    </Panel>
  )
}

export function ClearBalancePanel({ item, onClose, onDone }) {
  const toast = useToast()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const errors = error instanceof ApiError ? error.body.errors || {} : {}
  async function save() {
    setBusy(true)
    setError(null)
    try {
      await api('balances/clear', { method: 'POST', body: { type: item.type, id: item.id, reason } })
      toast('Balance cleared')
      onDone()
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }
  return (
    <Panel title="Clear Balance" intro={`${item.label} · ${peso(item.left)} left`} onClose={onClose} busy={busy}
      footer={<><button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="btn" onClick={save} disabled={busy || !reason.trim()}>{busy ? 'Saving…' : 'Clear Balance'}</button></>}>
      <div className="stack">
        <p style={{ margin: 0 }}>Use this when nothing more will be collected, for example an old-system invoice that was paid but never updated. It stays on record with your reason.</p>
        <ErrorNote error={error && !Object.keys(errors).length ? error : null} />
        <Field label="Reason" error={errors.reason}>{(f) => <input {...f} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="e.g. paid in cash in 2025, old system not updated" />}</Field>
      </div>
    </Panel>
  )
}

// Where an invoice number leads: the app's visits open their appointment (every staff member); the old
// system's invoices open Finances ▸ Transactions, which only owners and admins can see.
export function InvoiceLink({ item, onGo }) {
  const staff = useStaff()
  if (item.type === 'ledger') {
    const label = item.invoiceNo ? `Receipt ${item.invoiceNo}` : 'Receipt balance'
    return item.day ? <Link to={item.book === 'owner' && canManage(staff) ? `/finances/daily?day=${item.day}` : `/finances/receipts?day=${item.day}&r=${item.id}`} onClick={onGo}>{label}</Link> : <span>{label}</span>
  }
  if (!item.invoiceNo) return null
  if (item.type !== 'invoice') return <Link to={`/appointments/${item.id}`} onClick={onGo}>Invoice {item.invoiceNo}</Link>
  if (canManage(staff)) return <Link to={`/finances/transactions?q=${encodeURIComponent(item.invoiceNo.replace(/^#/, ''))}`} onClick={onGo}>Invoice {item.invoiceNo}</Link>
  return <span title="Only an owner or admin can open old-system invoices">Invoice {item.invoiceNo}</span>
}

// The pop-up when a pet is checked in and its owner still owes money: what, since when, and which invoice,
// with what the front desk should do. Mounted once in the Layout.
export function BalanceCheckInAlert() {
  const navigate = useNavigate()
  const [alert, setAlert] = useState(null) // { ownerName, petName, owner }
  const button = useRef(null)
  const onCheckIn = useCallback(async ({ ownerId, ownerName, petName }) => {
    try {
      const o = (await api(`balances?ownerId=${ownerId}`)).owners?.[0]
      if (o?.items?.length) setAlert({ ownerName: ownerName || o.name, petName, owner: o })
    } catch { /* the owner's page still shows the balance */ }
  }, [])
  useCheckIns(onCheckIn)
  useEffect(() => {
    if (!alert) return undefined
    button.current?.focus()
    const onKey = (e) => { if (e.key === 'Escape') setAlert(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [alert])
  if (!alert) return null
  const { owner: o } = alert
  const close = () => setAlert(null)
  return (
    <div className="bal-alert-backdrop">
      <div className="bal-alert card" role="alertdialog" aria-modal="true" aria-labelledby="bal-alert-title" aria-describedby="bal-alert-text">
        <div className="bal-alert-head">
          <span className="balance-icon"><Wallet aria-hidden /></span>
          <div>
            <h2 id="bal-alert-title">Collect an Open Balance: {peso(o.total)}</h2>
            <p id="bal-alert-text">{alert.petName ? `${alert.petName} just checked in. ` : ''}<strong>{alert.ownerName}</strong> still owes <strong>{peso(o.total)}</strong>{o.items.length > 1 ? ` on ${o.items.length} invoices` : ''}.</p>
          </div>
          <button type="button" className="icon-btn" onClick={close} aria-label="Close" title="Close"><X /></button>
        </div>
        <ul className="bal-alert-items">
          {o.items.map((i) => (
            <li key={`${i.type}${i.id}`}>
              <span>
                <strong>{peso(i.left)}</strong>
                <span className="cell-sub">{i.day ? `Since ${prettyDay(i.day)}` : 'No date'} · <InvoiceLink item={i} onGo={close} />{i.petName ? ` · ${i.petName}` : ''}{i.paid ? ` · ${peso(i.paid)} of ${peso(i.total)} paid` : ''}</span>
              </span>
            </li>
          ))}
        </ul>
        <div className="bal-alert-todo">
          <strong>What to do</strong>
          <span>Tell the owner about the balance now, and collect it with today’s payment. Record it with <strong>Record Payment</strong> (or <strong>Take Payment</strong>) on the owner’s page. If they can’t pay today, note when they will.</span>
        </div>
        <div className="inline-row">
          <button type="button" className="btn" onClick={() => { close(); navigate(`/clients/${o.id}`) }}><Wallet aria-hidden /> Open Owner to Collect</button>
          <button type="button" className="btn btn-quiet" ref={button} onClick={close}>Got It</button>
        </div>
      </div>
    </div>
  )
}
