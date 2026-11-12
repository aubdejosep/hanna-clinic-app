// Content ▸ Calendar: the clinic's social media posts by day, with promos and closed dates, Team
// Notes for the team's inputs, and a window per post (slides, reel, caption, comments).
// Everyone sees it and can comment; owners and admins import weeks, add promos and tick Posted.
// Plan: docs/CONTENT-PLAN.md. Week folder format: docs/CONTENT-IMPORT-FORMAT.md.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  CalendarOff, Check, ChevronLeft, ChevronRight, Clapperboard, Copy, Download, FolderUp, Images, MessageSquare,
  Megaphone, Pencil, Play, Send, Tag, Trash2, X,
} from 'lucide-react'
import { Empty, ErrorNote, Field, PageHead, Panel, PawLoader, useToast } from '../components/ui.jsx'
import { api, ApiError } from '../lib/api.js'
import { useApi } from '../lib/useApi.js'
import { canManage, useStaff } from '../lib/staff.js'
import { addDays, clockTime, longDay, manilaToday, shortDay, weekday } from '../lib/appointments.js'
import { prettyDay } from '../lib/format.js'

export const POST_STATUS = {
  ready: { label: 'Ready to Post', short: 'Ready' },
  film: { label: 'To Film', short: 'Film' },
  info: { label: 'Needs Info', short: 'Info' },
  placeholder: { label: 'Waiting on Client', short: 'Waiting' },
  idea: { label: 'Idea', short: 'Idea' },
  posted: { label: 'Posted', short: 'Posted' },
}
const FILTERS = [['all', 'All'], ['todo', 'Not Posted Yet'], ['reels', 'Reels'], ['promos', 'Promos']]
const isReel = (p) => /reel/i.test(p.format || '') || !!p.reel
const matches = (p, f) => f === 'all' || (f === 'todo' && p.status !== 'posted') || (f === 'reels' && isReel(p)) || (f === 'promos' && /promo/i.test(p.pillar || ''))
const media = (id, download) => `/api/content/media/${id}${download ? '?download=1' : ''}`
const ago = (iso) => `${prettyDay(new Date(Date.parse(iso) + 8 * 3600e3).toISOString().slice(0, 10))}, ${clockTime(iso)}`

async function copy(text, toast) {
  try {
    await navigator.clipboard.writeText(text)
    toast('Caption copied')
  } catch {
    toast('Copy didn’t work here. Select the caption and copy it.')
  }
}

// ---------- Calendar ----------
function PostPill({ p, onOpen }) {
  return (
    <button type="button" className={`cal-pill content-pill tone-${p.status}`} onClick={() => onOpen(p.id)}
      title={`${p.title} · ${POST_STATUS[p.status]?.label}${p.time ? ` · ${p.time}` : ''}${p.comments ? ` · ${p.comments} comment${p.comments === 1 ? '' : 's'}` : ''}`}>
      <span className="cal-pill-name">{p.status === 'posted' && <Check size={11} aria-label="Posted" />} {p.title}</span>
      <span className="content-pill-icons">
        {isReel(p) && <Clapperboard size={11} aria-label="Reel" />}
        {p.comments > 0 && <span className="content-pill-count"><MessageSquare size={11} aria-hidden />{p.comments}</span>}
      </span>
    </button>
  )
}

function Calendar({ month, setMonth, data, filter, setFilter, onOpen, onEvent, owner }) {
  const today = manilaToday()
  const first = `${month}-01`
  const from = addDays(first, -weekday(first))
  const days = Array.from({ length: 42 }, (_, i) => addDays(from, i))
  const byDay = useMemo(() => {
    const m = {}
    for (const p of data?.posts || []) if (matches(p, filter)) (m[p.day] ||= []).push(p)
    return m
  }, [data, filter])
  const closed = useMemo(() => Object.fromEntries((data?.closed || []).map((c) => [c.day, c])), [data])
  const eventsOn = (d) => (data?.events || []).filter((e) => e.from <= d && e.to >= d)
  const step = (n) => { const d = new Date(`${first}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); setMonth(d.toISOString().slice(0, 7)) }
  const title = new Date(`${month}-15T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  return (
    <section className="card">
      <div className="cal-head">
        <div className="cal-title">
          <button type="button" className="cal-today" onClick={() => setMonth(today.slice(0, 7))} title="Go to this month">
            <span>{new Date(`${today}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short' }).toUpperCase()}</span>
            <strong>{today.slice(8)}</strong>
          </button>
          <button type="button" className="icon-btn" onClick={() => step(-1)} aria-label="Previous Month" title="Previous Month"><ChevronLeft /></button>
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={() => step(1)} aria-label="Next Month" title="Next Month"><ChevronRight /></button>
        </div>
        <div className="tabs" role="group" aria-label="Show">
          {FILTERS.map(([k, l]) => <button key={k} type="button" className="tab" aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>)}
        </div>
      </div>
      <div className="content-legend">
        {['ready', 'film', 'info', 'placeholder', 'posted'].map((s) => <span key={s} className={`content-key tone-${s}`}>{POST_STATUS[s].label}</span>)}
        <span className="content-key tone-promo">Promo or Event</span>
        <span className="content-key tone-closed">Clinic Closed</span>
      </div>
      {!data ? <PawLoader label="Loading the content calendar…" /> : (
        <div className="cal-grid cal-month content-cal">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="cal-dow">{d}</div>)}
          {days.map((d) => {
            const list = byDay[d] || []
            const evs = eventsOn(d)
            const cl = closed[d]
            const outside = d.slice(0, 7) !== month
            const empty = !list.length && !evs.length && !cl
            const quiet = !list.length && !cl && !evs.some((e) => d === e.from || weekday(d) === 0) // only a promo band: hidden on phones
            return (
              <div key={d} className={`cal-cell ${outside ? 'is-outside' : ''} ${d === today ? 'is-today' : ''} ${empty ? 'is-empty' : ''} ${quiet ? 'is-quiet' : ''}`}>
                <span className="cal-date content-date" aria-label={longDay(d)}><span className="content-date-num">{Number(d.slice(8))}</span><span className="content-date-long">{longDay(d)}</span></span>
                {cl && <span className="content-flag tone-closed" title={cl.reason || undefined}><CalendarOff size={11} aria-hidden /> {cl.open ? `Hours ${cl.open}–${cl.close}` : 'Clinic Closed'}</span>}
                {evs.map((e) => {
                  // A promo's name shows on its first day and at the start of each week; other days get a slim band.
                  const named = d === e.from || weekday(d) === 0
                  const tip = [e.title, e.note, `${shortDay(e.from)} – ${shortDay(e.to)}`].filter(Boolean).join(' · ')
                  return (
                    <button key={e.id} type="button" className={`content-flag tone-promo ${named ? '' : 'is-band'}`} onClick={() => onEvent(e)} disabled={!owner} title={tip} aria-label={tip}>
                      {named && <><Tag size={11} aria-hidden /> <span>{e.title}</span></>}
                    </button>
                  )
                })}
                {list.map((p) => <PostPill key={p.id} p={p} onOpen={onOpen} />)}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

// ---------- Next to post and counts ----------
function Summary({ data, onOpen }) {
  const today = manilaToday()
  const posts = data?.posts || []
  const next = posts.filter((p) => p.status !== 'posted' && p.day >= today).sort((a, b) => a.day.localeCompare(b.day) || a.id - b.id)[0]
  const count = (s) => posts.filter((p) => p.status === s).length
  const posted = count('posted')
  return (
    <section className="card content-summary">
      <div className="card-pad content-next">
        <span className="label">Next to Post</span>
        {next ? (
          <>
            <strong className="content-next-title">{next.title}</strong>
            <span className="cell-sub">{longDay(next.day)}{next.time ? ` at ${next.time}` : ''} · {[next.pillar, next.format].filter(Boolean).join(' · ')} · {POST_STATUS[next.status]?.label}</span>
            <button type="button" className="btn" onClick={() => onOpen(next.id)}>Open Post</button>
          </>
        ) : <span className="cell-sub">{posts.length ? 'Everything this month is posted.' : 'No posts this month yet.'}</span>}
      </div>
      <div className="card-pad content-counts">
        {['ready', 'film', 'info', 'placeholder', 'posted'].map((s) => (
          <div key={s} className={`content-count tone-${s}`}><strong>{count(s)}</strong><span className="cell-sub">{POST_STATUS[s].label}</span></div>
        ))}
        <div className="content-bar" role="img" aria-label={`${posted} of ${posts.length} posted this month`}><i style={{ width: posts.length ? `${(posted / posts.length) * 100}%` : 0 }} /></div>
      </div>
    </section>
  )
}

// ---------- Comments (a post's, or Team Notes) ----------
function Comments({ list, onAdd, onRemove, placeholder, label }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  async function add(e) {
    e.preventDefault()
    if (!text.trim()) return
    setBusy(true)
    setError(null)
    try {
      await onAdd(text)
      setText('')
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="comments" data-no-dirty>
      <form className="comment-form" onSubmit={add}>
        <label className="sr-only" htmlFor={`c-${label}`}>{label}</label>
        <textarea id={`c-${label}`} rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} maxLength={2000}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) add(e) }} />
        <button type="submit" className="btn" disabled={busy || !text.trim()}><Send aria-hidden /> {busy ? 'Adding…' : 'Add'}</button>
      </form>
      <ErrorNote error={error} />
      {list.length > 0 && (
        <ul className="comment-list">
          {list.map((c) => (
            <li key={c.id}>
              <div className="comment-head"><strong>{c.author || 'Staff'}</strong><span className="cell-sub">{ago(c.at)}</span>
                {c.canRemove && <button type="button" className="icon-btn comment-x" onClick={() => onRemove(c)} aria-label="Remove Comment" title="Remove Comment"><Trash2 /></button>}
              </div>
              <p>{c.body}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function TeamNotes({ owner }) {
  const { data, error, reload } = useApi('content/comments')
  const toast = useToast()
  const list = (data?.comments || []).map((c) => ({ ...c, canRemove: c.mine || owner }))
  return (
    <section className="card">
      <div className="card-head"><div><h2>Team Notes</h2><p>Ideas, feedback and inputs for the content plan. Everyone can add; for one post, comment on the post itself.</p></div></div>
      <div className="card-pad">
        <ErrorNote error={error} />
        <Comments label="Team Note" list={list} placeholder="An idea, a client story, or feedback like “Wed, slide 2: …”"
          onAdd={async (body) => { await api('content/comments', { method: 'POST', body: { body } }); reload() }}
          onRemove={async (c) => { try { await api(`content/comments/${c.id}`, { method: 'DELETE' }); reload() } catch (err) { toast(err.message) } }} />
      </div>
    </section>
  )
}

// ---------- One post ----------
function Viewer({ items, at, setAt }) {
  const it = items[at]
  useEffect(() => {
    const onKey = (e) => {
      if (!['Escape', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return
      e.stopPropagation()
      e.preventDefault()
      if (e.key === 'Escape') setAt(null)
      if (e.key === 'ArrowLeft') setAt((n) => (n - 1 + items.length) % items.length)
      if (e.key === 'ArrowRight') setAt((n) => (n + 1) % items.length)
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [items.length, setAt])
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={it.label} onClick={() => setAt(null)}>
      {it.kind === 'reel'
        ? <video src={media(it.id)} poster={it.poster ? media(it.poster) : undefined} controls autoPlay playsInline onClick={(e) => e.stopPropagation()} />
        : <img src={media(it.id)} alt={it.label} onClick={(e) => e.stopPropagation()} />}
      <div className="lightbox-bar" onClick={(e) => e.stopPropagation()}>
        {items.length > 1 && <button type="button" className="icon-btn" onClick={() => setAt((at - 1 + items.length) % items.length)} aria-label="Previous"><ChevronLeft /></button>}
        <span>{it.label}{items.length > 1 ? ` · ${at + 1} of ${items.length}` : ''}</span>
        {items.length > 1 && <button type="button" className="icon-btn" onClick={() => setAt((at + 1) % items.length)} aria-label="Next"><ChevronRight /></button>}
        <a className="btn btn-quiet" href={media(it.id, true)} download><Download aria-hidden /> Save</a>
        <button type="button" className="icon-btn" onClick={() => setAt(null)} aria-label="Close"><X /></button>
      </div>
    </div>
  )
}

function PostWindow({ id, owner, onClose, onChanged }) {
  const { data, error, reload } = useApi(`content/posts/${id}`)
  const toast = useToast()
  const [view, setView] = useState(null)
  const [busy, setBusy] = useState(false)
  const [url, setUrl] = useState(null)
  const [showAll, setShowAll] = useState(false)
  const p = data?.post
  const items = p ? [
    ...(p.reel ? [{ id: p.reel.id, kind: 'reel', poster: p.poster?.id, label: p.reel.silent ? 'Reel · add sound' : 'Reel', saveAs: p.reel.saveAs }] : []),
    ...p.slides.map((s, i) => ({ id: s.id, kind: 'slide', label: p.slides.length > 1 ? `Slide ${i + 1}` : 'Image', saveAs: s.saveAs })),
  ] : []
  async function patch(body, msg) {
    setBusy(true)
    try {
      await api(`content/posts/${id}`, { method: 'PATCH', body })
      toast(msg)
      reload()
      onChanged()
    } catch (err) {
      toast(err.message)
    } finally {
      setBusy(false)
    }
  }
  function saveAll() { // one download per file; the browser may ask once to allow several
    p.slides.forEach((s, i) => setTimeout(() => { const a = document.createElement('a'); a.href = media(s.id, true); a.download = ''; document.body.append(a); a.click(); a.remove() }, i * 400))
  }
  const comments = (p?.comments || []).map((c) => ({ ...c, canRemove: c.mine || owner }))
  return (
    <Panel wide title={p ? p.title : 'Post'} intro={p ? `${longDay(p.day)}${p.time ? ` · ${p.time}` : ''}` : ''} onClose={onClose}>
      <ErrorNote error={error} />
      {!p ? <PawLoader label="Opening the post…" /> : (
        <div className="stack content-post">
          <div className="chips">
            <span className={`badge content-badge tone-${p.status}`}>{p.status === 'posted' && <Check size={12} aria-hidden />} {POST_STATUS[p.status]?.label}</span>
            {p.pillar && <span className="badge badge-soft">{p.pillar}</span>}
            {p.format && <span className="badge badge-soft">{p.format}</span>}
          </div>
          {p.status === 'posted' && <p className="cell-sub" style={{ margin: 0 }}>Posted {p.postedBy ? `by ${p.postedBy} ` : ''}{ago(p.postedAt)}.{p.postUrl && <> <a href={p.postUrl} target="_blank" rel="noreferrer">Open the live post</a></>}</p>}

          {items.length > 0 ? (
            <div className="content-media">
              {items.map((it, i) => (
                <figure key={it.id} className={it.kind === 'reel' ? 'is-reel' : ''}>
                  <button type="button" className="content-thumb" onClick={() => setView(i)} aria-label={`View ${it.label}`}>
                    {it.kind === 'reel'
                      ? (it.poster ? <img src={media(it.poster)} alt="" loading="lazy" /> : <span className="content-thumb-blank"><Clapperboard aria-hidden /></span>)
                      : <img src={media(it.id)} alt={it.label} loading="lazy" />}
                    {it.kind === 'reel' && <span className="content-play"><Play aria-hidden /></span>}
                  </button>
                  <figcaption><span>{it.label}</span><a className="text-btn" href={media(it.id, true)} download title={it.saveAs || undefined}><Download size={13} aria-hidden /> Save</a></figcaption>
                </figure>
              ))}
            </div>
          ) : <p className="muted" style={{ margin: 0 }}><Images size={14} aria-hidden /> No slides or reel yet.</p>}

          {p.shots.length > 0 && (
            <div className="content-box">
              <span className="label">Shot List</span>
              <ol>{p.shots.map((s, i) => <li key={i}>{s}</li>)}</ol>
            </div>
          )}

          {p.caption && (
            <div className="content-caption">
              <span className="label">Caption</span>
              <pre className={showAll ? '' : 'is-clipped'}>{p.caption}</pre>
              <button type="button" className="text-btn" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show Less' : 'Show Full Caption'}</button>
              {p.hashtags.length > 0 && <p className="cell-sub content-tags">{p.hashtags.join(' ')}</p>}
            </div>
          )}
          {p.note && <p className="content-note"><strong>Note:</strong> {p.note}</p>}

          <div className="inline-row">
            {p.caption && <button type="button" className="btn" onClick={() => copy(`${p.caption}\n\n${p.hashtags.join(' ')}`.trim(), toast)}><Copy aria-hidden /> Copy Caption</button>}
            {p.slides.length > 1 && <button type="button" className="btn btn-quiet" onClick={saveAll}><Download aria-hidden /> Save All {p.slides.length} Slides</button>}
            {owner && (p.status === 'posted'
              ? <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => patch({ posted: false }, 'Marked as not posted')}><X aria-hidden /> Mark as Not Posted</button>
              : <button type="button" className="btn btn-quiet" disabled={busy || ['placeholder', 'info', 'idea'].includes(p.plannedStatus)} onClick={() => patch({ posted: true }, `${p.title}: posted`)}
                  title={['placeholder', 'info', 'idea'].includes(p.plannedStatus) ? 'This post isn’t ready yet' : undefined}><Check aria-hidden /> Mark as Posted</button>)}
          </div>
          {owner && p.status === 'posted' && (
            url === null
              ? <button type="button" className="text-btn" style={{ justifySelf: 'start' }} onClick={() => setUrl(p.postUrl || '')}><Pencil size={13} aria-hidden /> {p.postUrl ? 'Change the Post Link' : 'Add the Post Link'}</button>
              : (
                <form className="inline-row" data-no-dirty onSubmit={(e) => { e.preventDefault(); patch({ postUrl: url }, 'Link saved').then(() => setUrl(null)) }}>
                  <Field label="Link to the Live Post" optional>{(a) => <input {...a} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.facebook.com/…" style={{ minWidth: 260 }} />}</Field>
                  <button type="submit" className="btn" disabled={busy}>Save Link</button>
                  <button type="button" className="btn btn-quiet" onClick={() => setUrl(null)}>Cancel</button>
                </form>
              )
          )}

          <section className="content-comments">
            <h3>Comments <span className="cell-sub">{comments.length || ''}</span></h3>
            <Comments label="Comment" list={comments} placeholder="Feedback or inputs for this post, e.g. “Slide 2: change the photo”"
              onAdd={async (body) => { await api(`content/posts/${id}/comments`, { method: 'POST', body: { body } }); reload(); onChanged() }}
              onRemove={async (c) => { try { await api(`content/comments/${c.id}`, { method: 'DELETE' }); reload(); onChanged() } catch (err) { toast(err.message) } }} />
          </section>
        </div>
      )}
      {view !== null && items[view] && <Viewer items={items} at={view} setAt={setView} />}
    </Panel>
  )
}

// ---------- Import Week ----------
const EXT_TYPE = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' }
const typeOf = (f) => f.type || EXT_TYPE[f.name.split('.').pop().toLowerCase()] || ''
const relPath = (f) => (f.webkitRelativePath || f.name).split('/').slice(1).join('/') || f.name

// The folder's files by name: a slide prefers full/<file>, a reel vid/<file>, a cover img/<file>.
function finder(files) {
  const byName = {}
  for (const f of files) (byName[f.name] ||= []).push(f)
  return (name, prefer) => {
    if (!name) return null
    const list = byName[String(name).split('/').pop()] || []
    return list.find((f) => relPath(f).startsWith(`${prefer}/`)) || list.find((f) => !relPath(f).startsWith('img/')) || list[0] || null
  }
}

async function readWeek(files) {
  const all = [...files]
  const jsons = all.filter((f) => /^(posts|data|week)\.json$/i.test(f.name)).sort((a, b) => relPath(a).split('/').length - relPath(b).split('/').length)
  if (!jsons.length) throw new Error('This folder has no posts.json. Pick the week folder from the content session.')
  let parsed
  try { parsed = JSON.parse(await jsons[0].text()) } catch { throw new Error('posts.json couldn’t be read. Ask the content session to make the folder again.') }
  const posts = Array.isArray(parsed) ? parsed : parsed?.posts
  if (!Array.isArray(posts) || !posts.length) throw new Error('posts.json has no posts in it.')
  const find = finder(all)
  const plan = posts.map((p) => {
    const files = []
    const missing = []
    ;(p.slides || []).forEach((s, i) => {
      const f = find(s.file, 'full')
      if (f) files.push({ f, kind: 'slide', sort: i, saveAs: s.save_as || s.saveAs || f.name })
      else missing.push(s.file)
    })
    if (p.reel) {
      const v = find(p.reel.file, 'vid')
      if (v) files.push({ f: v, kind: 'reel', sort: 0, saveAs: p.reel.save_as || p.reel.saveAs || v.name, silent: !!p.reel.silent })
      else missing.push(p.reel.file)
      const c = find(p.reel.poster, 'img')
      if (c) files.push({ f: c, kind: 'poster', sort: 0, saveAs: c.name })
    }
    return { post: p, files, missing }
  })
  return plan
}

function ImportPanel({ onClose, onDone }) {
  const [plan, setPlan] = useState(null)
  const [existing, setExisting] = useState([])
  const [error, setError] = useState(null)
  const [problems, setProblems] = useState([])
  const [progress, setProgress] = useState(null)
  const input = useRef(null)
  useEffect(() => { input.current?.setAttribute('webkitdirectory', ''); input.current?.setAttribute('directory', '') }, [])
  async function pick(e) {
    setError(null)
    setProblems([])
    setPlan(null)
    try {
      const p = await readWeek(e.target.files || [])
      setPlan(p)
      const refs = p.map((x) => x.post.id).filter(Boolean).join(',')
      const res = await api(`content/import?refs=${encodeURIComponent(refs)}`)
      setExisting(res.existing)
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(400, { error: err.message }))
    }
  }
  const files = plan ? plan.flatMap((x) => x.files) : []
  const big = files.filter((x) => x.f.size > 95 * 1024 * 1024)
  const days = plan ? plan.map((x) => x.post.date).filter(Boolean).sort() : []
  async function run() {
    setError(null)
    setProblems([])
    try {
      setProgress({ n: 0, of: files.length, step: 'Saving the posts…' })
      const res = await api('content/import', { method: 'POST', body: { posts: plan.map((x) => x.post) } })
      const idOf = Object.fromEntries(res.posts.map((r) => [r.ref, r.id]))
      let n = 0
      for (const x of plan) {
        for (const it of x.files) {
          if (it.f.size > 95 * 1024 * 1024) continue
          setProgress({ n, of: files.length, step: `Uploading ${it.f.name}` })
          const q = new URLSearchParams({ post: idOf[x.post.id], kind: it.kind, sort: it.sort, saveAs: it.saveAs || '' })
          if (it.silent) q.set('silent', '1')
          const r = await fetch(`/api/content/media?${q}`, { method: 'PUT', body: it.f, headers: { 'Content-Type': typeOf(it.f) }, credentials: 'same-origin' })
          if (!r.ok) {
            const body = await r.json().catch(() => null)
            throw new ApiError(r.status, { error: `${it.f.name}: ${body?.error || 'the upload didn’t go through.'} Import the week again to finish.` })
          }
          n += 1
        }
      }
      setProgress(null)
      onDone(`${res.posts.length} post${res.posts.length === 1 ? '' : 's'} imported`, days[0])
    } catch (err) {
      setProgress(null)
      setError(err)
      setProblems(err.body?.problems || [])
    }
  }
  return (
    <Panel title="Import Week" intro="Load a week of posts made in the content session." onClose={onClose} busy={!!progress} dirty={!!plan && !progress}
      discardTitle="Close without importing?"
      footer={<>
        <button type="button" className="btn btn-quiet" onClick={onClose} disabled={!!progress}>Cancel</button>
        <button type="button" className="btn" onClick={run} disabled={!plan || !!progress}><FolderUp aria-hidden /> {progress ? 'Importing…' : plan ? `Import ${plan.length} Post${plan.length === 1 ? '' : 's'}` : 'Import'}</button>
      </>}>
      <div className="stack">
        <p style={{ margin: 0 }}>Unzip the week folder from the content session, then pick the folder. It holds <code>posts.json</code> with the slides and reels.</p>
        <label className="btn btn-quiet" style={{ justifySelf: 'start' }}>
          <FolderUp aria-hidden /> Choose Week Folder
          <input ref={input} type="file" multiple className="sr-only" onChange={pick} disabled={!!progress} />
        </label>
        <ErrorNote error={error} />
        {problems.length > 0 && <ul className="field-hint">{problems.map((t, i) => <li key={i}>{t}</li>)}</ul>}
        {plan && (
          <div className="content-box">
            <strong>{plan.length} post{plan.length === 1 ? '' : 's'}{days.length ? `, ${shortDay(days[0])} to ${shortDay(days[days.length - 1])}` : ''} · {files.filter((x) => x.kind === 'slide').length} slides · {files.filter((x) => x.kind === 'reel').length} reels</strong>
            {existing.length > 0 && <p className="cell-sub" style={{ margin: '4px 0 0' }}>{existing.length} already in the app will be updated, with their slides replaced{existing.some((e) => e.posted) ? '. Posted ticks are kept' : ''}.</p>}
            <ul className="import-list">
              {plan.map((x) => (
                <li key={x.post.id}>
                  <span><strong>{x.post.title || '(no title)'}</strong> <span className="cell-sub">{x.post.date ? shortDay(x.post.date) : 'no date'} · {x.files.length} file{x.files.length === 1 ? '' : 's'}{existing.some((e) => e.ref === x.post.id) ? ' · update' : ' · new'}</span></span>
                  {x.missing.length > 0 && <span className="field-error">Missing: {x.missing.join(', ')}</span>}
                </li>
              ))}
            </ul>
            {big.length > 0 && <p className="field-error">Over 95 MB, skipped: {big.map((x) => x.f.name).join(', ')}. Export them smaller.</p>}
          </div>
        )}
        {progress && (
          <div className="content-box" role="status">
            <strong>{progress.step}</strong>
            <div className="content-bar"><i style={{ width: progress.of ? `${(progress.n / progress.of) * 100}%` : '5%' }} /></div>
            <span className="cell-sub">{progress.n} of {progress.of} files. Keep this window open.</span>
          </div>
        )}
      </div>
    </Panel>
  )
}

// ---------- Promos and events ----------
function EventPanel({ event, onClose, onDone }) {
  const [v, setV] = useState({ kind: event?.kind || 'promo', title: event?.title || '', from: event?.from || '', to: event?.to || '', note: event?.note || '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const errors = error instanceof ApiError ? error.body.errors || {} : {}
  const set = (patch) => setV((x) => ({ ...x, ...patch }))
  async function save(e) {
    e?.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api(event ? `content/events/${event.id}` : 'content/events', { method: event ? 'PATCH' : 'POST', body: v })
      onDone(event ? 'Changes saved' : `${v.title} added`)
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }
  async function remove() {
    setBusy(true)
    try {
      await api(`content/events/${event.id}`, { method: 'DELETE' })
      onDone(`${event.title} removed`)
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }
  return (
    <Panel title={event ? 'Edit Promo or Event' : 'Add Promo or Event'} intro="Shown across its days on the content calendar." onClose={onClose} busy={busy}
      footer={<>
        {event && <button type="button" className="btn btn-quiet" onClick={remove} disabled={busy} style={{ marginRight: 'auto' }}><Trash2 aria-hidden /> Remove</button>}
        <button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="btn" onClick={save} disabled={busy}>{busy ? 'Saving…' : event ? 'Save Changes' : 'Add to Calendar'}</button>
      </>}>
      <form className="stack" onSubmit={save}>
        <ErrorNote error={error && !Object.keys(errors).length ? error : null} />
        <div className="tabs" role="group" aria-label="Kind">
          {[['promo', 'Promo'], ['event', 'Clinic Event']].map(([k, l]) => <button key={k} type="button" className="tab" aria-pressed={v.kind === k} onClick={() => set({ kind: k })}>{l}</button>)}
        </div>
        <Field label="Name" error={errors.title}>{(a) => <input {...a} value={v.title} onChange={(e) => set({ title: e.target.value })} maxLength={120} placeholder="e.g. 50% off spay/neuter and dental" />}</Field>
        <div className="grid grid-2">
          <Field label="First Day" error={errors.from}>{(a) => <input {...a} type="date" value={v.from} onChange={(e) => set({ from: e.target.value, to: v.to && v.to >= e.target.value ? v.to : e.target.value })} />}</Field>
          <Field label="Last Day" error={errors.to}>{(a) => <input {...a} type="date" value={v.to} min={v.from || undefined} onChange={(e) => set({ to: e.target.value })} />}</Field>
        </div>
        <Field label="Details" optional>{(a) => <textarea {...a} rows={3} value={v.note} onChange={(e) => set({ note: e.target.value })} maxLength={500} placeholder="e.g. For apparently healthy cats and dogs; anesthesia not included" />}</Field>
      </form>
    </Panel>
  )
}

export default function ContentPage() {
  const staff = useStaff()
  const owner = canManage(staff)
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const month = /^\d{4}-\d{2}$/.test(params.get('month') || '') ? params.get('month') : manilaToday().slice(0, 7)
  const filter = FILTERS.some(([k]) => k === params.get('show')) ? params.get('show') : 'all'
  const open = Number(params.get('post')) || null
  const set = (patch) => setParams((p) => { const n = new URLSearchParams(p); Object.entries(patch).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k))); return n }, { replace: true })
  const first = `${month}-01`
  const from = addDays(first, -weekday(first))
  const { data, error, reload } = useApi(`content?from=${from}&to=${addDays(from, 41)}`)
  const [panel, setPanel] = useState(null) // 'import' | {event} | 'event'
  const monthData = useMemo(() => data && { ...data, posts: data.posts.filter((p) => p.day.slice(0, 7) === month) }, [data, month])
  return (
    <>
      <PageHead crumbs={[{ label: 'Content' }, { label: 'Calendar' }]} title="Content" intro="The clinic’s social media posts by day, with promos and closed dates. Everyone can open a post and comment.">
        {owner && (
          <div className="head-actions">
            <button type="button" className="btn btn-quiet" onClick={() => setPanel('event')}><Megaphone aria-hidden /> Add Promo</button>
            <button type="button" className="btn" onClick={() => setPanel('import')}><FolderUp aria-hidden /> Import Week</button>
          </div>
        )}
      </PageHead>
      <ErrorNote error={error} />
      <div className="stack">
        <div className="content-top">
          <Summary data={monthData} onOpen={(id) => set({ post: String(id) })} />
          <TeamNotes owner={owner} />
        </div>
        {data && !data.posts.length && !data.events.length && (
          <section className="card"><Empty icon={Images} title="No posts this month" text={owner ? 'Import a week from the content session to fill the calendar.' : 'Posts appear here once a week is imported.'}>
            {owner && <button type="button" className="btn" onClick={() => setPanel('import')}><FolderUp aria-hidden /> Import Week</button>}
          </Empty></section>
        )}
        <Calendar month={month} setMonth={(m) => set({ month: m === manilaToday().slice(0, 7) ? '' : m })} data={data} filter={filter} setFilter={(f) => set({ show: f === 'all' ? '' : f })}
          onOpen={(id) => set({ post: String(id) })} onEvent={(e) => setPanel({ event: e })} owner={owner} />
      </div>
      {open && <PostWindow id={open} owner={owner} onClose={() => set({ post: '' })} onChanged={reload} />}
      {panel === 'import' && <ImportPanel onClose={() => setPanel(null)} onDone={(msg, day) => { setPanel(null); toast(msg); if (day) set({ month: day.slice(0, 7) === manilaToday().slice(0, 7) ? '' : day.slice(0, 7) }); reload() }} />}
      {(panel === 'event' || panel?.event) && <EventPanel event={panel?.event} onClose={() => setPanel(null)} onDone={(msg) => { setPanel(null); toast(msg); reload() }} />}
    </>
  )
}

