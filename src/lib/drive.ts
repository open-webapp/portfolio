import { createDriveSync, NeedsReauthError } from '@open-webapp/drive-sync'
import type { Connection } from '@open-webapp/drive-sync'
import type { AppState } from './state'

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
 * @throws Throws if Drive connection fails or write fails
 */
export async function syncBackup(state: AppState): Promise<string> {
  try {
    await ensureFreshConnection()
    const project = drive.project(APP_PROJECT_ID)

    // Ensure app folder structure (OpenWebApp/Portfolio) exists
    const folderId = await project.ensureFolderPath()

    // Serialize state as JSON
    const jsonContent = JSON.stringify(state, null, 2)

    // Write the file (will update if exists, create if not)
    const file = await project.files.write({
      folderId,
      name: APP_STATE_FILENAME,
      content: jsonContent,
      mimeType: 'application/json',
    })

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

    const folderId = await project.ensureFolderPath()

    const files = await project.files.list({
      folderId,
      nameEquals: APP_STATE_FILENAME,
    })

    return files.length > 0 ? files[0].id : null
  } catch (error) {
    if (error instanceof NeedsReauthError) {
      // No usable token (expired/never acquired): do not prompt from a
      // passive lookup — report "no backup link" and let sync/restore
      // handle reauth when the user actually triggers them.
      console.warn('Drive token expired; skipping backup link lookup:', error)
      return null
    }
    console.error('Failed to look up backup file on Drive:', error)
    throw error
  }
}

/**
 * Restore app state from Google Drive JSON backup.
 * Returns null if no backup file exists.
 *
 * Opens a Google auth window only when the cached token has expired or is
 * missing; a still-valid stored token is reused without prompting.
 *
 * @returns The restored app state, or null if no backup found
 * @throws Throws if Drive connection fails or read fails
 */
export async function restoreBackup(): Promise<AppState | null> {
  try {
    await ensureFreshConnection()
    const project = drive.project(APP_PROJECT_ID)

    // Ensure app folder structure exists (creates if missing, returns folderId)
    const folderId = await project.ensureFolderPath()

    // Find the backup file
    const files = await project.files.list(
      {
        folderId,
        nameEquals: APP_STATE_FILENAME,
      }
    )

    if (files.length === 0) {
      return null
    }

    // Read the backup file content
    const content = await project.files.read(files[0].id)

    if (!content || typeof content !== 'string') {
      return null
    }

    // Parse and return the state
    const state = JSON.parse(content) as AppState
    return state
  } catch (error) {
    console.error('Failed to restore backup from Drive:', error)
    throw error
  }
}
