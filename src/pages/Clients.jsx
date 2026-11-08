import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Crown, Search, UserPlus, Users } from 'lucide-react'
import { Empty, ErrorNote, PageHead, Pager, PetAvatar, ReviewBadge, useToast } from '../components/ui.jsx'
import { RegisterPanel } from '../components/ClientForms.jsx'
import { query } from '../lib/api.js'
import { useApi, useDebounced } from '../lib/useApi.js'
import { age, initials, prettyDay, SEX_LABEL, SPECIES_LABEL } from '../lib/format.js'

function LoadingRows({ cols }) {
  return Array.from({ length: 6 }, (_, i) => (
    <tr key={i} className="loading-row">
      {Array.from({ length: cols }, (_, j) => <td key={j}><span className="skeleton" style={{ width: `${60 + ((i + j) % 3) * 12}%` }} /></td>)}
    </tr>
  ))
}

function OwnersTable({ q, page, review, setPage, navigate }) {
  const { data, error, loading } = useApi(`owners${query({ q, page, review: review ? 1 : '' })}`)
  if (error) return <div className="card-pad"><ErrorNote error={error} /></div>
  if (data && !data.total) {
    return <Empty icon={Users} title={q ? `No owners match "${q}"` : 'No owners yet'} text={q ? 'Try part of the name, the mobile number or a pet\'s name.' : 'Register the first owner to get started.'} />
  }
  return (
    <>
      <table className="table">
        <thead><tr><th>Owner</th><th>Mobile</th><th>Pets</th><th className="hide-sm">Client since</th></tr></thead>
        <tbody aria-busy={loading}>
          {!data ? <LoadingRows cols={4} /> : data.owners.map((o) => (
            <tr key={o.id} onClick={() => navigate(`/clients/${o.id}`)}>
              <td>
                <div className="cell-main">
                  <span className="avatar" aria-hidden>{initials(o.name)}</span>
                  <span>
                    <Link className="row-link" to={`/clients/${o.id}`} onClick={(e) => e.stopPropagation()}><strong>{o.name}</strong></Link>
                    <span className="cell-sub">{o.customerNo} {o.vip && <Crown size={12} aria-label="VIP" />}</span>
                  </span>
                  <ReviewBadge flags={o.reviewFlags} />
                </div>
              </td>
              <td data-label="Mobile">{o.mobileLocal || <span className="muted">{o.mobileRaw || 'None'}</span>}</td>
              <td>
                <div className="chips">
                  {o.pets.slice(0, 3).map((p) => <span key={p.id} className="chip">{p.name}</span>)}
                  {o.pets.length > 3 && <span className="chip">+{o.pets.length - 3} more</span>}
                </div>
              </td>
              <td className="hide-sm">{prettyDay(o.since)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} noun="owners" />}
    </>
  )
}

function PetsTable({ q, page, species, setPage, navigate }) {
  const { data, error, loading } = useApi(`pets${query({ q, page, species })}`)
  if (error) return <div className="card-pad"><ErrorNote error={error} /></div>
  if (data && !data.total) return <Empty title={q ? `No pets match "${q}"` : 'No pets yet'} text="Try the pet's name, breed or microchip, or the owner's name." />
  return (
    <>
      <table className="table">
        <thead><tr><th>Pet</th><th>Sex</th><th>Age</th><th>Owner</th></tr></thead>
        <tbody aria-busy={loading}>
          {!data ? <LoadingRows cols={4} /> : data.pets.map((p) => (
            <tr key={p.id} onClick={() => navigate(`/pets/${p.id}`)}>
              <td>
                <div className="cell-main">
                  <PetAvatar species={p.species} />
                  <span>
                    <Link className="row-link" to={`/pets/${p.id}`} onClick={(e) => e.stopPropagation()}><strong>{p.name}</strong></Link>
                    <span className="cell-sub">{SPECIES_LABEL[p.species]}{p.breed ? ` · ${p.breed}` : ''}</span>
                  </span>
                  <ReviewBadge flags={p.reviewFlags} />
                </div>
              </td>
              <td data-label="Sex">{SEX_LABEL[p.sex]}</td>
              <td data-label="Age">{age(p.birthdate) || <span className="muted">Unknown</span>}</td>
              <td data-label="Owner">
                {p.owner.name}
                <span className="cell-sub">{p.owner.customerNo}{p.owner.mobileLocal ? ` · ${p.owner.mobileLocal}` : ''}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} noun="pets" />}
    </>
  )
}

export default function Clients() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const toast = useToast()
  const tab = params.get('tab') === 'pets' ? 'pets' : 'owners'
  const page = Number(params.get('page')) || 1
  const review = params.get('review') === '1'
  const species = params.get('species') || ''
  const [text, setText] = useState(params.get('q') || '')
  const q = useDebounced(text.trim())

  const update = (patch) => {
    const next = new URLSearchParams(params)
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)))
    setParams(next, { replace: true })
  }
  // Keep the search in the address (so Back returns to it); a new search starts from page 1.
  const urlQ = params.get('q') || ''
  useEffect(() => {
    if (q === urlQ) return
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      if (q) next.set('q', q); else next.delete('q')
      next.delete('page')
      return next
    }, { replace: true })
  }, [q, urlQ, setParams])

  return (
    <>
      <PageHead title={<>Clients &amp; <em>pets</em></>} intro="Search by owner, mobile number, customer number or pet.">
        <button type="button" className="btn" onClick={() => update({ new: '1' })}><UserPlus aria-hidden /> Register owner</button>
      </PageHead>

      <section className="card">
        <div className="toolbar">
          <div className="tabs" role="group" aria-label="Show">
            <button type="button" className="tab" aria-pressed={tab === 'owners'} onClick={() => update({ tab: '', page: '', species: '' })}>Owners</button>
            <button type="button" className="tab" aria-pressed={tab === 'pets'} onClick={() => update({ tab: 'pets', page: '', review: '' })}>Pets</button>
          </div>
          <div className="search">
            <Search aria-hidden />
            <label className="sr-only" htmlFor="client-search">Search</label>
            <input id="client-search" type="search" value={text} onChange={(e) => setText(e.target.value)}
              placeholder={tab === 'owners' ? 'Name, mobile, C-number or pet' : 'Pet name, breed, microchip or owner'} autoComplete="off" />
          </div>
          {tab === 'owners' ? (
            <div className="tabs" role="group" aria-label="Filter">
              <button type="button" className="tab" aria-pressed={!review} onClick={() => update({ review: '', page: '' })}>All</button>
              <button type="button" className="tab" aria-pressed={review} onClick={() => update({ review: '1', page: '' })}>Needs a check</button>
            </div>
          ) : (
            <div className="tabs" role="group" aria-label="Species">
              {[['', 'All'], ['dog', 'Dogs'], ['cat', 'Cats']].map(([v, label]) => (
                <button key={label} type="button" className="tab" aria-pressed={species === v} onClick={() => update({ species: v, page: '' })}>{label}</button>
              ))}
            </div>
          )}
        </div>
        {tab === 'owners'
          ? <OwnersTable q={urlQ} page={page} review={review} setPage={(p) => update({ page: p > 1 ? String(p) : '' })} navigate={navigate} />
          : <PetsTable q={urlQ} page={page} species={species} setPage={(p) => update({ page: p > 1 ? String(p) : '' })} navigate={navigate} />}
      </section>

      {params.get('new') === '1' && (
        <RegisterPanel
          onClose={() => update({ new: '' })}
          onDone={(owner) => {
            toast(`${owner.name} registered as ${owner.customerNo}`)
            navigate(`/clients/${owner.id}`)
          }}
        />
      )}
    </>
  )
}
