import { useEffect, useState, useSyncExternalStore } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarPlus, LogIn, LogOut, Nfc, TriangleAlert, UserCheck, X } from 'lucide-react'
import { ErrorNote, Field, Panel, useToast } from './ui.jsx'
import { WalkInPanel, PetPicker } from './AppointmentPanels.jsx'
import { api } from '../lib/api.js'
import { captureTagScans, getReaderState, initTagReader, onTagScan, setReaderEnabled, subscribeReader } from '../lib/tagBridge.js'
import { clockTime, since } from '../lib/appointments.js'

export const useReader = () => useSyncExternalStore(subscribeReader, getReaderState)
// Lists listen for this to refresh after a tap or a status change.
export const appointmentsChanged = () => window.dispatchEvent(new Event('clinic:appointments-changed'))
export function useAppointmentsChanged(reload) {
  useEffect(() => {
    window.addEventListener('clinic:appointments-changed', reload)
    return () => window.removeEventListener('clinic:appointments-changed', reload)
  }, [reload])
}

// "Tag Reader" chip: shows whether this PC's reader is connected; turns it on or off for this PC.
export function ReaderSwitch() {
  const r = useReader()
  const label = !r.enabled ? 'Tag Reader Off' : r.connected ? 'Tag Reader Ready' : 'Looking for Tag Reader'
  return (
    <button type="button" className={`btn btn-quiet reader-btn ${r.enabled && r.connected ? 'is-on' : ''}`} onClick={() => setReaderEnabled(!r.enabled)}
      title={r.enabled ? 'Stop using a tag reader on this PC' : 'Use the NFC tag reader plugged into this PC'} aria-pressed={r.enabled}>
      <Nfc aria-hidden /> {label}
    </button>
  )
}

// What a tap did, shown in the corner of any screen for a few seconds.
function TapNotice({ tap, onClose, onWalkIn, onAssign }) {
  const navigate = useNavigate()
  const { result, pet, appointment: a } = tap
  useEffect(() => {
    if (['no_booking', 'unknown_tag', 'error'].includes(result)) return undefined
    const t = setTimeout(onClose, 12000)
    return () => clearTimeout(t)
  }, [tap, result, onClose])
  const open = a && <button type="button" className="btn btn-quiet" onClick={() => { navigate(`/appointments/${a.id}`); onClose() }}>Open Appointment</button>
  const body = {
    checked_in: { icon: LogIn, title: `${pet?.name} checked in`, text: `${pet?.ownerName} · Arrived ${clockTime(a?.checkedInAt)}`, actions: open },
    checked_out: { icon: LogOut, title: `${pet?.name} checked out`, text: `Visit closed. In ${clockTime(a?.checkedInAt)}, out ${clockTime(a?.checkedOutAt)}.`, actions: open },
    ignored: { icon: UserCheck, title: `${pet?.name} is already checked in`, text: `Checked in ${since(a?.checkedInAt)} ago. To check out, tap again after 5 minutes.`, actions: open },
    no_booking: {
      icon: CalendarPlus, title: `${pet?.name} has no booking today`, text: tap.completedToday ? 'Their visit today is already closed. Check in again as a walk-in?' : 'Check them in as a walk-in?',
      actions: <button type="button" className="btn" onClick={onWalkIn}><LogIn aria-hidden /> Walk In</button>,
    },
    unknown_tag: { icon: Nfc, title: 'This tag isn’t assigned yet', text: `Tag ${tap.uid}. Give it to a pet?`, actions: <button type="button" className="btn" onClick={onAssign}>Assign Tag</button> },
    pet_unavailable: { icon: TriangleAlert, title: `${pet?.name}’s tag`, text: 'This pet is removed or marked as passed away. Retire the tag on their page.', actions: null },
    error: { icon: TriangleAlert, title: 'The tap didn’t go through', text: tap.message, actions: null },
  }[result]
  if (!body) return null
  return (
    <div className="tap-notice card" role="status" aria-live="polite">
      <body.icon className="tap-icon" aria-hidden />
      <div>
        <strong>{body.title}</strong>
        <p>{body.text}</p>
        {body.actions && <div className="head-actions">{body.actions}</div>}
      </div>
      <button type="button" className="icon-btn" onClick={onClose} aria-label="Close" title="Close"><X /></button>
    </div>
  )
}

// Give a tag to a pet: either the tag is known (an unknown tap) and staff pick the pet, or the
// pet is known (pet page) and the next tap is captured.
export function AssignTagPanel({ uid: givenUid, pet: givenPet, onClose, onDone }) {
  const reader = useReader()
  const [uid, setUid] = useState(givenUid || '')
  const [pet, setPet] = useState(givenPet || null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [conflict, setConflict] = useState(null)
  useEffect(() => (givenUid ? undefined : captureTagScans((scanned) => setUid(scanned.toUpperCase()))), [givenUid])

  async function save(move = false) {
    setBusy(true)
    setError(null)
    try {
      await api(`pets/${pet.id}/tag`, { method: 'POST', body: { uid, move } })
      onDone({ uid, pet })
    } catch (err) {
      if (err.status === 409) setConflict(err.message)
      else setError(err)
      setBusy(false)
    }
  }
  return (
    <Panel dirty={(!givenUid && !!uid) || (!givenPet && !!pet)} discardTitle="Close without assigning the tag?" title="Assign Tag" intro={pet && givenPet ? `For ${pet.name}` : `Tag ${uid}`} onClose={onClose} busy={busy}
      footer={<><button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>Cancel</button>
        {conflict
          ? <button type="button" className="btn" onClick={() => save(true)} disabled={busy}>Move Tag to {pet.name}</button>
          : <button type="button" className="btn" onClick={() => save(false)} disabled={busy || !uid || !pet}>{busy ? 'Saving…' : 'Assign Tag'}</button>}</>}>
      <ErrorNote error={error} />
      {conflict && <div className="alert" role="alert"><TriangleAlert aria-hidden /> <span>{conflict}</span></div>}
      {givenPet ? (
        <section className="form-section">
          <div className={`tap-target ${uid ? 'has-tag' : ''}`}>
            <Nfc aria-hidden />
            {uid ? <><strong>Tag {uid}</strong><span>Tap another tag to use that one instead.</span></>
              : <><strong>Tap the new tag on the reader</strong><span>{reader.enabled ? (reader.connected ? 'The reader is ready.' : 'Looking for the reader on this PC…') : 'Turn on the tag reader for this PC first, or type the tag number below.'}</span></>}
          </div>
          {!reader.enabled && <button type="button" className="btn btn-quiet" style={{ justifySelf: 'start' }} onClick={() => setReaderEnabled(true)}><Nfc aria-hidden /> Use This PC’s Tag Reader</button>}
          <Field label="Tag Number" optional hint="Only if there's no reader: the number printed on the tag.">
            {(a) => <input {...a} value={uid} onChange={(e) => setUid(e.target.value.toUpperCase().replace(/[^0-9A-F]/g, ''))} maxLength={32} />}
          </Field>
        </section>
      ) : <PetPicker value={pet} onPick={(p) => { setPet(p); setConflict(null) }} />}
    </Panel>
  )
}

// Listens for taps on every screen (only on the PC with the reader switched on).
export default function TagCheckIn() {
  const toast = useToast()
  const [tap, setTap] = useState(null)
  const [walkIn, setWalkIn] = useState(null)
  const [assign, setAssign] = useState(null)
  const navigate = useNavigate()
  useEffect(() => { initTagReader() }, [])
  useEffect(() => onTagScan(async (uid) => {
    try {
      const res = await api('checkin/tap', { method: 'POST', body: { uid } })
      setTap(res)
      appointmentsChanged()
    } catch (err) {
      setTap({ result: 'error', message: err.message })
    }
  }), [])
  return (
    <>
      {tap && <TapNotice tap={tap} onClose={() => setTap(null)}
        onWalkIn={() => { setWalkIn({ ...tap.pet }); setTap(null) }}
        onAssign={() => { setAssign(tap.uid); setTap(null) }} />}
      {walkIn && <WalkInPanel pet={walkIn} onClose={() => setWalkIn(null)}
        onDone={(a) => { setWalkIn(null); appointmentsChanged(); toast(`${a.pet.name} checked in`); navigate(`/appointments/${a.id}`) }} />}
      {assign && <AssignTagPanel uid={assign} onClose={() => setAssign(null)}
        onDone={({ pet }) => { setAssign(null); toast(`Tag assigned to ${pet.name}. Tap it again to check in.`) }} />}
    </>
  )
}

