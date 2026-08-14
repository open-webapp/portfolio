import { createDriveSync, NeedsReauthError } from '@open-webapp/drive-sync'
import type { Connection } from '@open-webapp/drive-sync'
import type { AppState } from './state'
import { decryptState, encryptState } from './crypto'
import type { EncryptedEnvelope } from './crypto'

/**
 * Single app-wide drive-sync facade. `folderPath` here is load-bearing and
 * silent-failure-prone: a wrong value does not error, it just creates a
 * fresh EMPTY Drive folder, and every existing user's backup appears to
 * have vanished. See drive.test.ts for a test that pins this exact array.
 */
export const drive = createDriveSync({
  appId: 'portfolio',
  clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID,
  folderPath: ['OpenWebApp', 'Portfolio'],
})

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
 * Thrown by `restoreBackup` when the Drive backup was read successfully but
 * failed to decrypt due to an auth-tag mismatch (wrong password/key). Carries
 * the decoded salt and the raw envelope so a caller can retry decryption
 * locally (e.g. after prompting for a different password) without a second
 * Drive network round-trip.
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
 * Read the current Drive connection (no network calls, no reauth prompt).
 * Returns null if never connected. `expiresAt` is the cached token's expiry
 * (null when no token is stored yet).
 */
export async function getDriveConnection(): Promise<Connection | null> {
  return drive.project(APP_PROJECT_ID).getConnection()
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
  const conn = await getDriveConnection()
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
async function ensureFreshConnection(): Promise<Connection> {
  const conn = await getDriveConnection()
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
  return drive.project(APP_PROJECT_ID).connect()
}

/**
 * Disconnect the Portfolio project: revokes the cached token and clears the
 * stored connection.
 */
export async function disconnectDrive(): Promise<void> {
  return drive.project(APP_PROJECT_ID).disconnect()
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
    const project = drive.project(APP_PROJECT_ID)

    // Ensure app folder structure (OpenWebApp/Portfolio) exists
    const folderId = await withTimeout(
      project.ensureFolderPath(),
      DRIVE_IO_TIMEOUT_MS,
      'ensureFolderPath'
    )

    // Encrypt state into a versioned envelope and serialize as JSON
    const envelope = await encryptState(state, key, salt)
    const jsonContent = JSON.stringify(envelope)

    // Write the file (will update if exists, create if not)
    const file = await withTimeout(
      project.files.write({
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
    const project = drive.project(APP_PROJECT_ID)

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
 * Reads a Drive file by id and decrypts it into an AppState. Shared by
 * `restoreBackup` (looks the file up by name in the app's own folder) and
 * `restoreBackupFromFileId` (file id supplied directly, e.g. from
 * `pickDriveFile`) so both paths throw the same `DriveDecryptError` on a
 * wrong-password mismatch.
 */
async function readAndDecryptFile(fileId: string, key: CryptoKey): Promise<AppState | null> {
  const project = drive.project(APP_PROJECT_ID)

  const content = await withTimeout(
    project.files.read(fileId),
    DRIVE_IO_TIMEOUT_MS,
    'files.read'
  )

  if (!content || typeof content !== 'string') {
    return null
  }

  // Parse the envelope and decrypt it back into the app state
  const envelope = JSON.parse(content) as EncryptedEnvelope
  const salt = base64ToBytes(envelope.salt)

  try {
    return await decryptState(envelope, key)
  } catch (decryptError) {
    if (decryptError instanceof Error && decryptError.name === 'OperationError') {
      throw new DriveDecryptError('backup encrypted with a different password', salt, envelope)
    }
    throw decryptError
  }
}

/**
 * Restore app state from Google Drive JSON backup.
 * Returns null if no backup file exists.
 *
 * Opens a Google auth window only when the cached token has expired or is
 * missing; a still-valid stored token is reused without prompting.
 *
 * @param key AES-GCM key to decrypt the backup with
 * @returns The restored app state, or null if no backup found
 * @throws {DriveDecryptError} If the backup decrypts with an auth-tag mismatch
 *   (wrong password/key)
 * @throws Throws if Drive connection fails, read fails, the backup JSON is
 *   malformed, or decryption fails for a reason other than a wrong key
 */
export async function restoreBackup(key: CryptoKey): Promise<AppState | null> {
  try {
    await ensureFreshConnection()
    const project = drive.project(APP_PROJECT_ID)

    // Ensure app folder structure exists (creates if missing, returns folderId)
    const folderId = await withTimeout(
      project.ensureFolderPath(),
      DRIVE_IO_TIMEOUT_MS,
      'ensureFolderPath'
    )

    // Find the backup file
    const files = await withTimeout(
      project.files.list({
        folderId,
        nameEquals: APP_STATE_FILENAME,
      }),
      DRIVE_IO_TIMEOUT_MS,
      'files.list'
    )

    if (files.length === 0) {
      return null
    }

    return await readAndDecryptFile(files[0].id, key)
  } catch (error) {
    console.error('Failed to restore backup from Drive:', error)
    throw error
  }
}

/**
 * Restore app state from a specific Drive file id, bypassing the by-name
 * lookup in the app's own `OpenWebApp/Portfolio` folder. For a backup that
 * was shared with this account by another Google account rather than
 * synced from it — `files.list` only ever sees files inside this account's
 * own folder tree (see the `drive.file`-scope note on `folderPath` above),
 * so a file merely shared with this account has to be located via
 * `pickDriveFile()` (Google Picker) and read by id instead.
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
 * Minimal shape of the `google.picker`/`gapi` globals this file touches.
 * No official types package is installed for these Google-hosted scripts
 * (loaded dynamically, not bundled), so this is hand-typed to just what's
 * used here rather than pulling in `any` at every call site.
 */
interface PickerDoc {
  id: string
  name: string
}
interface PickerResponse {
  action: string
  docs?: PickerDoc[]
}
interface PickerInstance {
  setVisible(visible: boolean): void
}
interface GooglePickerNamespace {
  Action: { PICKED: string; CANCEL: string }
  ViewId: { DOCS: string }
  DocsView: new (viewId: string) => DocsViewChain
  PickerBuilder: new () => {
    addView(view: unknown): PickerBuilderChain
    setOAuthToken(token: string): PickerBuilderChain
    setOrigin(origin: string): PickerBuilderChain
    setCallback(cb: (data: PickerResponse) => void): PickerBuilderChain
    build(): PickerInstance
  }
}
interface DocsViewChain {
  setIncludeFolders(v: boolean): DocsViewChain
  setSelectFolderEnabled(v: boolean): DocsViewChain
}
interface PickerBuilderChain {
  addView(view: unknown): PickerBuilderChain
  setOAuthToken(token: string): PickerBuilderChain
  setOrigin(origin: string): PickerBuilderChain
  setCallback(cb: (data: PickerResponse) => void): PickerBuilderChain
  build(): PickerInstance
}
interface GapiWindow {
  gapi?: { load: (api: string, opts: { callback: () => void; onerror?: () => void }) => void }
  google?: { picker?: GooglePickerNamespace }
}

let pickerApiLoadPromise: Promise<void> | null = null

/**
 * Loads `apis.google.com/js/api.js` (if not already present) and then the
 * `picker` module off it. Idempotent: concurrent/repeat callers share one
 * in-flight load.
 */
function loadPickerApi(): Promise<void> {
  if (pickerApiLoadPromise) {
    return pickerApiLoadPromise
  }

  pickerApiLoadPromise = new Promise<void>((resolve, reject) => {
    const w = window as unknown as GapiWindow

    const loadPickerModule = () => {
      w.gapi!.load('picker', {
        callback: () => resolve(),
        onerror: () => reject(new Error('Failed to load Google Picker API')),
      })
    }

    if (w.google?.picker) {
      resolve()
      return
    }
    if (w.gapi) {
      loadPickerModule()
      return
    }

    const script = document.createElement('script')
    script.src = 'https://apis.google.com/js/api.js'
    script.async = true
    script.defer = true
    script.onload = loadPickerModule
    script.onerror = () => reject(new Error('Failed to load Google API script'))
    document.head.appendChild(script)
  }).catch((err) => {
    // Let a failed load be retried by a later call rather than permanently
    // caching the rejection.
    pickerApiLoadPromise = null
    throw err
  })

  return pickerApiLoadPromise
}

/**
 * Opens Google's file picker so the user can select a Drive file this app
 * has not created or synced itself — e.g. a `portfolio-state.json` backup
 * another Google account shared with them. Picking a file grants this
 * app's `drive.file`-scoped token access to that specific file (this is
 * the intended mechanism for that scope, not a workaround), so the
 * returned id can be read via `restoreBackupFromFileId` immediately after.
 *
 * Resolves to `null` if the user cancels the picker instead of selecting a
 * file.
 *
 * `setOrigin` is required, not cosmetic: the Picker iframe reports the pick
 * back to this window via `postMessage`, and without an explicit target
 * origin that message is silently dropped — the widget appears to hang
 * after a file is clicked (it never closes, the callback never fires).
 *
 * @throws If the Picker script fails to load or acquiring a token fails.
 */
export async function pickDriveFile(): Promise<{ id: string; name: string } | null> {
  await ensureFreshConnection()
  const token = await drive.project(APP_PROJECT_ID).getAccessToken()
  await loadPickerApi()

  const picker = (window as unknown as GapiWindow).google!.picker!

  return new Promise((resolve, reject) => {
    let instance: PickerInstance | null = null
    let resolved = false

    try {
      const view = new picker.DocsView(picker.ViewId.DOCS)
        .setIncludeFolders(false)
        .setSelectFolderEnabled(false)

      instance = new picker.PickerBuilder()
        .addView(view)
        .setOAuthToken(token)
        .setOrigin(window.location.origin)
        .setCallback((data: PickerResponse) => {
          // Guard against multiple resolutions and errors
          if (resolved) return

          try {
            // Always close the picker first, regardless of action
            instance?.setVisible(false)

            if (data.action === picker.Action.PICKED) {
              const doc = data.docs?.[0]
              resolved = true
              resolve(doc ? { id: doc.id, name: doc.name } : null)
            } else if (data.action === picker.Action.CANCEL) {
              resolved = true
              resolve(null)
            }
            // For any other action (e.g., LOADED), just close the picker and do nothing
          } catch (err) {
            if (!resolved) {
              resolved = true
              reject(err)
            }
          }
        })
        .build()
      instance.setVisible(true)
    } catch (err) {
      reject(err)
    }
  })
}
