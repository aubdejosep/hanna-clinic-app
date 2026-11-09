// Clinic operations → Clinic profile, laid out like the old system's page:
// header, then two tabs. Basic Information: Business Information, Social Media, Branches,
// Invoice Settings, Notification Settings, Kiosk QR Code. Business Availability: opening hours.
// Each card shows its fields greyed out until "Edit info" is clicked.
import { useEffect, useState } from 'react'
import { Bell, Building2, Clock, Download, ExternalLink, FileText, Info, Mail, MapPin, Pencil, Phone, Plus, QrCode, Receipt, Store, Trash2, Type } from 'lucide-react'
import QRCode from 'qrcode'
import { ErrorNote, PageHead, useToast } from '../components/ui.jsx'
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

// A settings card with "Edit info": fields are disabled until editing; Save / Cancel at the bottom.
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
        {canEdit && onSave && !editing && <button type="button" className="btn btn-dark" onClick={() => { setError(null); setEditing(true) }}><Pencil aria-hidden /> Edit info</button>}
      </div>
      <div className="settings-body">
        <ErrorNote error={error && !Object.keys(errors).length ? error : null} />
        {children(value, (patch) => setValue((v) => ({ ...v, ...patch })), !editing, errors)}
        {editing && (
          <div className="panel-actions">
            <button type="button" className="btn btn-quiet" onClick={() => setEditing(false)} disabled={busy}>Cancel</button>
            <button type="button" className="btn" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
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
    try { await save('Kiosk agreement')(body); setEditing(false) } finally { setBusy(false) }
  }
  return (
    <section className="card settings-card">
      <div className="settings-head">
        <QrCode aria-hidden />
        <div className="settings-title"><h2>Kiosk QR code</h2><p>Display this QR code at your clinic for walk-in registrations</p></div>
      </div>
      <div className="settings-body">
        <div className="qr-frame">{src ? <img src={src} alt={`QR code for ${url}`} width="150" height="150" /> : <span className="skeleton" style={{ width: 150, height: 150 }} />}</div>
        <div className="kiosk-url"><span className="label">Kiosk URL</span><a href={url} target="_blank" rel="noreferrer">{url} <ExternalLink size={14} aria-hidden /></a></div>
        <a className="btn btn-block" href={src || undefined} download="hanna-kiosk-qr.png"><Download aria-hidden /> Download QR code</a>
        <hr className="divider" />
        <div className="agreement-head">
          <div><strong>Kiosk agreement</strong><span className="cell-sub">Required at the end of public kiosk registration</span></div>
          <div className="agreement-tools">
            <Switch checked={c.kioskAgreementEnabled} onChange={(v) => run({ kioskAgreementEnabled: v })} disabled={!canEdit || busy} label="Kiosk agreement enabled" />
            <span className="field-hint">{c.kioskAgreementEnabled ? 'Enabled' : 'Off'}</span>
            {canEdit && !editing && <button type="button" className="icon-btn" onClick={() => { setText(c.kioskAgreement || ''); setEditing(true) }} aria-label="Edit agreement" title="Edit agreement"><Pencil /></button>}
          </div>
        </div>
        {editing ? (
          <div className="stack" style={{ gap: 10 }}>
            <IconInput multiline value={text} onChange={setText} max={3000} label="Agreement text" placeholder="e.g. a privacy notice clients agree to" />
            <div className="panel-actions">
              <button type="button" className="btn btn-quiet" onClick={() => setEditing(false)} disabled={busy}>Cancel</button>
              <button type="button" className="btn" onClick={() => run({ kioskAgreement: text })} disabled={busy}>{busy ? 'Saving…' : 'Save agreement'}</button>
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
    <SettingsCard icon={Clock} title="Business availability" sub="Set the clinic’s opening hours for each day" canEdit={canEdit}
      initial={{ hours: c.hours }} onSave={save('Opening hours')}>
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
                            <input type="time" value={b.start} disabled={disabled} onChange={(e) => setDay(day, { ...d, breaks: d.breaks.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)) })} aria-label="Break starts" />
                            <span className="field-hint">to</span>
                            <input type="time" value={b.end} disabled={disabled} onChange={(e) => setDay(day, { ...d, breaks: d.breaks.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)) })} aria-label="Break ends" />
                            {!disabled && <button type="button" className="icon-btn" onClick={() => setDay(day, { ...d, breaks: d.breaks.filter((_, j) => j !== i) })} aria-label="Remove break" title="Remove break"><Trash2 /></button>}
                          </div>
                        ))}
                        {!disabled && d.breaks.length < 3 && <button type="button" className="text-btn" onClick={() => setDay(day, { ...d, breaks: [...d.breaks, { start: '12:00', end: '13:00' }] })}><Plus size={14} aria-hidden /> Add break</button>}
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
  const crumbs = [{ label: 'Clinic operations' }, { label: 'Clinic profile' }]

  if (error) return <><PageHead crumbs={crumbs} title="Clinic profile" /><ErrorNote error={error} /></>
  if (!c) return <PageHead crumbs={crumbs} title=" " />

  return (
    <div className="profile-page">
      <nav className="crumbs" aria-label="Breadcrumb"><span>Clinic operations</span> › <span aria-current="page">Clinic profile</span></nav>
      <header className="clinic-header">
        <img src="/brand/logo-192.png" alt="" width="64" height="64" />
        <div><h1>{c.name}</h1><p>{c.tagline}</p></div>
      </header>

      <div className="profile-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'basic'} onClick={() => setTab('basic')}><Info aria-hidden /> Basic information</button>
        <button type="button" role="tab" aria-selected={tab === 'hours'} onClick={() => setTab('hours')}><Clock aria-hidden /> Business availability</button>
      </div>

      {tab === 'hours' ? <HoursCard c={c} canEdit={canEdit} save={save} /> : (
        <div className="stack">
          <SettingsCard icon={Info} title="Business information" sub="Manage your business’s information" canEdit={canEdit}
            initial={{ name: c.name, tagline: c.tagline || '', phone1: c.phones[0] || '', phone2: c.phones[1] || '', email: c.email || '', address: c.address || '', about: c.about || '', emailBrandColor: c.emailBrandColor }}
            onSave={(v) => save('Business information')({ name: v.name, tagline: v.tagline, phones: [v.phone1, v.phone2], email: v.email, address: v.address, about: v.about, emailBrandColor: v.emailBrandColor })}>
            {(v, set, disabled, errors) => {
              const ratio = contrastWithWhite(v.emailBrandColor)
              return (
                <>
                  <div className="form-row">
                    <Labeled label="Business name" error={errors.name}><IconInput icon={Building2} value={v.name} onChange={(x) => set({ name: x })} disabled={disabled} max={50} label="Business name" /></Labeled>
                    <Labeled label="Business tagline"><IconInput icon={Type} value={v.tagline} onChange={(x) => set({ tagline: x })} disabled={disabled} max={100} label="Business tagline" /></Labeled>
                  </div>
                  <div className="form-row">
                    <Labeled label="Phone number"><IconInput icon={Phone} value={v.phone1} onChange={(x) => set({ phone1: x })} disabled={disabled} label="Phone number" /></Labeled>
                    <Labeled label="Secondary phone" optional><IconInput icon={Phone} value={v.phone2} onChange={(x) => set({ phone2: x })} disabled={disabled} placeholder="Enter secondary phone number" label="Secondary phone" /></Labeled>
                  </div>
                  <div className="form-row">
                    <Labeled label="Email address" error={errors.email}><IconInput icon={Mail} type="email" value={v.email} onChange={(x) => set({ email: x })} disabled={disabled} max={50} label="Email address" /></Labeled>
                  </div>
                  <Labeled label="Address" error={errors.address}><IconInput icon={MapPin} multiline value={v.address} onChange={(x) => set({ address: x })} disabled={disabled} max={150} label="Address" /></Labeled>
                  <Labeled label="About the business"><IconInput icon={FileText} multiline value={v.about} onChange={(x) => set({ about: x })} disabled={disabled} max={150} label="About the business" /></Labeled>
                  <Labeled label="Email brand colour" hint="Accent used in outgoing email headers and headings." error={errors.emailBrandColor}>
                    <div className="brand-colour">
                      <input type="color" value={v.emailBrandColor} onChange={(e) => set({ emailBrandColor: e.target.value.toUpperCase() })} disabled={disabled} aria-label="Pick colour" />
                      <IconInput value={v.emailBrandColor} onChange={(x) => set({ emailBrandColor: x })} disabled={disabled} label="Colour code" />
                      <span className="colour-preview" style={{ background: v.emailBrandColor }}>White text preview</span>
                      {ratio && <span className="field-hint">{ratio.toFixed(2)}:1 contrast (min 4.5:1){ratio < 4.5 ? '. Pick a darker colour so white text is easy to read.' : ''}</span>}
                    </div>
                  </Labeled>
                </>
              )
            }}
          </SettingsCard>

          <SettingsCard icon={Store} title="Social media" sub="Connect your clinic’s social media accounts" canEdit={canEdit}
            initial={{ social: { ...c.social }, on: Object.fromEntries(SOCIAL.map((s) => [s.key, !!c.social[s.key]])) }}
            onSave={(v) => save('Social media')({ social: { ...Object.fromEntries(SOCIAL.map((s) => [s.key, v.on[s.key] ? v.social[s.key] || '' : ''])), messenger: c.social.messenger || '' } })}>
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

          <SettingsCard icon={Receipt} title="Invoice settings" sub="Configure tax rates and other invoice-related settings" canEdit={canEdit}
            initial={{ taxRate: String(c.taxRate) }} onSave={(v) => save('Invoice settings')({ taxRate: v.taxRate })}>
            {(v, set, disabled, errors) => (
              <Labeled label="Tax rate (%)" hint="This tax rate will be applied to all invoices by default." error={errors.taxRate}>
                <IconInput value={v.taxRate} onChange={(x) => set({ taxRate: x })} disabled={disabled} label="Tax rate" suffix="%" />
              </Labeled>
            )}
          </SettingsCard>

          <SettingsCard icon={Bell} title="Notification settings" sub="Configure how your business receives email notifications" canEdit={canEdit}
            initial={{ ccBusinessEmail: c.ccBusinessEmail }} onSave={(v) => save('Notification settings')({ ccBusinessEmail: v.ccBusinessEmail })}>
            {(v, set, disabled) => (
              <div className="setting-line">
                <Mail aria-hidden />
                <div><strong>CC business email on all notifications</strong><span className="cell-sub">When on, the business email gets a copy of every email the app sends (appointments, invoices, certificates and so on).</span></div>
                <Switch checked={v.ccBusinessEmail} onChange={(x) => set({ ccBusinessEmail: x })} disabled={disabled} label="CC business email on all notifications" />
              </div>
            )}
          </SettingsCard>

          <KioskCard c={c} canEdit={canEdit} save={save} />
        </div>
      )}
    </div>
  )
}
