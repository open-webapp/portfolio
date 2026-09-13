import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import {
  listPortfolios,
  createPortfolio,
  migrateLegacyDbIfNeeded,
  isMigratedPortfolio,
  _resetRegistryForTests,
} from './portfolioRegistry'

const REGISTRY_DB_NAME = 'portfolio-registry'
const REGISTRY_STORE_NAME = 'portfolios'
const LEGACY_DB_NAME = 'portfolio_app_state_v1'

function deleteDb(name: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name)
    request.onsuccess = () => resolve()
    request.onblocked = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

/**
 * The registry module keeps a single cached IDBDatabase connection open for
 * the lifetime of the module (only _resetRegistryForTests's cached-promise
 * reset clears it, without closing the underlying connection). That means
 * indexedDB.deleteDatabase(REGISTRY_DB_NAME) would block forever once any
 * test has opened it. So instead of deleting the registry db between tests,
 * clear its store contents directly via a throwaway connection.
 */
function resetRegistryDb(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(REGISTRY_DB_NAME, 1)
    request.onerror = () => reject(request.error)
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(REGISTRY_STORE_NAME)) {
        db.createObjectStore(REGISTRY_STORE_NAME, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(REGISTRY_STORE_NAME)) {
        db.close()
        resolve()
        return
      }
      const tx = db.transaction(REGISTRY_STORE_NAME, 'readwrite')
      tx.objectStore(REGISTRY_STORE_NAME).clear()
      tx.oncomplete = () => {
        db.close()
        resolve()
      }
      tx.onerror = () => {
        db.close()
        reject(tx.error)
      }
    }
  })
}

/** Simulates a real pre-upgrade install: creates the legacy db with some object store. */
function createLegacyDb(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(LEGACY_DB_NAME, 1)
    request.onerror = () => reject(request.error)
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains('app_state')) {
        db.createObjectStore('app_state')
      }
    }
    request.onsuccess = () => {
      request.result.close()
      resolve()
    }
  })
}

beforeEach(async () => {
  await resetRegistryDb()
  await deleteDb(LEGACY_DB_NAME)
  _resetRegistryForTests()
})

describe('migrateLegacyDbIfNeeded', () => {
  it('creates exactly one row when the legacy db exists and the registry is empty', async () => {
    await createLegacyDb()

    await migrateLegacyDbIfNeeded()

    const all = await listPortfolios()
    expect(all).toHaveLength(1)
    expect(all[0].name).toBe('My Portfolio')
    expect(all[0].dbName).toBe(LEGACY_DB_NAME)
    expect(typeof all[0].id).toBe('string')
    expect(all[0].id.length).toBeGreaterThan(0)
    expect(typeof all[0].createdAt).toBe('number')
  })

  it('does not create a second row when called again after migration already ran', async () => {
    await createLegacyDb()

    await migrateLegacyDbIfNeeded()
    await migrateLegacyDbIfNeeded()

    const all = await listPortfolios()
    expect(all).toHaveLength(1)
  })

  it('results in zero rows when no legacy db exists and the registry is empty', async () => {
    await migrateLegacyDbIfNeeded()

    const all = await listPortfolios()
    expect(all).toHaveLength(0)
  })

  it('is a no-op when the registry already has a row and no legacy db exists', async () => {
    await createPortfolio('Foo')
    const before = await listPortfolios()

    await migrateLegacyDbIfNeeded()

    const after = await listPortfolios()
    expect(after).toEqual(before)
  })
})

describe('isMigratedPortfolio', () => {
  it('returns true for a portfolio whose dbName is the legacy db name', () => {
    expect(
      isMigratedPortfolio({ dbName: LEGACY_DB_NAME, id: 'x', name: 'y', createdAt: 1 })
    ).toBe(true)
  })

  it('returns false for a portfolio whose dbName is not exactly the legacy db name', () => {
    expect(
      isMigratedPortfolio({
        dbName: `${LEGACY_DB_NAME}-somethingelse`,
        id: 'x',
        name: 'y',
        createdAt: 1,
      })
    ).toBe(false)
    expect(
      isMigratedPortfolio({ dbName: 'portfolio_app_state_v1-port-abc', id: 'x', name: 'y', createdAt: 1 })
    ).toBe(false)
  })
})
