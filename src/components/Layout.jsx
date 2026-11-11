import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { Activity, Boxes, CalendarDays, ChevronDown, ChevronRight, FolderOpen, Inbox, LayoutDashboard, LogOut, Menu, UserRound, X } from 'lucide-react'
import { api } from '../lib/api.js'
import { initials } from '../lib/format.js'
import { canManage, ROLE_LABEL } from '../lib/staff.js'
import AccountPanel from './AccountPanel.jsx'
import TagCheckIn from './TagCheckIn.jsx'
import ReminderBell from './ReminderBell.jsx'
import OmniSearch from './OmniSearch.jsx'
import QuickActions from './QuickActions.jsx'

// The menu follows the old system's order and names, with its expandable groups.
// "soon" items open a placeholder page until their phase lands.
const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { label: 'Clinic Operations', icon: Activity, children: [
    { to: '/clinic/profile', label: 'Clinic Profile' },
    { to: '/clinic/staff', label: 'Staff', owners: true },
    { to: '/clinic/services', label: 'Services' },
  ] },
  { to: '/appointments', label: 'Appointments', icon: CalendarDays },
  { label: 'Client Portal', icon: UserRound, children: [
    { to: '/clients', label: 'Masterlist' },
    { to: '/analytics/customers', label: 'Customer Analytics', owners: true },
  ] },
  { label: 'Medical Records', icon: FolderOpen, children: [
    { to: '/records', label: 'Records List' },
    { to: '/records/templates', label: 'Templates', soon: true },
  ] },
  { label: 'Inventory', icon: Boxes, children: [
    { to: '/inventory', label: 'Product List' },
    { to: '/inventory/movements', label: 'Stock Movements' },
    { to: '/inventory/counts', label: 'Stock Count' },
  ] },
  { to: '/inbox', label: 'Inbox', icon: Inbox, soon: true },
]

const isInside = (group, pathname) => group.children.some((c) => pathname === c.to || pathname.startsWith(`${c.to}/`) || (c.to === '/clients' && pathname.startsWith('/pets')))

function NavGroup({ group, pathname, staff }) {
  const inside = isInside(group, pathname)
  const [open, setOpen] = useState(inside)
  useEffect(() => { if (inside) setOpen(true) }, [inside])
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <div className="nav-groupbox">
      <button type="button" className={`nav-link nav-parent ${inside ? 'inside' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <group.icon aria-hidden /> {group.label}
        {group.soon && <span className="badge badge-soft soon">Soon</span>}
        <Chevron className="nav-chevron" aria-hidden />
      </button>
      {open && (
        <div className="nav-children">
          {group.children.filter((c) => !c.owners || canManage(staff)).map((c) => (
            <NavLink key={c.to} to={c.to} end={c.to === '/records' || c.to === '/inventory'} className={({ isActive }) => `nav-link nav-child ${isActive || (c.to === '/clients' && pathname.startsWith('/pets')) ? 'active' : ''}`}>
              {c.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  )
}

function Brand() {
  return (
    <NavLink to="/" className="brand" aria-label="Hanna Pet Wellness Center: Dashboard" title="Dashboard">
      <img src="/brand/logo-192.png" alt="Hanna Pet Wellness Center" width="96" height="96" />
    </NavLink>
  )
}

// One bell at a time: in the sidebar on wide screens, in the top bar on phones (same breakpoint as the CSS).
function useMobile() {
  const query = '(max-width: 860px)'
  const [m, setM] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setM(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return m
}

async function logOut() {
  try {
    await api('auth/logout', { method: 'POST' })
  } finally {
    window.location.assign('/')
  }
}

export default function Layout({ staff }) {
  const [open, setOpen] = useState(false)
  const [account, setAccount] = useState(false)
  const { pathname } = useLocation()
  const mobile = useMobile()
  useEffect(() => setOpen(false), [pathname])

  return (
    <div className="shell" data-nav={open ? 'open' : 'closed'}>
      <div className="topbar">
        <button type="button" className="icon-btn" onClick={() => setOpen(true)} aria-label="Open Menu" aria-expanded={open}>
          <Menu />
        </button>
        <Brand />
        {mobile && <div className="topbar-bell"><OmniSearch mobile /><ReminderBell align="right" /></div>}
      </div>

      <nav className="sidebar" aria-label="Main">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <Brand />
          {open && (
            <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Close Menu">
              <X />
            </button>
          )}
        </div>
        {NAV.map((item) => item.children ? (
          <NavGroup key={item.label} group={item} pathname={pathname} staff={staff} />
        ) : (
          <NavLink key={item.to} to={item.to} end={item.end} className="nav-link">
            <item.icon aria-hidden /> {item.label}
            {item.soon && <span className="badge badge-soft soon">Soon</span>}
          </NavLink>
        ))}
        <div className="sidebar-foot">
          <button type="button" className="account-btn" onClick={() => setAccount(true)} title="My Account and Password">
            <span className="avatar">{initials(staff.name)}</span>
            <span className="who">
              <strong>{staff.name}</strong>
              <span>{staff.title || ROLE_LABEL[staff.role] || staff.role}</span>
            </span>
          </button>
          <button type="button" className="icon-btn" onClick={logOut} aria-label="Log Out" title="Log Out">
            <LogOut />
          </button>
        </div>
      </nav>

      <div className="content">
        {!mobile && (
          <header className="deskbar">
            <OmniSearch />
            <ReminderBell align="right" />
          </header>
        )}
        <main className="main" id="main">
          <Outlet />
        </main>
      </div>
      <TagCheckIn />
      <QuickActions />
      {account && <AccountPanel staff={staff} onClose={() => setAccount(false)} onLogOut={logOut} />}
    </div>
  )
}
