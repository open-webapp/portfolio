import { createDriveSync, NeedsReauthError, PickerCancelledError } from '@open-webapp/drive-sync'
import type { Connection } from '@open-webapp/drive-sync'
import type { AppState } from './state'
import { coalesceWithDefaults } from './persist'
import { decryptState, encryptState } from './crypto'
import type { EncryptedEnvelope } from './crypto'
import type { SyncDocument } from '@open-webapp/project-sync'

/**
 * Thrown when decryption fails due to a wrong key (auth-tag mismatch).
 * Carries the salt and envelope for retry scenarios (e.g., prompt for different password).
 */
export class DriveDecryptError extends Error {
  salt: Uint8Array
  envelope: EncryptedEnvelope

  constructor(message: string, salt: Uint8Array, envelope: EncryptedEnvelope) {
    super(message)
    this.name = 'DriveDecryptError'
    this.salt = salt
    this.envelope = envelope
  }
}

/**
 * Raw drive-sync object - not exported, used internally
 */
const driveSync = createDriveSync({
  appId: 'portfolio',
  clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID,
  folderPath: ['OpenWebApp', 'Portfolio'],
})

/**
 * Wrapper around drive-sync that provides compatibility for the DriveRestorePanel
 * component. Overrides pickFile to return a single file object with 'id' property
 * instead of an array of PickedFile objects.
 */
export const drive = {
  ...driveSync,
  project: (projectId: string) => {
    const project = driveSync.project(projectId)
    return {
      ...project,
      pickFile: async (options?: any): Promise<{ id: string; name?: string; mimeType?: string } | null> => {
        // drive-sync's pickFile requires apiKey and appId
        const apiKey = import.meta.env.VITE_GOOGLE_PICKER_API_KEY as string | undefined
        const projectNumber = (() => {
          const explicit = import.meta.env.VITE_GOOGLE_PROJECT_NUMBER as string | undefined
          if (explicit) return explicit
          const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined
          const match = /^(\d+)-/.exec(clientId ?? '')
          return match ? match[1] : undefined
        })()

        if (!apiKey || !projectNumber) {
          throw new Error('Google Picker API key and project number are required for file picker. Set VITE_GOOGLE_PICKER_API_KEY and VITE_GOOGLE_PROJECT_NUMBER.')
        }

        // drive-sync's pickFile forwards only apiKey/appId/mimeTypes/multiSelect/
        // parentFolderId to openPicker — `includeFolders` is dropped on the way
        // through. Backups live in a nested folder (OpenWebApp/Portfolio), so a
        // picker without folder navigation can never reach them. Scope the view
        // to that folder directly instead: parentFolderId *is* forwarded, and it
        // puts the backup at the picker's root.
        const { includeFolders: _includeFolders, ...pickerOptions } = (options ?? {}) as {
          includeFolders?: boolean
          parentFolderId?: string
          [key: string]: unknown
        }
        const parentFolderId: string = pickerOptions.parentFolderId ?? (await project.ensureFolderPath())

        let result
        try {
          result = await project.pickFile({
            ...pickerOptions,
            apiKey,
            appId: projectNumber,
            parentFolderId,
          })
        } catch (err) {
          // Cancelling the picker rejects rather than resolving empty. That is a
          // user no-op, not a failure — surface it as "nothing picked".
          if (err instanceof PickerCancelledError) return null
          throw err
        }
        // Return the first file or null, with 'id' property mapped from 'fileId'
        if (Array.isArray(result) && result.length > 0) {
          return {
            id: result[0].fileId,
            name: result[0].name,
            mimeType: result[0].mimeType,
          }
        }
        return null
      },
    } as ReturnType<typeof driveSync.project> & { pickFile: (options?: any) => Promise<{ id: string; name?: string; mimeType?: string } | null> }
  },
} as any

const APP_STATE_FILENAME = 'portfolio-state.json'
const APP_PROJECT_ID = 'app'

/**
 * A cached token is treated as usable only while it has at least this much
 * runway left. Mirrors drive-sync's own refresh buffer so the app's guard
 * and the library's proactive warm-up agree on "stale".
 */
const TOKEN_REAUTH_BUFFER_MS = 5 * 60 * 1000

/**
 * Drive I/O operations (list, read, write) must complete within this timeout.
 * Prevents hangs when files have permission issues or are in an inconsistent state.
 */
const DRIVE_IO_TIMEOUT_MS = 30 * 1000

/**
 * Local base64 -> bytes decoder for the envelope's `salt` field. crypto.ts's
 * equivalent helper is private; kept in sync with its behavior rather than
 * exported from there.
 */
function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/**
 * Wrap a promise in a timeout. Rejects with a descriptive error if the operation
 * does not complete within the specified time.
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operationName: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${operationName} timed out after ${timeoutMs}ms (possible permission or sync issue with shared files)`)),
        timeoutMs
      )
    ),
  ])
}

/**
 * Decrypts a backup envelope into a usable AppState.
 *
 * The coalesce step is not optional. A Drive backup written by an older build
 * lacks whatever fields have been added since, and JSON.parse hands those back
 * as `undefined` — which the reducer stores verbatim, so the first component to
 * read one throws during render and React unmounts the entire tree, leaving a
 * blank page. The local unlock path has always normalized here; the Drive
 * restore path must too. Every caller that decrypts a backup goes through this.
 */
export async function decryptBackupEnvelope(
  envelope: EncryptedEnvelope,
  key: CryptoKey
): Promise<AppState> {
  return coalesceWithDefaults(await decryptState(envelope, key))
}

/**
 * A cached access token is "valid" only when a connection exists, its granted
 * scopes are complete, and the token's expiry is far enough in the future.
 * Anything else means a Google auth flow is required before Drive I/O can run.
 */
function isTokenUsable(conn: Connection | null): conn is Connection {
  return (
    conn !== null &&
    !conn.needsReauth &&
    conn.expiresAt !== null &&
    conn.expiresAt > Date.now() + TOKEN_REAUTH_BUFFER_MS
  )
}

export interface DriveAuthStatus {
  connected: boolean
  email: string | null
  expiresAt: number | null
  needsReauth: boolean
  tokenValid: boolean
}

/**
 * Non-interactive auth snapshot for the UI. Never opens a Google window.
 * `tokenValid` is true only when a cached token exists and has not expired.
 */
export async function getDriveAuthStatus(): Promise<DriveAuthStatus> {
  const conn = await driveSync.project(APP_PROJECT_ID).getConnection()
  return {
    connected: conn !== null,
    email: conn?.email ?? null,
    expiresAt: conn?.expiresAt ?? null,
    needsReauth: conn?.needsReauth ?? false,
    tokenValid: isTokenUsable(conn),
  }
}

// In-flight guard: at most one interactive connect at a time, so rapid
// sync/restore calls can never spawn multiple Google auth windows.
let connectInFlight: Promise<Connection> | null = null

/**
 * Guarantee a usable token before a user-triggered Drive operation. Reuses
 * the cached token as-is while it is still valid; otherwise starts the
 * interactive Google auth flow — exactly once, even if several callers race.
 */
export async function ensureFreshConnection(): Promise<Connection> {
  const conn = await driveSync.project(APP_PROJECT_ID).getConnection()
  if (isTokenUsable(conn)) {
    return conn
  }
  if (!connectInFlight) {
    connectInFlight = connectDrive().finally(() => {
      connectInFlight = null
    })
  }
  return connectInFlight
}

/**
 * Start the interactive Google OAuth connect flow for the Portfolio project.
 * This is the only call that opens a Google auth window.
 */
export async function connectDrive(): Promise<Connection> {
  return driveSync.project(APP_PROJECT_ID).connect()
}

/**
 * Disconnect the Portfolio project: revokes the cached token and clears the
 * stored connection.
 */
export async function disconnectDrive(): Promise<void> {
  return driveSync.project(APP_PROJECT_ID).disconnect()
}

/**
 * Sync app state to Google Drive as a JSON backup file.
 * Called after user interactions to persist app state to Drive.
 *
 * Opens a Google auth window only when the cached token has expired or is
 * missing; a still-valid stored token is reused without prompting.
 *
 * @param state The current app state to backup
 * @param key AES-GCM key to encrypt the backup under
 * @param salt PBKDF2 salt used to derive `key`, stored alongside the ciphertext
 *   so restore can re-derive the same key from a password
 * @throws Throws if Drive connection fails or write fails
 */
export async function syncBackup(state: AppState, key: CryptoKey, salt: Uint8Array): Promise<string> {
  try {
    await ensureFreshConnection()
    const project = driveSync.project(APP_PROJECT_ID)

    // Ensure app folder structure (OpenWebApp/Portfolio) exists
    const folderId = await withTimeout(
      project.ensureFolderPath(),
      DRIVE_IO_TIMEOUT_MS,
      'ensureFolderPath'
    )

    // Find the existing backup file by name so we can update it instead of creating a new one
    const existingFiles = await withTimeout(
      project.files.list({
        folderId,
        nameEquals: APP_STATE_FILENAME,
      }),
      DRIVE_IO_TIMEOUT_MS,
      'files.list (for existing backup)'
    )
    const existingFileId = existingFiles.length > 0 ? existingFiles[0].id : undefined

    // Encrypt state into a versioned envelope and serialize as JSON
    const envelope = await encryptState(state, key, salt)
    const jsonContent = JSON.stringify(envelope)

    // Update the existing file or create a new one if none exists
    const file = await withTimeout(
      project.files.write({
        fileId: existingFileId,
        folderId,
        name: APP_STATE_FILENAME,
        content: jsonContent,
        mimeType: 'application/json',
      }),
      DRIVE_IO_TIMEOUT_MS,
      'files.write'
    )

    // Return the Drive file id so the UI can link to it
    return file.id
  } catch (error) {
    console.error('Failed to sync backup to Drive:', error)
    throw error
  }
}

/**
 * Returns the Drive file id of the current backup, or null if no backup has
 * been synced yet. Used to show the "View in Google Drive" link when a
 * backup already exists.
 *
 * This is a status probe (also called on page load), so it never opens a
 * Google auth window: an expired/missing token yields null, not an error.
 */
export async function getBackupFileId(): Promise<string | null> {
  try {
    const project = driveSync.project(APP_PROJECT_ID)

    const folderId = await withTimeout(
      project.ensureFolderPath(),
      DRIVE_IO_TIMEOUT_MS,
      'ensureFolderPath'
    )

    const files = await withTimeout(
      project.files.list({
        folderId,
        nameEquals: APP_STATE_FILENAME,
      }),
      DRIVE_IO_TIMEOUT_MS,
      'files.list'
    )

    return files.length > 0 ? files[0].id : null
  } catch (error) {
    if (error instanceof NeedsReauthError) {
      // No usable token (expired/never acquired): do not prompt from a
      // passive lookup — report "no backup link" and let sync/restore
      // handle reauth when the user actually triggers them.
      console.warn('Drive token expired; skipping backup link lookup:', error)
      return null
    }
    // Timeout or permission errors are not fatal for a passive lookup —
    // the folder may not exist yet, or may be inaccessible. Return null
    // and let sync/restore handle creating the folder or showing errors.
    if (error instanceof Error && error.message.includes('timed out')) {
      console.warn('Drive folder lookup timed out; assuming no backup exists:', error)
      return null
    }
    console.error('Failed to look up backup file on Drive:', error)
    throw error
  }
}

/**
 * Reads a Drive file by id and decrypts it into an AppState. Used by
 * `restoreBackupFromFileId` (the file id comes from the user's Google
 * Picker selection — see `drive.project(id).pickFile()` above) so restore
 * throws a consistent `DriveDecryptError` on a wrong-password mismatch.
 */
async function readAndDecryptFile(fileId: string, key: CryptoKey): Promise<AppState | null> {
  const project = driveSync.project(APP_PROJECT_ID)

  const content = await withTimeout(
    project.files.read(fileId),
    DRIVE_IO_TIMEOUT_MS,
    'files.read'
  )

  if (!content) {
    return null
  }

  let contentStr: string

  // Handle case where content might be a Blob, Buffer, or other non-string type
  if (typeof content === 'string') {
    contentStr = content
  } else if (content instanceof ArrayBuffer || content instanceof Uint8Array) {
    // Convert binary data to string
    const decoder = new TextDecoder()
    contentStr = decoder.decode(content)
  } else if (typeof content === 'object' && 'text' in content && typeof (content as any).text === 'function') {
    // Handle Blob type (has a text() method)
    contentStr = await (content as any).text()
  } else {
    // Unrecognized content type
    return null
  }

  if (!contentStr) {
    return null
  }

  let envelope: EncryptedEnvelope
  let salt: Uint8Array

  // Parse the envelope and extract salt before attempting decryption,
  // so that wrong-password errors can carry both salt and envelope
  try {
    envelope = JSON.parse(contentStr) as EncryptedEnvelope
    salt = base64ToBytes(envelope.salt)
  } catch (parseError) {
    // If we can't parse the JSON or extract the salt, treat it as an
    // unreadable file rather than a decryption error
    if (parseError instanceof Error && (parseError.name === 'SyntaxError' || parseError.name === 'TypeError')) {
      return null
    }
    throw parseError
  }

  try {
    return await decryptBackupEnvelope(envelope, key)
  } catch (decryptError) {
    if (decryptError instanceof Error && decryptError.name === 'OperationError') {
      throw new DriveDecryptError('backup encrypted with a different password', salt, envelope)
    }
    throw decryptError
  }
}

/**
 * Restore app state from a specific Drive file id, supplied by the user's
 * Google Picker selection (`drive.project(id).pickFile()`). There is no
 * by-name lookup in the app's own `OpenWebApp/Portfolio` folder — Picker is
 * the only restore entry point, which also lets it reach a backup shared
 * with this account by another Google account rather than synced from it
 * (a plain `files.list` only ever sees files inside this account's own
 * folder tree).
 *
 * @throws {DriveDecryptError} If the backup decrypts with an auth-tag
 *   mismatch (wrong password/key)
 * @throws Throws if Drive connection fails, the read fails, the file is
 *   empty/unreadable, the backup JSON is malformed, or decryption fails for
 *   a reason other than a wrong key
 */
export async function restoreBackupFromFileId(fileId: string, key: CryptoKey): Promise<AppState> {
  try {
    await ensureFreshConnection()
    const restored = await readAndDecryptFile(fileId, key)
    if (!restored) {
      throw new Error('Picked Drive file is empty or unreadable')
    }
    return restored
  } catch (error) {
    console.error('Failed to restore backup from picked Drive file:', error)
    throw error
  }
}

/**
 * Creates a single encrypted SyncDocument for the portfolio state.
 * Handles serialization (AppState → JSON → encrypt → Uint8Array)
 * and deserialization (Uint8Array → decrypt → JSON → AppState).
 *
 * T33 Implementation:
 * - name: 'portfolio-state.json'
 * - readLocal: load + encryptState envelope → Uint8Array
 * - merge: decrypt both, remote-replace-or-local-wins per existing semantics
 * - writeLocal: decrypt + persist
 * - crypto.ts untouched
 *
 * Decision 20: writeLocal is never called on pure push, only on merge/restore.
 * Decision 22: rebuilt from each fresh read, never accumulated across attempts.
 */
export function createPortfolioSyncDocument(
  key: CryptoKey,
  salt: Uint8Array,
  readAppState: () => Promise<AppState | null>,
  writeAppState: (state: AppState) => Promise<void>
): SyncDocument {
  return {
    key: 'portfolio-state',
    name: 'portfolio-state.json',
    mimeType: 'application/json',

    /**
     * Serialize local app state to encrypted bytes.
     * Returns null if no local state exists (shouldn't happen in portfolio's case).
     */
    async readLocal(): Promise<Uint8Array | null> {
      const state = await readAppState()
      if (!state) return null

      const envelope = await encryptState(state, key, salt)
      return new TextEncoder().encode(JSON.stringify(envelope))
    },

    /**
     * Merge local and remote encrypted state.
     *
     * Decrypt both (if they exist), then apply remote-replace-or-local-wins semantics:
     * - Both exist: remote wins (user's latest Drive backup is authoritative on restore)
     * - Only remote: use remote (downloaded backup)
     * - Only local: use local (user hasn't sync'd to Drive yet)
     * - Neither: return empty state
     *
     * Decision 11: merge is required. This is the only place app semantics matter.
     */
    async merge(
      local: string | Uint8Array | null,
      remote: string | Uint8Array | null
    ): Promise<{ merged: string | Uint8Array; conflicts: unknown[] }> {
      let localState: AppState | null = null
      let remoteState: AppState | null = null

      // Decrypt local
      if (local) {
        try {
          const localStr = typeof local === 'string' ? local : new TextDecoder().decode(local)
          const envelope = JSON.parse(localStr) as EncryptedEnvelope
          localState = await decryptState(envelope, key)
        } catch (error) {
          // If local can't decrypt, treat as absent
          console.warn('Failed to decrypt local state during merge:', error)
          localState = null
        }
      }

      // Decrypt remote
      if (remote) {
        try {
          const remoteStr = typeof remote === 'string' ? remote : new TextDecoder().decode(remote)
          const envelope = JSON.parse(remoteStr) as EncryptedEnvelope
          remoteState = await decryptState(envelope, key)
        } catch (error) {
          if (error instanceof Error && error.name === 'OperationError') {
            throw new DriveDecryptError(
              'Remote backup encrypted with a different password',
              salt,
              JSON.parse(typeof remote === 'string' ? remote : new TextDecoder().decode(remote))
            )
          }
          throw error
        }
      }

      // Apply remote-replace-or-local-wins
      const merged = remoteState ?? localState ?? ({} as AppState)

      // Serialize merged state back to encrypted envelope bytes
      const envelope = await encryptState(merged, key, salt)
      const merged_bytes = new TextEncoder().encode(JSON.stringify(envelope))
      return {
        merged: merged_bytes,
        conflicts: [],
      }
    },

    /**
     * Persist merged/restored state locally.
     * Only called on merge or explicit restore, not on pure push.
     */
    async writeLocal(merged: string | Uint8Array): Promise<void> {
      // Decrypt the merged envelope
      const mergedStr = typeof merged === 'string' ? merged : new TextDecoder().decode(merged)
      const envelope = JSON.parse(mergedStr) as EncryptedEnvelope
      const state = await decryptState(envelope, key)

      // Coalesce with defaults for migration tolerance
      const coalesced = coalesceWithDefaults(state)

      // Write to app state persistence
      await writeAppState(coalesced)
    },
  }
}
