import { useReducer, useEffect, useRef, useState } from 'react'
import type { AppState } from './lib/state'
import { initialState, addImportSession } from './lib/state'
import { appReducer } from './lib/reducer'
import { loadPersistedApp, savePersistedApp } from './lib/persist'
import { Nav } from './components/Nav'
import { SummaryCards } from './components/SummaryCards'
import { PerformanceChart } from './components/PerformanceChart'
import { AllocationChart } from './components/AllocationChart'
import { PositionsTable } from './components/PositionsTable'
import { TransactionsTable } from './components/TransactionsTable'
import { SettingsPage } from './components/Settings'
import { ImportDialog } from './components/import/ImportDialog'
import type { ImportSession } from './lib/types'
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
 * processPendingImport: Given the current state and import metadata, creates an ImportSession
 * and adds it to state. Should be called after positions/transactions have been imported.
 *
 * @param state The current AppState after imports have been applied
 * @param kind 'positions' or 'transactions' (the type of data imported)
 * @param fileName The name of the uploaded CSV file
 * @param importSessionId The session ID that was used to tag the imported rows
 * @param affectedAccountIds Set of account IDs that were touched by this import
 * @returns Updated state with the ImportSession added (or unchanged if no rows were created)
 */
function processPendingImport(
  state: AppState,
  kind: 'positions' | 'transactions',
  fileName: string,
  importSessionId: string,
  affectedAccountIds: Set<string>
): AppState {
  // Calculate rowCount by filtering for rows tagged with this importSessionId
  const rowCount =
    kind === 'positions'
      ? state.positions.filter((p) => p.importSessionId === importSessionId).length +
        state.closedPositions.filter((c) => c.importSessionId === importSessionId).length
      : state.transactions.filter((t) => t.importSessionId === importSessionId).length

  // Build the ImportSession
  const session: ImportSession = {
    id: importSessionId,
    importedAt: new Date().toISOString(),
    kind,
    fileName,
    accountIds: Array.from(affectedAccountIds),
    rowCount,
  }

  // Add the session to state (via the helper, which caps at 50 newest-first)
  return addImportSession(state, session)
}

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

  // Ref for debounce timeout
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  // Latest state + hydration flag, so a flush-on-unmount can save even when the debounce hasn't fired
  const latestStateRef = useRef(state)
  latestStateRef.current = state
  const isHydratedRef = useRef(false)

  // Hydration effect: load persisted state on mount
  useEffect(() => {
    const hydrate = async () => {
      try {
        const persisted = await loadPersistedApp()
        if (persisted) {
          dispatch({
            type: '__SET_STATE',
            newState: persisted,
          })
        }
      } catch (error) {
        console.error('Failed to hydrate state:', error)
      } finally {
        setIsHydrated(true)
      }
    }

    hydrate()
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
      savePersistedApp(latestStateRef.current).catch((error) => {
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

    // Clear existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    // Set new timeout for debounced save
    saveTimeoutRef.current = setTimeout(() => {
      savePersistedApp(state).catch((error) => {
        console.error('Failed to save app state:', error)
      })
    }, 500)

    // Cleanup timeout on unmount
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [state, isHydrated])

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
            <SettingsPage state={state} dispatch={dispatch} />
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
export { processPendingImport }
