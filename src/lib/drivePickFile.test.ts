import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * The wrapper in drive.ts adapts drive-sync's pickFile for DriveRestorePanel.
 * Two behaviours it must get right, neither of which drive-sync provides:
 *
 * 1. drive-sync drops `includeFolders` on the way to openPicker, so a picker
 *    opened without a parent folder can never reach a backup that lives in a
 *    nested folder. The wrapper must scope the picker to the app folder.
 * 2. Cancelling the picker rejects with PickerCancelledError. That is a no-op,
 *    not a failure, and must surface as `null`.
 */

class PickerCancelledError extends Error {
  constructor() {
    super('Picker cancelled')
    this.name = 'PickerCancelledError'
  }
}

const mockPickFile = vi.fn()
const mockEnsureFolderPath = vi.fn()

vi.mock('@open-webapp/drive-sync', () => ({
  createDriveSync: () => ({
    project: () => ({
      pickFile: mockPickFile,
      ensureFolderPath: mockEnsureFolderPath,
    }),
  }),
  NeedsReauthError: class NeedsReauthError extends Error {},
  PickerCancelledError,
}))

const { drive } = await import('./drive')

describe('drive.project().pickFile', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_GOOGLE_PICKER_API_KEY', 'test-api-key')
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '308299244860-abc.apps.googleusercontent.com')
    vi.stubEnv('VITE_GOOGLE_PROJECT_NUMBER', '')
    mockPickFile.mockReset()
    mockEnsureFolderPath.mockReset()
    mockEnsureFolderPath.mockResolvedValue('folder-portfolio')
  })

  it('scopes the picker to the app backup folder so nested backups are reachable', async () => {
    mockPickFile.mockResolvedValue([
      { fileId: 'file-1', name: 'portfolio-state.json', mimeType: 'application/json' },
    ])

    const file = await drive.project('app').pickFile({ includeFolders: true })

    expect(file).toEqual({
      id: 'file-1',
      name: 'portfolio-state.json',
      mimeType: 'application/json',
    })

    const passed = mockPickFile.mock.calls[0][0]
    // The whole point: without this the backup is unreachable in the picker.
    expect(passed.parentFolderId).toBe('folder-portfolio')
    expect(passed.apiKey).toBe('test-api-key')
    expect(passed.appId).toBe('308299244860')
  })

  it('honours an explicit parentFolderId instead of resolving the app folder', async () => {
    mockPickFile.mockResolvedValue([])

    await drive.project('app').pickFile({ parentFolderId: 'explicit-folder' })

    expect(mockPickFile.mock.calls[0][0].parentFolderId).toBe('explicit-folder')
    expect(mockEnsureFolderPath).not.toHaveBeenCalled()
  })

  it('returns null when the user cancels instead of surfacing an error', async () => {
    mockPickFile.mockRejectedValue(new PickerCancelledError())

    await expect(drive.project('app').pickFile({ includeFolders: true })).resolves.toBeNull()
  })

  it('still propagates genuine picker failures', async () => {
    mockPickFile.mockRejectedValue(new Error('The API developer key is invalid'))

    await expect(drive.project('app').pickFile({ includeFolders: true })).rejects.toThrow(
      'The API developer key is invalid',
    )
  })
})
