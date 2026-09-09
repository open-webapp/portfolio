import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { PasswordGate } from './PasswordGate'
import { initialState, replaceImportedState } from '../lib/state'
import { buildExportableState } from '../lib/importExport'
import * as cryptoModule from '../lib/crypto'
import * as persistModule from '../lib/persist'

vi.mock('../lib/crypto', () => ({
  deriveKey: vi.fn(),
  generateSalt: vi.fn(),
  decryptState: vi.fn(),
  encryptState: vi.fn(),
  // Pure structural check (no crypto involved) — hand-written to mirror the
  // real implementation in crypto.ts, since GateRestoreFromFilePanel's
  // parseImportFile (via ../lib/importExport) depends on it to recognize a
  // valid backup envelope.
  detectEnvelopeShape: (value: unknown): 'absent' | 'legacy-plaintext' | 'encrypted' => {
    if (value === undefined || value === null) return 'absent'
    if (typeof value !== 'object') return 'legacy-plaintext'
    const obj = value as Record<string, unknown>
    if (
      obj.version === 1 &&
      typeof obj.salt === 'string' &&
      typeof obj.iv === 'string' &&
      typeof obj.ciphertext === 'string'
    ) {
      return 'encrypted'
    }
    return 'legacy-plaintext'
  },
}))

vi.mock('../lib/persist', () => ({
  peekStoredSalt: vi.fn(),
  loadPersistedApp: vi.fn(),
  loadLegacyPlaintextApp: vi.fn(),
  clearPersistedApp: vi.fn(),
}))

vi.mock('@open-webapp/drive-connect', () => ({
  GoogleDriveWidget: ({ onConnected, onDisconnected }: any) => (
    <div data-testid="drive-widget">
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
    refresh: vi.fn(),
  })),
  createDriveAuth: vi.fn(),
}))

const mockPickFile = vi.fn()
const mockEnsureFolderPath = vi.fn()

vi.mock('../lib/drive', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/drive')>()

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
    ...actual,
    driveAuth: {
      getStatus: vi.fn(),
      subscribe: vi.fn(() => () => {}),
      refresh: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
      ensureFresh: vi.fn(),
      activate: vi.fn(() => () => {}),
    },
    restoreBackupFromFileId: vi.fn(),
    // Real envelopes are built with the real crypto module in these tests, so
    // the stand-in decrypts for real. The coalescing the production helper
    // layers on top is unit-tested in drive.test.ts.
    decryptBackupEnvelope: vi.fn(async (envelope: any, key: any) => {
      // Plain import, not importActual: resolves to the mocked crypto module
      // where a test mocks it, and the real one where it doesn't.
      const crypto = await import('../lib/crypto')
      return crypto.decryptState(envelope, key)
    }),
    drive: {
      project: (id: string) => ({
        pickFile: mockPickFile,
        ensureFolderPath: mockEnsureFolderPath,
      }),
    },
    DriveDecryptError,
  }
})

const fakeKey = { fake: 'key' } as unknown as CryptoKey
const fakeSalt = new Uint8Array([1, 2, 3])

// Labels in PasswordGate are plain siblings of their inputs (no htmlFor/id
// association), so getByLabelText can't be used — query by input type instead.
function getPasswordInputs(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll('input[type="password"]'))
}

// Helper to render PasswordGate with default Drive props
function renderPasswordGate(
  props: Partial<React.ComponentProps<typeof PasswordGate>> = {}
) {
  const defaults: React.ComponentProps<typeof PasswordGate> = {
    shape: 'absent',
    onUnlock: vi.fn(),
    onReset: vi.fn(),
    backupFileId: null,
    syncing: false,
    setSyncing: vi.fn(),
    ...props,
  }
  return render(<PasswordGate {...defaults} />)
}

function fillAndSubmitSetPassword(password: string, confirm: string) {
  const [passwordInput, confirmInput] = getPasswordInputs()
  fireEvent.change(passwordInput, { target: { value: password } })
  fireEvent.change(confirmInput, { target: { value: confirm } })
  fireEvent.click(screen.getByRole('button', { name: /set password/i }))
}

describe('PasswordGate', () => {
  const onUnlock = vi.fn()
  const onReset = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(cryptoModule.generateSalt).mockReturnValue(fakeSalt)
    vi.mocked(cryptoModule.deriveKey).mockResolvedValue(fakeKey)
    mockPickFile.mockResolvedValue(null)
    mockEnsureFolderPath.mockResolvedValue('folder-portfolio')
    global.alert = vi.fn()
    global.confirm = vi.fn()
  })

  afterEach(() => {
    cleanup()
  })

  describe('shape: absent — set-password screen', () => {
    it('renders two password fields and the explanatory note', () => {
      renderPasswordGate({ shape: 'absent', onUnlock, onReset })

      expect(screen.getByText('New password')).toBeTruthy()
      expect(screen.getByText('Confirm password')).toBeTruthy()
      expect(getPasswordInputs()).toHaveLength(2)
      expect(
        screen.getByText(/never saved anywhere, and you\s+will need to enter it every time/)
      ).toBeTruthy()
    })

    it('shows an inline error and does not call onUnlock when password is under 6 characters', async () => {
      renderPasswordGate({ shape: 'absent', onUnlock, onReset })

      fillAndSubmitSetPassword('abc', 'abc')

      expect(await screen.findByText('Password must be at least 6 characters')).toBeTruthy()
      expect(onUnlock).not.toHaveBeenCalled()
    })

    it('shows an inline error and does not call onUnlock when confirm password does not match', async () => {
      renderPasswordGate({ shape: 'absent', onUnlock, onReset })

      fillAndSubmitSetPassword('longenough', 'different')

      expect(await screen.findByText('Passwords do not match')).toBeTruthy()
      expect(onUnlock).not.toHaveBeenCalled()
    })

    it('calls onUnlock(key, salt, undefined) on valid submit', async () => {
      renderPasswordGate({ shape: 'absent', onUnlock, onReset })

      fillAndSubmitSetPassword('longenough', 'longenough')

      await waitFor(() => {
        expect(onUnlock).toHaveBeenCalledWith(fakeKey, fakeSalt, undefined)
      })
      expect(persistModule.loadLegacyPlaintextApp).not.toHaveBeenCalled()
    })
  })

  describe('shape: legacy-plaintext — set-password screen', () => {
    it('loads legacy state and passes it as migratedState to onUnlock', async () => {
      const migrated = initialState()
      vi.mocked(persistModule.loadLegacyPlaintextApp).mockResolvedValue(migrated)

      renderPasswordGate({ shape: 'legacy-plaintext', onUnlock, onReset })

      fillAndSubmitSetPassword('longenough', 'longenough')

      await waitFor(() => {
        expect(persistModule.loadLegacyPlaintextApp).toHaveBeenCalled()
        expect(onUnlock).toHaveBeenCalledWith(fakeKey, fakeSalt, migrated)
      })
    })
  })

  describe('shape: encrypted — enter-password screen', () => {
    it('renders a single password field, not two', () => {
      renderPasswordGate({ shape: 'encrypted', onUnlock, onReset })

      expect(getPasswordInputs()).toHaveLength(1)
      expect(screen.getByText('Password')).toBeTruthy()
      expect(screen.queryByText('New password')).toBeFalsy()
      expect(screen.queryByText('Confirm password')).toBeFalsy()
    })

    it('still renders its subtitle and a single default card wrapper (no tab-seg, no card merge)', () => {
      const { container } = renderPasswordGate({ shape: 'encrypted', onUnlock, onReset })

      expect(
        screen.getByText('Your data is encrypted on this device. Enter your password to unlock it.')
      ).toBeTruthy()
      expect(screen.getByRole('heading', { name: 'Encryption Password' })).toBeTruthy()
      // Single card wrapper around the unlock form; no restore cards.
      expect(container.querySelectorAll('.card.blueprint.elev-sm')).toHaveLength(1)
      expect(screen.queryByText('Google Drive')).toBeFalsy()
      expect(screen.queryByText('Backup file')).toBeFalsy()
    })

    it('correct password calls onUnlock(key, salt, loadedState)', async () => {
      const loaded = initialState()
      vi.mocked(persistModule.peekStoredSalt).mockResolvedValue(fakeSalt)
      vi.mocked(persistModule.loadPersistedApp).mockResolvedValue(loaded)

      renderPasswordGate({ shape: 'encrypted', onUnlock, onReset })

      fireEvent.change(getPasswordInputs()[0], { target: { value: 'correct-pw' } })
      fireEvent.click(screen.getByRole('button', { name: /unlock/i }))

      await waitFor(() => {
        expect(onUnlock).toHaveBeenCalledWith(fakeKey, fakeSalt, loaded)
      })
    })

    it('incorrect password shows inline error, does not call onUnlock, clears the field, and allows immediate resubmit', async () => {
      vi.mocked(persistModule.peekStoredSalt).mockResolvedValue(fakeSalt)
      vi.mocked(persistModule.loadPersistedApp).mockRejectedValue(new Error('bad key'))

      renderPasswordGate({ shape: 'encrypted', onUnlock, onReset })

      const passwordInput = getPasswordInputs()[0]
      fireEvent.change(passwordInput, { target: { value: 'wrong-pw' } })
      fireEvent.click(screen.getByRole('button', { name: /unlock/i }))

      expect(await screen.findByText('Incorrect password')).toBeTruthy()
      expect(onUnlock).not.toHaveBeenCalled()
      expect(passwordInput.value).toBe('')

      // The submit button must not be disabled/locked out after a failed attempt.
      const unlockButton = screen.getByRole('button', { name: /unlock/i }) as HTMLButtonElement
      expect(unlockButton.disabled).toBe(false)

      // Immediately resubmit with the correct password.
      vi.mocked(persistModule.loadPersistedApp).mockResolvedValue(initialState())
      fireEvent.change(passwordInput, { target: { value: 'correct-pw' } })
      fireEvent.click(unlockButton)

      await waitFor(() => {
        expect(onUnlock).toHaveBeenCalled()
      })
    })
  })

  describe('Reset app', () => {
    it('on the set-password screen: opens confirm dialog, requires typing RESET, then calls clearPersistedApp then onReset', async () => {
      vi.mocked(persistModule.clearPersistedApp).mockResolvedValue(undefined)

      renderPasswordGate({ shape: 'absent', onUnlock, onReset })

      fireEvent.click(screen.getByText('Reset App'))
      expect(screen.getByText('Reset app and erase all data?')).toBeTruthy()

      const eraseButton = screen.getByRole('button', { name: /erase everything/i }) as HTMLButtonElement
      expect(eraseButton.disabled).toBe(true)

      fireEvent.change(screen.getByPlaceholderText('RESET'), { target: { value: 'RESET' } })
      expect(eraseButton.disabled).toBe(false)

      fireEvent.click(eraseButton)

      await waitFor(() => {
        expect(persistModule.clearPersistedApp).toHaveBeenCalled()
        expect(onReset).toHaveBeenCalled()
      })
    })

    it('on the enter-password screen: opens confirm dialog, requires typing RESET, then calls clearPersistedApp then onReset', async () => {
      vi.mocked(persistModule.clearPersistedApp).mockResolvedValue(undefined)

      renderPasswordGate({ shape: 'encrypted', onUnlock, onReset })

      fireEvent.click(screen.getByText('Reset App'))
      fireEvent.change(screen.getByPlaceholderText('RESET'), { target: { value: 'RESET' } })
      fireEvent.click(screen.getByRole('button', { name: /erase everything/i }))

      await waitFor(() => {
        expect(persistModule.clearPersistedApp).toHaveBeenCalled()
        expect(onReset).toHaveBeenCalled()
      })
    })

    it('typing something other than RESET keeps the erase button disabled and does not reset', async () => {
      renderPasswordGate({ shape: 'absent', onUnlock, onReset })

      fireEvent.click(screen.getByText('Reset App'))
      fireEvent.change(screen.getByPlaceholderText('RESET'), { target: { value: 'reset please' } })

      const eraseButton = screen.getByRole('button', { name: /erase everything/i }) as HTMLButtonElement
      expect(eraseButton.disabled).toBe(true)
      expect(persistModule.clearPersistedApp).not.toHaveBeenCalled()
      expect(onReset).not.toHaveBeenCalled()
    })

    it('Cancel closes the confirm dialog without resetting', async () => {
      renderPasswordGate({ shape: 'absent', onUnlock, onReset })

      fireEvent.click(screen.getByText('Reset App'))
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }))

      expect(screen.queryByText('Reset app and erase all data?')).toBeFalsy()
      expect(persistModule.clearPersistedApp).not.toHaveBeenCalled()
      expect(onReset).not.toHaveBeenCalled()
    })

    it('Reset App trigger is present identically on both set-password and enter-password screens', () => {
      const { unmount } = renderPasswordGate(
        { shape: 'absent', onUnlock, onReset }
      )
      expect(screen.getByText('Reset App')).toBeTruthy()
      unmount()

      renderPasswordGate({ shape: 'encrypted', onUnlock, onReset })
      expect(screen.getByText('Reset App')).toBeTruthy()
    })
  })

  describe('shape: absent — restore tab', () => {
    it('renders tab-seg with "New Setup" and "Restore" tabs', () => {
      renderPasswordGate({ shape: 'absent', onUnlock, onReset })

      expect(screen.getByLabelText('New Setup')).toBeTruthy()
      expect(screen.getByLabelText('Restore')).toBeTruthy()
      // Exactly two tabs — the old 3-tab split is gone.
      expect(document.querySelectorAll('.seg .seg-opt input[type="radio"]')).toHaveLength(2)
      expect(screen.getAllByRole('radio')).toHaveLength(2)
    })

    it('tab-seg is absent when shape="legacy-plaintext"', () => {
      renderPasswordGate({ shape: 'legacy-plaintext', onUnlock, onReset })

      expect(screen.queryByLabelText('New Setup')).toBeFalsy()
      expect(screen.queryByLabelText('Restore')).toBeFalsy()
    })

    it('tab-seg is absent when shape="encrypted"', () => {
      renderPasswordGate({ shape: 'encrypted', onUnlock, onReset })

      expect(screen.queryByLabelText('New Setup')).toBeFalsy()
      expect(screen.queryByLabelText('Restore')).toBeFalsy()
    })

    it('clicking "Restore" tab shows h1 "Restore" and both restore cards', () => {
      renderPasswordGate({ shape: 'absent', onUnlock, onReset })

      expect(screen.getByText('Set Encryption Password')).toBeTruthy()
      expect(screen.getByText('Choose a password to encrypt your data on this device.')).toBeTruthy()

      fireEvent.click(screen.getByLabelText('Restore'))

      expect(screen.getByRole('heading', { name: 'Restore' })).toBeTruthy()
      expect(screen.getByText('Google Drive')).toBeTruthy()
      expect(screen.getByText('Backup file')).toBeTruthy()
      // When restore tab is active, the new setup title should not be visible
      expect(screen.queryByText('Set Encryption Password')).toBeFalsy()
    })

    it('clicking back to "New Setup" restores it with previously-typed password values intact', () => {
      renderPasswordGate({ shape: 'absent', onUnlock, onReset })

      const [passwordInput, confirmInput] = getPasswordInputs()
      fireEvent.change(passwordInput, { target: { value: 'mysecretpassword' } })
      fireEvent.change(confirmInput, { target: { value: 'mysecretpassword' } })

      // Switch to restore tab
      fireEvent.click(screen.getByLabelText('Restore'))
      expect(screen.getByRole('heading', { name: 'Restore' })).toBeTruthy()

      // Switch back to new setup
      fireEvent.click(screen.getByLabelText('New Setup'))
      expect(screen.getByText('Set Encryption Password')).toBeTruthy()

      // Password values should still be there
      const [restoredPasswordInput, restoredConfirmInput] = getPasswordInputs()
      expect(restoredPasswordInput.value).toBe('mysecretpassword')
      expect(restoredConfirmInput.value).toBe('mysecretpassword')
    })

    it('renders the Drive widget immediately on the Restore tab (before the dummy key resolves)', () => {
      // Hold deriveKey pending so the dummy-key effect never completes this tick.
      vi.mocked(cryptoModule.deriveKey).mockImplementation(
        () => new Promise<CryptoKey>(() => {})
      )

      renderPasswordGate({ shape: 'absent', onUnlock, onReset })

      fireEvent.click(screen.getByLabelText('Restore'))

      // Widget is present synchronously, rendered unconditionally.
      expect(screen.getByTestId('drive-widget')).toBeTruthy()
      // ...alongside the loading placeholder while the dummy key is still pending.
      expect(screen.getByText('Loading restore options...')).toBeTruthy()
    })

    it('while the dummy key is pending the widget stays interactive and no window.alert fires on connect', () => {
      const alertSpy = vi.fn()
      global.alert = alertSpy
      vi.mocked(cryptoModule.deriveKey).mockImplementation(
        () => new Promise<CryptoKey>(() => {})
      )

      renderPasswordGate({ shape: 'absent', onUnlock, onReset })

      fireEvent.click(screen.getByLabelText('Restore'))

      expect(screen.getByText('Loading restore options...')).toBeTruthy()

      const connectButton = screen.getByTestId('widget-connect')
      expect(connectButton).toBeTruthy()
      fireEvent.click(connectButton)

      expect(alertSpy).not.toHaveBeenCalled()
    })

    it('once the dummy key resolves, DriveRestorePanel content replaces the loading placeholder in the same card', async () => {
      renderPasswordGate({ shape: 'absent', onUnlock, onReset })

      fireEvent.click(screen.getByLabelText('Restore'))

      await waitFor(() => {
        expect(screen.queryByText('Loading restore options...')).toBeFalsy()
      })

      // Widget is still rendered in the Google Drive card next to the panel.
      expect(screen.getByTestId('drive-widget')).toBeTruthy()
    })

    it('with useDriveConnection reporting connected:false, no "Restore from Drive" button appears in the Restore tab', async () => {
      renderPasswordGate({ shape: 'absent', onUnlock, onReset })

      fireEvent.click(screen.getByLabelText('Restore'))

      await waitFor(() => {
        expect(screen.queryByText('Loading restore options...')).toBeFalsy()
      })

      expect(screen.queryByRole('button', { name: 'Restore from Drive' })).toBeFalsy()
      expect(screen.queryByText('Restore from Drive')).toBeFalsy()
    })

    it('wires the widget onConnected/onDisconnected callbacks to the onDriveConnected/onDriveDisconnected props', () => {
      const onDriveConnected = vi.fn()
      const onDriveDisconnected = vi.fn()

      renderPasswordGate({
        shape: 'absent',
        onUnlock,
        onReset,
        onDriveConnected,
        onDriveDisconnected,
      })

      fireEvent.click(screen.getByLabelText('Restore'))

      fireEvent.click(screen.getByTestId('widget-connect'))
      expect(onDriveConnected).toHaveBeenCalled()

      fireEvent.click(screen.getByTestId('widget-disconnect'))
      expect(onDriveDisconnected).toHaveBeenCalled()
    })

    it('Reset App link/dialog works identically from restore tab', async () => {
      vi.mocked(persistModule.clearPersistedApp).mockResolvedValue(undefined)

      renderPasswordGate({ shape: 'absent', onUnlock, onReset })

      fireEvent.click(screen.getByLabelText('Restore'))

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Restore' })).toBeTruthy()
      })

      fireEvent.click(screen.getByText('Reset App'))

      expect(screen.getByText('Reset app and erase all data?')).toBeTruthy()

      const eraseButton = screen.getByRole('button', { name: /erase everything/i }) as HTMLButtonElement
      expect(eraseButton.disabled).toBe(true)

      fireEvent.change(screen.getByPlaceholderText('RESET'), { target: { value: 'RESET' } })
      expect(eraseButton.disabled).toBe(false)

      fireEvent.click(eraseButton)

      await waitFor(() => {
        expect(persistModule.clearPersistedApp).toHaveBeenCalled()
        expect(onReset).toHaveBeenCalled()
      })
    })
  })

  describe('shape: absent — restore-from-file tab', () => {
    // A plausibly-shaped (but not actually encrypted) envelope: detectEnvelopeShape
    // (hand-stubbed above) only checks structural shape, and deriveKey/decryptState
    // are mocked per-test below, so no real crypto is involved.
    function fakeEnvelope() {
      return {
        version: 1 as const,
        salt: btoa('salt-bytes'),
        iv: btoa('iv-bytes'),
        ciphertext: btoa('ciphertext-bytes'),
      }
    }

    function getFileInput(container: HTMLElement): HTMLInputElement {
      return container.querySelector('input[type="file"]') as HTMLInputElement
    }

    it('Backup file card is visible on the Restore tab alongside the Google Drive card', () => {
      renderPasswordGate({ shape: 'absent', onUnlock, onReset })

      fireEvent.click(screen.getByLabelText('Restore'))

      // Both restore cards mount at once under the single "Restore" tab.
      expect(screen.getByText('Backup file')).toBeTruthy()
      expect(screen.getByText('Google Drive')).toBeTruthy()
      expect(screen.queryByText('Set Encryption Password')).toBeFalsy()
    })

    it('uploading a valid backup + correct password calls onUnlock(key, salt, mergedState) and never shows a confirm dialog', async () => {
      const mockOnUnlock = vi.fn()
      const confirmSpy = vi.spyOn(window, 'confirm')
      const envelope = fakeEnvelope()
      const restoredState = initialState()
      restoredState.accounts = [
        {
          id: 'restored-acc',
          accountNumber: '999',
          name: 'Restored Account',
          retirement: false,
          createdAt: '2024-01-01',
        },
      ]
      const exportable = buildExportableState(restoredState)
      const backupKey = { fakeKeyFor: 'correct-password' } as unknown as CryptoKey

      vi.mocked(cryptoModule.deriveKey).mockImplementation(async (password: string) => {
        return { fakeKeyFor: password } as unknown as CryptoKey
      })
      vi.mocked(cryptoModule.decryptState).mockImplementation(async (_envelope, key) => {
        if ((key as unknown as { fakeKeyFor: string }).fakeKeyFor === 'correct-password') {
          return exportable as any
        }
        const err = new Error('bad key')
        err.name = 'OperationError'
        throw err
      })

      const { container } = renderPasswordGate({ shape: 'absent', onUnlock: mockOnUnlock, onReset })

      fireEvent.click(screen.getByLabelText('Restore'))

      const file = new File([JSON.stringify(envelope)], 'backup.json', { type: 'application/json' })
      fireEvent.change(getFileInput(container), { target: { files: [file] } })

      const passwordInput = await screen.findByPlaceholderText('Backup password')
      fireEvent.change(passwordInput, { target: { value: 'correct-password' } })
      fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

      await waitFor(() => {
        expect(mockOnUnlock).toHaveBeenCalledTimes(1)
      })

      const [key, salt, mergedState] = mockOnUnlock.mock.calls[0]
      expect(key).toEqual(backupKey)
      expect(salt).toBeInstanceOf(Uint8Array)
      const expectedMerged = replaceImportedState(initialState(), exportable)
      expect(mergedState).toEqual(expectedMerged)
      expect(confirmSpy).not.toHaveBeenCalled()
    })

    it('wrong password shows inline error and is retryable', async () => {
      const envelope = fakeEnvelope()

      vi.mocked(cryptoModule.deriveKey).mockImplementation(async (password: string) => {
        return { fakeKeyFor: password } as unknown as CryptoKey
      })
      vi.mocked(cryptoModule.decryptState).mockImplementation(async (_envelope, key) => {
        if ((key as unknown as { fakeKeyFor: string }).fakeKeyFor === 'correct-password') {
          return initialState() as any
        }
        const err = new Error('bad key')
        err.name = 'OperationError'
        throw err
      })

      const { container } = renderPasswordGate({ shape: 'absent', onUnlock, onReset })

      fireEvent.click(screen.getByLabelText('Restore'))

      const file = new File([JSON.stringify(envelope)], 'backup.json', { type: 'application/json' })
      fireEvent.change(getFileInput(container), { target: { files: [file] } })

      const passwordInput = await screen.findByPlaceholderText('Backup password')
      fireEvent.change(passwordInput, { target: { value: 'wrong-password' } })
      fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

      expect(await screen.findByText('Incorrect password')).toBeTruthy()
      expect(onUnlock).not.toHaveBeenCalled()

      // Retry with the correct password.
      const retryInput = screen.getByPlaceholderText('Backup password') as HTMLInputElement
      fireEvent.change(retryInput, { target: { value: 'correct-password' } })
      fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

      await waitFor(() => {
        expect(onUnlock).toHaveBeenCalled()
      })
    })

    it('malformed file shows inline error and no password prompt', async () => {
      const { container } = renderPasswordGate({ shape: 'absent', onUnlock, onReset })

      fireEvent.click(screen.getByLabelText('Restore'))

      const file = new File(['not json{{'], 'backup.json', { type: 'application/json' })
      fireEvent.change(getFileInput(container), { target: { files: [file] } })

      expect(await screen.findByText("This file isn't a valid backup")).toBeTruthy()
      expect(screen.queryByPlaceholderText('Backup password')).toBeFalsy()
      expect(onUnlock).not.toHaveBeenCalled()
    })

    it('tab-switching away and back preserves in-progress uploaded file/password state', async () => {
      const envelope = fakeEnvelope()
      const { container } = renderPasswordGate({ shape: 'absent', onUnlock, onReset })

      fireEvent.click(screen.getByLabelText('Restore'))

      const file = new File([JSON.stringify(envelope)], 'backup.json', { type: 'application/json' })
      fireEvent.change(getFileInput(container), { target: { files: [file] } })

      const passwordInput = await screen.findByPlaceholderText('Backup password')
      fireEvent.change(passwordInput, { target: { value: 'in-progress-password' } })

      // Switch to another tab and back.
      fireEvent.click(screen.getByLabelText('New Setup'))
      expect(screen.getByText('Set Encryption Password')).toBeTruthy()

      fireEvent.click(screen.getByLabelText('Restore'))

      const restoredPasswordInput = screen.getByPlaceholderText('Backup password') as HTMLInputElement
      expect(restoredPasswordInput.value).toBe('in-progress-password')
    })
  })
})
