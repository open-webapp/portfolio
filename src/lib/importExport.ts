// Export-side functionality for backing up app state to an encrypted file.
// See plans/settings-import-export.md.

import type { AppState } from './state'
import type {
  Account,
  Position,
  ClosedPosition,
  Transaction,
  PortfolioSnapshot,
  SavedCsvMapping,
  BalanceEntry,
  BudgetAccountRule,
  Category,
  CategoryMapping,
  PriceSyncLastRun,
  ExpenseDefinition,
  BudgetTransaction,
} from './types'
import { encryptState, decryptState, deriveKey, detectEnvelopeShape, type EncryptedEnvelope } from './crypto'
import type { GlobalCategoryState } from './categoryStore'

/**
 * The subset of AppState that gets exported to a backup file: data
 * collections plus the non-cache fields of priceSync/mutualFundSync.
 * Excludes cached prices (heldPrices, lastFetchedDate, callBudget) and all
 * UI-state fields (view, sort, filters, pendingImport, etc).
 */
export interface ExportableState {
  accounts: Account[]
  positions: Position[]
  closedPositions: ClosedPosition[]
  transactions: Transaction[]
  snapshots: PortfolioSnapshot[]
  csvMappings: SavedCsvMapping[]
  customInstitutions: string[]
  balanceEntries: BalanceEntry[]
  budgetExpenseDefinitions: ExpenseDefinition[]
  budgetExpenseAmountsByYear: Record<string, Record<string, number>>
  budgetTransactions: BudgetTransaction[]
  priceSync: {
    apiKey: string
    lastRun: PriceSyncLastRun | null
  }
  mutualFundSync: {
    apiKey: string
    lastRun: PriceSyncLastRun | null
  }
}

/**
 * Pure pick of the exportable fields from AppState. Never includes cached
 * price data or UI state.
 */
export function buildExportableState(state: AppState): ExportableState {
  return {
    accounts: state.accounts,
    positions: state.positions,
    closedPositions: state.closedPositions,
    transactions: state.transactions,
    snapshots: state.snapshots,
    csvMappings: state.csvMappings,
    customInstitutions: state.customInstitutions,
    balanceEntries: state.balanceEntries,
    budgetExpenseDefinitions: state.budgetExpenseDefinitions,
    budgetExpenseAmountsByYear: state.budgetExpenseAmountsByYear,
    budgetTransactions: state.budgetTransactions,
    priceSync: {
      apiKey: state.priceSync.apiKey,
      lastRun: state.priceSync.lastRun,
    },
    mutualFundSync: {
      apiKey: state.mutualFundSync.apiKey,
      lastRun: state.mutualFundSync.lastRun,
    },
  }
}

/**
 * Unencrypted portfolio export shape: everything in ExportableState plus
 * the per-user category mappings, with API keys blanked (lastRun kept).
 */
export type UnencryptedPortfolioExport = ExportableState & {
  categoryMappings: CategoryMapping[]
}

/**
 * Pure builder for the unencrypted portfolio download. Spreads
 * buildExportableState, adds categoryMappings, and blanks both sync API
 * keys while keeping lastRun. Never mutates the input state.
 */
export function buildUnencryptedPortfolioExport(state: AppState): UnencryptedPortfolioExport {
  const base = buildExportableState(state)
  return {
    ...base,
    categoryMappings: state.categoryMappings,
    priceSync: {
      apiKey: '',
      lastRun: state.priceSync.lastRun,
    },
    mutualFundSync: {
      apiKey: '',
      lastRun: state.mutualFundSync.lastRun,
    },
  }
}

/**
 * Pure builder for the unencrypted categories download.
 */
export function buildUnencryptedCategoriesExport(
  categories: Category[],
  budgetAccountRules: BudgetAccountRule[]
): GlobalCategoryState {
  return { categories, budgetAccountRules }
}

/**
 * Local-calendar YYYY-MM-DD stamp (mirrors the Settings download naming).
 */
export function localDateStamp(d: Date = new Date()): string {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

/**
 * Builds the exportable subset of state and encrypts it into an envelope
 * suitable for writing to a backup file.
 */
export async function exportBackup(state: AppState, key: CryptoKey, salt: Uint8Array): Promise<EncryptedEnvelope> {
  const exportable = buildExportableState(state)
  // encryptState is typed for AppState; ExportableState is the intentional
  // plaintext shape stored in the envelope for exports.
  return encryptState(exportable as unknown as AppState, key, salt)
}

/**
 * Shared Blob-creation/anchor-click download dance used by browser exports.
 */
function downloadAsFile(contents: string, filename: string, type: string): void {
  const blob = new Blob([contents], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function downloadAsJsonFile(data: unknown, filename: string): void {
  downloadAsFile(JSON.stringify(data), filename, 'application/json')
}

/**
 * Triggers a browser download of the given envelope as a JSON file.
 */
export function downloadEnvelopeAsFile(envelope: EncryptedEnvelope, filename: string): void {
  downloadAsJsonFile(envelope, filename)
}

/**
 * Triggers a browser download of arbitrary unencrypted JSON data as a file
 * (e.g. category/mapping exports, which aren't secrets worth encrypting).
 */
export function downloadJsonAsFile(data: unknown, filename: string): void {
  downloadAsJsonFile(data, filename)
}

/**
 * Triggers a browser download of arbitrary data as pretty-printed JSON
 * (2-space indent) — for human-readable unencrypted exports.
 */
export function downloadPrettyJsonAsFile(data: unknown, filename: string): void {
  downloadAsFile(JSON.stringify(data, null, 2), filename, 'application/json')
}

/**
 * Triggers a browser download of CSV text as a file.
 */
export function downloadCsvAsFile(csvText: string, filename: string): void {
  downloadAsFile(csvText, filename, 'text/csv;charset=utf-8')
}

// Import-side functionality for restoring app state from a backup file.

/**
 * Thrown when an envelope fails to decrypt — almost always a wrong password
 * (AES-GCM auth-tag mismatch).
 */
export class ImportDecryptError extends Error {}

/**
 * Thrown when the imported file isn't valid JSON, or is valid JSON that
 * isn't shaped like an encrypted envelope (e.g. a raw AppState blob or garbage).
 */
export class ImportMalformedFileError extends Error {}

/**
 * Parses raw file text into an EncryptedEnvelope. Throws
 * ImportMalformedFileError if the text isn't valid JSON, or if it doesn't
 * have the encrypted-envelope shape.
 */
export function parseImportFile(fileText: string): EncryptedEnvelope {
  let parsed: unknown
  try {
    parsed = JSON.parse(fileText)
  } catch {
    throw new ImportMalformedFileError('Import file is not valid JSON.')
  }

  if (detectEnvelopeShape(parsed) !== 'encrypted') {
    throw new ImportMalformedFileError('Import file is not a recognized backup envelope.')
  }

  return parsed as EncryptedEnvelope
}

// Duplicated from crypto.ts's private base64ToBytes rather than imported —
// crypto.ts doesn't export it, mirroring the same duplication in drive.ts.
function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/**
 * Decodes an envelope's base64 salt into raw bytes.
 */
export function getEnvelopeSaltBytes(envelope: EncryptedEnvelope): Uint8Array {
  return base64ToBytes(envelope.salt)
}

/**
 * Derives the key from the given password and the envelope's own embedded
 * salt, then decrypts the envelope back into an ExportableState. Coalesces
 * every field against its default so an older/partial export file can't
 * inject `undefined` into the resulting state.
 *
 * Throws ImportDecryptError on a wrong password (auth-tag mismatch);
 * rethrows any other decryption error unchanged.
 */
export async function decryptImportEnvelope(envelope: EncryptedEnvelope, password: string): Promise<ExportableState> {
  const saltBytes = getEnvelopeSaltBytes(envelope)
  const key = await deriveKey(password, saltBytes)

  let decrypted: Partial<ExportableState>
  try {
    // decryptState is typed for AppState; the actual runtime shape here is
    // the (possibly partial) ExportableState written by an export.
    decrypted = (await decryptState(envelope, key)) as unknown as Partial<ExportableState>
  } catch (error) {
    if (error instanceof Error && error.name === 'OperationError') {
      throw new ImportDecryptError('Failed to decrypt import file. Check the password and try again.')
    }
    throw error
  }

  return {
    accounts: decrypted.accounts ?? [],
    positions: decrypted.positions ?? [],
    closedPositions: decrypted.closedPositions ?? [],
    transactions: decrypted.transactions ?? [],
    snapshots: decrypted.snapshots ?? [],
    csvMappings: decrypted.csvMappings ?? [],
    customInstitutions: decrypted.customInstitutions ?? [],
    balanceEntries: decrypted.balanceEntries ?? [],
    budgetExpenseDefinitions: decrypted.budgetExpenseDefinitions ?? [],
    budgetExpenseAmountsByYear: decrypted.budgetExpenseAmountsByYear ?? {},
    budgetTransactions: decrypted.budgetTransactions ?? [],
    priceSync: {
      apiKey: decrypted.priceSync?.apiKey ?? '',
      lastRun: decrypted.priceSync?.lastRun ?? null,
    },
    mutualFundSync: {
      apiKey: decrypted.mutualFundSync?.apiKey ?? '',
      lastRun: decrypted.mutualFundSync?.lastRun ?? null,
    },
  }
}

// Import-side functionality for the global category/mapping export (a
// separate, unencrypted JSON file distinct from the encrypted backup above).

/**
 * Thrown when a category-mapping import file isn't valid JSON, or is valid
 * JSON that doesn't have the expected global-category-state shape.
 */
export class CategoryMappingImportError extends Error {}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isValidCategoryShape(value: unknown): boolean {
  return (
    isPlainObject(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string'
  )
}

/**
/**
 * Parses raw file text into a GlobalCategoryState. Throws
 * CategoryMappingImportError if the text isn't valid JSON, or if it doesn't
 * have a categories array.
 */
export function parseCategoryMappingImportFile(text: string): GlobalCategoryState {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new CategoryMappingImportError('Import file is not valid JSON.')
  }

  if (!isPlainObject(parsed) || !Array.isArray(parsed.categories)) {
    throw new CategoryMappingImportError('Import file is not a recognized category-mapping export.')
  }

  if (!parsed.categories.every(isValidCategoryShape)) {
    throw new CategoryMappingImportError('Import file contains a malformed category entry.')
  }
  return {
    categories: parsed.categories as unknown as GlobalCategoryState['categories'],
    budgetAccountRules: Array.isArray(parsed.budgetAccountRules)
      ? parsed.budgetAccountRules as GlobalCategoryState['budgetAccountRules']
      : [],
  }
}
