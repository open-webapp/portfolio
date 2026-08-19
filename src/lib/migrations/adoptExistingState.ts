import type { ProjectSync } from '@open-webapp/project-sync'
import type { AppState } from '../state'
import { decryptState, detectEnvelopeShape } from '../crypto'
import type { EncryptedEnvelope } from '../crypto'

const OLD_DB_NAME = 'portfolio_app_state_v1'
const OLD_STORE_NAME = 'app_state'
const OLD_STATE_KEY = 'current'

/**
 * Adopt existing portfolio_app_state_v1 data as the first project.
 *
 * Migration for T32b: If the registry is empty AND the old database exists,
 * this creates a project named "My Portfolio" and copies the existing state
 * into its derived database. The old database is only deleted after verification
 * that the data reads back correctly.
 *
 * Must handle both encrypted and unencrypted envelopes, and be re-entrant
 * (safe to re-run after a crash before deletion completes).
 *
 * Decision 28: migrations are forward-only and non-destructive until verified.
 * Delete only after verification.
 *
 * @throws Clear errors that describe what went wrong (e.g. "failed to decrypt")
 *   Old database is NOT deleted on error, marker NOT set, so the migration retries.
 */
export async function adoptExistingState(app: ProjectSync, key: CryptoKey): Promise<void> {
  // Check if registry is already non-empty (never re-seed)
  const existing = await app.projects.list()
  if (existing.length > 0) {
    // Registry already has projects; do not adopt old db
    return
  }

  // Check if old database exists
  const oldState = await readOldDatabase()
  if (oldState === null) {
    // No old database; create a fresh empty project for a new install
    await app.projects.create('My Portfolio')
    return
  }

  // Old state exists; create a project for it
  const project = await app.projects.create('My Portfolio')
  await app.projects.setActive(project.id)

  // Get the target database
  const db = await app.data.getActiveDb()

  try {
    // Copy the app_state record to the new project's db
    await copyStateToProject(db, oldState)

    // Verify it reads back correctly (encrypted case)
    const readBack = await readStateFromProject(db)
    if (readBack === null) {
      throw new Error('Copied state does not read back from new database')
    }

    // If the old state was encrypted, verify decryption
    if (detectEnvelopeShape(oldState) === 'encrypted') {
      try {
        await decryptState(oldState as EncryptedEnvelope, key)
      } catch (error) {
        if (error instanceof Error && error.name === 'OperationError') {
          // Wrong key; do not delete old db, do not mark migration as complete
          throw new Error('Copied encrypted state fails to decrypt with the provided key')
        }
        throw error
      }
    }

    // Verification passed; safe to delete old database
    await deleteOldDatabase()
  } catch (error) {
    // Verification or copy failed; leave old db intact and let the error surface
    throw error
  }
}

/**
 * Read the app_state from the old portfolio_app_state_v1 database.
 * Returns null if the database doesn't exist or has no current record.
 */
async function readOldDatabase(): Promise<AppState | EncryptedEnvelope | null> {
  try {
    return await new Promise((resolve, reject) => {
      const request = indexedDB.open(OLD_DB_NAME)

      request.onerror = () => {
        const error = request.error
        if (error?.name === 'NotFoundError') {
          // Database doesn't exist
          resolve(null)
        } else {
          reject(error)
        }
      }

      request.onsuccess = () => {
        const db = request.result
        const transaction = db.transaction(OLD_STORE_NAME, 'readonly')
        const store = transaction.objectStore(OLD_STORE_NAME)

        const getRequest = store.get(OLD_STATE_KEY)
        getRequest.onerror = () => reject(getRequest.error)
        getRequest.onsuccess = () => resolve(getRequest.result ?? null)
      }

      request.onupgradeneeded = () => {
        // If we're in onupgradeneeded, the db version changed, meaning
        // it exists but was just upgraded. Return null (no existing data).
        resolve(null)
      }
    })
  } catch (error) {
    // On any error, treat it as "database doesn't exist or is unusable"
    return null
  }
}

/**
 * Copy the app state record into the new project's database.
 * Stores it in the app_state store under the 'current' key, matching
 * the original schema so existing persist.ts readers work.
 */
async function copyStateToProject(db: any, state: AppState | EncryptedEnvelope): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('app_state', 'readwrite')
    const store = transaction.objectStore('app_state')
    const request = store.put(state, OLD_STATE_KEY)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve()
  })
}

/**
 * Read the app_state back from the new project's database.
 * Used for verification: if this returns null, the copy failed.
 */
async function readStateFromProject(db: any): Promise<AppState | EncryptedEnvelope | null> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('app_state', 'readonly')
    const store = transaction.objectStore('app_state')
    const request = store.get(OLD_STATE_KEY)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result ?? null)
  })
}

/**
 * Delete the old portfolio_app_state_v1 database.
 * Called only after verification that the new database is readable.
 */
async function deleteOldDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(OLD_DB_NAME)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve()
  })
}
