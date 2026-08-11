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
const { mockSessionKey, mockSessionSalt } = vi.hoisted(() => ({
  mockSessionKey: {} as CryptoKey,
  mockSessionSalt: new Uint8Array([1, 2, 3]),
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
  connectDrive: vi.fn(),
  disconnectDrive: vi.fn(),
  syncBackup: vi.fn(),
}))

vi.mock('./lib/persist', () => ({
  peekEnvelopeShape: vi.fn(),
  savePersistedApp: vi.fn().mockResolvedValue(undefined),
}))

// PasswordGate is a full-replacement screen with its own real-crypto/form flow that's
// exercised in PasswordGate.test.tsx; here we stub it so App.tsx's own gating logic
// (show gate vs dashboard, wire onUnlock into hydration state) can be tested in isolation.
vi.mock('./components/PasswordGate', () => ({
  PasswordGate: ({
    onUnlock,
  }: {
    onUnlock: (key: CryptoKey, salt: Uint8Array, loadedState?: unknown) => void
  }) => (
    <button onClick={() => onUnlock(mockSessionKey, mockSessionSalt, undefined)}>MockUnlock</button>
  ),
}))

afterEach(cleanup)

/**
 * Renders <App/>, waits for the (mocked) password gate to appear, and clicks through
 * it — mirroring what a real unlock via PasswordGate's onUnlock would do — leaving the
 * dashboard rendered.
 */
async function renderUnlockedApp() {
  const utils = render(<App />)

  await waitFor(() => {
    expect(screen.getByText('MockUnlock')).toBeTruthy()
  })
  fireEvent.click(screen.getByText('MockUnlock'))

  await waitFor(() => {
    expect(screen.queryByText('Loading dashboard...')).toBeFalsy()
    // Wait for a guaranteed-present text after the rework (Allocation chart title from AllocationChart component)
    expect(screen.getByText('Allocation')).toBeTruthy()
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

describe('view switching (dashboard vs settings)', () => {
  beforeEach(() => {
    vi.mocked(peekEnvelopeShape).mockResolvedValue('absent')
    vi.mocked(savePersistedApp).mockClear()
  })

  it('should render dashboard view by default with OverviewCard and AllocationChart', async () => {
    await renderUnlockedApp()

    // OverviewCard with its 3 clusters should be visible
    expect(screen.getByText('All Together')).toBeTruthy()

    // Performance chart should NOT render (removed in T5)
    expect(screen.queryByText('Performance')).toBeFalsy()

    // Allocation chart should still render
    expect(screen.getByText('Allocation')).toBeTruthy()
  })

  it('should switch to settings page when gear button is clicked', async () => {
    await renderUnlockedApp()

    // Dashboard should initially be visible
    expect(screen.getByText('Allocation')).toBeTruthy()

    // Click the settings gear button
    const gearButton = screen.getByTitle('Settings')
    fireEvent.click(gearButton)

    // Settings page elements should now be visible
    await waitFor(() => {
      expect(screen.getByText('Google Drive Sync')).toBeTruthy()
    })

    // Dashboard elements should not be visible
    expect(screen.queryByText('Allocation')).toBeFalsy()
    expect(screen.queryByText('All Together')).toBeFalsy()
  })

  it('should return to dashboard when Back button is clicked from settings', async () => {
    await renderUnlockedApp()

    // Click the settings gear button
    const gearButton = screen.getByTitle('Settings')
    fireEvent.click(gearButton)

    // Wait for settings page to appear
    await waitFor(() => {
      expect(screen.getByText('Google Drive Sync')).toBeTruthy()
    })

    // Click the Back button
    const backButton = screen.getByText('Back to Dashboard')
    fireEvent.click(backButton)

    // Dashboard should be visible again
    await waitFor(() => {
      expect(screen.getByText('Allocation')).toBeTruthy()
      expect(screen.getByText('All Together')).toBeTruthy()
    })

    // Settings page should not be visible
    expect(screen.queryByText('Google Drive Sync')).toBeFalsy()
  })

  it('should render both Retirement and Non-Retirement segment rows', async () => {
    await renderUnlockedApp()

    // Both segment row labels should be visible (from SegmentSummaryCards kicker labels)
    // There will be multiple "Retirement" texts (segment row + filter tags), so use getAllByText
    const retirementTexts = screen.getAllByText('Retirement')
    expect(retirementTexts.length).toBeGreaterThanOrEqual(1)

    // Non-Retirement should appear at least once (also will have multiple: segment row + filter tags)
    const nonRetirementTexts = screen.getAllByText('Non-Retirement')
    expect(nonRetirementTexts.length).toBeGreaterThanOrEqual(1)
  })

  it('should render retirement filter .seg-opt labels', async () => {
    await renderUnlockedApp()

    // Dashboard should be visible
    expect(screen.getByText('Allocation')).toBeTruthy()

    // Find retirement filter .seg-opt labels by looking for inputs with name="retirementFilter"
    const retirementFilterLabels = Array.from(document.querySelectorAll('label.seg-opt')).filter(
      (label) => label.querySelector('input[name="retirementFilter"]') !== null
    )
    expect(retirementFilterLabels.length).toBe(3) // All, Retirement, Non-Retirement

    // Verify each filter option is present
    const allLabel = retirementFilterLabels.find((l) => l.textContent?.includes('All'))
    const retirementLabel = retirementFilterLabels.find((l) => l.textContent?.includes('Retirement') && !l.textContent?.includes('Non'))
    const nonRetirementLabel = retirementFilterLabels.find((l) => l.textContent?.includes('Non-Retirement'))

    expect(allLabel).toBeTruthy()
    expect(retirementLabel).toBeTruthy()
    expect(nonRetirementLabel).toBeTruthy()
  })


  it('should dispatch SET_RETIREMENT_FILTER when a retirement filter .seg-opt is clicked', async () => {
    await renderUnlockedApp()

    // Find the retirement filter .seg control by looking for radios with name="retirementFilter"
    const retirementFilterLabels = Array.from(document.querySelectorAll('label.seg-opt')).filter(
      (label) => label.querySelector('input[name="retirementFilter"]') !== null
    )
    expect(retirementFilterLabels.length).toBe(3) // All, Retirement, Non-Retirement

    // Initially "All" should be checked
    const allLabel = retirementFilterLabels.find((l) => l.textContent?.includes('All'))
    const allInput = allLabel?.querySelector('input') as HTMLInputElement
    expect(allInput.checked).toBe(true)

    // Click the Retirement option
    const retirementLabel = retirementFilterLabels.find((l) => l.textContent?.includes('Retirement'))
    expect(retirementLabel).toBeTruthy()
    fireEvent.click(retirementLabel!)

    // After clicking, Retirement should be checked and All should be unchecked
    const retirementInput = retirementLabel?.querySelector('input') as HTMLInputElement
    await waitFor(() => {
      expect(retirementInput.checked).toBe(true)
      expect(allInput.checked).toBe(false)
    })
  })
})

describe('password gate', () => {
  beforeEach(() => {
    vi.mocked(peekEnvelopeShape).mockResolvedValue('absent')
    vi.mocked(savePersistedApp).mockClear()
  })

  it('renders PasswordGate instead of the Nav/dashboard tree before unlock', async () => {
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('MockUnlock')).toBeTruthy()
    })

    // The dashboard tree must not be rendered underneath/alongside the gate.
    expect(screen.queryByText('Allocation')).toBeFalsy()
    expect(screen.queryByText('All Together')).toBeFalsy()
  })

  it('renders the dashboard after unlock and saves via savePersistedApp with the session key on subsequent state changes', async () => {
    await renderUnlockedApp()

    vi.mocked(savePersistedApp).mockClear()

    // Trigger a state-changing action (mirrors the debounce-save pattern used elsewhere
    // in this file: dispatch a change, then wait for the 500ms-debounced save to fire).
    fireEvent.click(screen.getByText('Show Closed Positions'))

    await waitFor(() => {
      expect(savePersistedApp).toHaveBeenCalled()
    })

    const [savedState, savedKey, savedSalt] = vi.mocked(savePersistedApp).mock.calls[0]
    expect(savedState.showClosed).toBe(true)
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

    // Change state (TOGGLE_SHOW_CLOSED) — schedules a debounced save
    fireEvent.click(screen.getByText('Show Closed Positions'))

    // Unmount immediately, simulating a refresh/reload within the debounce window
    unmount()

    // The pending save must be flushed on unmount, not cancelled
    await waitFor(() => {
      expect(savePersistedApp).toHaveBeenCalled()
    })
    const lastCall = vi.mocked(savePersistedApp).mock.calls.at(-1)!
    expect(lastCall[0].showClosed).toBe(true)
    expect(lastCall[1]).toBe(mockSessionKey)
    expect(lastCall[2]).toBe(mockSessionSalt)
  })
})

describe('Drive-sync activation', () => {
  beforeEach(() => {
    vi.mocked(peekEnvelopeShape).mockResolvedValue('absent')
  })

  it('calls drive.activate() on mount and disposes it on unmount, so the cached Drive token is silently warmed up instead of going stale between settings-opens/syncs', async () => {
    const activateMock = vi.mocked(drive.activate)
    const disposeSpy = vi.fn()
    activateMock.mockReturnValue(disposeSpy)
    activateMock.mockClear()

    const { unmount } = render(<App />)

    await waitFor(() => {
      expect(screen.queryByText('Loading dashboard...')).toBeFalsy()
    })

    expect(activateMock).toHaveBeenCalledTimes(1)
    expect(disposeSpy).not.toHaveBeenCalled()

    unmount()

    expect(disposeSpy).toHaveBeenCalledTimes(1)
  })
})
