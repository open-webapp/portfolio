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

const mockProjectFn = vi.fn(() => mockFakeProject)

vi.mock('@open-webapp/drive-sync', () => ({
  createDriveSync: () => ({ project: (projectId: string) => mockProjectFn(projectId) }),
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

// The project id categoryDrive.ts's file I/O must be scoped to — same id
// `driveAuth` (from getDriveAuthFor(testPortfolio)) is authenticated under,
// per driveAuthProjectIdFor(testPortfolio) (== testPortfolio.id, since it's
// not a "migrated" portfolio).
const testProjectId = testPortfolio.id

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

    mockProjectFn.mockClear()
  })

  it('scopes legacyDriveSync.project(...) to the given projectId — regression for the "categories never sync" bug where file I/O ran under a project id different from the one `driveAuth` was authenticated under, so drive-sync (tokens keyed by (appId, projectId)) never found a valid token', async () => {
    mockFilesList.mockResolvedValue([])
    await pullGlobalCategoriesFromDrive(driveAuth, testProjectId)
    expect(mockProjectFn).toHaveBeenCalledWith(testProjectId)
  })

  describe('pullGlobalCategoriesFromDrive', () => {
    it('returns null when no file exists yet', async () => {
      mockFilesList.mockResolvedValue([])
      const result = await pullGlobalCategoriesFromDrive(driveAuth, testProjectId)
      expect(result).toBeNull()
      expect(mockFilesRead).not.toHaveBeenCalled()
    })

    it('returns the parsed GlobalCategoryState for valid JSON content', async () => {
      const state: GlobalCategoryState = {
        categories: [{ id: 'cat-1', name: 'Food', updatedAt: '2026-01-01T00:00:00Z' }],
        categoryMappings: [{ id: 'map-1', substring: 'starbucks', spendExpenseId: 'exp-1', updatedAt: '2026-01-01T00:00:00Z' }],
        budgetAccountRules: [{ id: 'rule-1', accountId: 'account-1', sign: 'negative' }],
      }
      mockFilesList.mockResolvedValue([{ id: 'file-1', name: 'category-mappings.json' }])
      mockFilesRead.mockResolvedValue(JSON.stringify(state))

      const result = await pullGlobalCategoriesFromDrive(driveAuth, testProjectId)
      expect(result).toEqual(state)
      expect(mockFilesRead).toHaveBeenCalledWith('file-1')
    })

    it('defaults budgetAccountRules for an older Drive file', async () => {
      const oldState = { categories: [], categoryMappings: [] }
      mockFilesList.mockResolvedValue([{ id: 'file-1', name: 'category-mappings.json' }])
      mockFilesRead.mockResolvedValue(JSON.stringify(oldState))

      await expect(pullGlobalCategoriesFromDrive(driveAuth, testProjectId)).resolves.toEqual({
        ...oldState,
        budgetAccountRules: [],
      })
    })

    it('drops malformed budgetAccountRules entries while retaining rule objects', async () => {
      mockFilesList.mockResolvedValue([{ id: 'file-1', name: 'category-mappings.json' }])
      mockFilesRead.mockResolvedValue(JSON.stringify({
        categories: [],
        categoryMappings: [],
        budgetAccountRules: [{ id: 'rule-1' }, null, 'not a rule', 42, []],
      }))

      await expect(pullGlobalCategoriesFromDrive(driveAuth, testProjectId)).resolves.toEqual({
        categories: [],
        categoryMappings: [],
        budgetAccountRules: [{ id: 'rule-1' }],
      })
    })

    it('returns null (not thrown) for malformed JSON content', async () => {
      mockFilesList.mockResolvedValue([{ id: 'file-1', name: 'category-mappings.json' }])
      mockFilesRead.mockResolvedValue('{not valid json')

      const result = await pullGlobalCategoriesFromDrive(driveAuth, testProjectId)
      expect(result).toBeNull()
    })

    it('returns null (not thrown) for well-formed JSON with the wrong shape', async () => {
      mockFilesList.mockResolvedValue([{ id: 'file-1', name: 'category-mappings.json' }])
      mockFilesRead.mockResolvedValue(JSON.stringify({ foo: 'bar' }))

      const result = await pullGlobalCategoriesFromDrive(driveAuth, testProjectId)
      expect(result).toBeNull()
    })

    it('propagates a rejected ensureFresh() uncaught', async () => {
      vi.mocked(driveAuth.ensureFresh).mockRejectedValue(new Error('connection boom'))
      await expect(pullGlobalCategoriesFromDrive(driveAuth, testProjectId)).rejects.toThrow('connection boom')
      expect(mockFilesList).not.toHaveBeenCalled()
    })
  })

  describe('pushGlobalCategoriesToDrive', () => {
    const state: GlobalCategoryState = {
      categories: [{ id: 'cat-1', name: 'Food', updatedAt: '2026-01-01T00:00:00Z' }],
      categoryMappings: [],
      budgetAccountRules: [{ id: 'rule-1', accountId: 'account-1', sign: 'negative' }],
    }

    it('writes with no fileId when no existing file is found (create path)', async () => {
      mockFilesList.mockResolvedValue([])
      mockFilesWrite.mockResolvedValue({ id: 'new-file' })

      await pushGlobalCategoriesToDrive(driveAuth, testProjectId, state)

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

      await pushGlobalCategoriesToDrive(driveAuth, testProjectId, state)

      expect(mockFilesWrite).toHaveBeenCalledWith(
        expect.objectContaining({ fileId: 'existing-file' })
      )
    })

    it('propagates a rejected ensureFresh() uncaught', async () => {
      vi.mocked(driveAuth.ensureFresh).mockRejectedValue(new Error('connection boom'))
      await expect(pushGlobalCategoriesToDrive(driveAuth, testProjectId, state)).rejects.toThrow('connection boom')
      expect(mockFilesList).not.toHaveBeenCalled()
    })
  })

  describe('getGlobalCategoriesModifiedTime', () => {
    it('returns null when the file does not exist', async () => {
      mockFilesList.mockResolvedValue([])
      const result = await getGlobalCategoriesModifiedTime(driveAuth, testProjectId)
      expect(result).toBeNull()
      expect(mockFilesStatus).not.toHaveBeenCalled()
    })

    it('returns the modifiedTime string from the metadata call when the file is present', async () => {
      mockFilesList.mockResolvedValue([{ id: 'file-1', name: 'category-mappings.json' }])
      mockFilesStatus.mockResolvedValue({ exists: true, remoteModifiedTime: '2026-09-14T12:00:00Z' })

      const result = await getGlobalCategoriesModifiedTime(driveAuth, testProjectId)
      expect(result).toBe('2026-09-14T12:00:00Z')
      expect(mockFilesStatus).toHaveBeenCalledWith('file-1')
    })

    it('propagates a rejected ensureFresh() uncaught', async () => {
      vi.mocked(driveAuth.ensureFresh).mockRejectedValue(new Error('connection boom'))
      await expect(getGlobalCategoriesModifiedTime(driveAuth, testProjectId)).rejects.toThrow('connection boom')
      expect(mockFilesList).not.toHaveBeenCalled()
    })
  })
})
