import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import {
  listPortfolios,
  getPortfolio,
  createPortfolio,
  renamePortfolio,
  deletePortfolio,
  _resetRegistryForTests,
} from './portfolioRegistry'

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

  it('deletePortfolio removes the row', async () => {
    const created = await createPortfolio('Foo')

    await deletePortfolio(created.id)

    const all = await listPortfolios()
    expect(all).toHaveLength(0)
  })

  it('deletePortfolio on an unknown id is a no-op and does not throw', async () => {
    await expect(deletePortfolio('port-does-not-exist')).resolves.not.toThrow()
  })
})
