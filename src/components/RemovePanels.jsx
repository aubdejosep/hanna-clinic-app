// Confirmations for removing an owner or a pet. Nothing is erased: removed records can be
// brought back from Masterlist → Removed.
import { useState } from 'react'
import { api, ApiError } from '../lib/api.js'
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
