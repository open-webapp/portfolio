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
  Expense,
  BudgetTransaction,
  Category,
  CategoryMapping,
} from './types'
import { uid } from './seed'
import type { ExportableState } from './importExport'

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
  budgetIncomeMonthly: number
  budgetIncomeYearly: number
  budgetExpenses: Expense[]
  budgetTransactions: BudgetTransaction[]
  categories: Category[]
  categoryMappings: CategoryMapping[]

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
    budgetIncomeMonthly: 0,
    budgetIncomeYearly: 0,
    budgetExpenses: [],
    budgetTransactions: [],
    categories: [],
    categoryMappings: [],

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
    budgetIncomeMonthly: data.budgetIncomeMonthly,
    budgetIncomeYearly: data.budgetIncomeYearly,
    budgetExpenses: data.budgetExpenses,
    categories: data.categories ?? [],
    categoryMappings: data.categoryMappings ?? [],
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

/** Set the monthly income amount on the Budget page. Clamped to >= 0. */
export function setBudgetIncomeMonthly(state: AppState, amount: number): AppState {
  return { ...state, budgetIncomeMonthly: Math.max(0, amount) }
}

/** Set the yearly income amount on the Budget page. Clamped to >= 0. */
export function setBudgetIncomeYearly(state: AppState, amount: number): AppState {
  return { ...state, budgetIncomeYearly: Math.max(0, amount) }
}

/** Add a new expense to the Budget page's expense list. Generates its id. */
export function addBudgetExpense(state: AppState, expense: Omit<Expense, 'id'>): AppState {
  return { ...state, budgetExpenses: [...state.budgetExpenses, { ...expense, id: uid('expense') }] }
}

/** Patch an existing budget expense by ID. No-op if the ID isn't found. */
export function updateBudgetExpense(state: AppState, id: string, patch: Partial<Omit<Expense, 'id'>>): AppState {
  return {
    ...state,
    budgetExpenses: state.budgetExpenses.map((e) => (e.id === id ? { ...e, ...patch } : e)),
  }
}

/** Delete a budget expense by ID. No-op if the ID isn't found. */
export function deleteBudgetExpense(state: AppState, id: string): AppState {
  return { ...state, budgetExpenses: state.budgetExpenses.filter((e) => e.id !== id) }
}

/** Add a new budget transaction to the Budget page's transaction list. Generates its id. */
export function addBudgetTransaction(state: AppState, tx: Omit<BudgetTransaction, 'id'>): AppState {
  return { ...state, budgetTransactions: [...state.budgetTransactions, { ...tx, id: uid('budgettx') }] }
}

/** Patch an existing budget transaction by ID. No-op if the ID isn't found. */
export function updateBudgetTransaction(state: AppState, id: string, patch: Partial<Omit<BudgetTransaction, 'id'>>): AppState {
  return { ...state, budgetTransactions: state.budgetTransactions.map((t) => (t.id === id ? { ...t, ...patch } : t)) }
}

/** Delete a budget transaction by ID. No-op if the ID isn't found. */
export function deleteBudgetTransaction(state: AppState, id: string): AppState {
  return { ...state, budgetTransactions: state.budgetTransactions.filter((t) => t.id !== id) }
}

/**
 * Import budget transactions, resolving each row's categoryId from category mappings
 * (falling back to the 'Other' category), then deduping on natural key
 * (date|description|categoryId|amount|accountName) against existing transactions AND
 * within the same import batch (accumulating Set).
 */
export function importBudgetTransactions(
  state: AppState,
  rows: Array<{ date: string; description: string; amount: number; accountName?: string }>
): AppState {
  const otherId = state.categories.find((c) => c.name === 'Other')?.id ?? state.categories[0]?.id ?? ''
  const withCategory = rows.map((r) => ({
    ...r,
    categoryId: resolveCategoryIdForDescription(state.categoryMappings, r.description) ?? otherId,
  }))
  const seen = new Set(
    state.budgetTransactions.map((t) => `${t.date}|${t.description}|${t.categoryId}|${t.amount}|${t.accountName ?? ''}`)
  )
  const toAdd: BudgetTransaction[] = []
  for (const r of withCategory) {
    const key = `${r.date}|${r.description}|${r.categoryId}|${r.amount}|${r.accountName ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    toAdd.push({ ...r, id: uid('budgettx') })
  }
  return { ...state, budgetTransactions: [...state.budgetTransactions, ...toAdd] }
}

/** Set income for one period, clearing the other (monthly/yearly are mutually exclusive). Clamped to >= 0. */
export function setBudgetIncomeForPeriod(state: AppState, period: 'monthly' | 'yearly', amount: number): AppState {
  const clamped = Math.max(0, amount)
  return period === 'monthly'
    ? { ...state, budgetIncomeMonthly: clamped, budgetIncomeYearly: 0 }
    : { ...state, budgetIncomeYearly: clamped, budgetIncomeMonthly: 0 }
}

/** Add a new category with a caller-supplied id (so the caller can synchronously know the new id). */
export function addCategory(state: AppState, id: string, name: string): AppState {
  return { ...state, categories: [...state.categories, { id, name }] }
}

/** Rename a category by ID. No-op if the ID isn't found. */
export function renameCategory(state: AppState, id: string, name: string): AppState {
  return { ...state, categories: state.categories.map((c) => (c.id === id ? { ...c, name } : c)) }
}

/**
 * Upsert a category mapping by description substring, case-insensitive.
 * If a mapping with the same substring (case-insensitively) already exists, its
 * categoryId/updatedAt are updated in place; otherwise a new mapping is created.
 * Blank/whitespace-only descriptions are a no-op.
 */
export function upsertCategoryMapping(state: AppState, description: string, categoryId: string): AppState {
  const trimmed = description.trim()
  if (!trimmed) return state
  const now = new Date().toISOString()
  const existing = state.categoryMappings.find((m) => m.substring.toLowerCase() === trimmed.toLowerCase())
  if (existing) {
    return {
      ...state,
      categoryMappings: state.categoryMappings.map((m) =>
        m.id === existing.id ? { ...m, categoryId, updatedAt: now } : m
      ),
    }
  }
  const mapping: CategoryMapping = { id: uid('catmap'), substring: trimmed, categoryId, updatedAt: now }
  return { ...state, categoryMappings: [...state.categoryMappings, mapping] }
}

/** Patch an existing category mapping by ID. No-op if the ID isn't found. */
export function updateCategoryMapping(state: AppState, id: string, patch: Partial<Pick<CategoryMapping, 'substring' | 'categoryId'>>): AppState {
  const now = new Date().toISOString()
  return {
    ...state,
    categoryMappings: state.categoryMappings.map((m) => (m.id === id ? { ...m, ...patch, updatedAt: now } : m)),
  }
}

/** Add a new category mapping. Blank/whitespace-only substrings are a no-op. */
export function addCategoryMapping(state: AppState, categoryId: string, substring: string): AppState {
  const trimmed = substring.trim()
  if (!trimmed) return state
  const mapping: CategoryMapping = { id: uid('catmap'), substring: trimmed, categoryId, updatedAt: new Date().toISOString() }
  return { ...state, categoryMappings: [...state.categoryMappings, mapping] }
}

/**
 * Resolve the categoryId for a transaction description by finding all mappings
 * whose substring (case-insensitive) appears in the description, and returning
 * the categoryId of the one with the latest updatedAt. Returns null if no
 * mapping matches.
 */
export function resolveCategoryIdForDescription(mappings: CategoryMapping[], description: string): string | null {
  const lower = description.toLowerCase()
  const matches = mappings.filter((m) => m.substring && lower.includes(m.substring.toLowerCase()))
  if (matches.length === 0) return null
  return matches.reduce((latest, m) => (m.updatedAt > latest.updatedAt ? m : latest)).categoryId
}

/**
 * Re-run category mapping resolution against all existing budget transactions,
 * rewriting categoryId for any transaction whose description matches a mapping.
 * Transactions with no match are left untouched.
 */
export function reapplyCategoryMappings(state: AppState): AppState {
  return {
    ...state,
    budgetTransactions: state.budgetTransactions.map((t) => {
      const resolved = resolveCategoryIdForDescription(state.categoryMappings, t.description)
      return resolved ? { ...t, categoryId: resolved } : t
    }),
  }
}


