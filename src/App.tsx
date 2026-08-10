import { useReducer, useEffect, useRef, useState } from 'react'
import { initialState } from './lib/state'
import { appReducer } from './lib/reducer'
import { savePersistedApp, peekEnvelopeShape } from './lib/persist'
import { Nav } from './components/Nav'
import { SummaryCards } from './components/SummaryCards'
import { PerformanceChart } from './components/PerformanceChart'
import { AllocationChart } from './components/AllocationChart'
import { PositionsTable } from './components/PositionsTable'
import { TransactionsTable } from './components/TransactionsTable'
import { SettingsPage } from './components/Settings'
import { ImportDialog } from './components/import/ImportDialog'
import { PasswordGate } from './components/PasswordGate'
import { drive } from './lib/drive'
import './App.css'

/**
 * Portfolio header (matches v3 design header row):
 * left side kicker 'Portfolio' + portfolio name, right side retirement filter tags.
 */
const PORTFOLIO_NAME = 'Ledger'

const retirementFilters = [
  { value: 'All', label: 'All' },
  { value: 'Retirement', label: 'Retirement' },
  { value: 'Non-Retirement', label: 'Non-Retirement' },
]


/**
 * App: Main component that wires everything together.
 * - Manages global state with useReducer and reducer
 * - Hydrates from IndexedDB on mount
 * - Debounce-saves state changes to IndexedDB
 * - Renders layout with Nav, charts, and tables
 * - Wires import dialogs
 */
function App() {
  // State management with hydration
  const [isHydrated, setIsHydrated] = useState(false)
  const [state, dispatch] = useReducer(appReducer, initialState())

  // Password-gate session state: null sessionKey/sessionSalt means the gate hasn't
  // been passed yet. gateShape is null while peekEnvelopeShape() is still resolving.
  const [sessionKey, setSessionKey] = useState<CryptoKey | null>(null)
  const [sessionSalt, setSessionSalt] = useState<Uint8Array | null>(null)
  const [gateShape, setGateShape] = useState<'absent' | 'legacy-plaintext' | 'encrypted' | null>(null)

  // Ref for debounce timeout
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  // Latest state + hydration flag, so a flush-on-unmount can save even when the debounce hasn't fired
  const latestStateRef = useRef(state)
  latestStateRef.current = state
  const isHydratedRef = useRef(false)
  // Latest session key/salt, so the flush-on-unmount listener (registered once on
  // mount) still sees the key/salt from an unlock that happens after registration.
  const sessionKeyRef = useRef<CryptoKey | null>(sessionKey)
  sessionKeyRef.current = sessionKey
  const sessionSaltRef = useRef<Uint8Array | null>(sessionSalt)
  sessionSaltRef.current = sessionSalt

  // Determine the password-gate shape on mount (no key needed for this).
  useEffect(() => {
    peekEnvelopeShape().then(setGateShape)
  }, [])

  // Drive-sync boot wiring: activate() attaches the visibility/pageshow
  // listeners that silently warm up the cached Drive token in the
  // background before it goes stale. Without this, drive.ts's
  // ensureFreshConnection() only ever finds an expired token and falls
  // back to the fully interactive connect flow, popping the Google auth
  // window on every settings-open/sync instead of reusing the stored one.
  useEffect(() => {
    const dispose = drive.activate()
    return () => {
      dispose()
    }
  }, [])

  useEffect(() => {
    if (isHydrated) {
      isHydratedRef.current = true
    }
  }, [isHydrated])

  // Flush the pending save on page unload/hide so a refresh within the debounce
  // window doesn't lose the latest state (e.g. a just-finished import).
  useEffect(() => {
    const flush = () => {
      if (!isHydratedRef.current) return
      const key = sessionKeyRef.current
      const salt = sessionSaltRef.current
      if (!key || !salt) return
      savePersistedApp(latestStateRef.current, key, salt).catch((error) => {
        console.error('Failed to save app state:', error)
      })
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flush()
      }
    }

    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      flush()
    }
  }, [])

  // Debounce-save effect: save state to IndexedDB on changes (500ms delay)
  useEffect(() => {
    if (!isHydrated) return
    if (!sessionKey || !sessionSalt) return

    // Clear existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    // Set new timeout for debounced save
    saveTimeoutRef.current = setTimeout(() => {
      savePersistedApp(state, sessionKey, sessionSalt).catch((error) => {
        console.error('Failed to save app state:', error)
      })
    }, 500)

    // Cleanup timeout on unmount
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [state, isHydrated, sessionKey, sessionSalt])

  // Still checking the stored envelope's shape.
  if (gateShape === null) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <p>Loading dashboard...</p>
      </div>
    )
  }

  // Not yet unlocked: render the password gate instead of the normal app tree.
  if (sessionKey === null) {
    return (
      <PasswordGate
        shape={gateShape}
        onUnlock={(key, salt, loadedState) => {
          setSessionKey(key)
          setSessionSalt(salt)
          if (loadedState) {
            dispatch({ type: '__SET_STATE', newState: loadedState })
          }
          setIsHydrated(true)
        }}
        onReset={() => {
          setGateShape('absent')
          setSessionKey(null)
          setSessionSalt(null)
          dispatch({ type: '__SET_STATE', newState: initialState() })
          setIsHydrated(false)
        }}
      />
    )
  }

  // Don't render until hydrated
  if (!isHydrated) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <p>Loading dashboard...</p>
      </div>
    )
  }

  return (
    <div>
      {state.view === 'dashboard' ? (
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          {/* Navigation: category tabs, retirement filter, date range */}
          <Nav state={state} dispatch={dispatch} />

          {/* Main content area with padding */}
          <div style={{ padding: 'var(--space-6)' }}>
            {/* Portfolio header: kicker + name on the left, retirement filter tags on the right */}
            <div
              style={{
                marginBottom: 'var(--space-6)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-end',
                flexWrap: 'wrap',
                gap: 'var(--space-3)',
              }}
            >
              <div>
                <div
                  className="text-muted"
                  style={{
                    fontSize: '11px',
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                  }}
                >
                  Portfolio
                </div>
                <h1 style={{ margin: 0 }}>{PORTFOLIO_NAME}</h1>
              </div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {retirementFilters.map((filter) => (
                  <span
                    key={filter.value}
                    onClick={() =>
                      dispatch({
                        type: 'SET_RETIREMENT_FILTER',
                        filter: filter.value as
                          | 'All'
                          | 'Retirement'
                          | 'Non-Retirement',
                      })
                    }
                    className={`tag ${
                      state.retirementFilter === filter.value ? 'tag-accent' : ''
                    }`}
                    style={{ cursor: 'pointer' }}
                  >
                    {filter.label}
                  </span>
                ))}
              </div>
            </div>

            {/* Summary cards row */}
            <SummaryCards state={state} />

            {/* Charts grid: Performance and Allocation */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '2fr 1fr',
                gap: 'var(--space-6)',
                marginBottom: 'var(--space-6)',
              }}
            >
              <PerformanceChart state={state} />
              <AllocationChart state={state} />
            </div>

            {/* Tabs row: Positions/Transactions selector + Import trigger */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 'var(--space-4)',
              }}
            >
              {/* Tab selector */}
              <div className="seg">
                <label
                  className="seg-opt"
                  onClick={() => dispatch({ type: 'SET_TAB', tab: 'positions' })}
                >
                  <input
                    type="radio"
                    name="positions-transactions"
                    checked={state.tab === 'positions'}
                    readOnly
                  />
                  <span>Positions</span>
                </label>
                <label
                  className="seg-opt"
                  onClick={() => dispatch({ type: 'SET_TAB', tab: 'transactions' })}
                >
                  <input
                    type="radio"
                    name="positions-transactions"
                    checked={state.tab === 'transactions'}
                    readOnly
                  />
                  <span>Transactions</span>
                </label>
              </div>

              {/* Import Dialog - unified, visible on all tabs */}
              <ImportDialog state={state} dispatch={dispatch} onClose={() => {}} />
            </div>

            {/* Positions tab */}
            {state.tab === 'positions' && <PositionsTable state={state} dispatch={dispatch} />}

            {/* Transactions tab */}
            {state.tab === 'transactions' && <TransactionsTable state={state} dispatch={dispatch} />}
          </div>
        </div>
      ) : (
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          {/* Settings page view */}
          <div style={{ padding: 'var(--space-6)' }}>
            <SettingsPage
              state={state}
              dispatch={dispatch}
              sessionKey={sessionKey!}
              sessionSalt={sessionSalt!}
              onKeyChange={(newKey, newSalt) => {
                setSessionKey(newKey)
                setSessionSalt(newSalt)
              }}
            />
            <button
              onClick={() => dispatch({ type: 'SET_VIEW', view: 'dashboard' })}
              style={{
                padding: '8px 16px',
                marginTop: 'var(--space-4)',
                background: 'var(--color-accent)',
                color: 'var(--color-bg)',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: '600',
              }}
            >
              Back to Dashboard
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
