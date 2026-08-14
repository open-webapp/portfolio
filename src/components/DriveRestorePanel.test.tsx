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
    openDrivePicker: vi.fn(),
    getDriveConnection: vi.fn(),
    getAccessTokenForPicker: vi.fn(),
    restoreBackupFromFileId: vi.fn(),
    restoreBackup: vi.fn(),
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

describe('DriveRestorePanel', () => {
  let testRestoreKey: CryptoKey
  let testRestoreSalt: Uint8Array

  beforeEach(async () => {
    vi.clearAllMocks()
    testRestoreSalt = generateSalt()
    testRestoreKey = await deriveKey('test-restore-password', testRestoreSalt)

    // Default mock for getAccessTokenForPicker
    vi.mocked(driveModule.getAccessTokenForPicker as any).mockResolvedValue('mock-token')
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

  describe('Restore with Picker flow', () => {
    beforeEach(() => {
      vi.mocked(global.confirm).mockReturnValue(true)
    })

    it('happy: opening Picker immediately on "Restore from Drive" click — no by-name lookup call', async () => {
      vi.mocked(driveModule.openDrivePicker).mockImplementation(async (_token, _onSelect, _onCancel) => {
        // Picker opened successfully
      })

      renderPanelWithKey({ driveReady: true, driveEmail: 'test@example.com' })

      // Click "Restore from Drive"
      fireEvent.click(screen.getByRole('button', { name: 'Restore from Drive' }))

      // Picker should open immediately
      await waitFor(() => {
        expect(driveModule.openDrivePicker).toHaveBeenCalled()
      })

      // Verify getAccessTokenForPicker was called to get token
      expect(driveModule.getAccessTokenForPicker).toHaveBeenCalled()
    })

    it('happy: user selects file from Picker → confirm → restore succeeds → onRestored called', async () => {
      const mockConnection = { accessToken: 'mock-token' }
      vi.mocked(driveModule.getDriveConnection).mockResolvedValue(mockConnection as any)

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

      let pickerSelectCallback: ((fileId: string) => void) | null = null
      vi.mocked(driveModule.openDrivePicker).mockImplementation(async (_token, onSelect, _onCancel) => {
        pickerSelectCallback = onSelect
      })
      vi.mocked(driveModule.restoreBackupFromFileId).mockResolvedValue(restoredState)

      renderPanelWithKey({ driveReady: true, driveEmail: 'test@example.com' })

      fireEvent.click(screen.getByRole('button', { name: 'Restore from Drive' }))

      await waitFor(() => {
        expect(driveModule.openDrivePicker).toHaveBeenCalled()
      })

      // Simulate Picker calling onSelect callback
      if (pickerSelectCallback) {
        pickerSelectCallback('file-123')
      }

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
      const mockConnection = { accessToken: 'mock-token' }
      vi.mocked(driveModule.getDriveConnection).mockResolvedValue(mockConnection as any)

      vi.mocked(global.confirm).mockReturnValue(false)

      let pickerSelectCallback: ((fileId: string) => void) | null = null
      vi.mocked(driveModule.openDrivePicker).mockImplementation(async (_token, onSelect, _onCancel) => {
        pickerSelectCallback = onSelect
      })

      renderPanelWithKey({ driveReady: true, driveEmail: 'test@example.com' })

      fireEvent.click(screen.getByRole('button', { name: 'Restore from Drive' }))

      await waitFor(() => {
        expect(driveModule.openDrivePicker).toHaveBeenCalled()
      })

      if (pickerSelectCallback) {
        pickerSelectCallback('file-123')
      }

      await waitFor(() => {
        expect(global.confirm).toHaveBeenCalled()
      })

      // Restore should NOT be called since user declined
      expect(driveModule.restoreBackupFromFileId).not.toHaveBeenCalled()
      expect(mockOnRestored).not.toHaveBeenCalled()
    })

    it('edge: user cancels Picker → no-op, can click Restore again to reopen', async () => {
      const mockConnection = { accessToken: 'mock-token' }
      vi.mocked(driveModule.getDriveConnection).mockResolvedValue(mockConnection as any)

      let pickerCancelCallback: (() => void) | null = null
      vi.mocked(driveModule.openDrivePicker).mockImplementation(async (_token, _onSelect, onCancel) => {
        pickerCancelCallback = onCancel
      })

      renderPanelWithKey({ driveReady: true, driveEmail: 'test@example.com' })

      // First click
      fireEvent.click(screen.getByRole('button', { name: 'Restore from Drive' }))

      await waitFor(() => {
        expect(driveModule.openDrivePicker).toHaveBeenCalled()
      })

      // User cancels Picker
      if (pickerCancelCallback) {
        pickerCancelCallback()
      }

      // Should be able to click again
      vi.clearAllMocks()
      vi.mocked(driveModule.getDriveConnection).mockResolvedValue(mockConnection as any)
      vi.mocked(driveModule.openDrivePicker).mockImplementation(async (_token, _onSelect, onCancel) => {
        pickerCancelCallback = onCancel
      })

      fireEvent.click(screen.getByRole('button', { name: 'Restore from Drive' }))

      await waitFor(() => {
        expect(driveModule.openDrivePicker).toHaveBeenCalledTimes(1)
      })
    })

    it('error: restore from picked file throws DriveDecryptError → cross-password prompt shown', async () => {
      const mockConnection = { accessToken: 'mock-token' }
      vi.mocked(driveModule.getDriveConnection).mockResolvedValue(mockConnection as any)

      const backupSalt = generateSalt()
      const backupState = initialState()
      const envelope = await encryptState(backupState, testRestoreKey, backupSalt)

      let pickerSelectCallback: ((fileId: string) => void) | null = null
      vi.mocked(driveModule.openDrivePicker).mockImplementation(async (_token, onSelect, _onCancel) => {
        pickerSelectCallback = onSelect
      })
      vi.mocked(driveModule.restoreBackupFromFileId).mockRejectedValue(
        new driveModule.DriveDecryptError('backup encrypted with a different password', backupSalt, envelope)
      )

      renderPanelWithKey({ driveReady: true, driveEmail: 'test@example.com' })

      fireEvent.click(screen.getByRole('button', { name: 'Restore from Drive' }))

      await waitFor(() => {
        expect(driveModule.openDrivePicker).toHaveBeenCalled()
      })

      if (pickerSelectCallback) {
        pickerSelectCallback('file-123')
      }

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

    it('error → happy: cross-password prompt with correct password → restore succeeds', async () => {
      const mockConnection = { accessToken: 'mock-token' }
      vi.mocked(driveModule.getDriveConnection).mockResolvedValue(mockConnection as any)

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

      let pickerSelectCallback: ((fileId: string) => void) | null = null
      vi.mocked(driveModule.openDrivePicker).mockImplementation(async (_token, onSelect, _onCancel) => {
        pickerSelectCallback = onSelect
      })
      vi.mocked(driveModule.restoreBackupFromFileId).mockRejectedValue(
        new driveModule.DriveDecryptError('backup encrypted with a different password', backupSalt, envelope)
      )

      const { container } = renderPanelWithKey({ driveReady: true, driveEmail: 'test@example.com' })

      fireEvent.click(screen.getByRole('button', { name: 'Restore from Drive' }))

      await waitFor(() => {
        expect(driveModule.openDrivePicker).toHaveBeenCalled()
      })

      if (pickerSelectCallback) {
        pickerSelectCallback('file-123')
      }

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

    it('error → error: wrong password on cross-password prompt → error shown, prompt stays open', async () => {
      const mockConnection = { accessToken: 'mock-token' }
      vi.mocked(driveModule.getDriveConnection).mockResolvedValue(mockConnection as any)

      const backupSalt = generateSalt()
      const restoredState = initialState()
      const envelope = await encryptState(restoredState, testRestoreKey, backupSalt)

      let pickerSelectCallback: ((fileId: string) => void) | null = null
      vi.mocked(driveModule.openDrivePicker).mockImplementation(async (_token, onSelect, _onCancel) => {
        pickerSelectCallback = onSelect
      })
      vi.mocked(driveModule.restoreBackupFromFileId).mockRejectedValue(
        new driveModule.DriveDecryptError('backup encrypted with a different password', backupSalt, envelope)
      )

      const { container } = renderPanelWithKey({ driveReady: true, driveEmail: 'test@example.com' })

      fireEvent.click(screen.getByRole('button', { name: 'Restore from Drive' }))

      await waitFor(() => {
        expect(driveModule.openDrivePicker).toHaveBeenCalled()
      })

      if (pickerSelectCallback) {
        pickerSelectCallback('file-123')
      }

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
    })

    it('error: restore from picked file throws generic error → alert shown', async () => {
      const mockConnection = { accessToken: 'mock-token' }
      vi.mocked(driveModule.getDriveConnection).mockResolvedValue(mockConnection as any)

      const error = new Error('File permission denied')
      let pickerSelectCallback: ((fileId: string) => void) | null = null
      vi.mocked(driveModule.openDrivePicker).mockImplementation(async (_token, onSelect, _onCancel) => {
        pickerSelectCallback = onSelect
      })
      vi.mocked(driveModule.restoreBackupFromFileId).mockRejectedValue(error)

      renderPanelWithKey({ driveReady: true, driveEmail: 'test@example.com' })

      fireEvent.click(screen.getByRole('button', { name: 'Restore from Drive' }))

      await waitFor(() => {
        expect(driveModule.openDrivePicker).toHaveBeenCalled()
      })

      if (pickerSelectCallback) {
        pickerSelectCallback('file-123')
      }

      await waitFor(() => {
        expect(global.confirm).toHaveBeenCalled()
      })

      await waitFor(() => {
        expect(global.alert).toHaveBeenCalledWith('Restore failed: File permission denied')
      })
    })

    it('multiple Picker open/cancel cycles → state resets properly', async () => {
      const mockConnection = { accessToken: 'mock-token' }
      vi.mocked(driveModule.getDriveConnection).mockResolvedValue(mockConnection as any)

      let pickerCancelCallback: (() => void) | null = null
      vi.mocked(driveModule.openDrivePicker).mockImplementation(async (_token, _onSelect, onCancel) => {
        pickerCancelCallback = onCancel
      })

      renderPanelWithKey({ driveReady: true, driveEmail: 'test@example.com' })

      // First cycle
      fireEvent.click(screen.getByRole('button', { name: 'Restore from Drive' }))
      await waitFor(() => {
        expect(driveModule.openDrivePicker).toHaveBeenCalledTimes(1)
      })

      if (pickerCancelCallback) {
        pickerCancelCallback()
      }

      // Second cycle
      fireEvent.click(screen.getByRole('button', { name: 'Restore from Drive' }))
      await waitFor(() => {
        expect(driveModule.openDrivePicker).toHaveBeenCalledTimes(2)
      })

      if (pickerCancelCallback) {
        pickerCancelCallback()
      }

      // Third cycle
      fireEvent.click(screen.getByRole('button', { name: 'Restore from Drive' }))
      await waitFor(() => {
        expect(driveModule.openDrivePicker).toHaveBeenCalledTimes(3)
      })
    })
  })

  describe('Syncing state', () => {
    it('calls setSyncing(true) then setSyncing(false) around a restore', async () => {
      const mockConnection = { accessToken: 'mock-token' }
      vi.mocked(driveModule.getDriveConnection).mockResolvedValue(mockConnection as any)
      vi.mocked(global.confirm).mockReturnValue(true)

      const restoredState = initialState()
      vi.mocked(driveModule.restoreBackupFromFileId).mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(restoredState), 20))
      )

      let pickerSelectCallback: ((fileId: string) => void) | null = null
      vi.mocked(driveModule.openDrivePicker).mockImplementation(async (_token, onSelect, _onCancel) => {
        pickerSelectCallback = onSelect
      })

      renderPanelWithKey({ driveReady: true, driveEmail: 'test@example.com' })

      fireEvent.click(screen.getByRole('button', { name: 'Restore from Drive' }))

      await waitFor(() => {
        expect(driveModule.openDrivePicker).toHaveBeenCalled()
      })

      if (pickerSelectCallback) {
        pickerSelectCallback('file-123')
      }

      await waitFor(() => {
        expect(mockSetSyncing).toHaveBeenCalledWith(true)
      })
      await waitFor(() => {
        expect(mockSetSyncing).toHaveBeenCalledWith(false)
      })
    })
  })

  describe('Error handling', () => {
    it('error: getAccessTokenForPicker fails → error message shown in Picker fallback', async () => {
      vi.mocked(driveModule.getAccessTokenForPicker as any).mockRejectedValue(
        new Error('Failed to get access token')
      )

      renderPanelWithKey({ driveReady: true, driveEmail: 'test@example.com' })

      fireEvent.click(screen.getByRole('button', { name: 'Restore from Drive' }))

      await waitFor(() => {
        expect(screen.getByText(/Failed to open file picker/)).toBeTruthy()
      })

      // openDrivePicker should NOT have been called
      expect(driveModule.openDrivePicker).not.toHaveBeenCalled()
    })

    it('error: openDrivePicker throws → error message shown in Picker fallback', async () => {
      vi.mocked(driveModule.openDrivePicker).mockRejectedValue(
        new Error('VITE_GOOGLE_PICKER_API_KEY is not set')
      )

      renderPanelWithKey({ driveReady: true, driveEmail: 'test@example.com' })

      fireEvent.click(screen.getByRole('button', { name: 'Restore from Drive' }))

      await waitFor(() => {
        expect(screen.getByText(/Failed to open file picker/)).toBeTruthy()
      })
    })
  })

  describe('Cross-password prompt cancel button', () => {
    it('happy: clicking cancel on cross-password prompt closes it', async () => {
      const mockConnection = { accessToken: 'mock-token' }
      vi.mocked(driveModule.getDriveConnection).mockResolvedValue(mockConnection as any)

      const backupSalt = generateSalt()
      const restoredState = initialState()
      const envelope = await encryptState(restoredState, testRestoreKey, backupSalt)

      let pickerSelectCallback: ((fileId: string) => void) | null = null
      vi.mocked(driveModule.openDrivePicker).mockImplementation(async (_token, onSelect, _onCancel) => {
        pickerSelectCallback = onSelect
      })
      vi.mocked(driveModule.restoreBackupFromFileId).mockRejectedValue(
        new driveModule.DriveDecryptError('backup encrypted with a different password', backupSalt, envelope)
      )

      renderPanelWithKey({ driveReady: true, driveEmail: 'test@example.com' })

      fireEvent.click(screen.getByRole('button', { name: 'Restore from Drive' }))

      await waitFor(() => {
        expect(driveModule.openDrivePicker).toHaveBeenCalled()
      })

      if (pickerSelectCallback) {
        pickerSelectCallback('file-123')
      }

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
