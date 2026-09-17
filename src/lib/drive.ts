import { createDriveSync, NeedsReauthError, PickerCancelledError } from '@open-webapp/drive-sync'
import type { Connection } from '@open-webapp/drive-sync'
import { createDriveAuth } from '@open-webapp/drive-connect'
import type { AppState } from './state'
import { coalesceWithDefaults } from './persist'
import { decryptState, deriveKey, encryptState } from './crypto'
import type { EncryptedEnvelope } from './crypto'
import type { Portfolio } from './types'
import { isMigratedPortfolio } from './portfolioRegistry'

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
 * Thrown when a Drive folder's backup file is missing, unreadable, or its
 * content can't be parsed/recognized as an encrypted backup envelope.
 * Distinguishable from `DriveDecryptError` (wrong password on an otherwise
 * well-formed envelope) so callers can silently skip a malformed folder while
 * still surfacing a password-retry prompt for a decrypt failure.
 */
export class DriveMalformedBackupError extends Error {}

/**
 * Resolve the Drive auth/sync "project id" for a portfolio: the legacy,
 * pre-multi-portfolio db keeps the original fixed 'app' id (so its existing
 * Drive-stored token/connection keeps working); every other portfolio gets
 * its own id (its portfolio id) so each has an isolated Drive connection.
 */
function driveProjectIdFor(portfolio: Portfolio): string {
  return isMigratedPortfolio(portfolio) ? 'app' : portfolio.id
}

/**
 * Legacy fixed-path Drive facade. Backs `getPickerDriveAuth()` below (the
 * portfolio picker's Drive folder browsing/import). Also backs the `drive`
 * compatibility wrapper further down, which has no current callers — it was
 * built for the now-deleted `DriveRestorePanel` component. Not exported
 * itself.
 */
export const legacyDriveSync = createDriveSync({
  appId: 'portfolio',
  clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID,
  folderPath: ['OpenWebApp', 'Portfolio'],
})

const driveAuthCache = new Map<string, ReturnType<typeof createDriveAuth>>()

/**
 * Drive-sync's `files.list({ folderId, mimeType })` (see
 * node_modules/@open-webapp/drive-sync/dist/files.d.ts `ListOptions`) is how
 * "list only folders under a folderId" is expressed: pass
 * `mimeType: 'application/vnd.google-apps.folder'` alongside `folderId` —
 * there's no separate boolean flag or dedicated folder-listing call. Each
 * returned `FileRef` optionally carries a Drive `mimeType` string (no
 * `isFolder`-like boolean) — a later folder-listing task can compare it
 * against `'application/vnd.google-apps.folder'` itself, or simply rely on
 * having already filtered the `list()` call by that mimeType.
 */

let pickerDriveAuth: ReturnType<typeof createDriveAuth> | undefined

/**
 * Returns the (cached, lazily-created) Drive auth handle used for the
 * portfolio picker's Drive folder browsing — distinct from the per-portfolio
 * `driveAuthCache` above. Fixed project id `'picker'`, which cannot collide
 * with a per-portfolio project id (always a portfolio id, an opaque
 * generated id — never the literal string `'picker'`) or with the legacy
 * `'app'` id used for the migrated portfolio (see `driveProjectIdFor`).
 * Reuses `legacyDriveSync` (already scoped to `folderPath: ['OpenWebApp',
 * 'Portfolio']`, the folder this picker needs to browse) instead of
 * instantiating a redundant drive-sync facade.
 */
export function getPickerDriveAuth() {
  if (!pickerDriveAuth) {
    pickerDriveAuth = createDriveAuth({
      drive: legacyDriveSync,
      projectId: 'picker',
      tokenBufferMs: 5 * 60 * 1000,
    })
  }
  return pickerDriveAuth
}

let categoryDriveAuth: ReturnType<typeof createDriveAuth> | undefined

/**
 * Returns the (cached, lazily-created) Drive auth handle for the global,
 * cross-portfolio `category-mappings.json` file (see `categoryDrive.ts`).
 * Fixed project id `'category-mappings'`, matching the id `categoryDrive.ts`
 * uses for `legacyDriveSync.project(...)` file I/O — the two MUST use the
 * same project id, since drive-sync stores/looks up tokens keyed by
 * `(appId, projectId)`. Categories are shared across every portfolio, so
 * this is deliberately its own connection rather than a per-portfolio one
 * from `getDriveAuthFor` (whose project id is the portfolio's own, a
 * different key that would never hold a valid token for this file's I/O).
 */
export function getCategoryDriveAuth() {
  if (!categoryDriveAuth) {
    categoryDriveAuth = createDriveAuth({
      drive: legacyDriveSync,
      projectId: 'category-mappings',
      tokenBufferMs: 5 * 60 * 1000,
    })
  }
  return categoryDriveAuth
}

/**
 * Lists the immediate subfolders of the app's Drive root
 * (`OpenWebApp/Portfolio`) — each one is expected to be a per-portfolio
 * backup folder (see `driveSyncForPortfolio`), so this is how the portfolio
 * picker discovers portfolios that exist on Drive but not yet locally.
 *
 * `ensureFresh()` runs first and is deliberately left uncaught: an
 * auth/connect failure must reject so the picker UI can show a "couldn't
 * connect" message rather than silently rendering an empty list. Once auth
 * has succeeded, though, this is a passive lookup — if `files.list` itself
 * throws (transient network error, folder doesn't exist yet), that is
 * swallowed to `[]` rather than surfaced as a hard failure.
 */
export async function listPortfolioFoldersOnDrive(): Promise<{ name: string; id: string }[]> {
  await getPickerDriveAuth().ensureFresh()

  const project = legacyDriveSync.project('picker')

  try {
    const folderId = await withTimeout(
      project.ensureFolderPath(),
      DRIVE_IO_TIMEOUT_MS,
      'ensureFolderPath (picker root)'
    )
    const folders = await withTimeout(
      project.files.list({
        folderId,
        mimeType: 'application/vnd.google-apps.folder',
      }),
      DRIVE_IO_TIMEOUT_MS,
      'files.list (portfolio folders)'
    )
    return folders.map((f) => ({ name: f.name ?? '', id: f.id }))
  } catch (error) {
    console.warn('Failed to list portfolio folders on Drive:', error)
    return []
  }
}

/**
 * Reads and decrypts the `portfolio-state.json` backup inside a specific
 * Drive folder (one of the folders returned by `listPortfolioFoldersOnDrive`)
 * — used by the portfolio picker to preview/import a portfolio that exists on
 * Drive but not yet locally.
 *
 * `ensureFresh()` is deliberately left uncaught, same convention as
 * `listPortfolioFoldersOnDrive`: an auth/connect failure must propagate raw so
 * the picker UI can distinguish "couldn't connect" from "this folder has no
 * usable backup".
 *
 * Everything else about a missing/unreadable/malformed backup file is folded
 * into `DriveMalformedBackupError` — no file, an unreadable file, unparseable
 * JSON, or an envelope missing the fields `base64ToBytes`/`deriveKey` need.
 * That is deliberately distinct from `DriveDecryptError` (thrown only for a
 * wrong-password auth-tag mismatch on an otherwise well-formed envelope), so a
 * later caller can silently skip malformed folders while still surfacing a
 * password-retry prompt for a decrypt failure.
 */
export async function decryptDriveFolderBackup(
  folderId: string,
  password: string
): Promise<{ state: AppState; key: CryptoKey; salt: Uint8Array }> {
  await getPickerDriveAuth().ensureFresh()

  const project = legacyDriveSync.project('picker')

  const files = await project.files.list({
    folderId,
    nameEquals: APP_STATE_FILENAME,
  })
  if (files.length === 0) {
    throw new DriveMalformedBackupError(`No ${APP_STATE_FILENAME} found in Drive folder`)
  }

  let content: unknown
  try {
    content = await project.files.read(files[0].id)
  } catch (error) {
    throw new DriveMalformedBackupError(
      `Failed to read ${APP_STATE_FILENAME} from Drive folder: ${error instanceof Error ? error.message : String(error)}`
    )
  }

  if (!content) {
    throw new DriveMalformedBackupError(`${APP_STATE_FILENAME} in Drive folder is empty or unreadable`)
  }

  let contentStr: string
  if (typeof content === 'string') {
    contentStr = content
  } else if (content instanceof ArrayBuffer || content instanceof Uint8Array) {
    contentStr = new TextDecoder().decode(content)
  } else if (typeof content === 'object' && 'text' in content && typeof (content as any).text === 'function') {
    contentStr = await (content as any).text()
  } else {
    throw new DriveMalformedBackupError(`${APP_STATE_FILENAME} in Drive folder has an unrecognized content type`)
  }

  if (!contentStr) {
    throw new DriveMalformedBackupError(`${APP_STATE_FILENAME} in Drive folder is empty`)
  }

  let envelope: EncryptedEnvelope
  let salt: Uint8Array
  try {
    envelope = JSON.parse(contentStr) as EncryptedEnvelope
    salt = base64ToBytes(envelope.salt)
    if (!(salt instanceof Uint8Array) || salt.length === 0) {
      throw new Error('missing or empty salt')
    }
  } catch (parseError) {
    throw new DriveMalformedBackupError(
      `Malformed backup envelope in Drive folder: ${parseError instanceof Error ? parseError.message : String(parseError)}`
    )
  }

  const key = await deriveKey(password, salt)

  try {
    const state = await decryptBackupEnvelope(envelope, key)
    return { state, key, salt }
  } catch (decryptError) {
    if (decryptError instanceof Error && decryptError.name === 'OperationError') {
      throw new DriveDecryptError('backup encrypted with a different password', salt, envelope)
    }
    throw decryptError
  }
}

/**
 * Returns the (cached, lazily-created) Drive auth handle for a portfolio.
 * Each non-legacy portfolio gets its own isolated auth/token via its own
 * project id; the migrated legacy portfolio keeps reusing the original
 * fixed 'app' project id so its existing stored token/connection survives.
 */
export function getDriveAuthFor(portfolio: Portfolio) {
  const projectId = driveProjectIdFor(portfolio)
  let auth = driveAuthCache.get(projectId)
  if (!auth) {
    const authFacade = createDriveSync({
      appId: 'portfolio',
      clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID,
      folderPath: ['OpenWebApp', 'Portfolio'],
    })
    auth = createDriveAuth({
      drive: authFacade,
      projectId,
      tokenBufferMs: 5 * 60 * 1000,
    })
    driveAuthCache.set(projectId, auth)
  }
  return auth
}

/**
 * Builds a drive-sync instance scoped to a portfolio's own Drive folder
 * (named after the portfolio), so each portfolio's backup lives in its own
 * folder under OpenWebApp/Portfolio.
 */
function driveSyncForPortfolio(portfolio: Portfolio) {
  return createDriveSync({
    appId: 'portfolio',
    clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID,
    folderPath: ['OpenWebApp', 'Portfolio', portfolio.name],
  })
}

/**
 * Wrapper around drive-sync that overrides pickFile to return a single file
 * object with an 'id' property instead of an array of PickedFile objects.
 * Originally built for the now-deleted `DriveRestorePanel` component; it has
 * no current callers in the app (only exercised directly by
 * drivePickFile.test.ts). Left in place rather than removed here — see
 * design.md's "Orphaned code" note.
 */
export const drive = {
  ...legacyDriveSync,
  project: (projectId: string) => {
    const project = legacyDriveSync.project(projectId)
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
    } as ReturnType<typeof legacyDriveSync.project> & { pickFile: (options?: any) => Promise<{ id: string; name?: string; mimeType?: string } | null> }
  },
} as any

/**
 * Synchronous snapshot of the current Drive connection for a portfolio's
 * project. Thin wrapper over drive-sync's `getConnectionSync()` — never
 * throws, never returns a Promise, and `null` means disconnected (or
 * not-yet-hydrated; callers can't distinguish the two, which is expected).
 */
export function getConnectionSnapshot(portfolio: Portfolio): Connection | null {
  return driveSyncForPortfolio(portfolio).project(driveProjectIdFor(portfolio)).getConnectionSync()
}

const APP_STATE_FILENAME = 'portfolio-state.json'

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
 * Sync app state to Google Drive as a JSON backup file.
 * Called after user interactions to persist app state to Drive.
 *
 * Opens a Google auth window only when the cached token has expired or is
 * missing; a still-valid stored token is reused without prompting.
 *
 * @param portfolio The portfolio whose Drive connection/folder to sync to
 * @param state The current app state to backup
 * @param key AES-GCM key to encrypt the backup under
 * @param salt PBKDF2 salt used to derive `key`, stored alongside the ciphertext
 *   so restore can re-derive the same key from a password
 * @throws Throws if Drive connection fails or write fails
 */
export async function syncBackup(portfolio: Portfolio, state: AppState, key: CryptoKey, salt: Uint8Array): Promise<string> {
  try {
    await getDriveAuthFor(portfolio).ensureFresh()
    const project = driveSyncForPortfolio(portfolio).project(driveProjectIdFor(portfolio))

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
export async function getBackupFileId(portfolio: Portfolio): Promise<string | null> {
  try {
    const project = driveSyncForPortfolio(portfolio).project(driveProjectIdFor(portfolio))

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
 * Status probe for a Drive backup file, addressed by id. Thin wrapper over
 * drive-sync's `files.status` (via `withTimeout`) that returns only the
 * subset the conflict path needs: whether the file still exists, its remote
 * content-modified time (RFC3339), and when this client last restored/wrote
 * it (epoch ms).
 *
 * Deliberately does NOT surface drive-sync's `changedSinceRestore` flag: that
 * is a Drive `version`-counter comparison that also trips on metadata-only
 * server changes (a `viewedByMeTime` bump from our own read, a sharing
 * touch), producing a "changed" verdict with no content change. The conflict
 * path relies solely on the thrown `RemoteChangedError` for detection and on
 * `remoteModifiedTime` vs `lastRestoredAt` to tell a real remote edit from
 * spurious version drift.
 *
 * `files.status` throwing (expired token, permission issue) propagates; the
 * caller in App swallows it with `.catch(() => null)`.
 */
export async function getBackupFileStatus(portfolio: Portfolio, fileId: string): Promise<{
  exists: boolean
  remoteModifiedTime?: string
  lastRestoredAt?: number
}> {
  const status = await withTimeout(
    driveSyncForPortfolio(portfolio).project(driveProjectIdFor(portfolio)).files.status(fileId),
    DRIVE_IO_TIMEOUT_MS,
    'files.status'
  )
  return {
    exists: status.exists,
    remoteModifiedTime: status.remoteModifiedTime,
    // drive-sync types `lastRestoredAt` as epoch-ms | null; normalize null → undefined.
    lastRestoredAt: status.lastRestoredAt ?? undefined,
  }
}

/**
 * Reads a Drive file by id and decrypts it into an AppState. Used by
 * `restoreBackupFromFileId` (the file id comes from the user's Google
 * Picker selection — see `drive.project(id).pickFile()` above) so restore
 * throws a consistent `DriveDecryptError` on a wrong-password mismatch.
 */
async function readAndDecryptFile(portfolio: Portfolio, fileId: string, key: CryptoKey): Promise<AppState | null> {
  const project = driveSyncForPortfolio(portfolio).project(driveProjectIdFor(portfolio))

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
export async function restoreBackupFromFileId(portfolio: Portfolio, fileId: string, key: CryptoKey): Promise<AppState> {
  try {
    await getDriveAuthFor(portfolio).ensureFresh()
    const restored = await readAndDecryptFile(portfolio, fileId, key)
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
 * Resolve a Drive-vs-local conflict by taking the remote backup wholesale:
 * read the file at `fileId`, decrypt it, and hand back the resulting
 * `AppState` for the caller to write locally. This is the "overwrite local
 * with remote" resolution path — it deliberately does not consult
 * `files.status`, so it works regardless of whether drive-sync would have
 * reported the file as `remote-changed` or `never-restored`.
 *
 * Delegates the read + decrypt to the private `readAndDecryptFile`, which
 * also advances the restore baseline (via `files.read`) and maps a
 * wrong-password auth-tag mismatch to `DriveDecryptError`.
 *
 * @throws {DriveDecryptError} If the backup decrypts with an auth-tag
 *   mismatch (wrong password/key) — propagated unchanged.
 * @throws Throws if the Drive connection fails, the read fails, or the file
 *   is empty/unreadable.
 */
export async function overwriteLocalWithRemote(portfolio: Portfolio, fileId: string, key: CryptoKey): Promise<AppState> {
  await getDriveAuthFor(portfolio).ensureFresh()
  const restored = await readAndDecryptFile(portfolio, fileId, key)
  if (!restored) {
    throw new Error('Drive backup is empty or unreadable')
  }
  return restored
}

/**
 * Resolve a Drive-vs-local conflict by taking the local state wholesale and
 * pushing it over the remote backup. The sole purpose of the `files.read` here
 * is to adopt the remote's current version as the new restore baseline, so the
 * subsequent `syncBackup` write is diffed against an up-to-date base rather
 * than the stale one that triggered the conflict; the read content itself is
 * discarded.
 *
 * `syncBackup` is reused verbatim — it re-lists the folder and writes with the
 * freshly-adopted baseline. If it STILL throws `RemoteChangedError` (the remote
 * moved again between this read and the write), that propagates unchanged:
 * there is no retry loop, the caller decides what to do next.
 *
 * @throws {import('@open-webapp/drive-sync').RemoteChangedError} If the write
 *   still races a concurrent remote change — propagated unchanged, not retried.
 * @throws Throws if the Drive connection fails or the read/write fails.
 */
export async function overwriteRemoteWithLocal(
  portfolio: Portfolio,
  state: AppState,
  key: CryptoKey,
  salt: Uint8Array,
  fileId: string
): Promise<string> {
  await getDriveAuthFor(portfolio).ensureFresh()
  await withTimeout(
    driveSyncForPortfolio(portfolio).project(driveProjectIdFor(portfolio)).files.read(fileId),
    DRIVE_IO_TIMEOUT_MS,
    'files.read (adopt baseline)'
  )
  return await syncBackup(portfolio, state, key, salt)
}

/**
 * One-time, idempotent migration of a portfolio's Drive backup out of the
 * legacy flat root folder (`OpenWebApp/Portfolio/portfolio-state.json`,
 * shared by every portfolio before the multi-portfolio feature) into its own
 * named subfolder (`OpenWebApp/Portfolio/{portfolio.name}/portfolio-state.json`).
 *
 * Only applies to the migrated legacy portfolio (`isMigratedPortfolio`) —
 * every other portfolio was created after the multi-portfolio folder scheme
 * existed and never had a flat-root file to migrate.
 *
 * Deliberately non-interactive: this runs as a background step (e.g. before
 * a sync), not in response to a direct user "connect" action, so it must
 * never itself trigger an auth popup. It reuses `getConnectionSnapshot`'s
 * exact mechanism (`ProjectHandle.getConnectionSync()`) to check for an
 * existing, still-valid connection and no-ops otherwise.
 *
 * Safe to call unconditionally on every load/sync: once the flat-root file
 * has been moved (or never existed), `files.list` finds nothing and this
 * becomes a cheap no-op forever after.
 *
 * Ordered write-then-remove: the new copy is written before the old one is
 * removed, so a crash between the two steps leaves the legacy file in place
 * (migration simply retries next time) rather than losing data.
 */
export async function migrateLegacyDriveFolderIfNeeded(portfolio: Portfolio): Promise<void> {
  if (!isMigratedPortfolio(portfolio)) return

  const conn = getConnectionSnapshot(portfolio)
  if (!conn || conn.needsReauth) return // don't prompt just for this

  const projectId = driveProjectIdFor(portfolio)
  const rootProject = legacyDriveSync.project(projectId)

  const rootFolderId = await withTimeout(
    rootProject.ensureFolderPath(),
    DRIVE_IO_TIMEOUT_MS,
    'ensureFolderPath (legacy root)'
  )
  const flatFiles = await withTimeout(
    rootProject.files.list({ folderId: rootFolderId, nameEquals: APP_STATE_FILENAME }),
    DRIVE_IO_TIMEOUT_MS,
    'files.list (legacy root)'
  )
  if (flatFiles.length === 0) return // already migrated or never existed

  const content = await withTimeout(
    rootProject.files.read(flatFiles[0].id),
    DRIVE_IO_TIMEOUT_MS,
    'files.read (legacy root)'
  )
  if (content == null) return // file vanished/unreadable between list and read — nothing to migrate

  const newProject = driveSyncForPortfolio(portfolio).project(projectId)
  const newFolderId = await withTimeout(
    newProject.ensureFolderPath(),
    DRIVE_IO_TIMEOUT_MS,
    'ensureFolderPath (portfolio folder)'
  )
  await withTimeout(
    newProject.files.write({
      folderId: newFolderId,
      name: APP_STATE_FILENAME,
      content,
      mimeType: 'application/json',
    }),
    DRIVE_IO_TIMEOUT_MS,
    'files.write (portfolio folder)'
  )
  await withTimeout(
    rootProject.files.remove(flatFiles[0].id),
    DRIVE_IO_TIMEOUT_MS,
    'files.remove (legacy root)'
  )
}
