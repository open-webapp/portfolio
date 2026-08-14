import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { SettingsPage, type SettingsPageProps } from './Settings'
import { initialState } from '../lib/state'
import * as driveModule from '../lib/drive'
import * as persistModule from '../lib/persist'
import { deriveKey, generateSalt, encryptState } from '../lib/crypto'

// Mock the drive module. Settings.tsx renders DriveRestorePanel which uses
// openDrivePicker, getDriveConnection, restoreBackupFromFileId, and DriveDecryptError.
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
    restoreBackupFromFileId: vi.fn(),
    getDriveConnection: vi.fn(),
    getAccessTokenForPicker: vi.fn(),
    getDriveAuthStatus: vi.fn(),
    syncBackup: vi.fn(),
    DriveDecryptError,
  }
})

// Mock the persist module (used by the Change Password flow to verify the
// current password and to save the re-encrypted blob under the new key)
vi.mock('../lib/persist', () => ({
  loadPersistedApp: vi.fn(),
  savePersistedApp: vi.fn(),
}))

// Mock window.alert and window.confirm
global.alert = vi.fn()
global.confirm = vi.fn()

// Store captured callbacks from openDrivePicker mocks
let capturedPickerCallback: {
  onSelect: ((fileId: string) => void) | null
  onCancel: (() => void) | null
} = { onSelect: null, onCancel: null }

const mockDispatch = vi.fn()
const mockOnKeyChange = vi.fn()
const mockSetSyncing = vi.fn()
const mockHandleConnect = vi.fn()
const mockHandleDisconnect = vi.fn()
const mockSetSettingsSection = vi.fn()

const notConnectedAuthStatus: driveModule.DriveAuthStatus = {
  connected: false,
  email: null,
  expiresAt: null,
  needsReauth: false,
  tokenValid: false,
}

const connectedAuthStatus: driveModule.DriveAuthStatus = {
  connected: true,
  email: 'test@example.com',
  expiresAt: Date.now() + 60 * 60 * 1000,
  needsReauth: false,
  tokenValid: true,
}

describe('SettingsPage', () => {
  let sessionSalt: Uint8Array
  let sessionKey: CryptoKey

  beforeEach(async () => {
    vi.clearAllMocks()
    capturedPickerCallback = { onSelect: null, onCancel: null }
    sessionSalt = generateSalt()
    sessionKey = await deriveKey('test-password', sessionSalt)

    // Default mocks
    vi.mocked(driveModule.getAccessTokenForPicker as any).mockResolvedValue('mock-token')
    vi.mocked(driveModule.getDriveConnection).mockResolvedValue({ accessToken: 'test-token' })

    // Mock openDrivePicker to capture callbacks without calling them
    vi.mocked(driveModule.openDrivePicker).mockImplementation(
      async (_token, onSelect, onCancel) => {
        capturedPickerCallback.onSelect = onSelect
        capturedPickerCallback.onCancel = onCancel
        // Don't call the callbacks - tests will do that
      }
    )
  })

  afterEach(() => {
    cleanup()
  })

  function renderSettings(overrides: Partial<SettingsPageProps> = {}) {
    const defaultProps: SettingsPageProps = {
      state: initialState(),
      dispatch: mockDispatch,
      sessionKey,
      sessionSalt,
      onKeyChange: mockOnKeyChange,
      driveReady: false,
      driveEmail: null,
      backupFileId: null,
      syncing: false,
      setSyncing: mockSetSyncing,
      handleConnect: mockHandleConnect,
      handleDisconnect: mockHandleDisconnect,
      settingsSection: 'drive',
      setSettingsSection: mockSetSettingsSection,
    }
    return render(<SettingsPage {...defaultProps} {...overrides} />)
  }

  describe('Not connected state', () => {
    it('renders "Not connected" state initially with Connect button', () => {
      renderSettings({ driveReady: false })

      expect(screen.getByText('Google Drive Sync')).toBeTruthy()

      const connectButton = screen.getByRole('button', { name: 'Connect Google Account' })
      expect(connectButton).toBeTruthy()

      // Should not show Sync, Restore, or Disconnect buttons
      expect(screen.queryByRole('button', { name: /Sync Now/ })).toBeFalsy()
      expect(screen.queryByRole('button', { name: /Restore from Drive/ })).toBeFalsy()
      expect(screen.queryByText('Disconnect')).toBeFalsy()
    })

    it('Connect button has btn btn-primary blueprint classes', () => {
      renderSettings({ driveReady: false })

      const connectButton = screen.getByRole('button', { name: 'Connect Google Account' })
      expect(connectButton.className).toContain('btn btn-primary')
      expect(connectButton.className).toContain('blueprint')
    })

    it('clicking Connect button calls the handleConnect prop', () => {
      renderSettings({ driveReady: false })

      const connectButton = screen.getByRole('button', { name: 'Connect Google Account' })
      fireEvent.click(connectButton)

      expect(mockHandleConnect).toHaveBeenCalledTimes(1)
    })

    it('shows "Connecting..." text and disables the Connect button when syncing prop is true', () => {
      renderSettings({ driveReady: false, syncing: true })

      const connectButton = screen.getByRole('button', { name: 'Connecting...' })
      expect(connectButton).toBeTruthy()
      expect((connectButton as HTMLButtonElement).disabled).toBe(true)
    })
  })

  describe('Connected state', () => {
    it('renders connected state with Restore from Drive and Disconnect', () => {
      renderSettings({ driveReady: true, driveEmail: 'test@example.com' })

      expect(screen.getByRole('button', { name: 'Restore from Drive' })).toBeTruthy()

      // Should show connected email and disconnect link
      expect(screen.getByText('test@example.com')).toBeTruthy()
      expect(screen.getByText('Disconnect')).toBeTruthy()

      // Should not show Connect button or Sync Now button
      expect(screen.queryByRole('button', { name: 'Connect Google Account' })).toBeFalsy()
      expect(screen.queryByRole('button', { name: /Sync Now/ })).toBeFalsy()
    })

    it('Restore from Drive button uses correct classes', () => {
      renderSettings({ driveReady: true, driveEmail: 'test@example.com' })

      const restoreButton = screen.getByRole('button', { name: 'Restore from Drive' })
      expect(restoreButton.className).toContain('btn btn-secondary')
      expect(restoreButton.className).not.toContain('blueprint')
      expect(restoreButton.querySelectorAll('i.corner').length).toBe(0)
    })

    it('does not show Drive link when connected but no backup file exists', () => {
      renderSettings({ driveReady: true, driveEmail: 'test@example.com', backupFileId: null })

      expect(screen.queryByRole('link', { name: 'View backup in Google Drive' })).toBeFalsy()
    })

    it('shows Drive link to existing backup file when connected and synced', () => {
      renderSettings({ driveReady: true, driveEmail: 'test@example.com', backupFileId: 'file-id-123' })

      const link = screen.getByRole('link', { name: 'View backup in Google Drive' })
      expect(link.getAttribute('href')).toBe('https://drive.google.com/file/d/file-id-123/view')
      expect(link.getAttribute('target')).toBe('_blank')
    })


    it('shows "Restoring..." text and disables Restore when syncing prop is true', () => {
      renderSettings({ driveReady: true, driveEmail: 'test@example.com', syncing: true })

      const restoreButton = screen.getByRole('button', { name: 'Restoring...' })
      expect(restoreButton).toBeTruthy()
      expect((restoreButton as HTMLButtonElement).disabled).toBe(true)
    })

    it('Restore from Drive opens picker and restores selected file', async () => {
      const restoredState = initialState()
      restoredState.accounts = [
        {
          id: '1',
          accountNumber: '123',
          name: 'Test Account',
          retirement: false,
          createdAt: '2024-01-01',
        },
      ]

      vi.mocked(driveModule.restoreBackupFromFileId).mockResolvedValue(restoredState)
      vi.mocked(global.confirm).mockReturnValue(true)

      renderSettings({ driveReady: true, driveEmail: 'test@example.com' })

      const restoreButton = screen.getByRole('button', { name: 'Restore from Drive' })
      fireEvent.click(restoreButton)

      // Simulate user selecting a file from picker
      await waitFor(() => {
        expect(capturedPickerCallback.onSelect).not.toBeNull()
      })

      capturedPickerCallback.onSelect!('picked-file-id')

      await waitFor(() => {
        expect(global.confirm).toHaveBeenCalledWith(
          'Restore will replace all data with the backed-up version. Continue?'
        )
        expect(driveModule.restoreBackupFromFileId).toHaveBeenCalledWith('picked-file-id', expect.anything())
        expect(mockDispatch).toHaveBeenCalledWith({
          type: '__SET_STATE',
          newState: restoredState,
        })
        expect(global.alert).toHaveBeenCalledWith('Restored from Drive')
      })
    })

    it('Restore is cancelled if user declines confirmation', async () => {
      vi.mocked(global.confirm).mockReturnValue(false)

      renderSettings({ driveReady: true, driveEmail: 'test@example.com' })

      const restoreButton = screen.getByRole('button', { name: 'Restore from Drive' })
      fireEvent.click(restoreButton)

      // Simulate user selecting a file from picker
      await waitFor(() => {
        expect(capturedPickerCallback.onSelect).not.toBeNull()
      })

      capturedPickerCallback.onSelect!('picked-file-id')

      await waitFor(() => {
        expect(global.confirm).toHaveBeenCalled()
        expect(driveModule.restoreBackupFromFileId).not.toHaveBeenCalled()
        expect(mockDispatch).not.toHaveBeenCalled()
      })
    })


    it('calls setSyncing(true) then setSyncing(false) around a restore', async () => {
      const restoredState = initialState()
      vi.mocked(driveModule.restoreBackupFromFileId).mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(restoredState), 20))
      )
      vi.mocked(global.confirm).mockReturnValue(true)

      renderSettings({ driveReady: true, driveEmail: 'test@example.com' })

      const restoreButton = screen.getByRole('button', { name: 'Restore from Drive' })
      fireEvent.click(restoreButton)

      // Simulate user selecting a file from picker
      await waitFor(() => {
        expect(capturedPickerCallback.onSelect).not.toBeNull()
      })

      capturedPickerCallback.onSelect!('picked-file-id')

      await waitFor(() => {
        expect(mockSetSyncing).toHaveBeenCalledWith(true)
      })
      await waitFor(() => {
        expect(mockSetSyncing).toHaveBeenCalledWith(false)
      })
    })

    it('shows error alert if Restore fails', async () => {
      const error = new Error('Restore error')
      vi.mocked(driveModule.restoreBackupFromFileId).mockRejectedValue(error)
      vi.mocked(global.confirm).mockReturnValue(true)

      renderSettings({ driveReady: true, driveEmail: 'test@example.com' })

      const restoreButton = screen.getByRole('button', { name: 'Restore from Drive' })
      fireEvent.click(restoreButton)

      // Simulate user selecting a file from picker
      await waitFor(() => {
        expect(capturedPickerCallback.onSelect).not.toBeNull()
      })

      capturedPickerCallback.onSelect!('picked-file-id')

      await waitFor(() => {
        expect(global.alert).toHaveBeenCalledWith('Restore failed: Restore error')
      })
    })
  })

  describe('Disconnect functionality', () => {
    it('clicking Disconnect calls the handleDisconnect prop', () => {
      renderSettings({ driveReady: true, driveEmail: 'test@example.com' })

      const disconnectLink = screen.getByText('Disconnect')
      fireEvent.click(disconnectLink)

      expect(mockHandleDisconnect).toHaveBeenCalledTimes(1)
    })
  })

  describe('Section rendering', () => {
    it('settingsSection="drive" shows the Drive card only', () => {
      renderSettings({ settingsSection: 'drive' })

      expect(screen.getByText('Google Drive Sync')).toBeTruthy()
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
    it('renders tab-seg with "Google Drive" and "Encryption" options', () => {
      renderSettings({ settingsSection: 'drive' })

      expect(screen.getByLabelText('Google Drive')).toBeTruthy()
      expect(screen.getByLabelText('Encryption')).toBeTruthy()
    })

    it('clicking Google Drive tab calls setSettingsSection with "drive"', () => {
      renderSettings({ settingsSection: 'encryption' })

      const googleDriveInput = screen.getByLabelText('Google Drive') as HTMLInputElement
      fireEvent.click(googleDriveInput)

      expect(mockSetSettingsSection).toHaveBeenCalledWith('drive')
    })

    it('clicking Encryption tab calls setSettingsSection with "encryption"', () => {
      renderSettings({ settingsSection: 'drive' })

      const encryptionInput = screen.getByLabelText('Encryption') as HTMLInputElement
      fireEvent.click(encryptionInput)

      expect(mockSetSettingsSection).toHaveBeenCalledWith('encryption')
    })

    it('renders .hr divider immediately after the tab-seg', () => {
      const { container } = renderSettings({ settingsSection: 'drive' })

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
      vi.mocked(driveModule.getDriveAuthStatus).mockResolvedValue(notConnectedAuthStatus)
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

      expect(driveModule.syncBackup).not.toHaveBeenCalled()

      await waitFor(() => {
        expect(mockOnKeyChange).toHaveBeenCalled()
      })
      const keyChangeArgs = mockOnKeyChange.mock.calls[0]
      expect(keyChangeArgs[1]).toEqual(saveArgs[2])

      await waitFor(() => {
        expect(screen.getByText('Encryption password changed')).toBeTruthy()
      })

      const inputs = Array.from(container.querySelectorAll('input[type="password"]')) as HTMLInputElement[]
      const [currentInput, newInput, confirmInput] = inputs.slice(-3)
      expect(currentInput.value).toBe('')
      expect(newInput.value).toBe('')
      expect(confirmInput.value).toBe('')
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

    it('also syncs to Drive with the new key/salt when Drive is connected', async () => {
      vi.mocked(persistModule.loadPersistedApp).mockResolvedValue(initialState())
      vi.mocked(persistModule.savePersistedApp).mockResolvedValue()
      vi.mocked(driveModule.getDriveAuthStatus).mockResolvedValue(connectedAuthStatus)
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
      expect(syncArgs[0]).toBe(state)
      expect(syncArgs[1]).toBe(saveArgs[1])
      expect(syncArgs[2]).toEqual(saveArgs[2])

      await waitFor(() => {
        expect(screen.getByText('Encryption password changed')).toBeTruthy()
      })
      expect(screen.queryByText(/Drive re-sync failed/)).toBeFalsy()
    })

    it('keeps the local password change and shows a warning when Drive re-sync fails', async () => {
      vi.mocked(persistModule.loadPersistedApp).mockResolvedValue(initialState())
      vi.mocked(persistModule.savePersistedApp).mockResolvedValue()
      vi.mocked(driveModule.getDriveAuthStatus).mockResolvedValue(connectedAuthStatus)
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
      await waitFor(() => {
        expect(
          screen.getByText(/Encryption password changed locally, but Drive re-sync failed: network down/)
        ).toBeTruthy()
      })
    })
  })

  describe('Cross-password Drive restore', () => {
    beforeEach(() => {
      vi.mocked(global.confirm).mockReturnValue(true)
    })

    it('shows the inline cross-password prompt when file restore rejects with DriveDecryptError', async () => {
      const backupSalt = generateSalt()
      const backupState = initialState()
      const envelope = await encryptState(backupState, sessionKey, backupSalt)
      vi.mocked(driveModule.restoreBackupFromFileId).mockRejectedValue(
        new driveModule.DriveDecryptError('backup encrypted with a different password', backupSalt, envelope)
      )

      renderSettings({ driveReady: true, driveEmail: 'test@example.com' })

      const restoreButton = screen.getByRole('button', { name: 'Restore from Drive' })
      fireEvent.click(restoreButton)

      // Simulate user selecting a file from picker
      await waitFor(() => {
        expect(capturedPickerCallback.onSelect).not.toBeNull()
      })

      capturedPickerCallback.onSelect!('picked-file-id')

      await waitFor(() => {
        expect(
          screen.getByText('This backup was saved with a different encryption password. Enter that password to restore:')
        ).toBeTruthy()
      })

      // Only the confirm dialog ran to trigger the restore; the decrypt-mismatch path itself does not prompt again.
      expect(global.confirm).toHaveBeenCalledTimes(1)
    })

    it('"Restore with this password" button has btn btn-primary blueprint classes and 4 ordered corner marks; Cancel stays plain secondary', async () => {
      const backupSalt = generateSalt()
      const backupState = initialState()
      const envelope = await encryptState(backupState, sessionKey, backupSalt)
      vi.mocked(driveModule.restoreBackupFromFileId).mockRejectedValue(
        new driveModule.DriveDecryptError('backup encrypted with a different password', backupSalt, envelope)
      )

      renderSettings({ driveReady: true, driveEmail: 'test@example.com' })

      const restoreButton = screen.getByRole('button', { name: 'Restore from Drive' })
      fireEvent.click(restoreButton)

      // Simulate user selecting a file from picker
      await waitFor(() => {
        expect(capturedPickerCallback.onSelect).not.toBeNull()
      })

      capturedPickerCallback.onSelect!('picked-file-id')

      const submitButton = await screen.findByRole('button', { name: 'Restore with this password' })
      expect(submitButton.className).toContain('btn btn-primary')
      expect(submitButton.className).toContain('blueprint')

      const cancelButton = screen.getByRole('button', { name: 'Cancel' })
      expect(cancelButton.className).toContain('btn btn-secondary')
      expect(cancelButton.className).not.toContain('blueprint')
      expect(cancelButton.querySelectorAll('i.corner').length).toBe(0)
    })

    it('retries decryption locally against the carried envelope (no second restoreBackupFromFileId call) on the correct backup password', async () => {
      const backupPassword = 'correct-backup-password'
      const backupSalt = generateSalt()
      const backupKey = await deriveKey(backupPassword, backupSalt)
      const restoredState = initialState()
      restoredState.accounts = [
        {
          id: 'acc1',
          accountNumber: '999',
          name: 'Backup Account',
          retirement: false,
          createdAt: '2024-01-01',
        },
      ]
      const envelope = await encryptState(restoredState, backupKey, backupSalt)
      vi.mocked(driveModule.restoreBackupFromFileId).mockRejectedValue(
        new driveModule.DriveDecryptError('backup encrypted with a different password', backupSalt, envelope)
      )

      const { container } = renderSettings({ driveReady: true, driveEmail: 'test@example.com' })

      const restoreButton = screen.getByRole('button', { name: 'Restore from Drive' })
      fireEvent.click(restoreButton)

      // Simulate user selecting a file from picker
      await waitFor(() => {
        expect(capturedPickerCallback.onSelect).not.toBeNull()
      })

      capturedPickerCallback.onSelect!('picked-file-id')

      await waitFor(() => {
        expect(screen.getByText(/This backup was saved with a different encryption password/)).toBeTruthy()
      })

      const passwordInputs = Array.from(container.querySelectorAll('input[type="password"]')) as HTMLInputElement[]
      fireEvent.change(passwordInputs[0], { target: { value: backupPassword } })
      fireEvent.click(screen.getByRole('button', { name: 'Restore with this password' }))

      await waitFor(() => {
        expect(mockDispatch).toHaveBeenCalledWith({ type: '__SET_STATE', newState: restoredState })
      })

      expect(driveModule.restoreBackupFromFileId).toHaveBeenCalledTimes(1)

      await waitFor(() => {
        expect(mockOnKeyChange).toHaveBeenCalled()
      })
      const keyChangeArgs = mockOnKeyChange.mock.calls[0]
      expect(keyChangeArgs[1]).toEqual(backupSalt)
    })

    it('shows an inline error and keeps the prompt open (retryable) on a wrong backup password', async () => {
      const backupSalt = generateSalt()
      const restoredState = initialState()
      const envelope = await encryptState(restoredState, sessionKey, backupSalt)
      vi.mocked(driveModule.restoreBackupFromFileId).mockRejectedValue(
        new driveModule.DriveDecryptError('backup encrypted with a different password', backupSalt, envelope)
      )

      const { container } = renderSettings({ driveReady: true, driveEmail: 'test@example.com' })

      const restoreButton = screen.getByRole('button', { name: 'Restore from Drive' })
      fireEvent.click(restoreButton)

      // Simulate user selecting a file from picker
      await waitFor(() => {
        expect(capturedPickerCallback.onSelect).not.toBeNull()
      })

      capturedPickerCallback.onSelect!('picked-file-id')

      await waitFor(() => {
        expect(screen.getByText(/This backup was saved with a different encryption password/)).toBeTruthy()
      })

      const passwordInputs = Array.from(container.querySelectorAll('input[type="password"]')) as HTMLInputElement[]
      fireEvent.change(passwordInputs[0], { target: { value: 'totally-wrong-password' } })
      fireEvent.click(screen.getByRole('button', { name: 'Restore with this password' }))

      await waitFor(() => {
        expect(screen.getByText('Incorrect encryption password')).toBeTruthy()
      })

      // Prompt stays open and can be retried
      expect(
        screen.getByText('This backup was saved with a different encryption password. Enter that password to restore:')
      ).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Restore with this password' })).toBeTruthy()
      expect(mockDispatch).not.toHaveBeenCalled()
    })

    it('T5.1: Fallback Picker appears after failed cross-password retry', async () => {
      const backupSalt = generateSalt()
      const restoredState = initialState()
      const envelope = await encryptState(restoredState, sessionKey, backupSalt)
      let pickerCallCount = 0
      vi.mocked(driveModule.openDrivePicker).mockImplementation(
        async (_token, onSelect, _onCancel) => {
          pickerCallCount++
          capturedPickerCallback.onSelect = onSelect
          capturedPickerCallback.onCancel = onCancel
          // Don't call callback - let the test control this
        }
      )
      vi.mocked(driveModule.restoreBackupFromFileId).mockRejectedValue(
        new driveModule.DriveDecryptError('backup encrypted with a different password', backupSalt, envelope)
      )

      const { container } = renderSettings({ driveReady: true, driveEmail: 'test@example.com' })

      const restoreButton = screen.getByRole('button', { name: 'Restore from Drive' })
      fireEvent.click(restoreButton)

      // Simulate user selecting a file from picker (first picker call)
      await waitFor(() => {
        expect(pickerCallCount).toBeGreaterThan(0)
      })

      capturedPickerCallback.onSelect!('picked-file-id')

      await waitFor(() => {
        expect(screen.getByText(/This backup was saved with a different encryption password/)).toBeTruthy()
      })

      // Submit wrong password
      const passwordInputs = Array.from(container.querySelectorAll('input[type="password"]')) as HTMLInputElement[]
      fireEvent.change(passwordInputs[0], { target: { value: 'wrong-password' } })
      fireEvent.click(screen.getByRole('button', { name: 'Restore with this password' }))

      // Wait for error to appear
      await waitFor(() => {
        expect(screen.getByText('Incorrect encryption password')).toBeTruthy()
      })

      // The second Picker should have opened (fallback from cross-password error)
      await waitFor(() => {
        expect(pickerCallCount).toBeGreaterThanOrEqual(2)
      })
    })

    it('T5.2: Picking a different file via fallback from cross-password error restores successfully', async () => {
      const backupSalt = generateSalt()
      const restoredState = initialState()
      restoredState.accounts = [
        {
          id: 'picked-acc-1',
          accountNumber: '555',
          name: 'Picked Account',
          retirement: false,
          createdAt: '2024-01-01',
        },
      ]
      const envelope = await encryptState(restoredState, sessionKey, backupSalt)

      let pickerCallCount = 0
      const pickerCallbacks: Array<{ onSelect: (fileId: string) => void; onCancel: () => void }> = []
      vi.mocked(driveModule.openDrivePicker).mockImplementation(
        async (_token, onSelect, _onCancel) => {
          pickerCallCount++
          pickerCallbacks.push({ onSelect, onCancel: _onCancel })
          capturedPickerCallback.onSelect = onSelect
          capturedPickerCallback.onCancel = _onCancel
          // Don't call callbacks - let the test control this
        }
      )

      vi.mocked(driveModule.restoreBackupFromFileId).mockImplementation(async (fileId: string) => {
        if (fileId === 'first-file-id') {
          throw new driveModule.DriveDecryptError('backup encrypted with a different password', backupSalt, envelope)
        }
        return restoredState
      })

      const { container } = renderSettings({ driveReady: true, driveEmail: 'test@example.com' })

      const restoreButton = screen.getByRole('button', { name: 'Restore from Drive' })
      fireEvent.click(restoreButton)

      // Simulate user selecting first file from picker
      await waitFor(() => {
        expect(pickerCallCount).toBeGreaterThan(0)
      })

      pickerCallbacks[0].onSelect('first-file-id')

      await waitFor(() => {
        expect(screen.getByText(/This backup was saved with a different encryption password/)).toBeTruthy()
      })

      // Submit wrong password to trigger fallback picker
      const passwordInputs = Array.from(container.querySelectorAll('input[type="password"]')) as HTMLInputElement[]
      fireEvent.change(passwordInputs[0], { target: { value: 'wrong-password' } })
      fireEvent.click(screen.getByRole('button', { name: 'Restore with this password' }))

      await waitFor(() => {
        expect(screen.getByText('Incorrect encryption password')).toBeTruthy()
      })

      // Wait for the fallback picker to open
      await waitFor(() => {
        expect(pickerCallCount).toBeGreaterThanOrEqual(2)
      })

      // Simulate user selecting file from fallback picker
      pickerCallbacks[1].onSelect('picked-file-id')

      // The confirmation dialog should be triggered for the fallback pick
      expect(global.confirm).toHaveBeenCalledWith('Restore will replace all data with the backed-up version. Continue?')

      // Wait for successful restore
      await waitFor(() => {
        expect(mockDispatch).toHaveBeenCalledWith({ type: '__SET_STATE', newState: restoredState })
      })

      // Prompt should be closed
      expect(screen.queryByText(/This backup was saved with a different encryption password/)).toBeFalsy()

      // Success alert shown
      expect(global.alert).toHaveBeenCalledWith('Restored from Drive')
    })

    it('T5.3: Picking a file that also fails to decrypt shows blank password field (not pre-filled)', async () => {
      const backupSalt1 = generateSalt()
      const backupState = initialState()
      const envelope1 = await encryptState(backupState, sessionKey, backupSalt1)
      const backupSalt2 = generateSalt()
      const envelope2 = await encryptState(backupState, sessionKey, backupSalt2)

      let pickerCallCount = 0
      const pickerCallbacks: Array<{ onSelect: (fileId: string) => void; onCancel: () => void }> = []
      vi.mocked(driveModule.openDrivePicker).mockImplementation(
        async (_token, onSelect, _onCancel) => {
          pickerCallCount++
          pickerCallbacks.push({ onSelect, onCancel: _onCancel })
          capturedPickerCallback.onSelect = onSelect
          capturedPickerCallback.onCancel = _onCancel
        }
      )

      vi.mocked(driveModule.restoreBackupFromFileId).mockImplementation(async (fileId: string) => {
        if (fileId === 'picked-file-1') {
          throw new driveModule.DriveDecryptError('backup encrypted with a different password', backupSalt1, envelope1)
        } else if (fileId === 'picked-file-b') {
          throw new driveModule.DriveDecryptError('backup encrypted with a different password', backupSalt2, envelope2)
        }
        throw new Error('unexpected fileId')
      })

      const { container } = renderSettings({ driveReady: true, driveEmail: 'test@example.com' })

      const restoreButton = screen.getByRole('button', { name: 'Restore from Drive' })
      fireEvent.click(restoreButton)

      // Simulate user selecting first file
      await waitFor(() => {
        expect(pickerCallCount).toBeGreaterThan(0)
      })

      pickerCallbacks[0].onSelect('picked-file-1')

      await waitFor(() => {
        expect(screen.getByText(/This backup was saved with a different encryption password/)).toBeTruthy()
      })

      // Submit wrong password
      let passwordInputs = Array.from(container.querySelectorAll('input[type="password"]')) as HTMLInputElement[]
      fireEvent.change(passwordInputs[0], { target: { value: 'first-wrong-password' } })
      fireEvent.click(screen.getByRole('button', { name: 'Restore with this password' }))

      await waitFor(() => {
        expect(screen.getByText('Incorrect encryption password')).toBeTruthy()
      })

      // Wait for fallback picker to open
      await waitFor(() => {
        expect(pickerCallCount).toBeGreaterThanOrEqual(2)
      })

      // Simulate user selecting file B from fallback picker
      pickerCallbacks[1].onSelect('picked-file-b')

      // Confirmation dialog for fallback pick
      expect(global.confirm).toHaveBeenCalledWith('Restore will replace all data with the backed-up version. Continue?')

      // Wait for the new cross-password prompt (from the picked file's envelope)
      await waitFor(() => {
        expect(driveModule.restoreBackupFromFileId).toHaveBeenCalledWith('picked-file-b', expect.anything())
      })

      // The old error should be cleared
      expect(screen.queryByText('Incorrect encryption password')).toBeFalsy()

      // A fresh password prompt should be shown
      await waitFor(() => {
        expect(screen.getAllByText(/This backup was saved with a different encryption password/).length).toBeGreaterThan(0)
      })

      // The password input should be blank (not pre-filled with the failed attempt)
      const updatedPasswordInputs = Array.from(container.querySelectorAll('input[type="password"]')) as HTMLInputElement[]
      expect(updatedPasswordInputs[0].value).toBe('')
    })

    it('T5.4: Chaining: pick A fails, pick B fails, blank password shown for B (not A\'s leftover)', async () => {
      const saltOriginal = generateSalt()
      const saltA = generateSalt()
      const saltB = generateSalt()
      const backupState = initialState()
      const envelopeOriginal = await encryptState(backupState, sessionKey, saltOriginal)
      const envelopeA = await encryptState(backupState, sessionKey, saltA)
      const envelopeB = await encryptState(backupState, sessionKey, saltB)

      let pickerCallCount = 0
      const pickerCallbacks: Array<{ onSelect: (fileId: string) => void; onCancel: () => void }> = []
      vi.mocked(driveModule.openDrivePicker).mockImplementation(
        async (_token, onSelect, _onCancel) => {
          pickerCallCount++
          pickerCallbacks.push({ onSelect, onCancel: _onCancel })
          capturedPickerCallback.onSelect = onSelect
          capturedPickerCallback.onCancel = _onCancel
        }
      )

      vi.mocked(driveModule.restoreBackupFromFileId).mockImplementation(async (fileId: string) => {
        if (fileId === 'original-file') {
          throw new driveModule.DriveDecryptError('wrong for original', saltOriginal, envelopeOriginal)
        } else if (fileId === 'file-a') {
          throw new driveModule.DriveDecryptError('wrong for A', saltA, envelopeA)
        } else if (fileId === 'file-b') {
          throw new driveModule.DriveDecryptError('wrong for B', saltB, envelopeB)
        }
        throw new Error('unexpected fileId')
      })

      const { container } = renderSettings({ driveReady: true, driveEmail: 'test@example.com' })

      const restoreButton = screen.getByRole('button', { name: 'Restore from Drive' })
      fireEvent.click(restoreButton)

      // Simulate user selecting original file
      await waitFor(() => {
        expect(pickerCallCount).toBeGreaterThan(0)
      })

      pickerCallbacks[0].onSelect('original-file')

      await waitFor(() => {
        expect(screen.getByText(/This backup was saved with a different encryption password/)).toBeTruthy()
      })

      // Step 1: Wrong password on the original file
      let passwordInputs = Array.from(container.querySelectorAll('input[type="password"]')) as HTMLInputElement[]
      fireEvent.change(passwordInputs[0], { target: { value: 'wrong-for-original' } })
      fireEvent.click(screen.getByRole('button', { name: 'Restore with this password' }))

      await waitFor(() => {
        expect(screen.getByText('Incorrect encryption password')).toBeTruthy()
      })

      // Step 2: Fallback picker opens (for file A)
      await waitFor(() => {
        expect(pickerCallCount).toBeGreaterThanOrEqual(2)
      })

      pickerCallbacks[1].onSelect('file-a')

      expect(global.confirm).toHaveBeenCalledWith('Restore will replace all data with the backed-up version. Continue?')

      // File A also fails with cross-password error
      await waitFor(() => {
        expect(driveModule.restoreBackupFromFileId).toHaveBeenCalledWith('file-a', expect.anything())
      })

      // Cross-password prompt still showing for file A
      await waitFor(() => {
        expect(screen.getByText(/This backup was saved with a different encryption password/)).toBeTruthy()
      })

      // Password field should be blank
      let currentPasswordInputs = Array.from(container.querySelectorAll('input[type="password"]')) as HTMLInputElement[]
      expect(currentPasswordInputs[0].value).toBe('')

      // Step 3: Type a password for file A, submit, wrong again
      fireEvent.change(currentPasswordInputs[0], { target: { value: 'wrong-for-file-a' } })
      fireEvent.click(screen.getByRole('button', { name: 'Restore with this password' }))

      await waitFor(() => {
        expect(screen.getByText('Incorrect encryption password')).toBeTruthy()
      })

      // Step 4: Fallback picker opens again (for file B)
      await waitFor(() => {
        expect(pickerCallCount).toBeGreaterThanOrEqual(3)
      })

      pickerCallbacks[2].onSelect('file-b')

      // File B also fails with cross-password error
      await waitFor(() => {
        expect(driveModule.restoreBackupFromFileId).toHaveBeenCalledWith('file-b', expect.anything())
      })

      // Cross-password prompt still showing for file B
      await waitFor(() => {
        expect(screen.getByText(/This backup was saved with a different encryption password/)).toBeTruthy()
      })

      // Password field should STILL be blank (not carrying over the "wrong-for-file-a" we typed)
      currentPasswordInputs = Array.from(container.querySelectorAll('input[type="password"]')) as HTMLInputElement[]
      expect(currentPasswordInputs[0].value).toBe('')
    })

  })
})
