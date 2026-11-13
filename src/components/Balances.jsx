// Balances on an owner's page (and a visit's): what they still owe, with Record Payment, and for owners
// and admins, Clear. Also the panels used by Finances ▸ Balances.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Wallet } from 'lucide-react'
import { ErrorNote, Field, Panel, useToast } from './ui.jsx'
import { METHODS, peso } from './QuickAdd.jsx'
import { api, ApiError } from '../lib/api.js'
import { useApi } from '../lib/useApi.js'
import { canManage, useStaff } from '../lib/staff.js'
import { prettyDay } from '../lib/format.js'

const TYPE_LABEL = { unpaid: 'Not paid', owed: 'Part paid', invoice: 'Old system' }

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
              <span className="cell-sub">{i.label}{i.petName ? ` · ${i.petName}` : ''}{i.day ? ` · ${prettyDay(i.day)}` : ''}{i.paid ? ` · ${peso(i.paid)} of ${peso(i.total)} paid` : ''}</span>
            </span>
            <span className="badge badge-soft">{TYPE_LABEL[i.type]}</span>
            <span className="balance-actions">
              {i.type === 'unpaid'
                ? <Link className="btn btn-quiet" to={`/appointments/${i.id}?pay=1`}><Wallet aria-hidden /> Take Payment</Link>
                : <button type="button" className="btn btn-quiet" onClick={() => setPanel({ kind: 'pay', item: i })}><Wallet aria-hidden /> Record Payment</button>}
              {i.type !== 'unpaid' && canManage(staff) && <button type="button" className="text-btn" onClick={() => setPanel({ kind: 'clear', item: i })}>Clear</button>}
              {i.type !== 'invoice' && <Link className="text-btn" to={`/appointments/${i.id}`}>Open Visit</Link>}
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
