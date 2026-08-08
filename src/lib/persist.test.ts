import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { loadPersistedApp, savePersistedApp } from './persist'
import { initialState } from './state'
import type { AppState } from './state'

describe('IndexedDB persistence', () => {
  // Note: fake-indexeddb requires explicit cleanup between tests
  // We'll use a helper to clear the object store instead
  async function clearDatabase() {
    try {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('portfolio_app_state_v1', 1)
        request.onerror = () => reject(request.error)
        request.onsuccess = () => resolve(request.result)
        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result
          if (!db.objectStoreNames.contains('app_state')) {
            db.createObjectStore('app_state')
          }
        }
      })

      const transaction = db.transaction('app_state', 'readwrite')
      const store = transaction.objectStore('app_state')
      await new Promise<void>((resolve, reject) => {
        const request = store.clear()
        request.onerror = () => reject(request.error)
        request.onsuccess = () => resolve()
      })
      db.close()
    } catch (error) {
      // Ignore errors
    }
  }

  beforeEach(async () => {
    // Clear the object store before each test
    await clearDatabase()
  })

  it('saves then loads all collections byte-for-byte (round-trip)', async () => {
    const originalState: AppState = {
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
      mappingProfiles: [
        {
          id: 'profile1',
          name: 'Default Mapping',
          mappings: {
            AAPL: 'Equities',
          },
        },
      ],
      importSessions: [],

      // UI state
      category: 'all',
      range: '1y',
      tab: 'positions',
      view: 'dashboard',
      sortKey: 'symbol',
      sortDir: 'asc',
      assetClassFilter: 'All',
      retirementFilter: 'All',
      posSearch: 'test search',
      txTypeFilter: 'Buy',
      txSearch: 'tx search',
      showClosed: true,
    }

    await savePersistedApp(originalState)
    const loaded = await loadPersistedApp()

    expect(loaded).toEqual(originalState)
  })

  it('loading with no prior data returns state with empty arrays', async () => {
    const loaded = await loadPersistedApp()

    expect(loaded).toBeNull()
  })

  it('loads a minimal state and fills in missing collections with defaults', async () => {
    const minimalState: Partial<AppState> = {
      accounts: [],
      positions: [],
      // Missing other collections
      category: 'all',
      range: '6m',
      tab: 'transactions',
    }

    // Manually save a minimal state to IndexedDB
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('portfolio_app_state_v1', 1)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains('app_state')) {
          db.createObjectStore('app_state')
        }
      }
    })

    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('app_state', 'readwrite')
      const store = transaction.objectStore('app_state')
      const request = store.put(minimalState, 'current')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve()
    })

    // Load and verify migration tolerance
    const loaded = await loadPersistedApp()

    expect(loaded).not.toBeNull()
    expect(loaded?.accounts).toEqual([])
    expect(loaded?.positions).toEqual([])
    expect(loaded?.closedPositions).toEqual([]) // Should default to []
    expect(loaded?.transactions).toEqual([]) // Should default to []
    expect(loaded?.snapshots).toEqual([]) // Should default to []
    expect(loaded?.mappingProfiles).toEqual([]) // Should default to []
    expect(loaded?.category).toBe('all')
    expect(loaded?.range).toBe('6m')
    expect(loaded?.tab).toBe('transactions')
  })

  it('handles missing collections with defaults', async () => {
    // Test that missing collections are filled with defaults
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
      // Other collections are from initialState
    }

    await savePersistedApp(state)
    const loaded = await loadPersistedApp()

    expect(loaded?.accounts.length).toBe(1)
    expect(loaded?.positions).toEqual([])
    expect(loaded?.transactions).toEqual([])
  })

  it('preserves UI state accurately', async () => {
    const stateWithUIChanges: AppState = {
      ...initialState(),
      category: 'long-term',
      range: '5y',
      tab: 'transactions',
      sortKey: 'gainLoss',
      sortDir: 'desc',
      assetClassFilter: 'Equities',
      retirementFilter: 'Retirement',
      posSearch: 'test position',
      txTypeFilter: 'Sell',
      txSearch: 'test transaction',
      showClosed: true,
    }

    await savePersistedApp(stateWithUIChanges)
    const loaded = await loadPersistedApp()

    expect(loaded?.category).toBe('long-term')
    expect(loaded?.range).toBe('5y')
    expect(loaded?.tab).toBe('transactions')
    expect(loaded?.sortKey).toBe('gainLoss')
    expect(loaded?.sortDir).toBe('desc')
    expect(loaded?.assetClassFilter).toBe('Equities')
    expect(loaded?.retirementFilter).toBe('Retirement')
    expect(loaded?.posSearch).toBe('test position')
    expect(loaded?.txTypeFilter).toBe('Sell')
    expect(loaded?.txSearch).toBe('test transaction')
    expect(loaded?.showClosed).toBe(true)
  })

  it('loads missing importSessions and view with defaults', async () => {
    const preExistingState: Partial<AppState> = {
      accounts: [],
      positions: [],
      category: 'all',
      range: '1y',
      tab: 'positions',
      // Missing importSessions and view
    }

    // Manually save a pre-migration state to IndexedDB
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('portfolio_app_state_v1', 1)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains('app_state')) {
          db.createObjectStore('app_state')
        }
      }
    })

    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('app_state', 'readwrite')
      const store = transaction.objectStore('app_state')
      const request = store.put(preExistingState, 'current')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve()
    })

    // Load and verify migration tolerance
    const loaded = await loadPersistedApp()

    expect(loaded).not.toBeNull()
    expect(loaded?.importSessions).toEqual([])
    expect(loaded?.view).toBe('dashboard')
  })

  it('round-trip with populated importSessions and non-default view', async () => {
    const stateWithNewFields: AppState = {
      ...initialState(),
      importSessions: [
        {
          id: 'session1',
          fileName: 'positions_2024.csv',
          kind: 'positions',
          importedAt: '2024-01-15T10:30:00Z',
          accountIds: ['acc1'],
          rowCount: 10,
        },
      ],
      view: 'settings',
    }

    await savePersistedApp(stateWithNewFields)
    const loaded = await loadPersistedApp()

    expect(loaded?.importSessions).toEqual(stateWithNewFields.importSessions)
    expect(loaded?.view).toBe('settings')
  })
})
