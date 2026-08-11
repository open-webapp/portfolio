import { useReducer, useEffect, useRef, useState } from 'react'
import { initialState } from './lib/state'
import { appReducer } from './lib/reducer'
import { savePersistedApp, peekEnvelopeShape } from './lib/persist'
import { Nav } from './components/Nav'
import { OverviewCard } from './components/OverviewCard'
import { AllocationChart } from './components/AllocationChart'
import { PositionsTable } from './components/PositionsTable'
import { SettingsPage } from './components/Settings'
import { ImportDialog } from './components/import/ImportDialog'
import { PasswordGate } from './components/PasswordGate'
import { drive } from './lib/drive'
import './App.css'

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
            {/* Overview card: 3-column layout with All Together, Retirement, Non-Retirement */}
            <OverviewCard state={state} />

            {/* Allocation chart: full-width row */}
            <div style={{ marginBottom: 'var(--space-6)' }}>
              <AllocationChart state={state} />
            </div>

            {/* Divider */}
            <div style={{ borderTop: '1px solid var(--color-divider)', paddingTop: 'var(--space-5)', marginTop: 'var(--space-6)' }} />

            {/* Retirement filter .seg control + Import button row */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
              {/* Left: retirement filter .seg */}
              <div className="seg">
                {retirementFilters.map((filter) => (
                  <label key={filter.value} className="seg-opt">
                    <input
                      type="radio"
                      name="retirementFilter"
                      checked={state.retirementFilter === filter.value}
                      readOnly
                      onClick={() =>
                        dispatch({
                          type: 'SET_RETIREMENT_FILTER',
                          filter: filter.value as
                            | 'All'
                            | 'Retirement'
                            | 'Non-Retirement',
                        })
                      }
                    />
                    <span>{filter.label}</span>
                  </label>
                ))}
              </div>

              {/* Right: Import Dialog */}
              <ImportDialog state={state} dispatch={dispatch} onClose={() => {}} />
            </div>

            {/* Positions table */}
            <PositionsTable state={state} dispatch={dispatch} />
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
