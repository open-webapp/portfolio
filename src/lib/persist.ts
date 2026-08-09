import type { AppState } from './state'
import { initialState } from './state'
import { decryptState, detectEnvelopeShape, encryptState } from './crypto'
import type { EncryptedEnvelope } from './crypto'

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
 */
function coalesceWithDefaults(loaded: Partial<AppState>): AppState {
  const defaults = initialState()
  return {
    // Data collections
    accounts: (loaded.accounts ?? defaults.accounts).map((a) => ({
      ...a,
      institution: a.institution ?? '',
    })),
    positions: loaded.positions ?? defaults.positions,
    closedPositions: loaded.closedPositions ?? defaults.closedPositions,
    transactions: loaded.transactions ?? defaults.transactions,
    snapshots: loaded.snapshots ?? defaults.snapshots,
    importSessions: loaded.importSessions ?? defaults.importSessions,
    csvMappings: loaded.csvMappings ?? defaults.csvMappings,

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
}

/**
 * Peeks at the raw stored value's shape without decrypting anything.
 * Used by the password gate to decide whether to prompt for a new password
 * (absent), migrate (legacy-plaintext), or unlock (encrypted).
 */
export async function peekEnvelopeShape(): Promise<'absent' | 'legacy-plaintext' | 'encrypted'> {
  const db = await openDatabase()
  const transaction = db.transaction(STORE_NAME, 'readonly')
  const store = transaction.objectStore(STORE_NAME)

  return new Promise((resolve, reject) => {
    const request = store.get(STATE_KEY)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(detectEnvelopeShape(request.result))
  })
}

/**
 * Peeks at the stored envelope's salt (if it is already encrypted) without a password.
 * Returns null if nothing is stored or the stored value isn't an encrypted envelope.
 */
export async function peekStoredSalt(): Promise<Uint8Array | null> {
  const db = await openDatabase()
  const transaction = db.transaction(STORE_NAME, 'readonly')
  const store = transaction.objectStore(STORE_NAME)

  return new Promise((resolve, reject) => {
    const request = store.get(STATE_KEY)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const raw = request.result
      if (detectEnvelopeShape(raw) !== 'encrypted') {
        resolve(null)
        return
      }
      resolve(base64ToBytes((raw as EncryptedEnvelope).salt))
    }
  })
}

/**
 * Loads a pre-encryption plaintext AppState blob from IndexedDB as-is.
 * Returns the saved state, or null if nothing was saved.
 * Missing collections default to empty arrays for migration tolerance.
 */
export async function loadLegacyPlaintextApp(): Promise<AppState | null> {
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

        resolve(coalesceWithDefaults(loaded))
      }
    })
  } catch (error) {
    console.error('Failed to load persisted app state:', error)
    return null
  }
}

/**
 * Loads and decrypts the persisted AppState from IndexedDB.
 * Returns null if nothing was saved.
 * Throws if the stored value is not an encrypted envelope (caller bug — the
 * gate must never call this on a legacy/absent envelope) or if decryption
 * fails (e.g. wrong password → OperationError propagates uncaught).
 */
export async function loadPersistedApp(key: CryptoKey): Promise<AppState | null> {
  const db = await openDatabase()
  const transaction = db.transaction(STORE_NAME, 'readonly')
  const store = transaction.objectStore(STORE_NAME)

  const raw = await new Promise<unknown>((resolve, reject) => {
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
 * Encrypts and saves app state to IndexedDB as a single versioned envelope.
 */
export async function savePersistedApp(state: AppState, key: CryptoKey, salt: Uint8Array): Promise<void> {
  try {
    const envelope = await encryptState(state, key, salt)
    const db = await openDatabase()
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)

    return new Promise((resolve, reject) => {
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
 * Deletes the persisted app state entry from IndexedDB.
 */
export async function clearPersistedApp(): Promise<void> {
  const db = await openDatabase()
  const transaction = db.transaction(STORE_NAME, 'readwrite')
  const store = transaction.objectStore(STORE_NAME)

  return new Promise((resolve, reject) => {
    const request = store.delete(STATE_KEY)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve()
  })
}
