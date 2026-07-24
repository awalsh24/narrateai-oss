import { useState, useEffect } from 'react'
import { useGenerationStore } from './store/generationStore'
import { SidebarContext } from './store/sidebarContext'
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Plus, Play, Film, Settings, PanelLeftOpen, PanelLeftClose } from 'lucide-react'
import Generate       from './pages/Generate'
import History        from './pages/History'

// Top bar + sidebar + main content wrapper
function AppShell() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    const handler = () => {
      if (window.innerWidth >= 768) setMobileOpen(false)
    }
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  const navItems = [
    { icon: <Plus size={18} />,     label: 'New video',    path: '/generate', disabled: false },
    { icon: <Play size={18} />,     label: 'Your videos',  path: '/history',  disabled: false },
    { icon: <Film size={18} />,     label: 'Clip library', path: null,        disabled: true  },
    { icon: <Settings size={18} />, label: 'Settings',     path: null,        disabled: true  },
  ]

  const sidebarWidth = sidebarCollapsed ? 56 : 200

  return (
    <SidebarContext.Provider value={{ sidebarCollapsed, setSidebarCollapsed }}>
    <div style={{ height: '100vh', background: 'var(--bg-page)' }}>

      {/* ── Top bar ─────────────────────────────────────────────── */}
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, height: 48,
        background: '#050505', borderBottom: '1px solid rgba(255,255,255,0.06)',
        zIndex: 100, display: 'flex', alignItems: 'center', padding: '0 24px',
      }}>
        <button
          onClick={() => setMobileOpen(o => !o)}
          style={{
            background: 'none',
            border: 'none',
            color: '#ebebeb',
            cursor: 'pointer',
            padding: '8px',
            marginRight: '8px',
          }}
          className="mobile-menu-btn"
          aria-label="Open menu"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
            <rect y="3" width="20" height="2" rx="1"/>
            <rect y="9" width="20" height="2" rx="1"/>
            <rect y="15" width="20" height="2" rx="1"/>
          </svg>
        </button>
        <button
          onClick={() => { useGenerationStore.getState().reset(); navigate('/generate') }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 15, fontWeight: 500, color: '#e0e0e0', letterSpacing: '-0.01em', flex: 1, textAlign: 'left' }}
        >
          NarrateAI
        </button>
      </div>

      {/* ── Sidebar ──────────────────────────────────────────────── */}
      <div
        className={`sidebar-rail${mobileOpen ? ' mobile-open' : ''}`}
        style={{
          position: 'fixed', left: 0, top: 48,
          height: 'calc(100vh - 48px)',
          width: sidebarWidth,
          background: '#080808',
          borderRight: '1px solid rgba(255,255,255,0.08)',
          transition: 'width 200ms ease, transform 200ms ease',
          overflow: 'hidden',
          zIndex: 200, display: 'flex', flexDirection: 'column',
        }}
      >
        {/* Collapse toggle */}
        <div style={{ padding: '10px 8px 4px', display: 'flex', justifyContent: sidebarCollapsed ? 'center' : 'flex-end' }}>
          <button
            onClick={() => setSidebarCollapsed(c => !c)}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            style={{
              width: 32, height: 32,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#444', borderRadius: 6,
              transition: 'color 150ms, background 150ms',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = '#888'; e.currentTarget.style.background = 'rgba(255,255,255,0.05)' }}
            onMouseLeave={e => { e.currentTarget.style.color = '#444'; e.currentTarget.style.background = 'none' }}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>

        {/* Nav items */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, paddingTop: 4 }}>
          {navItems.map(item => {
            const isActive = item.path && location.pathname === item.path
            return (
              <div
                key={item.label}
                onClick={() => { if (!item.disabled && item.path) { navigate(item.path); setMobileOpen(false) } }}
                style={{
                  height: 40, display: 'flex', alignItems: 'center',
                  padding: '0 16px', gap: 10,
                  cursor: item.disabled ? 'default' : 'pointer',
                  borderRadius: 8, margin: '0 6px 2px',
                  color: item.disabled ? '#333' : isActive ? '#e0e0e0' : '#666',
                  fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden',
                  transition: 'color 150ms, background 150ms',
                }}
                onMouseEnter={e => {
                  if (!item.disabled) {
                    e.currentTarget.style.color = '#e0e0e0'
                    e.currentTarget.style.background = 'rgba(255,255,255,0.04)'
                  }
                }}
                onMouseLeave={e => {
                  if (!item.disabled) {
                    e.currentTarget.style.color = isActive ? '#e0e0e0' : '#666'
                    e.currentTarget.style.background = 'transparent'
                  }
                }}
              >
                <span style={{ width: 24, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {item.icon}
                </span>
                <span style={{
                  opacity: sidebarCollapsed ? 0 : 1,
                  width: sidebarCollapsed ? 0 : 'auto',
                  overflow: 'hidden',
                  transition: 'opacity 150ms, width 150ms',
                }}>
                  {item.label}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Mobile backdrop ───────────────────────────────────────── */}
      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            zIndex: 150,
          }}
          className="mobile-backdrop"
        />
      )}

      {/* ── Main content ──────────────────────────────────────────── */}
      <main className="main-content" style={{
        marginLeft: sidebarWidth, marginTop: 48,
        height: 'calc(100vh - 48px)', overflowY: 'auto',
        transition: 'margin-left 200ms ease',
      }}>
        <Outlet />
      </main>
    </div>
    </SidebarContext.Provider>
  )
}

export default function App() {
  return (
    <BrowserRouter basename="/">
      <Routes>
        <Route index element={<Navigate to="/generate" replace />} />
        <Route element={<AppShell />}>
          <Route path="/generate" element={<Generate />} />
          <Route path="/history"  element={<History />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
