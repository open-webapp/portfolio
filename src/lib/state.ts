import type {
  Account,
  Position,
  ClosedPosition,
  Transaction,
  PortfolioSnapshot,
  TaxCategory,
  SavedCsvMapping,
  PriceSyncState,
  MutualFundSyncState,
  HeldSymbolPrice,
  PriceSyncLastRun,
  BalanceEntry,
  ExpenseDefinition,
  BudgetTransaction,
  Category,
  CategoryMapping,
} from './types'
import { uid } from './seed'
import type { ExportableState } from './importExport'
import { resolveSpendExpenseIdForDescription, reapplyMappingsToTransactions } from './categoryStore'

export interface AppState {
  // Data collections
  accounts: Account[]
  positions: Position[]
  closedPositions: ClosedPosition[]
  transactions: Transaction[]
  snapshots: PortfolioSnapshot[]
  csvMappings: SavedCsvMapping[]
  customInstitutions: string[]
  priceSync: PriceSyncState
  mutualFundSync: MutualFundSyncState
  balanceEntries: BalanceEntry[]
  budgetExpenseDefinitions: ExpenseDefinition[]
  budgetExpenseAmountsByYear: Record<string, Record<string, number>>
  budgetTransactions: BudgetTransaction[]

  // UI state
  view: 'settings' | 'accounts' | 'quotes' | 'register' | 'budget'
  sortKey: keyof Position
  sortDir: 'asc' | 'desc'
  txTypeFilter: string // 'All' or specific type like 'Buy'
  txSearch: string // search text for transactions
  selectedAccountId: string | null // selected account on AccountsPage
  selectedCategoryKey: TaxCategory | 'closedPositions' | null // selected category on AccountsPage
  expandedCategories: Record<string, boolean> // category expansion state
  acctAssetClassFilter: string // asset class filter on AccountsPage
  acctPosSearch: string // position search text on AccountsPage
  regAccountId: string | null // selected account on RegisterPage
  regExpanded: Record<string, boolean> // category expansion state on RegisterPage
  regActivityFilter: 'All' | 'With Activity' // activity filter on RegisterPage
  pendingImport?: {
    kind: 'positions' | 'transactions'
    profileId: string
    rows: Record<string, string>[]
    fileName: string
  }
}

/**
 * Create a fresh AppState with empty collections and sensible UI defaults.
 */
export function initialState(): AppState {
  return {
    // Data collections
    accounts: [],
    positions: [],
    closedPositions: [],
    transactions: [],
    snapshots: [],
    csvMappings: [],
    customInstitutions: [],
    priceSync: {
      apiKey: '',
      lastFetchedDate: null,
      heldPrices: {},
      lastRun: null,
    },
    mutualFundSync: { apiKey: '', heldPrices: {}, lastRun: null, callBudget: { date: '', callsUsed: 0 } },
    balanceEntries: [],
    budgetExpenseDefinitions: [],
    budgetExpenseAmountsByYear: {},
    budgetTransactions: [],

    // UI state
    view: 'accounts',
    sortKey: 'symbol',
    sortDir: 'asc',
    txTypeFilter: 'All',
    txSearch: '',
    selectedAccountId: null,
    selectedCategoryKey: null,
    expandedCategories: {},
    acctAssetClassFilter: 'All',
    acctPosSearch: '',
    regAccountId: null,
    regExpanded: {},
    regActivityFilter: 'All',
  }
}

/**
 * Current budget year key (e.g. "2026") used to index budgetExpenseAmountsByYear.
 */
export function currentBudgetYear(now: Date = new Date()): string {
  return String(now.getFullYear())
}

/**
 * Shared helper: year-key in `byYear` numerically closest to `targetYear`,
 * ties broken toward the earlier year. Returns null if `byYear` is empty.
 */
function nearestYearKey<T>(
  byYear: Record<string, T>,
  targetYear: string,
  isEmpty?: (v: T) => boolean
): string | null {
  const keys = Object.keys(byYear)
  if (keys.length === 0) return null
  const target = Number(targetYear)
  if (!isEmpty) {
    let best: string | null = null
    let bestDist = Infinity
    for (const key of keys) {
      const dist = Math.abs(Number(key) - target)
      if (
        dist < bestDist ||
        (dist === bestDist && best !== null && Number(key) < Number(best))
      ) {
        best = key
        bestDist = dist
      }
    }
    return best
  }

  const byKey = new Map<number, string>()
  let maxDist = 0
  for (const key of keys) {
    const num = Number(key)
    byKey.set(num, key)
    maxDist = Math.max(maxDist, Math.abs(num - target))
  }
  for (let dist = 0; dist <= maxDist; dist++) {
    for (const candidateNum of dist === 0 ? [target] : [target - dist, target + dist]) {
      const key = byKey.get(candidateNum)
      if (key !== undefined && !isEmpty(byYear[key])) {
        return key
      }
    }
  }
  return null
}

export function isEmptyExpenseAmountsSnapshot(v: Record<string, number>): boolean {
  return Object.keys(v).length === 0
}

/**
 * Return a new state with every empty entry removed from
 * `budgetExpenseAmountsByYear` (value `{}`). Returns the SAME state reference
 * if nothing needs stripping.
 */
export function stripEmptyBudgetSnapshots(state: AppState): AppState {
  const expenseKeys = Object.keys(state.budgetExpenseAmountsByYear)
  const nonEmptyExpenseKeys = expenseKeys.filter((k) => !isEmptyExpenseAmountsSnapshot(state.budgetExpenseAmountsByYear[k]))
  const expensesChanged = nonEmptyExpenseKeys.length !== expenseKeys.length
  if (!expensesChanged) return state

  const budgetExpenseAmountsByYear = expensesChanged
    ? Object.fromEntries(nonEmptyExpenseKeys.map((k) => [k, state.budgetExpenseAmountsByYear[k]]))
    : state.budgetExpenseAmountsByYear
  return {
    ...state,
    budgetExpenseAmountsByYear,
  }
}

/**
 * Update a single account (to be implemented in reducer cases).
 */
export function updateAccount(
  state: AppState,
  accountId: string,
  patch: Partial<Account>
): AppState {
  return {
    ...state,
    accounts: state.accounts.map((a) =>
      a.id === accountId ? { ...a, ...patch } : a
    ),
  }
}

/**
 * Add a new account (to be implemented in reducer cases).
 */
export function addAccount(state: AppState, account: Account): AppState {
  return {
    ...state,
    accounts: [...state.accounts, account],
  }
}

/**
 * Delete an account by ID (to be implemented in reducer cases).
 */
export function deleteAccount(state: AppState, accountId: string): AppState {
  return {
    ...state,
    accounts: state.accounts.filter((a) => a.id !== accountId),
    positions: state.positions.filter((p) => p.accountId !== accountId),
    closedPositions: state.closedPositions.filter((c) => c.accountId !== accountId),
    transactions: state.transactions.filter((t) => t.accountId !== accountId),
    snapshots: state.snapshots.filter((s) => s.accountId !== accountId),
    csvMappings: state.csvMappings.filter((m) => m.accountId !== accountId),
    balanceEntries: state.balanceEntries.filter((b) => b.accountId !== accountId),
  }
}

/**
 * Update a single position (to be implemented in reducer cases).
 */
export function updatePosition(
  state: AppState,
  positionId: string,
  patch: Partial<Position>
): AppState {
  return {
    ...state,
    positions: state.positions.map((p) =>
      p.id === positionId ? { ...p, ...patch } : p
    ),
  }
}

export function setPriceSyncApiKey(state: AppState, apiKey: string): AppState {
  return { ...state, priceSync: { ...state.priceSync, apiKey } }
}

export function recordPriceSyncRun(
  state: AppState,
  patch: {
    lastFetchedDate?: string
    heldPrices?: Record<string, HeldSymbolPrice>
    lastRun: PriceSyncLastRun
  }
): AppState {
  return {
    ...state,
    priceSync: {
      ...state.priceSync,
      lastFetchedDate: patch.lastFetchedDate ?? state.priceSync.lastFetchedDate,
      heldPrices: patch.heldPrices ?? state.priceSync.heldPrices,
      lastRun: patch.lastRun,
    },
  }
}

export function setMutualFundSyncApiKey(state: AppState, apiKey: string): AppState {
  return { ...state, mutualFundSync: { ...state.mutualFundSync, apiKey } }
}

export function recordMutualFundSyncRun(
  state: AppState,
  patch: {
    heldPrices?: Record<string, HeldSymbolPrice>
    lastRun: PriceSyncLastRun
    callBudget: { date: string; callsUsed: number }
  }
): AppState {
  return {
    ...state,
    mutualFundSync: {
      ...state.mutualFundSync,
      heldPrices: patch.heldPrices ?? state.mutualFundSync.heldPrices,
      lastRun: patch.lastRun,
      callBudget: patch.callBudget,
    },
  }
}

/**
 * Delete a closed position by ID (to be implemented in reducer cases).
 */
export function deleteClosedPosition(state: AppState, id: string): AppState {
  return {
    ...state,
    closedPositions: state.closedPositions.filter((cp) => cp.id !== id),
  }
}

/**
 * Close a position by moving it to closedPositions (to be implemented in reducer cases).
 */
export function closePosition(state: AppState, positionId: string): AppState {
  const position = state.positions.find((p) => p.id === positionId)
  if (!position) return state
  const closed: ClosedPosition = {
    id: uid('closed'),
    accountId: position.accountId,
    symbol: position.symbol,
    name: position.name,
    closedDate: new Date().toISOString().slice(0, 10),
    assetClass: position.assetClassManualOverride || position.assetClass,
    realizedGL: null,
    realizedGLBasis: 'unknown',
    shares: position.shares,
    avgCost: position.avgCost,
    price: position.price,
    assetClassManualOverride: position.assetClassManualOverride,
    lastImportedAt: position.lastImportedAt,
  }
  return {
    ...state,
    positions: state.positions.filter((p) => p.id !== positionId),
    closedPositions: [...state.closedPositions, closed],
  }
}

/**
 * Find an existing OPEN position in the same account with the same symbol as
 * a ClosedPosition snapshot, for restore-time dedup decisions.
 * Returns null if no same-symbol position exists in that account.
 */
export function findMatchingOpenPosition(state: AppState, closed: ClosedPosition): Position | null {
  return state.positions.find(
    (p) => p.accountId === closed.accountId && p.symbol === closed.symbol
  ) ?? null
}

/**
 * True if an existing open position is an exact-lot match for a closed
 * snapshot (same shares, avgCost, assetClass) — the "safe to silently
 * overwrite after confirm" case. False means "different lot, coexist".
 */
export function isExactLotMatch(position: Position, closed: ClosedPosition): boolean {
  return (
    position.shares === closed.shares &&
    position.avgCost === closed.avgCost &&
    position.assetClass === closed.assetClass
  )
}

/**
 * Restore a ClosedPosition back into open positions (inverse of closePosition).
 * Always assigns a fresh id. If replaceExistingPositionId is given, that
 * position is removed and replaced by the restored one (exact-match-confirmed
 * overwrite case); otherwise the restored position is simply added.
 */
export function restoreClosedPosition(
  state: AppState,
  closedPositionId: string,
  replaceExistingPositionId?: string
): AppState {
  const closed = state.closedPositions.find((cp) => cp.id === closedPositionId)
  if (!closed) return state
  const restored: Position = {
    id: uid('position'),
    accountId: closed.accountId,
    symbol: closed.symbol,
    name: closed.name,
    assetClass: closed.assetClass,
    assetClassManualOverride: closed.assetClassManualOverride,
    shares: closed.shares,
    avgCost: closed.avgCost,
    price: closed.price,
    lastImportedAt: closed.lastImportedAt,
  }
  return {
    ...state,
    positions: [
      ...state.positions.filter((p) => p.id !== replaceExistingPositionId),
      restored,
    ],
    closedPositions: state.closedPositions.filter((cp) => cp.id !== closedPositionId),
  }
}

/**
 * Set the sort key and direction (to be implemented in reducer cases).
 */
export function setSort(
  state: AppState,
  sortKey: keyof Position,
  sortDir: 'asc' | 'desc'
): AppState {
  return {
    ...state,
    sortKey,
    sortDir,
  }
}

/**
 * Toggle sort direction for the current key (to be implemented in reducer cases).
 */
export function toggleSort(state: AppState, newKey: keyof Position): AppState {
  return {
    ...state,
    sortKey: newKey,
    sortDir: state.sortKey === newKey ? (state.sortDir === 'asc' ? 'desc' : 'asc') : 'asc',
  }
}

/**
 * Set the transactions search text (to be implemented in reducer cases).
 */
export function setTransactionsSearch(state: AppState, search: string): AppState {
  return {
    ...state,
    txSearch: search,
  }
}

/**
 * Set the transaction type filter (to be implemented in reducer cases).
 */
export function setTransactionTypeFilter(state: AppState, filter: string): AppState {
  return {
    ...state,
    txTypeFilter: filter,
  }
}

/**
 * Select an account and category on AccountsPage (toggle if already selected).
 */
export function selectAccount(state: AppState, accountId: string, categoryKey: TaxCategory | 'closedPositions'): AppState {
  const isSame = state.selectedAccountId === accountId && state.selectedCategoryKey === categoryKey
  return {
    ...state,
    selectedAccountId: isSame ? null : accountId,
    selectedCategoryKey: isSame ? null : categoryKey,
  }
}

/**
 * Clear the AccountsPage selection back to "All Accounts" (no toggle logic).
 */
export function clearAccountSelection(state: AppState): AppState {
  return { ...state, selectedAccountId: null, selectedCategoryKey: null }
}

/**
 * Toggle category expansion state on AccountsPage.
 */
export function toggleCategoryExpanded(state: AppState, categoryKey: string): AppState {
  return {
    ...state,
    expandedCategories: {
      ...state.expandedCategories,
      [categoryKey]: !state.expandedCategories[categoryKey],
    },
  }
}

/**
 * Set the asset class filter on AccountsPage.
 */
export function setAcctAssetClassFilter(state: AppState, filter: string): AppState {
  return {
    ...state,
    acctAssetClassFilter: filter,
  }
}

/**
 * Set the position search text on AccountsPage.
 */
export function setAcctPosSearch(state: AppState, search: string): AppState {
  return {
    ...state,
    acctPosSearch: search,
  }
}

/**
 * Upsert a saved CSV mapping for an account and import kind (to be implemented in reducer cases).
 * If a mapping already exists for (accountId, kind), update it; otherwise insert a new one.
 */
export function upsertCsvMapping(
  state: AppState,
  accountId: string,
  kind: 'positions' | 'transactions',
  fieldMap: Record<string, string>
): AppState {
  const existing = state.csvMappings.find(
    (m) => m.accountId === accountId && m.kind === kind
  )
  const entry: SavedCsvMapping = {
    id: existing?.id ?? uid('mapping'),
    accountId,
    kind,
    fieldMap,
    updatedAt: new Date().toISOString(),
  }
  return {
    ...state,
    csvMappings: existing
      ? state.csvMappings.map((m) => (m === existing ? entry : m))
      : [...state.csvMappings, entry],
  }
}

/**
 * Add a custom institution name if it doesn't already exist.
 */
export function addCustomInstitution(state: AppState, name: string): AppState {
  const trimmed = name.trim()
  if (!trimmed || state.customInstitutions.includes(trimmed)) return state
  return { ...state, customInstitutions: [...state.customInstitutions, trimmed] }
}

/**
 * Set the current view (to be implemented in reducer cases).
 */
export function setView(state: AppState, view: 'settings' | 'accounts' | 'quotes' | 'register' | 'budget'): AppState {
  return {
    ...state,
    view,
  }
}

/**
 * Upsert balance entries by (accountId, date) key: any incoming entry
 * replaces an existing entry sharing the same (accountId, date); new
 * (accountId, date) combinations are appended.
 */
export function addBalanceEntries(state: AppState, entries: BalanceEntry[]): AppState {
  const incomingKeys = new Set(entries.map((e) => `${e.accountId}|${e.date}`))
  const retained = state.balanceEntries.filter(
    (b) => !incomingKeys.has(`${b.accountId}|${b.date}`)
  )
  return {
    ...state,
    balanceEntries: [...retained, ...entries],
  }
}

/**
 * Delete a balance entry by ID.
 */
export function deleteBalanceEntry(state: AppState, id: string): AppState {
  return {
    ...state,
    balanceEntries: state.balanceEntries.filter((b) => b.id !== id),
  }
}

/**
 * Upsert a balance entry by ID. If the entry's (accountId, date) collides
 * with a different existing entry, that other entry is dropped.
 */
export function updateBalanceEntry(state: AppState, entry: BalanceEntry): AppState {
  const retained = state.balanceEntries.filter(
    (b) =>
      !(b.accountId === entry.accountId && b.date === entry.date && b.id !== entry.id) &&
      b.id !== entry.id
  )
  return {
    ...state,
    balanceEntries: [...retained, entry],
  }
}

/**
 * Set the selected account on RegisterPage.
 */
export function setRegAccount(state: AppState, accountId: string | null): AppState {
  return {
    ...state,
    regAccountId: accountId,
  }
}

/**
 * Toggle category expansion state on RegisterPage.
 */
export function toggleRegCategoryExpanded(state: AppState, categoryKey: string): AppState {
  return {
    ...state,
    regExpanded: {
      ...state.regExpanded,
      [categoryKey]: !state.regExpanded[categoryKey],
    },
  }
}

/**
 * Set the activity filter on RegisterPage.
 */
export function setRegActivityFilter(state: AppState, filter: string): AppState {
  return {
    ...state,
    regActivityFilter: filter as AppState['regActivityFilter'],
  }
}

/**
 * Replace the imported-backup subset of state (data collections plus
 * priceSync/mutualFundSync apiKey+lastRun) with data from a restored
 * backup. Preserves cached price data (heldPrices, lastFetchedDate,
 * callBudget) and all UI-state fields untouched.
 */
export function replaceImportedState(state: AppState, data: ExportableState): AppState {
  return {
    ...state,
    accounts: data.accounts,
    positions: data.positions,
    closedPositions: data.closedPositions,
    transactions: data.transactions,
    snapshots: data.snapshots,
    csvMappings: data.csvMappings,
    customInstitutions: data.customInstitutions,
    balanceEntries: data.balanceEntries,
    budgetExpenseDefinitions: data.budgetExpenseDefinitions ?? [],
    budgetExpenseAmountsByYear: data.budgetExpenseAmountsByYear ?? {},
    budgetTransactions: data.budgetTransactions ?? [],
    priceSync: {
      ...state.priceSync,
      apiKey: data.priceSync.apiKey,
      lastRun: data.priceSync.lastRun,
    },
    mutualFundSync: {
      ...state.mutualFundSync,
      apiKey: data.mutualFundSync.apiKey,
      lastRun: data.mutualFundSync.lastRun,
    },
  }
}

/**
 * Year-key in `byYear` numerically closest to `targetYear`; ties broken toward
 * the earlier year. Returns null if `byYear` is empty.
 */
export function nearestExpenseAmountsYear(
  byYear: Record<string, Record<string, number>>,
  targetYear: string
): string | null {
  return nearestYearKey(byYear, targetYear, isEmptyExpenseAmountsSnapshot)
}

/**
 * Resolve the amounts map to show for `year`: own snapshot, else nearest
 * year's, else {}.
 */
export function resolveExpenseAmountsForYear(
  byYear: Record<string, Record<string, number>>,
  year: string
): Record<string, number> {
  if (byYear[year] && Object.keys(byYear[year]).length > 0) return byYear[year]
  const nearest = nearestExpenseAmountsYear(byYear, year)
  return nearest ? byYear[nearest] : (byYear[year] ?? {})
}

/**
 * Resolve the amounts map for analytics purposes: own snapshot, else the
 * CURRENT budget year's snapshot specifically (not nearest), else {}.
 */
export function resolveExpenseAmountsForAnalyticsYear(
  byYear: Record<string, Record<string, number>>,
  year: string,
  now: Date = new Date()
): Record<string, number> {
  if (byYear[year]) return byYear[year]
  const current = currentBudgetYear(now)
  return byYear[current] ?? {}
}

/**
 * Ensure `budgetExpenseAmountsByYear[year]` exists as a REAL persisted
 * snapshot for viewing purposes: no-op if already present, OR if there's no
 * nearest year to clone from yet (leaves it virtual —
 * `resolveExpenseAmountsForYear`'s fallback still displays correctly, and a
 * year added later can still be copied in on a future switch). Else
 * deep-copies the nearest year's amounts. Does NOT touch
 * `budgetExpenseDefinitions` (never year-scoped).
 */
export function ensureExpenseAmountsSnapshotForYear(state: AppState, year: string): AppState {
  if (state.budgetExpenseAmountsByYear[year]) return state
  const nearest = nearestExpenseAmountsYear(state.budgetExpenseAmountsByYear, year)
  // nearest is skip-empty (nearestExpenseAmountsYear), so a non-null result is guaranteed non-empty — never persists {}.
  if (!nearest) return state
  const seeded: Record<string, number> = { ...state.budgetExpenseAmountsByYear[nearest] }
  return {
    ...state,
    budgetExpenseAmountsByYear: { ...state.budgetExpenseAmountsByYear, [year]: seeded },
  }
}

/**
 * Roll over into the current budget year if it has no amounts snapshot yet,
 * seeding from the nearest (typically most recent prior) year. No-op if the
 * current year is already snapshotted, or if there is no data anywhere yet.
 */
export function rolloverBudgetExpenseAmountsIfNeeded(state: AppState, now: Date = new Date()): AppState {
  state = stripEmptyBudgetSnapshots(state)
  const year = currentBudgetYear(now)
  if (state.budgetExpenseAmountsByYear[year]) return state
  if (Object.keys(state.budgetExpenseAmountsByYear).length === 0) return state
  return ensureExpenseAmountsSnapshotForYear(state, year)
}

/**
 * Create a new global ExpenseDefinition and seed its amount for the CURRENT
 * real calendar year only (no other year touched). Generates its id.
 */
export function addExpenseDefinition(
  state: AppState,
  def: Omit<ExpenseDefinition, 'id'>,
  amount: number,
  now: Date = new Date()
): AppState {
  const id = uid('expense')
  const year = currentBudgetYear(now)
  return {
    ...state,
    budgetExpenseDefinitions: [...state.budgetExpenseDefinitions, { ...def, id }],
    budgetExpenseAmountsByYear: {
      ...state.budgetExpenseAmountsByYear,
      [year]: { ...state.budgetExpenseAmountsByYear[year], [id]: amount },
    },
  }
}

export interface ExpensePasteImportRow {
  name: string
  amount: number
}

export interface ExpensePasteImportStats {
  valid: number
  imported: number
  created: number
  updated: number
  unchanged: number
}

interface PlannedExpensePasteRow extends ExpensePasteImportRow {
  identity: string
  existingId?: string
}

export interface ExpensePasteImportPlan {
  rows: PlannedExpensePasteRow[]
  stats: ExpensePasteImportStats
}

/**
 * Fold valid pasted rows by normalized name, then classify each identity
 * against the resolved Uncategorized category without mutating state.
 */
export function planExpensePasteImport(
  state: AppState,
  year: string,
  uncategorizedCategoryId: string,
  rows: ExpensePasteImportRow[]
): ExpensePasteImportPlan {
  const folded = new Map<string, ExpensePasteImportRow>()
  for (const row of rows) {
    const identity = row.name.trim().toLowerCase()
    const prior = folded.get(identity)
    folded.set(identity, { name: prior?.name ?? row.name, amount: row.amount })
  }

  const existingByIdentity = new Map<string, ExpenseDefinition>()
  for (const definition of state.budgetExpenseDefinitions) {
    if (definition.categoryId !== uncategorizedCategoryId) continue
    const identity = definition.name.trim().toLowerCase()
    if (!existingByIdentity.has(identity)) existingByIdentity.set(identity, definition)
  }

  const plannedRows: PlannedExpensePasteRow[] = []
  let created = 0
  let updated = 0
  let unchanged = 0
  const yearAmounts = state.budgetExpenseAmountsByYear[year] ?? {}
  for (const [identity, row] of folded) {
    const existing = existingByIdentity.get(identity)
    if (!existing) {
      created += 1
      plannedRows.push({ ...row, identity })
    } else {
      if (yearAmounts[existing.id] === row.amount) unchanged += 1
      else updated += 1
      plannedRows.push({ ...row, identity, existingId: existing.id })
    }
  }

  return {
    rows: plannedRows,
    stats: { valid: rows.length, imported: plannedRows.length, created, updated, unchanged },
  }
}

/** Apply every planned pasted expense identity to one selected budget year. */
export function importExpensePaste(
  state: AppState,
  year: string,
  uncategorizedCategoryId: string,
  rows: ExpensePasteImportRow[]
): AppState {
  const plan = planExpensePasteImport(state, year, uncategorizedCategoryId, rows)
  if (plan.stats.imported === 0 || (plan.stats.created === 0 && plan.stats.updated === 0)) return state

  const definitions = [...state.budgetExpenseDefinitions]
  const amounts = { ...state.budgetExpenseAmountsByYear[year] }
  for (const row of plan.rows) {
    const id = row.existingId ?? uid('expense')
    if (!row.existingId) {
      definitions.push({ id, name: row.name, categoryId: uncategorizedCategoryId, frequency: 'monthly' })
    }
    if (amounts[id] !== row.amount) amounts[id] = row.amount
  }
  return {
    ...state,
    budgetExpenseDefinitions: definitions,
    budgetExpenseAmountsByYear: { ...state.budgetExpenseAmountsByYear, [year]: amounts },
  }
}

/** Patch an existing ExpenseDefinition by ID (affects all years). No-op if the ID isn't found. */
export function updateExpenseDefinition(
  state: AppState,
  id: string,
  patch: Partial<Omit<ExpenseDefinition, 'id'>>
): AppState {
  return {
    ...state,
    budgetExpenseDefinitions: state.budgetExpenseDefinitions.map((d) => (d.id === id ? { ...d, ...patch } : d)),
  }
}

/**
 * Pure predicate: true if any budget transaction, in any year, references
 * this expense definition id as its `spendExpenseId`.
 */
export function expenseDefinitionInUse(state: AppState, id: string): boolean {
  return state.budgetTransactions.some((t) => t.spendExpenseId === id)
}

/**
 * Delete an ExpenseDefinition and all its amount entries across every year.
 * Pure state mutation, unconditional — callers are responsible for checking
 * `expenseDefinitionInUse` first and blocking/alerting if in use.
 */
export function deleteExpenseDefinition(state: AppState, id: string): AppState {
  const budgetExpenseAmountsByYear: Record<string, Record<string, number>> = {}
  for (const [year, amounts] of Object.entries(state.budgetExpenseAmountsByYear)) {
    if (id in amounts) {
      const { [id]: _removed, ...rest } = amounts
      budgetExpenseAmountsByYear[year] = rest
    } else {
      budgetExpenseAmountsByYear[year] = amounts
    }
  }
  return {
    ...state,
    budgetExpenseDefinitions: state.budgetExpenseDefinitions.filter((d) => d.id !== id),
    budgetExpenseAmountsByYear,
  }
}

/** Set/overwrite one (year, expenseId) amount cell. */
export function setExpenseAmount(state: AppState, year: string, expenseId: string, amount: number): AppState {
  return {
    ...state,
    budgetExpenseAmountsByYear: {
      ...state.budgetExpenseAmountsByYear,
      [year]: { ...state.budgetExpenseAmountsByYear[year], [expenseId]: amount },
    },
  }
}

/** Clear one (year, expenseId) amount cell (delete the key), leaving other years/definition untouched. */
export function clearExpenseAmount(state: AppState, year: string, expenseId: string): AppState {
  const yearAmounts = state.budgetExpenseAmountsByYear[year]
  if (!yearAmounts || !(expenseId in yearAmounts)) return state
  const { [expenseId]: _removed, ...rest } = yearAmounts
  return {
    ...state,
    budgetExpenseAmountsByYear: { ...state.budgetExpenseAmountsByYear, [year]: rest },
  }
}

/** Add a new budget transaction to the Budget page's transaction list. Generates its id. */
export function addBudgetTransaction(state: AppState, tx: Omit<BudgetTransaction, 'id'>): AppState {
  return { ...state, budgetTransactions: [...state.budgetTransactions, { ...tx, id: uid('budgettx') }] }
}

/** Patch an existing budget transaction by ID. No-op if the ID isn't found. */
export function updateBudgetTransaction(state: AppState, id: string, patch: Partial<Omit<BudgetTransaction, 'id'>>): AppState {
  return { ...state, budgetTransactions: state.budgetTransactions.map((t) => (t.id === id ? { ...t, ...patch } : t)) }
}

/** Patch categoryId (and optionally spendExpenseId) on multiple budget transactions by ID in one pass. IDs not found are ignored. */
export function updateBudgetTransactionsBulk(
  state: AppState,
  ids: string[],
  patch: { categoryId: string; spendExpenseId?: string }
): AppState {
  return { ...state, budgetTransactions: state.budgetTransactions.map((t) => (ids.includes(t.id) ? { ...t, ...patch } : t)) }
}

/** Delete a budget transaction by ID. No-op if the ID isn't found. */
export function deleteBudgetTransaction(state: AppState, id: string): AppState {
  return { ...state, budgetTransactions: state.budgetTransactions.filter((t) => t.id !== id) }
}

/**
 * Import budget transactions, resolving each row's categoryId from category mappings
 * (falling back to the 'Other' category), then deduping on natural key
 * (date|description|amount|accountName) against existing transactions AND
 * within the same import batch (accumulating Set).
 */
/**
 * Resolves spendExpenseId for each row via category mappings, deriving categoryId
 * from the matched expense definition (falling back to the 'Other' category
 * with spendExpenseId unset), and dedupes against `existing` + within the
 * batch itself, without touching AppState. Shared by `importBudgetTransactions`
 * and by import-UI callers that need added/duplicate counts before dispatch.
 */
export function resolveBudgetImportRows(
  existing: BudgetTransaction[],
  rows: Array<{ date: string; description: string; amount: number; accountName?: string }>,
  categories: Category[],
  categoryMappings: CategoryMapping[],
  budgetExpenseDefinitions: ExpenseDefinition[]
): { toAdd: BudgetTransaction[]; duplicateCount: number } {
  const otherId = categories.find((c) => c.name === 'Other')?.id ?? categories[0]?.id ?? ''
  const withCategory = rows.map((r) => {
    const spendExpenseId = resolveSpendExpenseIdForDescription(categoryMappings, r.description)
    const definition = spendExpenseId
      ? budgetExpenseDefinitions.find((d) => d.id === spendExpenseId)
      : undefined
    if (spendExpenseId && definition) {
      return {
        ...r,
        categoryId: definition.categoryId,
        spendExpenseId,
      }
    }
    return {
      ...r,
      categoryId: otherId,
    }
  })
  const seen = new Set(existing.map((t) => `${t.date}|${t.description}|${t.amount}|${t.accountName ?? ''}`))
  const toAdd: BudgetTransaction[] = []
  let duplicateCount = 0
  for (const r of withCategory) {
    const key = `${r.date}|${r.description}|${r.amount}|${r.accountName ?? ''}`
    if (seen.has(key)) {
      duplicateCount += 1
      continue
    }
    seen.add(key)
    toAdd.push({ ...r, id: uid('budgettx') })
  }
  return { toAdd, duplicateCount }
}

export function importBudgetTransactions(
  state: AppState,
  rows: Array<{ date: string; description: string; amount: number; accountName?: string }>,
  categories: Category[],
  categoryMappings: CategoryMapping[],
  budgetExpenseDefinitions: ExpenseDefinition[]
): AppState {
  const { toAdd } = resolveBudgetImportRows(
    state.budgetTransactions,
    rows,
    categories,
    categoryMappings,
    budgetExpenseDefinitions
  )
  return { ...state, budgetTransactions: [...state.budgetTransactions, ...toAdd] }
}

/** Rewrite budgetTransactions' categoryId/spendExpenseId per the given category mappings. */
export function reapplyCategoryMappingsToState(state: AppState, categoryMappings: CategoryMapping[]): AppState {
  return {
    ...state,
    budgetTransactions: reapplyMappingsToTransactions(state.budgetTransactions, categoryMappings, state.budgetExpenseDefinitions),
  }
}



