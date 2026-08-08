import { useReducer, useEffect, useRef, useState } from 'react'
import { initialState } from './lib/state'
import { appReducer } from './lib/reducer'
import { loadPersistedApp, savePersistedApp } from './lib/persist'
import { Nav } from './components/Nav'
import { SummaryCards } from './components/SummaryCards'
import { PerformanceChart } from './components/PerformanceChart'
import { AllocationChart } from './components/AllocationChart'
import { PositionsTable } from './components/PositionsTable'
import { TransactionsTable } from './components/TransactionsTable'
import { ImportDialog } from './components/import/ImportDialog'
import './App.css'

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
    <div style={{ maxWidth: '1400px', margin: '0 auto' }}>

      {/* Navigation: category tabs, retirement filter, date range */}
      <Nav state={state} dispatch={dispatch} />

      {/* Main content area with padding */}
      <div style={{ padding: 'var(--space-6)' }}>
        {/* Summary cards row */}
        <SummaryCards state={state} />

        {/* Charts grid: Performance and Allocation */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 'var(--space-6)',
            marginBottom: 'var(--space-6)',
          }}
        >
          <PerformanceChart state={state} />
          <AllocationChart state={state} />
        </div>

        {/* Tabs: Positions and Transactions */}
        <div style={{ marginBottom: 'var(--space-6)' }}>
          {/* Tab selector */}
          <div
            style={{
              display: 'flex',
              gap: '12px',
              marginBottom: 'var(--space-4)',
              borderBottom: '1px solid var(--color-divider)',
              paddingBottom: 'var(--space-2)',
            }}
          >
            <button
              onClick={() => dispatch({ type: 'SET_TAB', tab: 'positions' })}
              style={{
                padding: '8px 16px',
                background: state.tab === 'positions' ? 'var(--color-accent)' : 'transparent',
                color: state.tab === 'positions' ? 'var(--color-bg)' : 'inherit',
                border: 'none',
                borderRadius: '4px 4px 0 0',
                cursor: 'pointer',
                fontWeight: state.tab === 'positions' ? '600' : 'normal',
              }}
            >
              Positions
            </button>
            <button
              onClick={() => dispatch({ type: 'SET_TAB', tab: 'transactions' })}
              style={{
                padding: '8px 16px',
                background: state.tab === 'transactions' ? 'var(--color-accent)' : 'transparent',
                color: state.tab === 'transactions' ? 'var(--color-bg)' : 'inherit',
                border: 'none',
                borderRadius: '4px 4px 0 0',
                cursor: 'pointer',
                fontWeight: state.tab === 'transactions' ? '600' : 'normal',
              }}
            >
              Transactions
            </button>
          </div>

          {/* Import Dialog - unified, visible on all tabs */}
          <div style={{ marginBottom: 'var(--space-4)', display: 'flex', gap: '8px', alignItems: 'center' }}>
            <ImportDialog state={state} dispatch={dispatch} onClose={() => {}} />
          </div>

          {/* Positions tab */}
          {state.tab === 'positions' && <PositionsTable state={state} dispatch={dispatch} />}

          {/* Transactions tab */}
          {state.tab === 'transactions' && <TransactionsTable state={state} dispatch={dispatch} />}
        </div>
      </div>
    </div>
  )
}

export default App
