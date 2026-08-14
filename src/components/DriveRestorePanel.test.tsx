import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { DriveRestorePanel, type DriveRestorePanelProps } from './DriveRestorePanel'
import { initialState } from '../lib/state'
import * as driveModule from '../lib/drive'
import { deriveKey, generateSalt, encryptState } from '../lib/crypto'

// Mock the drive module
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
    restoreBackup: vi.fn(),
    restoreBackupFromFileId: vi.fn(),
    extractDriveFileId: vi.fn(),
    DriveDecryptError,
  }
})

// Mock window.alert and window.confirm
global.alert = vi.fn()
global.confirm = vi.fn()

const mockSetSyncing = vi.fn()
const mockHandleConnect = vi.fn()
const mockHandleDisconnect = vi.fn()
const mockOnRestored = vi.fn()

function renderPanel(overrides: Partial<DriveRestorePanelProps> = {}) {
  let testRestoreKey: CryptoKey
  let testRestoreSalt: Uint8Array

  beforeEach(async () => {
    testRestoreSalt = generateSalt()
    testRestoreKey = await deriveKey('test-restore-password', testRestoreSalt)
  })

  const defaultProps: DriveRestorePanelProps = {
    driveReady: false,
    driveEmail: null,
    backupFileId: null,
    syncing: false,
    setSyncing: mockSetSyncing,
    handleConnect: mockHandleConnect,
    handleDisconnect: mockHandleDisconnect,
    restoreKey: testRestoreKey,
    restoreSalt: testRestoreSalt,
    onRestored: mockOnRestored,
  }

  return render(<DriveRestorePanel {...defaultProps} {...overrides} />)
}

describe('DriveRestorePanel', () => {
  let testRestoreKey: CryptoKey
  let testRestoreSalt: Uint8Array

  beforeEach(async () => {
    vi.clearAllMocks()
    testRestoreSalt = generateSalt()
    testRestoreKey = await deriveKey('test-restore-password', testRestoreSalt)
  })

  afterEach(() => {
    cleanup()
  })

  function renderPanelWithKey(overrides: Partial<DriveRestorePanelProps> = {}) {
    const defaultProps: DriveRestorePanelProps = {
      driveReady: false,
      driveEmail: null,
      backupFileId: null,
      syncing: false,
      setSyncing: mockSetSyncing,
      handleConnect: mockHandleConnect,
      handleDisconnect: mockHandleDisconnect,
      restoreKey: testRestoreKey,
      restoreSalt: testRestoreSalt,
      onRestored: mockOnRestored,
    }
    return render(<DriveRestorePanel {...defaultProps} {...overrides} />)
  }

  describe('Not connected state', () => {
    it('happy: not connected → "Connect Google Account" button visible, no "Restore from Drive" button, no green dot', () => {
      renderPanelWithKey({ driveReady: false })

      const connectButton = screen.getByRole('button', { name: 'Connect Google Account' })
      expect(connectButton).toBeTruthy()
      expect((connectButton as HTMLButtonElement).disabled).toBe(false)

      // Should not show green dot
      expect(screen.queryByText(/test@example.com/)).toBeFalsy()

      // Should not show Restore button
      expect(screen.queryByRole('button', { name: 'Restore from Drive' })).toBeFalsy()
    })

    it('happy: clicking "Connect Google Account" calls handleConnect', () => {
      renderPanelWithKey({ driveReady: false })

      const connectButton = screen.getByRole('button', { name: 'Connect Google Account' })
      fireEvent.click(connectButton)

      expect(mockHandleConnect).toHaveBeenCalledTimes(1)
    })

    it('busy-label: button shows "Connecting..." while syncing is true', () => {
      renderPanelWithKey({ driveReady: false, syncing: true })

      const connectButton = screen.getByRole('button', { name: 'Connecting...' })
      expect(connectButton).toBeTruthy()
      expect((connectButton as HTMLButtonElement).disabled).toBe(true)
    })
  })

  describe('Connected state', () => {
    it('happy: driveReady=true → green dot + driveEmail shown, separate "Disconnect" text-span visible, "Restore from Drive" button visible', () => {
      renderPanelWithKey({ driveReady: true, driveEmail: 'test@example.com' })

      // Green dot check via looking for connected state elements
      expect(screen.getByText('test@example.com')).toBeTruthy()

      // Disconnect text-span
      expect(screen.getByText('Disconnect')).toBeTruthy()

      // Restore button
      expect(screen.getByRole('button', { name: 'Restore from Drive' })).toBeTruthy()

      // No Connect button
      expect(screen.queryByRole('button', { name: 'Connect Google Account' })).toBeFalsy()
    })

    it('happy: clicking "Disconnect" calls handleDisconnect', () => {
      renderPanelWithKey({ driveReady: true, driveEmail: 'test@example.com' })

      const disconnectLink = screen.getByText('Disconnect')
      fireEvent.click(disconnectLink)

      expect(mockHandleDisconnect).toHaveBeenCalledTimes(1)
    })

    it('happy: backup link renders only when backupFileId is non-null and driveReady', () => {
      // No link when no backupFileId
      renderPanelWithKey({ driveReady: true, driveEmail: 'test@example.com', backupFileId: null })
      expect(screen.queryByRole('link', { name: 'View backup in Google Drive' })).toBeFalsy()
      cleanup()

      // Link appears when backupFileId exists
      renderPanelWithKey({ driveReady: true, driveEmail: 'test@example.com', backupFileId: 'file-123' })
      const link = screen.getByRole('link', { name: 'View backup in Google Drive' })
      expect(link).toBeTruthy()
      expect(link.getAttribute('href')).toBe('https://drive.google.com/file/d/file-123/view')
      expect(link.getAttribute('target')).toBe('_blank')
    })

    it('busy-label: restore button shows "Restoring..." while syncing is true', () => {
      renderPanelWithKey({ driveReady: true, driveEmail: 'test@example.com', syncing: true })

      const restoreButton = screen.getByRole('button', { name: 'Restoring...' })
      expect(restoreButton).toBeTruthy()
      expect((restoreButton as HTMLButtonElement).disabled).toBe(true)
    })
  })

  describe('Restore backup flow', () => {
    beforeEach(() => {
      vi.mocked(global.confirm).mockReturnValue(true)
    })

    it('happy: restoreBackup(restoreKey) resolves a state → onRestored(state, restoreKey, restoreSalt) called once, no cross-password prompt shown', async () => {
      const restoredState = initialState()
      restoredState.accounts = [
        {
          id: '1',
          accountNumber: '123',
          name: 'Test Account',
          institution: 'Test Bank',
          taxCategory: 'taxable',
          retirement: false,
          createdAt: '2024-01-01',
        },
      ]

      vi.mocked(driveModule.restoreBackup).mockResolvedValue(restoredState)

      renderPanelWithKey({ driveReady: true, driveEmail: 'test@example.com' })

      const restoreButton = screen.getByRole('button', { name: 'Restore from Drive' })
      fireEvent.click(restoreButton)

      await waitFor(() => {
        expect(global.confirm).toHaveBeenCalledWith(
          'Restore will replace all data with the backed-up version. Continue?'
        )
        expect(driveModule.restoreBackup).toHaveBeenCalledWith(testRestoreKey)
        expect(mockOnRestored).toHaveBeenCalledWith(restoredState, testRestoreKey, testRestoreSalt)
        expect(mockOnRestored).toHaveBeenCalledTimes(1)
      })

      // No cross-password prompt should be shown
      expect(
        screen.queryByText('This backup was saved with a different encryption password. Enter that password to restore:')
      ).toBeFalsy()
    })

    it('edge: restoreBackup resolves null → paste fallback appears; pasting a file ID and loading successfully calls onRestored', async () => {
      const restoredState = initialState()
      vi.mocked(driveModule.restoreBackup).mockResolvedValue(null)
      vi.mocked(driveModule.extractDriveFileId).mockReturnValue('file-id-123')
      vi.mocked(driveModule.restoreBackupFromFileId).mockResolvedValue(restoredState)

      renderPanelWithKey({ driveReady: true, driveEmail: 'test@example.com' })

      fireEvent.click(screen.getByRole('button', { name: 'Restore from Drive' }))

      const pasteInput = await screen.findByPlaceholderText('Paste Google Drive file link or ID')
      expect(pasteInput).toBeTruthy()

      fireEvent.change(pasteInput, { target: { value: 'https://drive.google.com/file/d/file-id-123/view' } })
      fireEvent.click(screen.getByRole('button', { name: 'Load file' }))

      await waitFor(() => {
        expect(driveModule.extractDriveFileId).toHaveBeenCalledWith('https://drive.google.com/file/d/file-id-123/view')
        expect(driveModule.restoreBackupFromFileId).toHaveBeenCalledWith('file-id-123', testRestoreKey)
        expect(mockOnRestored).toHaveBeenCalledWith(restoredState, testRestoreKey, testRestoreSalt)
      })

      expect(global.alert).toHaveBeenCalledWith('Restored from Drive')
    })

    it('error: restoreBackup throws DriveDecryptError → inline password prompt appears (not window.confirm, not full gate)', async () => {
      const backupSalt = generateSalt()
      const backupState = initialState()
      const envelope = await encryptState(backupState, testRestoreKey, backupSalt)
      vi.mocked(driveModule.restoreBackup).mockRejectedValue(
        new driveModule.DriveDecryptError('backup encrypted with a different password', backupSalt, envelope)
      )

      renderPanelWithKey({ driveReady: true, driveEmail: 'test@example.com' })

      const restoreButton = screen.getByRole('button', { name: 'Restore from Drive' })
      fireEvent.click(restoreButton)

      await waitFor(() => {
        expect(
          screen.getByText('This backup was saved with a different encryption password. Enter that password to restore:')
        ).toBeTruthy()
      })

      // Only the initial "Restore will replace..." confirm ran to trigger the restore
      expect(global.confirm).toHaveBeenCalledTimes(1)
    })

    it('error → happy: submitting the cross-password prompt with the correct password calls onRestored(state, retryKey, promptSalt) and closes the prompt', async () => {
      const backupPassword = 'correct-backup-password'
      const backupSalt = generateSalt()
      const backupKey = await deriveKey(backupPassword, backupSalt)
      const restoredState = initialState()
      restoredState.accounts = [
        {
          id: 'acc1',
          accountNumber: '999',
          name: 'Backup Account',
          institution: 'Test Bank',
          taxCategory: 'taxable',
          retirement: false,
          createdAt: '2024-01-01',
        },
      ]
      const envelope = await encryptState(restoredState, backupKey, backupSalt)
      vi.mocked(driveModule.restoreBackup).mockRejectedValue(
        new driveModule.DriveDecryptError('backup encrypted with a different password', backupSalt, envelope)
      )

      const { container } = renderPanelWithKey({ driveReady: true, driveEmail: 'test@example.com' })

      const restoreButton = screen.getByRole('button', { name: 'Restore from Drive' })
      fireEvent.click(restoreButton)

      await waitFor(() => {
        expect(screen.getByText(/This backup was saved with a different encryption password/)).toBeTruthy()
      })

      const passwordInputs = Array.from(container.querySelectorAll('input[type="password"]')) as HTMLInputElement[]
      fireEvent.change(passwordInputs[0], { target: { value: backupPassword } })
      fireEvent.click(screen.getByRole('button', { name: 'Restore with this password' }))

      await waitFor(() => {
        // The onRestored should be called with the retryKey and the prompt's salt
        expect(mockOnRestored).toHaveBeenCalled()
        const callArgs = mockOnRestored.mock.calls[0]
        expect(callArgs[0]).toEqual(restoredState)
        expect(callArgs[2]).toEqual(backupSalt)
      })

      // Prompt should be closed
      expect(screen.queryByText(/This backup was saved with a different encryption password/)).toBeFalsy()
    })

    it('error → error: wrong password on the cross-password prompt shows "Incorrect encryption password" and keeps the prompt open (retryable), and reveals the paste fallback', async () => {
      const backupSalt = generateSalt()
      const restoredState = initialState()
      const envelope = await encryptState(restoredState, testRestoreKey, backupSalt)
      vi.mocked(driveModule.restoreBackup).mockRejectedValue(
        new driveModule.DriveDecryptError('backup encrypted with a different password', backupSalt, envelope)
      )

      const { container } = renderPanelWithKey({ driveReady: true, driveEmail: 'test@example.com' })

      const restoreButton = screen.getByRole('button', { name: 'Restore from Drive' })
      fireEvent.click(restoreButton)

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
      expect(mockOnRestored).not.toHaveBeenCalled()

      // Paste fallback should now be visible
      expect(screen.getByPlaceholderText('Paste Google Drive file link or ID')).toBeTruthy()
    })
  })

  describe('Paste URL fallback chaining', () => {
    beforeEach(() => {
      vi.mocked(global.confirm).mockReturnValue(true)
    })

    it('error → error: pasting a file ID that also fails to decrypt shows blank password field (not pre-filled)', async () => {
      const backupSalt1 = generateSalt()
      const backupState = initialState()
      const envelope1 = await encryptState(backupState, testRestoreKey, backupSalt1)
      vi.mocked(driveModule.restoreBackup).mockRejectedValue(
        new driveModule.DriveDecryptError('backup encrypted with a different password', backupSalt1, envelope1)
      )

      // First wrong password attempt
      // Then pasting a file ID that also fails with a different salt/envelope
      const backupSalt2 = generateSalt()
      const envelope2 = await encryptState(backupState, testRestoreKey, backupSalt2)
      vi.mocked(driveModule.extractDriveFileId).mockReturnValue('file-id-b')
      vi.mocked(driveModule.restoreBackupFromFileId).mockRejectedValue(
        new driveModule.DriveDecryptError('backup encrypted with a different password', backupSalt2, envelope2)
      )

      const { container } = renderPanelWithKey({ driveReady: true, driveEmail: 'test@example.com' })

      const restoreButton = screen.getByRole('button', { name: 'Restore from Drive' })
      fireEvent.click(restoreButton)

      await waitFor(() => {
        expect(screen.getByText(/This backup was saved with a different encryption password/)).toBeTruthy()
      })

      // Submit wrong password
      const passwordInputs = Array.from(container.querySelectorAll('input[type="password"]')) as HTMLInputElement[]
      fireEvent.change(passwordInputs[0], { target: { value: 'first-wrong-password' } })
      fireEvent.click(screen.getByRole('button', { name: 'Restore with this password' }))

      await waitFor(() => {
        expect(screen.getByText('Incorrect encryption password')).toBeTruthy()
      })

      // Click fallback and paste a file ID
      const pasteInput = screen.getByPlaceholderText('Paste Google Drive file link or ID')
      fireEvent.change(pasteInput, { target: { value: 'file-id-b' } })
      fireEvent.click(screen.getByRole('button', { name: 'Load file' }))

      // Wait for the new cross-password prompt (from the pasted file's envelope)
      await waitFor(() => {
        expect(driveModule.restoreBackupFromFileId).toHaveBeenCalledWith('file-id-b', expect.anything())
      })

      // The old error should be cleared
      expect(screen.queryByText('Incorrect encryption password')).toBeFalsy()

      // A fresh password prompt should be shown
      await waitFor(() => {
        expect(screen.getByText(/This backup was saved with a different encryption password/)).toBeTruthy()
      })

      // The password input should be blank (not pre-filled with the failed attempt)
      const updatedPasswordInputs = Array.from(container.querySelectorAll('input[type="password"]')) as HTMLInputElement[]
      expect(updatedPasswordInputs[0].value).toBe('')
    })

    it('edge: pasting invalid input from crossPasswordError fallback shows error message', async () => {
      const backupSalt = generateSalt()
      const restoredState = initialState()
      const envelope = await encryptState(restoredState, testRestoreKey, backupSalt)
      vi.mocked(driveModule.restoreBackup).mockRejectedValue(
        new driveModule.DriveDecryptError('backup encrypted with a different password', backupSalt, envelope)
      )
      vi.mocked(driveModule.extractDriveFileId).mockReturnValue(null) // invalid input

      const { container } = renderPanelWithKey({ driveReady: true, driveEmail: 'test@example.com' })

      const restoreButton = screen.getByRole('button', { name: 'Restore from Drive' })
      fireEvent.click(restoreButton)

      await waitFor(() => {
        expect(screen.getByText(/This backup was saved with a different encryption password/)).toBeTruthy()
      })

      // Submit wrong password to trigger fallback
      const passwordInputs = Array.from(container.querySelectorAll('input[type="password"]')) as HTMLInputElement[]
      fireEvent.change(passwordInputs[0], { target: { value: 'wrong-password' } })
      fireEvent.click(screen.getByRole('button', { name: 'Restore with this password' }))

      await waitFor(() => {
        expect(screen.getByText('Incorrect encryption password')).toBeTruthy()
      })

      // Try to paste invalid input
      const pasteInput = screen.getByPlaceholderText('Paste Google Drive file link or ID')
      fireEvent.change(pasteInput, { target: { value: 'not-a-valid-id' } })
      fireEvent.click(screen.getByRole('button', { name: 'Load file' }))

      // Should show an error message
      await waitFor(() => {
        expect(screen.getByText("Couldn't find a file ID in that link")).toBeTruthy()
      })

      // Nothing should have changed: error still there, no dispatch, no alert
      expect(screen.getByText('Incorrect encryption password')).toBeTruthy()
      expect(screen.getByText(/This backup was saved with a different encryption password/)).toBeTruthy()
      expect(mockOnRestored).not.toHaveBeenCalled()
      expect(driveModule.restoreBackupFromFileId).not.toHaveBeenCalled()
      expect(global.alert).not.toHaveBeenCalled()
    })

    it('edge: confirm declined on paste → no restoreBackupFromFileId call', async () => {
      vi.mocked(driveModule.restoreBackup).mockResolvedValue(null)
      vi.mocked(driveModule.extractDriveFileId).mockReturnValue('file-id-123')

      // First confirm is accepted (to get to the paste fallback)
      // Second confirm is declined (when pasting a file)
      vi.mocked(global.confirm).mockReturnValueOnce(true).mockReturnValueOnce(false)

      renderPanelWithKey({ driveReady: true, driveEmail: 'test@example.com' })

      fireEvent.click(screen.getByRole('button', { name: 'Restore from Drive' }))
      const pasteInput = await screen.findByPlaceholderText('Paste Google Drive file link or ID')
      fireEvent.change(pasteInput, { target: { value: 'https://drive.google.com/file/d/file-id-123/view' } })
      fireEvent.click(screen.getByRole('button', { name: 'Load file' }))

      await waitFor(() => {
        expect(global.confirm).toHaveBeenCalledTimes(2)
        expect(driveModule.restoreBackupFromFileId).not.toHaveBeenCalled()
        expect(mockOnRestored).not.toHaveBeenCalled()
      })
    })

    it('edge: shows error when pasting garbage in the paste fallback', async () => {
      vi.mocked(driveModule.restoreBackup).mockResolvedValue(null)
      vi.mocked(driveModule.extractDriveFileId).mockReturnValue(null)

      renderPanelWithKey({ driveReady: true, driveEmail: 'test@example.com' })

      fireEvent.click(screen.getByRole('button', { name: 'Restore from Drive' }))
      const pasteInput = await screen.findByPlaceholderText('Paste Google Drive file link or ID')
      fireEvent.change(pasteInput, { target: { value: 'invalid' } })
      fireEvent.click(screen.getByRole('button', { name: 'Load file' }))

      await waitFor(() => {
        expect(screen.getByText("Couldn't find a file ID in that link")).toBeTruthy()
      })
      expect(driveModule.restoreBackupFromFileId).not.toHaveBeenCalled()
      expect(mockOnRestored).not.toHaveBeenCalled()
    })
  })

  describe('Syncing state', () => {
    it('calls setSyncing(true) then setSyncing(false) around a restore', async () => {
      vi.mocked(global.confirm).mockReturnValue(true)
      const restoredState = initialState()
      vi.mocked(driveModule.restoreBackup).mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(restoredState), 20))
      )

      renderPanelWithKey({ driveReady: true, driveEmail: 'test@example.com' })

      const restoreButton = screen.getByRole('button', { name: 'Restore from Drive' })
      fireEvent.click(restoreButton)

      await waitFor(() => {
        expect(mockSetSyncing).toHaveBeenCalledWith(true)
      })
      await waitFor(() => {
        expect(mockSetSyncing).toHaveBeenCalledWith(false)
      })
    })
  })

  describe('Error handling', () => {
    it('shows error alert if Restore fails with a generic error', async () => {
      vi.mocked(global.confirm).mockReturnValue(true)
      const error = new Error('Restore error')
      vi.mocked(driveModule.restoreBackup).mockRejectedValue(error)

      renderPanelWithKey({ driveReady: true, driveEmail: 'test@example.com' })

      const restoreButton = screen.getByRole('button', { name: 'Restore from Drive' })
      fireEvent.click(restoreButton)

      await waitFor(() => {
        expect(global.alert).toHaveBeenCalledWith('Restore failed: Restore error')
      })
    })
  })
})
