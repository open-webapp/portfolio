import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { useDriveConnection } from '@open-webapp/drive-connect'
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
    project: (_id: string) => {
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

// Mock @open-webapp/drive-connect — connection state is driven per-test via
// vi.mocked(useDriveConnection).mockReturnValue(...). Connect/disconnect UI and
// its behavior now live in the package and are tested there.
vi.mock('@open-webapp/drive-connect', () => ({
  useDriveConnection: vi.fn(),
  GoogleDriveWidget: () => null,
  createDriveAuth: vi.fn(),
}))

// Mock window.alert and window.confirm
global.alert = vi.fn()
global.confirm = vi.fn()

const mockSetSyncing = vi.fn()
const mockOnRestored = vi.fn()

function makeAuth() {
  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
    ensureFresh: vi.fn(),
    activate: vi.fn(() => () => {}),
  }
}

let mockAuth: ReturnType<typeof makeAuth>

function setConnection({ connected = false, connecting = false }: { connected?: boolean; connecting?: boolean } = {}) {
  vi.mocked(useDriveConnection).mockReturnValue({
    connected,
    email: null,
    connecting,
    error: null,
    needsReauth: false,
  } as unknown as ReturnType<typeof useDriveConnection>)
}

describe('DriveRestorePanel', () => {
  let testRestoreKey: CryptoKey
  let testRestoreSalt: Uint8Array

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.stubEnv('VITE_GOOGLE_PICKER_API_KEY', 'test-api-key')
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '308299244860-abc.apps.googleusercontent.com')
    vi.stubEnv('VITE_GOOGLE_PROJECT_NUMBER', '')

    mockAuth = makeAuth()
    setConnection({ connected: false })

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
      auth: mockAuth as unknown as DriveRestorePanelProps['auth'],
      backupFileId: null,
      syncing: false,
      setSyncing: mockSetSyncing,
      restoreKey: testRestoreKey,
      restoreSalt: testRestoreSalt,
      onRestored: mockOnRestored,
    }
    return render(<DriveRestorePanel {...defaultProps} {...overrides} />)
  }

  describe('Gating on connection state', () => {
    it('gating: connected=false → no "Restore from Drive" button and no backup link even with backupFileId', () => {
      setConnection({ connected: false })
      renderPanelWithKey({ backupFileId: 'file-123' })

      expect(screen.queryByRole('button', { name: 'Restore from Drive' })).toBeFalsy()
      expect(screen.queryByRole('link', { name: 'View backup in Google Drive' })).toBeFalsy()
    })

    it('happy: connected=true → "Restore from Drive" button visible', () => {
      setConnection({ connected: true })
      renderPanelWithKey()

      expect(screen.getByRole('button', { name: 'Restore from Drive' })).toBeTruthy()
    })

    it('edge: connected=true + backupFileId set → backup link renders with correct href', () => {
      setConnection({ connected: true })
      renderPanelWithKey({ backupFileId: 'file-123' })

      const link = screen.getByRole('link', { name: 'View backup in Google Drive' })
      expect(link.getAttribute('href')).toBe('https://drive.google.com/file/d/file-123/view')
      expect(link.getAttribute('target')).toBe('_blank')
    })

    it('regression: connecting=true from the hook does NOT disable the Restore button', () => {
      setConnection({ connected: true, connecting: true })
      renderPanelWithKey()

      const restoreButton = screen.getByRole('button', { name: 'Restore from Drive' })
      expect((restoreButton as HTMLButtonElement).disabled).toBe(false)
    })

    it('busy-label: restore button shows "Restoring..." while syncing is true', () => {
      setConnection({ connected: true })
      renderPanelWithKey({ syncing: true })

      const restoreButton = screen.getByRole('button', { name: 'Restoring...' })
      expect((restoreButton as HTMLButtonElement).disabled).toBe(true)
    })
  })

  describe('Restore with file picker flow', () => {
    beforeEach(() => {
      setConnection({ connected: true })
      vi.mocked(global.confirm).mockReturnValue(true)
    })

    it('happy: clicking "Restore from Drive" opens file picker', async () => {
      mockPickFile.mockResolvedValue(null)

      renderPanelWithKey()

      fireEvent.click(screen.getByRole('button', { name: 'Restore from Drive' }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Pick a file' })).toBeTruthy()
      })
    })

    it('happy: user clicks "Pick a file" button → pickFile called', async () => {
      mockPickFile.mockResolvedValue(null)

      renderPanelWithKey()

      fireEvent.click(screen.getByRole('button', { name: 'Restore from Drive' }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Pick a file' })).toBeTruthy()
      })

      fireEvent.click(screen.getByRole('button', { name: 'Pick a file' }))

      await waitFor(() => {
        expect(mockPickFile).toHaveBeenCalled()
      })
    })

    it('happy: pickFile returns file → confirm → restoreBackupFromFileId → onRestored → alert("Restored from Drive")', async () => {
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

      renderPanelWithKey()

      fireEvent.click(screen.getByRole('button', { name: 'Restore from Drive' }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Pick a file' })).toBeTruthy()
      })

      fireEvent.click(screen.getByRole('button', { name: 'Pick a file' }))

      await waitFor(() => {
        expect(global.confirm).toHaveBeenCalledWith(
          'Restore will replace all data with the backed-up version. Continue?'
        )
      })

      await waitFor(() => {
        expect(driveModule.restoreBackupFromFileId).toHaveBeenCalledWith('file-123', testRestoreKey)
        expect(mockOnRestored).toHaveBeenCalledWith(restoredState, testRestoreKey, testRestoreSalt)
      })

      expect(global.alert).toHaveBeenCalledWith('Restored from Drive')
    })

    it('edge: user selects file then declines confirm → no restore', async () => {
      vi.mocked(global.confirm).mockReturnValue(false)
      mockPickFile.mockResolvedValue({ id: 'file-123', name: 'backup.json' })

      renderPanelWithKey()

      fireEvent.click(screen.getByRole('button', { name: 'Restore from Drive' }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Pick a file' })).toBeTruthy()
      })

      fireEvent.click(screen.getByRole('button', { name: 'Pick a file' }))

      await waitFor(() => {
        expect(global.confirm).toHaveBeenCalled()
      })

      expect(driveModule.restoreBackupFromFileId).not.toHaveBeenCalled()
      expect(mockOnRestored).not.toHaveBeenCalled()
    })

    it('edge: pickFile returns null (user cancels) → no-op, can click Restore again to reopen', async () => {
      mockPickFile.mockResolvedValue(null)

      renderPanelWithKey()

      fireEvent.click(screen.getByRole('button', { name: 'Restore from Drive' }))

      let pickBtn = await screen.findByRole('button', { name: 'Pick a file' })
      expect(pickBtn).toBeTruthy()

      fireEvent.click(pickBtn)

      await waitFor(() => {
        expect(mockPickFile).toHaveBeenCalledTimes(1)
      })

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: 'Pick a file' })).toBeFalsy()
      })

      fireEvent.click(screen.getByRole('button', { name: 'Restore from Drive' }))

      pickBtn = await screen.findByRole('button', { name: 'Pick a file' })
      expect(pickBtn).toBeTruthy()

      fireEvent.click(pickBtn)

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

      renderPanelWithKey()

      fireEvent.click(screen.getByRole('button', { name: 'Restore from Drive' }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Pick a file' })).toBeTruthy()
      })

      fireEvent.click(screen.getByRole('button', { name: 'Pick a file' }))

      await waitFor(() => {
        expect(global.confirm).toHaveBeenCalled()
      })

      await waitFor(() => {
        expect(
          screen.getByText('This backup was saved with a different encryption password. Enter that password to restore:')
        ).toBeTruthy()
      })
    })

    it('error: restore throws a non-DriveDecryptError (NeedsReauthError) → alert shown, no crash', async () => {
      const error = new Error('session expired')
      error.name = 'NeedsReauthError'
      mockPickFile.mockResolvedValue({ id: 'file-123', name: 'backup.json' })
      vi.mocked(driveModule.restoreBackupFromFileId).mockRejectedValue(error)

      renderPanelWithKey()

      fireEvent.click(screen.getByRole('button', { name: 'Restore from Drive' }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Pick a file' })).toBeTruthy()
      })

      fireEvent.click(screen.getByRole('button', { name: 'Pick a file' }))

      await waitFor(() => {
        expect(global.confirm).toHaveBeenCalled()
      })

      await waitFor(() => {
        expect(global.alert).toHaveBeenCalledWith('Restore failed: session expired')
      })
    })

    it('error: restore throws a plain Error → alert shown, no crash', async () => {
      const error = new Error('File permission denied')
      mockPickFile.mockResolvedValue({ id: 'file-123', name: 'backup.json' })
      vi.mocked(driveModule.restoreBackupFromFileId).mockRejectedValue(error)

      renderPanelWithKey()

      fireEvent.click(screen.getByRole('button', { name: 'Restore from Drive' }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Pick a file' })).toBeTruthy()
      })

      fireEvent.click(screen.getByRole('button', { name: 'Pick a file' }))

      await waitFor(() => {
        expect(global.alert).toHaveBeenCalledWith('Restore failed: File permission denied')
      })
    })

    it('error: pickFile throws error → error message shown', async () => {
      mockPickFile.mockRejectedValue(new Error('File picker not available'))

      renderPanelWithKey()

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
    beforeEach(() => {
      setConnection({ connected: true })
      vi.mocked(global.confirm).mockReturnValue(true)
    })

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

      const { container } = renderPanelWithKey()

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

      const passwordInputs = Array.from(container.querySelectorAll('input[type="password"]')) as HTMLInputElement[]
      fireEvent.change(passwordInputs[0], { target: { value: backupPassword } })
      fireEvent.click(screen.getByRole('button', { name: 'Restore with this password' }))

      await waitFor(() => {
        expect(mockOnRestored).toHaveBeenCalled()
        const callArgs = mockOnRestored.mock.calls[0]
        expect(callArgs[0]).toEqual(restoredState)
        expect(callArgs[2]).toEqual(backupSalt)
      })

      expect(screen.queryByText(/This backup was saved with a different encryption password/)).toBeFalsy()
    })

    it('error: wrong password on cross-password prompt → error shown, prompt stays open, single fallback picker', async () => {
      const backupSalt = generateSalt()
      const restoredState = initialState()
      const envelope = await encryptState(restoredState, testRestoreKey, backupSalt)

      mockPickFile.mockResolvedValue({ id: 'file-123', name: 'backup.json' })
      vi.mocked(driveModule.restoreBackupFromFileId).mockRejectedValue(
        new driveModule.DriveDecryptError('backup encrypted with a different password', backupSalt, envelope)
      )

      const { container } = renderPanelWithKey()

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

      const passwordInputs = Array.from(container.querySelectorAll('input[type="password"]')) as HTMLInputElement[]
      fireEvent.change(passwordInputs[0], { target: { value: 'totally-wrong-password' } })
      fireEvent.click(screen.getByRole('button', { name: 'Restore with this password' }))

      await waitFor(() => {
        expect(screen.getByText('Incorrect encryption password')).toBeTruthy()
      })

      expect(screen.getByText(/This backup was saved with a different encryption password/)).toBeTruthy()
      expect(mockOnRestored).not.toHaveBeenCalled()
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

      renderPanelWithKey()

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

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(screen.queryByText(/This backup was saved with a different encryption password/)).toBeFalsy()
    })
  })
})
