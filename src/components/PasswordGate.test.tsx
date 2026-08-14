import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { PasswordGate } from './PasswordGate'
import { initialState } from '../lib/state'
import * as cryptoModule from '../lib/crypto'
import * as persistModule from '../lib/persist'
import * as driveModule from '../lib/drive'

vi.mock('../lib/crypto', () => ({
  deriveKey: vi.fn(),
  generateSalt: vi.fn(),
  decryptState: vi.fn(),
  encryptState: vi.fn(),
}))

vi.mock('../lib/persist', () => ({
  peekStoredSalt: vi.fn(),
  loadPersistedApp: vi.fn(),
  loadLegacyPlaintextApp: vi.fn(),
  clearPersistedApp: vi.fn(),
}))

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
    openDrivePicker: vi.fn(),
    getDriveConnection: vi.fn(),
    restoreBackupFromFileId: vi.fn(),
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
    driveReady: false,
    driveEmail: null,
    backupFileId: null,
    syncing: false,
    setSyncing: vi.fn(),
    handleConnect: vi.fn(),
    handleDisconnect: vi.fn(),
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
    it('renders tab-seg with "New Setup" and "Restore from Drive" tabs', () => {
      renderPasswordGate({ shape: 'absent', onUnlock, onReset })

      expect(screen.getByLabelText('New Setup')).toBeTruthy()
      expect(screen.getByLabelText('Restore from Drive')).toBeTruthy()
    })

    it('tab-seg is absent when shape="legacy-plaintext"', () => {
      renderPasswordGate({ shape: 'legacy-plaintext', onUnlock, onReset })

      expect(screen.queryByLabelText('New Setup')).toBeFalsy()
      expect(screen.queryByLabelText('Restore from Drive')).toBeFalsy()
    })

    it('tab-seg is absent when shape="encrypted"', () => {
      renderPasswordGate({ shape: 'encrypted', onUnlock, onReset })

      expect(screen.queryByLabelText('New Setup')).toBeFalsy()
      expect(screen.queryByLabelText('Restore from Drive')).toBeFalsy()
    })

    it('clicking "Restore from Drive" tab swaps title/subtitle and hides password-set form', () => {
      renderPasswordGate({ shape: 'absent', onUnlock, onReset })

      expect(screen.getByText('Set Encryption Password')).toBeTruthy()
      expect(screen.getByText('Choose a password to encrypt your data on this device.')).toBeTruthy()

      fireEvent.click(screen.getByLabelText('Restore from Drive'))

      expect(screen.getByText('Restore from Google Drive')).toBeTruthy()
      expect(screen.getByText('Load your data stored in Google Drive.')).toBeTruthy()
      // When restore tab is active, the new setup title should not be visible
      expect(screen.queryByText('Set Encryption Password')).toBeFalsy()
    })

    it('clicking back to "New Setup" restores it with previously-typed password values intact', () => {
      renderPasswordGate({ shape: 'absent', onUnlock, onReset })

      const [passwordInput, confirmInput] = getPasswordInputs()
      fireEvent.change(passwordInput, { target: { value: 'mysecretpassword' } })
      fireEvent.change(confirmInput, { target: { value: 'mysecretpassword' } })

      // Switch to restore tab
      fireEvent.click(screen.getByLabelText('Restore from Drive'))
      expect(screen.getByText('Restore from Google Drive')).toBeTruthy()

      // Switch back to new setup
      fireEvent.click(screen.getByLabelText('New Setup'))
      expect(screen.getByText('Set Encryption Password')).toBeTruthy()

      // Password values should still be there
      const [restoredPasswordInput, restoredConfirmInput] = getPasswordInputs()
      expect(restoredPasswordInput.value).toBe('mysecretpassword')
      expect(restoredConfirmInput.value).toBe('mysecretpassword')
    })

    it('shows "Connect Google Account" button on restore tab when driveReady=false', async () => {
      renderPasswordGate({ shape: 'absent', onUnlock, onReset, driveReady: false })

      fireEvent.click(screen.getByLabelText('Restore from Drive'))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Connect Google Account' })).toBeTruthy()
      })
    })

    it('clicking Connect calls handleConnect prop', async () => {
      const mockHandleConnect = vi.fn()
      renderPasswordGate({
        shape: 'absent',
        onUnlock,
        onReset,
        driveReady: false,
        handleConnect: mockHandleConnect,
      })

      fireEvent.click(screen.getByLabelText('Restore from Drive'))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Connect Google Account' })).toBeTruthy()
      })

      fireEvent.click(screen.getByRole('button', { name: 'Connect Google Account' }))

      expect(mockHandleConnect).toHaveBeenCalled()
    })

    it('picking a file encrypted with different password shows cross-password prompt', async () => {
      const mockOnUnlock = vi.fn()
      const mockHandleConnect = vi.fn()
      const backupSalt = new Uint8Array([4, 5, 6])
      const mockEnvelope = { encrypted: 'data' }

      vi.mocked(driveModule.getDriveConnection).mockResolvedValue({
        accessToken: 'fake-token',
        refreshToken: 'fake-refresh',
        userEmail: 'user@example.com',
      })

      vi.mocked(driveModule.restoreBackupFromFileId).mockRejectedValue(
        new driveModule.DriveDecryptError('backup encrypted with a different password', backupSalt, mockEnvelope)
      )
      global.confirm = vi.fn().mockReturnValue(true)

      renderPasswordGate({
        shape: 'absent',
        onUnlock: mockOnUnlock,
        onReset,
        driveReady: true,
        driveEmail: 'user@example.com',
        handleConnect: mockHandleConnect,
      })

      fireEvent.click(screen.getByLabelText('Restore from Drive'))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Restore from Drive' })).toBeTruthy()
      })

      fireEvent.click(screen.getByRole('button', { name: 'Restore from Drive' }))

      // Wait for openDrivePicker to be called
      await waitFor(() => {
        expect(vi.mocked(driveModule.openDrivePicker)).toHaveBeenCalled()
      })

      // Simulate file selection from picker
      const [, onSelect] = vi.mocked(driveModule.openDrivePicker).mock.calls[0]
      await onSelect('picked-file-id')

      await waitFor(() => {
        expect(
          screen.getByText('This backup was saved with a different encryption password. Enter that password to restore:')
        ).toBeTruthy()
      })
    })

    it('correct backup password decrypts and calls onUnlock with (retryKey, promptSalt, decryptedState)', async () => {
      const mockOnUnlock = vi.fn()
      const backupPassword = 'correct-backup-password'
      const backupSalt = new Uint8Array([4, 5, 6])
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
      const mockEnvelope = { encrypted: 'data' }
      const backupKey = { backup: 'key' } as unknown as CryptoKey

      vi.mocked(driveModule.getDriveConnection).mockResolvedValue({
        accessToken: 'fake-token',
        refreshToken: 'fake-refresh',
        userEmail: 'user@example.com',
      })

      vi.mocked(driveModule.restoreBackupFromFileId).mockRejectedValue(
        new driveModule.DriveDecryptError('backup encrypted with a different password', backupSalt, mockEnvelope)
      )
      vi.mocked(global.confirm).mockReturnValue(true)

      const { container } = renderPasswordGate({
        shape: 'absent',
        onUnlock: mockOnUnlock,
        onReset,
        driveReady: true,
        driveEmail: 'user@example.com',
      })

      fireEvent.click(screen.getByLabelText('Restore from Drive'))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Restore from Drive' })).toBeTruthy()
      })

      fireEvent.click(screen.getByRole('button', { name: 'Restore from Drive' }))

      // Wait for openDrivePicker to be called
      await waitFor(() => {
        expect(vi.mocked(driveModule.openDrivePicker)).toHaveBeenCalled()
      })

      // Simulate file selection from picker
      const [, onSelect] = vi.mocked(driveModule.openDrivePicker).mock.calls[0]
      await onSelect('picked-file-id')

      await waitFor(() => {
        expect(screen.getByText(/This backup was saved with a different encryption password/)).toBeTruthy()
      })

      // Now set up the mocks for the cross-password attempt
      vi.mocked(cryptoModule.deriveKey).mockResolvedValue(backupKey)
      vi.mocked(cryptoModule.decryptState).mockResolvedValue(restoredState)

      const passwordInputs = Array.from(container.querySelectorAll('input[type="password"]')) as HTMLInputElement[]
      fireEvent.change(passwordInputs[0], { target: { value: backupPassword } })
      fireEvent.click(screen.getByRole('button', { name: 'Restore with this password' }))

      await waitFor(() => {
        expect(mockOnUnlock).toHaveBeenCalledWith(backupKey, backupSalt, restoredState)
      })
    })

    it('wrong backup password shows "Incorrect encryption password" and keeps prompt open', async () => {
      const mockOnUnlock = vi.fn()
      const backupSalt = new Uint8Array([4, 5, 6])
      const mockEnvelope = { encrypted: 'data' }

      vi.mocked(driveModule.getDriveConnection).mockResolvedValue({
        accessToken: 'fake-token',
        refreshToken: 'fake-refresh',
        userEmail: 'user@example.com',
      })

      vi.mocked(driveModule.restoreBackupFromFileId).mockRejectedValue(
        new driveModule.DriveDecryptError('backup encrypted with a different password', backupSalt, mockEnvelope)
      )
      vi.mocked(cryptoModule.decryptState).mockRejectedValue(new Error('decrypt failed'))
      global.confirm = vi.fn().mockReturnValue(true)

      const { container } = renderPasswordGate({
        shape: 'absent',
        onUnlock: mockOnUnlock,
        onReset,
        driveReady: true,
        driveEmail: 'user@example.com',
      })

      fireEvent.click(screen.getByLabelText('Restore from Drive'))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Restore from Drive' })).toBeTruthy()
      })

      fireEvent.click(screen.getByRole('button', { name: 'Restore from Drive' }))

      // Wait for openDrivePicker to be called
      await waitFor(() => {
        expect(vi.mocked(driveModule.openDrivePicker)).toHaveBeenCalled()
      })

      // Simulate file selection from picker
      const [, onSelect] = vi.mocked(driveModule.openDrivePicker).mock.calls[0]
      await onSelect('picked-file-id')

      await waitFor(() => {
        expect(screen.getByText(/This backup was saved with a different encryption password/)).toBeTruthy()
      })

      const passwordInputs = Array.from(container.querySelectorAll('input[type="password"]')) as HTMLInputElement[]
      fireEvent.change(passwordInputs[0], { target: { value: 'wrong-password' } })
      fireEvent.click(screen.getByRole('button', { name: 'Restore with this password' }))

      await waitFor(() => {
        expect(screen.getByText('Incorrect encryption password')).toBeTruthy()
      })

      expect(mockOnUnlock).not.toHaveBeenCalled()
      expect(screen.getByText(/This backup was saved with a different encryption password/)).toBeTruthy()
    })


    it('clicking "Disconnect" on restore tab calls handleDisconnect', async () => {
      const mockHandleDisconnect = vi.fn()

      renderPasswordGate({
        shape: 'absent',
        onUnlock,
        onReset,
        driveReady: true,
        driveEmail: 'user@example.com',
        handleDisconnect: mockHandleDisconnect,
      })

      fireEvent.click(screen.getByLabelText('Restore from Drive'))

      await waitFor(() => {
        expect(screen.getByText('user@example.com')).toBeTruthy()
      })

      fireEvent.click(screen.getByText('Disconnect'))

      expect(mockHandleDisconnect).toHaveBeenCalled()
    })

    it('Reset App link/dialog works identically from restore tab', async () => {
      vi.mocked(persistModule.clearPersistedApp).mockResolvedValue(undefined)

      renderPasswordGate({ shape: 'absent', onUnlock, onReset })

      fireEvent.click(screen.getByLabelText('Restore from Drive'))

      await waitFor(() => {
        expect(screen.getByText('Restore from Google Drive')).toBeTruthy()
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
})
