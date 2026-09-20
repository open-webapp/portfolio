import { useReducer, useEffect, useRef, useState, useCallback } from 'react'
import { initialState, reconcileBudgetAccountConventions, type AppState } from './lib/state'
import { appReducer } from './lib/reducer'
import { savePersistedApp, peekEnvelopeShape, setActivePortfolioDb, loadRawPersistedBlob } from './lib/persist'
import { useGlobalCategories } from './hooks/useGlobalCategories'
import { Nav } from './components/Nav'
import { SettingsPage } from './components/Settings'
import { AccountsPage } from './components/AccountsPage'
import { RegisterPage } from './components/RegisterPage'
import { QuotesPage } from './components/QuotesPage'
import { BudgetPage } from './components/BudgetPage'
import { PasswordGate } from './components/PasswordGate'
import { SyncConflictDialog } from './components/SyncConflictDialog'
import { PortfolioPicker } from './components/PortfolioPicker'
import {
  getDriveAuthFor,
  driveAuthProjectIdFor,
  getBackupFileId,
  syncBackup,
  overwriteLocalWithRemote,
  overwriteRemoteWithLocal,
  getBackupFileStatus,
  listPortfolioFoldersOnDrive,
  decryptDriveFolderBackup,
} from './lib/drive'
import { useDriveConnection } from '@open-webapp/drive-connect'
import { runPriceSync } from './lib/priceSync'
import { heldEquityEtfSymbols, heldMutualFundSymbols, shouldRetryPolygonSync, shouldRetryMutualFundSync } from './lib/selectors'
import { syncTickerOverviews } from './lib/tickerOverview'
import { runMutualFundSync } from './lib/mutualFundSync'
import { useHashRoute } from './hooks/useHashRoute'
import { navigateToPicker, navigateToPortfolio } from './lib/router'
import {
  listPortfolios,
  createPortfolio,
  renamePortfolio,
  deletePortfolio,
  getPortfolio,
} from './lib/portfolioRegistry'
import { decryptImportEnvelope, getEnvelopeSaltBytes } from './lib/importExport'
import { deriveKey, generateSalt, type EncryptedEnvelope } from './lib/crypto'
import type { Portfolio } from './lib/types'
import './App.css'

const SYNC_RETRY_POLL_INTERVAL_MS = 60_000
const LOCK_ABSOLUTE_MS = 2 * 60 * 60 * 1000 // 2h
const LOCK_IDLE_MS = 5 * 60 * 1000 // 5min
const LOCK_CHECK_INTERVAL_MS = 30_000 // 30s

// Placeholder portfolio passed to useDriveConnection before a real portfolio
// is active (picker route, or portfolio not yet resolved). useDriveConnection
// requires a non-null DriveAuthHandle on every render (React hooks can't be
// called conditionally), so this stands in until `activePortfolio` is set;
// the resulting `connected` status is never surfaced anywhere the picker/
// loading screens render.
const NO_ACTIVE_PORTFOLIO: Portfolio = { id: '__none__', name: '', dbName: '__none__', createdAt: 0 }

/**
 * App: Main component that wires everything together.
 * - Manages global state with useReducer and reducer
 * - Hydrates from IndexedDB on mount
 * - Debounce-saves state changes to IndexedDB
 * - Renders layout with Nav, charts, and tables
 * - Wires import dialogs
 */
function App() {
  // Multi-portfolio routing/registry state
  const route = useHashRoute()
  const [portfolios, setPortfolios] = useState<Portfolio[]>([])
  const [activePortfolio, setActivePortfolio] = useState<Portfolio | null>(null)

  // State management with hydration
  const [isHydrated, setIsHydrated] = useState(false)
  const [hydrationError, setHydrationError] = useState<string | null>(null)
  const [state, dispatch] = useReducer(appReducer, initialState())

  // Password-gate session state: null sessionKey/sessionSalt means the gate hasn't
  // been passed yet. gateShape is null while peekEnvelopeShape() is still resolving.
  const [sessionKey, setSessionKey] = useState<CryptoKey | null>(null)
  const [sessionSalt, setSessionSalt] = useState<Uint8Array | null>(null)
  const [gateShape, setGateShape] = useState<'absent' | 'encrypted' | null>(null)

  // Drive-sync state (lifted from Settings.tsx so it survives Settings unmounting/remounting)
  const [syncing, setSyncing] = useState(false)
  const [backupFileId, setBackupFileId] = useState<string | null>(null)
  const { connected } = useDriveConnection(getDriveAuthFor(activePortfolio ?? NO_ACTIVE_PORTFOLIO))

  // Global (cross-portfolio) categories/mappings store: hydrates/saves/syncs
  // independently of the per-portfolio state above. Reuses the active
  // portfolio's already-established Drive connection (`driveAuth`/`connected`
  // above) rather than a connection of its own — nothing in the UI ever
  // prompts the user to separately "Connect" a dedicated category-store
  // project, so a from-scratch connection would only ever be attempted via an
  // unprompted background `connect()` call, which browsers block (no user
  // gesture). `driveAuthProjectIdFor(portfolio)` tells categoryDrive.ts which
  // project id that connection was authenticated under, so its Drive I/O
  // (against the shared `category-mappings.json`, not a per-portfolio file)
  // scopes to the SAME id — drive-sync's token store is keyed by
  // `(appId, projectId)`, so any mismatch here means no valid token is ever
  // found and every category sync call silently fails.
  const globalCategories = useGlobalCategories(
    activePortfolio ? getDriveAuthFor(activePortfolio) : null,
    connected,
    activePortfolio ? driveAuthProjectIdFor(activePortfolio) : null,
    // Undefined until the decrypted portfolio state is installed. The shell
    // remains gated separately while the hook hydrates and rules reconcile.
    sessionKey ? state.budgetExpenseDefinitions : undefined
  )
  const [syncConflict, setSyncConflict] = useState<{
    fileId: string
    remoteModifiedTime?: string
    lastRestoredAt?: number
  } | null>(null)
  const [tickerOverviewErrors, setTickerOverviewErrors] = useState<Record<string, string>>({})
  const [mutualFundSyncErrors, setMutualFundSyncErrors] = useState<Record<string, string>>({})

  // Tracks browser online/offline status (e.g. for gating Drive-import
  // affordances in the portfolio picker). Not yet wired into any JSX.
  const [isOnline, setIsOnline] = useState(navigator.onLine)

  // Which section of the Settings page is active
  const [settingsSection, setSettingsSection] = useState<'backup' | 'encryption' | 'priceSync' | 'spendAccounts'>('backup')

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
  // Tracks the id of the previously-active portfolio so the route-resolution
  // effect can distinguish "switching directly between two different
  // portfolios" (needs a full unlock-state reset) from "resolving the first
  // portfolio after mount" (nothing was unlocked yet, nothing to reset).
  const prevActivePortfolioIdRef = useRef<string | null>(null)
  // Tracks the id of the portfolio the one-shot global-categories seed has
  // already run for, so the hydrate-triggered seed effect below fires at most
  // once per portfolio activation rather than on every re-render.
  const categoriesSeededPortfolioIdRef = useRef<string | null>(null)
  const budgetRolloverPortfolioIdRef = useRef<string | null>(null)
  const activePortfolioIdRef = useRef<string | null>(null)
  const hydrationGenerationRef = useRef(0)
  const globalCategoriesHydratedRef = useRef(false)
  const globalCategoriesRulesRef = useRef(globalCategories.budgetAccountRules)
  const globalCategoriesHydrationWaitersRef = useRef<Array<() => void>>([])

  globalCategoriesHydratedRef.current = globalCategories.hydrated
  globalCategoriesRulesRef.current = globalCategories.budgetAccountRules

  useEffect(() => {
    if (!globalCategories.hydrated) return
    const waiters = globalCategoriesHydrationWaitersRef.current.splice(0)
    for (const resolve of waiters) resolve()
  }, [globalCategories.hydrated])

  // Activates a resolved portfolio as the active one. If this is a real
  // switch away from a DIFFERENT, previously-active portfolio (as opposed to
  // the initial null -> first-portfolio resolution), resets every piece of
  // per-unlock-session state back to its locked/initial values first, so a
  // user who navigates directly between two portfolio routes (bypassing the
  // picker, e.g. browser back/forward or a hand-edited URL) can never carry
  // portfolio A's decrypted session/state into portfolio B's gate.
  const activatePortfolio = useCallback((p: Portfolio) => {
    if (activePortfolioIdRef.current !== p.id) {
      activePortfolioIdRef.current = p.id
      hydrationGenerationRef.current += 1
    }
    if (prevActivePortfolioIdRef.current !== null && prevActivePortfolioIdRef.current !== p.id) {
      setSessionKey(null)
      setSessionSalt(null)
      setGateShape(null)
      setIsHydrated(false)
      dispatch({ type: '__SET_STATE', newState: initialState() })
      passwordEntryTimeRef.current = 0
      lastActivityTimeRef.current = Date.now()
    }
    prevActivePortfolioIdRef.current = p.id
    setActivePortfolioDb(p.dbName)
    setActivePortfolio(p)
  }, [])

  const waitForGlobalCategoriesHydration = useCallback(() => {
    if (globalCategoriesHydratedRef.current) return Promise.resolve()
    return new Promise<void>((resolve) => {
      globalCategoriesHydrationWaitersRef.current.push(resolve)
    })
  }, [])

  // The first shell render is delayed until the shared account conventions are
  // available and have been applied to this portfolio's decrypted state.
  const hydrateBudgetAccountRulesThenReconcile = useCallback(async (
    loadedState: AppState,
    key: CryptoKey,
    salt: Uint8Array,
    portfolio: Portfolio,
    persistLoadedState = false,
  ) => {
    activatePortfolio(portfolio)
    const generation = hydrationGenerationRef.current
    setHydrationError(null)
    setIsHydrated(false)
    setSessionKey(key)
    setSessionSalt(salt)
    dispatch({ type: '__SET_STATE', newState: loadedState })

    try {
      await waitForGlobalCategoriesHydration()
      if (connected) {
        await globalCategories.syncNow()
        // Let the hook's merge dispatch publish its latest rule reference.
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }

      if (hydrationGenerationRef.current !== generation || activePortfolioIdRef.current !== portfolio.id) return

      const reconciledState = reconcileBudgetAccountConventions(loadedState, globalCategoriesRulesRef.current)
      if (reconciledState !== loadedState || persistLoadedState) {
        await savePersistedApp(reconciledState, key, salt)
      }

      if (hydrationGenerationRef.current !== generation || activePortfolioIdRef.current !== portfolio.id) return
      dispatch({ type: '__SET_STATE', newState: reconciledState })
      setIsHydrated(true)
      passwordEntryTimeRef.current = Date.now()
      lastActivityTimeRef.current = Date.now()
      setGateShape('encrypted')
    } catch (error) {
      if (hydrationGenerationRef.current !== generation || activePortfolioIdRef.current !== portfolio.id) return
      setHydrationError(error instanceof Error ? error.message : 'Could not finish loading this portfolio.')
    }
  }, [activatePortfolio, connected, globalCategories, waitForGlobalCategoriesHydration])

  // Load the portfolio registry once on mount.
  useEffect(() => {
    listPortfolios().then(setPortfolios)
  }, [])

  // Tracks browser online/offline transitions for isOnline.
  useEffect(() => {
    const onOnline = () => setIsOnline(true)
    const onOffline = () => setIsOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  // Resolve the active portfolio from the current route. Runs before the
  // gate/persist/drive effects below (which depend on `activePortfolio`) so
  // `setActivePortfolioDb` is called before any load/save/clear persistence
  // call can fire.
  useEffect(() => {
    if (route.name !== 'portfolio') return
    const found = portfolios.find((p) => p.id === route.portfolioId)
    if (found) {
      activatePortfolio(found)
      return
    }
    let cancelled = false
    getPortfolio(route.portfolioId).then((p) => {
      if (cancelled) return
      if (p) {
        activatePortfolio(p)
      } else {
        navigateToPicker()
      }
    })
    return () => {
      cancelled = true
    }
  }, [route, portfolios, activatePortfolio])

  const handleRenamePortfolio = useCallback(async (id: string, name: string) => {
    const updated = await renamePortfolio(id, name)
    setPortfolios(await listPortfolios())
    setActivePortfolio((prev) => (prev?.id === id ? updated : prev))
  }, [])

  const handleDeletePortfolio = useCallback(async (id: string) => {
    await deletePortfolio(id)
    setPortfolios(await listPortfolios())
  }, [])

  // Transitions straight from the picker's inline unlock step into the
  // unlocked app shell for `portfolio`, bypassing PasswordGate entirely.
  // `setGateShape('encrypted')` is a harmless placeholder so a later
  // gateShape-resolution effect (keyed on activePortfolio.id) doesn't
  // regress the UI back to a gate render before it resolves for real —
  // sessionKey being non-null is what actually gates PasswordGate rendering.
  const handleOpenUnlocked = useCallback(async (portfolio: Portfolio, key: CryptoKey, salt: Uint8Array, loadedState: AppState, persistLoadedState = false) => {
    await hydrateBudgetAccountRulesThenReconcile(loadedState, key, salt, portfolio, persistLoadedState)
    navigateToPortfolio(portfolio.id)
  }, [hydrateBudgetAccountRulesThenReconcile])

  // Creates a brand-new portfolio with its own password (derives a fresh
  // salt/key pair rather than reusing any other portfolio's), persists an
  // empty initial state under it, then opens it unlocked. Lets
  // `createPortfolio`'s "name already exists" rejection propagate so the
  // picker's inline error UI can show it.
  const handleCreateNewPortfolio = useCallback(async (name: string, password: string) => {
    const salt = generateSalt()
    const key = await deriveKey(password, salt)
    const portfolio = await createPortfolio(name)
    setActivePortfolioDb(portfolio.dbName)
    const newState = initialState()
    setPortfolios(await listPortfolios())
    await handleOpenUnlocked(portfolio, key, salt, newState, true)
  }, [handleOpenUnlocked])

  // Imports a portfolio backup from a Drive folder (one of the folders
  // returned by listPortfolioFoldersOnDrive), registering it as a new local
  // portfolio and opening it unlocked. Lets DriveDecryptError/
  // DriveMalformedBackupError propagate for the picker's inline handling.
  const handleImportFromDriveFolder = useCallback(async (folder: { name: string; id: string }, password: string) => {
    const { state: importedState, key, salt } = await decryptDriveFolderBackup(folder.id, password)
    const portfolio = await createPortfolio(folder.name)
    setActivePortfolioDb(portfolio.dbName)
    setPortfolios(await listPortfolios())
    await handleOpenUnlocked(portfolio, key, salt, importedState, true)
  }, [handleOpenUnlocked])

  // Imports a portfolio backup from a locally-picked export file, registering
  // it as a new local portfolio and opening it unlocked. Lets
  // ImportDecryptError propagate for the picker's inline handling.
  const handleImportFromFile = useCallback(async (envelope: EncryptedEnvelope, name: string, password: string) => {
    const decrypted = await decryptImportEnvelope(envelope, password)
    const saltBytes = getEnvelopeSaltBytes(envelope)
    const key = await deriveKey(password, saltBytes)
    // Rehydrates the exported data collections onto a fresh initialState(),
    // rather than coalesceWithDefaults (which expects a full-shaped
    // Partial<AppState>) — ExportableState's priceSync/mutualFundSync
    // deliberately omit cache fields (heldPrices, lastFetchedDate), which a
    // newly-created portfolio should start fresh with anyway.
    const base = initialState()
    const finalState: AppState = {
      ...base,
      accounts: decrypted.accounts,
      positions: decrypted.positions,
      closedPositions: decrypted.closedPositions,
      transactions: decrypted.transactions,
      snapshots: decrypted.snapshots,
      csvMappings: decrypted.csvMappings,
      customInstitutions: decrypted.customInstitutions,
      balanceEntries: decrypted.balanceEntries,
      priceSync: { ...base.priceSync, apiKey: decrypted.priceSync.apiKey, lastRun: decrypted.priceSync.lastRun },
      mutualFundSync: { ...base.mutualFundSync, apiKey: decrypted.mutualFundSync.apiKey, lastRun: decrypted.mutualFundSync.lastRun },
    }
    const portfolio = await createPortfolio(name)
    setActivePortfolioDb(portfolio.dbName)
    setPortfolios(await listPortfolios())
    await handleOpenUnlocked(portfolio, key, saltBytes, finalState, true)
  }, [handleOpenUnlocked])

  // Determine the password-gate shape on mount, and again whenever the
  // active portfolio changes.
  useEffect(() => {
    if (!activePortfolio) return
    peekEnvelopeShape().then(setGateShape)
  }, [activePortfolio?.id])

  // Drive-sync boot wiring: the auth handle's activate() attaches the
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
    if (sessionKey === null || !activePortfolio) return
    const dispose = getDriveAuthFor(activePortfolio).activate()
    return () => {
      dispose()
    }
  }, [sessionKey, activePortfolio?.id])

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
    if (sessionKey === null || !isHydrated || !activePortfolio) return

    runPriceSyncTrigger()

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') runPriceSyncTrigger()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [sessionKey, isHydrated, runPriceSyncTrigger, activePortfolio?.id])

  useEffect(() => {
    if (sessionKey === null || !isHydrated || !activePortfolio) return
    runMutualFundSyncTrigger()
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') runMutualFundSyncTrigger()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [sessionKey, isHydrated, runMutualFundSyncTrigger, activePortfolio?.id])

  // Retry-interval poll: periodically retries Polygon/mutual-fund syncs that
  // failed or were left incomplete (e.g. rate-limited), without hammering on
  // every tick — the shouldRetry* selectors gate whether a retry is due.
  // Price-date catch-up and ticker-name enrichment are independent Polygon
  // endpoints — price retries must NOT wait on tickerSyncInFlightRef (name
  // sync can run for minutes); runPriceSyncTrigger's own internal check
  // still prevents it from starting an overlapping name sync.
  useEffect(() => {
    if (sessionKey === null || !isHydrated || !activePortfolio) return
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
  }, [sessionKey, isHydrated, runPriceSyncTrigger, runMutualFundSyncTrigger, tickerOverviewErrors, activePortfolio?.id])

  const onDriveConnected = async () => {
    try {
      setBackupFileId(await getBackupFileId(activePortfolio!))
    } catch (e) {
      console.warn('backup file lookup after connect failed', e)
      setBackupFileId(null)
    }
  }
  const onDriveDisconnected = () => setBackupFileId(null)

  const handleSync = useCallback(async () => {
    setSyncing(true)
    try {
      const fileId = await syncBackup(activePortfolio!, state, sessionKey!, sessionSalt!)
      setBackupFileId(fileId)
      await globalCategories.syncNow()
      alert('Synced to Drive')
    } catch (error) {
      console.error('Sync failed:', error)
      if ((error as { name?: string })?.name === 'RemoteChangedError') {
        const fileId = backupFileId ?? (error as { fileId?: string }).fileId ?? (await getBackupFileId(activePortfolio!))
        if (!fileId) {
          alert(`Sync failed: ${error instanceof Error ? error.message : String(error)}`)
        } else {
          const status = await getBackupFileStatus(activePortfolio!, fileId).catch(() => null)
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
                activePortfolio!,
                state,
                sessionKey!,
                sessionSalt!,
                fileId
              )
              setBackupFileId(resyncedFileId)
              await globalCategories.syncNow()
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
  }, [state, sessionKey, sessionSalt, backupFileId, activePortfolio, globalCategories])

  const handleConflictTakeRemote = useCallback(async () => {
    const newState = await overwriteLocalWithRemote(activePortfolio!, syncConflict!.fileId, sessionKey!)
    dispatch({ type: '__SET_STATE', newState })
    setSyncConflict(null)
  }, [syncConflict, sessionKey, activePortfolio])

  const handleConflictPushLocal = useCallback(async () => {
    const fileId = await overwriteRemoteWithLocal(activePortfolio!, state, sessionKey!, sessionSalt!, syncConflict!.fileId)
    setBackupFileId(fileId)
    setSyncConflict(null)
    alert('Synced to Drive')
  }, [state, sessionKey, sessionSalt, syncConflict, activePortfolio])

  // Navigates back to the portfolio picker: clears the current unlock
  // session/state and routes away, rather than resetting in place. Doesn't
  // touch gateShape/sessionKey — once activePortfolio is null and the picker
  // route renders, those are no longer read.
  const handleBackToPicker = useCallback(() => {
    hydrationGenerationRef.current += 1
    activePortfolioIdRef.current = null
    setSessionKey(null)
    setSessionSalt(null)
    dispatch({ type: '__SET_STATE', newState: initialState() })
    setIsHydrated(false)
    setActivePortfolio(null)
    navigateToPicker()
  }, [])

  // Rule changes after the shell opens (including a Drive merge) affect only
  // the currently open portfolio; unopened portfolios are never read here.
  useEffect(() => {
    if (sessionKey === null || !isHydrated || !activePortfolio) return
    dispatch({ type: 'RECONCILE_BUDGET_ACCOUNT_CONVENTIONS', rules: globalCategories.budgetAccountRules })
  }, [sessionKey, isHydrated, activePortfolio?.id, globalCategories.budgetAccountRules])

  // Locks the app due to inactivity/absolute timeout: flushes the current
  // state (best-effort) then clears the session, without touching gateShape
  // or wiping persisted data — distinct from handleBackToPicker, this is
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
    if (!activePortfolio) return
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
  }, [activePortfolio?.id])

  // Debounce-save effect: save state to IndexedDB on changes (500ms delay)
  useEffect(() => {
    if (!isHydrated) return
    if (!sessionKey || !sessionSalt) return
    if (!activePortfolio) return

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
  }, [state, isHydrated, sessionKey, sessionSalt, activePortfolio?.id])

  // One-shot global-categories seed trigger: once a portfolio is unlocked and
  // hydrated, re-decrypt the raw (pre-coalesceWithDefaults) persisted blob —
  // coalesceWithDefaults strips any legacy `categories`/`categoryMappings`
  // fields that no longer belong on AppState, so the migration needs the raw
  // shape — and hand it to the global store's own migration entry point.
  // Gated the same way as the other post-unlock effects above (sessionKey +
  // isHydrated + activePortfolio), with an additional ref guard keyed on the
  // portfolio id so this doesn't re-run on every re-render/state change.
  useEffect(() => {
    if (sessionKey === null || !isHydrated || !activePortfolio) return
    if (categoriesSeededPortfolioIdRef.current === activePortfolio.id) return
    categoriesSeededPortfolioIdRef.current = activePortfolio.id
    loadRawPersistedBlob(sessionKey)
      .then((rawBlob) => globalCategories.seedGlobalCategoriesIfNeeded(activePortfolio, rawBlob ?? {}))
      .catch((error) => {
        console.error('Failed to seed global categories:', error)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey, isHydrated, activePortfolio?.id])

  // One-shot budget year-rollover trigger: once a portfolio is unlocked and
  // hydrated, ensure the current budget year has an expense snapshot
  // seeded from the nearest prior year, same gating/ref-guard
  // pattern as the global-categories seed effect above.
  useEffect(() => {
    if (sessionKey === null || !isHydrated || !activePortfolio) return
    if (budgetRolloverPortfolioIdRef.current === activePortfolio.id) return
    budgetRolloverPortfolioIdRef.current = activePortfolio.id
    dispatch({ type: 'ROLLOVER_BUDGET_EXPENSE_AMOUNTS_IF_NEEDED' })
  }, [sessionKey, isHydrated, activePortfolio?.id])

  // Picker route: render the portfolio picker instead of the gate/app shell.
  // No load/persist/drive effects run against a portfolio here since
  // `activePortfolio` stays null while this route is active.
  if (route.name === 'picker') {
    return (
      <PortfolioPicker
        portfolios={portfolios}
        onRename={handleRenamePortfolio}
        onDelete={handleDeletePortfolio}
        onOpen={navigateToPortfolio}
        onCreateNew={handleCreateNewPortfolio}
        onImportFromDriveFolder={handleImportFromDriveFolder}
        onImportFromFile={handleImportFromFile}
        onListDriveFolders={listPortfolioFoldersOnDrive}
        isOnline={isOnline}
      />
    )
  }

  // Portfolio route, but the portfolio hasn't resolved yet (registry still
  // loading, or the `getPortfolio` fallback lookup is in flight).
  if (!activePortfolio) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <p>Loading...</p>
      </div>
    )
  }

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
        onUnlock={(key, salt, loadedState) => hydrateBudgetAccountRulesThenReconcile(
          loadedState ?? initialState(),
          key,
          salt,
          activePortfolio,
        )}
        onBackToPicker={handleBackToPicker}
      />
    )
  }

  // Don't render until hydrated
  if (!isHydrated) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <p>{hydrationError ?? 'Loading...'}</p>
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
          portfolioName={activePortfolio!.name}
          connected={connected}
          syncing={syncing}
          handleSync={handleSync}
          onOpenSettings={() => {
            setSettingsSection('backup')
            dispatch({ type: 'SET_VIEW', view: 'settings' })
          }}
          onSwitchPortfolio={() => navigateToPicker()}
        />

        {state.view === 'budget' ? (
          /* Budget page view */
          <div style={{ padding: '0 var(--space-4) var(--space-6) var(--space-4)' }}>
            <BudgetPage
              state={state}
              dispatch={dispatch}
              categories={globalCategories.categories}
              categoryMappings={globalCategories.categoryMappings}
              categoryDispatch={globalCategories.dispatch}
              categoriesHydrated={globalCategories.hydrated}
              budgetAccountRules={globalCategories.budgetAccountRules}
            />
          </div>
        ) : state.view === 'accounts' ? (
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
              activePortfolio={activePortfolio!}
              driveAuth={getDriveAuthFor(activePortfolio!)}
              sessionKey={sessionKey!}
              sessionSalt={sessionSalt!}
              onKeyChange={(newKey, newSalt) => {
                setSessionKey(newKey)
                setSessionSalt(newSalt)
              }}
              onPasswordEntryTimeReset={() => {
                passwordEntryTimeRef.current = Date.now()
              }}
              onDriveConnected={onDriveConnected}
              onDriveDisconnected={onDriveDisconnected}
              driveConnected={connected}
              settingsSection={settingsSection}
              setSettingsSection={setSettingsSection}
              budgetTransactions={state.budgetTransactions}
              budgetAccountRules={globalCategories.budgetAccountRules}
              categoriesHydrated={globalCategories.hydrated}
              categoryDispatch={globalCategories.dispatch}
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
