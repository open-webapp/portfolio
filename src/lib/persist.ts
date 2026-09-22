import type { AppState } from './state'
import { initialState, currentBudgetYear } from './state'
import { decryptState, detectEnvelopeShape, encryptState } from './crypto'
import type { EncryptedEnvelope } from './crypto'

const STORE_NAME = 'app_state'
const STATE_KEY = 'current'

const dbHandles: Map<string, Promise<IDBDatabase>> = new Map()
let activePortfolioDbName: string | null = null

/**
 * Sets which portfolio's IndexedDB database subsequent loadPersistedApp /
 * savePersistedApp calls operate on. Must be called
 * before any of those are used.
 */
export function setActivePortfolioDb(dbName: string): void {
  activePortfolioDbName = dbName
  dbHandles.delete(dbName) // force a fresh open in case a prior open raced a delete
}

function openDb(dbName: string): Promise<IDBDatabase> {
  if (!dbHandles.has(dbName)) {
    dbHandles.set(
      dbName,
      new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, 1)
        request.onerror = () => reject(request.error)
        request.onsuccess = () => resolve(request.result)
        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME)
          }
        }
      }),
    )
  }
  return dbHandles.get(dbName)!
}

function requireActiveDbName(): string {
  if (!activePortfolioDbName) throw new Error('No active portfolio set — call setActivePortfolioDb() first')
  return activePortfolioDbName
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/**
 * Migration tolerance: raw pre-coalesce blob with a flat `budgetExpenses`
 * array (pre-multi-year budgets) gets folded into `budgetExpensesByYear`
 * under the current budget year. No-ops if `budgetExpensesByYear` is already
 * present (even `{}`), including for blobs with neither field.
 */
export function migrateBudgetExpensesByYearIfNeeded(raw: Record<string, unknown>): Record<string, unknown> {
  if ('budgetExpensesByYear' in raw) return raw
  if (Array.isArray(raw.budgetExpenses)) {
    return {
      ...raw,
      budgetExpensesByYear: { [currentBudgetYear()]: raw.budgetExpenses },
      budgetExpenses: undefined,
    }
  }
  return { ...raw, budgetExpensesByYear: {} }
}

/**
 * Removes retired manual-income fields before hydration. They are intentionally
 * discarded rather than converted into categories, definitions, or records.
 */
export function dropLegacyBudgetIncome(raw: Record<string, unknown>): Record<string, unknown> {
  const {
    budgetIncomeByYear: _budgetIncomeByYear,
    budgetIncomeMonthly: _budgetIncomeMonthly,
    budgetIncomeYearly: _budgetIncomeYearly,
    ...current
  } = raw
  return current
}

/**
 * Migration tolerance: raw pre-coalesce blob with the old year-scoped
 * `budgetExpensesByYear: Record<year, Expense[]>` (each `Expense` carrying
 * name/categoryId/frequency/amount duplicated into every year it appears in)
 * gets split into a year-independent `budgetExpenseDefinitions:
 * ExpenseDefinition[]` (one entry per distinct expense id, with
 * name/categoryId/frequency taken from that id's most-recent year) plus
 * `budgetExpenseAmountsByYear: Record<year, Record<expenseId, number>>`
 * (every `(year, id)` pair that existed keeps its amount). The superseded
 * `budgetExpensesByYear` key is stripped afterward. No-op if
 * `budgetExpenseDefinitions` is already present (even `[]`).
 */
export function migrateBudgetExpenseDefinitionsIfNeeded(raw: Record<string, unknown>): Record<string, unknown> {
  if ('budgetExpenseDefinitions' in raw) return raw

  const byYear = raw.budgetExpensesByYear as Record<string, unknown> | undefined
  if (byYear && typeof byYear === 'object') {
    // Scan years descending so the first time an id is seen is its
    // most-recent year — that year's name/categoryId/frequency wins.
    const years = Object.keys(byYear).sort((a, b) => Number(b) - Number(a))
    const seenIds = new Set<string>()
    const definitions: { id: string; name: string; categoryId: string; frequency: 'monthly' | 'yearly' }[] = []
    const amountsByYear: Record<string, Record<string, number>> = {}

    for (const year of years) {
      const expenses = byYear[year]
      if (!Array.isArray(expenses)) continue
      for (const expense of expenses as {
        id: string
        name: string
        categoryId: string
        frequency: 'monthly' | 'yearly'
        amount: number
      }[]) {
        if (!seenIds.has(expense.id)) {
          seenIds.add(expense.id)
          definitions.push({
            id: expense.id,
            name: expense.name,
            categoryId: expense.categoryId,
            frequency: expense.frequency,
          })
        }
        if (!amountsByYear[year]) amountsByYear[year] = {}
        amountsByYear[year][expense.id] = expense.amount
      }
    }

    return {
      ...raw,
      budgetExpenseDefinitions: definitions,
      budgetExpenseAmountsByYear: amountsByYear,
      budgetExpensesByYear: undefined,
    }
  }

  return { ...raw, budgetExpenseDefinitions: [], budgetExpenseAmountsByYear: {} }
}

/**
 * Migration tolerance: fill in missing collections/fields with defaults from initialState().
 *
 * Every path that turns stored bytes back into an AppState must run through
 * this — local unlock and Drive restore alike. A backup written by an older
 * build is missing whatever fields have been added since, and handing that
 * raw object to the reducer puts `undefined` where the UI expects arrays.
 */
export function coalesceWithDefaults(loaded: Partial<AppState>): AppState {
  const defaults = initialState()
  return {
    // Data collections
    accounts: (loaded.accounts ?? defaults.accounts).map((a) => ({
      ...a,
      institution: a.institution ?? '',
    })),
    positions: loaded.positions ?? defaults.positions,
    closedPositions: (loaded.closedPositions ?? defaults.closedPositions).map((cp) => ({
      ...cp,
      shares: cp.shares ?? 0,
      avgCost: cp.avgCost ?? 0,
      price: cp.price ?? 0,
      assetClassManualOverride: cp.assetClassManualOverride,
      lastImportedAt: cp.lastImportedAt ?? '',
    })),
    transactions: loaded.transactions ?? defaults.transactions,
    snapshots: loaded.snapshots ?? defaults.snapshots,
    csvMappings: loaded.csvMappings ?? defaults.csvMappings,
    customInstitutions: loaded.customInstitutions ?? defaults.customInstitutions,
    priceSync: loaded.priceSync ?? defaults.priceSync,
    mutualFundSync: loaded.mutualFundSync ?? defaults.mutualFundSync,
    balanceEntries: (loaded.balanceEntries ?? defaults.balanceEntries).map((entry) => {
      const legacy = entry as unknown as {
        activityType?: string
        activityAmount?: number
        note?: string
        activities?: { type: string; amount: number; note: string }[]
      }
      if (legacy.activities) {
        return entry
      }
      const { activityType, activityAmount, note, ...rest } = legacy
      const activities =
        activityType && activityType !== 'None'
          ? [{ type: activityType as any, amount: activityAmount ?? 0, note: note ?? '' }]
          : []
      return { ...rest, activities } as typeof entry
    }),
    categoryMappings: loaded.categoryMappings ?? defaults.categoryMappings,

    // UI state with existing values or defaults.
    // `view` is whitelisted rather than defaulted: blobs written before the
    // Dashboard was removed carry `view: 'dashboard'`, which is no longer a
    // renderable view. Anything unrecognized falls back to the default.
    // Whitelist covers all current views (accounts, settings, quotes, register, budget).
    view:
      loaded.view === 'accounts' ||
      loaded.view === 'settings' ||
      loaded.view === 'quotes' ||
      loaded.view === 'register' ||
      loaded.view === 'budget'
        ? loaded.view
        : defaults.view,
    sortKey: loaded.sortKey ?? defaults.sortKey,
    sortDir: loaded.sortDir ?? defaults.sortDir,
    txTypeFilter: loaded.txTypeFilter ?? defaults.txTypeFilter,
    txSearch: loaded.txSearch ?? defaults.txSearch,
    selectedAccountId: loaded.selectedAccountId ?? defaults.selectedAccountId,
    selectedCategoryKey: loaded.selectedCategoryKey ?? defaults.selectedCategoryKey,
    expandedCategories: loaded.expandedCategories ?? defaults.expandedCategories,
    acctAssetClassFilter: loaded.acctAssetClassFilter ?? defaults.acctAssetClassFilter,
    acctPosSearch: loaded.acctPosSearch ?? defaults.acctPosSearch,
    regAccountId: loaded.regAccountId ?? defaults.regAccountId,
    regExpanded: loaded.regExpanded ?? defaults.regExpanded,
    regActivityFilter: loaded.regActivityFilter ?? defaults.regActivityFilter,
    budgetExpenseDefinitions: loaded.budgetExpenseDefinitions ?? defaults.budgetExpenseDefinitions,
    budgetExpenseAmountsByYear: loaded.budgetExpenseAmountsByYear ?? defaults.budgetExpenseAmountsByYear,
    budgetTransactions: loaded.budgetTransactions ?? defaults.budgetTransactions,
    budgetAccountAppliedConventions: loaded.budgetAccountAppliedConventions ?? defaults.budgetAccountAppliedConventions,
  }
}

/** Reads the raw stored value from the active portfolio's database, or undefined if nothing is stored. */
async function readRawFromActiveDb(): Promise<unknown> {
  const db = await openDb(requireActiveDbName())
  return new Promise<unknown>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.get(STATE_KEY)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
  })
}

/**
 * Peeks at the active portfolio's raw stored value's shape without decrypting
 * anything. Used by the password gate to decide whether to prompt for a new
 * password (absent) or unlock (encrypted).
 */
export async function peekEnvelopeShape(): Promise<'absent' | 'encrypted'> {
  try {
    const raw = await readRawFromActiveDb()
    return detectEnvelopeShape(raw) === 'encrypted' ? 'encrypted' : 'absent'
  } catch {
    return 'absent'
  }
}

/**
 * Peeks at the active portfolio's stored envelope's salt (if it is already
 * encrypted) without a password. Returns null if nothing is stored or the
 * stored value isn't an encrypted envelope.
 */
export async function peekStoredSalt(): Promise<Uint8Array | null> {
  try {
    const raw = await readRawFromActiveDb()
    if (detectEnvelopeShape(raw) !== 'encrypted') {
      return null
    }
    return base64ToBytes((raw as EncryptedEnvelope).salt)
  } catch {
    return null
  }
}

/**
 * Decrypts the persisted blob from the active portfolio's database and
 * returns the raw parsed object, BEFORE coalesceWithDefaults runs. Returns
 * null if nothing was saved. Throws if the stored value is not an encrypted
 * envelope (caller bug — the gate must never call this on an absent
 * envelope) or if decryption fails (e.g. wrong password → OperationError
 * propagates uncaught).
 */
export async function loadRawPersistedBlob(
  key: CryptoKey,
): Promise<(Partial<AppState> & Record<string, unknown>) | null> {
  const raw = await readRawFromActiveDb()

  if (raw === undefined || raw === null) {
    return null
  }

  if (detectEnvelopeShape(raw) !== 'encrypted') {
    throw new Error('loadPersistedApp called on a non-encrypted envelope')
  }

  const decrypted = (await decryptState(raw as EncryptedEnvelope, key)) as Partial<AppState> & Record<string, unknown>
  const withIncomeDropped = dropLegacyBudgetIncome(decrypted)
  const withExpensesByYearMigrated = migrateBudgetExpensesByYearIfNeeded(withIncomeDropped)
  const withExpenseDefinitionsMigrated = migrateBudgetExpenseDefinitionsIfNeeded(withExpensesByYearMigrated)
  return withExpenseDefinitionsMigrated as Partial<AppState> & Record<string, unknown>
}

/**
 * Loads and decrypts the persisted AppState from the active portfolio's database.
 * Returns null if nothing was saved.
 * Throws if the stored value is not an encrypted envelope (caller bug — the
 * gate must never call this on an absent envelope) or if decryption
 * fails (e.g. wrong password → OperationError propagates uncaught).
 */
export async function loadPersistedApp(key: CryptoKey): Promise<AppState | null> {
  const raw = await loadRawPersistedBlob(key)
  return raw ? coalesceWithDefaults(raw) : null
}

/**
 * Encrypts and saves app state to the active portfolio's database.
 */
export async function savePersistedApp(state: AppState, key: CryptoKey, salt: Uint8Array): Promise<void> {
  try {
    const envelope = await encryptState(state, key, salt)
    const db = await openDb(requireActiveDbName())

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.put(envelope, STATE_KEY)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve()
    })
  } catch (error) {
    console.error('Failed to save app state:', error)
    throw error
  }
}
