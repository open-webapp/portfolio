import type { AppState } from './state'
import { initialState } from './state'

const DB_NAME = 'portfolio_app_state_v1'
const STORE_NAME = 'app_state'
const STATE_KEY = 'current'

/**
 * Open or create the IndexedDB database.
 * Initializes the object store if it doesn't exist.
 */
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
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
}

/**
 * Load persisted app state from IndexedDB.
 * Returns the saved state, or null if nothing was saved.
 * Missing collections default to empty arrays for migration tolerance.
 */
export async function loadPersistedApp(): Promise<AppState | null> {
  try {
    const db = await openDatabase()
    const transaction = db.transaction(STORE_NAME, 'readonly')
    const store = transaction.objectStore(STORE_NAME)

    return new Promise((resolve, reject) => {
      const request = store.get(STATE_KEY)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const loaded = request.result as Partial<AppState> | undefined

        if (!loaded) {
          resolve(null)
          return
        }

        // Migration tolerance: fill in missing collections with empty arrays
        const defaults = initialState()
        const migrated: AppState = {
          // Data collections
          accounts: loaded.accounts ?? defaults.accounts,
          positions: loaded.positions ?? defaults.positions,
          closedPositions: loaded.closedPositions ?? defaults.closedPositions,
          transactions: loaded.transactions ?? defaults.transactions,
          snapshots: loaded.snapshots ?? defaults.snapshots,
          mappingProfiles: loaded.mappingProfiles ?? defaults.mappingProfiles,
          importSessions: loaded.importSessions ?? defaults.importSessions,

          // UI state with existing values or defaults
          category: loaded.category ?? defaults.category,
          range: loaded.range ?? defaults.range,
          tab: loaded.tab ?? defaults.tab,
          view: loaded.view ?? defaults.view,
          sortKey: loaded.sortKey ?? defaults.sortKey,
          sortDir: loaded.sortDir ?? defaults.sortDir,
          assetClassFilter: loaded.assetClassFilter ?? defaults.assetClassFilter,
          retirementFilter: loaded.retirementFilter ?? defaults.retirementFilter,
          posSearch: loaded.posSearch ?? defaults.posSearch,
          txTypeFilter: loaded.txTypeFilter ?? defaults.txTypeFilter,
          txSearch: loaded.txSearch ?? defaults.txSearch,
          showClosed: loaded.showClosed ?? defaults.showClosed,
        }

        resolve(migrated)
      }
    })
  } catch (error) {
    console.error('Failed to load persisted app state:', error)
    return null
  }
}

/**
 * Save app state to IndexedDB as a single versioned blob.
 */
export async function savePersistedApp(state: AppState): Promise<void> {
  try {
    const db = await openDatabase()
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)

    return new Promise((resolve, reject) => {
      const request = store.put(state, STATE_KEY)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve()
    })
  } catch (error) {
    console.error('Failed to save app state:', error)
  }
}
