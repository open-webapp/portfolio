import { useReducer, useEffect, useRef, useState, useCallback } from 'react'
import { initialState } from './lib/state'
import { appReducer } from './lib/reducer'
import { savePersistedApp, peekEnvelopeShape } from './lib/persist'
import { Nav } from './components/Nav'
import { SettingsPage } from './components/Settings'
import { AccountsPage } from './components/AccountsPage'
import { PasswordGate } from './components/PasswordGate'
import { drive, getDriveAuthStatus, getBackupFileId, syncBackup } from './lib/drive'
import type { Connection } from '@open-webapp/drive-sync'
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

  // Early Drive status check (non-blocking, runs on mount before password gate)
  useEffect(() => {
    const checkDrive = async () => {
      try {
        const authStatus = await getDriveAuthStatus()
        setDriveReady(authStatus.connected)
        setDriveEmail(authStatus.email)
      } catch (error) {
        console.warn('Early Drive status check failed (non-blocking):', error)
        // Leave driveReady/driveEmail at defaults (false/null)
      }
    }
    checkDrive()
  }, [])

  // Drive-sync boot wiring: activate() attaches the visibility/pageshow
  // listeners that silently warm up the cached Drive token in the
  // background before it goes stale. Without this, drive.ts's
  // ensureFreshConnection() only ever finds an expired token and falls
  // back to the fully interactive connect flow, popping the Google auth
  // window on every settings-open/sync instead of reusing the stored one.
  //
  // Gated on sessionKey (i.e. only after the password gate is passed):
  // Drive has no role before local unlock, and activate()'s
  // visibilitychange/pageshow listeners fire on every tab focus change —
  // registering them pre-unlock meant a stale cached token could trigger
  // a silent reauth attempt (surfacing a Google auth prompt) every time
  // the user tabbed away from and back to the password screen.
  useEffect(() => {
    if (sessionKey === null) return
    const dispose = drive.activate()
    return () => {
      dispose()
    }
  }, [sessionKey])

  useEffect(() => {
    if (isHydrated) {
      isHydratedRef.current = true
    }
  }, [isHydrated])

  // Check Drive connection status once unlocked (never opens a Google auth window)
  useEffect(() => {
    if (sessionKey === null) return
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
  }, [sessionKey])

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
      const timeoutPromise = new Promise<Connection>((_, reject) =>
        setTimeout(() => reject(new Error('Google auth timed out')), 10000)
      )
      const connection = await Promise.race<Connection>([drive.project('app').connect(), timeoutPromise])

      if (!connection) {
        throw new Error('No connection returned from Google Drive')
      }
      setDriveReady(true)
      setDriveEmail(connection.email)
      alert('Connected to Drive')

      // Lookup backup file separately so a failed lookup doesn't forget the connection
      try {
        const fileId = await getBackupFileId()
        setBackupFileId(fileId)
      } catch (lookupError) {
        console.warn('Failed to lookup backup file:', lookupError)
        // Connection succeeded but backup lookup failed — that's OK, just don't set the backup ID
        setBackupFileId(null)
      }
    } catch (error) {
      console.error('Drive connect failed:', error)
      const errorMessage = error instanceof Error ? error.message : String(error)
      alert(`Connect failed: ${errorMessage}`)
      setDriveReady(false)
      setDriveEmail(null)
      setBackupFileId(null)
    } finally {
      setSyncing(false)
    }
  }, [])

  const handleDisconnect = useCallback(async () => {
    setSyncing(true)
    try {
      await drive.project('app').disconnect()
      setDriveReady(false)
      setDriveEmail(null)
      setBackupFileId(null)
      alert('Disconnected from Drive')
    } catch (error) {
      console.error('Drive disconnect failed:', error)
      const errorMessage = error instanceof Error ? error.message : String(error)
      alert(`Disconnect failed: ${errorMessage}`)
    } finally {
      setSyncing(false)
    }
  }, [])

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
        <p>Loading...</p>
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
        driveReady={driveReady}
        driveEmail={driveEmail}
        backupFileId={backupFileId}
        syncing={syncing}
        setSyncing={setSyncing}
        handleConnect={handleConnect}
        handleDisconnect={handleDisconnect}
      />
    )
  }

  // Don't render until hydrated
  if (!isHydrated) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <p>Loading...</p>
      </div>
    )
  }

  return (
    <div>
      <div>
        {/* Navigation: Accounts tab, sync + settings buttons */}
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

        {state.view === 'accounts' ? (
          /* Accounts page view */
          <div style={{ padding: '0 var(--space-4) var(--space-6) var(--space-4)' }}>
            <AccountsPage state={state} dispatch={dispatch} />
          </div>
        ) : (
          /* Settings page view */
          <div style={{ padding: '0 var(--space-4) var(--space-6) var(--space-4)', maxWidth: '560px', margin: '0 auto' }}>
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
