// Inbox: email to and from hello@hannapetwellnesscenter.com (SMS joins later). Conversations on the left
// (Open, Mine, Done, All, Spam), the selected one on the right: the emails, staff notes, who it is in the
// Masterlist, Assign, Done, and a reply box with quick replies. Every staff member; owners and admins also
// keep Private Senders and quick replies. Plan: docs/INBOX-PLAN.md.
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Ban, Globe, MessageCircle, Check, Inbox as InboxIcon, Link2, Lock, Mail, MessageSquareText, Paperclip, PenLine, Plus, RotateCcw, Search, Send, Settings, StickyNote, Trash2, UserRound, X } from 'lucide-react'
import { Empty, ErrorNote, Field, PageHead, Pager, Panel, PawLoader, useToast } from '../components/ui.jsx'
import RichText, { RichView } from '../components/RichText.jsx'
import { api, ApiError, query } from '../lib/api.js'
import { useApi, useDebounced } from '../lib/useApi.js'
import { canManage, useStaff } from '../lib/staff.js'
import { clockTime } from '../lib/appointments.js'
import { prettyDay } from '../lib/format.js'

const TABS = [['open', 'Open'], ['mine', 'Mine'], ['done', 'Done'], ['all', 'All'], ['spam', 'Spam']]
const manilaDay = (iso) => new Date(Date.parse(iso) + 8 * 3600e3).toISOString().slice(0, 10)
const when = (iso) => {
  if (!iso) return ''
  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
  return manilaDay(iso) === today ? clockTime(iso) : prettyDay(manilaDay(iso))
}
const who = (t) => t.owner?.name || t.contactName || t.contactEmail || 'Unknown sender'
export const inboxChanged = () => window.dispatchEvent(new Event('clinic:inbox-changed'))

// ---------- Owner picker (link a conversation, or write to an owner) ----------
function OwnerPicker({ onPick, label = 'Find an Owner' }) {
  const [text, setText] = useState('')
  const q = useDebounced(text.trim(), 250)
  const { data } = useApi(q.length >= 2 ? `owners${query({ q, size: 8 })}` : null)
  return (
    <div className="owner-picker">
      <Field label={label}>{(a) => <input {...a} type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Name, mobile or email" autoComplete="off" data-no-dirty />}</Field>
      {q.length >= 2 && (
        <ul className="picker-list">
          {(data?.owners || []).map((o) => (
            <li key={o.id}><button type="button" onClick={() => onPick(o)}><strong>{o.name}</strong><span className="cell-sub">{[o.customerNo, o.mobileLocal, o.email].filter(Boolean).join(' · ')}</span></button></li>
          ))}
          {data && !data.owners.length && <li className="cell-sub" style={{ padding: 8 }}>No owners match “{q}”.</li>}
        </ul>
      )}
    </div>
  )
}

// ---------- One conversation ----------
function Message({ m }) {
  const out = m.direction === 'out'
  return (
    <li className={`mail ${out ? 'is-out' : 'is-in'} ${m.status === 'failed' ? 'is-failed' : ''}`}>
      <div className="mail-head">
        <strong>{out ? `Hanna Pet Wellness Center${m.sentBy ? ` (${m.sentBy})` : ''}` : (m.fromName || m.fromEmail)}</strong>
        <span className="cell-sub">{[out ? (m.to ? `to ${m.to}` : null) : m.fromEmail, `${prettyDay(manilaDay(m.at))}, ${clockTime(m.at)}`].filter(Boolean).join(' · ')}</span>
      </div>
      {m.html ? <RichView html={m.html} /> : <p className="mail-text">{m.text}</p>}
      {m.attachments.length > 0 && (
        <div className="mail-files">
          {m.attachments.map((a) => (
            <a key={a.id} className="mail-file" href={`/api/inbox/attachments/${a.id}`} target="_blank" rel="noreferrer">
              {/^image\//.test(a.type || '') ? <img src={`/api/inbox/attachments/${a.id}`} alt="" /> : <Paperclip aria-hidden />}
              <span>{a.name}</span>
            </a>
          ))}
        </div>
      )}
      {m.status === 'failed' && <p className="field-error" style={{ margin: 0 }}>Not sent: {m.error}</p>}
    </li>
  )
}

function Thread({ id, onBack, onChanged }) {
  const { data, error, setData } = useApi(`inbox/threads/${id}`)
  const staffList = useApi('staff/directory').data?.staff || []
  const templates = useApi('inbox/templates').data?.templates || []
  const toast = useToast()
  const [mode, setMode] = useState('reply') // reply | note
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [linking, setLinking] = useState(false)
  const [sendError, setSendError] = useState(null)
  const [restrict, setRestrict] = useState(null) // the ticked value before Apply
  const t = data?.thread
  useEffect(() => { setRestrict(t ? t.restricted : null) }, [t?.id, t?.restricted]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setText(''); setMode('reply'); setLinking(false); setSendError(null) }, [id])
  useEffect(() => { if (data) onChanged() }, [data?.thread?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  async function patch(body, msg) {
    try { const res = await api(`inbox/threads/${id}`, { method: 'PATCH', body }); setData(res); toast(msg); onChanged() } catch (err) { toast(err.message) }
  }
  async function send() {
    if (!text.trim()) return
    setBusy(true)
    setSendError(null)
    try {
      const res = await api(`inbox/threads/${id}/${mode === 'note' ? 'notes' : 'reply'}`, { method: 'POST', body: { body: text } })
      setData(res)
      setText('')
      toast(mode === 'note' ? 'Note added' : 'Reply sent')
      onChanged()
    } catch (err) {
      setSendError(err)
    } finally {
      setBusy(false)
    }
  }
  if (error) return <div className="card-pad"><ErrorNote error={error} /></div>
  if (!t) return <PawLoader label="Opening the conversation…" />
  const msgr = t.channel === 'messenger'
  const win = t.replyWindow
  const closed = msgr && mode === 'reply' && win && !win.ok
  const timeline = [...t.messages.map((m) => ({ kind: 'm', at: m.at, m })), ...t.notes.map((n) => ({ kind: 'n', at: n.at, n }))].sort((a, b) => a.at.localeCompare(b.at))
  return (
    <div className="thread">
      <div className="thread-head">
        <button type="button" className="icon-btn thread-back" onClick={onBack} aria-label="Back to the List"><ArrowLeft /></button>
        <div className="thread-title">
          {msgr ? <>
            <h2>{t.contactName || 'Facebook user'}</h2>
            <span className="cell-sub"><MessageCircle size={13} aria-hidden /> Messenger, from the clinic’s Facebook Page</span>
          </> : <>
            <h2>{t.subject || '(no subject)'}</h2>
            <span className="cell-sub">{t.contactName ? `${t.contactName} · ` : ''}{t.contactEmail}</span>
          </>}
        </div>
        <div className="thread-actions">
          <label className="sr-only" htmlFor="assign">Assigned To</label>
          <select id="assign" className="select" value={t.assignedTo?.id || ''} onChange={(e) => patch({ assignedTo: e.target.value || null }, e.target.value ? 'Assigned' : 'Unassigned')}>
            <option value="">Not assigned</option>
            {staffList.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {t.status === 'open'
            ? <button type="button" className="btn" onClick={() => patch({ status: 'done' }, 'Marked as done')}><Check aria-hidden /> Done</button>
            : <button type="button" className="btn btn-quiet" onClick={() => patch({ status: 'open' }, 'Reopened')}><RotateCcw aria-hidden /> Reopen</button>}
          {t.status !== 'spam' && <button type="button" className="icon-btn" onClick={() => patch({ status: 'spam' }, 'Moved to Spam')} aria-label="Move to Spam" title="Move to Spam"><Ban /></button>}
        </div>
      </div>

      {t.canRestrict && (
        <div className="thread-access">
          <label className="check">
            <input type="checkbox" checked={!!restrict} onChange={(e) => setRestrict(e.target.checked)} />
            <span><strong><Lock size={13} aria-hidden /> Owners and Admins Only</strong> <span className="cell-sub" style={{ display: 'inline' }}>{t.restricted ? `Hidden from other staff${t.restrictedBy ? ` (set by ${t.restrictedBy})` : ''}.` : 'Hide this conversation, and its future replies, from other staff.'}</span></span>
          </label>
          <button type="button" className="btn btn-quiet" disabled={restrict === t.restricted} onClick={() => patch({ restricted: !!restrict }, restrict ? 'Now only owners and admins see this conversation' : 'Everyone on the staff can see this conversation again')}>Apply</button>
        </div>
      )}
      <div className="thread-owner">
        {t.owner ? (
          <>
            <UserRound aria-hidden />
            <span><Link to={`/clients/${t.owner.id}`}><strong>{t.owner.name}</strong></Link> <span className="cell-sub" style={{ display: 'inline' }}>{[t.owner.customerNo, t.owner.mobile, t.owner.pets.map((p) => p.name).join(', ')].filter(Boolean).join(' · ')}</span></span>
            <button type="button" className="text-btn" onClick={() => patch({ ownerId: null }, 'Unlinked')}>Unlink</button>
          </>
        ) : linking ? (
          <div style={{ flex: 1 }}><OwnerPicker label="Link to an Owner" onPick={(o) => { setLinking(false); patch({ ownerId: o.id }, `Linked to ${o.name}`) }} /></div>
        ) : (
          <>
            <UserRound aria-hidden />
            <span className="cell-sub" style={{ display: 'inline' }}>Not matched to an owner in the Masterlist.</span>
            <button type="button" className="text-btn" onClick={() => setLinking(true)}><Link2 size={14} aria-hidden /> Link to Owner</button>
          </>
        )}
        {linking && <button type="button" className="icon-btn" onClick={() => setLinking(false)} aria-label="Cancel"><X /></button>}
      </div>

      <ul className="mail-list">
        {timeline.map((x) => (x.kind === 'm' ? <Message key={`m${x.m.id}`} m={x.m} /> : (
          <li key={`n${x.n.id}`} className="mail is-note">
            <div className="mail-head"><strong><StickyNote size={13} aria-hidden /> Note from {x.n.author}</strong><span className="cell-sub">{prettyDay(manilaDay(x.n.at))}, {clockTime(x.n.at)} · only staff see this</span></div>
            <p className="mail-text">{x.n.body}</p>
          </li>
        )))}
      </ul>

      <div className="composer" data-no-dirty>
        <div className="tabs" role="group" aria-label="Write">
          <button type="button" className="tab" aria-pressed={mode === 'reply'} onClick={() => setMode('reply')}>{msgr ? <><MessageCircle size={14} aria-hidden /> Reply on Messenger</> : <><Mail size={14} aria-hidden /> Reply by Email</>}</button>
          <button type="button" className="tab" aria-pressed={mode === 'note'} onClick={() => setMode('note')}><StickyNote size={14} aria-hidden /> Staff Note</button>
        </div>
        {mode === 'reply' && !closed && templates.length > 0 && (
          <div className="quick-replies" aria-label="Quick replies">
            {templates.map((q) => <button key={q.id} type="button" className="chip-btn" onClick={() => setText((v) => (v.trim() ? `${v.trim()}\n\n${q.body}` : q.body))}><MessageSquareText size={13} aria-hidden /> {q.title}</button>)}
          </div>
        )}
        <label className="sr-only" htmlFor="composer">{mode === 'note' ? 'Staff note' : 'Reply'}</label>
        <textarea id="composer" rows={5} value={text} onChange={(e) => setText(e.target.value)} maxLength={mode === 'reply' && msgr ? 2000 : undefined} disabled={closed}
          placeholder={mode === 'note' ? 'A note for the team. It is never sent.' : closed ? 'Messenger won’t deliver a reply now (see below).' : msgr ? `Write to ${t.contactName || 'the client'} on Messenger…` : `Write to ${t.contactName || t.contactEmail}… The clinic's signature is added.`}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send() }} />
        {closed && <ErrorNote error={new Error(win.reason)} />}
        <ErrorNote error={sendError} />
        <div className="composer-foot">
          <span className="cell-sub">{mode !== 'reply' ? 'Only staff see notes.' : msgr ? (win?.ok ? `From the Facebook Page. Messenger allows replies until ${prettyDay(manilaDay(win.until))}, ${clockTime(win.until)}.` : 'From the Facebook Page.') : `From hello@hannapetwellnesscenter.com to ${t.contactEmail}`}</span>
          <button type="button" className="btn" onClick={send} disabled={busy || !text.trim() || closed}>{mode === 'note' ? <><StickyNote aria-hidden /> {busy ? 'Saving…' : 'Add Note'}</> : <><Send aria-hidden /> {busy ? 'Sending…' : 'Send Reply'}</>}</button>
        </div>
      </div>
    </div>
  )
}

// ---------- New email to an owner ----------
function ComposePanel({ onClose, onDone }) {
  const [owner, setOwner] = useState(null)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const errors = error instanceof ApiError ? error.body.errors || {} : {}
  async function send() {
    setBusy(true)
    setError(null)
    try { const res = await api('inbox/compose', { method: 'POST', body: { ownerId: owner.id, subject, body } }); onDone(res.id) } catch (err) { setError(err); setBusy(false) }
  }
  return (
    <Panel title="New Email" intro="From hello@hannapetwellnesscenter.com, with the clinic's signature." onClose={onClose} busy={busy} dirty={!!(subject || body)}
      footer={<><button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="btn" onClick={send} disabled={busy || !owner || !subject.trim() || !body.trim()}><Send aria-hidden /> {busy ? 'Sending…' : 'Send Email'}</button></>}>
      <div className="stack">
        <ErrorNote error={error && !Object.keys(errors).length ? error : null} />
        {owner ? (
          <div className="thread-owner"><UserRound aria-hidden /><span><strong>{owner.name}</strong> <span className="cell-sub" style={{ display: 'inline' }}>{owner.email || 'No email on file'}</span></span><button type="button" className="text-btn" onClick={() => setOwner(null)}>Change</button></div>
        ) : <OwnerPicker label="To (Owner)" onPick={setOwner} />}
        <Field label="Subject" error={errors.subject}>{(a) => <input {...a} value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} />}</Field>
        <Field label="Message" error={errors.body}>{(a) => <textarea {...a} rows={8} value={body} onChange={(e) => setBody(e.target.value)} />}</Field>
      </div>
    </Panel>
  )
}

// ---------- Owners and admins: Private Senders and quick replies ----------
function SettingsPanel({ onClose }) {
  const senders = useApi('inbox/private-senders')
  const tpls = useApi('inbox/templates')
  const toast = useToast()
  const [pattern, setPattern] = useState('')
  const [note, setNote] = useState('')
  const [edit, setEdit] = useState(null) // {id?, title, body}
  const [error, setError] = useState(null)
  const sig = useApi('inbox/signature')
  const [signature, setSignature] = useState(null) // HTML; null until loaded
  const [sigKey, setSigKey] = useState(0) // remounts the editor after Use the Default
  useEffect(() => { if (sig.data && signature === null) setSignature(sig.data.html) }, [sig.data, signature])
  async function saveSignature(value) {
    setError(null)
    try { const r = await api('inbox/signature', { method: 'PUT', body: { html: value } }); setSignature(r.html); setSigKey((k) => k + 1); sig.reload(); toast('Signature saved') } catch (err) { setError(err) }
  }
  async function addSender() {
    setError(null)
    try { await api('inbox/private-senders', { method: 'POST', body: { pattern, note } }); setPattern(''); setNote(''); senders.reload(); toast('Private Sender added') } catch (err) { setError(err) }
  }
  async function saveTpl() {
    setError(null)
    try { await api(edit.id ? `inbox/templates/${edit.id}` : 'inbox/templates', { method: edit.id ? 'PATCH' : 'POST', body: edit }); setEdit(null); tpls.reload(); toast('Quick reply saved') } catch (err) { setError(err) }
  }
  return (
    <Panel title="Inbox Settings" intro="Owners and admins." onClose={onClose}>
      <ErrorNote error={error} />
      <section className="form-section" data-no-dirty>
        <h3 className="label">Private Senders</h3>
        <p className="field-hint" style={{ margin: 0 }}>Mail to hello@ from these is still forwarded to the private mailbox, but never saved in the app. Use an address, or @ and a domain for everyone there (e.g. @mybank.com). It applies to new mail.</p>
        <div className="form-row">
          <Field label="Address or @Domain">{(a) => <input {...a} value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="accounts@mybank.com" />}</Field>
          <Field label="Note" optional>{(a) => <input {...a} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Bank" />}</Field>
        </div>
        <button type="button" className="btn btn-quiet" style={{ justifySelf: 'start' }} onClick={addSender} disabled={!pattern.trim()}><Plus aria-hidden /> Add Private Sender</button>
        <ul className="settings-list">
          {(senders.data?.senders || []).map((s) => (
            <li key={s.id}><span><strong>{s.pattern}</strong>{s.note && <span className="cell-sub">{s.note}</span>}</span>
              <button type="button" className="icon-btn" onClick={async () => { await api(`inbox/private-senders/${s.id}`, { method: 'DELETE' }); senders.reload() }} aria-label={`Remove ${s.pattern}`} title="Remove"><Trash2 /></button></li>
          ))}
          {senders.data && !senders.data.senders.length && <li className="cell-sub">None yet.</li>}
        </ul>
      </section>
      <section className="form-section" data-no-dirty>
        <h3 className="label">Email Signature</h3>
        <p className="field-hint" style={{ margin: 0 }}>Added under every email sent from the Inbox, for all staff.</p>
        {signature !== null && <>
          <div className="field">
            <span className="field-label">Signature</span>
            <RichText key={sigKey} id="email-signature" label="Signature" variant="signature" value={signature} onChange={setSignature} />
            <span className="field-hint">Use the toolbar for bold, colour, links and pictures (a picture must already be online, at an https:// address), or the &lt;/&gt; button to paste HTML. Unsafe code is removed when you save.</span>
          </div>
          <div className="inline-row">
            <button type="button" className="btn" onClick={() => saveSignature(signature)} disabled={signature === sig.data?.html}>Save Signature</button>
            {sig.data?.saved && <button type="button" className="btn btn-quiet" onClick={() => saveSignature('')}>Use the Default</button>}
          </div>
        </>}
      </section>
      <section className="form-section" data-no-dirty>
        <div className="form-section-head"><h3 className="label">Quick Replies</h3><button type="button" className="btn btn-quiet" onClick={() => setEdit({ title: '', body: '' })}><Plus aria-hidden /> Add Quick Reply</button></div>
        {edit && (
          <div className="stack" style={{ gap: 8 }}>
            <Field label="Name">{(a) => <input {...a} value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} maxLength={60} placeholder="e.g. Directions" />}</Field>
            <Field label="Reply">{(a) => <textarea {...a} rows={5} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} />}</Field>
            <div className="inline-row"><button type="button" className="btn" onClick={saveTpl}>Save Quick Reply</button><button type="button" className="btn btn-quiet" onClick={() => setEdit(null)}>Cancel</button></div>
          </div>
        )}
        <ul className="settings-list">
          {(tpls.data?.templates || []).map((q) => (
            <li key={q.id}><span><strong>{q.title}</strong><span className="cell-sub">{q.body.slice(0, 120)}{q.body.length > 120 ? '…' : ''}</span></span>
              <span className="row-actions">
                <button type="button" className="icon-btn" onClick={() => setEdit(q)} aria-label={`Edit ${q.title}`} title="Edit"><PenLine /></button>
                <button type="button" className="icon-btn" onClick={async () => { await api(`inbox/templates/${q.id}`, { method: 'DELETE' }); tpls.reload() }} aria-label={`Remove ${q.title}`} title="Remove"><Trash2 /></button>
              </span></li>
          ))}
        </ul>
      </section>
    </Panel>
  )
}

export default function InboxPage() {
  const staff = useStaff()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const set = (patch) => setParams((p) => { const n = new URLSearchParams(p); Object.entries(patch).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k))); return n }, { replace: true })
  const tab = TABS.some(([k]) => k === params.get('tab')) ? params.get('tab') : 'open'
  const open = Number(params.get('t')) || null
  const page = Number(params.get('page')) || 1
  const [text, setText] = useState('')
  const q = useDebounced(text.trim(), 250)
  const { data, error, reload } = useApi(`inbox${query({ tab: tab === 'open' ? '' : tab, q, page })}`)
  const [panel, setPanel] = useState(null)
  useEffect(() => { // new mail shows up without reloading (every minute while the tab is visible)
    const t = setInterval(() => { if (!document.hidden) reload() }, 60000)
    return () => clearInterval(t)
  }, [reload])
  const changed = useMemo(() => () => { reload(); inboxChanged() }, [reload])
  const c = data?.counts
  return (
    <>
      <PageHead crumbs={[{ label: 'Inbox' }]} title="Inbox" intro="Email to and from hello@hannapetwellnesscenter.com, and messages to the clinic’s Facebook Page once it’s connected. SMS joins later.">
        <div className="head-actions">
          {canManage(staff) && <button type="button" className="icon-btn" onClick={() => setPanel('settings')} aria-label="Inbox Settings" title="Inbox Settings"><Settings /></button>}
          <button type="button" className="btn" onClick={() => setPanel('compose')}><PenLine aria-hidden /> New Email</button>
        </div>
      </PageHead>
      <section className={`card inbox ${open ? 'has-thread' : ''}`}>
        <div className="inbox-list">
          <div className="inbox-tools">
            <div className="tabs tab-scroll" role="group" aria-label="Show">
              {TABS.map(([k, l]) => (
                <button key={k} type="button" className="tab" aria-pressed={tab === k} onClick={() => set({ tab: k === 'open' ? '' : k, page: '' })}>
                  {l}{k === 'open' && c?.open ? <span className="tab-count">{c.open}</span> : k === 'mine' && c?.mine ? <span className="tab-count">{c.mine}</span> : null}
                </button>
              ))}
            </div>
            <div className="search"><Search aria-hidden /><input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Search name, email or subject" aria-label="Search the Inbox" /></div>
          </div>
          <ErrorNote error={error} />
          {!data ? <PawLoader label="Loading the Inbox…" /> : !data.threads.length ? (
            <Empty icon={InboxIcon} title={q ? `Nothing matches “${q}”` : tab === 'open' ? 'All caught up' : 'Nothing here'} text={tab === 'open' && !q ? 'New email to hello@ and Facebook Page messages show up here.' : 'Try another tab.'} />
          ) : (
            <>
              <ul className="inbox-items">
                {data.threads.map((t) => (
                  <li key={t.id}>
                    <button type="button" className={`inbox-item ${t.unread ? 'is-unread' : ''} ${open === t.id ? 'is-open' : ''}`} onClick={() => set({ t: String(t.id) })}>
                      <span className="inbox-item-top"><strong>{who(t)}</strong><span className="cell-sub">{when(t.lastMessageAt)}</span></span>
                      <span className="inbox-subject">{t.channel === 'messenger' ? <><MessageCircle size={13} aria-hidden /> Messenger</> : t.subject || '(no subject)'}</span>
                      <span className="cell-sub inbox-snippet">{t.lastDirection === 'out' ? 'You: ' : ''}{t.snippet}</span>
                      <span className="inbox-tags">
                        {t.unread && <span className="badge badge-warm">New</span>}
                        {t.website && <span className="badge badge-soft"><Globe size={11} aria-hidden /> Website Sign-Up</span>}
                        {t.restricted && <span className="badge badge-soft" title="Owners and admins only"><Lock size={11} aria-hidden /> Owners &amp; Admins</span>}
                        {t.owner && <span className="badge badge-soft">Client</span>}
                        {t.assignedTo && <span className="badge badge-soft">{t.assignedTo.name}</span>}
                        {t.messageCount > 1 && <span className="cell-sub">{t.messageCount} {t.channel === 'messenger' ? 'messages' : 'emails'}</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {data.total > data.size && <Pager page={page} pageSize={data.size} total={data.total} onPage={(n) => set({ page: n > 1 ? String(n) : '' })} noun="conversations" />}
            </>
          )}
        </div>
        <div className="inbox-thread">
          {open ? <Thread key={open} id={open} onBack={() => set({ t: '' })} onChanged={changed} />
            : <Empty icon={Mail} title="Pick a conversation" text="Choose a conversation on the left to read and reply." />}
        </div>
      </section>
      {panel === 'compose' && <ComposePanel onClose={() => setPanel(null)} onDone={(id) => { setPanel(null); toast('Email sent'); set({ t: String(id) }); changed() }} />}
      {panel === 'settings' && <SettingsPanel onClose={() => setPanel(null)} />}
    </>
  )
}
