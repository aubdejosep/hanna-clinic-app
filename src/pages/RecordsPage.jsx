import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, FileHeart, Search } from 'lucide-react'
import { Empty, ErrorNote, PageHead, PetAvatar, PawLoader } from '../components/ui.jsx'
import { EntryBadge } from '../components/MedicalRecords.jsx'
import { query } from '../lib/api.js'
import { useApi, useDebounced } from '../lib/useApi.js'
import { prettyDay } from '../lib/format.js'

const TYPES = [['', 'All'], ['vaccination', 'Vaccinations'], ['diagnosis', 'Diagnoses'], ['note', 'Notes'], ['treatment_plan', 'Treatment Plans']]

export default function RecordsPage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const update = (patch) => setParams((prev) => {
    const next = new URLSearchParams(prev)
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, String(v)) : next.delete(k)))
    return next
  }, { replace: true })
  const type = params.get('type') || ''
  const page = Number(params.get('page')) || 1
  const [text, setText] = useState(params.get('q') || '')
  const q = useDebounced(text.trim())
  useEffect(() => { if (q !== (params.get('q') || '')) update({ q, page: '' }) }, [q]) // eslint-disable-line react-hooks/exhaustive-deps
  const { data, error, loading } = useApi(`records${query({ q: params.get('q') || '', type, page })}`)
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <>
      <PageHead crumbs={[{ label: 'Medical Records' }, { label: 'Records List' }]} title="Records List" intro="Every medical record, newest first. Open one to see the pet's full history." />
      <section className="card">
        <div className="toolbar">
          <div className="search">
            <Search aria-hidden />
            <label className="sr-only" htmlFor="rec-search">Search</label>
            <input id="rec-search" type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Pet, owner, diagnosis or service" autoComplete="off" />
          </div>
          <div className="tabs" role="group" aria-label="Type">
            {TYPES.map(([k, l]) => <button key={l} type="button" className="tab" aria-pressed={type === k} onClick={() => update({ type: k, page: '' })}>{l}</button>)}
          </div>
        </div>
        {error ? <div className="card-pad"><ErrorNote error={error} /></div> : data && !data.total ? (
          <Empty icon={FileHeart} title={params.get('q') ? `No records match "${params.get('q')}"` : 'No records here'} text="Try the pet's or owner's name, or a word from the diagnosis." />
        ) : (
          <>
            <table className="table">
              <thead><tr><th>Date</th><th>Pet &amp; Owner</th><th>Entries</th><th className="hide-sm">Kind</th></tr></thead>
              <tbody aria-busy={loading}>
                {!data && <tr className="no-hover"><td colSpan={4}><PawLoader label="Loading records…" /></td></tr>}
                {(data?.records || []).map((r) => (
                  <tr key={r.id} onClick={() => navigate(`/pets/${r.pet.id}#record-${r.id}`)}>
                    <td data-label="Date" style={{ whiteSpace: 'nowrap' }}>{prettyDay(r.day)}</td>
                    <td>
                      <div className="cell-main">
                        <PetAvatar species={r.pet.species} />
                        <span>
                          <Link className="row-link" to={`/pets/${r.pet.id}#record-${r.id}`} onClick={(e) => e.stopPropagation()}><strong>{r.pet.name}</strong></Link>
                          <span className="cell-sub">{r.owner.name}{r.owner.mobileLocal ? ` · ${r.owner.mobileLocal}` : ''}</span>
                        </span>
                      </div>
                    </td>
                    <td data-label="Entries">
                      <div className="record-row-entries">
                        {r.entries.slice(0, 2).map((e) => <span key={e.id}><EntryBadge type={e.type} /> {e.title}</span>)}
                        {r.entries.length > 2 && <span className="cell-sub">+{r.entries.length - 2} more</span>}
                      </div>
                    </td>
                    <td className="hide-sm">{r.kind === 'visit' ? 'Visit' : 'Record'}{r.appointmentNo && <span className="cell-sub">#{r.appointmentNo}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data && (
              <div className="pager">
                <span>{data.total.toLocaleString()} records · page {page} of {pages}</span>
                <div className="pager-btns">
                  <button type="button" className="icon-btn" onClick={() => update({ page: page - 1 > 1 ? page - 1 : '' })} disabled={page <= 1} aria-label="Previous Page" title="Previous Page"><ChevronLeft /></button>
                  <button type="button" className="icon-btn" onClick={() => update({ page: page + 1 })} disabled={page >= pages} aria-label="Next Page" title="Next Page"><ChevronRight /></button>
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </>
  )
}
