import { useReducer, useEffect, useRef, useState, useCallback } from 'react'
import { initialState } from './lib/state'
import { appReducer } from './lib/reducer'
import { savePersistedApp, peekEnvelopeShape } from './lib/persist'
import { Nav } from './components/Nav'
import { SettingsPage } from './components/Settings'
import { AccountsPage } from './components/AccountsPage'
import { RegisterPage } from './components/RegisterPage'
import { QuotesPage } from './components/QuotesPage'
import { PasswordGate } from './components/PasswordGate'
import { SyncConflictDialog } from './components/SyncConflictDialog'
import {
  driveAuth,
  getBackupFileId,
  syncBackup,
  overwriteLocalWithRemote,
  overwriteRemoteWithLocal,
  getBackupFileStatus,
} from './lib/drive'
import { useDriveConnection } from '@open-webapp/drive-connect'
import { runPriceSync } from './lib/priceSync'
import { heldEquityEtfSymbols, heldMutualFundSymbols, shouldRetryPolygonSync, shouldRetryMutualFundSync } from './lib/selectors'
import { syncTickerOverviews } from './lib/tickerOverview'
import { runMutualFundSync } from './lib/mutualFundSync'
import './App.css'

const SYNC_RETRY_POLL_INTERVAL_MS = 60_000
const LOCK_ABSOLUTE_MS = 2 * 60 * 60 * 1000 // 2h
const LOCK_IDLE_MS = 5 * 60 * 1000 // 5min
const LOCK_CHECK_INTERVAL_MS = 30_000 // 30s

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
  const [backupFileId, setBackupFileId] = useState<string | null>(null)
  const { connected } = useDriveConnection(driveAuth)
  const [syncConflict, setSyncConflict] = useState<{
    fileId: string
    remoteModifiedTime?: string
    lastRestoredAt?: number
  } | null>(null)
  const [tickerOverviewErrors, setTickerOverviewErrors] = useState<Record<string, string>>({})
  const [mutualFundSyncErrors, setMutualFundSyncErrors] = useState<Record<string, string>>({})

  // Which section of the Settings page is active
  const [settingsSection, setSettingsSection] = useState<'backup' | 'encryption' | 'priceSync'>('backup')

  // Ref for debounce timeout
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  // Guards against overlapping syncTickerOverviews runs: it now paces/retries
  // on its own timers until every held symbol is resolved, which can take
  // minutes for a large portfolio, so a mount+focus retrigger mid-run must
  // no-op rather than starting a second overlapping loop.
  const tickerSyncInFlightRef = useRef(false)
  const mutualFundSyncInFlightRef = useRef(false)
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
  const lastActivityTimeRef = useRef<number>(Date.now())
  const passwordEntryTimeRef = useRef<number>(0) // 0 = not unlocked yet

  // Determine the password-gate shape on mount (no key needed for this).
  useEffect(() => {
    peekEnvelopeShape().then(setGateShape)
  }, [])

  // Drive-sync boot wiring: driveAuth.activate() attaches the
  // visibility/pageshow listeners that silently warm up the cached Drive
  // token in the background before it goes stale. Without this, a refresh
  // only ever finds an expired token and falls back to the fully
  // interactive connect flow, popping the Google auth window on every
  // settings-open/sync instead of reusing the stored one.
  //
  // Gated on sessionKey (i.e. only after the password gate is passed):
  // Drive has no role before local unlock, and activate()'s
  // visibilitychange/pageshow listeners fire on every tab focus change —
  // registering them pre-unlock meant a stale cached token could trigger
  // a silent reauth attempt (surfacing a Google auth prompt) every time
  // the user tabbed away from and back to the password screen.
  useEffect(() => {
    if (sessionKey === null) return
    const dispose = driveAuth.activate()
    return () => {
      dispose()
    }
  }, [sessionKey])

  useEffect(() => {
    if (sessionKey === null) return
    const onActivity = () => { lastActivityTimeRef.current = Date.now() }
    document.addEventListener('mousedown', onActivity)
    document.addEventListener('keydown', onActivity)
    document.addEventListener('touchstart', onActivity)
    document.addEventListener('scroll', onActivity)
    return () => {
      document.removeEventListener('mousedown', onActivity)
      document.removeEventListener('keydown', onActivity)
      document.removeEventListener('touchstart', onActivity)
      document.removeEventListener('scroll', onActivity)
    }
  }, [sessionKey])

  useEffect(() => {
    if (isHydrated) {
      isHydratedRef.current = true
    }
  }, [isHydrated])

  // Price-sync trigger: fetches held Equity/ETF prices on mount + on tab focus.
  // Reads state via latestStateRef (kept current above) rather than closing over
  // `state` directly, since this effect's dependency array intentionally omits
  // `state` — mirrors the sessionKeyRef/sessionSaltRef pattern used by the
  // flush-on-unmount effect below for the same reason.
  const runPriceSyncTrigger = useCallback(async (overrideDate?: string) => {
    const current = latestStateRef.current
    if (!current.priceSync.apiKey) return
    const heldSymbols = heldEquityEtfSymbols(current)
    const { patch, updatedPrices } = await runPriceSync(current.priceSync, heldSymbols, overrideDate)
    dispatch({ type: 'RECORD_PRICE_SYNC_RUN', patch })
    for (const [symbol, price] of Object.entries(updatedPrices)) {
      const positionIds = current.positions.filter((p) => p.symbol === symbol).map((p) => p.id)
      for (const id of positionIds) {
        dispatch({ type: 'UPDATE_POSITION', positionId: id, patch: { price } })
      }
    }

    if (!tickerSyncInFlightRef.current) {
      tickerSyncInFlightRef.current = true
      syncTickerOverviews(
        heldSymbols,
        current.priceSync.apiKey,
        current.positions,
        dispatch,
        (ticker, message) => setTickerOverviewErrors((prev) => ({ ...prev, [ticker]: message })),
        (ticker) => setTickerOverviewErrors((prev) => {
          const next = { ...prev }
          delete next[ticker]
          return next
        })
      )
        .catch(() => {})
        .finally(() => {
          tickerSyncInFlightRef.current = false
        })
    }
  }, [])

  // Mutual-fund price-sync trigger: fetches held mutual fund NAVs on mount + on tab focus.
  const runMutualFundSyncTrigger = useCallback(async () => {
    const current = latestStateRef.current
    if (!current.mutualFundSync.apiKey) return
    if (mutualFundSyncInFlightRef.current) return
    mutualFundSyncInFlightRef.current = true
    try {
      const heldSymbols = heldMutualFundSymbols(current)
      const { patch } = await runMutualFundSync(
        current.mutualFundSync,
        heldSymbols,
        current.positions,
        dispatch,
        (symbol, message) => setMutualFundSyncErrors((prev) => ({ ...prev, [symbol]: message })),
        (symbol) => setMutualFundSyncErrors((prev) => {
          const next = { ...prev }
          delete next[symbol]
          return next
        })
      )
      dispatch({ type: 'RECORD_MUTUAL_FUND_SYNC_RUN', patch })
    } finally {
      mutualFundSyncInFlightRef.current = false
    }
  }, [])

  useEffect(() => {
    if (sessionKey === null || !isHydrated) return

    runPriceSyncTrigger()

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') runPriceSyncTrigger()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [sessionKey, isHydrated, runPriceSyncTrigger])

  useEffect(() => {
    if (sessionKey === null || !isHydrated) return
    runMutualFundSyncTrigger()
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') runMutualFundSyncTrigger()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [sessionKey, isHydrated, runMutualFundSyncTrigger])

  // Retry-interval poll: periodically retries Polygon/mutual-fund syncs that
  // failed or were left incomplete (e.g. rate-limited), without hammering on
  // every tick — the shouldRetry* selectors gate whether a retry is due.
  // Price-date catch-up and ticker-name enrichment are independent Polygon
  // endpoints — price retries must NOT wait on tickerSyncInFlightRef (name
  // sync can run for minutes); runPriceSyncTrigger's own internal check
  // still prevents it from starting an overlapping name sync.
  useEffect(() => {
    if (sessionKey === null || !isHydrated) return
    const id = setInterval(() => {
      const current = latestStateRef.current
      if (shouldRetryPolygonSync(current, tickerOverviewErrors)) {
        runPriceSyncTrigger()
      }
      if (!mutualFundSyncInFlightRef.current && shouldRetryMutualFundSync(current)) {
        runMutualFundSyncTrigger()
      }
    }, SYNC_RETRY_POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [sessionKey, isHydrated, runPriceSyncTrigger, runMutualFundSyncTrigger, tickerOverviewErrors])

  const onDriveConnected = async () => {
    try {
      setBackupFileId(await getBackupFileId())
    } catch (e) {
      console.warn('backup file lookup after connect failed', e)
      setBackupFileId(null)
    }
  }
  const onDriveDisconnected = () => setBackupFileId(null)

  const handleSync = useCallback(async () => {
    setSyncing(true)
    try {
      const fileId = await syncBackup(state, sessionKey!, sessionSalt!)
      setBackupFileId(fileId)
      alert('Synced to Drive')
    } catch (error) {
      console.error('Sync failed:', error)
      if ((error as { name?: string })?.name === 'NeedsReauthError') driveAuth.refresh()
      if ((error as { name?: string })?.name === 'RemoteChangedError') {
        const fileId = backupFileId ?? (error as { fileId?: string }).fileId ?? (await getBackupFileId())
        if (!fileId) {
          alert(`Sync failed: ${error instanceof Error ? error.message : String(error)}`)
        } else {
          const status = await getBackupFileStatus(fileId).catch(() => null)
          const remoteMs = status?.remoteModifiedTime
            ? new Date(status.remoteModifiedTime).getTime()
            : NaN
          const restoredMs = status?.lastRestoredAt ?? NaN
          // A RemoteChangedError only means Drive's version counter moved past
          // our baseline — which also happens on metadata-only server changes.
          // When the remote's *content* modified-time is no newer than our last
          // restore/write, this is spurious version drift: silently re-adopt the
          // baseline and re-push local instead of confronting the user with a
          // destructive three-way choice. Only a genuinely newer remote content
          // time opens the conflict dialog.
          const remoteContentIsNewer =
            Number.isFinite(remoteMs) && Number.isFinite(restoredMs) && remoteMs > restoredMs
          if (!remoteContentIsNewer && Number.isFinite(restoredMs)) {
            try {
              const resyncedFileId = await overwriteRemoteWithLocal(
                state,
                sessionKey!,
                sessionSalt!,
                fileId
              )
              setBackupFileId(resyncedFileId)
              alert('Synced to Drive')
            } catch {
              setSyncConflict({
                fileId,
                remoteModifiedTime: status?.remoteModifiedTime,
                lastRestoredAt: status?.lastRestoredAt,
              })
            }
          } else {
            setSyncConflict({
              fileId,
              remoteModifiedTime: status?.remoteModifiedTime,
              lastRestoredAt: status?.lastRestoredAt,
            })
          }
        }
      } else {
        alert(`Sync failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    } finally {
      setSyncing(false)
    }
  }, [state, sessionKey, sessionSalt, backupFileId])

  const handleConflictTakeRemote = useCallback(async () => {
    try {
      const newState = await overwriteLocalWithRemote(syncConflict!.fileId, sessionKey!)
      dispatch({ type: '__SET_STATE', newState })
      setSyncConflict(null)
    } catch (e) {
      if ((e as { name?: string })?.name === 'NeedsReauthError') driveAuth.refresh()
      throw e
    }
  }, [syncConflict, sessionKey])

  const handleConflictPushLocal = useCallback(async () => {
    try {
      const fileId = await overwriteRemoteWithLocal(state, sessionKey!, sessionSalt!, syncConflict!.fileId)
      setBackupFileId(fileId)
      setSyncConflict(null)
      alert('Synced to Drive')
    } catch (e) {
      if ((e as { name?: string })?.name === 'NeedsReauthError') driveAuth.refresh()
      throw e
    }
  }, [state, sessionKey, sessionSalt, syncConflict])

  const handleBounceToGate = useCallback(() => {
    setGateShape('absent')
    setSessionKey(null)
    setSessionSalt(null)
    dispatch({ type: '__SET_STATE', newState: initialState() })
    setIsHydrated(false)
  }, [])

  // Locks the app due to inactivity/absolute timeout: flushes the current
  // state (best-effort) then clears the session, without touching gateShape
  // or calling clearPersistedApp() — distinct from onReset, this is
  // non-destructive so the same password unlocks again.
  const lockNow = useCallback(() => {
    const key = sessionKeyRef.current
    const salt = sessionSaltRef.current
    if (key && salt && isHydratedRef.current) {
      savePersistedApp(latestStateRef.current, key, salt).catch((error) => {
        console.error('Failed to flush save before auto-lock:', error)
      })
    }
    setSessionKey(null)
    setSessionSalt(null)
    dispatch({ type: '__SET_STATE', newState: initialState() })
  }, [])

  // Periodically checks whether the session should be auto-locked, using
  // wall-clock comparisons (not tick-counting) so laptop-sleep/tab-suspend
  // gaps are handled correctly. Also re-checks on tab re-focus.
  useEffect(() => {
    if (sessionKey === null) return
    const checkAndMaybeLock = () => {
      const now = Date.now()
      const overAbsolute = now - passwordEntryTimeRef.current >= LOCK_ABSOLUTE_MS
      const idleLongEnough = now - lastActivityTimeRef.current >= LOCK_IDLE_MS
      if (overAbsolute && idleLongEnough) {
        lockNow()
      }
    }
    const id = setInterval(checkAndMaybeLock, LOCK_CHECK_INTERVAL_MS)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') checkAndMaybeLock()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [sessionKey, lockNow])

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
          passwordEntryTimeRef.current = Date.now()
          lastActivityTimeRef.current = Date.now()
        }}
        onReset={handleBounceToGate}
        onDriveConnected={onDriveConnected}
        onDriveDisconnected={onDriveDisconnected}
        backupFileId={backupFileId}
        syncing={syncing}
        setSyncing={setSyncing}
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
          connected={connected}
          syncing={syncing}
          handleSync={handleSync}
          onOpenSettings={() => {
            setSettingsSection('backup')
            dispatch({ type: 'SET_VIEW', view: 'settings' })
          }}
        />

        {state.view === 'accounts' ? (
          /* Accounts page view */
          <div style={{ padding: '0 var(--space-4) var(--space-6) var(--space-4)' }}>
            <AccountsPage state={state} dispatch={dispatch} />
          </div>
        ) : state.view === 'register' ? (
          /* Register page view */
          <div style={{ padding: '0 var(--space-4) var(--space-6) var(--space-4)' }}>
            <RegisterPage state={state} dispatch={dispatch} />
          </div>
        ) : state.view === 'quotes' ? (
          /* Quotes page view */
          <div style={{ padding: '0 var(--space-4) var(--space-6) var(--space-4)' }}>
            <QuotesPage state={state} dispatch={dispatch} tickerOverviewErrors={tickerOverviewErrors} />
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
              onPasswordEntryTimeReset={() => {
                passwordEntryTimeRef.current = Date.now()
              }}
              onReset={handleBounceToGate}
              onDriveConnected={onDriveConnected}
              onDriveDisconnected={onDriveDisconnected}
              backupFileId={backupFileId}
              syncing={syncing}
              setSyncing={setSyncing}
              settingsSection={settingsSection}
              setSettingsSection={setSettingsSection}
              runPriceSyncTrigger={runPriceSyncTrigger}
              runMutualFundSyncTrigger={runMutualFundSyncTrigger}
              tickerOverviewErrors={tickerOverviewErrors}
              mutualFundSyncErrors={mutualFundSyncErrors}
            />
          </div>
        )}
      </div>

      {syncConflict && (
        <SyncConflictDialog
          remoteModifiedTime={syncConflict.remoteModifiedTime}
          localRestoredAt={syncConflict.lastRestoredAt}
          onCancel={() => setSyncConflict(null)}
          onOverwriteLocalWithRemote={handleConflictTakeRemote}
          onOverwriteRemoteWithLocal={handleConflictPushLocal}
        />
      )}
    </div>
  )
}

export default App
