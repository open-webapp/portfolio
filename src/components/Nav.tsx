import type { ReactNode } from 'react'
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

export interface RailNavProps {
  state: NavProps['state']
  dispatch: NavProps['dispatch']
  connected: NavProps['connected']
  syncing: NavProps['syncing']
  handleSync: NavProps['handleSync']
  onOpenSettings: NavProps['onOpenSettings']
  onSwitchPortfolio: NavProps['onSwitchPortfolio']
}

export interface TopBarProps {
  periodControl?: ReactNode
  portfolioName: string
}

const mainNavTabs = [
  {
    value: 'budget',
    label: 'Budget',
    icon: <><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>,
  },
  {
    value: 'accounts',
    label: 'Positions',
    icon: <><path d="M3 20V10" /><path d="M9 20V4" /><path d="M15 20v-7" /><path d="M21 20V7" /></>,
  },
  {
    value: 'register',
    label: 'Register',
    icon: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8" /><path d="M8 12h8" /><path d="M8 16h5" /></>,
  },
] as const

export function RailNav({ state, dispatch, connected, syncing, handleSync, onOpenSettings, onSwitchPortfolio }: RailNavProps) {
  return (
    <nav className="rail" aria-label="Main navigation">
      <div className="rail-items">
        {mainNavTabs.map((tab) => {
          const active = state.view === tab.value
          return (
            <button
              key={tab.value}
              type="button"
              className={`rail-item${active ? ' active' : ''}`}
              onClick={() => dispatch({ type: 'SET_VIEW', view: tab.value })}
              aria-label={tab.label}
              aria-pressed={active}
              title={tab.label}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="20" height="20" aria-hidden="true">
                {tab.icon}
              </svg>
            </button>
          )
        })}
      </div>
      <div className="rail-spacer" />
      {(connected || syncing) && (
        <button type="button" className="rail-item" onClick={handleSync} disabled={syncing} aria-label={syncing ? 'Syncing' : 'Sync now'} title={syncing ? 'Syncing' : 'Sync now'}>
          <svg className={syncing ? 'syncing' : undefined} viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 2v6h-6" />
            <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
            <path d="M3 22v-6h6" />
            <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
          </svg>
        </button>
      )}
      <button type="button" className="rail-item" onClick={onOpenSettings} aria-label="Settings" title="Settings">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
      <button type="button" className="rail-item rail-exit" onClick={onSwitchPortfolio} aria-label="Switch portfolio" title="Switch portfolio">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20" aria-hidden="true">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <path d="m16 17 5-5-5-5" />
          <path d="M21 12H9" />
        </svg>
      </button>
    </nav>
  )
}

export function TopBar({ periodControl, portfolioName }: TopBarProps) {
  return (
    <header className="top-bar">
      <span className="nav-brand">{portfolioName}</span>
      {periodControl}
    </header>
  )
}

// Keeps the existing shell caller functional while rendering the split navigation.
export function Nav(props: NavProps) {
  return (
    <>
      <RailNav
        state={props.state}
        dispatch={props.dispatch}
        connected={props.connected}
        syncing={props.syncing}
        handleSync={props.handleSync}
        onOpenSettings={props.onOpenSettings}
        onSwitchPortfolio={props.onSwitchPortfolio}
      />
      <TopBar portfolioName={props.portfolioName} />
    </>
  )
}
