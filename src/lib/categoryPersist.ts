import type { GlobalCategoryState } from './categoryStore'
import { initialGlobalCategoryState } from './categoryStore'

const DB_NAME = 'ledger_global_categories_v1'
const STATE_STORE = 'state'
const META_STORE = 'meta'
const STATE_KEY = 'current'
const MIGRATION_KEY = 'migration'
const DRIVE_SYNC_KEY = 'driveSync'

interface MigrationMeta {
  seeded: boolean
}

interface DriveSyncMeta {
  lastKnownRemoteModifiedTime?: string
}

let dbPromise: Promise<IDBDatabase> | null = null

export function openCategoryDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains(STATE_STORE)) {
          db.createObjectStore(STATE_STORE)
        }
        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE)
        }
      }
    })
  }
  return dbPromise
}

async function getValue<T>(storeName: string, key: string): Promise<T | undefined> {
  const db = await openCategoryDb()
  return new Promise<T | undefined>((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly')
    const store = transaction.objectStore(storeName)
    const request = store.get(key)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result as T | undefined)
  })
}

async function putValue<T>(storeName: string, key: string, value: T): Promise<void> {
  const db = await openCategoryDb()
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite')
    const store = transaction.objectStore(storeName)
    const request = store.put(value, key)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve()
  })
}

export async function loadGlobalCategoryState(): Promise<GlobalCategoryState> {
  const state = await getValue<GlobalCategoryState>(STATE_STORE, STATE_KEY)
  return state ?? initialGlobalCategoryState()
}

export async function saveGlobalCategoryState(s: GlobalCategoryState): Promise<void> {
  await putValue(STATE_STORE, STATE_KEY, s)
}

export async function isGlobalStoreSeeded(): Promise<boolean> {
  const meta = await getValue<MigrationMeta>(META_STORE, MIGRATION_KEY)
  return meta?.seeded ?? false
}

export async function markGlobalStoreSeeded(): Promise<void> {
  await putValue<MigrationMeta>(META_STORE, MIGRATION_KEY, { seeded: true })
}

export async function getLastKnownRemoteModifiedTime(): Promise<string | undefined> {
  const meta = await getValue<DriveSyncMeta>(META_STORE, DRIVE_SYNC_KEY)
  return meta?.lastKnownRemoteModifiedTime
}

export async function setLastKnownRemoteModifiedTime(iso: string): Promise<void> {
  await putValue<DriveSyncMeta>(META_STORE, DRIVE_SYNC_KEY, { lastKnownRemoteModifiedTime: iso })
}

/**
 * Resets the module's cached IndexedDB connection promise so a subsequent
 * call reopens cleanly. Does NOT delete the underlying database — this
 * module never closes its connection, and indexedDB.deleteDatabase against a
 * db with a live, unclosed connection hangs forever under fake-indexeddb (see
 * portfolioRegistry.ts's identical caveat). Tests that need a clean db should
 * clear the object stores directly instead.
 */
export function _resetCategoryDbForTests(): void {
  dbPromise = null
}
