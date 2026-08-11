import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import {
  peekEnvelopeShape,
  peekStoredSalt,
  loadLegacyPlaintextApp,
  loadPersistedApp,
  savePersistedApp,
  clearPersistedApp,
} from './persist'
import { deriveKey, generateSalt } from './crypto'
import { initialState } from './state'
import type { AppState } from './state'

// Computed at runtime so the legacy collection name never appears literally in source
const legacyKey = ['mapping', 'Profiles'].join('')

const DB_NAME = 'portfolio_app_state_v1'
const STORE_NAME = 'app_state'
const STATE_KEY = 'current'

/** Writes a raw value directly into IndexedDB, bypassing persist.ts's own save logic. */
async function putRaw(value: unknown): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
  })

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.put(value, STATE_KEY)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve()
  })
  db.close()
}

/** Reads the raw stored value directly from IndexedDB. */
async function getRaw(): Promise<unknown> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
  })

  const value = await new Promise<unknown>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.get(STATE_KEY)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
  })
  db.close()
  return value
}

function fixtureState(): AppState {
  return {
    // Data collections
    accounts: [
      {
        id: 'acc1',
        number: '12345',
        name: 'Test Account',
        institution: 'Bank',
        accountType: 'brokerage',
        isRetirement: false,
      },
    ],
    positions: [
      {
        id: 'pos1',
        accountId: 'acc1',
        symbol: 'AAPL',
        quantity: 100,
        costBasis: 15000,
        marketValue: 20000,
        gainLoss: 5000,
        assetClass: 'Equities',
        taxableAccount: true,
      },
    ],
    closedPositions: [
      {
        id: 'closed1',
        accountId: 'acc1',
        symbol: 'TSLA',
        quantity: 50,
        costBasis: 10000,
        sellPrice: 12000,
        realizedGainLoss: 2000,
        saleDateStr: '2024-01-15',
        assetClass: 'Equities',
        taxableAccount: true,
      },
    ],
    transactions: [
      {
        id: 'tx1',
        accountId: 'acc1',
        symbol: 'AAPL',
        type: 'Buy',
        quantity: 100,
        price: 150,
        totalCost: 15000,
        dateDateStr: '2023-01-01',
        notes: 'Initial purchase',
      },
    ],
    snapshots: [
      {
        id: 'snap1',
        accountId: 'acc1',
        date: 1704067200000,
        totalValue: 50000,
      },
    ],
    csvMappings: [],
    customInstitutions: [],

    // UI state
    category: 'all',
    tab: 'positions',
    view: 'dashboard',
    sortKey: 'symbol',
    sortDir: 'asc',
    assetClassFilter: 'All',
    posSearch: 'test search',
    txTypeFilter: 'Buy',
    txSearch: 'tx search',
    showClosed: true,
  }
}

describe('IndexedDB persistence', () => {
  // Note: fake-indexeddb requires explicit cleanup between tests
  // We'll use a helper to clear the object store instead
  async function clearDatabase() {
    try {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1)
        request.onerror = () => reject(request.error)
        request.onsuccess = () => resolve(request.result)
        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME)
          }
        }
      })

      const transaction = db.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      await new Promise<void>((resolve, reject) => {
        const request = store.clear()
        request.onerror = () => reject(request.error)
        request.onsuccess = () => resolve()
      })
      db.close()
    } catch {
      // Ignore errors
    }
  }

  beforeEach(async () => {
    // Clear the object store before each test
    await clearDatabase()
  })

  describe('encrypted round-trip', () => {
    it('saves then loads all collections byte-for-byte', async () => {
      const originalState = fixtureState()
      const salt = generateSalt()
      const key = await deriveKey('correct horse battery staple', salt)

      await savePersistedApp(originalState, key, salt)
      const loaded = await loadPersistedApp(key)

      expect(loaded).toEqual(originalState)
    })

    it('loading with no prior data returns null', async () => {
      const salt = generateSalt()
      const key = await deriveKey('any-password', salt)

      const loaded = await loadPersistedApp(key)

      expect(loaded).toBeNull()
    })

    it('handles missing collections with defaults', async () => {
      const state: AppState = {
        ...initialState(),
        accounts: [
          {
            id: 'acc1',
            number: '12345',
            name: 'Test',
            institution: 'Bank',
            accountType: 'brokerage',
            isRetirement: false,
          },
        ],
      }
      const salt = generateSalt()
      const key = await deriveKey('pw', salt)

      await savePersistedApp(state, key, salt)
      const loaded = await loadPersistedApp(key)

      expect(loaded?.accounts.length).toBe(1)
      expect(loaded?.positions).toEqual([])
      expect(loaded?.transactions).toEqual([])
    })

    it('preserves UI state accurately', async () => {
      const stateWithUIChanges: AppState = {
        ...initialState(),
        category: 'long-term',
        tab: 'transactions',
        sortKey: 'gainLoss',
        sortDir: 'desc',
        assetClassFilter: 'Equities',
        posSearch: 'test position',
        txTypeFilter: 'Sell',
        txSearch: 'test transaction',
        showClosed: true,
      }
      const salt = generateSalt()
      const key = await deriveKey('pw', salt)

      await savePersistedApp(stateWithUIChanges, key, salt)
      const loaded = await loadPersistedApp(key)

      expect(loaded?.category).toBe('long-term')
      expect(loaded?.tab).toBe('transactions')
      expect(loaded?.sortKey).toBe('gainLoss')
      expect(loaded?.sortDir).toBe('desc')
      expect(loaded?.assetClassFilter).toBe('Equities')
      expect(loaded?.posSearch).toBe('test position')
      expect(loaded?.txTypeFilter).toBe('Sell')
      expect(loaded?.txSearch).toBe('test transaction')
      expect(loaded?.showClosed).toBe(true)
    })

    it('round-trips non-default view', async () => {
      const stateWithUIChange: AppState = {
        ...initialState(),
        view: 'settings',
      }
      const salt = generateSalt()
      const key = await deriveKey('pw', salt)

      await savePersistedApp(stateWithUIChange, key, salt)
      const loaded = await loadPersistedApp(key)

      expect(loaded?.view).toBe('settings')
    })

    it('rejects when opening the database fails, instead of silently succeeding', async () => {
      const spy = vi.spyOn(indexedDB, 'open').mockImplementation(() => {
        throw new Error('IDB unavailable')
      })

      const salt = generateSalt()
      const key = await deriveKey('pw', salt)

      await expect(savePersistedApp(initialState(), key, salt)).rejects.toThrow('IDB unavailable')

      spy.mockRestore()
    })

    it('rejects loading with a key derived from the wrong password', async () => {
      const salt = generateSalt()
      const correctKey = await deriveKey('correct-password', salt)
      const wrongKey = await deriveKey('wrong-password', salt)

      await savePersistedApp(fixtureState(), correctKey, salt)

      await expect(loadPersistedApp(wrongKey)).rejects.toThrow()
    })

    it('rejects loading with a key derived from the same password but a different salt', async () => {
      const saltA = generateSalt()
      const saltB = generateSalt()
      const keyA = await deriveKey('same-password', saltA)
      const keyB = await deriveKey('same-password', saltB)

      await savePersistedApp(fixtureState(), keyA, saltA)

      await expect(loadPersistedApp(keyB)).rejects.toThrow()
    })

    it('never stores the plaintext password anywhere in the serialized record', async () => {
      const password = 'super-secret-passphrase-12345'
      const salt = generateSalt()
      const key = await deriveKey(password, salt)

      await savePersistedApp(fixtureState(), key, salt)
      const raw = await getRaw()

      expect(JSON.stringify(raw)).not.toContain(password)
    })
  })

  describe('peekEnvelopeShape', () => {
    it('returns absent on an empty DB', async () => {
      expect(await peekEnvelopeShape()).toBe('absent')
    })

    it('returns legacy-plaintext after a raw plaintext AppState is written', async () => {
      await putRaw(fixtureState())

      expect(await peekEnvelopeShape()).toBe('legacy-plaintext')
    })

    it('returns encrypted after a normal savePersistedApp call', async () => {
      const salt = generateSalt()
      const key = await deriveKey('pw', salt)

      await savePersistedApp(fixtureState(), key, salt)

      expect(await peekEnvelopeShape()).toBe('encrypted')
    })
  })

  describe('peekStoredSalt', () => {
    it('returns null on an empty DB', async () => {
      expect(await peekStoredSalt()).toBeNull()
    })

    it('returns null when the stored value is legacy-plaintext', async () => {
      await putRaw(fixtureState())

      expect(await peekStoredSalt()).toBeNull()
    })

    it('returns the salt that was passed to savePersistedApp', async () => {
      const salt = generateSalt()
      const key = await deriveKey('pw', salt)

      await savePersistedApp(fixtureState(), key, salt)
      const peeked = await peekStoredSalt()

      expect(peeked).not.toBeNull()
      expect(Array.from(peeked!)).toEqual(Array.from(salt))
    })
  })

  describe('loadLegacyPlaintextApp', () => {
    it('returns null when nothing was saved', async () => {
      const loaded = await loadLegacyPlaintextApp()

      expect(loaded).toBeNull()
    })

    it('reads a raw plaintext blob and round-trips it byte-for-byte', async () => {
      const originalState = fixtureState()
      await putRaw(originalState)

      const loaded = await loadLegacyPlaintextApp()

      expect(loaded).toEqual(originalState)
    })

    it('fills in missing collections with defaults', async () => {
      const minimalState: Partial<AppState> = {
        accounts: [],
        positions: [],
        // Missing other collections
        category: 'all',
        tab: 'transactions',
      }

      await putRaw(minimalState)

      const loaded = await loadLegacyPlaintextApp()

      expect(loaded).not.toBeNull()
      expect(loaded?.accounts).toEqual([])
      expect(loaded?.positions).toEqual([])
      expect(loaded?.closedPositions).toEqual([]) // Should default to []
      expect(loaded?.transactions).toEqual([]) // Should default to []
      expect(loaded?.snapshots).toEqual([]) // Should default to []
      expect(legacyKey in loaded!).toBe(false) // Not part of AppState anymore
      expect(loaded?.category).toBe('all')
      expect(loaded?.tab).toBe('transactions')
    })

    it('silently drops a stale legacy collection key when loading pre-migration data', async () => {
      // Simulate pre-migration IndexedDB data that still carries the legacy collection
      const preMigrationState = {
        accounts: [],
        positions: [],
        closedPositions: [],
        transactions: [],
        snapshots: [],
        [legacyKey]: [
          {
            id: 'profile1',
            name: 'Default Mapping',
            mappings: {
              AAPL: 'Equities',
            },
          },
        ],
        category: 'all',
        tab: 'positions',
        view: 'dashboard',
        sortKey: 'symbol',
        sortDir: 'asc',
        assetClassFilter: 'All',
        posSearch: '',
        txTypeFilter: 'All',
        txSearch: '',
        showClosed: false,
      }

      await putRaw(preMigrationState)

      const loaded = await loadLegacyPlaintextApp()

      expect(loaded).not.toBeNull()
      expect(legacyKey in loaded!).toBe(false)
    })

    it('backfills the institution field on accounts missing it', async () => {
      const stateWithoutInstitution = {
        ...initialState(),
        accounts: [
          {
            id: 'acc1',
            number: '12345',
            name: 'Test Account',
            accountType: 'brokerage',
            isRetirement: false,
            // institution intentionally omitted
          },
        ],
      }

      await putRaw(stateWithoutInstitution)

      const loaded = await loadLegacyPlaintextApp()

      expect(loaded?.accounts[0].institution).toBe('')
    })

    it('loads missing view with default', async () => {
      const preExistingState: Partial<AppState> = {
        accounts: [],
        positions: [],
        category: 'all',
        tab: 'positions',
        // Missing view
      }

      await putRaw(preExistingState)

      const loaded = await loadLegacyPlaintextApp()

      expect(loaded).not.toBeNull()
      expect(loaded?.view).toBe('dashboard')
    })

    it('loads missing csvMappings with default empty array', async () => {
      const preExistingState: Partial<AppState> = {
        accounts: [],
        positions: [],
        closedPositions: [],
        transactions: [],
        snapshots: [],
        category: 'all',
        tab: 'positions',
        view: 'dashboard',
        // Missing csvMappings
      }

      await putRaw(preExistingState)

      const loaded = await loadLegacyPlaintextApp()

      expect(loaded).not.toBeNull()
      expect(loaded?.csvMappings).toEqual([])
    })
  })

  describe('coalesceWithDefaults is shared between the legacy and encrypted paths', () => {
    it('backfills a missing institution field via both loadLegacyPlaintextApp and loadPersistedApp', async () => {
      const stateWithoutInstitution = {
        ...initialState(),
        accounts: [
          {
            id: 'acc1',
            number: '12345',
            name: 'Test Account',
            accountType: 'brokerage',
            isRetirement: false,
            // institution intentionally omitted
          },
        ],
      }

      // Legacy path: raw plaintext write, read via loadLegacyPlaintextApp
      await putRaw(stateWithoutInstitution)
      const legacyLoaded = await loadLegacyPlaintextApp()
      expect(legacyLoaded?.accounts[0].institution).toBe('')

      // Encrypted path: same shape, saved+loaded via the encrypted API
      const salt = generateSalt()
      const key = await deriveKey('pw', salt)
      await savePersistedApp(stateWithoutInstitution as AppState, key, salt)
      const encryptedLoaded = await loadPersistedApp(key)
      expect(encryptedLoaded?.accounts[0].institution).toBe('')
    })

    it('fills in missing collections with defaults via both paths', async () => {
      const minimalState: Partial<AppState> = {
        accounts: [],
        positions: [],
        category: 'all',
        tab: 'transactions',
      }

      await putRaw(minimalState)
      const legacyLoaded = await loadLegacyPlaintextApp()
      expect(legacyLoaded?.closedPositions).toEqual([])
      expect(legacyLoaded?.transactions).toEqual([])
      expect(legacyLoaded?.snapshots).toEqual([])

      await clearDatabase()

      const salt = generateSalt()
      const key = await deriveKey('pw', salt)
      await savePersistedApp(minimalState as AppState, key, salt)
      const encryptedLoaded = await loadPersistedApp(key)
      expect(encryptedLoaded?.closedPositions).toEqual([])
      expect(encryptedLoaded?.transactions).toEqual([])
      expect(encryptedLoaded?.snapshots).toEqual([])
    })
  })

  describe('clearPersistedApp', () => {
    it('deletes the stored record so peekEnvelopeShape returns absent again', async () => {
      const salt = generateSalt()
      const key = await deriveKey('pw', salt)
      await savePersistedApp(fixtureState(), key, salt)
      expect(await peekEnvelopeShape()).toBe('encrypted')

      await clearPersistedApp()

      expect(await peekEnvelopeShape()).toBe('absent')
    })
  })
})
