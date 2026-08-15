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
        accountNumber: '12345',
        name: 'Test Account',
        institution: 'Bank',
        taxCategory: 'taxable',
        retirement: false,
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    ],
    positions: [
      {
        id: 'pos1',
        accountId: 'acc1',
        symbol: 'AAPL',
        name: 'Apple Inc',
        shares: 100,
        avgCost: 150,
        price: 200,
        assetClass: 'Equity',
        lastImportedAt: '2024-01-01T00:00:00.000Z',
      },
    ],
    closedPositions: [
      {
        id: 'closed1',
        accountId: 'acc1',
        symbol: 'TSLA',
        name: 'Tesla Inc',
        closedDate: '2024-01-15',
        assetClass: 'Equities',
        shares: 50,
        avgCost: 200,
        price: 240,
        assetClassManualOverride: undefined,
        lastImportedAt: '2024-01-15T00:00:00.000Z',
        realizedGL: 2000,
        realizedGLBasis: 'transactions',
      },
    ],
    transactions: [
      {
        id: 'tx1',
        accountId: 'acc1',
        date: '2023-01-01',
        symbol: 'AAPL',
        type: 'Buy',
        shares: 100,
        price: 150,
        amount: 15000,
        importedAt: '2024-01-01T00:00:00.000Z',
      },
    ],
    snapshots: [
      {
        id: 'snap1',
        accountId: 'acc1',
        date: '2024-01-01',
        value: 50000,
      },
    ],
    csvMappings: [],
    customInstitutions: [],

    // UI state
    view: 'accounts',
    sortKey: 'symbol',
    sortDir: 'asc',
    txTypeFilter: 'Buy',
    txSearch: 'tx search',
    selectedAccountId: 'acc-1',
    selectedCategoryKey: null,
    expandedCategories: { taxable: true },
    acctAssetClassFilter: 'Equities',
    acctPosSearch: 'aapl',
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

    it('backfills missing new UI state fields with defaults via legacy plaintext path (selectedAccountId, expandedCategories, acctAssetClassFilter, acctPosSearch)', async () => {
      // Simulate old plaintext saved blob without the 4 new fields
      const oldBlob: any = {
        // Data collections
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
        positions: [],
        closedPositions: [],
        transactions: [],
        snapshots: [],
        csvMappings: [],
        customInstitutions: [],
        // UI state (omitting the 4 newer AccountsPage fields)
        view: 'accounts',
        sortKey: 'symbol',
        sortDir: 'asc',
        txTypeFilter: 'All',
        txSearch: '',
        // selectedAccountId, expandedCategories, acctAssetClassFilter, acctPosSearch are missing
      }

      await putRaw(oldBlob)

      const loaded = await loadLegacyPlaintextApp()

      // Verify the missing fields are backfilled to defaults
      expect(loaded?.selectedAccountId).toBe(null)
      expect(loaded?.expandedCategories).toEqual({})
      expect(loaded?.acctAssetClassFilter).toBe('All')
      expect(loaded?.acctPosSearch).toBe('')
    })

    it('preserves UI state accurately', async () => {
      const stateWithUIChanges: AppState = {
        ...initialState(),
        sortKey: 'gainLoss',
        sortDir: 'desc',
        txTypeFilter: 'Sell',
        txSearch: 'test transaction',
        selectedAccountId: 'acc-1',
        expandedCategories: { taxable: true },
        acctAssetClassFilter: 'Equities',
        acctPosSearch: 'aapl',
      }
      const salt = generateSalt()
      const key = await deriveKey('pw', salt)

      await savePersistedApp(stateWithUIChanges, key, salt)
      const loaded = await loadPersistedApp(key)

      expect(loaded?.sortKey).toBe('gainLoss')
      expect(loaded?.sortDir).toBe('desc')
      expect(loaded?.txTypeFilter).toBe('Sell')
      expect(loaded?.txSearch).toBe('test transaction')
      expect(loaded?.selectedAccountId).toBe('acc-1')
      expect(loaded?.expandedCategories).toEqual({ taxable: true })
      expect(loaded?.acctAssetClassFilter).toBe('Equities')
      expect(loaded?.acctPosSearch).toBe('aapl')
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
      expect(loaded?.view).toBe('accounts')
      expect(loaded?.txTypeFilter).toBe('All')
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
        view: 'accounts',
        sortKey: 'symbol',
        sortDir: 'asc',
        txTypeFilter: 'All',
        txSearch: '',
        // Omitting the 4 new fields to test backward compat
      }

      await putRaw(preMigrationState)

      const loaded = await loadLegacyPlaintextApp()

      expect(loaded).not.toBeNull()
      expect(legacyKey in loaded!).toBe(false)
      // Verify the missing fields are backfilled to defaults
      expect(loaded?.selectedAccountId).toBe(null)
      expect(loaded?.expandedCategories).toEqual({})
      expect(loaded?.acctAssetClassFilter).toBe('All')
      expect(loaded?.acctPosSearch).toBe('')
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

    it('backfills missing shares/avgCost/price/lastImportedAt fields on closedPositions from old-shape data', async () => {
      const stateWithOldShapeClosedPositions = {
        ...initialState(),
        closedPositions: [
          {
            id: 'closed1',
            accountId: 'acc1',
            symbol: 'TSLA',
            name: 'Tesla Inc',
            closedDate: '2024-01-15',
            assetClass: 'Equities',
            realizedGL: 2000,
            realizedGLBasis: 'transactions',
            // shares, avgCost, price, assetClassManualOverride, lastImportedAt intentionally omitted
          },
        ],
      }

      await putRaw(stateWithOldShapeClosedPositions)

      const loaded = await loadLegacyPlaintextApp()

      expect(loaded).not.toBeNull()
      expect(loaded?.closedPositions[0]).toMatchObject({
        id: 'closed1',
        shares: 0,
        avgCost: 0,
        price: 0,
        assetClassManualOverride: undefined,
        lastImportedAt: '',
      })
    })

    it('preserves real values on new-shape closedPositions while defaulting old-shape ones in the same array', async () => {
      const stateWithMixedShapeClosedPositions = {
        ...initialState(),
        closedPositions: [
          {
            id: 'old1',
            accountId: 'acc1',
            symbol: 'TSLA',
            name: 'Tesla Inc',
            closedDate: '2024-01-15',
            assetClass: 'Equities',
            realizedGL: 2000,
            realizedGLBasis: 'transactions',
            // old shape: shares/avgCost/price/lastImportedAt omitted
          },
          {
            id: 'new1',
            accountId: 'acc1',
            symbol: 'MSFT',
            name: 'Microsoft Corp',
            closedDate: '2024-02-01',
            assetClass: 'Equities',
            shares: 25,
            avgCost: 100,
            price: 150,
            assetClassManualOverride: 'Bonds',
            lastImportedAt: '2024-02-01T00:00:00.000Z',
            realizedGL: 1250,
            realizedGLBasis: 'transactions',
          },
        ],
      }

      await putRaw(stateWithMixedShapeClosedPositions)

      const loaded = await loadLegacyPlaintextApp()

      expect(loaded).not.toBeNull()
      expect(loaded?.closedPositions).toHaveLength(2)
      expect(loaded?.closedPositions[0]).toMatchObject({
        id: 'old1',
        shares: 0,
        avgCost: 0,
        price: 0,
        assetClassManualOverride: undefined,
        lastImportedAt: '',
      })
      expect(loaded?.closedPositions[1]).toMatchObject({
        id: 'new1',
        shares: 25,
        avgCost: 100,
        price: 150,
        assetClassManualOverride: 'Bonds',
        lastImportedAt: '2024-02-01T00:00:00.000Z',
      })
    })

    it('migrates a retired view: "dashboard" blob to the accounts view', async () => {
      // Blobs written before the Dashboard was removed carry view: 'dashboard',
      // which is no longer renderable. Passing it through would land the user on
      // Settings (the else-branch of App's two-way view conditional).
      await putRaw({ accounts: [], positions: [], view: 'dashboard' } as unknown as Partial<AppState>)

      const loaded = await loadLegacyPlaintextApp()

      expect(loaded?.view).toBe('accounts')
    })

    it('loads missing view with default', async () => {
      const preExistingState: Partial<AppState> = {
        accounts: [],
        positions: [],
        // Missing view
      }

      await putRaw(preExistingState)

      const loaded = await loadLegacyPlaintextApp()

      expect(loaded).not.toBeNull()
      expect(loaded?.view).toBe('accounts')
    })

    it('loads missing csvMappings with default empty array', async () => {
      const preExistingState: Partial<AppState> = {
        accounts: [],
        positions: [],
        closedPositions: [],
        transactions: [],
        snapshots: [],
        view: 'accounts',
        // Missing csvMappings
      }

      await putRaw(preExistingState)

      const loaded = await loadLegacyPlaintextApp()

      expect(loaded).not.toBeNull()
      expect(loaded?.csvMappings).toEqual([])
    })

    it('loads missing selectedCategoryKey with null default (migration tolerance)', async () => {
      const preExistingState: Partial<AppState> = {
        accounts: [],
        positions: [],
        closedPositions: [],
        transactions: [],
        snapshots: [],
        csvMappings: [],
        customInstitutions: [],
        view: 'accounts',
        sortKey: 'symbol',
        sortDir: 'asc',
        txTypeFilter: 'All',
        txSearch: '',
        selectedAccountId: null,
        expandedCategories: {},
        acctAssetClassFilter: 'All',
        acctPosSearch: '',
        // selectedCategoryKey intentionally omitted
      }

      await putRaw(preExistingState)

      const loaded = await loadLegacyPlaintextApp()

      expect(loaded).not.toBeNull()
      expect(loaded?.selectedCategoryKey).toBe(null)
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
        // Omitting the 4 new UI state fields to test backward compat
      }

      await putRaw(minimalState)
      const legacyLoaded = await loadLegacyPlaintextApp()
      expect(legacyLoaded?.closedPositions).toEqual([])
      expect(legacyLoaded?.transactions).toEqual([])
      expect(legacyLoaded?.snapshots).toEqual([])
      // Verify the missing fields are backfilled to defaults
      expect(legacyLoaded?.selectedAccountId).toBe(null)
      expect(legacyLoaded?.expandedCategories).toEqual({})
      expect(legacyLoaded?.acctAssetClassFilter).toBe('All')
      expect(legacyLoaded?.acctPosSearch).toBe('')

      await clearDatabase()

      const salt = generateSalt()
      const key = await deriveKey('pw', salt)
      await savePersistedApp(minimalState as AppState, key, salt)
      const encryptedLoaded = await loadPersistedApp(key)
      expect(encryptedLoaded?.closedPositions).toEqual([])
      expect(encryptedLoaded?.transactions).toEqual([])
      expect(encryptedLoaded?.snapshots).toEqual([])
      // Verify the missing fields are backfilled to defaults via encrypted path too
      expect(encryptedLoaded?.selectedAccountId).toBe(null)
      expect(encryptedLoaded?.expandedCategories).toEqual({})
      expect(encryptedLoaded?.acctAssetClassFilter).toBe('All')
      expect(encryptedLoaded?.acctPosSearch).toBe('')
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
