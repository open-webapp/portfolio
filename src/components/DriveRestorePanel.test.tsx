import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { DriveRestorePanel, type DriveRestorePanelProps } from './DriveRestorePanel'
import { initialState } from '../lib/state'
import * as driveModule from '../lib/drive'
import { deriveKey, generateSalt, encryptState } from '../lib/crypto'

// Create mock functions
const mockPickFile = vi.fn()
const mockEnsureFolderPath = vi.fn()

// Mock the drive module
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

  const mockDrive = {
    ...actual.drive,
    project: (id: string) => {
      // Return fresh mock objects that reference the outer scope mocks
      return {
        pickFile: mockPickFile,
        ensureFolderPath: mockEnsureFolderPath,
      }
    },
  }

  return {
    ...actual,
    drive: mockDrive,
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

describe('DriveRestorePanel', () => {
  let testRestoreKey: CryptoKey
  let testRestoreSalt: Uint8Array

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.stubEnv('VITE_GOOGLE_PICKER_API_KEY', 'test-api-key')
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '308299244860-abc.apps.googleusercontent.com')
    vi.stubEnv('VITE_GOOGLE_PROJECT_NUMBER', '')

    testRestoreSalt = generateSalt()
    testRestoreKey = await deriveKey('test-restore-password', testRestoreSalt)

    // Default mocks for drive.project()
    mockPickFile.mockResolvedValue(null)
    mockEnsureFolderPath.mockResolvedValue('folder-portfolio')

    // Setup spy on restoreBackupFromFileId with a default implementation
    vi.spyOn(driveModule, 'restoreBackupFromFileId').mockResolvedValue(initialState())
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

  describe('Restore with file picker flow', () => {
    beforeEach(() => {
      vi.mocked(global.confirm).mockReturnValue(true)
    })

    it('happy: clicking "Restore from Drive" opens file picker', async () => {
      mockPickFile.mockResolvedValue(null)

      renderPanelWithKey({ driveReady: true, driveEmail: 'test@example.com' })

      // Click "Restore from Drive"
      fireEvent.click(screen.getByRole('button', { name: 'Restore from Drive' }))

      // File picker dialog should appear with "Pick a file" button
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Pick a file' })).toBeTruthy()
      })
    })

    it('happy: user clicks "Pick a file" button → pickFile called', async () => {
      mockPickFile.mockResolvedValue(null)

      renderPanelWithKey({ driveReady: true, driveEmail: 'test@example.com' })

      fireEvent.click(screen.getByRole('button', { name: 'Restore from Drive' }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Pick a file' })).toBeTruthy()
      })

      fireEvent.click(screen.getByRole('button', { name: 'Pick a file' }))

      await waitFor(() => {
        expect(mockPickFile).toHaveBeenCalled()
      })
    })

    it('happy: pickFile returns file → restore succeeds → onRestored called', async () => {
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

      mockPickFile.mockResolvedValue({ id: 'file-123', name: 'backup.json' })
      vi.mocked(driveModule.restoreBackupFromFileId).mockResolvedValue(restoredState)

      renderPanelWithKey({ driveReady: true, driveEmail: 'test@example.com' })

      fireEvent.click(screen.getByRole('button', { name: 'Restore from Drive' }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Pick a file' })).toBeTruthy()
      })

      fireEvent.click(screen.getByRole('button', { name: 'Pick a file' }))

      // User confirms
      await waitFor(() => {
        expect(global.confirm).toHaveBeenCalledWith(
          'Restore will replace all data with the backed-up version. Continue?'
        )
      })

      // Restore should be called
      await waitFor(() => {
        expect(driveModule.restoreBackupFromFileId).toHaveBeenCalledWith('file-123', testRestoreKey)
        expect(mockOnRestored).toHaveBeenCalledWith(restoredState, testRestoreKey, testRestoreSalt)
      })

      // Should show success alert
      expect(global.alert).toHaveBeenCalledWith('Restored from Drive')
    })

    it('edge: user selects file then declines confirm → no restore', async () => {
      vi.mocked(global.confirm).mockReturnValue(false)
      mockPickFile.mockResolvedValue({ id: 'file-123', name: 'backup.json' })

      renderPanelWithKey({ driveReady: true, driveEmail: 'test@example.com' })

      fireEvent.click(screen.getByRole('button', { name: 'Restore from Drive' }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Pick a file' })).toBeTruthy()
      })

      fireEvent.click(screen.getByRole('button', { name: 'Pick a file' }))

      await waitFor(() => {
        expect(global.confirm).toHaveBeenCalled()
      })

      // Restore should NOT be called since user declined
      expect(driveModule.restoreBackupFromFileId).not.toHaveBeenCalled()
      expect(mockOnRestored).not.toHaveBeenCalled()
    })

    it('edge: pickFile returns null (user cancels) → no-op, can click Restore again to reopen', async () => {
      mockPickFile.mockResolvedValue(null)

      renderPanelWithKey({ driveReady: true, driveEmail: 'test@example.com' })

      // First restore click
      fireEvent.click(screen.getByRole('button', { name: 'Restore from Drive' }))

      // Wait for picker dialog to appear
      let pickBtn = await screen.findByRole('button', { name: 'Pick a file' })
      expect(pickBtn).toBeTruthy()

      // Click to open file picker (returns null, triggering onCancel)
      fireEvent.click(pickBtn)

      // Wait for the first picker call
      await waitFor(() => {
        expect(mockPickFile).toHaveBeenCalledTimes(1)
      })

      // The "Pick a file" button should still exist, so click Restore again to close/reopen
      // Actually, after cancel, the dialog should close, so the button disappears
      await waitFor(() => {
        expect(screen.queryByRole('button', { name: 'Pick a file' })).toBeFalsy()
      })

      // Second restore click - should show picker again
      fireEvent.click(screen.getByRole('button', { name: 'Restore from Drive' }))

      // Should see Pick a file button again
      pickBtn = await screen.findByRole('button', { name: 'Pick a file' })
      expect(pickBtn).toBeTruthy()

      // Click Pick a file again
      fireEvent.click(pickBtn)

      // Wait for second call to pickFile
      await waitFor(() => {
        expect(mockPickFile).toHaveBeenCalledTimes(2)
      })
    })

    it('error: restore from picked file throws DriveDecryptError → cross-password prompt shown', async () => {
      const backupSalt = generateSalt()
      const backupState = initialState()
      const envelope = await encryptState(backupState, testRestoreKey, backupSalt)

      mockPickFile.mockResolvedValue({ id: 'file-123', name: 'backup.json' })
      vi.mocked(driveModule.restoreBackupFromFileId).mockRejectedValue(
        new driveModule.DriveDecryptError('backup encrypted with a different password', backupSalt, envelope)
      )

      renderPanelWithKey({ driveReady: true, driveEmail: 'test@example.com' })

      fireEvent.click(screen.getByRole('button', { name: 'Restore from Drive' }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Pick a file' })).toBeTruthy()
      })

      fireEvent.click(screen.getByRole('button', { name: 'Pick a file' }))

      // Confirm the restore
      await waitFor(() => {
        expect(global.confirm).toHaveBeenCalled()
      })

      // Cross-password prompt should appear
      await waitFor(() => {
        expect(
          screen.getByText('This backup was saved with a different encryption password. Enter that password to restore:')
        ).toBeTruthy()
      })
    })

    it('error: restore from picked file throws generic error → alert shown', async () => {
      const error = new Error('File permission denied')
      mockPickFile.mockResolvedValue({ id: 'file-123', name: 'backup.json' })
      vi.mocked(driveModule.restoreBackupFromFileId).mockRejectedValue(error)

      renderPanelWithKey({ driveReady: true, driveEmail: 'test@example.com' })

      fireEvent.click(screen.getByRole('button', { name: 'Restore from Drive' }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Pick a file' })).toBeTruthy()
      })

      fireEvent.click(screen.getByRole('button', { name: 'Pick a file' }))

      await waitFor(() => {
        expect(global.confirm).toHaveBeenCalled()
      })

      await waitFor(() => {
        expect(global.alert).toHaveBeenCalledWith('Restore failed: File permission denied')
      })
    })

    it('error: pickFile throws error → error message shown', async () => {
      mockPickFile.mockRejectedValue(new Error('File picker not available'))

      renderPanelWithKey({ driveReady: true, driveEmail: 'test@example.com' })

      fireEvent.click(screen.getByRole('button', { name: 'Restore from Drive' }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Pick a file' })).toBeTruthy()
      })

      fireEvent.click(screen.getByRole('button', { name: 'Pick a file' }))

      await waitFor(() => {
        expect(screen.getByText(/Failed to open file picker/)).toBeTruthy()
      })
    })
  })

  describe('Cross-password prompt', () => {
    it('happy: cross-password prompt with correct password → restore succeeds', async () => {
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

      mockPickFile.mockResolvedValue({ id: 'file-123', name: 'backup.json' })
      vi.mocked(driveModule.restoreBackupFromFileId).mockRejectedValue(
        new driveModule.DriveDecryptError('backup encrypted with a different password', backupSalt, envelope)
      )

      const { container } = renderPanelWithKey({ driveReady: true, driveEmail: 'test@example.com' })

      fireEvent.click(screen.getByRole('button', { name: 'Restore from Drive' }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Pick a file' })).toBeTruthy()
      })

      fireEvent.click(screen.getByRole('button', { name: 'Pick a file' }))

      await waitFor(() => {
        expect(global.confirm).toHaveBeenCalled()
      })

      await waitFor(() => {
        expect(screen.getByText(/This backup was saved with a different encryption password/)).toBeTruthy()
      })

      // Enter password
      const passwordInputs = Array.from(container.querySelectorAll('input[type="password"]')) as HTMLInputElement[]
      fireEvent.change(passwordInputs[0], { target: { value: backupPassword } })
      fireEvent.click(screen.getByRole('button', { name: 'Restore with this password' }))

      await waitFor(() => {
        expect(mockOnRestored).toHaveBeenCalled()
        const callArgs = mockOnRestored.mock.calls[0]
        expect(callArgs[0]).toEqual(restoredState)
        expect(callArgs[2]).toEqual(backupSalt)
      })

      // Prompt should be closed
      expect(screen.queryByText(/This backup was saved with a different encryption password/)).toBeFalsy()
    })

    it('error: wrong password on cross-password prompt → error shown, prompt stays open', async () => {
      const backupSalt = generateSalt()
      const restoredState = initialState()
      const envelope = await encryptState(restoredState, testRestoreKey, backupSalt)

      mockPickFile.mockResolvedValue({ id: 'file-123', name: 'backup.json' })
      vi.mocked(driveModule.restoreBackupFromFileId).mockRejectedValue(
        new driveModule.DriveDecryptError('backup encrypted with a different password', backupSalt, envelope)
      )

      const { container } = renderPanelWithKey({ driveReady: true, driveEmail: 'test@example.com' })

      fireEvent.click(screen.getByRole('button', { name: 'Restore from Drive' }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Pick a file' })).toBeTruthy()
      })

      fireEvent.click(screen.getByRole('button', { name: 'Pick a file' }))

      await waitFor(() => {
        expect(global.confirm).toHaveBeenCalled()
      })

      await waitFor(() => {
        expect(screen.getByText(/This backup was saved with a different encryption password/)).toBeTruthy()
      })

      // Enter wrong password
      const passwordInputs = Array.from(container.querySelectorAll('input[type="password"]')) as HTMLInputElement[]
      fireEvent.change(passwordInputs[0], { target: { value: 'totally-wrong-password' } })
      fireEvent.click(screen.getByRole('button', { name: 'Restore with this password' }))

      await waitFor(() => {
        expect(screen.getByText('Incorrect encryption password')).toBeTruthy()
      })

      // Prompt should stay open
      expect(screen.getByText(/This backup was saved with a different encryption password/)).toBeTruthy()
      expect(mockOnRestored).not.toHaveBeenCalled()

      // Only the fallback dialog's "Pick a file" button should be visible —
      // the original picker dialog must not linger underneath it.
      expect(screen.getAllByRole('button', { name: 'Pick a file' })).toHaveLength(1)
    })

    it('happy: clicking cancel on cross-password prompt closes it', async () => {
      const backupSalt = generateSalt()
      const restoredState = initialState()
      const envelope = await encryptState(restoredState, testRestoreKey, backupSalt)

      mockPickFile.mockResolvedValue({ id: 'file-123', name: 'backup.json' })
      vi.mocked(driveModule.restoreBackupFromFileId).mockRejectedValue(
        new driveModule.DriveDecryptError('backup encrypted with a different password', backupSalt, envelope)
      )

      renderPanelWithKey({ driveReady: true, driveEmail: 'test@example.com' })

      fireEvent.click(screen.getByRole('button', { name: 'Restore from Drive' }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Pick a file' })).toBeTruthy()
      })

      fireEvent.click(screen.getByRole('button', { name: 'Pick a file' }))

      await waitFor(() => {
        expect(global.confirm).toHaveBeenCalled()
      })

      await waitFor(() => {
        expect(screen.getByText(/This backup was saved with a different encryption password/)).toBeTruthy()
      })

      // Click Cancel button
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

      // Prompt should close
      expect(screen.queryByText(/This backup was saved with a different encryption password/)).toBeFalsy()
    })
  })
})
