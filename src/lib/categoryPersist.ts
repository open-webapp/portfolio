import type { GlobalCategoryState } from './categoryStore'
import { initialGlobalCategoryState, resolveSpendExpenseForCategory } from './categoryStore'
import type { CategoryMapping, ExpenseDefinition } from './types'

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
  sharedFileId?: string
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

export async function loadGlobalCategoryState(
  budgetExpenseDefinitions: ExpenseDefinition[]
): Promise<GlobalCategoryState> {
  const state = await getValue<GlobalCategoryState>(STATE_STORE, STATE_KEY)
  const loaded = state
    ? {
        ...state,
        budgetAccountRules: Array.isArray(state.budgetAccountRules) ? state.budgetAccountRules : [],
      }
    : initialGlobalCategoryState()
  return migrateCategoryMappingsToSpendKey(loaded, budgetExpenseDefinitions)
}

/**
 * Legacy (pre-spendkey) mapping shape: keyed by `categoryId` instead of
 * `spendExpenseId`. Persisted IDB rows may still hold this shape until the
 * one-time migration below rewrites them. `categoryId` must NOT be re-added
 * to `CategoryMapping` — access it only through this local cast.
 */
type LegacyCategoryMapping = Omit<CategoryMapping, 'spendExpenseId'> & {
  spendExpenseId?: string
  categoryId?: string
}

/**
 * One-time in-place categoryId → spendExpenseId migration over the loaded
 * mappings. For each old-shape row (`categoryId`, no `spendExpenseId`):
 * resolve via `resolveSpendExpenseForCategory` — match rewrites the row to
 * `spendExpenseId` (dropping `categoryId`), no match drops the row entirely.
 * Already-migrated rows pass through untouched.
 *
 * Idempotent by content: a migrated store holds no legacy rows, so a second
 * load is a no-op with no write. That is why no MIGRATION_KEY flag is added —
 * the existing seeded marker there governs initial seeding, a different
 * concern. Persists the migrated result via saveGlobalCategoryState only when
 * at least one row changed, making the first post-upgrade load the single
 * write.
 */
async function migrateCategoryMappingsToSpendKey(
  loaded: GlobalCategoryState,
  budgetExpenseDefinitions: ExpenseDefinition[]
): Promise<GlobalCategoryState> {
  let changed = false
  const categoryMappings: CategoryMapping[] = []
  for (const mapping of loaded.categoryMappings) {
    const legacy = mapping as LegacyCategoryMapping
    if (legacy.spendExpenseId !== undefined) {
      if (legacy.categoryId === undefined) {
        categoryMappings.push(mapping)
      } else {
        // Both fields (e.g. Drive-merged old remote row): spendExpenseId is
        // authoritative, strip the stale categoryId residue.
        const { categoryId: _legacyCategoryId, ...rest } = legacy
        void _legacyCategoryId
        categoryMappings.push({ ...rest, spendExpenseId: legacy.spendExpenseId })
        changed = true
      }
      continue
    }
    if (legacy.categoryId === undefined) {
      // Neither field — unknown shape; keep rather than destroy data.
      categoryMappings.push(mapping)
      continue
    }
    const match = resolveSpendExpenseForCategory(budgetExpenseDefinitions, legacy.categoryId)
    if (!match) {
      changed = true
      continue
    }
    const { categoryId: _legacyCategoryId, ...rest } = legacy
    void _legacyCategoryId
    categoryMappings.push({ ...rest, spendExpenseId: match.id })
    changed = true
  }
  if (!changed) return loaded
  const migrated: GlobalCategoryState = { ...loaded, categoryMappings }
  await saveGlobalCategoryState(migrated)
  return migrated
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

export async function getSharedCategoryDriveFileId(): Promise<string | undefined> {
  const meta = await getValue<DriveSyncMeta>(META_STORE, DRIVE_SYNC_KEY)
  return meta?.sharedFileId
}

export async function setSharedCategoryDriveFileId(id: string | null): Promise<void> {
  await putValue<DriveSyncMeta>(META_STORE, DRIVE_SYNC_KEY, { sharedFileId: id ?? undefined })
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
