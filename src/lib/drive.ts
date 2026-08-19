import { createDriveSync, NeedsReauthError } from '@open-webapp/drive-sync'
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
        try {
          // Call the real pickFile with required options
          const apiKey = import.meta.env.VITE_GOOGLE_PICKER_API_KEY as string | undefined
          const projectNumber = (() => {
            const explicit = import.meta.env.VITE_GOOGLE_PROJECT_NUMBER as string | undefined
            if (explicit) return explicit
            const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined
            const match = /^(\d+)-/.exec(clientId ?? '')
            return match ? match[1] : undefined
          })()
          const result = await project.pickFile({
            apiKey: apiKey || '',
            appId: projectNumber || '',
            ...options,
          })
          // Return the first file or null, with 'id' property mapped from 'fileId'
          if (Array.isArray(result) && result.length > 0) {
            return {
              id: result[0].fileId,
              name: result[0].name,
              mimeType: result[0].mimeType,
            }
          }
          return null
        } catch (err) {
          // If pickFile fails, try the old openDrivePicker approach
          return new Promise((resolve, reject) => {
            getAccessTokenForPicker()
              .then((token) => {
                openDrivePicker(
                  token,
                  (fileId) => resolve({ id: fileId }),
                  () => resolve(null)
                )
              })
              .catch(reject)
          })
        }
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
 * Reads a Drive file by id and decrypts it into an AppState. Shared by
 * `restoreBackup` (looks the file up by name in the app's own folder) and
 * `restoreBackupFromFileId` (file id supplied directly via pasted URL or
 * bare id) so both paths throw the same `DriveDecryptError` on a
 * wrong-password mismatch.
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
 * Restore app state from a specific Drive file id, supplied via pasted URL
 * or bare file id. Bypasses the by-name lookup in the app's own `OpenWebApp/Portfolio` folder, allowing restore
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
 * Get a fresh OAuth access token for Google Picker.
 * Required to initialize the Picker widget. Reuses a still-valid cached
 * token; otherwise acquires a fresh one interactively (opens a Google auth
 * window if the cached token has expired or scopes are incomplete).
 */
export async function getAccessTokenForPicker(): Promise<string> {
  return driveSync.project(APP_PROJECT_ID).getAccessToken({ interactive: true })
}

/**
 * Picker appends its dialog and a full-viewport modal backdrop straight to
 * document.body, outside React's tree, so nothing the app re-renders can
 * clear them. setVisible(false) only hides the dialog, and dispose() is both
 * absent on older builds and unreliable about the backdrop — which is
 * transparent, fixed, and sits above everything. Leave it behind and the app
 * looks fine but swallows every click.
 *
 * Sweeping by class name is deliberate: these are Picker's own chrome
 * elements, and matching them is the only handle we have on nodes we did not
 * create and hold no reference to.
 */
function removePickerChrome(): void {
  const selector = '.picker-dialog-bg, .picker-dialog, .picker-dialog-frame'
  document.querySelectorAll(selector).forEach((node) => node.remove())
}

/**
 * Google Picker API types and window augmentation.
 * The Picker library is loaded dynamically; these interfaces
 * support type-checking the initialization and picker builder.
 */
interface GooglePickerDocsView {
  setParent(folderId: string): GooglePickerDocsView
  setIncludeFolders(include: boolean): GooglePickerDocsView
}

interface GooglePickerBuilder {
  addView(view: GooglePickerDocsView): GooglePickerBuilder
  setOAuthToken(token: string): GooglePickerBuilder
  setDeveloperKey(apiKey: string): GooglePickerBuilder
  setAppId(appId: string): GooglePickerBuilder
  setOrigin(origin: string): GooglePickerBuilder
  setCallback(callback: (data: GooglePickerResponse) => void): GooglePickerBuilder
  build(): GooglePickerInstance
}

interface GooglePickerInstance {
  setVisible(visible: boolean): void
  /** Removes the Picker's DOM, backdrop included. Absent on older builds. */
  dispose?(): void
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
    load: (lib: string, opts: { callback: (result?: any) => void }) => void
    picker?: {
      PickerBuilder?: new () => GooglePickerBuilder
      DocsView?: new () => GooglePickerDocsView
      api?: {
        PickerBuilder: new () => GooglePickerBuilder
        DocsView: new () => GooglePickerDocsView
      }
    }
  }
}

/** Picker API loader cache: prevent multiple concurrent loadPickerApi() calls */
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
 * Cloud project *number* of the OAuth client that mints Picker's token.
 *
 * Required, not cosmetic: this app requests only the `drive.file` scope, and
 * Picker refuses to run a scoped session it cannot attribute to an app. Omit
 * it and Picker silently discards the OAuth token passed to setOAuthToken(),
 * falls back to its own sign-in prompt, and then fails the now-unauthenticated
 * developer-key check with "The API developer key is invalid" — even when the
 * key and its referrer restrictions are perfectly valid.
 *
 * Derived from the numeric prefix of the OAuth client id
 * (`<projectNumber>-<hash>.apps.googleusercontent.com`), so it needs no
 * separate env var; VITE_GOOGLE_PROJECT_NUMBER overrides it if the client
 * ever comes from a different project than the API key.
 */
function resolveProjectNumber(): string | undefined {
  const explicit = import.meta.env.VITE_GOOGLE_PROJECT_NUMBER as string | undefined
  if (explicit) {
    return explicit
  }
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined
  const match = /^(\d+)-/.exec(clientId ?? '')
  return match ? match[1] : undefined
}

const PICKER_APP_ID = resolveProjectNumber()

/** Google's API loader. Exported for tests to pin — see loadPickerApi(). */
export const PICKER_LOADER_SRC = 'https://apis.google.com/js/api.js'

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

    const handlePickerLoaded = (result?: any) => {
      clearTimeout(timeoutHandle)
      if (result?.error) {
        pickerApiLoadPromise = null
        reject(new Error(`Google Picker API load failed: ${result.error}`))
        return
      }

      // Check if PickerBuilder is available (it might be at gapi.picker.api.PickerBuilder or gapi.picker.PickerBuilder)
      const PickerBuilder = gapiWindow.gapi?.picker?.PickerBuilder || (gapiWindow.gapi?.picker?.api as any)?.PickerBuilder
      const DocsView = gapiWindow.gapi?.picker?.DocsView || (gapiWindow.gapi?.picker?.api as any)?.DocsView

      if (PickerBuilder && DocsView) {
        isPickerApiLoaded = true
        resolve()
      } else {
        pickerApiLoadPromise = null
        reject(new Error('Google Picker library loaded but PickerBuilder not available'))
      }
    }

    if (!gapiWindow.gapi) {
      const script = document.createElement('script')
      // api.js, NOT platform.js. platform.js is the legacy Sign-In platform
      // library; it happens to expose gapi.load so gapi.load('picker') appears
      // to work, but it installs its own gapi.iframes context and Picker ends
      // up opened with a `parent` that is not this page. Picker validates the
      // developer key against that parent and rejects the frame with a 401.
      script.src = PICKER_LOADER_SRC
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
        reject(new Error(`Failed to load Google Picker API from ${PICKER_LOADER_SRC}`))
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
  if (!PICKER_APP_ID) {
    throw new Error(
      'Google Picker app id is not resolvable — set VITE_GOOGLE_PROJECT_NUMBER, ' +
        'or ensure VITE_GOOGLE_CLIENT_ID is a standard `<projectNumber>-<hash>.apps.googleusercontent.com` id. ' +
        'Picker rejects drive.file sessions without it.'
    )
  }

  await loadPickerApi()

  const gapiWindow = window as GapiWindow
  // PickerBuilder might be at gapi.picker.PickerBuilder or gapi.picker.api.PickerBuilder
  const PickerBuilder = gapiWindow.gapi?.picker?.PickerBuilder || (gapiWindow.gapi?.picker?.api as any)?.PickerBuilder
  const DocsView = gapiWindow.gapi?.picker?.DocsView || (gapiWindow.gapi?.picker?.api as any)?.DocsView

  if (!PickerBuilder || !DocsView) {
    throw new Error('Google Picker API not available')
  }

  // Open at My Drive root and let the user navigate anywhere, rather than
  // pinning the view to the app's own OpenWebApp/Portfolio folder: backups
  // worth restoring may have been moved, shared in, or written by another
  // install. Picker is the sanctioned way to widen `drive.file` — whatever
  // the user picks here is granted to the app on selection, so browsing all
  // of Drive needs no extra scope.
  const docsView = new DocsView().setIncludeFolders(true)

  // Picker does not tear itself down when the callback fires — the dialog and
  // its modal backdrop stay in the DOM and keep blocking the app until they
  // are explicitly removed. Assigned once the builder has run; the callback
  // cannot fire before setVisible(true) below.
  let pickerInstance: GooglePickerInstance | null = null

  const closePicker = () => {
    if (!pickerInstance) {
      return
    }
    const instance = pickerInstance
    // Null first, so a duplicate callback can't double-dispose.
    pickerInstance = null
    instance.setVisible(false)
    instance.dispose?.()
    removePickerChrome()
  }

  // Callback from Picker: check action and extract file id. Always close
  // before handing control back — onSelect opens a confirm() dialog, which
  // would otherwise surface behind the still-open Picker.
  const handlePickerResponse = (data: GooglePickerResponse) => {
    if (data.action === 'picked' && data.docs && data.docs.length > 0) {
      const fileId = data.docs[0].id
      closePicker()
      onSelect(fileId)
    } else if (data.action === 'cancel') {
      closePicker()
      onCancel()
    }
  }

  // Configure Picker: OAuth token + API key + app id are all required. The
  // app id is what makes Picker honor the drive.file-scoped token instead of
  // discarding it and demanding its own sign-in.
  const picker = new PickerBuilder()
    .setOAuthToken(token)
    .setDeveloperKey(PICKER_API_KEY)
    .setAppId(PICKER_APP_ID)
    .setOrigin(window.location.origin)
    .addView(docsView)
    .setCallback(handlePickerResponse)
    .build()

  pickerInstance = picker

  // Show the Picker dialog
  picker.setVisible(true)
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
