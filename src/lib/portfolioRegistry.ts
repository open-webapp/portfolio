import type { Portfolio } from './types'

const REGISTRY_DB_NAME = 'portfolio-registry'
const STORE_NAME = 'portfolios'
let registryDbPromise: Promise<IDBDatabase> | null = null

function getRegistryDb(): Promise<IDBDatabase> {
  if (!registryDbPromise) {
    registryDbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(REGISTRY_DB_NAME, 1)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        }
      }
    })
  }
  return registryDbPromise
}

export async function listPortfolios(): Promise<Portfolio[]> {
  const db = await getRegistryDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).getAll()
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve(req.result as Portfolio[])
  })
}

export async function getPortfolio(id: string): Promise<Portfolio | undefined> {
  const db = await getRegistryDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(id)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve(req.result as Portfolio | undefined)
  })
}

function putPortfolio(p: Portfolio): Promise<void> {
  return getRegistryDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const req = tx.objectStore(STORE_NAME).put(p)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve()
  }))
}

export function nameKey(name: string): string {
  return name.trim().toLowerCase()
}

export async function createPortfolio(name: string): Promise<Portfolio> {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Portfolio name cannot be empty')
  const existing = await listPortfolios()
  if (existing.some((p) => nameKey(p.name) === nameKey(trimmed))) {
    throw new Error('A portfolio with that name already exists')
  }
  const id = 'port-' + crypto.randomUUID()
  const portfolio: Portfolio = {
    id,
    name: trimmed,
    dbName: `portfolio_app_state_v1-${id}`,
    createdAt: Date.now(),
  }
  await putPortfolio(portfolio)
  return portfolio
}

export async function renamePortfolio(id: string, newName: string): Promise<Portfolio> {
  const trimmed = newName.trim()
  if (!trimmed) throw new Error('Portfolio name cannot be empty')
  const existing = await listPortfolios()
  const current = existing.find((p) => p.id === id)
  if (!current) throw new Error('Portfolio not found')
  if (existing.some((p) => p.id !== id && nameKey(p.name) === nameKey(trimmed))) {
    throw new Error('A portfolio with that name already exists')
  }
  const updated: Portfolio = { ...current, name: trimmed }
  await putPortfolio(updated)
  return updated
}

export async function deletePortfolio(id: string): Promise<void> {
  const portfolio = await getPortfolio(id)
  if (!portfolio) return
  const db = await getRegistryDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const req = tx.objectStore(STORE_NAME).delete(id)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve()
  })
  indexedDB.deleteDatabase(portfolio.dbName)
}

export function _resetRegistryForTests(): void {
  registryDbPromise = null
}

const LEGACY_DB_NAME = 'portfolio_app_state_v1'

/** True for the one portfolio whose db predates multi-portfolio support (drives the
 * Drive projectId + folder-path special cases in drive.ts). */
export function isMigratedPortfolio(portfolio: Portfolio): boolean {
  return portfolio.dbName === LEGACY_DB_NAME
}
