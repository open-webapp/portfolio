import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Shared fake harness for the drive conflict-reconcile work (T1 spike).
//
// T2–T4 build on this: they add files.status / files.read / files.write based
// helpers to drive.ts, and their tests reuse `mockFakeProject` + the `mock*`
// fns below (reset them in a `beforeEach`, set `.mockResolvedValue(...)` per
// case). Names are `mock`-prefixed so the hoisted `vi.mock` factory may close
// over them (same convention as drivePickFile.test.ts).
//
// The existing `createPortfolioSyncDocument` suite is pure (never touches the
// mocked `driveSync`), so this file-level mock leaves it green.
// ---------------------------------------------------------------------------
const mockFilesStatus = vi.fn()
const mockFilesRead = vi.fn()
const mockFilesWrite = vi.fn()
const mockFilesList = vi.fn()
const mockEnsureFolderPath = vi.fn()
const mockPickFile = vi.fn()

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
  },
  ensureFolderPath: mockEnsureFolderPath,
  pickFile: mockPickFile,
}

// ---------------------------------------------------------------------------
// `@open-webapp/drive-connect` fake. `driveAuth` is created once at drive.ts
// module load (`export const driveAuth = createDriveAuth(...)`), which runs
// while this test file's `import { ... } from './drive'` is evaluated —
// before any top-level `const` here is initialized. So the handle is built
// INSIDE the (hoisted) factory; tests reach the same `ensureFresh` mock the
// module captured by importing `driveAuth` from ./drive and asserting on
// `driveAuth.ensureFresh` / `vi.mocked(driveAuth.ensureFresh)`.
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
            getStatus: vi.fn(),
            subscribe: vi.fn(() => () => {}),
            refresh: vi.fn(),
            connect: vi.fn(),
            disconnect: vi.fn(),
            ensureFresh: vi.fn(),
            activate: vi.fn(() => () => {}),
          }
    ),
  }
})

vi.mock('@open-webapp/drive-sync', () => ({
  createDriveSync: () =>
    mockT13.active ? mockT13.driveSync : { project: () => mockFakeProject },
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
  createPortfolioSyncDocument,
  DriveDecryptError,
  drive,
  driveAuth,
  getBackupFileId,
  getBackupFileStatus,
  overwriteLocalWithRemote,
  overwriteRemoteWithLocal,
  restoreBackupFromFileId,
  syncBackup,
} from './drive'
import { encryptState, decryptState, generateSalt, deriveKey } from './crypto'
import { initialState } from './state'

describe('Portfolio SyncDocument (T33)', () => {
  let key: CryptoKey
  let salt: Uint8Array
  let appState: ReturnType<typeof initialState>
  let localAppState: ReturnType<typeof initialState> | null

  beforeEach(async () => {
    salt = generateSalt()
    key = await deriveKey('password', salt)
    appState = initialState()
    localAppState = null
  })

  describe('createPortfolioSyncDocument', () => {
    it('readLocal: returns null when no local state', async () => {
      localAppState = null

      const doc = createPortfolioSyncDocument(
        key,
        salt,
        async () => localAppState,
        async () => {}
      )

      const result = await doc.readLocal()
      expect(result).toBeNull()
    })

    it('readLocal: encrypts state and returns Uint8Array', async () => {
      localAppState = { ...appState, accounts: [{ id: '1', name: 'Test', institution: '', balance: 100 }] }

      const doc = createPortfolioSyncDocument(
        key,
        salt,
        async () => localAppState,
        async () => {}
      )

      const encrypted = await doc.readLocal()
      expect(encrypted).toBeInstanceOf(Uint8Array)
      expect(encrypted!.length).toBeGreaterThan(0)

      // Verify it's valid JSON (EncryptedEnvelope shape)
      const str = new TextDecoder().decode(encrypted!)
      const envelope = JSON.parse(str)
      expect(envelope.version).toBe(1)
      expect(typeof envelope.salt).toBe('string')
      expect(typeof envelope.iv).toBe('string')
      expect(typeof envelope.ciphertext).toBe('string')
    })

    it('bytes round-trip identical (no UTF-8 mangling)', async () => {
      localAppState = appState

      const doc = createPortfolioSyncDocument(
        key,
        salt,
        async () => localAppState,
        async (state) => {
          localAppState = state
        }
      )

      const encrypted1 = await doc.readLocal()
      expect(encrypted1).toBeDefined()

      // Write and read again
      await doc.writeLocal(encrypted1!)
      const encrypted2 = await doc.readLocal()

      // Encryption uses a fresh random IV every call, so the raw envelope
      // bytes legitimately differ between reads; what must survive the
      // round-trip untouched is the decrypted state itself (no UTF-8
      // mangling through the base64 envelope).
      const env1 = JSON.parse(new TextDecoder().decode(encrypted1!))
      const env2 = JSON.parse(new TextDecoder().decode(encrypted2!))

      const decrypted1 = await decryptState(env1, key)
      const decrypted2 = await decryptState(env2, key)

      expect(decrypted2).toEqual(decrypted1)
    })

    it('merge: prefers remote when both exist', async () => {
      const localData = { ...appState, accounts: [{ id: '1', name: 'Local', institution: '', balance: 100 }] }
      const remoteData = { ...appState, accounts: [{ id: '2', name: 'Remote', institution: '', balance: 200 }] }

      const localEncrypted = new TextEncoder().encode(JSON.stringify(await encryptState(localData, key, salt)))
      const remoteEncrypted = new TextEncoder().encode(JSON.stringify(await encryptState(remoteData, key, salt)))

      const doc = createPortfolioSyncDocument(
        key,
        salt,
        async () => localData,
        async (state) => {
          localData.accounts = state.accounts
        }
      )

      const result = await doc.merge(localEncrypted, remoteEncrypted)
      await doc.writeLocal(result.merged)

      expect(localData.accounts[0].name).toBe('Remote')
      expect(result.conflicts).toEqual([])
    })

    it('merge: uses local when remote absent', async () => {
      const localData = { ...appState, accounts: [{ id: '1', name: 'Local', institution: '', balance: 100 }] }

      const localEncrypted = new TextEncoder().encode(JSON.stringify(await encryptState(localData, key, salt)))

      const doc = createPortfolioSyncDocument(
        key,
        salt,
        async () => localData,
        async () => {}
      )

      const result = await doc.merge(localEncrypted, null)

      // Result should be valid encrypted envelope
      const str = new TextDecoder().decode(result.merged as Uint8Array)
      const envelope = JSON.parse(str)
      expect(envelope.version).toBe(1)
      expect(result.conflicts).toEqual([])
    })

    it('merge: uses remote when local absent', async () => {
      const remoteData = { ...appState, accounts: [{ id: '2', name: 'Remote', institution: '', balance: 200 }] }

      const remoteEncrypted = new TextEncoder().encode(JSON.stringify(await encryptState(remoteData, key, salt)))

      const doc = createPortfolioSyncDocument(
        key,
        salt,
        async () => null,
        async () => {}
      )

      const result = await doc.merge(null, remoteEncrypted)

      // Result should be the remote data
      const str = new TextDecoder().decode(result.merged as Uint8Array)
      const envelope = JSON.parse(str)
      expect(envelope.version).toBe(1)
      expect(result.conflicts).toEqual([])
    })

    it('merge: creates empty state when neither exist', async () => {
      const doc = createPortfolioSyncDocument(
        key,
        salt,
        async () => null,
        async () => {}
      )

      const result = await doc.merge(null, null)

      // Result should be valid encrypted envelope
      const str = new TextDecoder().decode(result.merged as Uint8Array)
      const envelope = JSON.parse(str)
      expect(envelope.version).toBe(1)
      expect(result.conflicts).toEqual([])
    })

    it('wrong key on merge throws DriveDecryptError', async () => {
      const remoteData = appState
      const remoteEncrypted = new TextEncoder().encode(JSON.stringify(await encryptState(remoteData, key, salt)))

      const wrongSalt = generateSalt()
      const wrongKey = await deriveKey('wrong-password', wrongSalt)

      const wrongDoc = createPortfolioSyncDocument(wrongKey, wrongSalt, async () => null, async () => {})

      await expect(wrongDoc.merge(null, remoteEncrypted)).rejects.toThrow(DriveDecryptError)
    })

    it('truncated envelope throws error', async () => {
      const doc = createPortfolioSyncDocument(
        key,
        salt,
        async () => null,
        async () => {}
      )

      const truncated = new TextEncoder().encode('{"version": 1}')

      // A truncated *local* envelope is tolerated (merge treats it as absent,
      // per the "if local can't decrypt, treat as absent" design in
      // drive.ts) so it doesn't block a restore. A truncated *remote*
      // envelope is the thing being restored, so corruption there must
      // surface as an error.
      await expect(doc.merge(null, truncated)).rejects.toThrow()
    })

    it('writeLocal: decrypts and persists merged state', async () => {
      let persistedState: ReturnType<typeof initialState> | null = null

      const doc = createPortfolioSyncDocument(
        key,
        salt,
        async () => appState,
        async (state) => {
          persistedState = state
        }
      )

      const testState = { ...appState, accounts: [{ id: 'test', name: 'Test Account', institution: '', balance: 1000 }] }
      const encrypted = new TextEncoder().encode(JSON.stringify(await encryptState(testState, key, salt)))

      await doc.writeLocal(encrypted)

      expect(persistedState).toBeDefined()
      expect(persistedState?.accounts).toHaveLength(1)
      expect(persistedState?.accounts[0].name).toBe('Test Account')
    })

    it('document metadata is correct', async () => {
      const doc = createPortfolioSyncDocument(
        key,
        salt,
        async () => appState,
        async () => {}
      )

      expect(doc.key).toBe('portfolio-state')
      expect(doc.name).toBe('portfolio-state.json')
      expect(doc.mimeType).toBe('application/json')
    })
  })
})

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
    mockEnsureFolderPath.mockReset()
    mockPickFile.mockReset()
    // drive-connect's ensureFresh gate: default to a resolved fake connection so
    // content ops never try to open an interactive auth flow. Individual tests
    // override with mockRejectedValue to exercise the failure path.
    vi.mocked(driveAuth.ensureFresh).mockReset()
    vi.mocked(driveAuth.ensureFresh).mockResolvedValue({
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

      const result = await getBackupFileStatus('file-1')

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

      const result = await getBackupFileStatus('missing')

      expect(result.exists).toBe(false)
      expect(result.remoteModifiedTime).toBeUndefined()
      expect(result.lastRestoredAt).toBeUndefined()
    })

    it('propagates a rejected files.status (caller in App does .catch(() => null))', async () => {
      mockFilesStatus.mockRejectedValue(new Error('drive unavailable'))

      await expect(getBackupFileStatus('file-1')).rejects.toThrow('drive unavailable')
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

      const result = await overwriteLocalWithRemote('file-1', key)

      // files.read is where drive-sync advances the restore baseline.
      expect(mockFilesRead).toHaveBeenCalledWith('file-1')
      expect(result.accounts).toEqual([{ id: 'r1', name: 'Remote Wins', institution: '', balance: 42 }])
    })

    it('throws "empty or unreadable" when the read yields nothing', async () => {
      mockFilesRead.mockResolvedValue(null)
      await expect(overwriteLocalWithRemote('file-1', key)).rejects.toThrow('Drive backup is empty or unreadable')

      mockFilesRead.mockResolvedValue('')
      await expect(overwriteLocalWithRemote('file-1', key)).rejects.toThrow('Drive backup is empty or unreadable')
    })

    it('does not depend on files.status (resolves even in a would-be never-restored state)', async () => {
      const remoteState = {
        ...initialState(),
        accounts: [{ id: 'r2', name: 'No Status Needed', institution: '', balance: 7 }],
      }
      mockFilesRead.mockResolvedValue(JSON.stringify(await encryptState(remoteState, key, salt)))
      mockFilesStatus.mockRejectedValue(new Error('files.status must not be consulted by this path'))

      const result = await overwriteLocalWithRemote('file-1', key)

      expect(result.accounts[0].name).toBe('No Status Needed')
      expect(mockFilesStatus).not.toHaveBeenCalled()
    })

    it('propagates DriveDecryptError when decrypt raises OperationError (wrong key)', async () => {
      const otherSalt = generateSalt()
      const otherKey = await deriveKey('different-password', otherSalt)
      const envelopeJson = JSON.stringify(await encryptState(initialState(), otherKey, otherSalt))
      mockFilesRead.mockResolvedValue(envelopeJson)

      await expect(overwriteLocalWithRemote('file-1', key)).rejects.toThrow(DriveDecryptError)
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

      const result = await overwriteRemoteWithLocal(state, key, salt, 'file-1')

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

      const result = await overwriteRemoteWithLocal(state, key, salt, 'file-1')

      expect(result).toBe('file-1')
      expect(mockFilesRead).toHaveBeenCalledTimes(1)
      expect(mockFilesWrite).toHaveBeenCalledTimes(1)
    })

    it('propagates a post-read RemoteChangedError from the write without retrying', async () => {
      mockFilesRead.mockResolvedValue('remote-baseline')
      const raced = new RemoteChangedError('remote moved again')
      mockFilesWrite.mockRejectedValue(raced)

      const err = await overwriteRemoteWithLocal(state, key, salt, 'file-1').catch((e) => e)

      expect(err).toBe(raced)
      expect(err.name).toBe('RemoteChangedError')
      // The error surfaces once — no retry loop after the write rejects.
      expect(mockFilesRead).toHaveBeenCalledTimes(1)
      expect(mockFilesWrite).toHaveBeenCalledTimes(1)
    })

    it('propagates a failing driveAuth.ensureFresh before any read', async () => {
      vi.mocked(driveAuth.ensureFresh).mockReset()
      vi.mocked(driveAuth.ensureFresh).mockRejectedValue(new Error('connection boom'))

      await expect(overwriteRemoteWithLocal(state, key, salt, 'file-1')).rejects.toThrow('connection boom')
      expect(mockFilesRead).not.toHaveBeenCalled()
      expect(mockFilesWrite).not.toHaveBeenCalled()
    })
  })
})

// ---------------------------------------------------------------------------
// The drive-connect `driveAuth.ensureFresh()` gate (T3).
//
// Every content op (syncBackup / restoreBackupFromFileId /
// overwriteLocalWithRemote / overwriteRemoteWithLocal) must call
// driveAuth.ensureFresh() and must do so BEFORE touching any drive I/O, so a
// stale/expired token is refreshed (or the op aborts) before a request goes
// out. `driveAuth` is imported from ./drive so these assertions hit the exact
// mock instance the module captured at load.
// ---------------------------------------------------------------------------
describe('driveAuth.ensureFresh gate (T3 — drive-connect integration)', () => {
  let key: CryptoKey
  let salt: Uint8Array
  let ensureFresh: ReturnType<typeof vi.mocked<typeof driveAuth.ensureFresh>>

  beforeEach(async () => {
    salt = generateSalt()
    key = await deriveKey('password', salt)

    mockFilesStatus.mockReset()
    mockFilesRead.mockReset()
    mockFilesWrite.mockReset()
    mockFilesList.mockReset()
    mockEnsureFolderPath.mockReset()
    mockPickFile.mockReset()

    ensureFresh = vi.mocked(driveAuth.ensureFresh)
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
      await syncBackup(initialState(), key, salt)

      expect(ensureFresh).toHaveBeenCalledTimes(1)
      const gate = ensureFresh.mock.invocationCallOrder[0]
      expect(gate).toBeLessThan(mockEnsureFolderPath.mock.invocationCallOrder[0])
      expect(gate).toBeLessThan(mockFilesList.mock.invocationCallOrder[0])
      expect(gate).toBeLessThan(mockFilesWrite.mock.invocationCallOrder[0])
    })

    it('restoreBackupFromFileId calls ensureFresh() once, before files.read', async () => {
      mockFilesRead.mockResolvedValue(await encJson())

      await restoreBackupFromFileId('file-1', key)

      expect(ensureFresh).toHaveBeenCalledTimes(1)
      expect(ensureFresh.mock.invocationCallOrder[0]).toBeLessThan(
        mockFilesRead.mock.invocationCallOrder[0]
      )
    })

    it('overwriteLocalWithRemote calls ensureFresh() once, before files.read', async () => {
      mockFilesRead.mockResolvedValue(await encJson())

      await overwriteLocalWithRemote('file-1', key)

      expect(ensureFresh).toHaveBeenCalledTimes(1)
      expect(ensureFresh.mock.invocationCallOrder[0]).toBeLessThan(
        mockFilesRead.mock.invocationCallOrder[0]
      )
    })

    it('overwriteRemoteWithLocal gates on ensureFresh() before files.read / files.write', async () => {
      mockFilesRead.mockResolvedValue('remote-baseline')

      await overwriteRemoteWithLocal(initialState(), key, salt, 'file-1')

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
      await expect(syncBackup(initialState(), key, salt)).rejects.toThrow('token refresh failed')
      expect(mockEnsureFolderPath).not.toHaveBeenCalled()
      expect(mockFilesList).not.toHaveBeenCalled()
      expect(mockFilesWrite).not.toHaveBeenCalled()
    })

    it('restoreBackupFromFileId rejects with the same error and never reads', async () => {
      await expect(restoreBackupFromFileId('file-1', key)).rejects.toThrow('token refresh failed')
      expect(mockFilesRead).not.toHaveBeenCalled()
    })

    it('overwriteLocalWithRemote rejects with the same error and never reads', async () => {
      await expect(overwriteLocalWithRemote('file-1', key)).rejects.toThrow('token refresh failed')
      expect(mockFilesRead).not.toHaveBeenCalled()
    })

    it('overwriteRemoteWithLocal rejects with the same error and never reads or writes', async () => {
      await expect(
        overwriteRemoteWithLocal(initialState(), key, salt, 'file-1')
      ).rejects.toThrow('token refresh failed')
      expect(mockFilesRead).not.toHaveBeenCalled()
      expect(mockFilesWrite).not.toHaveBeenCalled()
    })
  })

  describe('regression — getBackupFileId stays a passive probe', () => {
    it('returns null silently on NeedsReauthError and never calls driveAuth.ensureFresh', async () => {
      mockEnsureFolderPath.mockRejectedValue(new NeedsReauthError('token expired'))

      const result = await getBackupFileId()

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

    const pConnect = t13.mod.driveAuth.connect()
    const pEnsure = t13.mod.driveAuth.ensureFresh()
    const pSync = t13.mod.syncBackup(initialState(), t13.key, t13.salt)

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

    const pEnsure = t13.mod.driveAuth.ensureFresh()
    const pSync = t13.mod.syncBackup(initialState(), t13.key, t13.salt)

    const [conn, fileId] = await Promise.all([pEnsure, pSync])
    expect(t13.connectPrimitive).not.toHaveBeenCalled()
    expect(conn).toBe(t13.connection)
    expect(fileId).toBe('backup-file-id')
  })

  it('error: the shared connect rejects -> both callers reject; a later connect() starts a fresh interactive call', async () => {
    t13.connection = null

    const pConnect = t13.mod.driveAuth.connect()
    const pSync = t13.mod.syncBackup(initialState(), t13.key, t13.salt)
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
    const pConnect2 = t13.mod.driveAuth.connect()
    await flush()
    expect(t13.connectPrimitive).toHaveBeenCalledTimes(2)

    t13.resolveConnect(t13.connected)
    await expect(pConnect2).resolves.toBe(t13.connected)
  })

  it('sequential: ensureFresh() twice with a valid token -> zero interactive connects', async () => {
    t13.connection = { email: 'user@example.com', expiresAt: Date.now() + 30 * 60 * 1000, needsReauth: false }

    const c1 = await t13.mod.driveAuth.ensureFresh()
    const c2 = await t13.mod.driveAuth.ensureFresh()

    expect(c1).toBe(t13.connection)
    expect(c2).toBe(t13.connection)
    expect(t13.connectPrimitive).not.toHaveBeenCalled()
  })
})
