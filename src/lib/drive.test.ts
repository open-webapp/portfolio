import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Portfolio } from './types'

// ---------------------------------------------------------------------------
// Shared fake harness for the drive conflict-reconcile work (T1 spike).
//
// T2–T4 build on this: they add files.status / files.read / files.write based
// helpers to drive.ts, and their tests reuse `mockFakeProject` + the `mock*`
// fns below (reset them in a `beforeEach`, set `.mockResolvedValue(...)` per
// case). Names are `mock`-prefixed so the hoisted `vi.mock` factory may close
// over them (same convention as drivePickFile.test.ts).
//
// ---------------------------------------------------------------------------
const mockFilesStatus = vi.fn()
const mockFilesRead = vi.fn()
const mockFilesWrite = vi.fn()
const mockFilesList = vi.fn()
const mockFilesRemove = vi.fn()
const mockEnsureFolderPath = vi.fn()
const mockPickFile = vi.fn()
const mockGetConnectionSync = vi.fn()

// Records the config every `createDriveSync(config)` call was made with, so
// tests can assert on the `folderPath` a given call resolved to (e.g. that a
// portfolio-scoped sync's folder path ends in that portfolio's `name`, not
// the legacy flat 2-level path). Reset in `beforeEach`.
const mockCreateDriveSyncCalls = vi.hoisted(
  () => [] as Array<{ folderPath?: string[]; [key: string]: unknown }>
)

// ---------------------------------------------------------------------------
// T13 opt-in switch. When `mockT13.active` is true, the two `vi.mock`
// factories below hand back a REAL `createDriveAuth` (via `vi.importActual`)
// over a hand-built fake `driveSync` (`mockT13.driveSync`), so the T13
// describe block can exercise the genuine single-`connectInFlight` popup
// guard. Every other test in this file runs with `active` false and sees the
// original fakes unchanged. `mock`-prefixed so the hoisted factories may
// close over it.
// ---------------------------------------------------------------------------
const mockT13 = vi.hoisted(() => ({ active: false, driveSync: null as any }))

const mockFakeProject = {
  files: {
    status: mockFilesStatus,
    read: mockFilesRead,
    write: mockFilesWrite,
    list: mockFilesList,
    remove: mockFilesRemove,
  },
  ensureFolderPath: mockEnsureFolderPath,
  pickFile: mockPickFile,
  getConnectionSync: mockGetConnectionSync,
}

// ---------------------------------------------------------------------------
// `@open-webapp/drive-connect` fake. `getDriveAuthFor(portfolio)` lazily
// creates + caches a `createDriveAuth(...)` handle per Drive "project id"
// (drive.ts's private `driveProjectIdFor`). Tests reach a given portfolio's
// handle by calling `getDriveAuthFor(thatPortfolio)` themselves (imported
// from ./drive) rather than a single module-level singleton.
// ---------------------------------------------------------------------------
vi.mock('@open-webapp/drive-connect', async () => {
  const actual = await vi.importActual<typeof import('@open-webapp/drive-connect')>(
    '@open-webapp/drive-connect'
  )
  return {
    ...actual,
    // Fake handle by default; the REAL `createDriveAuth` when a T13 test has
    // flipped `mockT13.active` (so its shared `connectInFlight` guard runs for
    // real over `mockT13.driveSync`).
    createDriveAuth: vi.fn((opts: any) =>
      mockT13.active
        ? (actual.createDriveAuth as (o: any) => unknown)(opts)
        : {
            connect: vi.fn(),
            disconnect: vi.fn(),
            ensureFresh: vi.fn(),
            activate: vi.fn(() => () => {}),
          }
    ),
  }
})

vi.mock('@open-webapp/drive-sync', () => ({
  createDriveSync: (config: any) => {
    mockCreateDriveSyncCalls.push(config)
    return mockT13.active ? mockT13.driveSync : { project: () => mockFakeProject }
  },
  NeedsReauthError: class NeedsReauthError extends Error {
    constructor(message?: string) {
      super(message)
      this.name = 'NeedsReauthError'
    }
  },
  PickerCancelledError: class PickerCancelledError extends Error {
    constructor(message?: string) {
      super(message)
      this.name = 'PickerCancelledError'
    }
  },
  // Real-ish: a class extends Error carrying the fields drive-sync's
  // RemoteChangedError exposes. T2–T4 construct/inspect these.
  RemoteChangedError: class RemoteChangedError extends Error {
    fileId?: string
    baseVersion?: string
    remoteVersion?: string
    reason?: 'remote-changed' | 'never-restored'
    constructor(message?: string) {
      super(message)
      this.name = 'RemoteChangedError'
    }
  },
}))

import { RemoteChangedError, NeedsReauthError } from '@open-webapp/drive-sync'
import {
  DriveDecryptError,
  DriveMalformedBackupError,
  drive,
  decryptDriveFolderBackup,
  getDriveAuthFor,
  getPickerDriveAuth,
  driveAuthProjectIdFor,
  getBackupFileId,
  getBackupFileStatus,
  getConnectionSnapshot,
  getPortfolioDriveFolderUrl,
  listPortfolioFoldersOnDrive,
  migrateLegacyDriveFolderIfNeeded,
  overwriteLocalWithRemote,
  overwriteRemoteWithLocal,
  restoreBackupFromFileId,
  syncBackup,
} from './drive'
import { encryptState, generateSalt, deriveKey } from './crypto'
import { initialState } from './state'

// ---------------------------------------------------------------------------
// Test Portfolio fixtures.
//
// `migratedPortfolio` mimics the one pre-multi-portfolio db
// (`isMigratedPortfolio` true — dbName is exactly the legacy fixed name),
// which maps to the fixed Drive project id 'app' and keeps the old flat
// folder-migration behavior. `testPortfolio` is a regular, non-migrated
// portfolio (any other dbName) used as the default fixture for the
// previously portfolio-agnostic helpers below.
// ---------------------------------------------------------------------------
const migratedPortfolio: Portfolio = {
  id: 'port-legacy-migrated',
  name: 'My Portfolio',
  dbName: 'portfolio_app_state_v1',
  createdAt: 1,
}

const testPortfolio: Portfolio = {
  id: 'port-test-primary',
  name: 'Test Portfolio',
  dbName: 'portfolio_app_state_v1-port-test-primary',
  createdAt: 2,
}

describe('conflict-reconcile helpers', () => {
  // T1 spike: prove the raw drive-sync `files` surface (status/read/write/list)
  // is reachable through the `drive` wrapper unchanged. The wrapper only
  // overrides `pickFile`, spreading everything else — so `files` must be the
  // exact same object/fns as on the raw project. T2–T4 add helpers that call
  // through these and will reuse `mockFakeProject` + the `mock*` fns above.
  beforeEach(() => {
    mockFilesStatus.mockReset()
    mockFilesRead.mockReset()
    mockFilesWrite.mockReset()
    mockFilesList.mockReset()
    mockFilesRemove.mockReset()
    mockEnsureFolderPath.mockReset()
    mockPickFile.mockReset()
    mockGetConnectionSync.mockReset()
    mockCreateDriveSyncCalls.length = 0
    // drive-connect's ensureFresh gate: default to a resolved fake connection so
    // content ops never try to open an interactive auth flow. Individual tests
    // override with mockRejectedValue to exercise the failure path.
    vi.mocked(getDriveAuthFor(testPortfolio).ensureFresh).mockReset()
    vi.mocked(getDriveAuthFor(testPortfolio).ensureFresh).mockResolvedValue({
      email: 'user@example.com',
      needsReauth: false,
      expiresAt: Date.now() + 60 * 60 * 1000,
    } as never)
  })

  it('passes files.status / files.read / files.write through the drive wrapper unshadowed', () => {
    const project = drive.project('app')

    expect(project.files.status).toBe(mockFakeProject.files.status)
    expect(project.files.read).toBe(mockFakeProject.files.read)
    expect(project.files.write).toBe(mockFakeProject.files.write)
  })

  describe('getBackupFileStatus (T2)', () => {
    it('maps the display subset from a resolved files.status', async () => {
      const restoredAt = Date.parse('2026-08-27T09:00:00Z')
      mockFilesStatus.mockResolvedValue({
        fileId: 'file-1',
        exists: true,
        baseVersion: '10',
        remoteVersion: '11',
        remoteModifiedTime: '2026-08-28T10:00:00Z',
        lastRestoredAt: restoredAt,
        changedSinceRestore: true,
      })

      const result = await getBackupFileStatus(testPortfolio, 'file-1')

      expect(mockFilesStatus).toHaveBeenCalledWith('file-1')
      expect(result).toEqual({
        exists: true,
        remoteModifiedTime: '2026-08-28T10:00:00Z',
        lastRestoredAt: restoredAt,
      })
      // The version-counter flag is deliberately not surfaced.
      expect('changedSinceRestore' in result).toBe(false)
    })

    it('leaves optional fields undefined when files.status omits them', async () => {
      mockFilesStatus.mockResolvedValue({
        exists: false,
        changedSinceRestore: false,
        lastRestoredAt: null,
      })

      const result = await getBackupFileStatus(testPortfolio, 'missing')

      expect(result.exists).toBe(false)
      expect(result.remoteModifiedTime).toBeUndefined()
      expect(result.lastRestoredAt).toBeUndefined()
    })

    it('propagates a rejected files.status (caller in App does .catch(() => null))', async () => {
      mockFilesStatus.mockRejectedValue(new Error('drive unavailable'))

      await expect(getBackupFileStatus(testPortfolio, 'file-1')).rejects.toThrow('drive unavailable')
    })
  })

  describe('overwriteLocalWithRemote (T3)', () => {
    let key: CryptoKey
    let salt: Uint8Array

    beforeEach(async () => {
      salt = generateSalt()
      key = await deriveKey('password', salt)
      // driveAuth.ensureFresh() gates the helper; the parent beforeEach already
      // resolves it to a usable fake connection.
    })

    it('reads + decrypts the remote file and returns the AppState (baseline-advance path)', async () => {
      const remoteState = {
        ...initialState(),
        accounts: [{ id: 'r1', name: 'Remote Wins', institution: '', balance: 42 }],
      }
      const envelopeJson = JSON.stringify(await encryptState(remoteState, key, salt))
      mockFilesRead.mockResolvedValue(envelopeJson)

      const result = await overwriteLocalWithRemote(testPortfolio, 'file-1', key)

      // files.read is where drive-sync advances the restore baseline.
      expect(mockFilesRead).toHaveBeenCalledWith('file-1')
      expect(result.accounts).toEqual([{ id: 'r1', name: 'Remote Wins', institution: '', balance: 42 }])
    })

    it('throws "empty or unreadable" when the read yields nothing', async () => {
      mockFilesRead.mockResolvedValue(null)
      await expect(overwriteLocalWithRemote(testPortfolio, 'file-1', key)).rejects.toThrow('Drive backup is empty or unreadable')

      mockFilesRead.mockResolvedValue('')
      await expect(overwriteLocalWithRemote(testPortfolio, 'file-1', key)).rejects.toThrow('Drive backup is empty or unreadable')
    })

    it('does not depend on files.status (resolves even in a would-be never-restored state)', async () => {
      const remoteState = {
        ...initialState(),
        accounts: [{ id: 'r2', name: 'No Status Needed', institution: '', balance: 7 }],
      }
      mockFilesRead.mockResolvedValue(JSON.stringify(await encryptState(remoteState, key, salt)))
      mockFilesStatus.mockRejectedValue(new Error('files.status must not be consulted by this path'))

      const result = await overwriteLocalWithRemote(testPortfolio, 'file-1', key)

      expect(result.accounts[0].name).toBe('No Status Needed')
      expect(mockFilesStatus).not.toHaveBeenCalled()
    })

    it('propagates DriveDecryptError when decrypt raises OperationError (wrong key)', async () => {
      const otherSalt = generateSalt()
      const otherKey = await deriveKey('different-password', otherSalt)
      const envelopeJson = JSON.stringify(await encryptState(initialState(), otherKey, otherSalt))
      mockFilesRead.mockResolvedValue(envelopeJson)

      await expect(overwriteLocalWithRemote(testPortfolio, 'file-1', key)).rejects.toThrow(DriveDecryptError)
    })
  })

  describe('overwriteRemoteWithLocal (T4)', () => {
    let key: CryptoKey
    let salt: Uint8Array
    let state: ReturnType<typeof initialState>

    beforeEach(async () => {
      salt = generateSalt()
      key = await deriveKey('password', salt)
      state = {
        ...initialState(),
        accounts: [{ id: 'l1', name: 'Local Wins', institution: '', balance: 99 }],
      }
      // driveAuth.ensureFresh() gates the helper; the parent beforeEach already
      // resolves it to a usable fake connection.
      // syncBackup's folder + list + write chain.
      mockEnsureFolderPath.mockResolvedValue('folder-1')
      mockFilesList.mockResolvedValue([{ id: 'file-1' }])
      mockFilesWrite.mockResolvedValue({ id: 'file-1' })
    })

    it('reads remote (adopts baseline) then writes local, returning the file id', async () => {
      mockFilesRead.mockResolvedValue('whatever-the-remote-holds')

      const result = await overwriteRemoteWithLocal(testPortfolio, state, key, salt, 'file-1')

      expect(result).toBe('file-1')
      expect(mockFilesRead).toHaveBeenCalledWith('file-1')
      expect(mockFilesWrite).toHaveBeenCalledTimes(1)
      // The read must land before the write — the write is diffed against the
      // baseline the read just adopted.
      const readOrder = mockFilesRead.mock.invocationCallOrder[0]
      const writeOrder = mockFilesWrite.mock.invocationCallOrder[0]
      expect(readOrder).toBeLessThan(writeOrder)
    })

    it('still proceeds to write when the baseline read yields null', async () => {
      mockFilesRead.mockResolvedValue(null)

      const result = await overwriteRemoteWithLocal(testPortfolio, state, key, salt, 'file-1')

      expect(result).toBe('file-1')
      expect(mockFilesRead).toHaveBeenCalledTimes(1)
      expect(mockFilesWrite).toHaveBeenCalledTimes(1)
    })

    it('propagates a post-read RemoteChangedError from the write without retrying', async () => {
      mockFilesRead.mockResolvedValue('remote-baseline')
      const raced = new RemoteChangedError('remote moved again')
      mockFilesWrite.mockRejectedValue(raced)

      const err = await overwriteRemoteWithLocal(testPortfolio, state, key, salt, 'file-1').catch((e) => e)

      expect(err).toBe(raced)
      expect(err.name).toBe('RemoteChangedError')
      // The error surfaces once — no retry loop after the write rejects.
      expect(mockFilesRead).toHaveBeenCalledTimes(1)
      expect(mockFilesWrite).toHaveBeenCalledTimes(1)
    })

    it('propagates a failing driveAuth.ensureFresh before any read', async () => {
      vi.mocked(getDriveAuthFor(testPortfolio).ensureFresh).mockReset()
      vi.mocked(getDriveAuthFor(testPortfolio).ensureFresh).mockRejectedValue(new Error('connection boom'))

      await expect(overwriteRemoteWithLocal(testPortfolio, state, key, salt, 'file-1')).rejects.toThrow('connection boom')
      expect(mockFilesRead).not.toHaveBeenCalled()
      expect(mockFilesWrite).not.toHaveBeenCalled()
    })
  })

  describe('getConnectionSnapshot', () => {
    it('returns the connection unchanged when connected', () => {
      const connection = { email: 'user@example.com', needsReauth: false, expiresAt: Date.now() + 60 * 60 * 1000 }
      mockGetConnectionSync.mockReturnValue(connection)

      expect(getConnectionSnapshot(testPortfolio)).toBe(connection)
    })

    it('returns null when disconnected', () => {
      mockGetConnectionSync.mockReturnValue(null)

      expect(getConnectionSnapshot(testPortfolio)).toBeNull()
    })
  })

  describe('getPortfolioDriveFolderUrl', () => {
    it('resolves to the Drive web URL built from ensureFolderPath\'s resolved folder id', async () => {
      mockEnsureFolderPath.mockResolvedValue('folder-abc')

      const url = await getPortfolioDriveFolderUrl(testPortfolio)

      expect(url).toBe('https://drive.google.com/drive/folders/folder-abc')
    })

    it('scopes the folder lookup to the given portfolio (per-portfolio, not global)', async () => {
      mockEnsureFolderPath.mockResolvedValue('folder-xyz')

      await getPortfolioDriveFolderUrl(migratedPortfolio)

      const portfolioFolderCalls = mockCreateDriveSyncCalls.filter(
        (c) => Array.isArray(c.folderPath) && c.folderPath.length === 3
      )
      const lastCall = portfolioFolderCalls[portfolioFolderCalls.length - 1]
      expect(lastCall.folderPath).toEqual(['OpenWebApp', 'Portfolio', migratedPortfolio.name])
    })

    it('propagates an ensureFolderPath rejection without swallowing it', async () => {
      mockEnsureFolderPath.mockRejectedValue(new Error('folder lookup boom'))

      await expect(getPortfolioDriveFolderUrl(testPortfolio)).rejects.toThrow('folder lookup boom')
    })
  })

  describe('getDriveAuthFor caching/isolation', () => {
    it('returns the SAME handle across repeated calls for the same portfolio', () => {
      const a1 = getDriveAuthFor(testPortfolio)
      const a2 = getDriveAuthFor(testPortfolio)

      expect(a1).toBe(a2)
    })

    it('returns DIFFERENT handles for two distinct non-migrated portfolios', () => {
      const portfolioA: Portfolio = {
        id: 'port-iso-a',
        name: 'Iso A',
        dbName: 'portfolio_app_state_v1-port-iso-a',
        createdAt: 10,
      }
      const portfolioB: Portfolio = {
        id: 'port-iso-b',
        name: 'Iso B',
        dbName: 'portfolio_app_state_v1-port-iso-b',
        createdAt: 11,
      }

      const authA = getDriveAuthFor(portfolioA)
      const authB = getDriveAuthFor(portfolioB)

      expect(authA).not.toBe(authB)
    })

    it('two differently-shaped portfolio objects that are both "migrated" (same legacy dbName, different id) share ONE cached handle', () => {
      const migratedShapeOne: Portfolio = {
        id: 'port-legacy-one',
        name: 'My Portfolio',
        dbName: 'portfolio_app_state_v1',
        createdAt: 20,
      }
      const migratedShapeTwo: Portfolio = {
        id: 'port-legacy-two',
        name: 'My Portfolio (renamed)',
        dbName: 'portfolio_app_state_v1',
        createdAt: 21,
      }

      const authOne = getDriveAuthFor(migratedShapeOne)
      const authTwo = getDriveAuthFor(migratedShapeTwo)

      // Both map to the fixed 'app' project id, so they must resolve to the
      // exact same cached auth handle despite differing `id`/`name`.
      expect(authOne).toBe(authTwo)
    })
  })

  describe('driveAuthProjectIdFor', () => {
    it('resolves the SAME project id getDriveAuthFor(portfolio) authenticates under — regression for the "categories never sync" bug: categoryDrive.ts\'s legacyDriveSync.project(...) file I/O must be scoped to whichever project id the given driveAuth was actually authenticated under (drive-sync stores tokens keyed by (appId, projectId)), not a fixed id of its own that nothing ever connect()s', () => {
      expect(driveAuthProjectIdFor(testPortfolio)).toBe(testPortfolio.id)
    })

    it('resolves the fixed "app" id for a migrated portfolio, matching getDriveAuthFor', () => {
      const migratedPortfolio: Portfolio = {
        id: 'port-legacy-cat',
        name: 'My Portfolio',
        dbName: 'portfolio_app_state_v1',
        createdAt: 30,
      }
      expect(driveAuthProjectIdFor(migratedPortfolio)).toBe('app')
    })
  })

  describe('per-portfolio Drive folder path', () => {
    it("a regular portfolio's sync resolves a folderPath ending in that portfolio's name", async () => {
      mockEnsureFolderPath.mockResolvedValue('folder-1')
      mockFilesList.mockResolvedValue([])

      await getBackupFileId(testPortfolio)

      const portfolioFolderCalls = mockCreateDriveSyncCalls.filter(
        (c) => Array.isArray(c.folderPath) && c.folderPath.length === 3
      )
      expect(portfolioFolderCalls.length).toBeGreaterThan(0)
      const lastCall = portfolioFolderCalls[portfolioFolderCalls.length - 1]
      expect(lastCall.folderPath).toEqual(['OpenWebApp', 'Portfolio', testPortfolio.name])
    })

    it("the migrated portfolio's sync resolves a folderPath ending in its name too, not the old flat 2-level path", async () => {
      mockEnsureFolderPath.mockResolvedValue('folder-1')
      mockFilesList.mockResolvedValue([])

      await getBackupFileId(migratedPortfolio)

      const portfolioFolderCalls = mockCreateDriveSyncCalls.filter(
        (c) => Array.isArray(c.folderPath) && c.folderPath.length === 3
      )
      const lastCall = portfolioFolderCalls[portfolioFolderCalls.length - 1]
      expect(lastCall.folderPath).toEqual(['OpenWebApp', 'Portfolio', migratedPortfolio.name])
      expect(lastCall.folderPath).not.toEqual(['OpenWebApp', 'Portfolio'])
    })
  })

  describe('migrateLegacyDriveFolderIfNeeded', () => {
    beforeEach(() => {
      mockGetConnectionSync.mockReset()
      mockEnsureFolderPath.mockReset()
      mockFilesList.mockReset()
      mockFilesRead.mockReset()
      mockFilesWrite.mockReset()
      mockFilesRemove.mockReset()
      mockGetConnectionSync.mockReturnValue({
        email: 'user@example.com',
        needsReauth: false,
        expiresAt: Date.now() + 60 * 60 * 1000,
      })
    })

    it('given a flat-root file, reads it, writes it into the portfolio folder, then removes the old file — in that order', async () => {
      mockEnsureFolderPath.mockResolvedValue('folder-1')
      mockFilesList.mockResolvedValue([{ id: 'flat-file-1' }])
      mockFilesRead.mockResolvedValue('legacy-content')
      mockFilesWrite.mockResolvedValue({ id: 'new-file-1' })
      mockFilesRemove.mockResolvedValue(undefined)

      await migrateLegacyDriveFolderIfNeeded(migratedPortfolio)

      expect(mockFilesRead).toHaveBeenCalledWith('flat-file-1')
      expect(mockFilesWrite).toHaveBeenCalledTimes(1)
      expect(mockFilesWrite.mock.calls[0][0]).toMatchObject({ content: 'legacy-content' })
      expect(mockFilesRemove).toHaveBeenCalledWith('flat-file-1')

      const readOrder = mockFilesRead.mock.invocationCallOrder[0]
      const writeOrder = mockFilesWrite.mock.invocationCallOrder[0]
      const removeOrder = mockFilesRemove.mock.invocationCallOrder[0]
      expect(readOrder).toBeLessThan(writeOrder)
      expect(writeOrder).toBeLessThan(removeOrder)
    })

    it('given no flat-root file, is an idempotent no-op — zero write/remove calls', async () => {
      mockEnsureFolderPath.mockResolvedValue('folder-1')
      mockFilesList.mockResolvedValue([])

      await migrateLegacyDriveFolderIfNeeded(migratedPortfolio)

      expect(mockFilesRead).not.toHaveBeenCalled()
      expect(mockFilesWrite).not.toHaveBeenCalled()
      expect(mockFilesRemove).not.toHaveBeenCalled()
    })

    it('when the connection needsReauth, makes zero API calls (not even files.list)', async () => {
      mockGetConnectionSync.mockReturnValue({
        email: 'user@example.com',
        needsReauth: true,
        expiresAt: Date.now() + 60 * 60 * 1000,
      })

      await migrateLegacyDriveFolderIfNeeded(migratedPortfolio)

      expect(mockEnsureFolderPath).not.toHaveBeenCalled()
      expect(mockFilesList).not.toHaveBeenCalled()
      expect(mockFilesRead).not.toHaveBeenCalled()
      expect(mockFilesWrite).not.toHaveBeenCalled()
      expect(mockFilesRemove).not.toHaveBeenCalled()
    })

    it('when there is no active connection at all, makes zero API calls', async () => {
      mockGetConnectionSync.mockReturnValue(null)

      await migrateLegacyDriveFolderIfNeeded(migratedPortfolio)

      expect(mockEnsureFolderPath).not.toHaveBeenCalled()
      expect(mockFilesList).not.toHaveBeenCalled()
      expect(mockFilesRead).not.toHaveBeenCalled()
      expect(mockFilesWrite).not.toHaveBeenCalled()
      expect(mockFilesRemove).not.toHaveBeenCalled()
    })

    it('on a NON-migrated portfolio, is an immediate no-op — zero API calls, guard short-circuits before checking connection', async () => {
      await migrateLegacyDriveFolderIfNeeded(testPortfolio)

      expect(mockGetConnectionSync).not.toHaveBeenCalled()
      expect(mockEnsureFolderPath).not.toHaveBeenCalled()
      expect(mockFilesList).not.toHaveBeenCalled()
      expect(mockFilesRead).not.toHaveBeenCalled()
      expect(mockFilesWrite).not.toHaveBeenCalled()
      expect(mockFilesRemove).not.toHaveBeenCalled()
    })
  })
})

// ---------------------------------------------------------------------------
// The drive-connect `driveAuth.ensureFresh()` gate (T3).
//
// Every content op (syncBackup / restoreBackupFromFileId /
// overwriteLocalWithRemote / overwriteRemoteWithLocal) must call
// `getDriveAuthFor(portfolio).ensureFresh()` and must do so BEFORE touching
// any drive I/O, so a stale/expired token is refreshed (or the op aborts)
// before a request goes out. Handles are fetched fresh from `getDriveAuthFor`
// (rather than a single module-level singleton) so these assertions hit the
// exact cached instance drive.ts uses internally for `testPortfolio`.
// ---------------------------------------------------------------------------
describe('driveAuth.ensureFresh gate (T3 — drive-connect integration)', () => {
  let key: CryptoKey
  let salt: Uint8Array
  let ensureFresh: ReturnType<typeof vi.mocked<ReturnType<typeof getDriveAuthFor>['ensureFresh']>>

  beforeEach(async () => {
    salt = generateSalt()
    key = await deriveKey('password', salt)

    mockFilesStatus.mockReset()
    mockFilesRead.mockReset()
    mockFilesWrite.mockReset()
    mockFilesList.mockReset()
    mockFilesRemove.mockReset()
    mockEnsureFolderPath.mockReset()
    mockPickFile.mockReset()
    mockCreateDriveSyncCalls.length = 0

    ensureFresh = vi.mocked(getDriveAuthFor(testPortfolio).ensureFresh)
    ensureFresh.mockReset()
    ensureFresh.mockResolvedValue({
      email: 'user@example.com',
      needsReauth: false,
      expiresAt: Date.now() + 60 * 60 * 1000,
    } as never)

    // syncBackup's folder + list + write chain (shared by overwriteRemoteWithLocal).
    mockEnsureFolderPath.mockResolvedValue('folder-1')
    mockFilesList.mockResolvedValue([{ id: 'file-1' }])
    mockFilesWrite.mockResolvedValue({ id: 'file-1' })
  })

  const encJson = async () => JSON.stringify(await encryptState(initialState(), key, salt))

  describe('happy — ensureFresh() runs before any drive I/O', () => {
    it('syncBackup calls ensureFresh() once, before ensureFolderPath / files.list / files.write', async () => {
      await syncBackup(testPortfolio, initialState(), key, salt)

      expect(ensureFresh).toHaveBeenCalledTimes(1)
      const gate = ensureFresh.mock.invocationCallOrder[0]
      expect(gate).toBeLessThan(mockEnsureFolderPath.mock.invocationCallOrder[0])
      expect(gate).toBeLessThan(mockFilesList.mock.invocationCallOrder[0])
      expect(gate).toBeLessThan(mockFilesWrite.mock.invocationCallOrder[0])
    })

    it('restoreBackupFromFileId calls ensureFresh() once, before files.read', async () => {
      mockFilesRead.mockResolvedValue(await encJson())

      await restoreBackupFromFileId(testPortfolio, 'file-1', key)

      expect(ensureFresh).toHaveBeenCalledTimes(1)
      expect(ensureFresh.mock.invocationCallOrder[0]).toBeLessThan(
        mockFilesRead.mock.invocationCallOrder[0]
      )
    })

    it('overwriteLocalWithRemote calls ensureFresh() once, before files.read', async () => {
      mockFilesRead.mockResolvedValue(await encJson())

      await overwriteLocalWithRemote(testPortfolio, 'file-1', key)

      expect(ensureFresh).toHaveBeenCalledTimes(1)
      expect(ensureFresh.mock.invocationCallOrder[0]).toBeLessThan(
        mockFilesRead.mock.invocationCallOrder[0]
      )
    })

    it('overwriteRemoteWithLocal gates on ensureFresh() before files.read / files.write', async () => {
      mockFilesRead.mockResolvedValue('remote-baseline')

      await overwriteRemoteWithLocal(testPortfolio, initialState(), key, salt, 'file-1')

      // Called twice: once in overwriteRemoteWithLocal itself, then again inside
      // the syncBackup it delegates the write to. The load-bearing property is
      // that the FIRST call precedes every drive I/O.
      expect(ensureFresh).toHaveBeenCalledTimes(2)
      const gate = ensureFresh.mock.invocationCallOrder[0]
      expect(gate).toBeLessThan(mockFilesRead.mock.invocationCallOrder[0])
      expect(gate).toBeLessThan(mockFilesWrite.mock.invocationCallOrder[0])
    })
  })

  describe('error — a rejecting ensureFresh() aborts the op before any drive I/O', () => {
    beforeEach(() => {
      ensureFresh.mockReset()
      ensureFresh.mockRejectedValue(new Error('token refresh failed'))
    })

    it('syncBackup rejects with the same error and performs no files.* call', async () => {
      await expect(syncBackup(testPortfolio, initialState(), key, salt)).rejects.toThrow('token refresh failed')
      expect(mockEnsureFolderPath).not.toHaveBeenCalled()
      expect(mockFilesList).not.toHaveBeenCalled()
      expect(mockFilesWrite).not.toHaveBeenCalled()
    })

    it('restoreBackupFromFileId rejects with the same error and never reads', async () => {
      await expect(restoreBackupFromFileId(testPortfolio, 'file-1', key)).rejects.toThrow('token refresh failed')
      expect(mockFilesRead).not.toHaveBeenCalled()
    })

    it('overwriteLocalWithRemote rejects with the same error and never reads', async () => {
      await expect(overwriteLocalWithRemote(testPortfolio, 'file-1', key)).rejects.toThrow('token refresh failed')
      expect(mockFilesRead).not.toHaveBeenCalled()
    })

    it('overwriteRemoteWithLocal rejects with the same error and never reads or writes', async () => {
      await expect(
        overwriteRemoteWithLocal(testPortfolio, initialState(), key, salt, 'file-1')
      ).rejects.toThrow('token refresh failed')
      expect(mockFilesRead).not.toHaveBeenCalled()
      expect(mockFilesWrite).not.toHaveBeenCalled()
    })
  })

  describe('regression — getBackupFileId stays a passive probe', () => {
    it('returns null silently on NeedsReauthError and never calls driveAuth.ensureFresh', async () => {
      mockEnsureFolderPath.mockRejectedValue(new NeedsReauthError('token expired'))

      const result = await getBackupFileId(testPortfolio)

      expect(result).toBeNull()
      expect(ensureFresh).not.toHaveBeenCalled()
    })
  })
})

// ---------------------------------------------------------------------------
// T13 — single auth-popup race (the headline guarantee).
//
// Unlike every block above (which mocks `createDriveAuth` to a fake handle),
// this block runs the REAL `createDriveAuth` from `@open-webapp/drive-connect`
// over a hand-built fake `driveSync`. Opting in: set `mockT13.active = true`,
// `vi.resetModules()`, then `await import('./drive')` so drive.ts is
// re-evaluated with `createDriveSync()` -> `mockT13.driveSync` and
// `createDriveAuth()` -> the genuine implementation (one `connectInFlight`
// promise shared by `connect()` and `ensureFresh()`).
//
// Fake `driveSync` shape (what the real `createDriveAuth` touches):
//   driveSync.activate()                       -> vi.fn(() => () => {})
//   driveSync.project(id).getConnection()      -> current cached Connection | null
//   driveSync.project(id).connect()            -> a DEFERRED promise we resolve/reject by hand
//   driveSync.project(id).disconnect()         -> vi.fn (unused here)
//   driveSync.project(id).ensureFolderPath()   -> 'folder-1'      (syncBackup's post-gate I/O)
//   driveSync.project(id).files.list()         -> []              (no existing backup)
//   driveSync.project(id).files.write()        -> { id: 'backup-file-id' }
// ---------------------------------------------------------------------------
describe('T13 — single auth-popup race (real createDriveAuth)', () => {
  const flush = () => new Promise((r) => setTimeout(r, 0))

  const t13: {
    mod: typeof import('./drive')
    key: CryptoKey
    salt: Uint8Array
    connectPrimitive: ReturnType<typeof vi.fn>
    connectDeferred: Promise<unknown>
    resolveConnect: (value: unknown) => void
    rejectConnect: (err: unknown) => void
    connection: unknown
    connected: { email: string; expiresAt: number; needsReauth: boolean }
  } = {} as never

  beforeEach(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    t13.connected = { email: 'user@example.com', expiresAt: Date.now() + 60 * 60 * 1000, needsReauth: false }
    t13.connection = null // default: no usable cached token -> forces the interactive path
    t13.connectDeferred = new Promise((resolve, reject) => {
      t13.resolveConnect = resolve
      t13.rejectConnect = reject
    })
    // The interactive connect primitive. Returns whatever `t13.connectDeferred`
    // currently is, so a test can re-arm it for a follow-up connect.
    t13.connectPrimitive = vi.fn(() => t13.connectDeferred)

    const project = {
      getConnection: vi.fn(async () => t13.connection),
      connect: t13.connectPrimitive,
      disconnect: vi.fn(async () => {}),
      ensureFolderPath: vi.fn(async () => 'folder-1'),
      files: {
        list: vi.fn(async () => [] as unknown[]),
        write: vi.fn(async () => ({ id: 'backup-file-id' })),
        read: vi.fn(async () => null),
        status: vi.fn(async () => ({ exists: false })),
      },
    }
    mockT13.driveSync = {
      activate: vi.fn(() => () => {}),
      project: vi.fn(() => project),
    }
    mockT13.active = true
    vi.resetModules()
    t13.mod = await import('./drive')

    t13.salt = generateSalt()
    t13.key = await deriveKey('password', t13.salt)
  })

  afterEach(() => {
    mockT13.active = false
    mockT13.driveSync = null
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('headline: connect() + syncBackup() in one tick share ONE interactive connect; both resolve off it', async () => {
    t13.connection = null // no cached/valid token

    const pConnect = t13.mod.getDriveAuthFor(testPortfolio).connect()
    const pEnsure = t13.mod.getDriveAuthFor(testPortfolio).ensureFresh()
    const pSync = t13.mod.syncBackup(testPortfolio, initialState(), t13.key, t13.salt)

    // Let ensureFresh()/syncBackup() get past getConnection() into the shared connect().
    await flush()
    expect(t13.connectPrimitive).toHaveBeenCalledTimes(1)

    t13.resolveConnect(t13.connected)

    const [c1, c2, fileId] = await Promise.all([pConnect, pEnsure, pSync])
    expect(c1).toBe(t13.connected)
    expect(c2).toBe(t13.connected) // same connection object, not a second flow
    expect(c1).toBe(c2)
    expect(fileId).toBe('backup-file-id')
    expect(t13.connectPrimitive).toHaveBeenCalledTimes(1)
  })

  it('fast path: a still-valid cached token races with zero interactive connects', async () => {
    t13.connection = { email: 'user@example.com', expiresAt: Date.now() + 30 * 60 * 1000, needsReauth: false }

    const pEnsure = t13.mod.getDriveAuthFor(testPortfolio).ensureFresh()
    const pSync = t13.mod.syncBackup(testPortfolio, initialState(), t13.key, t13.salt)

    const [conn, fileId] = await Promise.all([pEnsure, pSync])
    expect(t13.connectPrimitive).not.toHaveBeenCalled()
    expect(conn).toBe(t13.connection)
    expect(fileId).toBe('backup-file-id')
  })

  it('error: the shared connect rejects -> both callers reject; a later connect() starts a fresh interactive call', async () => {
    t13.connection = null

    const pConnect = t13.mod.getDriveAuthFor(testPortfolio).connect()
    const pSync = t13.mod.syncBackup(testPortfolio, initialState(), t13.key, t13.salt)
    await flush()
    expect(t13.connectPrimitive).toHaveBeenCalledTimes(1)

    const boom = new Error('user denied consent')
    t13.rejectConnect(boom)

    await expect(pConnect).rejects.toBe(boom)
    await expect(pSync).rejects.toThrow('user denied consent')

    // in-flight guard cleared in `finally` -> the next connect() is a NEW interactive call
    t13.connectDeferred = new Promise((resolve) => {
      t13.resolveConnect = resolve
    })
    const pConnect2 = t13.mod.getDriveAuthFor(testPortfolio).connect()
    await flush()
    expect(t13.connectPrimitive).toHaveBeenCalledTimes(2)

    t13.resolveConnect(t13.connected)
    await expect(pConnect2).resolves.toBe(t13.connected)
  })

  it('sequential: ensureFresh() twice with a valid token -> zero interactive connects', async () => {
    t13.connection = { email: 'user@example.com', expiresAt: Date.now() + 30 * 60 * 1000, needsReauth: false }

    const c1 = await t13.mod.getDriveAuthFor(testPortfolio).ensureFresh()
    const c2 = await t13.mod.getDriveAuthFor(testPortfolio).ensureFresh()

    expect(c1).toBe(t13.connection)
    expect(c2).toBe(t13.connection)
    expect(t13.connectPrimitive).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// listPortfolioFoldersOnDrive (T2 — picker Drive folder discovery).
// ---------------------------------------------------------------------------
describe('listPortfolioFoldersOnDrive', () => {
  let ensureFresh: ReturnType<typeof vi.mocked<ReturnType<typeof getPickerDriveAuth>['ensureFresh']>>

  beforeEach(() => {
    mockFilesList.mockReset()
    mockEnsureFolderPath.mockReset()
    mockEnsureFolderPath.mockResolvedValue('picker-root-folder')

    ensureFresh = vi.mocked(getPickerDriveAuth().ensureFresh)
    ensureFresh.mockReset()
    ensureFresh.mockResolvedValue({
      email: 'user@example.com',
      needsReauth: false,
      expiresAt: Date.now() + 60 * 60 * 1000,
    } as never)
  })

  it('resolves to the folders returned by files.list, mapped to {name, id}', async () => {
    mockFilesList.mockResolvedValue([
      { id: 'f1', name: 'Portfolio A', mimeType: 'application/vnd.google-apps.folder' },
      { id: 'f2', name: 'Portfolio B', mimeType: 'application/vnd.google-apps.folder' },
      { id: 'f3', name: 'Portfolio C', mimeType: 'application/vnd.google-apps.folder' },
    ])

    const result = await listPortfolioFoldersOnDrive()

    expect(result).toEqual([
      { name: 'Portfolio A', id: 'f1' },
      { name: 'Portfolio B', id: 'f2' },
      { name: 'Portfolio C', id: 'f3' },
    ])
    expect(mockFilesList).toHaveBeenCalledWith({
      folderId: 'picker-root-folder',
      mimeType: 'application/vnd.google-apps.folder',
    })
  })

  it('resolves to [] when files.list returns no folders', async () => {
    mockFilesList.mockResolvedValue([])

    const result = await listPortfolioFoldersOnDrive()

    expect(result).toEqual([])
  })

  it('rejects when ensureFresh() fails, without ever calling files.list', async () => {
    ensureFresh.mockRejectedValue(new Error('auth failed'))

    await expect(listPortfolioFoldersOnDrive()).rejects.toThrow('auth failed')
    expect(mockFilesList).not.toHaveBeenCalled()
  })

  it('resolves to [] when files.list throws after a successful ensureFresh()', async () => {
    mockFilesList.mockRejectedValue(new Error('transient network error'))

    const result = await listPortfolioFoldersOnDrive()

    expect(result).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// decryptDriveFolderBackup (T3 — picker Drive folder decrypt).
// ---------------------------------------------------------------------------
describe('decryptDriveFolderBackup', () => {
  let ensureFresh: ReturnType<typeof vi.mocked<ReturnType<typeof getPickerDriveAuth>['ensureFresh']>>
  let salt: Uint8Array
  let key: CryptoKey

  beforeEach(async () => {
    mockFilesList.mockReset()
    mockFilesRead.mockReset()

    ensureFresh = vi.mocked(getPickerDriveAuth().ensureFresh)
    ensureFresh.mockReset()
    ensureFresh.mockResolvedValue({
      email: 'user@example.com',
      needsReauth: false,
      expiresAt: Date.now() + 60 * 60 * 1000,
    } as never)

    salt = generateSalt()
    key = await deriveKey('correct-password', salt)

    mockFilesList.mockResolvedValue([{ id: 'file-1', name: 'portfolio-state.json' }])
  })

  it('resolves { state, key, salt } on the correct password', async () => {
    const remoteState = initialState()
    const envelope = await encryptState(remoteState, key, salt)
    mockFilesRead.mockResolvedValue(JSON.stringify(envelope))

    const result = await decryptDriveFolderBackup('folder-1', 'correct-password')

    expect(result.state).toEqual(remoteState)
    expect(result.salt).toEqual(salt)
    expect(mockFilesList).toHaveBeenCalledWith({
      folderId: 'folder-1',
      nameEquals: 'portfolio-state.json',
    })
    expect(mockFilesRead).toHaveBeenCalledWith('file-1')
  })

  it('rejects with DriveDecryptError carrying the salt/envelope on the wrong password', async () => {
    const envelope = await encryptState(initialState(), key, salt)
    mockFilesRead.mockResolvedValue(JSON.stringify(envelope))

    const err = await decryptDriveFolderBackup('folder-1', 'wrong-password').catch((e) => e)

    expect(err).toBeInstanceOf(DriveDecryptError)
    expect(err.salt).toEqual(salt)
    expect(err.envelope).toEqual(envelope)
  })

  it('rejects with DriveMalformedBackupError when the folder has no portfolio-state.json', async () => {
    mockFilesList.mockResolvedValue([])

    await expect(decryptDriveFolderBackup('folder-1', 'correct-password')).rejects.toThrow(
      DriveMalformedBackupError
    )
    expect(mockFilesRead).not.toHaveBeenCalled()
  })

  it('rejects with DriveMalformedBackupError on malformed JSON content', async () => {
    mockFilesRead.mockResolvedValue('{not valid json')

    await expect(decryptDriveFolderBackup('folder-1', 'correct-password')).rejects.toThrow(
      DriveMalformedBackupError
    )
  })

  it('propagates raw when ensureFresh() rejects, without calling files.list', async () => {
    ensureFresh.mockRejectedValue(new Error('auth failed'))

    const err = await decryptDriveFolderBackup('folder-1', 'correct-password').catch((e) => e)

    expect(err).not.toBeInstanceOf(DriveMalformedBackupError)
    expect(err).not.toBeInstanceOf(DriveDecryptError)
    expect(err.message).toBe('auth failed')
    expect(mockFilesList).not.toHaveBeenCalled()
  })
})
