import { useReducer, useEffect, useRef, useState } from 'react'
import { initialState } from './lib/state'
import { appReducer } from './lib/reducer'
import { loadPersistedApp, savePersistedApp } from './lib/persist'
import { importPositions } from './lib/positionsImport'
import { importTransactions } from './lib/transactionsImport'
import { resolveAccountNumber, findOrCreateAccountPrompt } from './lib/accounts'
import { Nav } from './components/Nav'
import { SummaryCards } from './components/SummaryCards'
import { PerformanceChart } from './components/PerformanceChart'
import { AllocationChart } from './components/AllocationChart'
import { PositionsTable } from './components/PositionsTable'
import { TransactionsTable } from './components/TransactionsTable'
import { ImportPositionsDialog } from './components/import/ImportPositionsDialog'
import { ImportTransactionsDialog } from './components/import/ImportTransactionsDialog'
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

  // Process pending import effect
  useEffect(() => {
    if (!state.pendingImport || !isHydrated) return

    const processPendingImport = () => {
      const { kind, rows, profileId } = state.pendingImport!
      const profile = state.mappingProfiles.find((p) => p.id === profileId)

      if (!profile) {
        console.error('Profile not found:', profileId)
        dispatch({ type: 'SET_PENDING_IMPORT', pendingImport: undefined })
        return
      }

      // Require accountNumberColumn to be mapped
      if (!profile.accountNumberColumn) {
        alert(
          `The mapping profile "${profile.name}" doesn't have an Account Number column mapped.\n\nPlease go back and either:\n1. Edit the profile to map an "Account Number" column from your CSV\n2. Or use a different profile that has this mapping`
        )
        dispatch({ type: 'SET_PENDING_IMPORT', pendingImport: undefined })
        return
      }

      // Group rows by accountNumber, then resolve to accountId
      const rowsByAccount = new Map<string, Record<string, string>[]>()
      const accountNumbersToResolve = new Set<string>()

      for (const row of rows) {
        const accountNumber = resolveAccountNumber(row, profile)
        if (!accountNumber) {
          // This shouldn't happen if accountNumberColumn is properly mapped and column exists in CSV
          console.warn('No account number resolved from row (column missing in CSV?):', row)
          continue
        }

        accountNumbersToResolve.add(accountNumber)
        if (!rowsByAccount.has(accountNumber)) {
          rowsByAccount.set(accountNumber, [])
        }
        rowsByAccount.get(accountNumber)!.push(row)
      }

      // Resolve each account number to an accountId; skip if any needs prompt
      let updatedState = state
      const accountMap = new Map<string, string>()

      for (const accountNumber of accountNumbersToResolve) {
        const account = findOrCreateAccountPrompt(updatedState, accountNumber)

        if (account === 'needs-prompt') {
          // TODO: show account resolution prompt
          console.warn('Account resolution prompt needed for:', accountNumber)
          return
        }

        accountMap.set(accountNumber, account.id)
      }

      // Import rows for each account
      for (const [accountNumber, accountRows] of rowsByAccount) {
        const accountId = accountMap.get(accountNumber)
        if (!accountId) continue

        if (kind === 'positions') {
          const today = new Date().toISOString().split('T')[0]
          updatedState = importPositions(updatedState, accountId, accountRows, today)
        } else if (kind === 'transactions') {
          updatedState = importTransactions(updatedState, accountId, accountRows)
        }
      }

      // Update state with imported data and clear pendingImport
      dispatch({
        type: '__SET_STATE',
        newState: { ...updatedState, pendingImport: undefined },
      })
    }

    processPendingImport()
  }, [state.pendingImport, state.mappingProfiles, state.accounts, isHydrated])

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

          {/* Positions tab */}
          {state.tab === 'positions' && (
            <div>
              {/* Import button */}
              <div style={{ marginBottom: 'var(--space-4)' }}>
                <ImportPositionsDialog state={state} dispatch={dispatch} />
              </div>
              <PositionsTable state={state} dispatch={dispatch} />
            </div>
          )}

          {/* Transactions tab */}
          {state.tab === 'transactions' && (
            <div>
              {/* Import button */}
              <div style={{ marginBottom: 'var(--space-4)' }}>
                <ImportTransactionsDialog state={state} dispatch={dispatch} />
              </div>
              <TransactionsTable state={state} dispatch={dispatch} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default App
