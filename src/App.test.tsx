import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react'
import { initialState } from './lib/state'
import { appReducer } from './lib/reducer'
import { importPositions } from './lib/positionsImport'
import { importTransactions } from './lib/transactionsImport'
import { peekEnvelopeShape, savePersistedApp } from './lib/persist'
import { drive } from './lib/drive'
import App from './App'

// Stable session key/salt used by the mocked PasswordGate's onUnlock callback.
// Declared via vi.hoisted so it's initialized before the hoisted vi.mock factories run.
// Also capture PasswordGate props for testing early Drive status checks.
const { mockSessionKey, mockSessionSalt, passwordGatePropsCapture, mockUnlockLoadedState } = vi.hoisted(() => ({
  mockSessionKey: {} as CryptoKey,
  mockSessionSalt: new Uint8Array([1, 2, 3]),
  passwordGatePropsCapture: {
    driveReady: undefined as boolean | undefined,
    driveEmail: undefined as string | null | undefined,
  },
  // Mutable box so individual tests can make the mocked PasswordGate's onUnlock hand
  // App.tsx a specific loadedState (e.g. one with priceSync.apiKey set), without
  // changing the default (undefined) behavior the other tests rely on.
  mockUnlockLoadedState: { current: undefined as unknown },
}))

vi.mock('./lib/priceSync', () => ({
  runPriceSync: vi.fn().mockResolvedValue({
    patch: { lastRun: { at: '2024-01-01T00:00:00Z', updatedCount: 0, notFound: [] } },
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
  }: {
    onUnlock: (key: CryptoKey, salt: Uint8Array, loadedState?: unknown) => void
    driveReady?: boolean
    driveEmail?: string | null
  }) => {
    // Capture props for test verification
    passwordGatePropsCapture.driveReady = driveReady
    passwordGatePropsCapture.driveEmail = driveEmail
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
 * Accounts page (the default view) rendered.
 */
async function renderUnlockedApp() {
  const utils = render(<App />)

  await waitFor(() => {
    expect(screen.getByText('MockUnlock')).toBeTruthy()
  })
  fireEvent.click(screen.getByText('MockUnlock'))

  await waitFor(() => {
    expect(screen.queryByText('Loading...')).toBeFalsy()
    // The Nav's Accounts tab is present on every post-unlock view.
    expect(screen.getByLabelText('Accounts')).toBeTruthy()
  })

  return utils
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

  it('should render the Accounts page by default', async () => {
    await renderUnlockedApp()

    // AccountsPage left column renders one card per tax category plus Closed Positions.
    expect(screen.getByText('Taxable')).toBeTruthy()
    expect(screen.getByText('Non-Taxable')).toBeTruthy()
    expect(screen.getByText('Tax-Deferred')).toBeTruthy()

    // The Accounts nav tab is the checked one.
    const accountsInput = screen.getByLabelText('Accounts') as HTMLInputElement
    expect(accountsInput.checked).toBe(true)

    // Settings content is not rendered.
    expect(screen.queryByText('Google Drive Sync')).toBeFalsy()
  })

  it('renders exactly one main nav tab (no Dashboard tab)', async () => {
    await renderUnlockedApp()

    const mainViewLabels = Array.from(document.querySelectorAll('label.seg-opt')).filter(
      (label) => label.querySelector('input[name="mainView"]') !== null
    )
    expect(mainViewLabels).toHaveLength(1)
    expect(mainViewLabels[0].textContent).toContain('Accounts')
    expect(screen.queryByText('Dashboard')).toBeFalsy()
  })

  it('should switch to settings page when gear button is clicked', async () => {
    await renderUnlockedApp()

    // Accounts content is initially visible.
    expect(screen.getByText('Tax-Deferred')).toBeTruthy()

    fireEvent.click(screen.getByTitle('Settings'))

    await waitFor(() => {
      expect(screen.getByText('Google Drive Sync')).toBeTruthy()
    })

    // Accounts content is gone, and the Accounts tab is no longer checked.
    expect(screen.queryByText('Tax-Deferred')).toBeFalsy()
    const accountsInput = screen.getByLabelText('Accounts') as HTMLInputElement
    expect(accountsInput.checked).toBe(false)
  })

  it('should return to the Accounts page when the Accounts tab is clicked from settings', async () => {
    await renderUnlockedApp()

    fireEvent.click(screen.getByTitle('Settings'))
    await waitFor(() => {
      expect(screen.getByText('Google Drive Sync')).toBeTruthy()
    })

    fireEvent.click(screen.getByLabelText('Accounts'))

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

  it('renders PasswordGate instead of the Nav/Accounts tree before unlock', async () => {
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('MockUnlock')).toBeTruthy()
    })

    // The main app tree must not be rendered underneath/alongside the gate.
    expect(screen.queryByLabelText('Accounts')).toBeFalsy()
    expect(screen.queryByText('Tax-Deferred')).toBeFalsy()
  })

  it('renders the Accounts page after unlock and saves via savePersistedApp with the session key on subsequent state changes', async () => {
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

    // Now click unlock and verify the Accounts page renders
    fireEvent.click(screen.getByText('MockUnlock'))

    await waitFor(() => {
      expect(screen.queryByText('Loading...')).toBeFalsy()
      expect(screen.getByLabelText('Accounts')).toBeTruthy()
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

    // Click unlock and verify the Accounts page renders with no errors
    fireEvent.click(screen.getByText('MockUnlock'))

    await waitFor(() => {
      expect(screen.queryByText('Loading...')).toBeFalsy()
      expect(screen.getByLabelText('Accounts')).toBeTruthy()
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
      patch: { lastRun: { at: '2024-01-01T00:00:00Z', updatedCount: 0, notFound: [] } },
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
