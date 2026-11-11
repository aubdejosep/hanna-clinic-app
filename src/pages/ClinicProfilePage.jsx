// Clinic operations → Clinic profile, laid out like the old system's page:
// header, then two tabs. Basic Information: Business Information, Social Media, Branches,
// Invoice Settings, Notification Settings, Kiosk QR Code. Business Availability: opening hours.
// Each card shows its fields greyed out until "Edit Info" is clicked.
import { useEffect, useState } from 'react'
import { Bell, Building2, CalendarOff, Clock, Gauge, Download, ExternalLink, FileText, Info, Mail, MapPin, Pencil, Phone, Plus, QrCode, Receipt, Store, Trash2, Type } from 'lucide-react'
import QRCode from 'qrcode'
import { ErrorNote, Field, PageHead, useToast, PawLoader } from '../components/ui.jsx'
import { prettyDay } from '../lib/format.js'
import { prettyTime } from '../lib/appointments.js'
import { FacebookIcon, InstagramIcon, TikTokIcon, ViberIcon, WhatsAppIcon, XIcon } from '../components/BrandIcons.jsx'
import { api, ApiError } from '../lib/api.js'
import { useApi } from '../lib/useApi.js'
import { canManage, useStaff } from '../lib/staff.js'
import { DAY_KEYS, DAY_NAMES } from '../lib/schedule.js'

// ---------- Small pieces that look like the old page ----------
function IconInput({ icon: Icon, value, onChange, disabled, max, multiline, placeholder, label, type = 'text', prefix, suffix }) {
  const Tag = multiline ? 'textarea' : 'input'
  return (
    <div className={`icon-input ${multiline ? 'multi' : ''} ${disabled ? 'is-disabled' : ''}`}>
      {prefix && <span className="icon-input-prefix">{prefix}</span>}
      {Icon && <Icon aria-hidden />}
      <Tag type={multiline ? undefined : type} value={value ?? ''} onChange={(e) => onChange?.(e.target.value)} disabled={disabled} maxLength={max}
        placeholder={placeholder} aria-label={label} rows={multiline ? 3 : undefined} />
      {max && <span className="counter">{String(value ?? '').length}/{max}</span>}
      {suffix && <span className="icon-input-suffix">{suffix}</span>}
    </div>
  )
}

function Labeled({ label, optional, error, hint, children }) {
  return (
    <div className="field">
      <span>{label}{optional && <small> (optional)</small>}</span>
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  )
}

function Switch({ checked, onChange, disabled, label }) {
  return (
    <label className={`switch ${disabled ? 'is-disabled' : ''}`}>
      <input type="checkbox" role="switch" checked={!!checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} aria-label={label} />
      <span aria-hidden />
    </label>
  )
}

// A settings card with "Edit Info": fields are disabled until editing; Save / Cancel at the bottom.
function SettingsCard({ icon: Icon, title, sub, canEdit, initial, onSave, children, action }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  useEffect(() => { if (!editing) setValue(initial) }, [initial, editing])
  const errors = error instanceof ApiError ? error.body.errors || {} : {}
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
    <section className="card settings-card">
      <div className="settings-head">
        <Icon aria-hidden />
        <div className="settings-title"><h2>{title}</h2>{sub && <p>{sub}</p>}</div>
        {action}
        {canEdit && onSave && !editing && <button type="button" className="btn btn-dark" onClick={() => { setError(null); setEditing(true) }}><Pencil aria-hidden /> Edit Info</button>}
      </div>
      <div className="settings-body">
        <ErrorNote error={error && !Object.keys(errors).length ? error : null} />
        {children(value, (patch) => setValue((v) => ({ ...v, ...patch })), !editing, errors)}
        {editing && (
          <div className="panel-actions">
            <button type="button" className="btn btn-quiet" onClick={() => setEditing(false)} disabled={busy}>Cancel</button>
            <button type="button" className="btn" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save Changes'}</button>
          </div>
        )}
      </div>
    </section>
  )
}

// WCAG contrast of white text on a colour (the old page shows this under Email Brand Colour).
function contrastWithWhite(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '')
  if (!m) return null
  const lum = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  const L = 0.2126 * lum[0] + 0.7152 * lum[1] + 0.0722 * lum[2]
  return 1.05 / (L + 0.05)
}

const SOCIAL = [
  { key: 'facebook', label: 'Facebook', icon: FacebookIcon, placeholder: 'Enter your Facebook URL' },
  { key: 'x', label: 'Twitter', icon: XIcon, placeholder: 'Enter your Twitter URL' },
  { key: 'instagram', label: 'Instagram', icon: InstagramIcon, placeholder: 'Enter your Instagram URL' },
  { key: 'tiktok', label: 'Tiktok', icon: TikTokIcon, placeholder: 'Enter your TikTok URL' },
  { key: 'viber', label: 'Viber', icon: ViberIcon, placeholder: 'Enter contact number', phone: true },
  { key: 'whatsapp', label: 'Whatsapp', icon: WhatsAppIcon, placeholder: 'Enter contact number', phone: true },
]

function KioskCard({ c, canEdit, save }) {
  const url = `${window.location.origin}/kiosk`
  const [src, setSrc] = useState(null)
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(c.kioskAgreement || '')
  const [busy, setBusy] = useState(false)
  useEffect(() => { QRCode.toDataURL(url, { width: 640, margin: 2, color: { dark: '#132A6E', light: '#FFFFFF' } }).then(setSrc) }, [url])
  async function run(body) {
    setBusy(true)
    try { await save('Kiosk Agreement')(body); setEditing(false) } finally { setBusy(false) }
  }
  return (
    <section className="card settings-card">
      <div className="settings-head">
        <QrCode aria-hidden />
        <div className="settings-title"><h2>Kiosk QR Code</h2><p>Display this QR code at your clinic for walk-in registrations</p></div>
      </div>
      <div className="settings-body">
        <div className="qr-frame">{src ? <img src={src} alt={`QR code for ${url}`} width="150" height="150" /> : <span className="skeleton" style={{ width: 150, height: 150 }} />}</div>
        <div className="kiosk-url"><span className="label">Kiosk URL</span><a href={url} target="_blank" rel="noreferrer">{url} <ExternalLink size={14} aria-hidden /></a></div>
        <a className="btn btn-block" href={src || undefined} download="hanna-kiosk-qr.png"><Download aria-hidden /> Download QR Code</a>
        <hr className="divider" />
        <div className="agreement-head">
          <div><strong>Kiosk Agreement</strong><span className="cell-sub">Required at the end of public kiosk registration</span></div>
          <div className="agreement-tools">
            <Switch checked={c.kioskAgreementEnabled} onChange={(v) => run({ kioskAgreementEnabled: v })} disabled={!canEdit || busy} label="Kiosk Agreement Enabled" />
            <span className="field-hint">{c.kioskAgreementEnabled ? 'Enabled' : 'Off'}</span>
            {canEdit && !editing && <button type="button" className="icon-btn" onClick={() => { setText(c.kioskAgreement || ''); setEditing(true) }} aria-label="Edit Agreement" title="Edit Agreement"><Pencil /></button>}
          </div>
        </div>
        {editing ? (
          <div className="stack" style={{ gap: 10 }}>
            <IconInput multiline value={text} onChange={setText} max={3000} label="Agreement Text" placeholder="e.g. a privacy notice clients agree to" />
            <div className="panel-actions">
              <button type="button" className="btn btn-quiet" onClick={() => setEditing(false)} disabled={busy}>Cancel</button>
              <button type="button" className="btn" onClick={() => run({ kioskAgreement: text })} disabled={busy}>{busy ? 'Saving…' : 'Save Agreement'}</button>
            </div>
          </div>
        ) : (
          <div className="agreement-box">{c.kioskAgreement || <em>No agreement text set. Click the edit button to add an agreement that will be shown to customers during public kiosk registration.</em>}</div>
        )}
      </div>
    </section>
  )
}

function HoursCard({ c, canEdit, save }) {
  return (
    <SettingsCard icon={Clock} title="Business Availability" sub="Set the clinic’s opening hours for each day" canEdit={canEdit}
      initial={{ hours: c.hours }} onSave={save('Opening Hours')}>
      {(v, set, disabled, errors) => {
        const setDay = (day, next) => set({ hours: { ...v.hours, [day]: next } })
        return (
          <div className="stack" style={{ gap: 10 }}>
            {errors.hours && <span className="field-error">{errors.hours}</span>}
            {DAY_KEYS.map((day) => {
              const d = v.hours[day]
              const open = !!d
              return (
                <div className="day-card" key={day}>
                  <strong className="day-name">{DAY_NAMES[day]}</strong>
                  <div className="stack" style={{ gap: 6 }}>
                    {open ? (
                      <>
                        <div className="time-pair">
                          <span className="field-hint">From</span>
                          <input type="time" value={d.open} disabled={disabled} onChange={(e) => setDay(day, { ...d, open: e.target.value })} aria-label={`${DAY_NAMES[day]} opens`} />
                          <span className="field-hint">to</span>
                          <input type="time" value={d.close} disabled={disabled} onChange={(e) => setDay(day, { ...d, close: e.target.value })} aria-label={`${DAY_NAMES[day]} closes`} />
                        </div>
                        {d.breaks.map((b, i) => (
                          <div className="time-pair" key={i}>
                            <span className="field-hint">Break</span>
                            <input type="time" value={b.start} disabled={disabled} onChange={(e) => setDay(day, { ...d, breaks: d.breaks.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)) })} aria-label="Break Starts" />
                            <span className="field-hint">to</span>
                            <input type="time" value={b.end} disabled={disabled} onChange={(e) => setDay(day, { ...d, breaks: d.breaks.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)) })} aria-label="Break Ends" />
                            {!disabled && <button type="button" className="icon-btn" onClick={() => setDay(day, { ...d, breaks: d.breaks.filter((_, j) => j !== i) })} aria-label="Remove Break" title="Remove Break"><Trash2 /></button>}
                          </div>
                        ))}
                        {!disabled && d.breaks.length < 3 && <button type="button" className="text-btn" onClick={() => setDay(day, { ...d, breaks: [...d.breaks, { start: '12:00', end: '13:00' }] })}><Plus size={14} aria-hidden /> Add Break</button>}
                      </>
                    ) : <span className="field-hint">Closed all day</span>}
                  </div>
                  <div className="day-state">
                    <span className={`badge ${open ? '' : 'badge-soft'}`}>{open ? 'Open' : 'Closed'}</span>
                    <Switch checked={open} disabled={disabled} label={`${DAY_NAMES[day]} open`}
                      onChange={(v2) => setDay(day, v2 ? { open: '09:00', close: '19:00', breaks: [] } : null)} />
                  </div>
                </div>
              )
            })}
          </div>
        )
      }}
    </SettingsCard>
  )
}

// Holidays, closures and half days. The website's /book greys out closed days and uses special hours.
function ClosedDatesCard({ c, canEdit, setData, toast }) {
  const [adding, setAdding] = useState(false)
  const [v, setV] = useState({ day: '', kind: 'closed', open: '09:00', close: '12:00', reason: '' })
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const errors = error instanceof ApiError ? error.body.errors || {} : {}
  async function add() {
    setBusy('add')
    setError(null)
    try {
      const res = await api('clinic/closed-dates', { method: 'POST', body: { day: v.day, reason: v.reason, ...(v.kind === 'special' ? { open: v.open, close: v.close } : {}) } })
      setData(res)
      toast(`${prettyDay(v.day)} added`)
      setAdding(false)
      setV({ day: '', kind: 'closed', open: '09:00', close: '12:00', reason: '' })
    } catch (err) {
      setError(err)
    } finally {
      setBusy(null)
    }
  }
  async function remove(d) {
    if (!window.confirm(`Remove ${prettyDay(d.day)} (${d.reason})? Clients will be able to book that day again.`)) return
    setBusy(d.id)
    try {
      setData(await api(`clinic/closed-dates/${d.id}`, { method: 'DELETE' }))
      toast(`${prettyDay(d.day)} removed`)
    } catch (err) {
      toast(err.message)
    } finally {
      setBusy(null)
    }
  }
  return (
    <section className="card settings-card">
      <div className="settings-head">
        <CalendarOff aria-hidden />
        <div className="settings-title"><h2>Closed Dates</h2><p>Holidays, closures and special hours. Clients can’t book closed days online.</p></div>
        {canEdit && !adding && <button type="button" className="btn btn-dark" onClick={() => setAdding(true)}><Plus aria-hidden /> Add Date</button>}
      </div>
      <div className="settings-body stack" style={{ gap: 12 }}>
        {adding && (
          <div className="form-section">
            {error && !Object.keys(errors).length && <ErrorNote error={error} />}
            <div className="form-row">
              <Field label="Date" error={errors.day}>{(a) => <input {...a} type="date" value={v.day} min={new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)} onChange={(e) => setV({ ...v, day: e.target.value })} />}</Field>
              <Field label="Reason" error={errors.reason} hint="Clients see this, e.g. Christmas Day.">{(a) => <input {...a} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} maxLength={80} />}</Field>
            </div>
            <div className="seg" role="radiogroup" aria-label="That day">
              {[['closed', 'Closed All Day'], ['special', 'Special Hours']].map(([k, l]) => (
                <label key={k}><input type="radio" name="cd-kind" checked={v.kind === k} onChange={() => setV({ ...v, kind: k })} /><span>{l}</span></label>
              ))}
            </div>
            {v.kind === 'special' && (
              <div className="time-pair">
                <span className="field-hint">From</span>
                <input type="time" value={v.open} onChange={(e) => setV({ ...v, open: e.target.value })} aria-label="Opens" />
                <span className="field-hint">to</span>
                <input type="time" value={v.close} onChange={(e) => setV({ ...v, close: e.target.value })} aria-label="Closes" />
              </div>
            )}
            {errors.hours && <span className="field-error">{errors.hours}</span>}
            <div className="panel-actions">
              <button type="button" className="btn btn-quiet" onClick={() => { setAdding(false); setError(null) }} disabled={busy === 'add'}>Cancel</button>
              <button type="button" className="btn" onClick={add} disabled={busy === 'add'}>{busy === 'add' ? 'Saving…' : 'Add Date'}</button>
            </div>
          </div>
        )}
        {c.closedDates.length ? (
          <ul className="closed-list">
            {c.closedDates.map((d) => (
              <li key={d.id}>
                <span><strong>{prettyDay(d.day)}</strong> <span className="cell-sub">{d.reason}</span></span>
                <span className={`badge ${d.open ? '' : 'badge-soft'}`}>{d.open ? `Open ${prettyTime(d.open)} – ${prettyTime(d.close)}` : 'Closed All Day'}</span>
                {canEdit && <button type="button" className="icon-btn" onClick={() => remove(d)} disabled={busy === d.id} aria-label={`Remove ${prettyDay(d.day)}`} title="Remove"><Trash2 /></button>}
              </li>
            ))}
          </ul>
        ) : !adding && <p className="muted" style={{ margin: 0 }}>No upcoming closed dates. Add holidays here so clients can’t book them online.</p>}
      </div>
    </section>
  )
}

// The most pets clients can book online (the website counts its own bookings against these).
function LimitsCard({ c, canEdit, save }) {
  const l = c.onlineLimits || {}
  return (
    <SettingsCard icon={Gauge} title="Online Booking Limits" sub="The most pets clients can book on the website. Leave blank for no limit." canEdit={canEdit}
      initial={{ onlineLimits: { day: l.day ?? '', morning: l.morning ?? '', afternoon: l.afternoon ?? '' } }} onSave={save('Online Booking Limits')}>
      {(v, set, disabled, errors) => {
        const setK = (k, val) => set({ onlineLimits: { ...v.onlineLimits, [k]: val.replace(/[^\d]/g, '') } })
        return (
          <div className="stack" style={{ gap: 10 }}>
            {errors.onlineLimits && <span className="field-error">{errors.onlineLimits}</span>}
            <div className="form-row limits-row">
              {[['day', 'Pets per Day'], ['morning', 'Morning'], ['afternoon', 'Afternoon']].map(([k, label]) => (
                <Field key={k} label={label} hint={k === 'day' ? 'Counts every online booking that day.' : k === 'morning' ? 'Opening to 12 NN.' : '1 PM to closing.'}>
                  {(a) => <input {...a} value={v.onlineLimits[k]} onChange={(e) => setK(k, e.target.value)} disabled={disabled} inputMode="numeric" maxLength={3} placeholder="No limit" />}
                </Field>
              ))}
            </div>
            <p className="field-hint" style={{ margin: 0 }}>Bookings made by staff in the app don’t count. A full day or window shows as fully booked on the website.</p>
          </div>
        )
      }}
    </SettingsCard>
  )
}

export default function ClinicProfilePage() {
  const me = useStaff()
  const toast = useToast()
  const { data, error, setData } = useApi('clinic')
  const [tab, setTab] = useState('basic')
  const c = data?.clinic
  const canEdit = canManage(me)
  const save = (label) => async (body) => {
    const res = await api('clinic', { method: 'PATCH', body })
    setData(res)
    toast(`${label} saved`)
  }
  const crumbs = [{ label: 'Clinic Operations' }, { label: 'Clinic Profile' }]

  if (error) return <><PageHead crumbs={crumbs} title="Clinic Profile" /><ErrorNote error={error} /></>
  if (!c) return <><PageHead crumbs={crumbs} title=" " /><PawLoader label="Loading the clinic profile…" /></>

  return (
    <div className="profile-page">
      <nav className="crumbs" aria-label="Breadcrumb"><span>Clinic Operations</span> › <span aria-current="page">Clinic Profile</span></nav>
      <header className="clinic-header">
        <img src="/brand/logo-192.png" alt="" width="64" height="64" />
        <div><h1>{c.name}</h1><p>{c.tagline}</p></div>
      </header>

      <div className="profile-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'basic'} onClick={() => setTab('basic')}><Info aria-hidden /> Basic Information</button>
        <button type="button" role="tab" aria-selected={tab === 'hours'} onClick={() => setTab('hours')}><Clock aria-hidden /> Business Availability</button>
      </div>

      {tab === 'hours' ? (
        <div className="stack">
          <HoursCard c={c} canEdit={canEdit} save={save} />
          <ClosedDatesCard c={c} canEdit={canEdit} setData={setData} toast={toast} />
          <LimitsCard c={c} canEdit={canEdit} save={save} />
        </div>
      ) : (
        <div className="stack">
          <SettingsCard icon={Info} title="Business Information" sub="Manage your business’s information" canEdit={canEdit}
            initial={{ name: c.name, tagline: c.tagline || '', phone1: c.phones[0] || '', phone2: c.phones[1] || '', email: c.email || '', address: c.address || '', about: c.about || '', emailBrandColor: c.emailBrandColor }}
            onSave={(v) => save('Business Information')({ name: v.name, tagline: v.tagline, phones: [v.phone1, v.phone2], email: v.email, address: v.address, about: v.about, emailBrandColor: v.emailBrandColor })}>
            {(v, set, disabled, errors) => {
              const ratio = contrastWithWhite(v.emailBrandColor)
              return (
                <>
                  <div className="form-row">
                    <Labeled label="Business Name" error={errors.name}><IconInput icon={Building2} value={v.name} onChange={(x) => set({ name: x })} disabled={disabled} max={50} label="Business Name" /></Labeled>
                    <Labeled label="Business Tagline"><IconInput icon={Type} value={v.tagline} onChange={(x) => set({ tagline: x })} disabled={disabled} max={100} label="Business Tagline" /></Labeled>
                  </div>
                  <div className="form-row">
                    <Labeled label="Phone Number"><IconInput icon={Phone} value={v.phone1} onChange={(x) => set({ phone1: x })} disabled={disabled} label="Phone Number" /></Labeled>
                    <Labeled label="Secondary Phone" optional><IconInput icon={Phone} value={v.phone2} onChange={(x) => set({ phone2: x })} disabled={disabled} placeholder="Enter secondary phone number" label="Secondary Phone" /></Labeled>
                  </div>
                  <div className="form-row">
                    <Labeled label="Email Address" error={errors.email}><IconInput icon={Mail} type="email" value={v.email} onChange={(x) => set({ email: x })} disabled={disabled} max={50} label="Email Address" /></Labeled>
                  </div>
                  <Labeled label="Address" error={errors.address}><IconInput icon={MapPin} multiline value={v.address} onChange={(x) => set({ address: x })} disabled={disabled} max={150} label="Address" /></Labeled>
                  <Labeled label="About the Business"><IconInput icon={FileText} multiline value={v.about} onChange={(x) => set({ about: x })} disabled={disabled} max={150} label="About the Business" /></Labeled>
                  <Labeled label="Email Brand Colour" hint="Accent used in outgoing email headers and headings." error={errors.emailBrandColor}>
                    <div className="brand-colour">
                      <input type="color" value={v.emailBrandColor} onChange={(e) => set({ emailBrandColor: e.target.value.toUpperCase() })} disabled={disabled} aria-label="Pick Colour" />
                      <IconInput value={v.emailBrandColor} onChange={(x) => set({ emailBrandColor: x })} disabled={disabled} label="Colour Code" />
                      <span className="colour-preview" style={{ background: v.emailBrandColor }}>White Text Preview</span>
                      {ratio && <span className="field-hint">{ratio.toFixed(2)}:1 contrast (min 4.5:1){ratio < 4.5 ? '. Pick a darker colour so white text is easy to read.' : ''}</span>}
                    </div>
                  </Labeled>
                </>
              )
            }}
          </SettingsCard>

          <SettingsCard icon={Store} title="Social Media" sub="Connect your clinic’s social media accounts" canEdit={canEdit}
            initial={{ social: { ...c.social }, on: Object.fromEntries(SOCIAL.map((s) => [s.key, !!c.social[s.key]])) }}
            onSave={(v) => save('Social Media')({ social: { ...Object.fromEntries(SOCIAL.map((s) => [s.key, v.on[s.key] ? v.social[s.key] || '' : ''])), messenger: c.social.messenger || '' } })}>
            {(v, set, disabled) => (
              <div className="social-grid">
                {SOCIAL.map((s) => (
                  <div className="social-row" key={s.key}>
                    <label className="check social-name">
                      <input type="checkbox" checked={!!v.on[s.key]} disabled={disabled} onChange={(e) => set({ on: { ...v.on, [s.key]: e.target.checked } })} />
                      <s.icon /><span>{s.label}</span>
                    </label>
                    <IconInput value={v.social[s.key]} onChange={(x) => set({ social: { ...v.social, [s.key]: x } })} disabled={disabled || !v.on[s.key]}
                      placeholder={s.placeholder} label={`${s.label} ${s.phone ? 'number' : 'link'}`} prefix={s.phone ? 'PH +63' : null} />
                  </div>
                ))}
              </div>
            )}
          </SettingsCard>

          <section className="card settings-card">
            <div className="settings-head">
              <Building2 aria-hidden />
              <div className="settings-title"><h2>Branches</h2><p>1 branch registered</p></div>
            </div>
            <div className="settings-body">
              <div className="branch-row">
                <div><strong>{c.name}</strong> <span className="badge badge-soft">Main</span></div>
                <span className="cell-sub"><MapPin size={13} aria-hidden /> {c.address}</span>
              </div>
            </div>
          </section>

          <SettingsCard icon={Receipt} title="Invoice Settings" sub="Configure tax rates and other invoice-related settings" canEdit={canEdit}
            initial={{ taxRate: String(c.taxRate) }} onSave={(v) => save('Invoice Settings')({ taxRate: v.taxRate })}>
            {(v, set, disabled, errors) => (
              <Labeled label="Tax Rate (%)" hint="This tax rate will be applied to all invoices by default." error={errors.taxRate}>
                <IconInput value={v.taxRate} onChange={(x) => set({ taxRate: x })} disabled={disabled} label="Tax Rate" suffix="%" />
              </Labeled>
            )}
          </SettingsCard>

          <SettingsCard icon={Bell} title="Notification Settings" sub="Configure how your business receives email notifications" canEdit={canEdit}
            initial={{ ccBusinessEmail: c.ccBusinessEmail }} onSave={(v) => save('Notification Settings')({ ccBusinessEmail: v.ccBusinessEmail })}>
            {(v, set, disabled) => (
              <div className="setting-line">
                <Mail aria-hidden />
                <div><strong>CC Business Email on All Notifications</strong><span className="cell-sub">When on, the business email gets a copy of every email the app sends (appointments, invoices, certificates and so on).</span></div>
                <Switch checked={v.ccBusinessEmail} onChange={(x) => set({ ccBusinessEmail: x })} disabled={disabled} label="CC Business Email on All Notifications" />
              </div>
            )}
          </SettingsCard>

          <KioskCard c={c} canEdit={canEdit} save={save} />
        </div>
      )}
    </div>
  )
}
