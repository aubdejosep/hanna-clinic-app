// User Guide (every staff member): step-by-step guides with screenshots. The screenshots (public/guide/*.webp) were
// taken from a demo copy of the app with made-up clients only: never use real client screens here.
// The guides themselves are in src/lib/guides.jsx (also searched by the search box beside the bell).
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { BookOpen, ChevronRight, X } from 'lucide-react'
import { GUIDES, stepId } from '../lib/guides.jsx'
import { PageHead } from '../components/ui.jsx'


function Shot({ s }) {
  const [big, setBig] = useState(false)
  useEffect(() => { if (!big) return undefined; const k = (e) => { if (e.key === 'Escape') setBig(false) }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [big])
  return (
    <>
      <button type="button" className={`ug-shot ${s.phone ? 'is-phone' : ''}`} onClick={() => setBig(true)} title="See it bigger">
        <img src={`/guide/${s.img}.webp`} alt={s.alt} loading="lazy" width={s.phone ? 520 : 1280} height={s.phone ? 1125 : 800} />
      </button>
      {big && (
        <div className="lightbox" role="dialog" aria-modal="true" aria-label={s.alt} onClick={() => setBig(false)}>
          <img src={`/guide/${s.img}.webp`} alt={s.alt} />
          <button type="button" className="icon-btn rc-lightbox-close" onClick={() => setBig(false)} aria-label="Close" title="Close"><X /></button>
        </div>
      )}
    </>
  )
}

export default function UserGuidePage() {
  const [params, setParams] = useSearchParams()
  const open = GUIDES.find((g) => g.id === params.get('g'))
  const step = params.get('s')
  useEffect(() => {
    if (!open) return
    if (!step) { window.scrollTo(0, 0); return undefined }
    // Again as the screenshots above it load (they push the step down).
    const to = () => document.getElementById(`step-${step}`)?.scrollIntoView({ block: 'start' })
    const timers = [0, 300, 800, 1600].map((ms) => setTimeout(to, ms))
    return () => timers.forEach(clearTimeout)
  }, [open?.id, step]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!open) {
    return (
      <>
        <PageHead crumbs={[{ label: 'User Guide' }]} title="User Guide" intro="Step-by-step guides to the app, with pictures. Tap a guide to open it." />
        <div className="ug-list">
          {GUIDES.map((g) => (
            <button key={g.id} type="button" className="card ug-item" onClick={() => setParams({ g: g.id })}>
              <span className="avatar"><g.icon aria-hidden /></span>
              <span><strong>{g.title}</strong><span className="cell-sub">{g.intro}</span></span>
              <ChevronRight aria-hidden />
            </button>
          ))}
        </div>
      </>
    )
  }
  return (
    <>
      <PageHead crumbs={[{ label: 'User Guide', to: '/guide' }, { label: open.title }]} title={open.title} intro={open.intro} />
      <ol className="ug-steps">
        {open.steps.map((s, i) => (
          <li key={stepId(s)} id={`step-${stepId(s)}`} className={`card ug-step ${s.img ? '' : 'is-text'} ${step === stepId(s) ? 'is-found' : ''}`}>
            <div className="ug-text">
              <span className="ug-no">{i + 1}</span>
              <div><h2>{s.title}</h2><p>{s.text}</p></div>
            </div>
            {s.img && <Shot s={s} />}
          </li>
        ))}
      </ol>
      {open.tips?.length > 0 && (
        <section className="card card-pad ug-tips">
          <h2><BookOpen aria-hidden /> Good to Know</h2>
          <ul>{open.tips.map((t, i) => <li key={i}>{t}</li>)}</ul>
        </section>
      )}
      <div className="inline-row" style={{ marginTop: 16 }}>
        <button type="button" className="btn btn-quiet" onClick={() => setParams({})}>Back to All Guides</button>
      </div>
    </>
  )
}
