import { useReducer, useEffect, useRef, useState, useCallback } from 'react'
import { initialState } from './lib/state'
import { appReducer } from './lib/reducer'
import { savePersistedApp, peekEnvelopeShape } from './lib/persist'
import { assetClassOptions, CATEGORY_LABEL } from './lib/selectors'
import type { ClosedPosition } from './lib/types'
import { Nav } from './components/Nav'
import { OverviewCard } from './components/OverviewCard'
import { AllocationChart } from './components/AllocationChart'
import { PositionsTable } from './components/PositionsTable'
import { SettingsPage } from './components/Settings'
import { AccountsPage } from './components/AccountsPage'
import { ImportDialog } from './components/import/ImportDialog'
import { PasswordGate } from './components/PasswordGate'
import { drive, getDriveAuthStatus, getBackupFileId, connectDrive, disconnectDrive, syncBackup } from './lib/drive'
import './App.css'

const categoryTabs = [
  { value: 'all', label: 'All' },
  ...Object.entries(CATEGORY_LABEL).map(([value, label]) => ({ value, label })),
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

  // Drive-sync state (lifted from Settings.tsx so it survives Settings unmounting/remounting)
  const [syncing, setSyncing] = useState(false)
  const [driveReady, setDriveReady] = useState(false)
  const [driveEmail, setDriveEmail] = useState<string | null>(null)
  const [backupFileId, setBackupFileId] = useState<string | null>(null)

  // Which section of the Settings page is active
  const [settingsSection, setSettingsSection] = useState<'drive' | 'encryption'>('drive')

  // Ref for ImportDialog to support imperative undo operations
  const importDialogRef = useRef<{ undoClosedPosition: (closedPos: ClosedPosition) => void }>(null)

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

  // Check Drive connection status on mount (never opens a Google auth window)
  useEffect(() => {
    const checkDrive = async () => {
      try {
        const authStatus = await getDriveAuthStatus()
        setDriveReady(authStatus.connected)
        setDriveEmail(authStatus.email)
        if (authStatus.connected) {
          const fileId = await getBackupFileId()
          setBackupFileId(fileId)
        }
      } catch (error) {
        console.error('Failed to check Drive connection:', error)
      }
    }
    checkDrive()
  }, [])

  const handleSync = useCallback(async () => {
    setSyncing(true)
    try {
      const fileId = await syncBackup(state, sessionKey!, sessionSalt!)
      setBackupFileId(fileId)
      alert('Synced to Drive')
    } catch (error) {
      console.error('Sync failed:', error)
      alert(`Sync failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setSyncing(false)
    }
  }, [state, sessionKey, sessionSalt])

  const handleConnect = useCallback(async () => {
    setSyncing(true)
    try {
      const connection = await connectDrive()
      setDriveReady(true)
      setDriveEmail(connection.email)
      const fileId = await getBackupFileId()
      setBackupFileId(fileId)
      alert('Connected to Drive')
    } catch (error) {
      console.error('Drive connect failed:', error)
      alert(`Connect failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setSyncing(false)
    }
  }, [])

  const handleDisconnect = useCallback(async () => {
    setSyncing(true)
    try {
      await disconnectDrive()
      setDriveReady(false)
      setDriveEmail(null)
      setBackupFileId(null)
      alert('Disconnected from Drive')
    } catch (error) {
      console.error('Drive disconnect failed:', error)
      alert(`Disconnect failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setSyncing(false)
    }
  }, [])

  // Handle undo closed position: call ImportDialog's undoClosedPosition method via ref
  const handleUndoClosedPosition = useCallback((closedPos: ClosedPosition) => {
    importDialogRef.current?.undoClosedPosition(closedPos)
  }, [])

  // Handle successful undo import: dispatch DELETE_CLOSED_POSITION after import completes
  const handleOnUndoClosedPosition = useCallback(
    (closedPos: ClosedPosition, callback: (success: boolean) => void) => {
      // After successful import, delete the closed position from state
      dispatch({ type: 'DELETE_CLOSED_POSITION', id: closedPos.id })
      callback(true)
    },
    [dispatch]
  )

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
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        {/* Navigation: Dashboard/Accounts tabs, sync + settings buttons */}
        <Nav
          state={state}
          dispatch={dispatch}
          driveReady={driveReady}
          syncing={syncing}
          handleSync={handleSync}
          onOpenSettings={() => {
            setSettingsSection('drive')
            dispatch({ type: 'SET_VIEW', view: 'settings' })
          }}
        />

        {state.view === 'dashboard' ? (
          /* Main content area with padding */
          <div style={{ padding: 'var(--space-6)' }}>
            {/* Overview card: 3-column layout with All Together, Retirement, Non-Retirement */}
            <OverviewCard state={state} />

            {/* Divider (zero-height) */}
            <div style={{ background: 'var(--color-divider)', margin: 'var(--space-6) 0' }} />

            {/* Category tabs seg */}
            <div className="seg" style={{ marginBottom: 'var(--space-6)' }}>
              {categoryTabs.map((tab) => (
                <label key={tab.value} className="seg-opt" onClick={() => dispatch({ type: 'SET_CATEGORY', category: tab.value })}>
                  <input type="radio" name="category" checked={state.category === tab.value} readOnly />
                  <span>{tab.label}</span>
                </label>
              ))}
            </div>

            {/* Allocation chart: full-width row */}
            <div style={{ marginBottom: 'var(--space-6)' }}>
              <AllocationChart state={state} />
            </div>

            {/* Divider */}
            <div style={{ borderTop: '1px solid var(--color-divider)', paddingTop: 'var(--space-5)', marginTop: 'var(--space-6)' }} />

            {/* Asset-class filter .seg control + Import button row */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
              {/* Left: asset-class filter .seg */}
              <div className="seg">
                {['All', ...assetClassOptions(state)].map((opt) => (
                  <label key={opt} className="seg-opt" onClick={() => dispatch({ type: 'SET_ASSET_CLASS_FILTER', assetClass: opt })}>
                    <input type="radio" name="assetClassFilter" checked={state.assetClassFilter === opt} readOnly />
                    <span>{opt}</span>
                  </label>
                ))}
              </div>

              {/* Right: Import Dialog */}
              <ImportDialog
                ref={importDialogRef}
                state={state}
                dispatch={dispatch}
                onClose={() => {}}
                onUndoClosedPosition={handleOnUndoClosedPosition}
              />
            </div>

            {/* Positions table */}
            <PositionsTable state={state} dispatch={dispatch} onUndoClick={handleUndoClosedPosition} />
          </div>
        ) : state.view === 'accounts' ? (
          /* Accounts page view */
          <div style={{ padding: 'var(--space-6)' }}>
            <AccountsPage state={state} dispatch={dispatch} />
          </div>
        ) : (
          /* Settings page view */
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
              driveReady={driveReady}
              driveEmail={driveEmail}
              backupFileId={backupFileId}
              syncing={syncing}
              setSyncing={setSyncing}
              handleConnect={handleConnect}
              handleDisconnect={handleDisconnect}
              handleSync={handleSync}
              settingsSection={settingsSection}
              setSettingsSection={setSettingsSection}
            />
          </div>
        )}
      </div>
    </div>
  )
}

export default App
