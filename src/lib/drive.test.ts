import { describe, it, expect, beforeEach } from 'vitest'
import { createPortfolioSyncDocument, DriveDecryptError } from './drive'
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
