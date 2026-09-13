import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, fireEvent, waitFor, cleanup, within, configure } from '@testing-library/react'
import { SettingsPage, type SettingsPageProps } from './Settings'
import { initialState } from '../lib/state'
import * as driveModule from '../lib/drive'
import * as persistModule from '../lib/persist'
import * as importExportModule from '../lib/importExport'
import { deriveKey, generateSalt } from '../lib/crypto'

// The "Change Encryption Password" flow below runs the REAL PBKDF2 deriveKey
// (600,000 SHA-256 iterations, see crypto.ts) up to twice per test (verify
// current password + derive the new key) rather than mocking it, since a
// fake key wouldn't round-trip through real SubtleCrypto encrypt/decrypt.
// That's genuinely CPU-heavy, and under full-suite concurrency (many test
// files' worker processes contending for the same CPU cores) it can take
// longer than testing-library's default 1000ms waitFor timeout even though
// it completes in well under 1s in isolation. Bump the timeout for this file
// so real-crypto-driven assertions aren't flaky under contention; this does
// not paper over a correctness bug, since the assertions themselves are
// otherwise unchanged.
configure({ asyncUtilTimeout: 5000 })

// Partial mock: keep exportBackup/buildExportableState real (they run
// against the real crypto module), but stub downloadEnvelopeAsFile since it
// touches browser download APIs (Blob/URL/anchor click) not needed here.
vi.mock('../lib/importExport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/importExport')>()
  return { ...actual, downloadEnvelopeAsFile: vi.fn() }
})

// Mock functions for drive.project('app').pickFile(), referenced by the
// hoisted vi.mock('../lib/drive', ...) factory below.
const mockPickFile = vi.fn()
const mockEnsureFolderPath = vi.fn()

// Mock the drive module. Settings.tsx uses `driveAuth`, `getConnectionSnapshot`
// and `syncBackup` (in handleChangePassword).
vi.mock('../lib/drive', () => {
  class DriveDecryptError extends Error {
    salt: Uint8Array
    envelope: unknown
    constructor(message: string, salt: Uint8Array, envelope: unknown) {
      super(message)
      this.name = 'DriveDecryptError'
      this.salt = salt
      this.envelope = envelope
    }
  }
  return {
    drive: {
      project: () => ({
        pickFile: mockPickFile,
        ensureFolderPath: mockEnsureFolderPath,
      }),
    },
    restoreBackupFromFileId: vi.fn(),
    decryptBackupEnvelope: vi.fn(async (envelope: any, key: any) => {
      const crypto = await import('../lib/crypto')
      return crypto.decryptState(envelope, key)
    }),
    driveAuth: {
      connect: vi.fn(),
      disconnect: vi.fn(),
      ensureFresh: vi.fn(),
      activate: vi.fn(() => () => {}),
    },
    getConnectionSnapshot: vi.fn(() => null),
    syncBackup: vi.fn(),
    DriveDecryptError,
  }
})

// Shim @open-webapp/drive-connect. GoogleDriveWidget is rendered here purely to
// prove its onConnected/onDisconnected callbacks are wired to the
// onDriveConnected/onDriveDisconnected props — the real connect/disconnect
// behavior lives in the package and is tested there (Phase 1).
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
        connect
      </button>
      <button data-testid="widget-disconnect" onClick={() => onDisconnected?.()}>
        disconnect
      </button>
    </div>
  ),
  useDriveConnection: vi.fn(() => ({
    connected: false,
    email: null,
    connecting: false,
    error: null,
    needsReauth: false,
  })),
  createDriveAuth: vi.fn(),
}))

// Mock the persist module (used by the Change Password flow to verify the
// current password and to save the re-encrypted blob under the new key, and
// by the Reset App flow to wipe the local encrypted store)
vi.mock('../lib/persist', () => ({
  loadPersistedApp: vi.fn(),
  savePersistedApp: vi.fn(),
  clearPersistedApp: vi.fn(),
}))

// Mock window.alert and window.confirm
global.alert = vi.fn()
global.confirm = vi.fn()

const mockDispatch = vi.fn()
const mockOnKeyChange = vi.fn()
const mockOnPasswordEntryTimeReset = vi.fn()
const mockOnDriveConnected = vi.fn()
const mockOnDriveDisconnected = vi.fn()
const mockSetSettingsSection = vi.fn()
const mockRunPriceSyncTrigger = vi.fn()
const mockRunMutualFundSyncTrigger = vi.fn()
const mockOnReset = vi.fn()

// The Alphavantage sub-block is a plain <div>, not a labeled landmark, so it
// has to be located structurally: it's the second `input[type="password"]`
// on the page (Polygon's is the first), walked up from .field -> the
// sub-block wrapper div.
function getMfBlock(container: HTMLElement): HTMLElement {
  const passwordInputs = container.querySelectorAll('input[type="password"]')
  const mfInput = passwordInputs[1] as HTMLElement
  const fieldDiv = mfInput.closest('.field') as HTMLElement
  return fieldDiv.parentElement as HTMLElement
}

// getConnectionSnapshot() is SYNCHRONOUS and returns a Connection | null.
const connectedSnapshot = {
  email: 'test@example.com',
  needsReauth: false,
  expiresAt: Date.now() + 60 * 60 * 1000,
}

describe('SettingsPage', () => {
  let sessionSalt: Uint8Array
  let sessionKey: CryptoKey

  beforeEach(async () => {
    vi.clearAllMocks()
    sessionSalt = generateSalt()
    sessionKey = await deriveKey('test-password', sessionSalt)

    // Default mocks
    mockPickFile.mockResolvedValue(null)
    mockEnsureFolderPath.mockResolvedValue('folder-portfolio')
    mockRunPriceSyncTrigger.mockResolvedValue(undefined)
    mockRunMutualFundSyncTrigger.mockResolvedValue(undefined)
  })

  afterEach(() => {
    cleanup()
  })

  const testPortfolio = { id: 'p1', name: 'Test Portfolio', dbName: 'portfolio_p1', createdAt: 0 }

  function renderSettings(overrides: Partial<SettingsPageProps> = {}) {
    const defaultProps: SettingsPageProps = {
      state: initialState(),
      activePortfolio: testPortfolio,
      dispatch: mockDispatch,
      sessionKey,
      sessionSalt,
      onKeyChange: mockOnKeyChange,
      onPasswordEntryTimeReset: mockOnPasswordEntryTimeReset,
      onDriveConnected: mockOnDriveConnected,
      onDriveDisconnected: mockOnDriveDisconnected,
      settingsSection: 'backup',
      setSettingsSection: mockSetSettingsSection,
      runPriceSyncTrigger: mockRunPriceSyncTrigger,
      runMutualFundSyncTrigger: mockRunMutualFundSyncTrigger,
      tickerOverviewErrors: {},
      mutualFundSyncErrors: {},
      onReset: mockOnReset,
    }
    return render(<SettingsPage {...defaultProps} {...overrides} />)
  }

  describe('Google Drive Sync widget wiring', () => {
    it("firing the widget's onConnected invokes the onDriveConnected prop", () => {
      renderSettings({ settingsSection: 'backup' })

      fireEvent.click(screen.getByTestId('widget-connect'))

      expect(mockOnDriveConnected).toHaveBeenCalledTimes(1)
    })

    it("firing the widget's onDisconnected invokes the onDriveDisconnected prop", () => {
      renderSettings({ settingsSection: 'backup' })

      fireEvent.click(screen.getByTestId('widget-disconnect'))

      expect(mockOnDriveDisconnected).toHaveBeenCalledTimes(1)
    })
  })

  describe('Section rendering', () => {
    it('settingsSection="backup" shows both the Drive card and the Download card', () => {
      renderSettings({ settingsSection: 'backup' })

      expect(screen.getByText('Google Drive Sync')).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Download Backup' })).toBeTruthy()
      expect(screen.queryByText('Change Encryption Password')).toBeFalsy()
    })

    it('settingsSection="encryption" shows the Encryption card only', () => {
      renderSettings({ settingsSection: 'encryption' })

      expect(screen.queryByText('Google Drive Sync')).toBeFalsy()
      // "Change Encryption Password" is both the card title and the submit
      // button text - just assert at least one exists.
      expect(screen.getAllByText('Change Encryption Password').length).toBeGreaterThan(0)
    })
  })

  describe('Settings tab-seg', () => {
    it('renders tab-seg with "Backup" and "Encryption" options', () => {
      renderSettings({ settingsSection: 'backup' })

      expect(screen.getByLabelText('Backup')).toBeTruthy()
      expect(screen.getByLabelText('Encryption')).toBeTruthy()
    })

    it('clicking Backup tab calls setSettingsSection with "backup"', () => {
      renderSettings({ settingsSection: 'encryption' })

      const backupInput = screen.getByLabelText('Backup') as HTMLInputElement
      fireEvent.click(backupInput)

      expect(mockSetSettingsSection).toHaveBeenCalledWith('backup')
    })

    it('clicking Encryption tab calls setSettingsSection with "encryption"', () => {
      renderSettings({ settingsSection: 'backup' })

      const encryptionInput = screen.getByLabelText('Encryption') as HTMLInputElement
      fireEvent.click(encryptionInput)

      expect(mockSetSettingsSection).toHaveBeenCalledWith('encryption')
    })

    it('renders .hr divider immediately after the tab-seg', () => {
      const { container } = renderSettings({ settingsSection: 'backup' })

      const segDiv = container.querySelector('.seg')
      expect(segDiv).toBeTruthy()
      const hrDivider = segDiv?.nextElementSibling
      expect(hrDivider?.className).toContain('hr')
    })
  })

  describe('Change Encryption Password', () => {
    function fillAndSubmitChangePassword(
      container: HTMLElement,
      fields: { current: string; next: string; confirm: string }
    ) {
      const inputs = Array.from(container.querySelectorAll('input[type="password"]')) as HTMLInputElement[]
      const [currentInput, newInput, confirmInput] = inputs.slice(-3)
      fireEvent.change(currentInput, { target: { value: fields.current } })
      fireEvent.change(newInput, { target: { value: fields.next } })
      fireEvent.change(confirmInput, { target: { value: fields.confirm } })
      fireEvent.click(screen.getByRole('button', { name: 'Change Encryption Password' }))
    }

    beforeEach(() => {
      vi.mocked(driveModule.getConnectionSnapshot).mockReturnValue(null)
    })

    it('Change Password button has btn btn-primary blueprint classes', () => {
      renderSettings({ settingsSection: 'encryption' })
      const button = screen.getByRole('button', { name: 'Change Encryption Password' })
      expect(button.className).toContain('btn btn-primary')
      expect(button.className).toContain('blueprint')
    })

    it('happy path: saves locally, calls onKeyChange, shows success, clears fields, no Drive sync when not connected', async () => {
      vi.mocked(persistModule.loadPersistedApp).mockResolvedValue(initialState())
      vi.mocked(persistModule.savePersistedApp).mockResolvedValue()
      const state = initialState()

      const { container } = renderSettings({ state, settingsSection: 'encryption' })

      fillAndSubmitChangePassword(container, {
        current: 'test-password',
        next: 'new-password-1',
        confirm: 'new-password-1',
      })

      await waitFor(() => {
        expect(persistModule.savePersistedApp).toHaveBeenCalled()
      })

      const saveArgs = vi.mocked(persistModule.savePersistedApp).mock.calls[0]
      expect(saveArgs[0]).toBe(state)
      expect(saveArgs[2]).not.toEqual(sessionSalt)

      // Drive not connected -> no re-sync, no warning
      expect(driveModule.syncBackup).not.toHaveBeenCalled()

      await waitFor(() => {
        expect(mockOnKeyChange).toHaveBeenCalled()
      })
      const keyChangeArgs = mockOnKeyChange.mock.calls[0]
      expect(keyChangeArgs[1]).toEqual(saveArgs[2])

      await waitFor(() => {
        expect(screen.getByText('Encryption password changed')).toBeTruthy()
      })
      expect(screen.queryByText(/Drive re-sync failed/)).toBeFalsy()

      const inputs = Array.from(container.querySelectorAll('input[type="password"]')) as HTMLInputElement[]
      const [currentInput, newInput, confirmInput] = inputs.slice(-3)
      expect(currentInput.value).toBe('')
      expect(newInput.value).toBe('')
      expect(confirmInput.value).toBe('')
    })

    it('calls onPasswordEntryTimeReset exactly once, right after onKeyChange, on the happy path', async () => {
      vi.mocked(persistModule.loadPersistedApp).mockResolvedValue(initialState())
      vi.mocked(persistModule.savePersistedApp).mockResolvedValue()
      const state = initialState()

      const { container } = renderSettings({ state, settingsSection: 'encryption' })

      fillAndSubmitChangePassword(container, {
        current: 'test-password',
        next: 'new-password-1',
        confirm: 'new-password-1',
      })

      await waitFor(() => {
        expect(mockOnKeyChange).toHaveBeenCalled()
      })

      await waitFor(() => {
        expect(mockOnPasswordEntryTimeReset).toHaveBeenCalledTimes(1)
      })

      const keyChangeOrder = mockOnKeyChange.mock.invocationCallOrder[0]
      const resetOrder = mockOnPasswordEntryTimeReset.mock.invocationCallOrder[0]
      expect(resetOrder).toBeGreaterThan(keyChangeOrder)
    })

    it('shows "Current password is incorrect" and does not save when current password verification fails', async () => {
      vi.mocked(persistModule.loadPersistedApp).mockRejectedValue(new Error('decrypt failed'))

      const { container } = renderSettings({ settingsSection: 'encryption' })

      fillAndSubmitChangePassword(container, {
        current: 'wrong-password',
        next: 'new-password-1',
        confirm: 'new-password-1',
      })

      await waitFor(() => {
        expect(screen.getByText('Current encryption password is incorrect')).toBeTruthy()
      })

      expect(persistModule.savePersistedApp).not.toHaveBeenCalled()
      expect(mockOnKeyChange).not.toHaveBeenCalled()
      expect(mockOnPasswordEntryTimeReset).not.toHaveBeenCalled()
    })

    it('shows "Password must be at least 6 characters" and does not save when the new password is too short', async () => {
      vi.mocked(persistModule.loadPersistedApp).mockResolvedValue(initialState())

      const { container } = renderSettings({ settingsSection: 'encryption' })

      fillAndSubmitChangePassword(container, {
        current: 'test-password',
        next: 'abc',
        confirm: 'abc',
      })

      await waitFor(() => {
        expect(screen.getByText('Encryption password must be at least 6 characters')).toBeTruthy()
      })

      expect(persistModule.savePersistedApp).not.toHaveBeenCalled()
      expect(mockOnKeyChange).not.toHaveBeenCalled()
    })

    it('shows "Passwords do not match" and does not save when new/confirm differ', async () => {
      vi.mocked(persistModule.loadPersistedApp).mockResolvedValue(initialState())

      const { container } = renderSettings({ settingsSection: 'encryption' })

      fillAndSubmitChangePassword(container, {
        current: 'test-password',
        next: 'new-password-1',
        confirm: 'different-password',
      })

      await waitFor(() => {
        expect(screen.getByText('Encryption passwords do not match')).toBeTruthy()
      })

      expect(persistModule.savePersistedApp).not.toHaveBeenCalled()
      expect(mockOnKeyChange).not.toHaveBeenCalled()
    })

    it('also syncs to Drive with the new key/salt when getConnectionSnapshot() is connected', async () => {
      vi.mocked(persistModule.loadPersistedApp).mockResolvedValue(initialState())
      vi.mocked(persistModule.savePersistedApp).mockResolvedValue()
      vi.mocked(driveModule.getConnectionSnapshot).mockReturnValue(connectedSnapshot)
      vi.mocked(driveModule.syncBackup).mockResolvedValue('file-id')
      const state = initialState()

      const { container } = renderSettings({ state, settingsSection: 'encryption' })

      fillAndSubmitChangePassword(container, {
        current: 'test-password',
        next: 'new-password-1',
        confirm: 'new-password-1',
      })

      await waitFor(() => {
        expect(driveModule.syncBackup).toHaveBeenCalled()
      })

      const saveArgs = vi.mocked(persistModule.savePersistedApp).mock.calls[0]
      const syncArgs = vi.mocked(driveModule.syncBackup).mock.calls[0]
      expect(syncArgs[0]).toBe(testPortfolio)
      expect(syncArgs[1]).toBe(state)
      expect(syncArgs[2]).toBe(saveArgs[1])
      expect(syncArgs[3]).toEqual(saveArgs[2])

      await waitFor(() => {
        expect(screen.getByText('Encryption password changed')).toBeTruthy()
      })
      expect(screen.queryByText(/Drive re-sync failed/)).toBeFalsy()
    })

    it('keeps the local password change and shows the exact warning copy when Drive re-sync fails', async () => {
      vi.mocked(persistModule.loadPersistedApp).mockResolvedValue(initialState())
      vi.mocked(persistModule.savePersistedApp).mockResolvedValue()
      vi.mocked(driveModule.getConnectionSnapshot).mockReturnValue(connectedSnapshot)
      vi.mocked(driveModule.syncBackup).mockRejectedValue(new Error('network down'))

      const { container } = renderSettings({ settingsSection: 'encryption' })

      fillAndSubmitChangePassword(container, {
        current: 'test-password',
        next: 'new-password-1',
        confirm: 'new-password-1',
      })

      await waitFor(() => {
        expect(persistModule.savePersistedApp).toHaveBeenCalled()
      })
      await waitFor(() => {
        expect(mockOnKeyChange).toHaveBeenCalled()
      })

      const warningEl = await screen.findByText(
        /Encryption password changed locally, but Drive re-sync failed: network down/
      )
      expect(warningEl.textContent?.endsWith('Sync manually from Google Drive Sync above.')).toBe(true)
    })

    it('password change still succeeds locally and shows the warning when Drive re-sync rejects with a NeedsReauthError, with no reauth side effect attempted', async () => {
      vi.mocked(persistModule.loadPersistedApp).mockResolvedValue(initialState())
      vi.mocked(persistModule.savePersistedApp).mockResolvedValue()
      vi.mocked(driveModule.getConnectionSnapshot).mockReturnValue(connectedSnapshot)
      const reauthError = new Error('token expired')
      reauthError.name = 'NeedsReauthError'
      vi.mocked(driveModule.syncBackup).mockRejectedValue(reauthError)

      const { container } = renderSettings({ settingsSection: 'encryption' })

      fillAndSubmitChangePassword(container, {
        current: 'test-password',
        next: 'new-password-1',
        confirm: 'new-password-1',
      })

      // Local change still succeeds and the warning is still shown
      await waitFor(() => {
        expect(mockOnKeyChange).toHaveBeenCalled()
      })
      await waitFor(() => {
        expect(
          screen.getByText(/Encryption password changed locally, but Drive re-sync failed: token expired/)
        ).toBeTruthy()
      })

      // `refresh` no longer exists anywhere on the driveAuth mock - nothing
      // resembling a reauth side effect is attempted.
      expect((driveModule.driveAuth as Record<string, unknown>).refresh).toBeUndefined()
    })
  })

  describe('Price Sync', () => {
    it('clicking the Price Sync tab shows the API key input and Fetch prices now button, and hides Drive/Encryption sections', () => {
      renderSettings({ settingsSection: 'backup' })

      const priceSyncInput = screen.getByLabelText('Quotes API Key') as HTMLInputElement
      fireEvent.click(priceSyncInput)

      expect(mockSetSettingsSection).toHaveBeenCalledWith('priceSync')
    })

    it('settingsSection="priceSync" shows the Price Sync card only', () => {
      const { container } = renderSettings({ settingsSection: 'priceSync' })

      expect(screen.getAllByText('Quotes API Key').length).toBeGreaterThan(0)
      expect(screen.getByText('Polygon.io API Key')).toBeTruthy()
      expect(container.querySelector('input[type="password"]')).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Fetch prices now' })).toBeTruthy()
      expect(screen.queryByText('Google Drive Sync')).toBeFalsy()
      expect(screen.queryByText('Change Encryption Password')).toBeFalsy()
    })

    it('typing into the API key input then blurring dispatches SET_PRICE_SYNC_API_KEY with the typed value', () => {
      const { container } = renderSettings({ settingsSection: 'priceSync' })

      const apiKeyInput = container.querySelector('input[type="password"]') as HTMLInputElement
      fireEvent.change(apiKeyInput, { target: { value: 'my-api-key' } })
      fireEvent.blur(apiKeyInput)

      expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_PRICE_SYNC_API_KEY', apiKey: 'my-api-key' })
    })

    it('Fetch prices now button is disabled when state.priceSync.apiKey is empty', () => {
      const state = initialState()
      state.priceSync.apiKey = ''
      renderSettings({ state, settingsSection: 'priceSync' })

      const button = screen.getByRole('button', { name: 'Fetch prices now' }) as HTMLButtonElement
      expect(button.disabled).toBe(true)
    })

    it('clicking Fetch prices now (with apiKey set) calls the runPriceSyncTrigger prop', async () => {
      const state = initialState()
      state.priceSync.apiKey = 'my-api-key'
      renderSettings({ state, settingsSection: 'priceSync' })

      const button = screen.getByRole('button', { name: 'Fetch prices now' }) as HTMLButtonElement
      expect(button.disabled).toBe(false)
      fireEvent.click(button)

      await waitFor(() => {
        expect(mockRunPriceSyncTrigger).toHaveBeenCalledTimes(1)
      })
      expect(mockRunPriceSyncTrigger).toHaveBeenCalledWith(undefined)
    })

    it('setting a date then clicking Fetch prices now calls runPriceSyncTrigger with that date', async () => {
      const state = initialState()
      state.priceSync.apiKey = 'my-api-key'
      renderSettings({ state, settingsSection: 'priceSync' })

      const dateInput = screen.getByLabelText('Date to fetch') as HTMLInputElement
      fireEvent.change(dateInput, { target: { value: '2026-08-10' } })
      fireEvent.click(screen.getByRole('button', { name: 'Fetch prices now' }))

      await waitFor(() => {
        expect(mockRunPriceSyncTrigger).toHaveBeenCalledWith('2026-08-10')
      })
    })

    it('renders lastRun status text (date, updated count, not-found list) when populated', () => {
      const state = initialState()
      state.priceSync.apiKey = 'my-api-key'
      state.priceSync.lastRun = {
        at: '2026-08-22T12:00:00.000Z',
        updatedCount: 3,
        notFound: ['FOO', 'BAR'],
        marketTickerCount: 5,
      }
      renderSettings({ state, settingsSection: 'priceSync' })

      expect(screen.getByText(/5 tickers fetched from Polygon/)).toBeTruthy()
      expect(screen.getByText(/3 updated/)).toBeTruthy()
      expect(screen.getByText(/not found: FOO, BAR/)).toBeTruthy()
    })

    it('renders lastRun.error instead of updated count/not-found list when present', () => {
      const state = initialState()
      state.priceSync.apiKey = 'my-api-key'
      state.priceSync.lastRun = {
        at: '2026-08-22T12:00:00.000Z',
        updatedCount: 0,
        notFound: [],
        error: 'Polygon API error: 403',
      }
      renderSettings({ state, settingsSection: 'priceSync' })

      expect(screen.getByText('Polygon API error: 403')).toBeTruthy()
      expect(screen.queryByText(/updated/)).toBeNull()
      expect(screen.queryByText(/not found/)).toBeNull()
    })

    it('renders "Never run" when lastRun is null', () => {
      const state = initialState()
      state.priceSync.lastRun = null
      const { container } = renderSettings({ state, settingsSection: 'priceSync' })

      const mfBlock = getMfBlock(container)
      const neverRunTexts = screen.getAllByText('Never run')
      expect(neverRunTexts.some((el) => !mfBlock.contains(el))).toBe(true)
    })
  })

  describe('Mutual Fund Sync', () => {
    it('renders the Alphavantage API key input; typing then blurring dispatches SET_MUTUAL_FUND_SYNC_API_KEY', () => {
      const { container } = renderSettings({ settingsSection: 'priceSync' })

      expect(screen.getByText('Alphavantage API Key (Mutual Funds)')).toBeTruthy()
      const passwordInputs = container.querySelectorAll('input[type="password"]')
      expect(passwordInputs.length).toBe(2)
      const mfKeyInput = passwordInputs[1] as HTMLInputElement

      fireEvent.change(mfKeyInput, { target: { value: 'av-api-key' } })
      fireEvent.blur(mfKeyInput)

      expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_MUTUAL_FUND_SYNC_API_KEY', apiKey: 'av-api-key' })
    })

    it('Fetch mutual fund prices now button is disabled when state.mutualFundSync.apiKey is empty', () => {
      const state = initialState()
      state.mutualFundSync.apiKey = ''
      renderSettings({ state, settingsSection: 'priceSync' })

      const button = screen.getByRole('button', { name: 'Fetch mutual fund prices now' }) as HTMLButtonElement
      expect(button.disabled).toBe(true)
    })

    it('clicking Fetch mutual fund prices now (with apiKey set) calls the runMutualFundSyncTrigger prop', async () => {
      const state = initialState()
      state.mutualFundSync.apiKey = 'av-api-key'
      renderSettings({ state, settingsSection: 'priceSync' })

      const button = screen.getByRole('button', { name: 'Fetch mutual fund prices now' }) as HTMLButtonElement
      expect(button.disabled).toBe(false)
      fireEvent.click(button)

      await waitFor(() => {
        expect(mockRunMutualFundSyncTrigger).toHaveBeenCalledTimes(1)
      })
    })

    it('shows "Never run" scoped to the Alphavantage sub-block when mutualFundSync.lastRun is null', () => {
      const state = initialState()
      state.mutualFundSync.lastRun = null
      const { container } = renderSettings({ state, settingsSection: 'priceSync' })

      const mfBlock = getMfBlock(container)
      expect(within(mfBlock).getByText('Never run')).toBeTruthy()
    })

    it('renders lastRun updatedCount/notFound in the sub-block, with no "tickers fetched from Polygon" phrase', () => {
      const state = initialState()
      state.mutualFundSync.apiKey = 'av-api-key'
      state.mutualFundSync.lastRun = {
        at: '2026-08-22T12:00:00.000Z',
        updatedCount: 2,
        notFound: ['VTSAX'],
      }
      const { container } = renderSettings({ state, settingsSection: 'priceSync' })

      const mfBlock = getMfBlock(container)
      expect(within(mfBlock).getByText(/2 updated/)).toBeTruthy()
      expect(within(mfBlock).getByText(/not found: VTSAX/)).toBeTruthy()
      expect(within(mfBlock).queryByText(/tickers fetched from Polygon/)).toBeNull()
    })

    it('renders lastRun.error in red within the sub-block', () => {
      const state = initialState()
      state.mutualFundSync.apiKey = 'av-api-key'
      state.mutualFundSync.lastRun = {
        at: '2026-08-22T12:00:00.000Z',
        updatedCount: 0,
        notFound: [],
        error: 'Alphavantage API error: rate limited',
      }
      const { container } = renderSettings({ state, settingsSection: 'priceSync' })

      const mfBlock = getMfBlock(container)
      const errorEl = within(mfBlock).getByText('Alphavantage API error: rate limited')
      expect(errorEl.style.color).toBe('rgb(138, 60, 46)')
    })

    it('renders exactly one input[type="date"] on the page (the Polygon date picker only)', () => {
      const { container } = renderSettings({ settingsSection: 'priceSync' })

      const dateInputs = container.querySelectorAll('input[type="date"]')
      expect(dateInputs.length).toBe(1)

      const mfBlock = getMfBlock(container)
      expect(mfBlock.querySelectorAll('input[type="date"]').length).toBe(0)
    })

    it('mutualFundSyncErrors renders in the Alphavantage error list, independent of tickerOverviewErrors', () => {
      const { container, unmount } = renderSettings({
        settingsSection: 'priceSync',
        mutualFundSyncErrors: { VTSAX: 'rate limited' },
        tickerOverviewErrors: {},
      })
      const mfBlock = getMfBlock(container)
      expect(within(mfBlock).getByText('VTSAX: rate limited')).toBeTruthy()
      unmount()

      // Same symbol/message, but as a tickerOverviewErrors entry instead -
      // must NOT show up in the mutual fund sub-block's error list.
      const { container: container2 } = renderSettings({
        settingsSection: 'priceSync',
        mutualFundSyncErrors: {},
        tickerOverviewErrors: { VTSAX: 'rate limited' },
      })
      const mfBlock2 = getMfBlock(container2)
      expect(within(mfBlock2).queryByText('VTSAX: rate limited')).toBeNull()
    })

    it('tickerOverviewErrors renders in the Polygon error list, independent of mutualFundSyncErrors', () => {
      const { container, unmount } = renderSettings({
        settingsSection: 'priceSync',
        tickerOverviewErrors: { AAPL: 'boom' },
        mutualFundSyncErrors: {},
      })
      const aaplEntry = screen.getByText('AAPL: boom')
      const mfBlock = getMfBlock(container)
      expect(mfBlock.contains(aaplEntry)).toBe(false)
      unmount()

      // Same symbol/message, but as a mutualFundSyncErrors entry instead -
      // must NOT show up in the Polygon error list (i.e. must not appear
      // outside the Alphavantage sub-block).
      const { container: container2 } = renderSettings({
        settingsSection: 'priceSync',
        tickerOverviewErrors: {},
        mutualFundSyncErrors: { AAPL: 'boom' },
      })
      const mfBlock2 = getMfBlock(container2)
      const aaplEntry2 = screen.getByText('AAPL: boom')
      expect(mfBlock2.contains(aaplEntry2)).toBe(true)
    })

    it('with both maps non-empty, each error list shows only its own entries', () => {
      const { container } = renderSettings({
        settingsSection: 'priceSync',
        tickerOverviewErrors: { AAPL: 'boom' },
        mutualFundSyncErrors: { VTSAX: 'rate limited' },
      })

      const mfBlock = getMfBlock(container)
      expect(within(mfBlock).getByText('VTSAX: rate limited')).toBeTruthy()
      expect(within(mfBlock).queryByText('AAPL: boom')).toBeNull()

      const aaplEntry = screen.getByText('AAPL: boom')
      expect(mfBlock.contains(aaplEntry)).toBe(false)
    })
  })

  describe('Import/Export', () => {
    it('settingsSection="backup" shows the Download card (with Download Backup button) alongside the Drive card', () => {
      renderSettings({ settingsSection: 'backup' })

      expect(screen.getAllByText('Download').length).toBeGreaterThan(0)
      expect(screen.getByRole('button', { name: 'Download Backup' })).toBeTruthy()
      expect(screen.queryByText('Change Encryption Password')).toBeFalsy()
    })

    it('clicking Download Backup exports the current state and triggers a download with a dated filename', async () => {
      const state = initialState()

      renderSettings({ state, settingsSection: 'backup' })

      const downloadButton = screen.getByRole('button', { name: 'Download Backup' })
      fireEvent.click(downloadButton)

      await waitFor(() => {
        expect(importExportModule.downloadEnvelopeAsFile).toHaveBeenCalledTimes(1)
      })

      const [envelope, filename] = vi.mocked(importExportModule.downloadEnvelopeAsFile).mock.calls[0]
      expect(envelope).toMatchObject({
        version: expect.anything(),
        salt: expect.any(String),
        iv: expect.any(String),
        ciphertext: expect.any(String),
      })
      expect(filename).toMatch(/^ledger-backup-\d{4}-\d{2}-\d{2}\.json$/)
    })

    it('no longer renders a file input on the Download section (upload UI removed)', () => {
      const { container } = renderSettings({ settingsSection: 'backup' })

      expect(container.querySelector('input[type="file"]')).toBeFalsy()
    })
  })

  describe('Danger Zone / Reset App', () => {
    it('renders the Danger Zone card below Change Encryption Password on the encryption tab', () => {
      const { container } = renderSettings({ settingsSection: 'encryption' })

      expect(screen.getByText('Danger Zone')).toBeTruthy()

      const sections = Array.from(container.querySelectorAll('section.card'))
      const encryptionSectionIndex = sections.findIndex((s) =>
        within(s as HTMLElement).queryAllByText('Change Encryption Password').length > 0
      )
      const dangerZoneIndex = sections.findIndex((s) =>
        within(s as HTMLElement).queryByText('Danger Zone')
      )
      expect(encryptionSectionIndex).toBeGreaterThanOrEqual(0)
      expect(dangerZoneIndex).toBeGreaterThan(encryptionSectionIndex)
    })

    it('reset flow: clicking Reset App, typing RESET, and confirming clears persisted app, calls onReset, and shows the toast', async () => {
      vi.mocked(persistModule.clearPersistedApp).mockResolvedValue()

      renderSettings({ settingsSection: 'encryption' })

      fireEvent.click(screen.getByText('Reset App'))

      const confirmInput = screen.getByPlaceholderText('RESET')
      fireEvent.change(confirmInput, { target: { value: 'RESET' } })

      const eraseButton = screen.getByRole('button', { name: 'Erase Everything' })
      fireEvent.click(eraseButton)

      await waitFor(() => {
        expect(persistModule.clearPersistedApp).toHaveBeenCalledTimes(1)
      })

      await waitFor(() => {
        expect(mockOnReset).toHaveBeenCalledTimes(1)
      })

      await waitFor(() => {
        expect(screen.getByText('App reset. All data wiped.')).toBeTruthy()
      })
    })
  })
})
