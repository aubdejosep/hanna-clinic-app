// Small, quiet charts for the owners' overview. Marks carry colour; text stays in the two text colours.
// Hover any mark for its exact value. Colours: --chart-1 (teal) and --chart-2 (dark apricot), checked
// for colour-blind separation and contrast; the previous period is a neutral grey line.
import { useId, useState } from 'react'

const fmt = (n) => Number(n || 0).toLocaleString()
const fmtN = fmt
function niceMax(v) {
  if (v <= 4) return 4
  const p = 10 ** Math.floor(Math.log10(v))
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v)
}

// This period against the last, one point per day.
export function CompareLine({ current, previous, labelOf, money }) {
  const fmt = money ? (n) => `₱${Number(n || 0).toLocaleString('en-PH', { maximumFractionDigits: 0 })}` : fmtN
  const [hover, setHover] = useState(null)
  const id = useId()
  const W = 640
  const H = 230
  const pad = { l: money ? 62 : 34, r: 12, t: 12, b: 26 }
  const n = Math.max(current.length, previous.length, 2)
  const max = niceMax(Math.max(1, ...current.map((d) => d.n), ...previous.map((d) => d.n)))
  const x = (i) => pad.l + (i * (W - pad.l - pad.r)) / (n - 1)
  const y = (v) => H - pad.b - (v / max) * (H - pad.t - pad.b)
  const path = (pts) => pts.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.n).toFixed(1)}`).join('')
  const ticks = [0, max / 2, max]
  const step = Math.ceil(n / 6)
  return (
    <div className="chart" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={`${id}-t`}>
        <title id={`${id}-t`}>{money ? 'Revenue' : 'Visits'} per day: {fmt(current.reduce((s, d) => s + d.n, 0))} this period, {fmt(previous.reduce((s, d) => s + d.n, 0))} the period before</title>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="chart-grid" />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="chart-axis">{fmt(t)}</text>
          </g>
        ))}
        {current.map((d, i) => (i % step === 0 || i === current.length - 1) && <text key={d.day} x={x(i)} y={H - 8} textAnchor="middle" className="chart-axis">{labelOf(d.day)}</text>)}
        <path d={path(previous)} className="chart-line-prev" />
        <path d={`${path(current)}L${x(current.length - 1)},${y(0)}L${x(0)},${y(0)}Z`} className="chart-area" />
        <path d={path(current)} className="chart-line" />
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} className="chart-cross" />}
        {hover !== null && current[hover] && <circle cx={x(hover)} cy={y(current[hover].n)} r="5" className="chart-dot" />}
        {Array.from({ length: n }, (_, i) => (
          <rect key={i} x={x(i) - (W - pad.l - pad.r) / (n - 1) / 2} y={pad.t} width={(W - pad.l - pad.r) / (n - 1)} height={H - pad.t - pad.b} fill="transparent" onMouseEnter={() => setHover(i)} />
        ))}
      </svg>
      {hover !== null && (
        <div className="chart-tip" style={{ left: `${(x(hover) / W) * 100}%` }}>
          <strong>{current[hover] ? labelOf(current[hover].day) : ''}</strong>
          <span><i className="key key-1" /> {fmt(current[hover]?.n)} this period</span>
          <span><i className="key key-prev" /> {fmt(previous[hover]?.n)} period before</span>
        </div>
      )}
      <div className="chart-legend"><span><i className="key key-1" /> This period</span><span><i className="key key-prev" /> Period before</span></div>
    </div>
  )
}

// Horizontal bars, biggest first, value at the tip.
export function BarList({ rows, empty }) {
  if (!rows.length) return <p className="muted chart-empty">{empty}</p>
  const max = Math.max(...rows.map((r) => r.n), 1)
  return (
    <ul className="barlist">
      {rows.map((r) => (
        <li key={r.name} title={`${r.name}: ${fmt(r.n)}`}>
          <span className="barlist-name">{r.name}</span>
          <span className="barlist-track"><span className="barlist-bar" style={{ width: `${Math.max(2, (r.n / max) * 100)}%` }} /></span>
          <span className="barlist-val">{fmt(r.n)}</span>
        </li>
      ))}
    </ul>
  )
}

// Vertical columns (busiest days, busiest hours).
export function Columns({ rows, empty }) {
  if (!rows.some((r) => r.n)) return <p className="muted chart-empty">{empty}</p>
  const max = Math.max(...rows.map((r) => r.n), 1)
  const top = rows.reduce((a, b) => (b.n > a.n ? b : a))
  return (
    <div className="columns" role="img" aria-label={rows.map((r) => `${r.label}: ${r.n}`).join(', ')}>
      {rows.map((r) => (
        <div key={r.label} className="column" title={`${r.label}: ${fmt(r.n)}`}>
          <span className="column-val">{r === top ? fmt(r.n) : ''}</span>
          <span className="column-track"><span className="column-bar" style={{ height: `${(r.n / max) * 100}%` }} /></span>
          <span className="column-label">{r.label}</span>
        </div>
      ))}
    </div>
  )
}

// Two parts of a whole (new vs returning), with a legend and the numbers beside it.
export function Split({ a, b }) {
  const total = a.n + b.n
  if (!total) return <p className="muted chart-empty">No visits in this period.</p>
  const pa = Math.round((a.n / total) * 100)
  return (
    <div className="split">
      <div className="split-bar" role="img" aria-label={`${a.label} ${a.n}, ${b.label} ${b.n}`}>
        {a.n > 0 && <span className="split-a" style={{ width: `${(a.n / total) * 100}%` }} title={`${a.label}: ${fmt(a.n)}`} />}
        {b.n > 0 && <span className="split-b" style={{ width: `${(b.n / total) * 100}%` }} title={`${b.label}: ${fmt(b.n)}`} />}
      </div>
      <div className="chart-legend">
        <span><i className="key key-1" /> {a.label}: <strong>{fmt(a.n)}</strong> ({pa}%)</span>
        <span><i className="key key-2" /> {b.label}: <strong>{fmt(b.n)}</strong> ({100 - pa}%)</span>
      </div>
    </div>
  )
}

// Retention cohorts: one row per joining month, one cell per month after. Sequential teal, light to
// dark; 0% is the plain surface. Hover (or focus) a cell for the exact count.
export const COHORT_BINS = [
  { min: 0, max: 0, label: '0%', step: 0 },
  { min: 0.01, max: 4.99, label: 'Under 5%', step: 1 },
  { min: 5, max: 9.99, label: '5–9%', step: 2 },
  { min: 10, max: 19.99, label: '10–19%', step: 3 },
  { min: 20, max: 34.99, label: '20–34%', step: 4 },
  { min: 35, max: 100, label: '35% and up', step: 5 },
]
const binOf = (pct) => COHORT_BINS.find((b) => pct >= b.min && pct <= b.max) || COHORT_BINS[0]
const monthName = (ym) => new Date(`${ym}-01T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })

export function CohortGrid({ cohorts }) {
  const [hover, setHover] = useState(null)
  return (
    <div className="cohort-wrap">
      <table className="cohort">
        <caption className="sr-only">Share of each month's new clients seen again in each month after</caption>
        <thead><tr><th scope="col">Joined</th>{Array.from({ length: 12 }, (_, i) => <th key={i} scope="col">M{i + 1}</th>)}</tr></thead>
        <tbody>
          {cohorts.map((c) => (
            <tr key={c.month}>
              <th scope="row"><strong>{monthName(c.month)}</strong> <span className="cell-sub">{c.size}</span></th>
              {Array.from({ length: 12 }, (_, i) => {
                const m = c.months[i]
                if (!m || !c.size) return <td key={i} className="cohort-none">—</td>
                const b = binOf(m.pct)
                const tip = `Joined ${monthName(c.month)}: ${m.n} of ${c.size} seen again in month ${m.m} (${m.pct}%)${m.partial ? ', month not over yet' : ''}`
                return (
                  <td key={i} className={`cohort-cell cohort-s${b.step} ${m.partial ? 'is-partial' : ''}`} tabIndex={0} aria-label={tip} title={tip}
                    onMouseEnter={() => setHover(tip)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(tip)} onBlur={() => setHover(null)}>
                    {m.pct ? `${Math.round(m.pct)}%` : '0'}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="cohort-foot">
        <ul className="cohort-legend" aria-label="Legend">
          {COHORT_BINS.map((b) => <li key={b.step}><span className={`cohort-key cohort-s${b.step}`} aria-hidden />{b.label}</li>)}
          <li><span className="cohort-key cohort-s2 is-partial" aria-hidden />This month, not over yet</li>
        </ul>
        <span className="cell-sub" aria-live="polite">{hover || 'Hover a cell for the count.'}</span>
      </div>
    </div>
  )
}
