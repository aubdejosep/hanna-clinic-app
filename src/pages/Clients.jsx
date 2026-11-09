import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Crown, PawPrint, RotateCcw, Search, Trash2, UserPlus, Users } from 'lucide-react'
import { Empty, ErrorNote, PageHead, Pager, PetAvatar, ReviewBadge, useToast } from '../components/ui.jsx'
import { RegisterPanel, RegisterPetPanel } from '../components/ClientForms.jsx'
import { api, query } from '../lib/api.js'
import { canManage, useStaff } from '../lib/staff.js'
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
        <thead><tr><th>Owner</th><th>Mobile</th><th>Pets</th><th className="hide-sm">Client Since</th></tr></thead>
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

function PetsTable({ q, page, species, status, setPage, navigate }) {
  const { data, error, loading } = useApi(`pets${query({ q, page, species, status })}`)
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
                  {p.deceasedOn && <span className="badge badge-soft">Passed Away</span>}
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

// Owners and pets that were removed, newest first, each with Restore. Owners only.
function RemovedSection({ kind, q, toast }) {
  const [page, setPage] = useState(1)
  const [busy, setBusy] = useState(null)
  const path = kind === 'owners' ? 'owners' : 'pets'
  const { data, error, loading, reload } = useApi(`${path}${query({ q, page, removed: 1 })}`)
  const rows = data ? data[path] : null

  async function restore(row) {
    setBusy(row.id)
    try {
      await api(`${path}/${row.id}/restore`, { method: 'POST' })
      toast(`${row.name} restored`)
      reload()
    } catch (err) {
      toast(err.message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section>
      <div className="card-head"><div><h2>Removed {kind}</h2><p>{data ? `${data.total} removed` : '…'}</p></div></div>
      {error ? <div className="card-pad"><ErrorNote error={error} /></div> : rows && !rows.length ? (
        <p className="card-pad" style={{ margin: 0 }}>{q ? `No removed ${kind} match "${q}".` : `No removed ${kind}.`}</p>
      ) : (
        <>
          <table className="table">
            <thead><tr><th>{kind === 'owners' ? 'Owner' : 'Pet'}</th><th>Removed</th><th><span className="sr-only">Restore</span></th></tr></thead>
            <tbody aria-busy={loading}>
              {!rows ? <LoadingRows cols={3} /> : rows.map((r) => (
                <tr key={r.id} style={{ cursor: 'default' }}>
                  <td>
                    <div className="cell-main">
                      {kind === 'owners' ? <span className="avatar" aria-hidden>{initials(r.name)}</span> : <PetAvatar species={r.species} />}
                      <span>
                        <strong>{r.name}</strong>
                        <span className="cell-sub">
                          {kind === 'owners'
                            ? `${r.customerNo}${r.pets.length ? ` · ${r.pets.map((p) => p.name).join(', ')}` : ''}`
                            : `${SPECIES_LABEL[r.species]} · ${r.owner.name} (${r.owner.customerNo})`}
                        </span>
                      </span>
                    </div>
                  </td>
                  <td data-label="Removed">{prettyDay(r.removedAt.slice(0, 10))}<span className="cell-sub">by {r.removedBy || 'staff'}</span></td>
                  <td style={{ textAlign: 'right' }}>
                    <button type="button" className="btn btn-quiet" onClick={() => restore(r)} disabled={busy === r.id}>
                      <RotateCcw aria-hidden /> {busy === r.id ? 'Restoring…' : 'Restore'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && data.total > data.pageSize && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} noun={kind} />}
        </>
      )}
    </section>
  )
}

export default function Clients() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const toast = useToast()
  const staff = useStaff()
  const tabParam = params.get('tab')
  const tab = ['pets', 'deceased'].includes(tabParam) ? tabParam : tabParam === 'removed' && canManage(staff) ? 'removed' : 'owners'
  const counts = useApi('stats').data
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
      <PageHead crumbs={[{ label: 'Client Portal' }, { label: 'Masterlist' }]} title="Masterlist" intro="View and manage clients and their pets.">
        <div className="head-actions">
          <button type="button" className="btn" onClick={() => update({ new: '1' })}><UserPlus aria-hidden /> Register Owner</button>
          <button type="button" className="btn btn-quiet" onClick={() => update({ newpet: '1' })}><PawPrint aria-hidden /> Register Pet</button>
        </div>
      </PageHead>

      <section className="card">
        <div className="toolbar">
          <div className="tabs" role="group" aria-label="Show">
            {[['owners', 'Pet Owners', counts?.owners.total], ['pets', 'Active Pets', counts?.petsActive], ['deceased', 'Deceased Pets', counts?.petsDeceased]].map(([key, label, n]) => (
              <button key={key} type="button" className="tab" aria-pressed={tab === key}
                onClick={() => update({ tab: key === 'owners' ? '' : key, page: '', review: '', species: '' })}>
                {label}{n != null && <span className="tab-count">{n.toLocaleString()}</span>}
              </button>
            ))}
            {canManage(staff) && (
              <button type="button" className="tab" aria-pressed={tab === 'removed'} onClick={() => update({ tab: 'removed', page: '', review: '', species: '' })}>
                <Trash2 size={14} aria-hidden /> Removed
              </button>
            )}
          </div>
          <div className="search">
            <Search aria-hidden />
            <label className="sr-only" htmlFor="client-search">Search</label>
            <input id="client-search" type="search" value={text} onChange={(e) => setText(e.target.value)}
              placeholder={tab === 'pets' || tab === 'deceased' ? 'Pet name, breed, microchip or owner' : 'Name, mobile, C-number or pet'} autoComplete="off" />
          </div>
          {tab === 'owners' ? (
            <div className="tabs" role="group" aria-label="Filter">
              <button type="button" className="tab" aria-pressed={!review} onClick={() => update({ review: '', page: '' })}>All</button>
              <button type="button" className="tab" aria-pressed={review} onClick={() => update({ review: '1', page: '' })}>Needs a check</button>
            </div>
          ) : (tab === 'pets' || tab === 'deceased') && (
            <div className="tabs" role="group" aria-label="Species">
              {[['', 'All'], ['dog', 'Dogs'], ['cat', 'Cats']].map(([v, label]) => (
                <button key={label} type="button" className="tab" aria-pressed={species === v} onClick={() => update({ species: v, page: '' })}>{label}</button>
              ))}
            </div>
          )}
        </div>
        {tab === 'owners' && <OwnersTable q={urlQ} page={page} review={review} setPage={(p) => update({ page: p > 1 ? String(p) : '' })} navigate={navigate} />}
        {(tab === 'pets' || tab === 'deceased') && <PetsTable q={urlQ} page={page} species={species} status={tab === 'pets' ? 'active' : 'deceased'} setPage={(p) => update({ page: p > 1 ? String(p) : '' })} navigate={navigate} />}
        {tab === 'removed' && (
          <>
            <RemovedSection kind="owners" q={urlQ} toast={toast} />
            <RemovedSection kind="pets" q={urlQ} toast={toast} />
          </>
        )}
      </section>

      {params.get('newpet') === '1' && (
        <RegisterPetPanel
          onClose={() => update({ newpet: '' })}
          onDone={(pet) => { toast(`${pet.name} registered`); navigate(`/pets/${pet.id}`) }}
        />
      )}
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
