// Confirmations for removing an owner or a pet. Nothing is erased: removed records can be
// brought back from Masterlist → Removed.
import { useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import { api, ApiError } from '../lib/api.js'
import { useApi } from '../lib/useApi.js'
import { ErrorNote, Field, Panel } from './ui.jsx'

export function RemoveOwnerPanel({ owner, onClose, onDone }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const pets = owner.pets.length
  async function remove() {
    setBusy(true)
    setError(null)
    try {
      await api(`owners/${owner.id}/remove`, { method: 'POST' })
      onDone()
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }
  return (
    <Panel
      title={`Remove ${owner.name}?`}
      onClose={onClose}
      busy={busy}
      footer={(
        <>
          <button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>Keep Owner</button>
          <button type="button" className="btn" onClick={remove} disabled={busy}>{busy ? 'Removing…' : 'Remove Owner'}</button>
        </>
      )}
    >
      <ErrorNote error={error} />
      <section className="form-section">
        <p style={{ margin: 0 }}>
          <strong>{owner.name}</strong> ({owner.customerNo}){pets ? <> and their {pets === 1 ? 'pet' : `${pets} pets`} ({owner.pets.map((p) => p.name).join(', ')})</> : null} will
          disappear from lists and search.
        </p>
        <p style={{ margin: 0 }}>
          Nothing is deleted. To bring them back, go to <strong>Masterlist → Removed</strong> and click <strong>Restore</strong>.
        </p>
      </section>
    </Panel>
  )
}

export function RemovePetPanel({ pet, onClose, onDone }) {
  const [reason, setReason] = useState('passed_away')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  async function remove() {
    setBusy(true)
    setError(null)
    try {
      await api(`pets/${pet.id}/remove`, { method: 'POST', body: { reason, date } })
      onDone(reason)
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }
  const dateError = error instanceof ApiError ? error.body.errors?.date : null
  return (
    <Panel
      title={`Remove ${pet.name}?`}
      intro="Choose what happened, so the records stay right."
      onClose={onClose}
      busy={busy}
      footer={(
        <>
          <button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>Keep {pet.name}</button>
          <button type="button" className="btn" onClick={remove} disabled={busy}>
            {busy ? 'Saving…' : reason === 'passed_away' ? 'Mark as Passed Away' : `Remove ${pet.name}`}
          </button>
        </>
      )}
    >
      <ErrorNote error={error && !dateError ? error : null} />
      <section className="form-section">
        <label className="check">
          <input type="radio" name="reason" checked={reason === 'passed_away'} onChange={() => setReason('passed_away')} />
          <span>
            <strong>{pet.name} has passed away</strong><br />
            The pet and all its records stay on file, marked "Passed Away", so the history isn't lost.
          </span>
        </label>
        {reason === 'passed_away' && (
          <Field label="Date" hint="An estimate is fine." error={dateError}>
            {(a) => <input {...a} type="date" value={date} onChange={(e) => setDate(e.target.value)} max={new Date().toISOString().slice(0, 10)} />}
          </Field>
        )}
        <label className="check">
          <input type="radio" name="reason" checked={reason === 'mistake'} onChange={() => setReason('mistake')} />
          <span>
            <strong>Added by Mistake, or a Duplicate</strong><br />
            {pet.name} disappears from lists and search. You can bring it back from <strong>Masterlist → Removed</strong>.
          </span>
        </label>
      </section>
    </Panel>
  )
}

// Owners and admins: delete an owner with everything attached (e.g. a test client). Shows what will go,
// and asks them to type the owner's name. Marked deleted, never erased; stock goes back on the shelf.
export function DeleteOwnerPanel({ owner, onClose, onDone }) {
  const { data, error: loadError } = useApi(`owners/${owner.id}/delete`)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const match = typed.trim().toLowerCase() === owner.name.trim().toLowerCase()
  async function remove() {
    setBusy(true)
    setError(null)
    try {
      await api(`owners/${owner.id}/delete`, { method: 'POST', body: { confirm: typed } })
      onDone()
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }
  const n = (k, one, many) => `${data[k]} ${data[k] === 1 ? one : many}`
  return (
    <Panel title={`Delete ${owner.name} and All Records?`} onClose={onClose} busy={busy}
      footer={(
        <>
          <button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>Keep Owner</button>
          <button type="button" className="btn btn-danger" onClick={remove} disabled={busy || !match || !data}>{busy ? 'Deleting…' : 'Delete Everything'}</button>
        </>
      )}>
      <ErrorNote error={loadError || error} />
      <section className="form-section">
        <div className="alert" role="note"><TriangleAlert aria-hidden /><div><strong>This can’t be undone from the app.</strong> Use it for test clients or duplicates. To hide a real client, use <strong>Remove Owner</strong> instead.</div></div>
        {!data ? <p className="muted" style={{ margin: 0 }}>Checking what’s attached…</p> : (
          <>
            <p style={{ margin: 0 }}>This deletes <strong>{owner.name}</strong> ({owner.customerNo}) and everything attached:</p>
            <ul style={{ margin: 0 }}>
              <li>{n('pets', 'pet', 'pets')}{owner.pets.length ? ` (${owner.pets.map((p) => p.name).join(', ')})` : ''} and their tags</li>
              <li>{n('visits', 'visit', 'visits')} and what’s on them</li>
              <li>{n('records', 'medical record', 'medical records')}</li>
              <li>{n('payments', 'payment', 'payments')}{data.paid ? ` (₱${data.paid.toLocaleString('en-PH')} collected)` : ''} and {n('sales', 'quick sale', 'quick sales')}: taken out of every total</li>
            </ul>
            <p className="field-hint" style={{ margin: 0 }}>Stock used on their paid visits and sales goes back on the shelf. Everything stays in the database, marked deleted, so it can be recovered if done by mistake.</p>
          </>
        )}
        <Field label={`Type ${owner.name} to Confirm`}>{(a) => <input {...a} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" placeholder={owner.name} />}</Field>
      </section>
    </Panel>
  )
}
