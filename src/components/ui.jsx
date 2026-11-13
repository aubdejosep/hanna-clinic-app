import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { Cat, ChevronLeft, ChevronRight, CircleCheck, Dog, PawPrint, TriangleAlert, X } from 'lucide-react'
import { REVIEW_LABELS } from '../lib/labels.js'

// Where a section's name in the breadcrumb goes: the section's first page, as in the menu.
const SECTION_LINKS = {
  Dashboard: '/', 'Clinic Operations': '/clinic/profile', Appointments: '/appointments', 'Client Portal': '/clients',
  'Medical Records': '/records', 'Smart Prescription': '/prescription/medications', Inventory: '/inventory',
  Finances: '/finances/balances', Content: '/content', Account: '/settings',
}

// The clickable trail ("Dashboard > Smart Prescription > Medication List"). On a computer it sits in the
// top bar (Layout's #crumb-slot), like the old system; on a phone, above the page title.
function Crumbs({ crumbs, title }) {
  const [slot, setSlot] = useState(null)
  useEffect(() => { setSlot(document.getElementById('crumb-slot')) }, [])
  const base = crumbs?.length ? crumbs : title && title !== 'Clinic Dashboard' && String(title).trim() ? [{ label: title }] : []
  const list = [...(base[0]?.label === 'Dashboard' ? [] : [{ label: 'Dashboard', to: '/' }]), ...base]
    .map((c, i, all) => (i < all.length - 1 && !c.to && SECTION_LINKS[c.label] ? { ...c, to: SECTION_LINKS[c.label] } : c))
  if (!base.length && title !== 'Clinic Dashboard') return null
  const nav = (
    <nav className="crumbs" aria-label="Breadcrumb">
      {list.map((c, i) => (
        <span key={`${c.label}${i}`} style={{ display: 'contents' }}>
          {i > 0 && <ChevronRight size={14} aria-hidden />}
          {c.to && i < list.length - 1 ? <Link to={c.to}>{c.label}</Link> : <span aria-current={i === list.length - 1 ? 'page' : undefined}>{c.label}</span>}
        </span>
      ))}
    </nav>
  )
  return slot ? createPortal(nav, slot) : nav
}

export function PageHead({ crumbs, title, intro, children }) {
  return (
    <header>
      <Crumbs crumbs={crumbs} title={title} />
      <div className="page-head">
        <div>
          <h1>{title}</h1>
          {intro && <p>{intro}</p>}
        </div>
        {children}
      </div>
    </header>
  )
}

export function PetAvatar({ species, large }) {
  const Icon = species === 'cat' ? Cat : species === 'dog' ? Dog : PawPrint
  return (
    <span className={`avatar ${large ? 'avatar-lg' : ''} ${species === 'cat' ? 'avatar-cat' : ''}`} aria-hidden>
      <Icon />
    </span>
  )
}

// Loading: three paw prints stepping across. `small` fits inside a button; otherwise a centred block.
export function PawLoader({ label = 'Loading…', small }) {
  return (
    <span className={`paw-loader ${small ? 'paw-small' : ''}`} role="status" aria-live="polite">
      <span className="paw-steps" aria-hidden>
        <PawPrint className="paw paw-1" /><PawPrint className="paw paw-2" /><PawPrint className="paw paw-3" />
      </span>
      {small ? <span className="sr-only">{label}</span> : <span className="paw-label">{label}</span>}
    </span>
  )
}

export function ReviewBadge({ flags }) {
  if (!flags?.length) return null
  return (
    <span className="badge badge-warm" title={flags.map((f) => REVIEW_LABELS[f] || f).join(' · ')}>
      <TriangleAlert aria-hidden /> Check
    </span>
  )
}

export function Empty({ icon: Icon = PawPrint, title, text, children }) {
  return (
    <div className="empty">
      <Icon aria-hidden />
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {children}
    </div>
  )
}

// Pages as numbers in the middle with arrows either side; the count of rows bottom left.
// e.g. 1 … 4 5 [6] 7 8 … 146
export function pageList(page, pages) {
  const want = new Set([1, pages, page - 2, page - 1, page, page + 1, page + 2].filter((n) => n >= 1 && n <= pages))
  const out = []
  let last = 0
  for (const n of [...want].sort((x, y) => x - y)) {
    if (n - last > 1) out.push(n - last === 2 ? n - 1 : `gap-${n}`)
    out.push(n)
    last = n
  }
  return out
}

export function Pager({ page, pageSize, total, onPage, noun, right }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const from = total ? (page - 1) * pageSize + 1 : 0
  const to = Math.min(total, page * pageSize)
  return (
    <nav className="pager" aria-label="Pages">
      <span className="pager-count">{from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()} {noun}</span>
      {pages > 1 && (
        <div className="pager-pages">
          <button type="button" className="icon-btn" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous Page" title="Previous Page"><ChevronLeft /></button>
          {pageList(page, pages).map((n) => (typeof n === 'string'
            ? <span key={n} className="pager-gap" aria-hidden>…</span>
            : <button key={n} type="button" className="pager-num" aria-current={n === page ? 'page' : undefined} onClick={() => onPage(n)} aria-label={`Page ${n}`}>{n.toLocaleString()}</button>))}
          <button type="button" className="icon-btn" onClick={() => onPage(page + 1)} disabled={page >= pages} aria-label="Next Page" title="Next Page"><ChevronRight /></button>
        </div>
      )}
      {right ? <div className="pager-right">{right}</div> : <span aria-hidden />}
    </nav>
  )
}

export function ErrorNote({ error }) {
  if (!error) return null
  return (
    <div className="alert alert-error" role="alert">
      <TriangleAlert aria-hidden /> <span>{error.message || String(error)}</span>
    </div>
  )
}

// A labelled input. `error` shows under it; `hint` explains the format.
export function Field({ label, optional, hint, error, children }) {
  const id = useId()
  const child = typeof children === 'function' ? children({ id, 'aria-invalid': !!error, 'aria-describedby': `${id}-msg` }) : children
  return (
    <label className="field" htmlFor={id} data-invalid={!!error}>
      <span>{label}{optional && <small> (optional)</small>}</span>
      {child}
      {error ? <span id={`${id}-msg`} className="field-error">{error}</span> : hint ? <span id={`${id}-msg`} className="field-hint">{hint}</span> : null}
    </label>
  )
}

// Slide-over panel: Escape closes it, focus moves in on open and back out on close.
// Unsaved input is never lost by accident: closing with X, Escape or a click outside asks first when
// something was typed in a field (searches don't count) or the panel says it's `dirty` (picks made).
export function Panel({ title, intro, onClose, footer, children, busy, dirty, discardTitle, wide }) {
  const ref = useRef(null)
  const [typed, setTyped] = useState(false)
  const [asking, setAsking] = useState(false)
  const unsaved = !!dirty || typed
  const state = useRef({ unsaved, asking, busy, onClose })
  state.current = { unsaved, asking, busy, onClose }
  useEffect(() => { // closing or reloading the tab warns too
    if (!unsaved) return undefined
    const warn = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [unsaved])
  const request = useCallback(() => {
    const st = state.current
    if (st.busy) return
    if (st.unsaved) setAsking(true)
    else st.onClose()
  }, [])
  useEffect(() => {
    const before = document.activeElement
    const first = ref.current?.querySelector('input, select, textarea, button:not(.panel-close)')
    first?.focus()
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (state.current.asking) setAsking(false)
        else request()
      }
      if (e.key === 'Tab' && ref.current) {
        const items = [...ref.current.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select, textarea')]
        if (!items.length) return
        const [a, z] = [items[0], items[items.length - 1]]
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus() }
        else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus() }
      }
    }
    const onInput = (e) => { if (e.target.type !== 'search' && !e.target.closest('[data-no-dirty]')) setTyped(true) }
    const el = ref.current
    document.addEventListener('keydown', onKey)
    el?.addEventListener('input', onInput)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      el?.removeEventListener('input', onInput)
      document.body.style.overflow = ''
      before?.focus?.()
    }
  }, [request])
  return (
    <>
      <div className="scrim" onClick={request} />
      <aside className={`panel ${wide ? 'panel-wide' : ''}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} ref={ref}>
        <div className="panel-head">
          <div>
            <h2>{title}</h2>
            {intro && <p>{intro}</p>}
          </div>
          <button type="button" className="icon-btn panel-close" onClick={request} disabled={busy} aria-label="Close" title="Close (Esc)">
            <X />
          </button>
        </div>
        <div className="panel-body">{children}</div>
        {footer && <div className="panel-foot">{footer}</div>}
        {asking && <DiscardBox title={discardTitle || 'Discard your changes?'} onKeep={() => setAsking(false)} onDiscard={() => { setAsking(false); onClose() }} />}
      </aside>
    </>
  )
}

function DiscardBox({ title, onKeep, onDiscard }) {
  const keep = useRef(null)
  useEffect(() => { keep.current?.focus() }, [])
  return (
    <div className="discard-scrim" role="alertdialog" aria-modal="true" aria-labelledby="discard-title" aria-describedby="discard-text">
      <div className="discard-box card">
        <TriangleAlert aria-hidden />
        <h3 id="discard-title">{title}</h3>
        <p id="discard-text">What you’ve entered here hasn’t been saved and will be lost.</p>
        <div className="discard-actions">
          <button type="button" className="btn btn-quiet" onClick={onDiscard}>Discard</button>
          <button type="button" className="btn" onClick={onKeep} ref={keep}>Keep Editing</button>
        </div>
      </div>
    </div>
  )
}

// --- Toasts: short confirmations after saving ---
const ToastContext = createContext(() => {})
export function ToastProvider({ children }) {
  const [message, setMessage] = useState(null)
  const show = useCallback((text) => {
    setMessage(text)
    clearTimeout(show.timer)
    show.timer = setTimeout(() => setMessage(null), 3200)
  }, [])
  return (
    <ToastContext.Provider value={show}>
      {children}
      {message && (
        <div className="toast" role="status">
          <CircleCheck aria-hidden /> {message}
        </div>
      )}
    </ToastContext.Provider>
  )
}
export const useToast = () => useContext(ToastContext)
