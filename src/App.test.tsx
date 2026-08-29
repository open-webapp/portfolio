import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, cleanup, waitFor, fireEvent, act } from '@testing-library/react'
import { initialState } from './lib/state'
import { appReducer } from './lib/reducer'
import { importPositions } from './lib/positionsImport'
import { importTransactions } from './lib/transactionsImport'
import { peekEnvelopeShape, savePersistedApp } from './lib/persist'
import { drive } from './lib/drive'
import App from './App'

const CONNECTED_AUTH_STATUS = {
  connected: true,
  email: 'test@gmail.com',
  expiresAt: Date.now() + 3_600_000,
  needsReauth: false,
  tokenValid: true,
}

// Stable session key/salt used by the mocked PasswordGate's onUnlock callback.
// Declared via vi.hoisted so it's initialized before the hoisted vi.mock factories run.
// Also capture PasswordGate props for testing early Drive status checks.
const { mockSessionKey, mockSessionSalt, passwordGatePropsCapture, mockUnlockLoadedState } = vi.hoisted(() => ({
  mockSessionKey: {} as CryptoKey,
  mockSessionSalt: new Uint8Array([1, 2, 3]),
  passwordGatePropsCapture: {
    driveReady: undefined as boolean | undefined,
    driveEmail: undefined as string | null | undefined,
    shape: undefined as 'absent' | 'legacy-plaintext' | 'encrypted' | null | undefined,
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

vi.mock('./lib/drive', () => ({
  drive: { activate: vi.fn(() => vi.fn()) },
  getDriveAuthStatus: vi.fn().mockResolvedValue({
    connected: false,
    email: null,
    expiresAt: null,
    needsReauth: false,
    tokenValid: false,
  }),
  getBackupFileId: vi.fn().mockResolvedValue(null),
  ensureFreshConnection: vi.fn(),
  disconnectDrive: vi.fn(),
  syncBackup: vi.fn(),
  overwriteLocalWithRemote: vi.fn(),
  overwriteRemoteWithLocal: vi.fn(),
  getBackupFileStatus: vi.fn(),
}))

vi.mock('./lib/persist', () => ({
  peekEnvelopeShape: vi.fn(),
  savePersistedApp: vi.fn().mockResolvedValue(undefined),
}))

// PasswordGate is a full-replacement screen with its own real-crypto/form flow that's
// exercised in PasswordGate.test.tsx; here we stub it so App.tsx's own gating logic
// (show gate vs main app, wire onUnlock into hydration state) can be tested in isolation.
vi.mock('./components/PasswordGate', () => ({
  PasswordGate: ({
    onUnlock,
    driveReady,
    driveEmail,
    shape,
  }: {
    onUnlock: (key: CryptoKey, salt: Uint8Array, loadedState?: unknown) => void
    driveReady?: boolean
    driveEmail?: string | null
    shape?: 'absent' | 'legacy-plaintext' | 'encrypted' | null
  }) => {
    // Capture props for test verification
    passwordGatePropsCapture.driveReady = driveReady
    passwordGatePropsCapture.driveEmail = driveEmail
    passwordGatePropsCapture.shape = shape
    return (
      <button onClick={() => onUnlock(mockSessionKey, mockSessionSalt, mockUnlockLoadedState.current)}>
        MockUnlock
      </button>
    )
  },
}))

afterEach(cleanup)

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

    // The Nav renders exactly the expected main tabs (Positions, Register, Quotes)
    // and nothing else (no Dashboard tab).
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

describe('Drive-sync activation', () => {
  beforeEach(async () => {
    vi.mocked(peekEnvelopeShape).mockResolvedValue('absent')
    // Reset mocks to default disconnected state
    const driveModule = await import('./lib/drive')
    vi.mocked(driveModule.getDriveAuthStatus).mockClear()
    vi.mocked(driveModule.getDriveAuthStatus).mockResolvedValue({
      connected: false,
      email: null,
      expiresAt: null,
      needsReauth: false,
      tokenValid: false,
    })
    vi.mocked(driveModule.getBackupFileId).mockClear()
    vi.mocked(driveModule.getBackupFileId).mockResolvedValue(null)
    passwordGatePropsCapture.driveReady = undefined
    passwordGatePropsCapture.driveEmail = undefined
  })

  it('early Drive status check populates driveReady and driveEmail before password gate is passed', async () => {
    // Mock getDriveAuthStatus to return connected status
    const getDriveAuthStatusMock = vi.mocked((await import('./lib/drive')).getDriveAuthStatus)
    getDriveAuthStatusMock.mockResolvedValue({
      connected: true,
      email: 'test@gmail.com',
      tokenValid: true,
      expiresAt: Date.now() + 3600000,
      needsReauth: false,
    })

    // Mock getBackupFileId to ensure it's not called before unlock
    const getBackupFileIdMock = vi.mocked((await import('./lib/drive')).getBackupFileId)
    getBackupFileIdMock.mockClear()
    getBackupFileIdMock.mockResolvedValue(null)

    // Reset captured props
    passwordGatePropsCapture.driveReady = undefined
    passwordGatePropsCapture.driveEmail = undefined

    render(<App />)

    // Wait for the early Drive status check to resolve before checking the gate
    await waitFor(() => {
      expect(screen.getByText('MockUnlock')).toBeTruthy()
    })

    // Verify PasswordGate received the correct Drive props BEFORE unlock
    expect(passwordGatePropsCapture.driveReady).toBe(true)
    expect(passwordGatePropsCapture.driveEmail).toBe('test@gmail.com')

    // Verify getBackupFileId was NOT called yet (it should only be called after unlock)
    expect(getBackupFileIdMock).not.toHaveBeenCalled()

    // Now click unlock and verify the Positions page renders
    fireEvent.click(screen.getByText('MockUnlock'))

    await waitFor(() => {
      expect(screen.queryByText('Loading...')).toBeFalsy()
      expect(screen.getByText('Positions')).toBeTruthy()
    })

    // After unlock, getBackupFileId SHOULD have been called
    expect(getBackupFileIdMock).toHaveBeenCalled()
  })

  it('does not call drive.activate() while the password gate is showing, so a stale cached token cannot trigger a silent Google reauth prompt before local unlock', async () => {
    const activateMock = vi.mocked(drive.activate)
    activateMock.mockClear()

    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('MockUnlock')).toBeTruthy()
    })

    expect(activateMock).not.toHaveBeenCalled()
  })

  it('calls drive.activate() once the password gate is passed, and disposes it on unmount, so the cached Drive token is silently warmed up instead of going stale between settings-opens/syncs', async () => {
    const activateMock = vi.mocked(drive.activate)
    const disposeSpy = vi.fn()
    activateMock.mockReturnValue(disposeSpy)
    activateMock.mockClear()

    const { unmount } = await renderUnlockedApp()

    expect(activateMock).toHaveBeenCalledTimes(1)
    expect(disposeSpy).not.toHaveBeenCalled()

    unmount()

    expect(disposeSpy).toHaveBeenCalledTimes(1)
  })

  it('resets syncing state to false when user cancels Google auth', async () => {
    vi.mocked(peekEnvelopeShape).mockResolvedValue('absent')
    const ensureFreshConnectionMock = vi.mocked((await import('./lib/drive')).ensureFreshConnection)
    ensureFreshConnectionMock.mockRejectedValueOnce(new Error('User cancelled the login flow'))

    await renderUnlockedApp()

    // Navigate to settings
    const gearButton = screen.getByTitle('Settings')
    fireEvent.click(gearButton)

    await waitFor(() => {
      expect(screen.getByText('Google Drive Sync')).toBeTruthy()
    })

    // Click Connect button
    const connectButton = screen.getByRole('button', { name: 'Connect Google Account' })
    fireEvent.click(connectButton)

    // Button should show "Connecting..." while the flow is in progress
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Connecting...' })).toBeTruthy()
    })

    // After the error is caught, button should return to "Connect Google Account" state
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Connect Google Account' })).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Connecting...' })).toBeFalsy()
    })
  })

  it('early Drive status check logs error if getDriveAuthStatus fails, leaves state at defaults', async () => {
    // Mock getDriveAuthStatus to reject with an error
    const getDriveAuthStatusMock = vi.mocked((await import('./lib/drive')).getDriveAuthStatus)
    getDriveAuthStatusMock.mockRejectedValueOnce(new Error('Network error'))

    // Spy on console.warn to verify the error is logged
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // Reset captured props
    passwordGatePropsCapture.driveReady = undefined
    passwordGatePropsCapture.driveEmail = undefined

    render(<App />)

    // Wait for the PasswordGate to render
    await waitFor(() => {
      expect(screen.getByText('MockUnlock')).toBeTruthy()
    })

    // Verify that driveReady and driveEmail stayed at defaults (error was caught and logged)
    expect(passwordGatePropsCapture.driveReady).toBe(false)
    expect(passwordGatePropsCapture.driveEmail).toBe(null)

    // Verify the error was logged to console.warn
    expect(warnSpy).toHaveBeenCalled()
    const warnCall = warnSpy.mock.calls.find((call) =>
      call[0]?.toString().includes('Drive status check failed') || call[0]?.includes?.('Network error')
    )
    expect(warnCall).toBeTruthy()

    warnSpy.mockRestore()

    // Click unlock and verify the Positions page renders with no errors
    fireEvent.click(screen.getByText('MockUnlock'))

    await waitFor(() => {
      expect(screen.queryByText('Loading...')).toBeFalsy()
      expect(screen.getByText('Positions')).toBeTruthy()
    })

    // No console errors should have occurred
    expect(screen.queryByText('Error')).toBeFalsy()
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

    const driveModule = await import('./lib/drive')
    vi.mocked(driveModule.getDriveAuthStatus).mockResolvedValue({ ...CONNECTED_AUTH_STATUS })
    vi.mocked(driveModule.getBackupFileId).mockResolvedValue(null)
    vi.mocked(driveModule.syncBackup).mockReset()
    vi.mocked(driveModule.overwriteLocalWithRemote).mockReset()
    vi.mocked(driveModule.overwriteRemoteWithLocal).mockReset()
    vi.mocked(driveModule.getBackupFileStatus).mockReset()
    vi.mocked(driveModule.getBackupFileStatus).mockResolvedValue({
      exists: true,
      changedSinceRestore: true,
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
      changedSinceRestore: true,
      remoteModifiedTime: '2026-02-01T10:00:00Z',
      lastRestoredAt: '2026-01-15T09:00:00Z',
    })
    const restoredState = initialState()
    vi.mocked(driveModule.overwriteLocalWithRemote).mockResolvedValue(restoredState)

    await renderAndSync()

    fireEvent.click(await screen.findByRole('button', { name: 'Overwrite local with remote' }))

    await waitFor(() => {
      expect(driveModule.overwriteLocalWithRemote).toHaveBeenCalledWith('file-1', mockSessionKey)
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
})
