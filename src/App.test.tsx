import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, cleanup, waitFor, fireEvent, act } from '@testing-library/react'
import { initialState } from './lib/state'
import { appReducer } from './lib/reducer'
import { importPositions } from './lib/positionsImport'
import { importTransactions } from './lib/transactionsImport'
import { peekEnvelopeShape, savePersistedApp, setActivePortfolioDb } from './lib/persist'
import { driveAuth } from './lib/drive'
import { useDriveConnection } from '@open-webapp/drive-connect'
import { createPortfolio, _resetRegistryForTests } from './lib/portfolioRegistry'
import App from './App'

const REGISTRY_DB_NAME = 'portfolio-registry'
const REGISTRY_STORE_NAME = 'portfolios'

// Same rationale as portfolioRegistry.test.ts: portfolioRegistry.ts memoizes a
// single open IDBDatabase connection for the module's lifetime and never
// closes it, so indexedDB.deleteDatabase against a live connection hangs
// forever under fake-indexeddb. Clear the object store directly instead, and
// reset the module's cached connection promise so it reopens cleanly.
async function clearRegistryStore(): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(REGISTRY_DB_NAME, 1)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = (event) => {
      const upgradeDb = (event.target as IDBOpenDBRequest).result
      if (!upgradeDb.objectStoreNames.contains(REGISTRY_STORE_NAME)) {
        upgradeDb.createObjectStore(REGISTRY_STORE_NAME, { keyPath: 'id' })
      }
    }
  })
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(REGISTRY_STORE_NAME, 'readwrite')
    const req = tx.objectStore(REGISTRY_STORE_NAME).clear()
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve()
  })
  db.close()
}

/**
 * Resets the (real, fake-indexeddb-backed) portfolio registry to empty, then
 * creates one real portfolio via createPortfolio() and navigates the hash to
 * it — the setup nearly every pre-existing test in this file wants, since
 * App.tsx only renders the gate/app shell once a `#/portfolio/<id>` route
 * resolves to a real registry entry. Returns the created portfolio.
 */
async function resetRegistryAndOpenDefaultPortfolio() {
  await clearRegistryStore()
  _resetRegistryForTests()
  const portfolio = await createPortfolio('Test Portfolio')
  window.location.hash = `#/portfolio/${portfolio.id}`
  return portfolio
}

// Stable session key/salt used by the mocked PasswordGate's onUnlock callback.
// Declared via vi.hoisted so it's initialized before the hoisted vi.mock factories run.
// passwordGatePropsCapture keeps the last `shape` prop the mocked PasswordGate saw
// (used by the auto-lock test to assert gateShape isn't reset to 'absent').
const { mockSessionKey, mockSessionSalt, passwordGatePropsCapture, mockUnlockLoadedState } = vi.hoisted(() => ({
  mockSessionKey: {} as CryptoKey,
  mockSessionSalt: new Uint8Array([1, 2, 3]),
  passwordGatePropsCapture: {
    shape: undefined as 'absent' | 'encrypted' | null | undefined,
  },
  // Mutable box so individual tests can make the mocked PasswordGate's onUnlock hand
  // App.tsx a specific loadedState (e.g. one with priceSync.apiKey set), without
  // changing the default (undefined) behavior the other tests rely on.
  mockUnlockLoadedState: { current: undefined as unknown },
}))

vi.mock('./lib/priceSync', () => ({
  runPriceSync: vi.fn().mockResolvedValue({
    patch: { lastRun: { at: '2024-01-01T00:00:00Z', updatedCount: 0, notFound: [], marketTickerCount: 0 } },
    updatedPrices: {},
  }),
}))

vi.mock('./lib/drive', () => {
  const driveAuth = {
    activate: vi.fn(() => () => {}),
    getStatus: vi.fn(() => ({
      connected: false,
      email: null,
      expiresAt: null,
      needsReauth: false,
      tokenValid: false,
      connecting: false,
      error: null,
    })),
    ensureFresh: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    subscribe: vi.fn(() => () => {}),
  }
  return {
    drive: { activate: vi.fn(() => vi.fn()) },
    driveAuth,
    // App.tsx resolves the (per-portfolio) drive auth handle via
    // getDriveAuthFor(portfolio) rather than importing `driveAuth` directly;
    // returning the same mocked handle for every portfolio keeps the
    // existing driveAuth.* assertions in this file valid.
    getDriveAuthFor: vi.fn(() => driveAuth),
    // Categories reuse the active portfolio's own driveAuth/project id —
    // see driveAuthProjectIdFor in lib/drive.ts.
    driveAuthProjectIdFor: vi.fn((portfolio: { id: string }) => portfolio.id),
    getBackupFileId: vi.fn().mockResolvedValue(null),
    getPortfolioDriveFolderUrl: vi.fn().mockResolvedValue('https://drive.google.com/drive/folders/mock-folder-id'),
    syncBackup: vi.fn(),
    overwriteLocalWithRemote: vi.fn(),
    overwriteRemoteWithLocal: vi.fn(),
    getBackupFileStatus: vi.fn(),
    listPortfolioFoldersOnDrive: vi.fn().mockResolvedValue([]),
    decryptDriveFolderBackup: vi.fn(),
    DriveDecryptError: class DriveDecryptError extends Error {},
    DriveMalformedBackupError: class DriveMalformedBackupError extends Error {},
  }
})

vi.mock('@open-webapp/drive-connect', () => ({
  GoogleDriveWidget: ({
    onConnected,
    onDisconnected,
  }: {
    onConnected?: (connection: unknown) => void
    onDisconnected?: () => void
  }) => (
    <div>
      <button data-testid="widget-connect" onClick={() => onConnected?.({})}>
        c
      </button>
      <button data-testid="widget-disconnect" onClick={() => onDisconnected?.()}>
        d
      </button>
    </div>
  ),
  useDriveConnection: vi.fn(() => ({
    connected: false,
    email: null,
    connecting: false,
    error: null,
    needsReauth: false,
    refresh: vi.fn(),
  })),
  createDriveAuth: vi.fn(),
}))

vi.mock('./lib/persist', () => ({
  peekEnvelopeShape: vi.fn(),
  savePersistedApp: vi.fn().mockResolvedValue(undefined),
  setActivePortfolioDb: vi.fn(),
  loadRawPersistedBlob: vi.fn().mockResolvedValue({}),
}))

// Controllable fixture for the global-categories hook: tests can mutate
// mockGlobalCategoriesFixture.current's fields per-test (e.g. hydrated:
// false) without changing the default the other tests rely on.
const { mockGlobalCategoriesFixture, seedGlobalCategoriesIfNeededMock } = vi.hoisted(() => {
  const seedGlobalCategoriesIfNeededMock = vi.fn().mockResolvedValue(undefined)
  return {
    seedGlobalCategoriesIfNeededMock,
    mockGlobalCategoriesFixture: {
      current: {
        categories: [] as unknown[],
        categoryMappings: [] as unknown[],
        dispatch: vi.fn(),
        hydrated: true,
        seedGlobalCategoriesIfNeeded: seedGlobalCategoriesIfNeededMock,
        syncNow: vi.fn().mockResolvedValue(undefined),
      },
    },
  }
})

vi.mock('./hooks/useGlobalCategories', () => ({
  useGlobalCategories: () => mockGlobalCategoriesFixture.current,
}))

// BudgetPage/SettingsPage are rendered for real (many tests below assert on
// their actual rendered content, e.g. "Add Expense" / "Google Drive Sync"),
// but wrapped here so tests can also assert exactly which props App.tsx
// passed them (the 3 new categories/categoryMappings/categoryDispatch props,
// plus categoriesHydrated for Settings).
const { budgetPagePropsCapture, settingsPagePropsCapture } = vi.hoisted(() => ({
  budgetPagePropsCapture: { current: undefined as unknown },
  settingsPagePropsCapture: { current: undefined as unknown },
}))

// Swallows a render error from the wrapped real component (used below for
// BudgetPage, which as of this task still reads the now-removed
// `state.categories`/`state.categoryMappings` fields pending T13's prop-
// threading sweep — a pre-existing, already-red intermediate state per this
// plan's own T9 acceptance note, not something this task's tests need to
// route around by asserting on rendered content).
class SwallowRenderErrors extends (await import('react')).Component<{ children: React.ReactNode }, { errored: boolean }> {
  state = { errored: false }
  static getDerivedStateFromError() {
    return { errored: true }
  }
  componentDidCatch() {}
  render() {
    return this.state.errored ? null : this.props.children
  }
}

vi.mock('./components/BudgetPage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./components/BudgetPage')>()
  return {
    ...actual,
    BudgetPage: (props: Record<string, unknown>) => {
      budgetPagePropsCapture.current = props
      return (
        <SwallowRenderErrors>
          <actual.BudgetPage {...(props as any)} />
        </SwallowRenderErrors>
      )
    },
  }
})

vi.mock('./components/Settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./components/Settings')>()
  return {
    ...actual,
    SettingsPage: (props: Record<string, unknown>) => {
      settingsPagePropsCapture.current = props
      return <actual.SettingsPage {...(props as any)} />
    },
  }
})

// PasswordGate is a full-replacement screen with its own real-crypto/form flow that's
// exercised in PasswordGate.test.tsx; here we stub it so App.tsx's own gating logic
// (show gate vs main app, wire onUnlock into hydration state) can be tested in isolation.
vi.mock('./components/PasswordGate', () => ({
  PasswordGate: ({
    onUnlock,
    shape,
  }: {
    onUnlock: (key: CryptoKey, salt: Uint8Array, loadedState?: unknown) => void
    shape?: 'absent' | 'encrypted' | null
  }) => {
    // Capture props for test verification
    passwordGatePropsCapture.shape = shape
    return (
      <button onClick={() => onUnlock(mockSessionKey, mockSessionSalt, mockUnlockLoadedState.current)}>
        MockUnlock
      </button>
    )
  },
}))

// Default routing setup for every test in this file: a single real portfolio
// in the (real, fake-indexeddb-backed) registry, with the hash already
// pointing at it, so App.tsx resolves `activePortfolio` and renders the
// gate/app shell exactly as it did pre-multi-portfolio. Tests that care about
// picker/unknown-id routing (see "multi-portfolio routing" below) override
// the registry contents and/or hash themselves before rendering.
beforeEach(async () => {
  await resetRegistryAndOpenDefaultPortfolio()
})

afterEach(() => {
  cleanup()
  window.location.hash = ''
})

/**
 * Renders <App/>, waits for the (mocked) password gate to appear, and clicks through
 * it — mirroring what a real unlock via PasswordGate's onUnlock would do — leaving the
 * Positions page (the default view) rendered.
 */
async function renderUnlockedApp() {
  const utils = render(<App />)

  await waitFor(() => {
    expect(screen.getByText('MockUnlock')).toBeTruthy()
  })
  fireEvent.click(screen.getByText('MockUnlock'))

  await waitFor(() => {
    expect(screen.queryByText('Loading...')).toBeFalsy()
    // The Nav's Positions tab is present on every post-unlock view.
    expect(screen.getByText('Positions')).toBeTruthy()
  })

  return utils
}

/**
 * Returns the clickable pill <div> for a main nav tab, given its visible label text
 * (e.g. 'Positions', 'Register', 'Quotes'). The Nav renders each tab as a plain
 * `<div onClick>` wrapping an icon + a `<span>{label}</span>` — no ARIA role or label
 * association, so tests locate the tab by its label text and walk up to the div.
 */
function navTab(label: string): HTMLElement {
  return screen.getByText(label).closest('div') as HTMLElement
}

describe('pending import processing', () => {
  it('should import positions when pendingImport is processed', () => {
    let state = initialState()

    // Create an account first
    state = appReducer(state, {
      type: 'ADD_ACCOUNT',
      account: {
        id: 'acc-1',
        accountNumber: '12345',
        name: 'Brokerage',
        taxCategory: 'Taxable',
        retirement: false,
        createdAt: '2024-01-01T00:00:00Z',
      },
    })

    // Verify the account was created
    expect(state.accounts).toHaveLength(1)

    // Create mapped rows (as they would come from applyMapping)
    const mappedRows = [
      {
        accountNumber: '12345',
        symbol: 'AAPL',
        name: 'Apple',
        assetClass: 'Equities',
        shares: '100',
        avgCost: '150',
        price: '180',
      },
    ]

    // Directly call importPositions (simulating what App.tsx effect would do)
    state = importPositions(state, 'acc-1', mappedRows, '2024-01-15', 'import-test1')

    // Verify positions were imported
    expect(state.positions).toHaveLength(1)
    expect(state.positions[0].symbol).toBe('AAPL')
    expect(state.positions[0].accountId).toBe('acc-1')
    expect(state.positions[0].shares).toBe(100)

    // Verify snapshot was created
    expect(state.snapshots).toHaveLength(1)
    expect(state.snapshots[0].accountId).toBe('acc-1')
  })

  it('should import transactions when pendingImport is processed', () => {
    let state = initialState()

    // Create an account first
    state = appReducer(state, {
      type: 'ADD_ACCOUNT',
      account: {
        id: 'acc-1',
        accountNumber: '12345',
        name: 'Brokerage',
        taxCategory: 'Taxable',
        retirement: false,
        createdAt: '2024-01-01T00:00:00Z',
      },
    })

    // Create mapped rows (as they would come from applyMapping)
    const mappedRows = [
      {
        accountNumber: '12345',
        date: '2024-01-10',
        symbol: 'AAPL',
        type: 'Buy',
        shares: '100',
        price: '150',
        amount: '15000',
      },
    ]

    // Directly call importTransactions (simulating what App.tsx effect would do)
    state = importTransactions(state, 'acc-1', mappedRows, 'import-test2')

    // Verify transactions were imported
    expect(state.transactions).toHaveLength(1)
    expect(state.transactions[0].symbol).toBe('AAPL')
    expect(state.transactions[0].accountId).toBe('acc-1')
    expect(state.transactions[0].type).toBe('Buy')
  })
})

describe('view switching (accounts vs settings)', () => {
  beforeEach(() => {
    vi.mocked(peekEnvelopeShape).mockResolvedValue('absent')
    vi.mocked(savePersistedApp).mockClear()
  })

  it('should render the Positions page by default', async () => {
    await renderUnlockedApp()

    // AccountsPage left column renders one card per tax category plus Closed Positions.
    expect(screen.getByText('Taxable')).toBeTruthy()
    expect(screen.getByText('Non-Taxable')).toBeTruthy()
    expect(screen.getByText('Tax-Deferred')).toBeTruthy()

    // The Positions nav tab is the active (highlighted) one.
    expect(navTab('Positions').style.background).toBe('var(--color-accent-100)')

    // Settings content is not rendered.
    expect(screen.queryByText('Google Drive Sync')).toBeFalsy()
  })

  it('renders the expected main nav tabs (no Dashboard tab)', async () => {
    await renderUnlockedApp()

    // The Nav renders exactly the expected main tabs (Budget, Positions, Register, Quotes)
    // and nothing else (no Dashboard tab).
    expect(screen.getByText('Budget')).toBeTruthy()
    expect(screen.getByText('Positions')).toBeTruthy()
    expect(screen.getByText('Register')).toBeTruthy()
    expect(screen.getByText('Quotes')).toBeTruthy()
    expect(screen.queryByText('Dashboard')).toBeFalsy()
  })

  it('should switch to register page when the Register tab is clicked', async () => {
    await renderUnlockedApp()

    fireEvent.click(navTab('Register'))

    await waitFor(() => {
      expect(screen.getByText('Record Balances')).toBeTruthy()
    })
  })

  it('should switch to budget page when the Budget tab is clicked', async () => {
    await renderUnlockedApp()

    fireEvent.click(navTab('Budget'))

    // Budget page defaults to the "Spend" tab; switch to "Expenses" to see
    // its content.
    await waitFor(() => {
      expect(screen.getByText('Expenses')).toBeTruthy()
    })
    fireEvent.click(screen.getByText('Expenses'))

    await waitFor(() => {
      expect(screen.getByText('Add Expense')).toBeTruthy()
    })
  })

  it('should switch to settings page when gear button is clicked', async () => {
    await renderUnlockedApp()

    // Positions content is initially visible.
    expect(screen.getByText('Tax-Deferred')).toBeTruthy()

    fireEvent.click(screen.getByTitle('Settings'))

    await waitFor(() => {
      expect(screen.getByText('Google Drive Sync')).toBeTruthy()
    })

    // Positions content is gone, and the Positions tab is no longer active.
    expect(screen.queryByText('Tax-Deferred')).toBeFalsy()
    expect(navTab('Positions').style.background).toBe('transparent')
  })

  it('should return to the Positions page when the Positions tab is clicked from settings', async () => {
    await renderUnlockedApp()

    fireEvent.click(screen.getByTitle('Settings'))
    await waitFor(() => {
      expect(screen.getByText('Google Drive Sync')).toBeTruthy()
    })

    fireEvent.click(navTab('Positions'))

    await waitFor(() => {
      expect(screen.getByText('Tax-Deferred')).toBeTruthy()
    })
    expect(screen.queryByText('Google Drive Sync')).toBeFalsy()
  })
})

describe('password gate', () => {
  beforeEach(() => {
    vi.mocked(peekEnvelopeShape).mockResolvedValue('absent')
    vi.mocked(savePersistedApp).mockClear()
  })

  it('renders PasswordGate instead of the Nav/Positions tree before unlock', async () => {
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('MockUnlock')).toBeTruthy()
    })

    // The main app tree must not be rendered underneath/alongside the gate.
    expect(screen.queryByText('Positions')).toBeFalsy()
    expect(screen.queryByText('Tax-Deferred')).toBeFalsy()
  })

  it('renders the Positions page after unlock and saves via savePersistedApp with the session key on subsequent state changes', async () => {
    await renderUnlockedApp()

    vi.mocked(savePersistedApp).mockClear()

    // Trigger a state-changing action (mirrors the debounce-save pattern used elsewhere
    // in this file: dispatch a change, then wait for the 500ms-debounced save to fire).
    // Clicking a category header dispatches TOGGLE_CATEGORY_EXPANDED.
    fireEvent.click(screen.getByText('Taxable'))

    await waitFor(() => {
      expect(savePersistedApp).toHaveBeenCalled()
    })

    const [savedState, savedKey, savedSalt] = vi.mocked(savePersistedApp).mock.calls[0]
    expect(savedState.expandedCategories.taxable).toBe(true)
    expect(savedKey).toBe(mockSessionKey)
    expect(savedSalt).toBe(mockSessionSalt)
  })

  it('never calls savePersistedApp while the gate is still showing, before onUnlock fires', async () => {
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('MockUnlock')).toBeTruthy()
    })

    // Give the (nonexistent) debounce window time to elapse; there is no user-reachable
    // path to a state-changing dispatch before unlock, but this guards the invariant
    // defensively per the plan.
    await new Promise((resolve) => setTimeout(resolve, 600))

    expect(savePersistedApp).not.toHaveBeenCalled()
  })
})

describe('persistence on unmount within the debounce window', () => {
  beforeEach(() => {
    vi.mocked(peekEnvelopeShape).mockResolvedValue('absent')
    vi.mocked(savePersistedApp).mockClear()
  })

  it('persists a state change via savePersistedApp when the app unmounts before the 500ms debounced save fires', async () => {
    const { unmount } = await renderUnlockedApp()

    vi.mocked(savePersistedApp).mockClear()

    // Change state (TOGGLE_CATEGORY_EXPANDED) — schedules a debounced save
    fireEvent.click(screen.getByText('Taxable'))

    // Unmount immediately, simulating a refresh/reload within the debounce window
    unmount()

    // The pending save must be flushed on unmount, not cancelled
    await waitFor(() => {
      expect(savePersistedApp).toHaveBeenCalled()
    })
    const lastCall = vi.mocked(savePersistedApp).mock.calls.at(-1)!
    expect(lastCall[0].expandedCategories.taxable).toBe(true)
    expect(lastCall[1]).toBe(mockSessionKey)
    expect(lastCall[2]).toBe(mockSessionSalt)
  })
})

describe('Drive-sync activation + connect/disconnect wiring', () => {
  const CONNECTED = {
    connected: true,
    email: 'test@gmail.com',
    connecting: false,
    error: null,
    needsReauth: false,
    refresh: vi.fn(),
  }

  beforeEach(async () => {
    vi.mocked(peekEnvelopeShape).mockResolvedValue('absent')
    const driveModule = await import('./lib/drive')
    vi.mocked(driveModule.driveAuth.activate).mockClear()
    vi.mocked(driveModule.driveAuth.activate).mockReturnValue(() => {})
    vi.mocked(driveModule.getBackupFileId).mockClear()
    vi.mocked(driveModule.getBackupFileId).mockResolvedValue(null)
    vi.mocked(useDriveConnection).mockReturnValue({
      connected: false,
      email: null,
      connecting: false,
      error: null,
      needsReauth: false,
      refresh: vi.fn(),
    })
  })

  // (timing, Decision 17) The pre-unlock GoogleDriveWidget path (PasswordGate
  // rendered, sessionKey still null) must not run driveAuth.activate() — a stale
  // cached token could otherwise trigger a silent Google reauth prompt before
  // local unlock.
  it('does not call driveAuth.activate() while the password gate is showing (sessionKey null)', async () => {
    const activateMock = vi.mocked(driveAuth.activate)
    activateMock.mockClear()

    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('MockUnlock')).toBeTruthy()
    })

    expect(activateMock).not.toHaveBeenCalled()
  })

  // (timing, Decision 17) activate() runs exactly once, only after unlock, and
  // its returned dispose fn runs on unmount.
  it('calls driveAuth.activate() exactly once after unlock (never before) and disposes it on unmount', async () => {
    const disposeSpy = vi.fn()
    const activateMock = vi.mocked(driveAuth.activate)
    activateMock.mockReturnValue(disposeSpy)
    activateMock.mockClear()

    const { unmount } = render(<App />)

    await waitFor(() => {
      expect(screen.getByText('MockUnlock')).toBeTruthy()
    })
    // sessionKey === null → activate must not have run yet.
    expect(activateMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('MockUnlock'))
    await waitFor(() => {
      expect(screen.getByText('Positions')).toBeTruthy()
    })

    expect(activateMock).toHaveBeenCalledTimes(1)
    expect(disposeSpy).not.toHaveBeenCalled()

    unmount()
    expect(disposeSpy).toHaveBeenCalledTimes(1)
  })

  // (wiring) GoogleDriveWidget.onConnected → App.onDriveConnected → getBackupFileId().
  // backupFileId itself is no longer surfaced in any Settings UI (the old
  // DriveRestorePanel "View backup" link was removed along with
  // SettingsPageProps.backupFileId) — this only verifies the lookup still fires.
  it('firing the widget onConnected wiring calls getBackupFileId', async () => {
    const driveModule = await import('./lib/drive')
    vi.mocked(useDriveConnection).mockReturnValue({ ...CONNECTED })

    await renderUnlockedApp()
    fireEvent.click(screen.getByTitle('Settings'))
    await waitFor(() => expect(screen.getByText('Google Drive Sync')).toBeTruthy())

    vi.mocked(driveModule.getBackupFileId).mockClear()
    vi.mocked(driveModule.getBackupFileId).mockResolvedValue('backup-file-123')

    fireEvent.click(screen.getByTestId('widget-connect'))

    await waitFor(() => {
      expect(driveModule.getBackupFileId).toHaveBeenCalledTimes(1)
    })
    // Drive Sync section still mounted — connection surfaced normally.
    expect(screen.getByText('Google Drive Sync')).toBeTruthy()
  })

  // (wiring) A rejecting getBackupFileId after onConnected must not throw and
  // must not tear down the connected UI.
  it('a rejecting getBackupFileId after onConnected does not throw and keeps the connection', async () => {
    const driveModule = await import('./lib/drive')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(useDriveConnection).mockReturnValue({ ...CONNECTED })

    await renderUnlockedApp()
    fireEvent.click(screen.getByTitle('Settings'))
    await waitFor(() => expect(screen.getByText('Google Drive Sync')).toBeTruthy())

    vi.mocked(driveModule.getBackupFileId).mockClear()
    vi.mocked(driveModule.getBackupFileId).mockRejectedValue(new Error('lookup failed'))

    fireEvent.click(screen.getByTestId('widget-connect'))

    await waitFor(() => {
      expect(driveModule.getBackupFileId).toHaveBeenCalled()
    })
    // Drive Sync section still mounted — connection not forgotten.
    expect(screen.getByText('Google Drive Sync')).toBeTruthy()
    warnSpy.mockRestore()
  })

  // (wiring) GoogleDriveWidget.onDisconnected → App.onDriveDisconnected fires
  // without throwing (backupFileId itself has no surfaced UI to assert on
  // since DriveRestorePanel was removed).
  it('firing the widget onDisconnected wiring does not throw and keeps the Drive Sync section mounted', async () => {
    const driveModule = await import('./lib/drive')
    vi.mocked(useDriveConnection).mockReturnValue({ ...CONNECTED })

    await renderUnlockedApp()
    fireEvent.click(screen.getByTitle('Settings'))
    await waitFor(() => expect(screen.getByText('Google Drive Sync')).toBeTruthy())

    // Connect first so there's a backupFileId to clear.
    vi.mocked(driveModule.getBackupFileId).mockResolvedValue('backup-file-123')
    fireEvent.click(screen.getByTestId('widget-connect'))
    await waitFor(() => {
      expect(driveModule.getBackupFileId).toHaveBeenCalled()
    })

    fireEvent.click(screen.getByTestId('widget-disconnect'))
    await waitFor(() => {
      expect(screen.getByText('Google Drive Sync')).toBeTruthy()
    })
  })
})

describe('undo closed positions', () => {
  beforeEach(() => {
    vi.mocked(peekEnvelopeShape).mockResolvedValue('absent')
    vi.mocked(savePersistedApp).mockClear()
  })

  it('opens ImportDialog Step 2 with pre-filled closed position data when Undo is clicked, and dispatches DELETE_CLOSED_POSITION after import', async () => {
    // Build initial state with a closed position
    let state = initialState()

    // Add an account
    state = appReducer(state, {
      type: 'ADD_ACCOUNT',
      account: {
        id: 'test-acc-1',
        accountNumber: '12345',
        name: 'Test Account',
        taxCategory: 'taxable',
        retirement: false,
        createdAt: '2024-01-01T00:00:00Z',
      },
    })

    // Import a position
    state = appReducer(state, {
      type: 'IMPORT_POSITIONS',
      accountId: 'test-acc-1',
      mappedRows: [
        {
          symbol: 'AAPL',
          name: 'Apple Inc',
          assetClass: 'Equities',
          shares: '100',
          avgCost: '150',
          price: '180',
        },
      ],
      importDate: new Date().toISOString(),
      fileName: 'test.csv',
      mode: 'replace',
    })

    // Close the position to create a closed position
    const positionId = state.positions[0].id
    state = appReducer(state, {
      type: 'CLOSE_POSITION',
      positionId,
      closedDate: '2024-12-01',
    })

    // Verify we have a closed position
    expect(state.closedPositions.length).toBe(1)
    const closedPosBeforeUndo = state.closedPositions[0]
    expect(closedPosBeforeUndo.symbol).toBe('AAPL')

    // Now test the delete dispatch after undo
    // Simulate the undo flow: importing and then deleting
    state = appReducer(state, {
      type: 'IMPORT_POSITIONS',
      accountId: 'test-acc-1',
      mappedRows: [
        {
          symbol: 'AAPL',
          name: 'Apple Inc',
          assetClass: 'Equities',
          shares: '0',
          avgCost: '0',
          price: '0',
        },
      ],
      importDate: new Date().toISOString(),
      fileName: 'test.csv',
      mode: 'merge',
    })

    // Now dispatch DELETE_CLOSED_POSITION
    state = appReducer(state, {
      type: 'DELETE_CLOSED_POSITION',
      id: closedPosBeforeUndo.id,
    })

    // Verify the closed position was deleted
    expect(state.closedPositions.length).toBe(0)
  })
})

describe('price sync trigger', () => {
  beforeEach(async () => {
    vi.mocked(peekEnvelopeShape).mockResolvedValue('absent')
    const priceSyncModule = await import('./lib/priceSync')
    vi.mocked(priceSyncModule.runPriceSync).mockClear()
    vi.mocked(priceSyncModule.runPriceSync).mockResolvedValue({
      patch: { lastRun: { at: '2024-01-01T00:00:00Z', updatedCount: 0, notFound: [], marketTickerCount: 0 } },
      updatedPrices: {},
    })
    mockUnlockLoadedState.current = undefined
  })

  afterEach(() => {
    mockUnlockLoadedState.current = undefined
  })

  it('calls runPriceSync once when sessionKey transitions from null to set and isHydrated is true, given a priceSync apiKey', async () => {
    let state = initialState()
    state = appReducer(state, { type: 'SET_PRICE_SYNC_API_KEY', apiKey: 'test-key' })
    mockUnlockLoadedState.current = state

    const priceSyncModule = await import('./lib/priceSync')
    const runPriceSyncMock = vi.mocked(priceSyncModule.runPriceSync)

    await renderUnlockedApp()

    await waitFor(() => {
      expect(runPriceSyncMock).toHaveBeenCalledTimes(1)
    })
    expect(runPriceSyncMock.mock.calls[0][0]).toEqual(state.priceSync)
  })

  it('does not call runPriceSync when there is no priceSync apiKey set', async () => {
    const priceSyncModule = await import('./lib/priceSync')
    const runPriceSyncMock = vi.mocked(priceSyncModule.runPriceSync)

    await renderUnlockedApp()

    // Give any pending effect a tick to fire.
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(runPriceSyncMock).not.toHaveBeenCalled()
  })
})

describe('global categories wiring', () => {
  beforeEach(() => {
    vi.mocked(peekEnvelopeShape).mockResolvedValue('absent')
    mockUnlockLoadedState.current = undefined
    seedGlobalCategoriesIfNeededMock.mockClear()
    mockGlobalCategoriesFixture.current = {
      categories: [{ id: 'cat-1', name: 'Groceries' }],
      categoryMappings: [{ description: 'trader joes', categoryId: 'cat-1' }],
      dispatch: vi.fn(),
      hydrated: true,
      seedGlobalCategoriesIfNeeded: seedGlobalCategoriesIfNeededMock,
      syncNow: vi.fn().mockResolvedValue(undefined),
    }
  })

  afterEach(() => {
    mockUnlockLoadedState.current = undefined
  })

  it('passes categories/categoryMappings/categoryDispatch to BudgetPage', async () => {
    // BudgetPage itself hasn't been migrated off `state.categories` yet (T13,
    // not this task) so it currently throws on render — a pre-existing,
    // already-red intermediate state per plan T9's own acceptance note.
    // SwallowRenderErrors above keeps that from failing this test, which only
    // cares about what App.tsx handed it as props, not what it renders.
    await renderUnlockedApp()

    fireEvent.click(navTab('Budget'))
    await waitFor(() => {
      expect(budgetPagePropsCapture.current).toBeTruthy()
    })

    const props = budgetPagePropsCapture.current as Record<string, unknown>
    expect(props.categories).toBe(mockGlobalCategoriesFixture.current.categories)
    expect(props.categoryMappings).toBe(mockGlobalCategoriesFixture.current.categoryMappings)
    expect(props.categoryDispatch).toBe(mockGlobalCategoriesFixture.current.dispatch)
  })

  it('passes categories/categoryMappings/categoryDispatch/categoriesHydrated to SettingsPage', async () => {
    await renderUnlockedApp()

    fireEvent.click(screen.getByTitle('Settings'))
    await waitFor(() => {
      expect(screen.getByText('Google Drive Sync')).toBeTruthy()
    })

    const props = settingsPagePropsCapture.current as Record<string, unknown>
    expect(props.categories).toBe(mockGlobalCategoriesFixture.current.categories)
    expect(props.categoryMappings).toBe(mockGlobalCategoriesFixture.current.categoryMappings)
    expect(props.categoryDispatch).toBe(mockGlobalCategoriesFixture.current.dispatch)
    expect(props.categoriesHydrated).toBe(true)
  })

  it('passes driveConnected to SettingsPage reflecting useDriveConnection', async () => {
    vi.mocked(useDriveConnection).mockReturnValue({
      connected: true,
      email: 'user@example.com',
      connecting: false,
      error: null,
      needsReauth: false,
      refresh: vi.fn(),
    })

    await renderUnlockedApp()

    fireEvent.click(screen.getByTitle('Settings'))
    await waitFor(() => {
      expect(screen.getByText('Google Drive Sync')).toBeTruthy()
    })

    const props = settingsPagePropsCapture.current as Record<string, unknown>
    expect(props.driveConnected).toBe(true)
  })

  it('passes driveConnected=false to SettingsPage when not connected', async () => {
    vi.mocked(useDriveConnection).mockReturnValue({
      connected: false,
      email: null,
      connecting: false,
      error: null,
      needsReauth: false,
      refresh: vi.fn(),
    })

    await renderUnlockedApp()

    fireEvent.click(screen.getByTitle('Settings'))
    await waitFor(() => {
      expect(screen.getByText('Google Drive Sync')).toBeTruthy()
    })

    const props = settingsPagePropsCapture.current as Record<string, unknown>
    expect(props.driveConnected).toBe(false)
  })

  it('calls seedGlobalCategoriesIfNeeded exactly once per portfolio activation with (activePortfolio, rawBlob)', async () => {
    const persistModule = await import('./lib/persist')
    vi.mocked(persistModule.loadRawPersistedBlob).mockResolvedValue({ categories: [{ id: 'legacy-1', name: 'Legacy' }] })

    const portfolio = await resetRegistryAndOpenDefaultPortfolio()
    await renderUnlockedApp()

    await waitFor(() => {
      expect(seedGlobalCategoriesIfNeededMock).toHaveBeenCalledTimes(1)
    })
    expect(seedGlobalCategoriesIfNeededMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: portfolio.id }),
      { categories: [{ id: 'legacy-1', name: 'Legacy' }] }
    )

    // Further state changes / re-renders must not re-trigger the seed.
    fireEvent.click(navTab('Register'))
    await waitFor(() => {
      expect(screen.getByText('Record Balances')).toBeTruthy()
    })
    expect(seedGlobalCategoriesIfNeededMock).toHaveBeenCalledTimes(1)
  })
})

describe('auto-lock on inactivity', () => {
  const LOCK_ABSOLUTE_MS = 2 * 60 * 60 * 1000 // 2h
  const LOCK_IDLE_MS = 5 * 60 * 1000 // 5min

  beforeEach(() => {
    vi.mocked(peekEnvelopeShape).mockResolvedValue('absent')
    mockUnlockLoadedState.current = undefined
    // shouldAdvanceTime lets real wall-clock time trickle forward too, so
    // @testing-library's setTimeout-based `waitFor` polling (used while
    // unlocking via renderUnlockedApp) doesn't hang waiting on a fake
    // timer that nothing is advancing.
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
    mockUnlockLoadedState.current = undefined
    // Undo the visibilityState stub some tests below install on `document`,
    // so it doesn't leak into other tests in this file.
    delete (document as { visibilityState?: string }).visibilityState
  })

  /** True once the app has locked back to the (mocked) password gate. */
  function isLocked() {
    return !!screen.queryByText('MockUnlock')
  }

  /** True while the unlocked dashboard/Nav is showing. */
  function isUnlocked() {
    return !!screen.queryByText('Positions')
  }

  it('stays unlocked after almost 2h with zero activity', async () => {
    await renderUnlockedApp()

    act(() => {
      vi.advanceTimersByTime(LOCK_ABSOLUTE_MS - 1000)
    })

    expect(isUnlocked()).toBe(true)
    expect(isLocked()).toBe(false)
  })

  it('stays unlocked past the 2h mark when activity reset the idle clock near the boundary', async () => {
    await renderUnlockedApp()

    // Advance to just under 2h, then register activity — this resets the
    // 5-minute idle clock even though the absolute-session clock keeps running.
    act(() => {
      vi.advanceTimersByTime(LOCK_ABSOLUTE_MS - 60_000) // 1h59m
    })
    act(() => {
      fireEvent.mouseDown(document)
    })

    // Now past the 2h absolute mark, but well within 5min of that activity.
    act(() => {
      vi.advanceTimersByTime(2 * 60_000) // +2min -> 2h01m total elapsed
    })

    expect(isUnlocked()).toBe(true)
    expect(isLocked()).toBe(false)
  })

  it('locks once past 2h absolute AND 5+min idle with no activity', async () => {
    await renderUnlockedApp()

    act(() => {
      vi.advanceTimersByTime(LOCK_ABSOLUTE_MS + LOCK_IDLE_MS + 1000)
    })

    expect(isLocked()).toBe(true)
    expect(isUnlocked()).toBe(false)
  })

  it('locks immediately on visibilitychange after a background gap, without waiting for the next interval tick', async () => {
    await renderUnlockedApp()

    // Simulate the tab being backgrounded/suspended: jump the system clock
    // directly instead of advancing fake timers (which would also fire a
    // few hundred pointless 30s interval ticks and wouldn't isolate the
    // visibilitychange code path).
    act(() => {
      vi.setSystemTime(Date.now() + LOCK_ABSOLUTE_MS + 10 * 60_000) // +2h10m
    })

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(isLocked()).toBe(true)
    expect(isUnlocked()).toBe(false)
  })

  it('flushes a pending debounced save before locking, with the still-valid session key/salt', async () => {
    await renderUnlockedApp()

    vi.mocked(savePersistedApp).mockClear()

    // Dispatch a state change (TOGGLE_CATEGORY_EXPANDED) — schedules the
    // 500ms-debounced save, matching the pattern used elsewhere in this file.
    // Advance the lock-triggering time immediately afterward, without first
    // letting the debounce timer run to completion on its own, so a flush
    // during lockNow() is the thing under test.
    act(() => {
      fireEvent.click(screen.getByText('Taxable'))
    })

    act(() => {
      vi.advanceTimersByTime(LOCK_ABSOLUTE_MS + LOCK_IDLE_MS + 1000)
    })

    expect(isLocked()).toBe(true)

    // savePersistedApp must have been called (either via the debounce timer
    // firing during the advance, or via lockNow()'s own best-effort flush —
    // both use the same still-valid session key/salt) with non-null key/salt.
    expect(savePersistedApp).toHaveBeenCalled()
    const calls = vi.mocked(savePersistedApp).mock.calls
    for (const [, key, salt] of calls) {
      expect(key).toBe(mockSessionKey)
      expect(salt).toBe(mockSessionSalt)
    }
    // The latest flushed state reflects the pending change.
    const lastCall = calls.at(-1)!
    expect(lastCall[0].expandedCategories.taxable).toBe(true)
  })

  it('resets state to initialState() on lock, while gateShape stays "encrypted" (not "absent"/first-run)', async () => {
    vi.mocked(peekEnvelopeShape).mockResolvedValue('encrypted')

    let state = initialState()
    state = appReducer(state, {
      type: 'ADD_ACCOUNT',
      account: {
        id: 'auto-lock-acc-1',
        accountNumber: '999',
        name: 'Auto Lock Test Acct',
        taxCategory: 'taxable',
        retirement: false,
        createdAt: '2024-01-01T00:00:00Z',
      },
    })
    // Expand the Taxable category card so the account row (and its name) renders.
    state = appReducer(state, { type: 'TOGGLE_CATEGORY_EXPANDED', categoryKey: 'taxable' })
    mockUnlockLoadedState.current = state

    await renderUnlockedApp()

    // Data is present pre-lock.
    expect(screen.getByText(/Auto Lock Test Acct/)).toBeTruthy()

    // Don't re-inject the loaded state on the next (post-lock) unlock click.
    mockUnlockLoadedState.current = undefined

    act(() => {
      vi.advanceTimersByTime(LOCK_ABSOLUTE_MS + LOCK_IDLE_MS + 1000)
    })

    expect(isLocked()).toBe(true)
    expect(isUnlocked()).toBe(false)

    // gateShape was left untouched by lockNow() — still 'encrypted', not
    // reset to 'absent' (which would incorrectly show a first-run/create-
    // password screen instead of an enter-password screen).
    expect(passwordGatePropsCapture.shape).toBe('encrypted')

    // Unlock again (no loadedState this time) to observe the state that
    // lockNow() left behind: it should be initialState(), i.e. the account
    // added above is gone.
    fireEvent.click(screen.getByText('MockUnlock'))

    await waitFor(() => {
      expect(screen.queryByText('Loading...')).toBeFalsy()
      expect(screen.getByText('Positions')).toBeTruthy()
    })

    expect(screen.queryByText(/Auto Lock Test Acct/)).toBeFalsy()
  })
})

describe('Drive sync conflict resolution', () => {
  let alertSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    vi.mocked(peekEnvelopeShape).mockResolvedValue('absent')
    mockUnlockLoadedState.current = undefined
    alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    vi.mocked(useDriveConnection).mockReturnValue({
      connected: true,
      email: 'test@gmail.com',
      connecting: false,
      error: null,
      needsReauth: false,
      refresh: vi.fn(),
    })
    const driveModule = await import('./lib/drive')
    vi.mocked(driveModule.getBackupFileId).mockResolvedValue(null)
    vi.mocked(driveModule.syncBackup).mockReset()
    vi.mocked(driveModule.overwriteLocalWithRemote).mockReset()
    vi.mocked(driveModule.overwriteRemoteWithLocal).mockReset()
    vi.mocked(driveModule.getBackupFileStatus).mockReset()
    // Default: no timestamps → conflict path can't classify drift → dialog opens.
    vi.mocked(driveModule.getBackupFileStatus).mockResolvedValue({
      exists: true,
    })
  })

  afterEach(() => {
    alertSpy.mockRestore()
    vi.mocked(console.error).mockRestore?.()
    mockUnlockLoadedState.current = undefined
  })

  function remoteChangedError(reason = 'remote-changed') {
    return Object.assign(new Error('File x changed on Drive since it was last restored'), {
      name: 'RemoteChangedError',
      reason,
      fileId: 'file-1',
    })
  }

  /** Unlock, wait for the Drive Sync button, click it. */
  async function renderAndSync() {
    const utils = await renderUnlockedApp()
    const syncButton = await screen.findByTitle('Sync now')
    fireEvent.click(syncButton)
    return utils
  }

  it('(bug-reveal) opens SyncConflictDialog and does NOT alert "Sync failed" when syncBackup throws RemoteChangedError', async () => {
    const driveModule = await import('./lib/drive')
    vi.mocked(driveModule.syncBackup).mockRejectedValue(remoteChangedError())

    await renderAndSync()

    expect(await screen.findByText('Drive backup changed')).toBeTruthy()
    expect(alertSpy).not.toHaveBeenCalledWith(expect.stringContaining('Sync failed'))
  })

  it('(edge) opens the dialog even when the RemoteChangedError reason is "never-restored"', async () => {
    const driveModule = await import('./lib/drive')
    vi.mocked(driveModule.syncBackup).mockRejectedValue(remoteChangedError('never-restored'))

    await renderAndSync()

    expect(await screen.findByText('Drive backup changed')).toBeTruthy()
    expect(alertSpy).not.toHaveBeenCalledWith(expect.stringContaining('Sync failed'))
  })

  it('(happy — take remote) overwriteLocalWithRemote is called with (fileId, key) and the dialog closes', async () => {
    const driveModule = await import('./lib/drive')
    vi.mocked(driveModule.syncBackup).mockRejectedValue(remoteChangedError())
    vi.mocked(driveModule.getBackupFileStatus).mockResolvedValue({
      exists: true,
      remoteModifiedTime: '2026-02-01T10:00:00Z',
      lastRestoredAt: Date.parse('2026-01-15T09:00:00Z'),
    })
    const restoredState = initialState()
    vi.mocked(driveModule.overwriteLocalWithRemote).mockResolvedValue(restoredState)

    await renderAndSync()

    fireEvent.click(await screen.findByRole('button', { name: 'Overwrite local with remote' }))

    await waitFor(() => {
      expect(driveModule.overwriteLocalWithRemote).toHaveBeenCalledWith(expect.any(Object), 'file-1', mockSessionKey)
    })
    await waitFor(() => {
      expect(screen.queryByText('Drive backup changed')).toBeFalsy()
    })
  })

  it('(happy — push local) overwriteRemoteWithLocal is called with (state, key, salt, fileId), dialog closes, alerts "Synced to Drive"', async () => {
    const driveModule = await import('./lib/drive')
    vi.mocked(driveModule.syncBackup).mockRejectedValue(remoteChangedError())
    vi.mocked(driveModule.overwriteRemoteWithLocal).mockResolvedValue('file-1')

    await renderAndSync()

    fireEvent.click(await screen.findByRole('button', { name: 'Overwrite remote with local' }))

    await waitFor(() => {
      expect(driveModule.overwriteRemoteWithLocal).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Object),
        mockSessionKey,
        mockSessionSalt,
        'file-1'
      )
    })
    await waitFor(() => {
      expect(screen.queryByText('Drive backup changed')).toBeFalsy()
    })
    expect(alertSpy).toHaveBeenCalledWith('Synced to Drive')
  })

  it('(edge — push race) a RemoteChangedError from overwriteRemoteWithLocal keeps the dialog open with a generic inline error, no retry, no success alert', async () => {
    const driveModule = await import('./lib/drive')
    vi.mocked(driveModule.syncBackup).mockRejectedValue(remoteChangedError())
    vi.mocked(driveModule.overwriteRemoteWithLocal).mockRejectedValue({ name: 'RemoteChangedError' })

    await renderAndSync()

    fireEvent.click(await screen.findByRole('button', { name: 'Overwrite remote with local' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy()
    })
    expect(screen.getByText('Drive backup changed')).toBeTruthy()
    expect(driveModule.overwriteRemoteWithLocal).toHaveBeenCalledTimes(1)
    expect(alertSpy).not.toHaveBeenCalledWith('Synced to Drive')
  })

  it('(edge — other error) a plain Error from syncBackup takes the existing alert path and shows no dialog', async () => {
    const driveModule = await import('./lib/drive')
    vi.mocked(driveModule.syncBackup).mockRejectedValue(new Error('network down'))

    await renderAndSync()

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith('Sync failed: network down')
    })
    expect(screen.queryByText('Drive backup changed')).toBeFalsy()
  })

  it('(edge) a NeedsReauthError from syncBackup falls through to the generic "Sync failed" alert, with no dialog', async () => {
    const driveModule = await import('./lib/drive')
    vi.mocked(driveModule.syncBackup).mockRejectedValue(
      Object.assign(new Error('needs reauth'), { name: 'NeedsReauthError' })
    )

    await renderAndSync()

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith('Sync failed: needs reauth')
    })
    expect(screen.queryByText('Drive backup changed')).toBeFalsy()
  })

  it('(error) a NeedsReauthError from overwriteLocalWithRemote surfaces a generic inline error and keeps the dialog open', async () => {
    const driveModule = await import('./lib/drive')
    vi.mocked(driveModule.syncBackup).mockRejectedValue(remoteChangedError())
    vi.mocked(driveModule.overwriteLocalWithRemote).mockRejectedValue(
      Object.assign(new Error('needs reauth'), { name: 'NeedsReauthError' })
    )

    await renderAndSync()

    fireEvent.click(await screen.findByRole('button', { name: 'Overwrite local with remote' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy()
    })
    expect(screen.getByText('Drive backup changed')).toBeTruthy()
    expect(driveModule.overwriteLocalWithRemote).toHaveBeenCalledTimes(1)
    expect(alertSpy).not.toHaveBeenCalledWith('Synced to Drive')
  })

  it('(error) a NeedsReauthError from overwriteRemoteWithLocal surfaces a generic inline error and keeps the dialog open', async () => {
    const driveModule = await import('./lib/drive')
    vi.mocked(driveModule.syncBackup).mockRejectedValue(remoteChangedError())
    vi.mocked(driveModule.overwriteRemoteWithLocal).mockRejectedValue(
      Object.assign(new Error('needs reauth'), { name: 'NeedsReauthError' })
    )

    await renderAndSync()

    fireEvent.click(await screen.findByRole('button', { name: 'Overwrite remote with local' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy()
    })
    expect(screen.getByText('Drive backup changed')).toBeTruthy()
    expect(driveModule.overwriteRemoteWithLocal).toHaveBeenCalledTimes(1)
    expect(alertSpy).not.toHaveBeenCalledWith('Synced to Drive')
  })

  it('(edge) Cancel unmounts the dialog and calls no resolution helper', async () => {
    const driveModule = await import('./lib/drive')
    vi.mocked(driveModule.syncBackup).mockRejectedValue(remoteChangedError())

    await renderAndSync()

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))

    await waitFor(() => {
      expect(screen.queryByText('Drive backup changed')).toBeFalsy()
    })
    expect(driveModule.overwriteLocalWithRemote).not.toHaveBeenCalled()
    expect(driveModule.overwriteRemoteWithLocal).not.toHaveBeenCalled()
  })

  it('(bug-reveal — spurious version drift) when remote content is NOT newer than the last restore, re-pushes local silently with no dialog', async () => {
    const driveModule = await import('./lib/drive')
    vi.mocked(driveModule.syncBackup).mockRejectedValue(remoteChangedError())
    // Remote's content modified-time is one second BEFORE our last restore —
    // the RemoteChangedError is version-counter drift, not a real remote edit.
    vi.mocked(driveModule.getBackupFileStatus).mockResolvedValue({
      exists: true,
      remoteModifiedTime: '2026-08-22T08:36:40Z',
      lastRestoredAt: Date.parse('2026-08-22T08:36:41Z'),
    })
    vi.mocked(driveModule.overwriteRemoteWithLocal).mockResolvedValue('file-1')

    await renderAndSync()

    await waitFor(() => {
      expect(driveModule.overwriteRemoteWithLocal).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Object),
        mockSessionKey,
        mockSessionSalt,
        'file-1'
      )
    })
    expect(screen.queryByText('Drive backup changed')).toBeFalsy()
    expect(alertSpy).toHaveBeenCalledWith('Synced to Drive')
    expect(driveModule.overwriteLocalWithRemote).not.toHaveBeenCalled()
  })

  it('(edge — spurious drift, silent re-push fails) falls back to opening the dialog', async () => {
    const driveModule = await import('./lib/drive')
    vi.mocked(driveModule.syncBackup).mockRejectedValue(remoteChangedError())
    vi.mocked(driveModule.getBackupFileStatus).mockResolvedValue({
      exists: true,
      remoteModifiedTime: '2026-08-22T08:36:40Z',
      lastRestoredAt: Date.parse('2026-08-22T08:36:41Z'),
    })
    vi.mocked(driveModule.overwriteRemoteWithLocal).mockRejectedValue(new Error('network down'))

    await renderAndSync()

    expect(await screen.findByText('Drive backup changed')).toBeTruthy()
    expect(alertSpy).not.toHaveBeenCalledWith('Synced to Drive')
  })
})

describe('multi-portfolio routing', () => {
  beforeEach(() => {
    vi.mocked(peekEnvelopeShape).mockResolvedValue('absent')
    vi.mocked(setActivePortfolioDb).mockClear()
  })

  it('renders PortfolioPicker (not the gate/app shell) when navigating to #/ with zero portfolios', async () => {
    // Override the top-level beforeEach's single-portfolio setup: empty the
    // registry back out and point the hash at the picker route.
    await clearRegistryStore()
    _resetRegistryForTests()
    window.location.hash = '#/'

    render(<App />)

    // PortfolioPicker's "New portfolio" card, distinctive to that component.
    await waitFor(() => {
      expect(screen.getByText('Create')).toBeTruthy()
    })
    expect(screen.queryByText('MockUnlock')).toBeFalsy()
    expect(screen.queryByText('Positions')).toBeFalsy()
  })

  it('navigating to #/portfolio/<valid-id> calls setActivePortfolioDb with that portfolio\'s dbName and renders the gate/app shell', async () => {
    const portfolio = await createPortfolio('Second Portfolio')
    window.location.hash = `#/portfolio/${portfolio.id}`

    render(<App />)

    await waitFor(() => {
      expect(setActivePortfolioDb).toHaveBeenCalledWith(portfolio.dbName)
    })
    // Gate/app shell (mocked PasswordGate), not the picker.
    await waitFor(() => {
      expect(screen.getByText('MockUnlock')).toBeTruthy()
    })
    expect(screen.queryByText('Create')).toBeFalsy()
  })

  it('navigating to #/portfolio/<unknown-id> redirects the hash to #/ and renders the picker', async () => {
    window.location.hash = '#/portfolio/does-not-exist'

    render(<App />)

    await waitFor(() => {
      expect(window.location.hash).toBe('#/')
    })
    await waitFor(() => {
      expect(screen.getByText('Create')).toBeTruthy()
    })
    expect(screen.queryByText('MockUnlock')).toBeFalsy()
  })

  it('clicking "Switch portfolio" in Nav navigates the hash back to #/ and renders the picker', async () => {
    // renderUnlockedApp relies on the top-level beforeEach's default
    // portfolio + hash, then unlocks through the mocked PasswordGate.
    await renderUnlockedApp()

    fireEvent.click(screen.getByTitle('Switch portfolio'))

    await waitFor(() => {
      expect(window.location.hash).toBe('#/')
    })
    await waitFor(() => {
      expect(screen.getByText('Create')).toBeTruthy()
    })
    expect(screen.queryByText('Positions')).toBeFalsy()
  })
})
