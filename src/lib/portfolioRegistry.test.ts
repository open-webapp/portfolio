import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import 'fake-indexeddb/auto'
import {
  listPortfolios,
  getPortfolio,
  createPortfolio,
  renamePortfolio,
  setSharedDriveFolderId,
  unlinkSharedPortfolioFolder,
  deletePortfolio,
  nameKey,
  isMigratedPortfolio,
  _resetRegistryForTests,
} from './portfolioRegistry'

const LEGACY_DB_NAME = 'portfolio_app_state_v1'

const REGISTRY_DB_NAME = 'portfolio-registry'
const STORE_NAME = 'portfolios'

// Note: portfolioRegistry.ts memoizes a single open IDBDatabase connection for
// the lifetime of the module and never closes it. Calling indexedDB.deleteDatabase
// against a db with a live, unclosed connection blocks forever with fake-indexeddb
// (deleteDatabase never resolves past "blocked", and any subsequent indexedDB.open
// for the same db name queues behind it and also hangs). So instead of deleting the
// database between tests, we clear its object store directly -- same isolation,
// no deadlock -- and still reset the module's cached connection promise so it
// reopens cleanly for tests that run after a fresh describe block.
async function clearRegistryStore(): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(REGISTRY_DB_NAME, 1)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = (event) => {
      const upgradeDb = (event.target as IDBOpenDBRequest).result
      if (!upgradeDb.objectStoreNames.contains(STORE_NAME)) {
        upgradeDb.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
  })

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const req = tx.objectStore(STORE_NAME).clear()
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve()
  })
  db.close()
}

beforeEach(async () => {
  await clearRegistryStore()
  _resetRegistryForTests()
})

// Some tests below create additional real IndexedDB databases with dynamic
// names (e.g. a portfolio's own `dbName`). Track those here and delete them
// after each test so they don't leak into other tests in this file.
async function deleteNamedDb(name: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    request.onblocked = () => resolve()
  })
}

let dynamicDbNames: string[] = []

afterEach(async () => {
  for (const name of dynamicDbNames) {
    await deleteNamedDb(name)
  }
  dynamicDbNames = []
})

describe('portfolioRegistry CRUD', () => {
  it('createPortfolio then listPortfolios returns exactly one row with expected shape', async () => {
    const created = await createPortfolio('Foo')

    const all = await listPortfolios()

    expect(all).toHaveLength(1)
    expect(all[0].id).toMatch(/^port-/)
    expect(all[0].name).toBe('Foo')
    expect(all[0].dbName).toBe(`portfolio_app_state_v1-${all[0].id}`)
    expect(typeof all[0].createdAt).toBe('number')
    expect(created.id).toBe(all[0].id)
  })

  it('rejects creating a portfolio whose name collides case-insensitively', async () => {
    await createPortfolio('Foo')

    await expect(createPortfolio('foo')).rejects.toThrow()
  })

  it('rejects creating a portfolio whose name collides after trimming whitespace', async () => {
    await createPortfolio('  Foo  ')

    await expect(createPortfolio('Foo')).rejects.toThrow()
  })

  it('renamePortfolio updates the name', async () => {
    const created = await createPortfolio('Foo')

    await renamePortfolio(created.id, 'Bar')

    const fetched = await getPortfolio(created.id)
    expect(fetched?.name).toBe('Bar')

    const all = await listPortfolios()
    expect(all.find((p) => p.id === created.id)?.name).toBe('Bar')
  })

  it('renaming a portfolio to its own current name (different case/whitespace) succeeds as a no-op', async () => {
    const created = await createPortfolio('Foo')

    await expect(renamePortfolio(created.id, '  foo  ')).resolves.not.toThrow()

    const fetched = await getPortfolio(created.id)
    expect(fetched?.name).toBe('foo')
  })

  it('rejects renaming to a name that collides with another existing portfolio', async () => {
    const a = await createPortfolio('Foo')
    await createPortfolio('Bar')

    await expect(renamePortfolio(a.id, 'bar')).rejects.toThrow()
  })

  it('does not throw when renaming to a name that only collides with the portfolio\'s own current name', async () => {
    const a = await createPortfolio('Foo')
    await createPortfolio('Bar')

    await expect(renamePortfolio(a.id, 'Foo')).resolves.not.toThrow()
  })

  it('sets a shared Drive folder ID and persists it', async () => {
    const created = await createPortfolio('Foo')

    const updated = await setSharedDriveFolderId(created.id, 'folder-123')

    expect(updated.sharedDriveFolderId).toBe('folder-123')
    expect((await getPortfolio(created.id))?.sharedDriveFolderId).toBe('folder-123')
    expect((await listPortfolios()).find((p) => p.id === created.id)?.sharedDriveFolderId).toBe('folder-123')
  })

  it('unlinks a shared Drive folder ID and safely handles portfolios without one', async () => {
    const withFolder = await createPortfolio('Foo')
    const withoutFolder = await createPortfolio('Bar')
    await setSharedDriveFolderId(withFolder.id, 'folder-123')

    const unlinked = await unlinkSharedPortfolioFolder(withFolder.id)
    const unchanged = await unlinkSharedPortfolioFolder(withoutFolder.id)

    expect(unlinked.sharedDriveFolderId).toBeUndefined()
    expect(unchanged.sharedDriveFolderId).toBeUndefined()
    expect((await getPortfolio(withFolder.id))?.sharedDriveFolderId).toBeUndefined()
    expect((await listPortfolios()).find((p) => p.id === withFolder.id)?.sharedDriveFolderId).toBeUndefined()
  })

  it('rejects shared Drive folder changes for unknown portfolios without affecting existing portfolios', async () => {
    const existing = await createPortfolio('Foo')

    await expect(setSharedDriveFolderId('port-missing', 'folder-123')).rejects.toThrow('Portfolio not found')
    await expect(unlinkSharedPortfolioFolder('port-missing')).rejects.toThrow('Portfolio not found')

    expect(await getPortfolio(existing.id)).toEqual(existing)
    expect(await listPortfolios()).toEqual([existing])
  })

  it('deletePortfolio removes the row', async () => {
    const created = await createPortfolio('Foo')

    await deletePortfolio(created.id)

    const all = await listPortfolios()
    expect(all).toHaveLength(0)
  })

  it('deletePortfolio on an unknown id is a no-op and does not throw', async () => {
    await expect(deletePortfolio('port-does-not-exist')).resolves.not.toThrow()
  })

  it('deletePortfolio only affects its own row and its own IndexedDB, leaving other portfolios untouched', async () => {
    const a = await createPortfolio('Alpha')
    const b = await createPortfolio('Beta')
    dynamicDbNames.push(a.dbName, b.dbName)

    // Write distinguishable data into each portfolio's own db.
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(a.dbName, 1)
      req.onupgradeneeded = () => req.result.createObjectStore('app_state')
      req.onsuccess = () => {
        const tx = req.result.transaction('app_state', 'readwrite')
        tx.objectStore('app_state').put({ marker: 'alpha-data' }, 'current')
        tx.oncomplete = () => { req.result.close(); resolve() }
        tx.onerror = () => reject(tx.error)
      }
      req.onerror = () => reject(req.error)
    })
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(b.dbName, 1)
      req.onupgradeneeded = () => req.result.createObjectStore('app_state')
      req.onsuccess = () => {
        const tx = req.result.transaction('app_state', 'readwrite')
        tx.objectStore('app_state').put({ marker: 'beta-data' }, 'current')
        tx.oncomplete = () => { req.result.close(); resolve() }
        tx.onerror = () => reject(tx.error)
      }
      req.onerror = () => reject(req.error)
    })

    await deletePortfolio(a.id)

    // (a) registry: only b remains.
    const remaining = await listPortfolios()
    expect(remaining.map((p) => p.id)).toEqual([b.id])

    // (b) a's db is gone — reopening it comes back empty (fresh db, no store).
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(a.dbName)
      req.onsuccess = () => {
        const db = req.result
        expect(db.objectStoreNames.contains('app_state')).toBe(false)
        db.close()
        resolve()
      }
      req.onerror = () => reject(req.error)
    })

    // (c) b's db is untouched — its data is still readable.
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(b.dbName, 1)
      req.onsuccess = () => {
        const db = req.result
        const tx = db.transaction('app_state', 'readonly')
        const getReq = tx.objectStore('app_state').get('current')
        getReq.onsuccess = () => {
          expect(getReq.result).toEqual({ marker: 'beta-data' })
          db.close()
          resolve()
        }
        getReq.onerror = () => reject(getReq.error)
      }
      req.onerror = () => reject(req.error)
    })
  })
})

describe('nameKey', () => {
  it('normalizes case and trims whitespace', () => {
    expect(nameKey('  Foo  ')).toBe('foo')
    expect(nameKey('BAR')).toBe('bar')
    expect(nameKey('foo')).toBe(nameKey('  FOO  '))
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
