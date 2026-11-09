// Clinic operations → Clinic profile: business details, opening hours, social media and the
// kiosk QR code. Each card has its own Edit button, like the old Clinic Profile page.
import { useEffect, useState } from 'react'
import { Building2, Clock, Download, ExternalLink, Globe, Pencil, Plus, QrCode, Trash2 } from 'lucide-react'
import QRCode from 'qrcode'
import { ErrorNote, Field, PageHead, useToast } from '../components/ui.jsx'
import { api, ApiError } from '../lib/api.js'
import { useApi } from '../lib/useApi.js'
import { canManage, useStaff } from '../lib/staff.js'
import { DAY_KEYS, DAY_NAMES, prettyTime } from '../lib/schedule.js'
import { prettyDay } from '../lib/format.js'

const SOCIAL = [
  ['facebook', 'Facebook', 'https://www.facebook.com/…'],
  ['messenger', 'Messenger', 'https://m.me/…'],
  ['instagram', 'Instagram', 'https://www.instagram.com/…'],
  ['tiktok', 'TikTok', 'https://www.tiktok.com/@…'],
  ['x', 'X (Twitter)', 'https://x.com/…'],
  ['viber', 'Viber', '0916 415 8426'],
  ['whatsapp', 'WhatsApp', '0917 123 4567'],
]

// A card that shows values, and swaps to a form when Edit is clicked.
function EditCard({ icon: Icon, title, intro, canEdit, view, form, initial, onSave }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const errors = error instanceof ApiError ? error.body.errors || {} : {}
  const start = () => { setValue(initial); setError(null); setEditing(true) }
  async function save() {
    setBusy(true)
    setError(null)
    try {
      await onSave(value)
      setEditing(false)
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="card">
      <div className="card-head">
        <div className="cell-main">
          <span className="avatar" aria-hidden><Icon /></span>
          <div><h2>{title}</h2>{intro && <p>{intro}</p>}</div>
        </div>
        {canEdit && !editing && <button type="button" className="btn btn-quiet" onClick={start}><Pencil aria-hidden /> Edit</button>}
      </div>
      <div className="card-pad">
        {editing ? (
          <div className="stack">
            <ErrorNote error={error && !Object.keys(errors).length ? error : null} />
            {form(value, (patch) => setValue((v) => ({ ...v, ...patch })), errors)}
            <div className="panel-actions">
              <button type="button" className="btn btn-quiet" onClick={() => setEditing(false)} disabled={busy}>Cancel</button>
              <button type="button" className="btn" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
            </div>
          </div>
        ) : view}
      </div>
    </section>
  )
}

function Fact({ label, children }) {
  return <div className="fact"><span className="label">{label}</span><span className="fact-value" style={{ whiteSpace: 'pre-line' }}>{children || '—'}</span></div>
}

function hoursLine(d) {
  if (!d) return 'Closed'
  const breaks = d.breaks?.length ? ` · break ${d.breaks.map((b) => `${prettyTime(b.start)}–${prettyTime(b.end)}`).join(', ')}` : ''
  return `${prettyTime(d.open)} – ${prettyTime(d.close)}${breaks}`
}

function KioskQr({ url }) {
  const [src, setSrc] = useState(null)
  useEffect(() => { QRCode.toDataURL(url, { width: 640, margin: 2, color: { dark: '#132A6E', light: '#FFFFFF' } }).then(setSrc) }, [url])
  return (
    <div className="kiosk-qr">
      {src ? <img src={src} alt={`QR code for ${url}`} width="200" height="200" /> : <span className="skeleton" style={{ width: 200, height: 200 }} />}
      <div className="stack" style={{ gap: 10 }}>
        <div className="fact"><span className="label">Kiosk address</span><a className="fact-value" href={url} target="_blank" rel="noreferrer">{url} <ExternalLink size={14} aria-hidden /></a></div>
        <a className="btn" href={src || undefined} download="hanna-kiosk-qr.png" aria-disabled={!src}><Download aria-hidden /> Download QR code</a>
        <p className="field-hint" style={{ margin: 0 }}>Print it and place it at the front desk. Clients scan it to register themselves and their pets.</p>
      </div>
    </div>
  )
}

export default function ClinicProfilePage() {
  const me = useStaff()
  const toast = useToast()
  const { data, error, setData } = useApi('clinic')
  const c = data?.clinic
  const canEdit = canManage(me)
  const save = (label) => async (body) => {
    const res = await api('clinic', { method: 'PATCH', body })
    setData(res)
    toast(`${label} saved`)
  }

  if (error) return <><PageHead title="Clinic profile" /><ErrorNote error={error} /></>
  if (!c) return <PageHead crumbs={[{ label: 'Clinic operations' }, { label: 'Clinic profile' }]} title=" " />
  const kioskUrl = `${window.location.origin}/kiosk`

  return (
    <>
      <PageHead crumbs={[{ label: 'Clinic operations' }, { label: 'Clinic profile' }]} title="Clinic profile"
        intro={c.updatedAt ? `Last changed ${prettyDay(c.updatedAt.slice(0, 10))}${c.updatedBy ? ` by ${c.updatedBy}` : ''}` : 'The clinic’s details, opening hours and kiosk sign-up.'} />

      <div className="stack">
        <EditCard
          icon={Building2} title="Business information" intro="Used on printouts, emails and the kiosk." canEdit={canEdit}
          initial={{ name: c.name, descriptor: c.descriptor || '', tagline: c.tagline || '', phones: c.phones.length ? c.phones : [''], email: c.email || '', website: c.website || '', address: c.address || '', about: c.about || '' }}
          onSave={save('Business information')}
          view={(
            <div className="facts" style={{ padding: 0 }}>
              <Fact label="Business name">{c.name}</Fact>
              <Fact label="Descriptor">{c.descriptor}</Fact>
              <Fact label="Tagline">{c.tagline}</Fact>
              <Fact label="Phone numbers">{c.phones.join('\n')}</Fact>
              <Fact label="Email">{c.email}</Fact>
              <Fact label="Website">{c.website}</Fact>
              <Fact label="Address">{c.address}</Fact>
              <Fact label="About the business">{c.about}</Fact>
            </div>
          )}
          form={(v, set, errors) => (
            <>
              <div className="form-row">
                <Field label="Business name" error={errors.name}>{(a) => <input {...a} value={v.name} onChange={(e) => set({ name: e.target.value })} maxLength={80} />}</Field>
                <Field label="Descriptor" optional>{(a) => <input {...a} value={v.descriptor} onChange={(e) => set({ descriptor: e.target.value })} maxLength={80} />}</Field>
              </div>
              <Field label="Tagline" optional>{(a) => <input {...a} value={v.tagline} onChange={(e) => set({ tagline: e.target.value })} maxLength={120} />}</Field>
              <div className="field">
                <span>Phone numbers</span>
                {v.phones.map((p, i) => (
                  <div className="inline-row" key={i}>
                    <input value={p} onChange={(e) => set({ phones: v.phones.map((x, j) => (j === i ? e.target.value : x)) })} aria-label={`Phone ${i + 1}`} maxLength={30} />
                    {v.phones.length > 1 && <button type="button" className="icon-btn" onClick={() => set({ phones: v.phones.filter((_, j) => j !== i) })} aria-label={`Remove phone ${i + 1}`} title="Remove"><Trash2 /></button>}
                  </div>
                ))}
                {v.phones.length < 5 && <button type="button" className="btn btn-quiet" style={{ justifySelf: 'start' }} onClick={() => set({ phones: [...v.phones, ''] })}><Plus aria-hidden /> Add a number</button>}
              </div>
              <div className="form-row">
                <Field label="Email" optional error={errors.email}>{(a) => <input {...a} type="email" value={v.email} onChange={(e) => set({ email: e.target.value })} />}</Field>
                <Field label="Website" optional>{(a) => <input {...a} value={v.website} onChange={(e) => set({ website: e.target.value })} />}</Field>
              </div>
              <Field label="Address" error={errors.address}>{(a) => <textarea {...a} value={v.address} onChange={(e) => set({ address: e.target.value })} rows={2} maxLength={300} />}</Field>
              <Field label="About the business" optional>{(a) => <textarea {...a} value={v.about} onChange={(e) => set({ about: e.target.value })} rows={3} maxLength={500} />}</Field>
            </>
          )}
        />

        <EditCard
          icon={Clock} title="Opening hours" intro="Used for booking times and the dashboard." canEdit={canEdit}
          initial={{ hours: c.hours }}
          onSave={save('Opening hours')}
          view={(
            <ul className="hours-list">
              {DAY_KEYS.map((d) => <li key={d}><strong>{DAY_NAMES[d]}</strong><span>{hoursLine(c.hours[d])}</span></li>)}
            </ul>
          )}
          form={(v, set, errors) => {
            const setDay = (day, next) => set({ hours: { ...v.hours, [day]: next } })
            return (
              <>
                {errors.hours && <span className="field-error">{errors.hours}</span>}
                {DAY_KEYS.map((day) => {
                  const d = v.hours[day]
                  return (
                    <div className="hours-row" key={day}>
                      <label className="check">
                        <input type="checkbox" checked={!!d} onChange={(e) => setDay(day, e.target.checked ? { open: '09:00', close: '19:00', breaks: [] } : null)} />
                        <span><strong>{DAY_NAMES[day]}</strong></span>
                      </label>
                      {d ? (
                        <div className="stack" style={{ gap: 6 }}>
                          <div className="time-pair">
                            <input type="time" value={d.open} onChange={(e) => setDay(day, { ...d, open: e.target.value })} aria-label={`${DAY_NAMES[day]} opens`} />
                            <span className="field-hint">to</span>
                            <input type="time" value={d.close} onChange={(e) => setDay(day, { ...d, close: e.target.value })} aria-label={`${DAY_NAMES[day]} closes`} />
                          </div>
                          {d.breaks.map((b, i) => (
                            <div className="time-pair" key={i}>
                              <span className="field-hint">Break</span>
                              <input type="time" value={b.start} onChange={(e) => setDay(day, { ...d, breaks: d.breaks.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)) })} aria-label="Break starts" />
                              <span className="field-hint">to</span>
                              <input type="time" value={b.end} onChange={(e) => setDay(day, { ...d, breaks: d.breaks.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)) })} aria-label="Break ends" />
                              <button type="button" className="icon-btn" onClick={() => setDay(day, { ...d, breaks: d.breaks.filter((_, j) => j !== i) })} aria-label="Remove break" title="Remove break"><Trash2 /></button>
                            </div>
                          ))}
                          {d.breaks.length < 3 && <button type="button" className="text-btn" onClick={() => setDay(day, { ...d, breaks: [...d.breaks, { start: '12:00', end: '13:00' }] })}><Plus size={14} aria-hidden /> Add break</button>}
                        </div>
                      ) : <span className="field-hint">Closed</span>}
                    </div>
                  )
                })}
              </>
            )
          }}
        />

        <EditCard
          icon={Globe} title="Social media" intro="The clinic’s accounts, for printouts and emails." canEdit={canEdit}
          initial={{ social: { ...c.social } }}
          onSave={save('Social media')}
          view={(
            <div className="facts" style={{ padding: 0 }}>
              {SOCIAL.map(([k, label]) => <Fact key={k} label={label}>{c.social[k]}</Fact>)}
            </div>
          )}
          form={(v, set) => (
            <div className="form-row">
              {SOCIAL.map(([k, label, hint]) => (
                <Field key={k} label={label} optional>
                  {(a) => <input {...a} value={v.social[k] || ''} placeholder={hint} onChange={(e) => set({ social: { ...v.social, [k]: e.target.value } })} />}
                </Field>
              ))}
            </div>
          )}
        />

        <EditCard
          icon={QrCode} title="Kiosk QR code" intro="Clients scan this at the clinic to register themselves and their pets." canEdit={canEdit}
          initial={{ kioskEnabled: c.kioskEnabled, kioskAgreement: c.kioskAgreement || '' }}
          onSave={save('Kiosk settings')}
          view={(
            <div className="stack">
              {c.kioskEnabled ? <KioskQr url={kioskUrl} /> : <p style={{ margin: 0 }}><span className="badge badge-soft">Switched off</span> The kiosk page shows “ask the front desk” instead of the form.</p>}
              <Fact label="Agreement shown at the end of sign-up">{c.kioskAgreement || 'None. Click Edit to add one (e.g. a privacy notice).'}</Fact>
            </div>
          )}
          form={(v, set) => (
            <>
              <label className="check">
                <input type="checkbox" checked={v.kioskEnabled} onChange={(e) => set({ kioskEnabled: e.target.checked })} />
                <span><strong>Kiosk sign-up is on</strong><br />Untick to close the form; the QR code then shows “please ask the front desk”.</span>
              </label>
              <Field label="Agreement" optional hint="Clients must tick “I agree” to this before registering. Leave empty for none.">
                {(a) => <textarea {...a} value={v.kioskAgreement} onChange={(e) => set({ kioskAgreement: e.target.value })} rows={5} maxLength={3000} />}
              </Field>
            </>
          )}
        />
      </div>
    </>
  )
}
