import { describe, it, expect, beforeEach, vi } from 'vitest'

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
const mockGetConnection = vi.fn()

const mockFakeProject = {
  files: {
    status: mockFilesStatus,
    read: mockFilesRead,
    write: mockFilesWrite,
    list: mockFilesList,
  },
  ensureFolderPath: mockEnsureFolderPath,
  pickFile: mockPickFile,
  getConnection: mockGetConnection,
}

vi.mock('@open-webapp/drive-sync', () => ({
  createDriveSync: () => ({
    project: () => mockFakeProject,
  }),
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

import { RemoteChangedError } from '@open-webapp/drive-sync'
import {
  createPortfolioSyncDocument,
  DriveDecryptError,
  drive,
  getBackupFileStatus,
  overwriteLocalWithRemote,
  overwriteRemoteWithLocal,
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
    mockGetConnection.mockReset()
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
      // ensureFreshConnection() reads a connection; give it a usable token so
      // the helper never tries to open an interactive auth flow.
      mockGetConnection.mockResolvedValue({
        email: 'user@example.com',
        needsReauth: false,
        expiresAt: Date.now() + 60 * 60 * 1000,
      })
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
      // ensureFreshConnection() reads a connection; give it a usable token so
      // the helper never tries to open an interactive auth flow.
      mockGetConnection.mockResolvedValue({
        email: 'user@example.com',
        needsReauth: false,
        expiresAt: Date.now() + 60 * 60 * 1000,
      })
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

    it('propagates a failing ensureFreshConnection before any read', async () => {
      mockGetConnection.mockRejectedValue(new Error('connection boom'))

      await expect(overwriteRemoteWithLocal(state, key, salt, 'file-1')).rejects.toThrow('connection boom')
      expect(mockFilesRead).not.toHaveBeenCalled()
      expect(mockFilesWrite).not.toHaveBeenCalled()
    })
  })
})
