import { Link } from 'react-router-dom'
import { CalendarDays, Coins, PawPrint, Stethoscope, TriangleAlert, UserPlus, Users } from 'lucide-react'
import { Empty, ErrorNote, PageHead } from '../components/ui.jsx'
import { useApi } from '../lib/useApi.js'
import { percentChange, prettyDay } from '../lib/format.js'

function Trend({ now, before }) {
  const pct = percentChange(now, before)
  if (pct === null) return <span className="stat-note">{now} new this month</span>
  return (
    <span className="stat-note">
      {now} new this month · <span className={pct >= 0 ? 'trend-up' : 'trend-down'}>{pct >= 0 ? '+' : ''}{pct}%</span> vs same days last month
    </span>
  )
}

function Stat({ icon: Icon, label, value, children, placeholder }) {
  return (
    <div className={`card stat ${placeholder ? 'placeholder' : ''}`}>
      <div className="stat-top">
        <span className="label">{label}</span>
        <Icon aria-hidden />
      </div>
      <div className="stat-value">{value}</div>
      {children}
    </div>
  )
}

export default function Dashboard() {
  const { data, error } = useApi('stats')
  const s = data
  return (
    <>
      <PageHead title={<>Clinic dashboard</>} intro={s ? prettyDay(s.today) : ' '}>
        <Link className="btn" to="/clients?new=1"><UserPlus aria-hidden /> Register owner</Link>
      </PageHead>
      <ErrorNote error={error} />

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Stat icon={Users} label="Pet owners" value={s ? s.owners.total.toLocaleString() : '…'}>
          {s && <Trend now={s.owners.monthToDate} before={s.owners.previous} />}
        </Stat>
        <Stat icon={PawPrint} label="Pets registered" value={s ? s.pets.total.toLocaleString() : '…'}>
          {s && <Trend now={s.pets.monthToDate} before={s.pets.previous} />}
        </Stat>
        <Stat icon={Stethoscope} label="Services rendered" value="—" placeholder>
          <span className="stat-note">Starts counting with appointments (phase 2)</span>
        </Stat>
        <Stat icon={Coins} label="Revenue" value="—" placeholder>
          <span className="stat-note">Placeholder until billing is planned</span>
        </Stat>
      </div>

      <div className="grid grid-2">
        <section className="card placeholder">
          <div className="card-head">
            <div><h2>Today&rsquo;s appointments</h2><p>Arrived, waiting and done</p></div>
          </div>
          <Empty icon={CalendarDays} title="Arrives in phase 2" text="Today's list, walk-ins and NFC tag check-ins will show here." />
        </section>
        <section className="card">
          <div className="card-head">
            <div><h2>Records to check</h2><p>Found while importing from the old system</p></div>
          </div>
          <div className="card-pad">
            {s && s.ownersToReview > 0 ? (
              <>
                <p style={{ marginTop: 0 }}>
                  <strong>{s.ownersToReview} owners</strong> have a missing or shared mobile number, or a duplicate name.
                  Fixing them means reminders reach the right person.
                </p>
                <Link className="btn btn-quiet" to="/clients?review=1"><TriangleAlert aria-hidden /> Review owners</Link>
              </>
            ) : (
              <p className="muted" style={{ margin: 0 }}>{s ? 'Nothing to check. Every owner has a usable mobile number.' : '…'}</p>
            )}
          </div>
        </section>
      </div>
    </>
  )
}
