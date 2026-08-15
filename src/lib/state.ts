import type {
  Account,
  Position,
  ClosedPosition,
  Transaction,
  PortfolioSnapshot,
  TaxCategory,
  SavedCsvMapping,
} from './types'
import { uid } from './seed'

export interface AppState {
  // Data collections
  accounts: Account[]
  positions: Position[]
  closedPositions: ClosedPosition[]
  transactions: Transaction[]
  snapshots: PortfolioSnapshot[]
  csvMappings: SavedCsvMapping[]
  customInstitutions: string[]

  // UI state
  view: 'settings' | 'accounts'
  sortKey: keyof Position
  sortDir: 'asc' | 'desc'
  txTypeFilter: string // 'All' or specific type like 'Buy'
  txSearch: string // search text for transactions
  selectedAccountId: string | null // selected account on AccountsPage
  selectedCategoryKey: TaxCategory | 'closedPositions' | null // selected category on AccountsPage
  expandedCategories: Record<string, boolean> // category expansion state
  acctAssetClassFilter: string // asset class filter on AccountsPage
  acctPosSearch: string // position search text on AccountsPage
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
export function setView(state: AppState, view: 'settings' | 'accounts'): AppState {
  return {
    ...state,
    view,
  }
}

