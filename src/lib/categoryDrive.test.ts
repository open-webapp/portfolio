import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { GlobalCategoryState } from './categoryStore'

// ---------------------------------------------------------------------------
// Hand-faked `project.files` harness, same pattern as drive.test.ts's
// `mockFakeProject` (mock*-prefixed fns closed over by the hoisted vi.mock
// factories below).
// ---------------------------------------------------------------------------
const mockFilesList = vi.fn()
const mockFilesRead = vi.fn()
const mockFilesWrite = vi.fn()
const mockFilesStatus = vi.fn()
const mockEnsureFolderPath = vi.fn()

const mockFakeProject = {
  files: {
    list: mockFilesList,
    read: mockFilesRead,
    write: mockFilesWrite,
    status: mockFilesStatus,
  },
  ensureFolderPath: mockEnsureFolderPath,
}

vi.mock('@open-webapp/drive-connect', async () => {
  const actual = await vi.importActual<typeof import('@open-webapp/drive-connect')>(
    '@open-webapp/drive-connect'
  )
  return {
    ...actual,
    createDriveAuth: vi.fn(() => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
      ensureFresh: vi.fn(),
      activate: vi.fn(() => () => {}),
    })),
  }
})

vi.mock('@open-webapp/drive-sync', () => ({
  createDriveSync: () => ({ project: () => mockFakeProject }),
  NeedsReauthError: class NeedsReauthError extends Error {},
  PickerCancelledError: class PickerCancelledError extends Error {},
  RemoteChangedError: class RemoteChangedError extends Error {},
}))

import {
  pullGlobalCategoriesFromDrive,
  pushGlobalCategoriesToDrive,
  getGlobalCategoriesModifiedTime,
} from './categoryDrive'
import { getDriveAuthFor } from './drive'
import type { Portfolio } from './types'

const testPortfolio: Portfolio = {
  id: 'port-test',
  name: 'Test Portfolio',
  dbName: 'portfolio_app_state_v1-port-test',
  createdAt: 1,
}

describe('categoryDrive', () => {
  let driveAuth: ReturnType<typeof getDriveAuthFor>

  beforeEach(() => {
    mockFilesList.mockReset()
    mockFilesRead.mockReset()
    mockFilesWrite.mockReset()
    mockFilesStatus.mockReset()
    mockEnsureFolderPath.mockReset()
    mockEnsureFolderPath.mockResolvedValue('folder-1')

    driveAuth = getDriveAuthFor(testPortfolio)
    vi.mocked(driveAuth.ensureFresh).mockReset()
    vi.mocked(driveAuth.ensureFresh).mockResolvedValue({
      email: 'user@example.com',
      needsReauth: false,
      expiresAt: Date.now() + 60 * 60 * 1000,
    } as never)
  })

  describe('pullGlobalCategoriesFromDrive', () => {
    it('returns null when no file exists yet', async () => {
      mockFilesList.mockResolvedValue([])
      const result = await pullGlobalCategoriesFromDrive(driveAuth)
      expect(result).toBeNull()
      expect(mockFilesRead).not.toHaveBeenCalled()
    })

    it('returns the parsed GlobalCategoryState for valid JSON content', async () => {
      const state: GlobalCategoryState = {
        categories: [{ id: 'cat-1', name: 'Food', updatedAt: '2026-01-01T00:00:00Z' }],
        categoryMappings: [{ id: 'map-1', substring: 'starbucks', categoryId: 'cat-1', updatedAt: '2026-01-01T00:00:00Z' }],
      }
      mockFilesList.mockResolvedValue([{ id: 'file-1', name: 'category-mappings.json' }])
      mockFilesRead.mockResolvedValue(JSON.stringify(state))

      const result = await pullGlobalCategoriesFromDrive(driveAuth)
      expect(result).toEqual(state)
      expect(mockFilesRead).toHaveBeenCalledWith('file-1')
    })

    it('returns null (not thrown) for malformed JSON content', async () => {
      mockFilesList.mockResolvedValue([{ id: 'file-1', name: 'category-mappings.json' }])
      mockFilesRead.mockResolvedValue('{not valid json')

      const result = await pullGlobalCategoriesFromDrive(driveAuth)
      expect(result).toBeNull()
    })

    it('returns null (not thrown) for well-formed JSON with the wrong shape', async () => {
      mockFilesList.mockResolvedValue([{ id: 'file-1', name: 'category-mappings.json' }])
      mockFilesRead.mockResolvedValue(JSON.stringify({ foo: 'bar' }))

      const result = await pullGlobalCategoriesFromDrive(driveAuth)
      expect(result).toBeNull()
    })

    it('propagates a rejected ensureFresh() uncaught', async () => {
      vi.mocked(driveAuth.ensureFresh).mockRejectedValue(new Error('connection boom'))
      await expect(pullGlobalCategoriesFromDrive(driveAuth)).rejects.toThrow('connection boom')
      expect(mockFilesList).not.toHaveBeenCalled()
    })
  })

  describe('pushGlobalCategoriesToDrive', () => {
    const state: GlobalCategoryState = {
      categories: [{ id: 'cat-1', name: 'Food', updatedAt: '2026-01-01T00:00:00Z' }],
      categoryMappings: [],
    }

    it('writes with no fileId when no existing file is found (create path)', async () => {
      mockFilesList.mockResolvedValue([])
      mockFilesWrite.mockResolvedValue({ id: 'new-file' })

      await pushGlobalCategoriesToDrive(driveAuth, state)

      expect(mockFilesWrite).toHaveBeenCalledWith(
        expect.objectContaining({
          fileId: undefined,
          folderId: 'folder-1',
          name: 'category-mappings.json',
          content: JSON.stringify(state),
          mimeType: 'application/json',
        })
      )
    })

    it('writes with the existing fileId when a file is already present (update path)', async () => {
      mockFilesList.mockResolvedValue([{ id: 'existing-file', name: 'category-mappings.json' }])
      mockFilesWrite.mockResolvedValue({ id: 'existing-file' })

      await pushGlobalCategoriesToDrive(driveAuth, state)

      expect(mockFilesWrite).toHaveBeenCalledWith(
        expect.objectContaining({ fileId: 'existing-file' })
      )
    })

    it('propagates a rejected ensureFresh() uncaught', async () => {
      vi.mocked(driveAuth.ensureFresh).mockRejectedValue(new Error('connection boom'))
      await expect(pushGlobalCategoriesToDrive(driveAuth, state)).rejects.toThrow('connection boom')
      expect(mockFilesList).not.toHaveBeenCalled()
    })
  })

  describe('getGlobalCategoriesModifiedTime', () => {
    it('returns null when the file does not exist', async () => {
      mockFilesList.mockResolvedValue([])
      const result = await getGlobalCategoriesModifiedTime(driveAuth)
      expect(result).toBeNull()
      expect(mockFilesStatus).not.toHaveBeenCalled()
    })

    it('returns the modifiedTime string from the metadata call when the file is present', async () => {
      mockFilesList.mockResolvedValue([{ id: 'file-1', name: 'category-mappings.json' }])
      mockFilesStatus.mockResolvedValue({ exists: true, remoteModifiedTime: '2026-09-14T12:00:00Z' })

      const result = await getGlobalCategoriesModifiedTime(driveAuth)
      expect(result).toBe('2026-09-14T12:00:00Z')
      expect(mockFilesStatus).toHaveBeenCalledWith('file-1')
    })

    it('propagates a rejected ensureFresh() uncaught', async () => {
      vi.mocked(driveAuth.ensureFresh).mockRejectedValue(new Error('connection boom'))
      await expect(getGlobalCategoriesModifiedTime(driveAuth)).rejects.toThrow('connection boom')
      expect(mockFilesList).not.toHaveBeenCalled()
    })
  })
})
