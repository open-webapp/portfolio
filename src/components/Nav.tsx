import type { AppState } from '../lib/state'

export interface NavProps {
  state: AppState
  dispatch: (action: any) => void
  connected: boolean
  syncing: boolean
  handleSync: () => void
  onOpenSettings: () => void
  onSwitchPortfolio: () => void
  portfolioName: string
}

/**
 * Nav component: main nav tabs (Positions/Register/Quotes), sync + settings buttons.
 */
export function Nav({
  state,
  dispatch,
  connected,
  syncing,
  handleSync,
  onOpenSettings,
  onSwitchPortfolio,
  portfolioName,
}: NavProps) {
  const mainNavTabs = [
    { value: 'accounts', label: 'Positions' },
    { value: 'register', label: 'Register' },
    { value: 'quotes', label: 'Quotes' },
  ]

  return (
    <div
      className="nav"
      style={{
        borderBottom: '1px solid var(--color-divider)',
        background: 'var(--color-surface)',
        padding: 'var(--space-4) var(--space-6)',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-6)',
      }}
    >
      {/* Logo mark + brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div
          style={{
            width: '32px',
            height: '32px',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--color-accent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            width="17"
            height="17"
            role="img"
            aria-label="Ledger logo"
          >
            <path d="M12 2v20"></path>
            <path d="M2 12h20"></path>
          </svg>
        </div>
        <button
          type="button"
          className="nav-brand"
          onClick={onSwitchPortfolio}
          title="Switch portfolio"
          style={{
            background: 'transparent',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            color: 'var(--color-text)',
            transition: 'color 0.2s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-accent-700)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-text)')}
        >
          {portfolioName}
        </button>
      </div>

      {/* Main navigation tabs (Positions / Register / Quotes) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
        {mainNavTabs.map((tab) => {
          const active = state.view === tab.value
          const activeBg = 'var(--color-accent-100)'
          const inactiveBg = 'transparent'
          return (
            <div
              key={tab.value}
              onClick={() => dispatch({ type: 'SET_VIEW', view: tab.value })}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '9px 14px',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: 600,
                color: active ? 'var(--color-accent-700)' : 'var(--color-text-secondary)',
                background: active ? activeBg : inactiveBg,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = activeBg)}
              onMouseLeave={(e) => (e.currentTarget.style.background = active ? activeBg : inactiveBg)}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                width="16"
                height="16"
              >
                <rect x="3" y="3" width="7" height="9" rx="1.5"></rect>
                <rect x="14" y="3" width="7" height="5" rx="1.5"></rect>
                <rect x="14" y="12" width="7" height="9" rx="1.5"></rect>
                <rect x="3" y="16" width="7" height="5" rx="1.5"></rect>
              </svg>
              <span>{tab.label}</span>
            </div>
          )
        })}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', marginLeft: 'auto' }}>
        <button
          type="button"
          onClick={handleSync}
          disabled={!connected || syncing}
          title="Sync now"
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            fontSize: '20px',
            padding: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--color-text-secondary)',
            transition: 'color 0.2s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-text)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-text-secondary)')}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 2v6h-6"></path>
            <path d="M3 12a9 9 0 0 1 15-6.7L21 8"></path>
            <path d="M3 22v-6h6"></path>
            <path d="M21 12a9 9 0 0 1-15 6.7L3 16"></path>
          </svg>
        </button>

        {/* Settings button */}
        <button
          onClick={onOpenSettings}
          title="Settings"
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            fontSize: '20px',
            padding: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--color-text-secondary)',
            transition: 'color 0.2s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-text)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-text-secondary)')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
          </svg>
        </button>
      </div>
    </div>
  )
}
