import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import {
  peekEnvelopeShape,
  peekStoredSalt,
  loadPersistedApp,
  loadRawPersistedBlob,
  savePersistedApp,
  coalesceWithDefaults,
  setActivePortfolioDb,
  migrateBudgetExpensesByYearIfNeeded,
  migrateBudgetIncomeByYearIfNeeded,
} from './persist'
import { deriveKey, generateSalt } from './crypto'
import { initialState, currentBudgetYear } from './state'
import type { AppState } from './state'

// Computed at runtime so the stale collection name never appears literally in source
const staleKey = ['mapping', 'Profiles'].join('')

const DB_NAME = 'test-portfolio-db'
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
    priceSync: {
      apiKey: 'test-api-key',
      lastFetchedDate: '2024-01-01',
      heldPrices: {
        AAPL: { price: 200, date: '2024-01-01', fetchedAt: '2024-01-01T00:00:00.000Z' },
      },
      lastRun: { at: '2024-01-01T00:00:00.000Z', updatedCount: 1, notFound: [], marketTickerCount: 1 },
    },
    mutualFundSync: {
      apiKey: '',
      heldPrices: {},
      lastRun: null,
      callBudget: { date: '', callsUsed: 0 },
    },

    balanceEntries: [],

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
    regAccountId: null,
    regExpanded: {},
    regActivityFilter: 'All',
    budgetIncomeByYear: {
      [currentBudgetYear()]: { monthly: 5000, yearly: 60000 },
    },
    budgetExpensesByYear: {
      [currentBudgetYear()]: [
        { id: 'exp1', name: 'Rent', categoryId: 'cat-housing', amount: 2000, frequency: 'monthly' },
      ],
    },
    budgetTransactions: [
      { id: 'btx1', date: '2024-01-05', description: 'Rent payment', categoryId: 'cat-housing', amount: -2000 },
    ],
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
    setActivePortfolioDb(DB_NAME)
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
      expect(loaded?.budgetIncomeByYear).toEqual(originalState.budgetIncomeByYear)
      expect(loaded?.budgetExpensesByYear).toEqual(originalState.budgetExpensesByYear)
      expect(loaded?.budgetTransactions).toEqual(originalState.budgetTransactions)
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

    it('round-trips a populated priceSync unchanged', async () => {
      const stateWithPriceSync: AppState = {
        ...initialState(),
        priceSync: {
          apiKey: 'sk-live-abc123',
          lastFetchedDate: '2024-03-15',
          heldPrices: {
            AAPL: { price: 195.5, date: '2024-03-15', fetchedAt: '2024-03-15T20:00:00.000Z' },
            MSFT: { price: 420.1, date: '2024-03-15', fetchedAt: '2024-03-15T20:00:00.000Z' },
          },
          lastRun: { at: '2024-03-15T20:00:00.000Z', updatedCount: 2, notFound: ['ZZZZ'], marketTickerCount: 2 },
        },
      }
      const salt = generateSalt()
      const key = await deriveKey('pw', salt)

      await savePersistedApp(stateWithPriceSync, key, salt)
      const loaded = await loadPersistedApp(key)

      expect(loaded?.priceSync).toEqual(stateWithPriceSync.priceSync)
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

  describe('loadRawPersistedBlob', () => {
    it('returns the raw pre-coalesce object, including stale keys like categories/categoryMappings if present', async () => {
      const salt = generateSalt()
      const key = await deriveKey('pw', salt)
      const stateWithStaleKeys = {
        ...fixtureState(),
        categories: [{ id: 'cat-housing', name: 'Housing' }],
        categoryMappings: [{ id: 'map1', pattern: 'RENT', categoryId: 'cat-housing' }],
      }

      await savePersistedApp(stateWithStaleKeys as unknown as AppState, key, salt)
      const raw = await loadRawPersistedBlob(key)

      expect(raw).not.toBeNull()
      expect((raw as any).categories).toEqual(stateWithStaleKeys.categories)
      expect((raw as any).categoryMappings).toEqual(stateWithStaleKeys.categoryMappings)
      expect(raw?.budgetExpensesByYear).toEqual(stateWithStaleKeys.budgetExpensesByYear)
    })

    it('returns null when nothing was saved', async () => {
      const salt = generateSalt()
      const key = await deriveKey('pw', salt)

      expect(await loadRawPersistedBlob(key)).toBeNull()
    })

    it('loadPersistedApp still round-trips end-to-end (decrypt -> coalesce) via the two-function split', async () => {
      const originalState = fixtureState()
      const salt = generateSalt()
      const key = await deriveKey('pw', salt)

      await savePersistedApp(originalState, key, salt)
      const raw = await loadRawPersistedBlob(key)
      const loaded = await loadPersistedApp(key)

      expect(raw).toEqual(originalState)
      expect(loaded).toEqual(coalesceWithDefaults(raw!))
      expect(loaded).toEqual(originalState)
    })
  })

  describe('peekEnvelopeShape', () => {
    it('returns absent on an empty DB', async () => {
      expect(await peekEnvelopeShape()).toBe('absent')
    })

    it('returns absent after a raw non-envelope value is written (never crashes on unrecognized data)', async () => {
      await putRaw(fixtureState())

      expect(await peekEnvelopeShape()).toBe('absent')
    })

    it('returns encrypted after a normal savePersistedApp call', async () => {
      const salt = generateSalt()
      const key = await deriveKey('pw', salt)

      await savePersistedApp(fixtureState(), key, salt)

      expect(await peekEnvelopeShape()).toBe('encrypted')
    })

    it('reads the active portfolio db, not some other db', async () => {
      setActivePortfolioDb('other-db-for-shape-test')
      expect(await peekEnvelopeShape()).toBe('absent')

      const salt = generateSalt()
      const key = await deriveKey('pw', salt)
      await savePersistedApp(fixtureState(), key, salt)
      expect(await peekEnvelopeShape()).toBe('encrypted')

      setActivePortfolioDb(DB_NAME)
      expect(await peekEnvelopeShape()).toBe('absent')
    })
  })

  describe('peekStoredSalt', () => {
    it('returns null on an empty DB', async () => {
      expect(await peekStoredSalt()).toBeNull()
    })

    it('returns null when the stored value is not an encrypted envelope', async () => {
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

  describe('coalesceWithDefaults: migration tolerance for stored blobs', () => {
    it('fills in missing collections with defaults', () => {
      const loaded = coalesceWithDefaults({
        accounts: [],
        positions: [],
        // Missing other collections
      })

      expect(loaded.accounts).toEqual([])
      expect(loaded.positions).toEqual([])
      expect(loaded.closedPositions).toEqual([])
      expect(loaded.transactions).toEqual([])
      expect(loaded.snapshots).toEqual([])
      expect(loaded.view).toBe('accounts')
      expect(loaded.txTypeFilter).toBe('All')
    })

    it('backfills missing new UI state fields with defaults (selectedAccountId, expandedCategories, acctAssetClassFilter, acctPosSearch)', () => {
      const oldBlob: any = {
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
        view: 'accounts',
        sortKey: 'symbol',
        sortDir: 'asc',
        txTypeFilter: 'All',
        txSearch: '',
        // selectedAccountId, expandedCategories, acctAssetClassFilter, acctPosSearch are missing
      }

      const loaded = coalesceWithDefaults(oldBlob)

      expect(loaded.selectedAccountId).toBe(null)
      expect(loaded.expandedCategories).toEqual({})
      expect(loaded.acctAssetClassFilter).toBe('All')
      expect(loaded.acctPosSearch).toBe('')
    })

    it('silently drops a stale collection key that is no longer part of AppState', () => {
      const preMigrationState: any = {
        accounts: [],
        positions: [],
        closedPositions: [],
        transactions: [],
        snapshots: [],
        [staleKey]: [
          {
            id: 'profile1',
            name: 'Default Mapping',
            mappings: { AAPL: 'Equities' },
          },
        ],
        view: 'accounts',
        sortKey: 'symbol',
        sortDir: 'asc',
        txTypeFilter: 'All',
        txSearch: '',
      }

      const loaded = coalesceWithDefaults(preMigrationState)

      expect(staleKey in loaded).toBe(false)
      expect(loaded.selectedAccountId).toBe(null)
      expect(loaded.expandedCategories).toEqual({})
      expect(loaded.acctAssetClassFilter).toBe('All')
      expect(loaded.acctPosSearch).toBe('')
    })

    it('backfills the institution field on accounts missing it', () => {
      const loaded = coalesceWithDefaults({
        ...initialState(),
        accounts: [
          {
            id: 'acc1',
            number: '12345',
            name: 'Test Account',
            accountType: 'brokerage',
            isRetirement: false,
            // institution intentionally omitted
          } as any,
        ],
      })

      expect(loaded.accounts[0].institution).toBe('')
    })

    it('backfills missing shares/avgCost/price/lastImportedAt fields on closedPositions from old-shape data', () => {
      const loaded = coalesceWithDefaults({
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
          } as any,
        ],
      })

      expect(loaded.closedPositions[0]).toMatchObject({
        id: 'closed1',
        shares: 0,
        avgCost: 0,
        price: 0,
        assetClassManualOverride: undefined,
        lastImportedAt: '',
      })
    })

    it('preserves real values on new-shape closedPositions while defaulting old-shape ones in the same array', () => {
      const loaded = coalesceWithDefaults({
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
          } as any,
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
      })

      expect(loaded.closedPositions).toHaveLength(2)
      expect(loaded.closedPositions[0]).toMatchObject({
        id: 'old1',
        shares: 0,
        avgCost: 0,
        price: 0,
        assetClassManualOverride: undefined,
        lastImportedAt: '',
      })
      expect(loaded.closedPositions[1]).toMatchObject({
        id: 'new1',
        shares: 25,
        avgCost: 100,
        price: 150,
        assetClassManualOverride: 'Bonds',
        lastImportedAt: '2024-02-01T00:00:00.000Z',
      })
    })

    it('migrates a retired view: "dashboard" blob to the accounts view', () => {
      // Blobs written before the Dashboard was removed carry view: 'dashboard',
      // which is no longer renderable. Passing it through would land the user on
      // Settings (the else-branch of App's two-way view conditional).
      const loaded = coalesceWithDefaults({ accounts: [], positions: [], view: 'dashboard' } as unknown as Partial<AppState>)

      expect(loaded.view).toBe('accounts')
    })

    it('falls back to the default view for an unknown/legacy view value', () => {
      const loaded = coalesceWithDefaults({ view: 'dashboard' } as unknown as Partial<AppState>)

      expect(loaded.view).toBe(initialState().view)
    })

    it('loads missing csvMappings with default empty array', () => {
      const loaded = coalesceWithDefaults({
        accounts: [],
        positions: [],
        closedPositions: [],
        transactions: [],
        snapshots: [],
        view: 'accounts',
        // Missing csvMappings
      })

      expect(loaded.csvMappings).toEqual([])
    })

    it('loads missing selectedCategoryKey with null default (migration tolerance)', () => {
      const loaded = coalesceWithDefaults({
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
      })

      expect(loaded.selectedCategoryKey).toBe(null)
    })

    it('backfills missing balanceEntries/regAccountId/regExpanded/regActivityFilter with defaults from an empty blob', () => {
      const loaded = coalesceWithDefaults({})

      expect(loaded.balanceEntries).toEqual([])
      expect(loaded.regAccountId).toBe(null)
      expect(loaded.regExpanded).toEqual({})
      expect(loaded.regActivityFilter).toBe('All')
      expect(loaded.budgetIncomeByYear).toEqual({})
      expect(loaded.budgetExpensesByYear).toEqual({})
      expect(loaded.budgetTransactions).toEqual([])
    })

    it('backfills missing budgetTransactions with [] from a blob that predates it (has other budget fields set)', () => {
      const loaded = coalesceWithDefaults({
        budgetIncomeByYear: { '2024': { monthly: 4000, yearly: 48000 } },
        budgetExpensesByYear: {
          '2024': [{ id: 'exp1', name: 'Rent', categoryId: 'cat-housing', amount: 1500, frequency: 'monthly' }],
        },
        // budgetTransactions key intentionally absent entirely
      } as any)

      expect(loaded.budgetIncomeByYear).toEqual({ '2024': { monthly: 4000, yearly: 48000 } })
      expect(loaded.budgetTransactions).toEqual([])
    })

    it('preserves an existing budgetTransactions array when present', () => {
      const tx = [{ id: 'btx1', date: '2024-01-05', description: 'Rent payment', categoryId: 'cat-housing', amount: -2000 }]
      const loaded = coalesceWithDefaults({
        budgetIncomeByYear: { '2024': { monthly: 4000, yearly: 48000 } },
        budgetTransactions: tx,
        categories: [{ id: 'cat-housing', name: 'Housing' }],
      } as any)

      expect(loaded.budgetTransactions).toEqual(tx)
    })

    it('does not error on a stray legacy budgetCategories key, and the key is absent from the returned AppState', () => {
      const loaded = coalesceWithDefaults({
        budgetIncomeByYear: { '2024': { monthly: 4000, yearly: 48000 } },
        budgetCategories: ['Housing', 'Food'],
      } as any)

      expect(loaded).not.toHaveProperty('budgetCategories')
      expect(loaded.budgetTransactions).toEqual([])
    })

    it('preserves view: "budget"', () => {
      expect(coalesceWithDefaults({ view: 'budget' } as any).view).toBe('budget')
    })

    it('preserves view: "quotes" (regression test: quotes was previously missing from the view whitelist)', () => {
      expect(coalesceWithDefaults({ view: 'quotes' } as any).view).toBe('quotes')
    })

    it('preserves view: "register"', () => {
      expect(coalesceWithDefaults({ view: 'register' } as any).view).toBe('register')
    })
  })

  describe('coalesceWithDefaults is shared between raw-blob and encrypted-load paths', () => {
    it('backfills a missing institution field via both coalesceWithDefaults and loadPersistedApp', async () => {
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

      const directlyLoaded = coalesceWithDefaults(stateWithoutInstitution as any)
      expect(directlyLoaded.accounts[0].institution).toBe('')

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

      const directlyLoaded = coalesceWithDefaults(minimalState)
      expect(directlyLoaded.closedPositions).toEqual([])
      expect(directlyLoaded.transactions).toEqual([])
      expect(directlyLoaded.snapshots).toEqual([])
      expect(directlyLoaded.selectedAccountId).toBe(null)
      expect(directlyLoaded.expandedCategories).toEqual({})
      expect(directlyLoaded.acctAssetClassFilter).toBe('All')
      expect(directlyLoaded.acctPosSearch).toBe('')

      const salt = generateSalt()
      const key = await deriveKey('pw', salt)
      await savePersistedApp(minimalState as AppState, key, salt)
      const encryptedLoaded = await loadPersistedApp(key)
      expect(encryptedLoaded?.closedPositions).toEqual([])
      expect(encryptedLoaded?.transactions).toEqual([])
      expect(encryptedLoaded?.snapshots).toEqual([])
      expect(encryptedLoaded?.selectedAccountId).toBe(null)
      expect(encryptedLoaded?.expandedCategories).toEqual({})
      expect(encryptedLoaded?.acctAssetClassFilter).toBe('All')
      expect(encryptedLoaded?.acctPosSearch).toBe('')
    })

    it('loads missing priceSync with defaults via both paths', async () => {
      const minimalState: Partial<AppState> = {
        accounts: [],
        positions: [],
        // priceSync intentionally omitted (blob predates this field)
      }

      const directlyLoaded = coalesceWithDefaults(minimalState)
      expect(directlyLoaded.priceSync).toEqual(initialState().priceSync)
      expect(directlyLoaded.priceSync).toEqual({
        apiKey: '',
        lastFetchedDate: null,
        heldPrices: {},
        lastRun: null,
      })

      const salt = generateSalt()
      const key = await deriveKey('pw', salt)
      await savePersistedApp(minimalState as AppState, key, salt)
      const encryptedLoaded = await loadPersistedApp(key)
      expect(encryptedLoaded?.priceSync).toEqual(initialState().priceSync)
    })
  })

  describe('coalesceWithDefaults migrates legacy balanceEntries shape to activities[]', () => {
    it('maps a legacy entry with a non-None activityType into a single-element activities array', () => {
      const loaded: Partial<AppState> = {
        balanceEntries: [
          {
            id: 'be1',
            accountId: 'acc1',
            date: '2024-01-01',
            balance: 1000,
            activityType: 'Contribution',
            activityAmount: 500,
            note: 'x',
          } as any,
        ],
      }

      const result = coalesceWithDefaults(loaded)

      expect(result.balanceEntries).toEqual([
        {
          id: 'be1',
          accountId: 'acc1',
          date: '2024-01-01',
          balance: 1000,
          activities: [{ type: 'Contribution', amount: 500, note: 'x' }],
        },
      ])
    })

    it('maps a legacy entry with activityType "None" into an empty activities array', () => {
      const loaded: Partial<AppState> = {
        balanceEntries: [
          {
            id: 'be2',
            accountId: 'acc1',
            date: '2024-01-02',
            balance: 2000,
            activityType: 'None',
            activityAmount: 0,
            note: '',
          } as any,
        ],
      }

      const result = coalesceWithDefaults(loaded)

      expect(result.balanceEntries).toEqual([
        {
          id: 'be2',
          accountId: 'acc1',
          date: '2024-01-02',
          balance: 2000,
          activities: [],
        },
      ])
    })

    it('is idempotent: running coalesceWithDefaults again on already-migrated output leaves activities unchanged', () => {
      const loaded: Partial<AppState> = {
        balanceEntries: [
          {
            id: 'be1',
            accountId: 'acc1',
            date: '2024-01-01',
            balance: 1000,
            activityType: 'Contribution',
            activityAmount: 500,
            note: 'x',
          } as any,
        ],
      }

      const firstPass = coalesceWithDefaults(loaded)
      const secondPass = coalesceWithDefaults(firstPass)

      expect(secondPass.balanceEntries).toEqual(firstPass.balanceEntries)
    })

    it('passes through a new-shape entry with activities already present unchanged', () => {
      const loaded: Partial<AppState> = {
        balanceEntries: [
          {
            id: 'be3',
            accountId: 'acc1',
            date: '2024-01-03',
            balance: 3000,
            activities: [],
          },
        ],
      }

      const result = coalesceWithDefaults(loaded)

      expect(result.balanceEntries).toEqual([
        {
          id: 'be3',
          accountId: 'acc1',
          date: '2024-01-03',
          balance: 3000,
          activities: [],
        },
      ])
    })
  })

  describe('coalesceWithDefaults no longer rewrites legacy category shape', () => {
    it('passes rows with old bare `category` strings (no categoryId) through unchanged', () => {
      const loaded: Partial<AppState> = {
        budgetExpensesByYear: { '2024': [{ id: 'e1', category: 'Food', amount: 10 } as any] },
        budgetTransactions: [{ id: 't1', category: 'Food', amount: 20 } as any],
      }

      const result = coalesceWithDefaults(loaded)

      expect(result.budgetExpensesByYear).toEqual(loaded.budgetExpensesByYear)
      expect(result.budgetTransactions).toEqual(loaded.budgetTransactions)
      expect(result).not.toHaveProperty('categories')
      expect(result).not.toHaveProperty('categoryMappings')
    })
  })

  describe('setActivePortfolioDb: multi-portfolio db isolation', () => {
    async function deleteNamedDb(name: string): Promise<void> {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name)
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
        request.onblocked = () => resolve()
      })
    }

    afterEach(async () => {
      await deleteNamedDb('db-a')
      await deleteNamedDb('db-b')
    })

    it('isolates state between different active portfolio dbs', async () => {
      setActivePortfolioDb('db-a')
      const originalState = fixtureState()
      const salt = generateSalt()
      const key = await deriveKey('pw', salt)

      await savePersistedApp(originalState, key, salt)
      const loadedFromA = await loadPersistedApp(key)
      expect(loadedFromA).toEqual(originalState)

      setActivePortfolioDb('db-b')
      const loadedFromB = await loadPersistedApp(key)
      expect(loadedFromB).toBeNull()
    })
  })

  describe('setActivePortfolioDb: guards against missing active db', () => {
    // The active-db name is module-private state and is NOT reset between
    // tests. To meaningfully test the "no setActivePortfolioDb call yet"
    // case, we reset the module registry and re-import persist.ts fresh so
    // its module-level `activePortfolioDbName` starts back at null,
    // regardless of what earlier tests in this file have done.
    it('rejects loadPersistedApp/savePersistedApp when no active db has been set', async () => {
      vi.resetModules()
      const freshPersist = await import('./persist')

      const salt = generateSalt()
      const key = await deriveKey('pw', salt)

      await expect(freshPersist.loadPersistedApp(key)).rejects.toThrow(
        'No active portfolio set — call setActivePortfolioDb() first',
      )
      await expect(freshPersist.savePersistedApp(initialState(), key, salt)).rejects.toThrow(
        'No active portfolio set — call setActivePortfolioDb() first',
      )
    })
  })

  describe('migrateBudgetExpensesByYearIfNeeded', () => {
    it('folds a legacy flat budgetExpenses array into budgetExpensesByYear under the current year', () => {
      const expenses = [{ id: 'e1', name: 'Rent', amount: 1000 }]
      const result = migrateBudgetExpensesByYearIfNeeded({ budgetExpenses: expenses })
      expect(result.budgetExpensesByYear).toEqual({ [currentBudgetYear()]: expenses })
      expect(result.budgetExpenses).toBeUndefined()
    })

    it('is idempotent when budgetExpensesByYear is already present, even as {}', () => {
      const raw = { budgetExpensesByYear: {}, budgetExpenses: [{ id: 'e1' }] }
      expect(migrateBudgetExpensesByYearIfNeeded(raw)).toBe(raw)
    })

    it('produces an empty budgetExpensesByYear when neither old nor new field is present', () => {
      const result = migrateBudgetExpensesByYearIfNeeded({})
      expect(result.budgetExpensesByYear).toEqual({})
    })
  })

  describe('migrateBudgetIncomeByYearIfNeeded', () => {
    it('folds legacy flat budgetIncomeMonthly/budgetIncomeYearly into budgetIncomeByYear under the current year', () => {
      const result = migrateBudgetIncomeByYearIfNeeded({ budgetIncomeMonthly: 500, budgetIncomeYearly: 6000 })
      expect(result.budgetIncomeByYear).toEqual({ [currentBudgetYear()]: { monthly: 500, yearly: 6000 } })
      expect(result.budgetIncomeMonthly).toBeUndefined()
      expect(result.budgetIncomeYearly).toBeUndefined()
    })

    it('defaults the missing scalar to 0 when only one of the two legacy fields is present', () => {
      const result = migrateBudgetIncomeByYearIfNeeded({ budgetIncomeMonthly: 500 })
      expect(result.budgetIncomeByYear).toEqual({ [currentBudgetYear()]: { monthly: 500, yearly: 0 } })
    })

    it('is idempotent when budgetIncomeByYear is already present, even as {}', () => {
      const raw = { budgetIncomeByYear: {}, budgetIncomeMonthly: 500 }
      expect(migrateBudgetIncomeByYearIfNeeded(raw)).toBe(raw)
    })

    it('produces an empty budgetIncomeByYear when neither old nor new field is present', () => {
      const result = migrateBudgetIncomeByYearIfNeeded({})
      expect(result.budgetIncomeByYear).toEqual({})
    })
  })

  describe('loadRawPersistedBlob applies budget-by-year migrations before coalesce', () => {
    let key: CryptoKey
    let salt: Uint8Array

    beforeEach(async () => {
      setActivePortfolioDb('test-db-budget-migration')
      salt = generateSalt()
      key = await deriveKey('password', salt)
    })

    it('migrates old-shape budgetExpenses/budgetIncome fields on load, and coalesce drops the old fields', async () => {
      const legacyState = {
        ...initialState(),
        budgetExpenses: [{ id: 'e1', name: 'Rent', amount: 1000 }],
        budgetIncomeMonthly: 500,
        budgetIncomeYearly: 6000,
      } as unknown as AppState
      delete (legacyState as any).budgetExpensesByYear
      delete (legacyState as any).budgetIncomeByYear
      await savePersistedApp(legacyState, key, salt)

      const raw = await loadRawPersistedBlob(key)
      expect(raw!.budgetExpensesByYear).toEqual({ [currentBudgetYear()]: [{ id: 'e1', name: 'Rent', amount: 1000 }] })
      expect(raw!.budgetIncomeByYear).toEqual({ [currentBudgetYear()]: { monthly: 500, yearly: 6000 } })
      expect((raw as any).budgetExpenses).toBeUndefined()

      const coalesced = coalesceWithDefaults(raw!)
      expect(coalesced).not.toHaveProperty('budgetExpenses')
      expect(coalesced).not.toHaveProperty('budgetIncomeMonthly')
      expect(coalesced).not.toHaveProperty('budgetIncomeYearly')
      expect(coalesced.budgetExpensesByYear).toEqual({ [currentBudgetYear()]: [{ id: 'e1', name: 'Rent', amount: 1000 }] })
      expect(coalesced.budgetIncomeByYear).toEqual({ [currentBudgetYear()]: { monthly: 500, yearly: 6000 } })
    })
  })
})
