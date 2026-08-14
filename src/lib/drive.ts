import { createDriveSync, NeedsReauthError } from '@open-webapp/drive-sync'
import type { Connection } from '@open-webapp/drive-sync'
import type { AppState } from './state'
import { decryptState, encryptState } from './crypto'
import type { EncryptedEnvelope } from './crypto'

/**
 * Google Picker API types and window augmentation.
 * The Picker library is loaded dynamically; these interfaces
 * support type-checking the initialization and picker builder.
 */
interface GooglePickerDocsView {
  setParent(folderId: string): GooglePickerDocsView
}

interface GooglePickerBuilder {
  addView(view: GooglePickerDocsView): GooglePickerBuilder
  setOAuthToken(token: string): GooglePickerBuilder
  setDeveloperKey(apiKey: string): GooglePickerBuilder
  setOrigin(origin: string): GooglePickerBuilder
  setCallback(callback: (data: GooglePickerResponse) => void): GooglePickerBuilder
  build(): GooglePickerInstance
}

interface GooglePickerInstance {
  setVisible(visible: boolean): void
}

interface GooglePickerResponse {
  action: string
  docs?: Array<{
    id: string
    name: string
    mimeType: string
    type: string
  }>
}

interface GapiWindow extends Window {
  gapi?: {
    load: (lib: string, opts: { callback: () => void }) => void
    picker?: {
      PickerBuilder: new () => GooglePickerBuilder
      DocsView: new () => GooglePickerDocsView
    }
  }
}

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

// Picker API loader cache: prevent multiple concurrent loadPickerApi() calls
let pickerApiLoadPromise: Promise<void> | null = null

/**
 * Tracks if Picker library is available (gapi.picker loaded).
 * Once loaded, remains loaded for the lifetime of the app.
 */
let isPickerApiLoaded = false

/**
 * Picker API key, required alongside the OAuth token (Google Picker
 * rejects init without both). Read once from env; undefined here means
 * misconfiguration, not "optional" — Picker will fail to open and
 * openDrivePicker() throws a descriptive error (see below).
 */
const PICKER_API_KEY = import.meta.env.VITE_GOOGLE_PICKER_API_KEY as string | undefined

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
 * Get a fresh OAuth access token for Google Picker.
 * Required to initialize the Picker widget. Reuses a still-valid cached
 * token; otherwise acquires a fresh one interactively (opens a Google auth
 * window if the cached token has expired or scopes are incomplete).
 */
export async function getAccessTokenForPicker(): Promise<string> {
  return drive.project(APP_PROJECT_ID).getAccessToken({ interactive: true })
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
export async function ensureFreshConnection(): Promise<Connection> {
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
 * `restoreBackupFromFileId` (file id supplied directly via pasted URL or
 * bare id) so both paths throw the same `DriveDecryptError` on a
 * wrong-password mismatch.
 */
async function readAndDecryptFile(fileId: string, key: CryptoKey): Promise<AppState | null> {
  const project = drive.project(APP_PROJECT_ID)

  const content = await withTimeout(
    project.files.read(fileId),
    DRIVE_IO_TIMEOUT_MS,
    'files.read'
  )

  console.log('[readAndDecryptFile] fileId:', fileId, 'content type:', typeof content, 'is null:', content === null, 'is empty string:', content === '', 'content sample:', typeof content === 'string' ? content.substring(0, 100) : String(content).substring(0, 100))

  if (!content) {
    console.log('[readAndDecryptFile] content is falsy, returning null')
    return null
  }

  let contentStr: string

  // Handle case where content might be a Blob, Buffer, or other non-string type
  if (typeof content === 'string') {
    contentStr = content
    console.log('[readAndDecryptFile] content is string, length:', contentStr.length)
  } else if (content instanceof ArrayBuffer || content instanceof Uint8Array) {
    // Convert binary data to string
    const decoder = new TextDecoder()
    contentStr = decoder.decode(content)
    console.log('[readAndDecryptFile] converted ArrayBuffer/Uint8Array to string, length:', contentStr.length)
  } else if (typeof content === 'object' && 'text' in content && typeof (content as any).text === 'function') {
    // Handle Blob type (has a text() method)
    contentStr = await (content as any).text()
    console.log('[readAndDecryptFile] converted Blob to string, length:', contentStr.length)
  } else {
    // Unrecognized content type
    console.log('[readAndDecryptFile] unrecognized content type:', typeof content, Object.prototype.toString.call(content))
    return null
  }

  if (!contentStr) {
    console.log('[readAndDecryptFile] contentStr is empty after conversion')
    return null
  }

  let envelope: EncryptedEnvelope
  let salt: Uint8Array

  // Parse the envelope and extract salt before attempting decryption,
  // so that wrong-password errors can carry both salt and envelope
  try {
    envelope = JSON.parse(contentStr) as EncryptedEnvelope
    salt = base64ToBytes(envelope.salt)
    console.log('[readAndDecryptFile] successfully parsed envelope and salt')
  } catch (parseError) {
    // If we can't parse the JSON or extract the salt, treat it as an
    // unreadable file rather than a decryption error
    console.log('[readAndDecryptFile] parse error:', parseError instanceof Error ? parseError.message : String(parseError))
    if (parseError instanceof Error && (parseError.name === 'SyntaxError' || parseError.name === 'TypeError')) {
      console.log('[readAndDecryptFile] treating parse error as unreadable file')
      return null
    }
    throw parseError
  }

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
 * Restore app state from a specific Drive file id, supplied via pasted URL
 * or bare file id (parsed with `extractDriveFileId`). Bypasses the by-name
 * lookup in the app's own `OpenWebApp/Portfolio` folder, allowing restore
 * from a backup that was shared with this account by another Google account
 * rather than synced from it — `files.list` only ever sees files inside
 * this account's own folder tree.
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
 * Load the Google Picker API library from Google's CDN.
 * Caches the load promise to prevent multiple concurrent load attempts.
 * Once loaded, the library remains available for the lifetime of the app.
 * @throws Throws if the library fails to load
 */
async function loadPickerApi(): Promise<void> {
  if (isPickerApiLoaded) {
    return
  }

  if (pickerApiLoadPromise) {
    return pickerApiLoadPromise
  }

  pickerApiLoadPromise = new Promise<void>((resolve, reject) => {
    const gapiWindow = window as GapiWindow
    const timeoutHandle = setTimeout(() => {
      pickerApiLoadPromise = null
      reject(new Error('Google Picker API load timed out after 10s'))
    }, 10000)

    const handlePickerLoaded = () => {
      clearTimeout(timeoutHandle)
      if (gapiWindow.gapi?.picker?.PickerBuilder) {
        isPickerApiLoaded = true
        resolve()
      } else {
        pickerApiLoadPromise = null
        reject(new Error('Google Picker library loaded but PickerBuilder not available'))
      }
    }

    if (!gapiWindow.gapi) {
      const script = document.createElement('script')
      script.src = 'https://apis.google.com/js/platform.js'
      script.onload = () => {
        if (gapiWindow.gapi?.load) {
          try {
            gapiWindow.gapi.load('picker', {
              callback: handlePickerLoaded,
            })
          } catch (err) {
            clearTimeout(timeoutHandle)
            pickerApiLoadPromise = null
            reject(err instanceof Error ? err : new Error(String(err)))
          }
        } else {
          clearTimeout(timeoutHandle)
          reject(new Error('gapi.load not available after script loaded'))
        }
      }
      script.onerror = () => {
        clearTimeout(timeoutHandle)
        pickerApiLoadPromise = null
        reject(new Error('Failed to load Google Picker API from https://apis.google.com/js/platform.js'))
      }
      document.head.appendChild(script)
    } else if (gapiWindow.gapi.load) {
      try {
        gapiWindow.gapi.load('picker', {
          callback: handlePickerLoaded,
        })
      } catch (err) {
        clearTimeout(timeoutHandle)
        pickerApiLoadPromise = null
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    } else {
      clearTimeout(timeoutHandle)
      reject(new Error('gapi.load not available'))
    }
  })

  return pickerApiLoadPromise
}

/**
 * Open a Google Picker dialog to select a file from the user's Drive.
 * Always starts in the `OpenWebApp/Portfolio` folder (same folder
 * syncBackup/restoreBackup use), resolved via ensureFolderPath(), but
 * the user can navigate to any other folder they have access to using
 * Picker's built-in navigation — nothing is restricted beyond the
 * starting view.
 *
 * Requires a valid, fresh OAuth token AND a Picker API key
 * (VITE_GOOGLE_PICKER_API_KEY) — Picker needs both to initialize.
 * Call `ensureFreshConnection()` before calling this to guarantee a
 * usable token.
 *
 * @param token The OAuth access token to authenticate Picker with
 * @param onSelect Callback when user selects a file: passed the Drive file id
 * @param onCancel Callback when user closes Picker without selecting
 * @throws Throws if Picker library fails to load, or if
 *   VITE_GOOGLE_PICKER_API_KEY is not configured
 */
export async function openDrivePicker(
  token: string,
  onSelect: (fileId: string) => void,
  onCancel: () => void
): Promise<void> {
  if (!PICKER_API_KEY) {
    throw new Error('VITE_GOOGLE_PICKER_API_KEY is not set — Google Picker requires an API key')
  }

  await loadPickerApi()

  const gapiWindow = window as GapiWindow
  if (!gapiWindow.gapi?.picker?.PickerBuilder) {
    throw new Error('Google Picker API not available')
  }

  // Default Picker's starting folder to the app's own OpenWebApp/Portfolio
  // Drive folder — same folder syncBackup/restoreBackup read/write.
  const project = drive.project(APP_PROJECT_ID)
  const folderId = await withTimeout(
    project.ensureFolderPath(),
    DRIVE_IO_TIMEOUT_MS,
    'ensureFolderPath'
  )

  const docsView = new gapiWindow.gapi.picker.DocsView().setParent(folderId)

  // Callback from Picker: check action and extract file id
  const handlePickerResponse = (data: GooglePickerResponse) => {
    if (data.action === 'picked' && data.docs && data.docs.length > 0) {
      const fileId = data.docs[0].id
      onSelect(fileId)
    } else if (data.action === 'cancel') {
      onCancel()
    }
  }

  // Configure Picker: OAuth token + API key are both required
  const picker = new gapiWindow.gapi.picker.PickerBuilder()
    .setOAuthToken(token)
    .setDeveloperKey(PICKER_API_KEY)
    .setOrigin(window.location.origin)
    .addView(docsView)
    .setCallback(handlePickerResponse)
    .build()

  // Show the Picker dialog
  picker.setVisible(true)
}

/**
 * Extracts a Google Drive file id from a pasted Drive URL or bare file id.
 * Supports `.../file/d/FILE_ID/...` and `...?id=FILE_ID` (or `&id=FILE_ID`)
 * URL shapes; falls back to accepting the whole trimmed input as a bare id
 * if it looks plausible (alnum + `-`/`_`, 10+ chars, no spaces/slashes).
 * Returns null if nothing usable is found.
 */
export function extractDriveFileId(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  const fileDMatch = trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]+)/)
  if (fileDMatch) return fileDMatch[1]

  const idParamMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/)
  if (idParamMatch) return idParamMatch[1]

  if (/^[a-zA-Z0-9_-]{10,}$/.test(trimmed)) return trimmed

  return null
}
