import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { Building2, CalendarDays, FileHeart, Inbox, LayoutDashboard, LogOut, Menu, Stethoscope, UserCog, Users, X } from 'lucide-react'
import { api } from '../lib/api.js'
import { initials } from '../lib/format.js'
import { canManage, ROLE_LABEL } from '../lib/staff.js'
import AccountPanel from './AccountPanel.jsx'

// Menu for the first build. "soon" items open a placeholder page until their phase lands.
const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/appointments', label: 'Appointments', icon: CalendarDays, soon: true },
  { to: '/clients', label: 'Clients & pets', icon: Users },
  { to: '/records', label: 'Medical records', icon: FileHeart, soon: true },
  { group: 'Clinic operations' },
  { to: '/clinic/profile', label: 'Clinic profile', icon: Building2 },
  { to: '/clinic/staff', label: 'Staff', icon: UserCog, owners: true },
  { to: '/clinic/services', label: 'Services', icon: Stethoscope },
  { to: '/inbox', label: 'Inbox', icon: Inbox, soon: true },
]

function Brand() {
  return (
    <NavLink to="/" className="brand" aria-label="Hanna Pet Wellness Center: dashboard">
      <img src="/brand/logo-192.png" alt="" width="40" height="40" />
      <span>
        <span className="wordmark">hanna pet wellness</span>
        <small>Clinic app</small>
      </span>
    </NavLink>
  )
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
  useEffect(() => setOpen(false), [pathname])

  return (
    <div className="shell" data-nav={open ? 'open' : 'closed'}>
      <div className="topbar">
        <button type="button" className="icon-btn" onClick={() => setOpen(true)} aria-label="Open menu" aria-expanded={open}>
          <Menu />
        </button>
        <Brand />
      </div>

      <nav className="sidebar" aria-label="Main">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <Brand />
          {open && (
            <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Close menu">
              <X />
            </button>
          )}
        </div>
        {NAV.filter((item) => !item.owners || canManage(staff)).map((item) => item.group ? (
          <div key={item.group} className="nav-group label">{item.group}</div>
        ) : (
          <NavLink key={item.to} to={item.to} end={item.end} className="nav-link">
            <item.icon aria-hidden /> {item.label}
            {item.soon && <span className="badge badge-soft soon">Soon</span>}
          </NavLink>
        ))}
        <div className="sidebar-foot">
          <button type="button" className="account-btn" onClick={() => setAccount(true)} title="My account and password">
            <span className="avatar">{initials(staff.name)}</span>
            <span className="who">
              <strong>{staff.name}</strong>
              <span>{staff.title || ROLE_LABEL[staff.role] || staff.role}</span>
            </span>
          </button>
          <button type="button" className="icon-btn" onClick={logOut} aria-label="Log out" title="Log out">
            <LogOut />
          </button>
        </div>
      </nav>

      <main className="main" id="main">
        <Outlet />
      </main>
      {account && <AccountPanel staff={staff} onClose={() => setAccount(false)} onLogOut={logOut} />}
    </div>
  )
}
