import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import {
  loadGlobalCategoryState,
  saveGlobalCategoryState,
  isGlobalStoreSeeded,
  markGlobalStoreSeeded,
  getLastKnownRemoteModifiedTime,
  setLastKnownRemoteModifiedTime,
  getSharedCategoryDriveFileId,
  setSharedCategoryDriveFileId,
  _resetCategoryDbForTests,
} from './categoryPersist'
import { initialGlobalCategoryState } from './categoryStore'
import type { GlobalCategoryState } from './categoryStore'

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
    const state = await loadGlobalCategoryState()
    expect(state).toEqual(initialGlobalCategoryState())
  })

  it('saveGlobalCategoryState then loadGlobalCategoryState round-trips exactly', async () => {
    const state: GlobalCategoryState = {
      categories: [{ id: 'cat-1', name: 'Groceries', updatedAt: '2026-01-01T00:00:00.000Z' }],
      budgetAccountRules: [{ id: 'rule-1', accountId: 'account-1', sign: 'negative' }],
    }
    await saveGlobalCategoryState(state)
    const loaded = await loadGlobalCategoryState()
    expect(loaded).toEqual(state)
  })

  it('defaults budgetAccountRules for a stored state that predates the field', async () => {
    const oldState = {
      categories: [{ id: 'cat-1', name: 'Groceries', updatedAt: '2026-01-01T00:00:00.000Z' }],
      categoryMappings: [],
    }
    await saveGlobalCategoryState(oldState as GlobalCategoryState)

    await expect(loadGlobalCategoryState()).resolves.toEqual({
      categories: oldState.categories,
      budgetAccountRules: [],
    })
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

  it('getSharedCategoryDriveFileId starts undefined, round-trips, and clears', async () => {
    expect(await getSharedCategoryDriveFileId()).toBeUndefined()
    await setSharedCategoryDriveFileId('drive-file-123')
    expect(await getSharedCategoryDriveFileId()).toBe('drive-file-123')
    await setSharedCategoryDriveFileId(null)
    expect(await getSharedCategoryDriveFileId()).toBeUndefined()
  })

  it('is independent of any setActivePortfolioDb call', async () => {
    // This test never touches persist.ts / setActivePortfolioDb at all,
    // and categoryPersist must still work cleanly on its own db.
    const state = await loadGlobalCategoryState()
    expect(state).toEqual(initialGlobalCategoryState())
    await saveGlobalCategoryState({ categories: [], budgetAccountRules: [] })
    expect(await loadGlobalCategoryState()).toEqual({ categories: [], budgetAccountRules: [] })
  })

})
