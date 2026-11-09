import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Cat, ChevronLeft, ChevronRight, CircleCheck, Dog, PawPrint, TriangleAlert, X } from 'lucide-react'
import { REVIEW_LABELS } from '../lib/labels.js'

export function PageHead({ crumbs, title, intro, children }) {
  return (
    <header>
      {crumbs && (
        <nav className="crumbs" aria-label="Breadcrumb">
          {crumbs.map((c, i) => (
            <span key={c.label} style={{ display: 'contents' }}>
              {i > 0 && <ChevronRight size={14} aria-hidden />}
              {c.to ? <Link to={c.to}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}
            </span>
          ))}
        </nav>
      )}
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

export function Pager({ page, pageSize, total, onPage, noun }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const from = total ? (page - 1) * pageSize + 1 : 0
  const to = Math.min(total, page * pageSize)
  return (
    <div className="pager">
      <span>{from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()} {noun}</span>
      <div className="pager-btns">
        <button type="button" className="icon-btn" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous Page" title="Previous Page">
          <ChevronLeft />
        </button>
        <button type="button" className="icon-btn" onClick={() => onPage(page + 1)} disabled={page >= pages} aria-label="Next Page" title="Next Page">
          <ChevronRight />
        </button>
      </div>
    </div>
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
export function Panel({ title, intro, onClose, footer, children, busy }) {
  const ref = useRef(null)
  useEffect(() => {
    const before = document.activeElement
    const first = ref.current?.querySelector('input, select, textarea, button:not(.panel-close)')
    first?.focus()
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) onClose()
      if (e.key === 'Tab' && ref.current) {
        const items = [...ref.current.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select, textarea')]
        if (!items.length) return
        const [a, z] = [items[0], items[items.length - 1]]
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus() }
        else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus() }
      }
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      before?.focus?.()
    }
  }, [onClose, busy])
  return (
    <>
      <div className="scrim" onClick={() => !busy && onClose()} />
      <aside className="panel" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} ref={ref}>
        <div className="panel-head">
          <div>
            <h2>{title}</h2>
            {intro && <p>{intro}</p>}
          </div>
          <button type="button" className="icon-btn panel-close" onClick={onClose} disabled={busy} aria-label="Close" title="Close (Esc)">
            <X />
          </button>
        </div>
        <div className="panel-body">{children}</div>
        {footer && <div className="panel-foot">{footer}</div>}
      </aside>
    </>
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
