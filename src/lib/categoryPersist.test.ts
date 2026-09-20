import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import {
  loadGlobalCategoryState,
  saveGlobalCategoryState,
  isGlobalStoreSeeded,
  markGlobalStoreSeeded,
  getLastKnownRemoteModifiedTime,
  setLastKnownRemoteModifiedTime,
  _resetCategoryDbForTests,
} from './categoryPersist'
import { initialGlobalCategoryState } from './categoryStore'
import type { GlobalCategoryState } from './categoryStore'
import type { CategoryMapping, ExpenseDefinition } from './types'

const DB_NAME = 'ledger_global_categories_v1'
const STATE_STORE = 'state'
const META_STORE = 'meta'

// Note (mirrors portfolioRegistry.test.ts): categoryPersist.ts memoizes a
// single open IDBDatabase connection for the lifetime of the module and
// never closes it. Calling indexedDB.deleteDatabase against a db with a
// live, unclosed connection hangs forever under fake-indexeddb. So instead
// of deleting the database between tests, clear its object stores directly
// and reset the module's cached connection promise so it reopens cleanly.
async function clearCategoryStores(): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = (event) => {
      const upgradeDb = (event.target as IDBOpenDBRequest).result
      if (!upgradeDb.objectStoreNames.contains(STATE_STORE)) {
        upgradeDb.createObjectStore(STATE_STORE)
      }
      if (!upgradeDb.objectStoreNames.contains(META_STORE)) {
        upgradeDb.createObjectStore(META_STORE)
      }
    }
  })

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STATE_STORE, META_STORE], 'readwrite')
    tx.objectStore(STATE_STORE).clear()
    tx.objectStore(META_STORE).clear()
    tx.onerror = () => reject(tx.error)
    tx.oncomplete = () => resolve()
  })
  db.close()
}

beforeEach(async () => {
  await clearCategoryStores()
  _resetCategoryDbForTests()
})

describe('categoryPersist', () => {
  it('loadGlobalCategoryState on a fresh db returns initialGlobalCategoryState()', async () => {
    const state = await loadGlobalCategoryState([])
    expect(state).toEqual(initialGlobalCategoryState())
  })

  it('saveGlobalCategoryState then loadGlobalCategoryState round-trips exactly', async () => {
    const state: GlobalCategoryState = {
      categories: [{ id: 'cat-1', name: 'Groceries', updatedAt: '2026-01-01T00:00:00.000Z' }],
      categoryMappings: [
        { id: 'catmap-1', substring: 'trader joe', spendExpenseId: 'exp-1', updatedAt: '2026-01-01T00:00:00.000Z' },
      ],
      budgetAccountRules: [{ id: 'rule-1', accountId: 'account-1', sign: 'negative' }],
    }
    await saveGlobalCategoryState(state)
    const loaded = await loadGlobalCategoryState([])
    expect(loaded).toEqual(state)
  })

  it('defaults budgetAccountRules for a stored state that predates the field', async () => {
    const oldState = {
      categories: [{ id: 'cat-1', name: 'Groceries', updatedAt: '2026-01-01T00:00:00.000Z' }],
      categoryMappings: [],
    }
    await saveGlobalCategoryState(oldState as GlobalCategoryState)

    await expect(loadGlobalCategoryState([])).resolves.toEqual({ ...oldState, budgetAccountRules: [] })
  })

  it('isGlobalStoreSeeded starts false; markGlobalStoreSeeded flips it to true; second call is a no-op', async () => {
    expect(await isGlobalStoreSeeded()).toBe(false)
    await markGlobalStoreSeeded()
    expect(await isGlobalStoreSeeded()).toBe(true)
    await markGlobalStoreSeeded()
    expect(await isGlobalStoreSeeded()).toBe(true)
  })

  it('getLastKnownRemoteModifiedTime starts undefined; round-trips after set', async () => {
    expect(await getLastKnownRemoteModifiedTime()).toBeUndefined()
    await setLastKnownRemoteModifiedTime('2026-02-03T04:05:06.000Z')
    expect(await getLastKnownRemoteModifiedTime()).toBe('2026-02-03T04:05:06.000Z')
  })

  it('is independent of any setActivePortfolioDb call', async () => {
    // This test never touches persist.ts / setActivePortfolioDb at all,
    // and categoryPersist must still work cleanly on its own db.
    const state = await loadGlobalCategoryState([])
    expect(state).toEqual(initialGlobalCategoryState())
    await saveGlobalCategoryState({ categories: [], categoryMappings: [], budgetAccountRules: [] })
    expect(await loadGlobalCategoryState([])).toEqual({ categories: [], categoryMappings: [], budgetAccountRules: [] })
  })

  describe('categoryId → spendExpenseId one-time migration', () => {
    const TS = '2026-01-01T00:00:00.000Z'
    // Legacy (pre-spendkey) rows predate CategoryMapping.spendExpenseId, so
    // they need a local cast — categoryId must NOT be re-added to the type.
    const legacyMapping = (id: string, substring: string, categoryId: string) =>
      ({ id, substring, categoryId, updatedAt: TS }) as unknown as CategoryMapping
    const defs: ExpenseDefinition[] = [
      { id: 'exp-1', name: 'Groceries', categoryId: 'cat-1', frequency: 'monthly' },
    ]

    it('migrates an old-shape mapping with a resolvable categoryId to spendExpenseId and persists it', async () => {
      await saveGlobalCategoryState({
        categories: [{ id: 'cat-1', name: 'Groceries', updatedAt: TS }],
        categoryMappings: [legacyMapping('catmap-1', 'trader joe', 'cat-1')],
      })
      const loaded = await loadGlobalCategoryState(defs)
      expect(loaded.categoryMappings).toHaveLength(1)
      expect(loaded.categoryMappings[0]).toMatchObject({
        id: 'catmap-1',
        substring: 'trader joe',
        spendExpenseId: 'exp-1',
      })
      expect('categoryId' in loaded.categoryMappings[0]).toBe(false)
      // Persisted back: a follow-up load with EMPTY defs still sees the
      // migrated row (without the save-back it would have been dropped).
      expect(await loadGlobalCategoryState([])).toEqual(loaded)
    })

    it('drops an old-shape mapping whose categoryId matches no ExpenseDefinition', async () => {
      await saveGlobalCategoryState({
        categories: [],
        categoryMappings: [legacyMapping('catmap-gone', 'old store', 'cat-nope')],
      })
      const loaded = await loadGlobalCategoryState(defs)
      expect(loaded.categoryMappings).toEqual([])
      // The drop was persisted: even defs that WOULD have matched find
      // nothing left to migrate on a follow-up load.
      const matchingLater: ExpenseDefinition[] = [
        ...defs,
        { id: 'exp-9', name: 'Old Store', categoryId: 'cat-nope', frequency: 'monthly' },
      ]
      expect(await loadGlobalCategoryState(matchingLater)).toEqual(loaded)
    })

    it('leaves an already-migrated mapping untouched without re-saving', async () => {
      const state: GlobalCategoryState = {
        categories: [],
        categoryMappings: [
          { id: 'catmap-1', substring: 'trader joe', spendExpenseId: 'exp-1', updatedAt: TS },
        ],
        budgetAccountRules: [],
      }
      await saveGlobalCategoryState(state)
      const loaded = await loadGlobalCategoryState(defs)
      expect(loaded).toEqual(state)
      // Stable across loads and independent of defs — no re-run, no re-save.
      expect(await loadGlobalCategoryState([])).toEqual(state)
      expect(await loadGlobalCategoryState(defs)).toEqual(state)
    })

    it('handles a mixed batch: some migrate, some drop, some already-migrated', async () => {
      await saveGlobalCategoryState({
        categories: [],
        categoryMappings: [
          legacyMapping('catmap-migrate', 'trader joe', 'cat-1'),
          legacyMapping('catmap-drop', 'old store', 'cat-nope'),
          { id: 'catmap-kept', substring: 'shell', spendExpenseId: 'exp-9', updatedAt: TS },
        ],
      })
      const loaded = await loadGlobalCategoryState([
        ...defs,
        { id: 'exp-9', name: 'Gas', categoryId: 'cat-9', frequency: 'monthly' },
      ])
      expect(loaded.categoryMappings).toHaveLength(2)
      expect(loaded.categoryMappings[0]).toMatchObject({
        id: 'catmap-migrate',
        spendExpenseId: 'exp-1',
      })
      expect('categoryId' in loaded.categoryMappings[0]).toBe(false)
      expect(loaded.categoryMappings[1]).toEqual({
        id: 'catmap-kept',
        substring: 'shell',
        spendExpenseId: 'exp-9',
        updatedAt: TS,
      })
      expect(loaded.categoryMappings.some((m) => 'categoryId' in m)).toBe(false)
    })
  })
})
