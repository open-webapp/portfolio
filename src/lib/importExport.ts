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
  PriceSyncLastRun,
  Expense,
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
  budgetIncomeMonthly: number
  budgetIncomeYearly: number
  budgetExpenses: Expense[]
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
    budgetIncomeMonthly: state.budgetIncomeMonthly,
    budgetIncomeYearly: state.budgetIncomeYearly,
    budgetExpenses: state.budgetExpenses,
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
 * Shared Blob-creation/anchor-click download dance used by both
 * downloadEnvelopeAsFile and downloadJsonAsFile.
 */
function downloadAsJsonFile(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
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
    budgetIncomeMonthly: decrypted.budgetIncomeMonthly ?? 0,
    budgetIncomeYearly: decrypted.budgetIncomeYearly ?? 0,
    budgetExpenses: decrypted.budgetExpenses ?? [],
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
 * JSON that doesn't have the expected { categories, categoryMappings } shape.
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

function isValidCategoryMappingShape(value: unknown): boolean {
  return (
    isPlainObject(value) &&
    typeof value.id === 'string' &&
    typeof value.substring === 'string' &&
    typeof value.categoryId === 'string'
  )
}

/**
 * Parses raw file text into a GlobalCategoryState. Throws
 * CategoryMappingImportError if the text isn't valid JSON, or if it doesn't
 * have the { categories: Category[], categoryMappings: CategoryMapping[] }
 * shape (including malformed items within either array).
 */
export function parseCategoryMappingImportFile(text: string): GlobalCategoryState {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new CategoryMappingImportError('Import file is not valid JSON.')
  }

  if (!isPlainObject(parsed) || !Array.isArray(parsed.categories) || !Array.isArray(parsed.categoryMappings)) {
    throw new CategoryMappingImportError('Import file is not a recognized category-mapping export.')
  }

  if (!parsed.categories.every(isValidCategoryShape)) {
    throw new CategoryMappingImportError('Import file contains a malformed category entry.')
  }
  if (!parsed.categoryMappings.every(isValidCategoryMappingShape)) {
    throw new CategoryMappingImportError('Import file contains a malformed category mapping entry.')
  }

  return parsed as unknown as GlobalCategoryState
}
