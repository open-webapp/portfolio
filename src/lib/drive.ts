import { createDriveSync } from '@open-webapp/drive-sync'
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
 * Read the current Drive connection (no network calls, no reauth prompt).
 * Returns null if never connected.
 */
export async function getDriveConnection(): Promise<Connection | null> {
  return drive.project(APP_PROJECT_ID).getConnection()
}

/**
 * Start the interactive Google OAuth connect flow for the Portfolio project.
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
 * @param state The current app state to backup
 * @throws Throws if Drive connection fails or write fails
 */
export async function syncBackup(state: AppState): Promise<void> {
  try {
    const project = drive.project(APP_PROJECT_ID)

    // Ensure app folder structure (OpenWebApp/Portfolio) exists
    const folderId = await project.ensureFolderPath()

    // Serialize state as JSON
    const jsonContent = JSON.stringify(state, null, 2)

    // Write the file (will update if exists, create if not)
    await project.files.write({
      folderId,
      name: APP_STATE_FILENAME,
      content: jsonContent,
      mimeType: 'application/json',
    })
  } catch (error) {
    console.error('Failed to sync backup to Drive:', error)
    throw error
  }
}

/**
 * Restore app state from Google Drive JSON backup.
 * Returns null if no backup file exists.
 *
 * @returns The restored app state, or null if no backup found
 * @throws Throws if Drive connection fails or read fails
 */
export async function restoreBackup(): Promise<AppState | null> {
  try {
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
