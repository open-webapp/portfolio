import type {
  Account,
  Position,
  ClosedPosition,
  Transaction,
  PortfolioSnapshot,
  TaxCategory,
  ImportSession,
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
  importSessions: ImportSession[]
  csvMappings: SavedCsvMapping[]
  customInstitutions: string[]

  // UI state
  category: TaxCategory | 'all'
  range: string // e.g. '6m', '1y', 'ytd', 'all'
  tab: 'positions' | 'transactions'
  view: 'dashboard' | 'settings'
  sortKey: keyof Position
  sortDir: 'asc' | 'desc'
  assetClassFilter: string // 'All' or specific class
  retirementFilter: 'All' | 'Retirement' | 'Non-Retirement'
  posSearch: string // search text for positions
  txTypeFilter: string // 'All' or specific type like 'Buy'
  txSearch: string // search text for transactions
  showClosed: boolean // toggle closed positions table
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
    importSessions: [],
    csvMappings: [],
    customInstitutions: [],

    // UI state
    category: 'all',
    range: '1y',
    tab: 'positions',
    view: 'dashboard',
    sortKey: 'symbol',
    sortDir: 'asc',
    assetClassFilter: 'All',
    retirementFilter: 'All',
    posSearch: '',
    txTypeFilter: 'All',
    txSearch: '',
    showClosed: false,
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
    importSessions: state.importSessions
      .map((session) => ({
        ...session,
        accountIds: session.accountIds.filter((id) => id !== accountId),
      }))
      .filter((session) => session.accountIds.length > 0),
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
 * Set the category filter (to be implemented in reducer cases).
 */
export function setCategory(
  state: AppState,
  category: TaxCategory | 'all'
): AppState {
  return {
    ...state,
    category,
  }
}

/**
 * Set the date range filter (to be implemented in reducer cases).
 */
export function setRange(state: AppState, range: string): AppState {
  return {
    ...state,
    range,
  }
}

/**
 * Set the active tab (to be implemented in reducer cases).
 */
export function setTab(state: AppState, tab: 'positions' | 'transactions'): AppState {
  return {
    ...state,
    tab,
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
 * Set the asset class filter (to be implemented in reducer cases).
 */
export function setAssetClassFilter(state: AppState, filter: string): AppState {
  return {
    ...state,
    assetClassFilter: filter,
  }
}

/**
 * Set the retirement filter (to be implemented in reducer cases).
 */
export function setRetirementFilter(
  state: AppState,
  filter: 'All' | 'Retirement' | 'Non-Retirement'
): AppState {
  return {
    ...state,
    retirementFilter: filter,
  }
}

/**
 * Set the positions search text (to be implemented in reducer cases).
 */
export function setPositionsSearch(state: AppState, search: string): AppState {
  return {
    ...state,
    posSearch: search,
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
 * Toggle the closed positions visibility (to be implemented in reducer cases).
 */
export function toggleShowClosed(state: AppState): AppState {
  return {
    ...state,
    showClosed: !state.showClosed,
  }
}

/**
 * Add a new import session (to be implemented in reducer cases).
 * Prepends the session to the list (newest first), then caps at 50 sessions.
 */
export function addImportSession(state: AppState, session: ImportSession): AppState {
  return {
    ...state,
    importSessions: [session, ...state.importSessions].slice(0, 50),
  }
}

/**
 * Delete an import session by ID (to be implemented in reducer cases).
 * Removes the session entry and all data rows tagged with that sessionId.
 */
export function deleteImportSession(state: AppState, sessionId: string): AppState {
  return {
    ...state,
    positions: state.positions.filter((p) => p.importSessionId !== sessionId),
    closedPositions: state.closedPositions.filter((c) => c.importSessionId !== sessionId),
    transactions: state.transactions.filter((t) => t.importSessionId !== sessionId),
    snapshots: state.snapshots.filter((s) => s.importSessionId !== sessionId),
    importSessions: state.importSessions.filter((s) => s.id !== sessionId),
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
export function setView(state: AppState, view: 'dashboard' | 'settings'): AppState {
  return {
    ...state,
    view,
  }
}

