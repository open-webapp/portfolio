import type { getDriveAuthFor } from './drive'
import { legacyDriveSync } from './drive'
import type { GlobalCategoryState } from './categoryStore'

const FILENAME = 'category-mappings.json'

/**
 * Drive I/O for the global (cross-portfolio) `category-mappings.json` file.
 * Lives at the shared `OpenWebApp/Portfolio` root (via `legacyDriveSync`)
 * rather than any per-portfolio subfolder — categories/mappings are shared
 * across every portfolio, not portfolio-scoped.
 *
 * Every function here takes a `projectId` alongside `driveAuth`: it MUST be
 * the same project id `driveAuth` (from `getDriveAuthFor`) was authenticated
 * under (i.e. `driveAuthProjectIdFor(activePortfolio)`) — drive-sync stores
 * and looks up tokens keyed by `(appId, projectId)`, so scoping the file I/O
 * to any other id would find no valid token and fail. This does NOT scope
 * the *file* to that portfolio, only reuses its already-established Drive
 * connection; the file itself is still the one shared `category-mappings.json`.
 */

/**
 * Shape-checks a parsed JSON value as a `GlobalCategoryState`. Deliberately
 * loose (array presence only, not per-item field validation) — mirrors this
 * codebase's existing "swallow malformed, don't hard-fail" convention (see
 * `decryptDriveFolderBackup` in drive.ts).
 */
function isGlobalCategoryStateShape(value: unknown): value is GlobalCategoryState {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return Array.isArray(v.categories) && Array.isArray(v.categoryMappings)
}

function normalizeGlobalCategoryState(value: GlobalCategoryState): GlobalCategoryState {
  const rules = (value as unknown as Record<string, unknown>).budgetAccountRules
  return {
    ...value,
    budgetAccountRules: Array.isArray(rules)
      ? rules.filter((rule) => !!rule && typeof rule === 'object' && !Array.isArray(rule)) as GlobalCategoryState['budgetAccountRules']
      : [],
  }
}

/**
 * Reads and parses the global category-mappings file from Drive.
 *
 * `driveAuth.ensureFresh()` is deliberately left uncaught: an auth/connection
 * failure must propagate raw so callers can distinguish "couldn't connect"
 * from "no file yet" or "malformed content". Everything after that — no file
 * found, unreadable content, unparseable JSON, or a value that doesn't look
 * like `GlobalCategoryState` — is swallowed to `null` rather than thrown.
 */
export async function pullGlobalCategoriesFromDrive(
  driveAuth: ReturnType<typeof getDriveAuthFor>,
  projectId: string,
  fileId?: string
): Promise<GlobalCategoryState | null> {
  await driveAuth.ensureFresh()

  const project = legacyDriveSync.project(projectId)
  let resolvedFileId = fileId
  if (!resolvedFileId) {
    const folderId = await project.ensureFolderPath()
    const files = await project.files.list({ folderId, nameEquals: FILENAME })
    if (files.length === 0) return null
    resolvedFileId = files[0].id
  }

  let content: unknown
  try {
    content = await project.files.read(resolvedFileId)
  } catch {
    return null
  }

  if (!content) return null

  let contentStr: string
  if (typeof content === 'string') {
    contentStr = content
  } else if (content instanceof ArrayBuffer || content instanceof Uint8Array) {
    contentStr = new TextDecoder().decode(content)
  } else if (typeof content === 'object' && 'text' in content && typeof (content as any).text === 'function') {
    contentStr = await (content as any).text()
  } else {
    return null
  }

  if (!contentStr) return null

  try {
    const parsed = JSON.parse(contentStr)
    if (!isGlobalCategoryStateShape(parsed)) return null
    return normalizeGlobalCategoryState(parsed)
  } catch {
    return null
  }
}

/**
 * Writes the global category-mappings file to Drive, updating the existing
 * file if one already exists (found by name in the shared root folder) or
 * creating it otherwise.
 *
 * `driveAuth.ensureFresh()` is deliberately left uncaught — an auth/connection
 * failure must propagate raw, not be swallowed like content-shape errors are
 * in `pullGlobalCategoriesFromDrive`.
 */
export async function pushGlobalCategoriesToDrive(
  driveAuth: ReturnType<typeof getDriveAuthFor>,
  projectId: string,
  state: GlobalCategoryState,
  fileId?: string
): Promise<void> {
  await driveAuth.ensureFresh()

  const project = legacyDriveSync.project(projectId)
  const content = JSON.stringify(state)
  if (fileId) {
    await project.files.write({
      fileId,
      content,
      mimeType: 'application/json',
    })
    return
  }

  const folderId = await project.ensureFolderPath()
  const files = await project.files.list({ folderId, nameEquals: FILENAME })
  const existingFileId = files.length > 0 ? files[0].id : undefined

  await project.files.write({
    fileId: existingFileId,
    folderId,
    name: FILENAME,
    content,
    mimeType: 'application/json',
  })
}

/**
 * Returns the remote `modifiedTime` of the global category-mappings file, or
 * `null` if it doesn't exist yet. Mirrors `getBackupFileStatus` in drive.ts:
 * `files.status(fileId)` is drive-sync's metadata-only call, exposing
 * `remoteModifiedTime` on its resolved `FileState`.
 *
 * `driveAuth.ensureFresh()` is deliberately left uncaught, same convention as
 * the two functions above.
 */
export async function getGlobalCategoriesModifiedTime(
  driveAuth: ReturnType<typeof getDriveAuthFor>,
  projectId: string,
  fileId?: string
): Promise<string | null> {
  await driveAuth.ensureFresh()

  const project = legacyDriveSync.project(projectId)
  if (fileId) {
    try {
      const status = await project.files.status(fileId)
      return status.remoteModifiedTime ?? null
    } catch {
      return null
    }
  }

  const folderId = await project.ensureFolderPath()
  const files = await project.files.list({ folderId, nameEquals: FILENAME })
  if (files.length === 0) return null

  const status = await project.files.status(files[0].id)
  return status.remoteModifiedTime ?? null
}
