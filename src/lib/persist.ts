import type { AppState } from './state'
import { initialState } from './state'
import { decryptState, detectEnvelopeShape, encryptState } from './crypto'
import type { EncryptedEnvelope } from './crypto'
import type { ProjectSync } from '@open-webapp/project-sync'

const STORE_NAME = 'app_state'
const STATE_KEY = 'current'

// Global reference to the project-sync instance (initialized by App.tsx)
let appInstance: ProjectSync | null = null

export function setProjectSyncInstance(app: ProjectSync): void {
  appInstance = app
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/**
 * Migration tolerance: fill in missing collections/fields with defaults from initialState().
 *
 * Every path that turns stored bytes back into an AppState must run through
 * this — local unlock and Drive restore alike. A backup written by an older
 * build is missing whatever fields have been added since, and handing that
 * raw object to the reducer puts `undefined` where the UI expects arrays.
 */
export function coalesceWithDefaults(loaded: Partial<AppState>): AppState {
  const defaults = initialState()
  return {
    // Data collections
    accounts: (loaded.accounts ?? defaults.accounts).map((a) => ({
      ...a,
      institution: a.institution ?? '',
    })),
    positions: loaded.positions ?? defaults.positions,
    closedPositions: (loaded.closedPositions ?? defaults.closedPositions).map((cp) => ({
      ...cp,
      shares: cp.shares ?? 0,
      avgCost: cp.avgCost ?? 0,
      price: cp.price ?? 0,
      assetClassManualOverride: cp.assetClassManualOverride,
      lastImportedAt: cp.lastImportedAt ?? '',
    })),
    transactions: loaded.transactions ?? defaults.transactions,
    snapshots: loaded.snapshots ?? defaults.snapshots,
    csvMappings: loaded.csvMappings ?? defaults.csvMappings,
    customInstitutions: loaded.customInstitutions ?? defaults.customInstitutions,

    // UI state with existing values or defaults.
    // `view` is whitelisted rather than defaulted: blobs written before the
    // Dashboard was removed carry `view: 'dashboard'`, which is no longer a
    // renderable view. Anything unrecognized falls back to the default.
    view: loaded.view === 'accounts' || loaded.view === 'settings' ? loaded.view : defaults.view,
    sortKey: loaded.sortKey ?? defaults.sortKey,
    sortDir: loaded.sortDir ?? defaults.sortDir,
    txTypeFilter: loaded.txTypeFilter ?? defaults.txTypeFilter,
    txSearch: loaded.txSearch ?? defaults.txSearch,
    selectedAccountId: loaded.selectedAccountId ?? defaults.selectedAccountId,
    selectedCategoryKey: loaded.selectedCategoryKey ?? defaults.selectedCategoryKey,
    expandedCategories: loaded.expandedCategories ?? defaults.expandedCategories,
    acctAssetClassFilter: loaded.acctAssetClassFilter ?? defaults.acctAssetClassFilter,
    acctPosSearch: loaded.acctPosSearch ?? defaults.acctPosSearch,
  }
}

/**
 * Peeks at the raw stored value's shape without decrypting anything.
 * Used by the password gate to decide whether to prompt for a new password
 * (absent), migrate (legacy-plaintext), or unlock (encrypted).
 *
 * At the password gate stage, we need to check the old legacy database
 * since the project hasn't been selected yet.
 */
export async function peekEnvelopeShape(): Promise<'absent' | 'legacy-plaintext' | 'encrypted'> {
  // At boot, before any project selection, check the old database for legacy data
  try {
    return await new Promise<'absent' | 'legacy-plaintext' | 'encrypted'>((resolve) => {
      const request = indexedDB.open('portfolio_app_state_v1')

      request.onerror = () => {
        // Database doesn't exist
        resolve('absent')
      }

      request.onsuccess = () => {
        const db = request.result
        try {
          const transaction = db.transaction('app_state', 'readonly')
          const store = transaction.objectStore('app_state')

          const getRequest = store.get(STATE_KEY)
          getRequest.onerror = () => resolve('absent')
          getRequest.onsuccess = () => {
            const shape = detectEnvelopeShape(getRequest.result)
            resolve(shape)
          }
        } catch {
          resolve('absent')
        }
      }
    })
  } catch {
    return 'absent'
  }
}

/**
 * Peeks at the stored envelope's salt (if it is already encrypted) without a password.
 * Returns null if nothing is stored or the stored value isn't an encrypted envelope.
 *
 * At the password gate stage, check the old database.
 */
export async function peekStoredSalt(): Promise<Uint8Array | null> {
  try {
    return await new Promise<Uint8Array | null>((resolve) => {
      const request = indexedDB.open('portfolio_app_state_v1')

      request.onerror = () => {
        resolve(null)
      }

      request.onsuccess = () => {
        const db = request.result
        try {
          const transaction = db.transaction('app_state', 'readonly')
          const store = transaction.objectStore('app_state')

          const getRequest = store.get(STATE_KEY)
          getRequest.onerror = () => resolve(null)
          getRequest.onsuccess = () => {
            const result = getRequest.result
            if (detectEnvelopeShape(result) !== 'encrypted') {
              resolve(null)
              return
            }
            resolve(base64ToBytes((result as EncryptedEnvelope).salt))
          }
        } catch {
          resolve(null)
        }
      }
    })
  } catch {
    return null
  }
}

/**
 * Loads a pre-encryption plaintext AppState blob from IndexedDB as-is.
 * Returns the saved state, or null if nothing was saved.
 * Missing collections default to empty arrays for migration tolerance.
 *
 * At boot, checks the old database.
 */
export async function loadLegacyPlaintextApp(): Promise<AppState | null> {
  try {
    const loaded = await new Promise<Partial<AppState> | undefined>((resolve) => {
      const request = indexedDB.open('portfolio_app_state_v1')

      request.onerror = () => {
        resolve(undefined)
      }

      request.onsuccess = () => {
        const db = request.result
        try {
          const transaction = db.transaction('app_state', 'readonly')
          const store = transaction.objectStore('app_state')

          const getRequest = store.get(STATE_KEY)
          getRequest.onerror = () => resolve(undefined)
          getRequest.onsuccess = () => resolve(getRequest.result)
        } catch {
          resolve(undefined)
        }
      }
    })

    if (!loaded) {
      return null
    }

    return coalesceWithDefaults(loaded)
  } catch (error) {
    console.error('Failed to load persisted app state:', error)
    return null
  }
}

/**
 * Loads and decrypts the persisted AppState from the active project's database.
 * Returns null if nothing was saved.
 * Throws if the stored value is not an encrypted envelope (caller bug — the
 * gate must never call this on a legacy/absent envelope) or if decryption
 * fails (e.g. wrong password → OperationError propagates uncaught).
 */
export async function loadPersistedApp(key: CryptoKey): Promise<AppState | null> {
  let db: IDBDatabase

  if (appInstance) {
    const dbHandle = await appInstance.data.getActiveDb() as any
    db = dbHandle as IDBDatabase
  } else {
    db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('portfolio_app_state_v1', 1)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
      request.onupgradeneeded = (event) => {
        const dbNew = (event.target as IDBOpenDBRequest).result
        if (!dbNew.objectStoreNames.contains(STORE_NAME)) {
          dbNew.createObjectStore(STORE_NAME)
        }
      }
    })
  }

  const raw = await new Promise<unknown>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.get(STATE_KEY)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
  })

  if (raw === undefined || raw === null) {
    return null
  }

  if (detectEnvelopeShape(raw) !== 'encrypted') {
    throw new Error('loadPersistedApp called on a non-encrypted envelope')
  }

  const decrypted = await decryptState(raw as EncryptedEnvelope, key)
  return coalesceWithDefaults(decrypted)
}

/**
 * Encrypts and saves app state to the active project's database.
 */
export async function savePersistedApp(state: AppState, key: CryptoKey, salt: Uint8Array): Promise<void> {
  try {
    const envelope = await encryptState(state, key, salt)
    let db: IDBDatabase

    if (appInstance) {
      const dbHandle = await appInstance.data.getActiveDb() as any
      db = dbHandle as IDBDatabase
    } else {
      db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('portfolio_app_state_v1', 1)
        request.onerror = () => reject(request.error)
        request.onsuccess = () => resolve(request.result)
        request.onupgradeneeded = (event) => {
          const dbNew = (event.target as IDBOpenDBRequest).result
          if (!dbNew.objectStoreNames.contains(STORE_NAME)) {
            dbNew.createObjectStore(STORE_NAME)
          }
        }
      })
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.put(envelope, STATE_KEY)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve()
    })
  } catch (error) {
    console.error('Failed to save app state:', error)
    throw error
  }
}

/**
 * Deletes the persisted app state entry from the active project's database.
 */
export async function clearPersistedApp(): Promise<void> {
  let db: IDBDatabase

  if (appInstance) {
    const dbHandle = await appInstance.data.getActiveDb() as any
    db = dbHandle as IDBDatabase
  } else {
    db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('portfolio_app_state_v1', 1)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
      request.onupgradeneeded = (event) => {
        const dbNew = (event.target as IDBOpenDBRequest).result
        if (!dbNew.objectStoreNames.contains(STORE_NAME)) {
          dbNew.createObjectStore(STORE_NAME)
        }
      }
    })
  }

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.delete(STATE_KEY)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve()
  })
}
