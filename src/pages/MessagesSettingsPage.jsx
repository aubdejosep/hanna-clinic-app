// Account ▸ Settings ▸ Messages (owners and admins): the wording, and Text / Email on or off, for every
// message the clinic sends to clients, like the gym's. Texts go out from the SMS sender name once it's
// approved (until then Text stays off). The website reads the booking, free consult and cancelled ones.
import { useRef, useState } from 'react'
import { CalendarCheck, CalendarClock, CalendarX, Gift, MessageSquareText, RotateCcw, Send, Syringe } from 'lucide-react'
import { ErrorNote, Field, PageHead, PawLoader, useToast } from '../components/ui.jsx'
import { SettingsTabs } from './SettingsPage.jsx'
import { api, ApiError } from '../lib/api.js'
import { useApi } from '../lib/useApi.js'
import { canManage, useStaff } from '../lib/staff.js'
import { EMAIL_REQUIRED, FILL_IN_HELP, fillIn, smsInfo } from '../../lib/messages.js'

const ABOUT = {
  booking: { icon: CalendarCheck, title: 'Online Booking', when: 'When someone books on the website (/book). The email also has the booking details and the Change or Cancel button.' },
  free_consult: { icon: Gift, title: 'Free Consult Sign-Up', when: 'When someone signs up on /free-consult. The code itself only goes by email; the text just says to check it.' },
  booking_cancelled: { icon: CalendarX, title: 'Booking Cancelled', when: 'When a client cancels from the link in their email.' },
  visit_reminder: { icon: CalendarClock, title: 'Visit Reminder', when: 'At 9 AM the day before, to every owner with a visit tomorrow (one message per owner). Off until you switch it on: switch it on once the clinic books in this app.' },
  due_reminder: { icon: Syringe, title: 'Vaccine or Follow-Up Due', when: 'Coming later, with the vaccine and follow-up reminders. You can write it now; nothing is sent yet.', later: true },
}

function Counter({ text }) {
  const info = smsInfo(fillIn(text))
  const warn = info.parts > 1 || info.special.length
  return (
    <span className={`field-hint ${warn ? 'msg-warn' : ''}`}>
      {info.length} / {info.limit} characters with sample details · {info.parts <= 1 ? '1 text' : `${info.parts} texts (costs ${info.parts}×)`}
      {info.special.length > 0 && ` · ${info.special.join(' ')} make${info.special.length > 1 ? '' : 's'} each text 70 characters: use plain letters, PHP instead of ₱, no emoji`}
      {info.parts > 1 && !info.special.length && ' · shorten it to fit one text'}
    </span>
  )
}

function TemplateCard({ template, smsReady, senderName, testTo, onSaved }) {
  const toast = useToast()
  const about = ABOUT[template.key] || { icon: MessageSquareText, title: template.key, when: '' }
  const [d, setD] = useState(template)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const sms = useRef(null)
  const errors = error instanceof ApiError ? error.body.errors || {} : {}
  const keys = ['smsEnabled', 'emailEnabled', 'smsText', 'emailSubject', 'emailIntro']
  const dirty = keys.some((k) => d[k] !== template[k])
  const set = (patch) => setD((x) => ({ ...x, ...patch }))
  function insert(name) {
    const el = sms.current
    const token = `{${name}}`
    const at = el ? el.selectionStart : d.smsText.length
    set({ smsText: d.smsText.slice(0, at) + token + d.smsText.slice(el ? el.selectionEnd : at) })
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(at + token.length, at + token.length) })
  }
  async function save() {
    setBusy('save'); setError(null)
    try { const r = await api(`settings/messages/${template.key}`, { method: 'PATCH', body: d }); toast(`${about.title} saved`); onSaved(r.template) } catch (err) { setError(err) }
    setBusy(null)
  }
  async function test() {
    if (dirty) { toast('Save your changes first, then send a test.'); return }
    setBusy('test'); setError(null)
    try {
      const r = await api(`settings/messages/${template.key}/test`, { method: 'POST', body: testTo })
      toast(`Test ${r.sent.join(' and ')} sent${r.problems.length ? `. ${r.problems.join(' ')}` : ''}`)
    } catch (err) { setError(err) }
    setBusy(null)
  }
  const Icon = about.icon
  return (
    <section className="card card-pad msg-card" aria-labelledby={`msg-${template.key}`}>
      <div className="msg-head">
        <div className="settings-head">
          <span className="settings-icon"><Icon aria-hidden /></span>
          <div><h2 id={`msg-${template.key}`}>{about.title}{about.later && <span className="badge badge-soft" style={{ marginLeft: 8 }}>Coming Later</span>}</h2><p>{about.when}</p></div>
        </div>
        <div className="msg-switches">
          <label className={`check ${!smsReady || about.later ? 'is-disabled' : ''}`} title={!smsReady ? `Texting starts once ${senderName} is approved` : undefined}>
            <input type="checkbox" checked={d.smsEnabled} disabled={!smsReady || about.later} onChange={(e) => set({ smsEnabled: e.target.checked })} /> Text
          </label>
          <label className={`check ${about.later || EMAIL_REQUIRED.includes(template.key) ? 'is-disabled' : ''}`} title={EMAIL_REQUIRED.includes(template.key) ? 'Always emailed: it has the client’s link (and code)' : undefined}>
            <input type="checkbox" checked={d.emailEnabled} disabled={about.later || EMAIL_REQUIRED.includes(template.key)} onChange={(e) => set({ emailEnabled: e.target.checked })} /> Email
          </label>
        </div>
      </div>
      <ErrorNote error={error && !Object.keys(errors).length ? error : null} />
      <div className="msg-cols">
        <div className={d.smsEnabled ? '' : 'msg-off'}>
          <Field label="Text Message" error={errors.smsText}>{(a) => <textarea {...a} ref={sms} rows={4} value={d.smsText} onChange={(e) => set({ smsText: e.target.value })} />}</Field>
          <Counter text={d.smsText} />
          <div className="msg-fillins"><span className="field-hint">Insert:</span>
            {template.fillIns.map((f) => <button key={f} type="button" className="chip-btn msg-chip" title={FILL_IN_HELP[f]} onClick={() => insert(f)}>{`{${f}}`}</button>)}
          </div>
          <span className="field-hint">Preview with sample details</span>
          <div className="msg-bubble">{fillIn(d.smsText)}</div>
        </div>
        <div className={d.emailEnabled ? '' : 'msg-off'}>
          <Field label="Email Subject" error={errors.emailSubject}>{(a) => <input {...a} value={d.emailSubject} onChange={(e) => set({ emailSubject: e.target.value })} maxLength={200} />}</Field>
          <Field label="Email Opening Line" error={errors.emailIntro}>{(a) => <textarea {...a} rows={4} value={d.emailIntro} onChange={(e) => set({ emailIntro: e.target.value })} />}</Field>
          <span className="field-hint">Comes after “Hi Maria,”. The rest of the email (details, buttons, address) stays as designed. Fill-ins work here too.</span>
          <span className="field-hint">Preview: <strong>{fillIn(d.emailSubject)}</strong></span>
        </div>
      </div>
      <div className="inline-row">
        <button type="button" className="btn" onClick={save} disabled={!dirty || !!busy}>{busy === 'save' ? 'Saving…' : 'Save Changes'}</button>
        <button type="button" className="btn btn-quiet" onClick={test} disabled={!!busy || about.later}><Send aria-hidden /> {busy === 'test' ? 'Sending…' : 'Send Test'}</button>
        <button type="button" className="btn btn-quiet" onClick={() => { set(template.defaults); toast('Default wording back. Save to keep it.') }} disabled={!!busy}><RotateCcw aria-hidden /> Reset to Default</button>
        {template.updatedBy && <span className="field-hint">Last changed by {template.updatedBy}</span>}
      </div>
    </section>
  )
}

export default function MessagesSettingsPage() {
  const staff = useStaff()
  const { data, error, setData } = useApi(canManage(staff) ? 'settings/messages' : null)
  const [testTo, setTestTo] = useState({ mobile: '', email: staff.email || '' })
  const head = <PageHead crumbs={[{ label: 'Account' }, { label: 'Settings', to: '/settings' }, { label: 'Messages' }]} title="Messages" intro="Every text and email the clinic sends to clients. Changes apply to new messages straight away." />
  if (!canManage(staff)) return <>{head}<ErrorNote error={new Error('Only an owner or admin can change the clinic’s messages.')} /></>
  return (
    <>
      {head}
      <SettingsTabs />
      <ErrorNote error={error} />
      {!data ? <PawLoader label="Loading the messages…" /> : (
        <div className="stack settings">
          {!data.smsReady && (
            <div className="msg-callout"><MessageSquareText aria-hidden /><div><strong>Texting starts once the sender name {data.senderName} is approved.</strong> Until then the Text switches stay off. You can still write and check the texts here.</div></div>
          )}
          <section className="card card-pad">
            <h2 className="label" style={{ margin: '0 0 8px' }}>Send Tests To</h2>
            <div className="form-row">
              <Field label="Your Mobile" optional>{(a) => <input {...a} type="tel" inputMode="tel" placeholder="0917 123 4567" value={testTo.mobile} onChange={(e) => setTestTo({ ...testTo, mobile: e.target.value })} />}</Field>
              <Field label="Your Email" optional>{(a) => <input {...a} type="email" value={testTo.email} onChange={(e) => setTestTo({ ...testTo, email: e.target.value })} />}</Field>
            </div>
            <span className="field-hint">Send Test uses sample details (Maria, Coco and Max) and only the channels switched on for that message.</span>
          </section>
          {data.templates.map((t) => (
            <TemplateCard key={`${t.key}-${t.updatedAt || ''}`} template={t} smsReady={data.smsReady} senderName={data.senderName} testTo={testTo}
              onSaved={(nt) => setData({ ...data, templates: data.templates.map((x) => (x.key === nt.key ? nt : x)) })} />
          ))}
        </div>
      )}
    </>
  )
}
