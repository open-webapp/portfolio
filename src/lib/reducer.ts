import type { AppState } from './state'
import * as StateActions from './state'
import { importPositions } from './positionsImport'
import { importTransactions } from './transactionsImport'
import type { BalanceEntry, BudgetTransaction, Category, CategoryMapping, Expense } from './types'

export type AppAction =
  | { type: '__SET_STATE'; newState: AppState }
  | { type: 'ADD_ACCOUNT'; account: any }
  | { type: 'UPDATE_ACCOUNT'; accountId: string; patch: any }
  | { type: 'DELETE_ACCOUNT'; accountId: string }
  | { type: 'UPDATE_POSITION'; positionId: string; patch: any }
  | { type: 'SET_ASSET_CLASS_OVERRIDE'; positionId: string; override?: any }
  | { type: 'CLOSE_POSITION'; positionId: string }
  | { type: 'DELETE_CLOSED_POSITION'; id: string }
  | { type: 'RESTORE_CLOSED_POSITION'; closedPositionId: string; replaceExistingPositionId?: string }
  | { type: 'SET_SORT'; sortKey: any; sortDir: any }
  | { type: 'TOGGLE_SORT'; sortKey: any }
  | { type: 'SET_TRANSACTIONS_SEARCH'; search: string }
  | { type: 'SET_TRANSACTION_TYPE_FILTER'; filter: string }
  | { type: 'SET_VIEW'; view: any }
  | { type: 'IMPORT_POSITIONS'; accountId: string; mappedRows: any; importDate: any; mode: any }
  | { type: 'IMPORT_TRANSACTIONS'; accountId: string; mappedRows: any }
  | { type: 'UPSERT_CSV_MAPPING'; accountId: string; kind: any; fieldMap: any }
  | { type: 'ADD_CUSTOM_INSTITUTION'; name: string }
  | { type: 'SELECT_ACCOUNT'; accountId: string; categoryKey: string }
  | { type: 'CLEAR_ACCOUNT_SELECTION' }
  | { type: 'TOGGLE_CATEGORY_EXPANDED'; categoryKey: string }
  | { type: 'SET_ACCT_ASSET_CLASS_FILTER'; filter: string }
  | { type: 'SET_ACCT_POS_SEARCH'; search: string }
  | { type: 'SET_PRICE_SYNC_API_KEY'; apiKey: string }
  | { type: 'RECORD_PRICE_SYNC_RUN'; patch: any }
  | { type: 'SET_MUTUAL_FUND_SYNC_API_KEY'; apiKey: string }
  | { type: 'RECORD_MUTUAL_FUND_SYNC_RUN'; patch: any }
  | { type: 'ADD_BALANCE_ENTRIES'; entries: BalanceEntry[] }
  | { type: 'UPDATE_BALANCE_ENTRY'; entry: BalanceEntry }
  | { type: 'DELETE_BALANCE_ENTRY'; id: string }
  | { type: 'SET_REG_ACCOUNT'; accountId: string | null }
  | { type: 'TOGGLE_REG_CATEGORY_EXPANDED'; categoryKey: string }
  | { type: 'SET_REG_ACTIVITY_FILTER'; filter: string }
  | { type: 'SET_BUDGET_INCOME_MONTHLY'; amount: number }
  | { type: 'SET_BUDGET_INCOME_YEARLY'; amount: number }
  | { type: 'ADD_BUDGET_EXPENSE'; expense: Omit<Expense, 'id'> }
  | { type: 'UPDATE_BUDGET_EXPENSE'; id: string; patch: Partial<Omit<Expense, 'id'>> }
  | { type: 'DELETE_BUDGET_EXPENSE'; id: string }
  | { type: 'ADD_BUDGET_TRANSACTION'; tx: Omit<BudgetTransaction, 'id'> }
  | { type: 'UPDATE_BUDGET_TRANSACTION'; id: string; patch: Partial<Omit<BudgetTransaction, 'id'>> }
  | { type: 'DELETE_BUDGET_TRANSACTION'; id: string }
  | {
      type: 'IMPORT_BUDGET_TRANSACTIONS'
      rows: { date: string; description: string; amount: number; accountName?: string }[]
      categories: Category[]
      categoryMappings: CategoryMapping[]
    }
  | { type: 'SET_BUDGET_INCOME_FOR_PERIOD'; period: 'monthly' | 'yearly'; amount: number }
  | { type: 'REAPPLY_CATEGORY_MAPPINGS'; categoryMappings: CategoryMapping[] }

/**
 * Reducer function that handles all state mutations.
 * Converts action objects to state transformations.
 */
export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    // Direct state replacement (for AppState objects passed to dispatch)
    case '__SET_STATE':
      return action.newState

    // Account management
    case 'ADD_ACCOUNT':
      return StateActions.addAccount(state, action.account)

    case 'UPDATE_ACCOUNT':
      return StateActions.updateAccount(state, action.accountId, action.patch)

    case 'DELETE_ACCOUNT':
      return StateActions.deleteAccount(state, action.accountId)

    // Position management
    case 'UPDATE_POSITION':
      return StateActions.updatePosition(state, action.positionId, action.patch)

    case 'SET_ASSET_CLASS_OVERRIDE':
      return StateActions.updatePosition(state, action.positionId, {
        assetClassManualOverride: action.override || undefined,
      })

    case 'CLOSE_POSITION':
      return StateActions.closePosition(state, action.positionId)

    case 'DELETE_CLOSED_POSITION':
      return StateActions.deleteClosedPosition(state, action.id)

    case 'RESTORE_CLOSED_POSITION':
      return StateActions.restoreClosedPosition(state, action.closedPositionId, action.replaceExistingPositionId)

    // Filters
    case 'SET_SORT':
      return StateActions.setSort(state, action.sortKey, action.sortDir)

    case 'TOGGLE_SORT':
      return StateActions.toggleSort(state, action.sortKey)

    case 'SET_TRANSACTIONS_SEARCH':
      return StateActions.setTransactionsSearch(state, action.search)

    case 'SET_TRANSACTION_TYPE_FILTER':
      return StateActions.setTransactionTypeFilter(state, action.filter)

    case 'SET_VIEW':
      return StateActions.setView(state, action.view)

    // Import flow
    case 'IMPORT_POSITIONS':
      return importPositions(
        state,
        action.accountId,
        action.mappedRows,
        action.importDate,
        action.mode
      )

    case 'IMPORT_TRANSACTIONS':
      return importTransactions(state, action.accountId, action.mappedRows)

    case 'UPSERT_CSV_MAPPING':
      return StateActions.upsertCsvMapping(state, action.accountId, action.kind, action.fieldMap)

    case 'ADD_CUSTOM_INSTITUTION':
      return StateActions.addCustomInstitution(state, action.name)

    case 'SELECT_ACCOUNT':
      return StateActions.selectAccount(state, action.accountId, action.categoryKey as any)

    case 'CLEAR_ACCOUNT_SELECTION':
      return StateActions.clearAccountSelection(state)

    case 'TOGGLE_CATEGORY_EXPANDED':
      return StateActions.toggleCategoryExpanded(state, action.categoryKey)

    case 'SET_ACCT_ASSET_CLASS_FILTER':
      return StateActions.setAcctAssetClassFilter(state, action.filter)

    case 'SET_ACCT_POS_SEARCH':
      return StateActions.setAcctPosSearch(state, action.search)

    // Price sync
    case 'SET_PRICE_SYNC_API_KEY':
      return StateActions.setPriceSyncApiKey(state, action.apiKey)

    case 'RECORD_PRICE_SYNC_RUN':
      return StateActions.recordPriceSyncRun(state, action.patch)

    case 'SET_MUTUAL_FUND_SYNC_API_KEY':
      return StateActions.setMutualFundSyncApiKey(state, action.apiKey)

    case 'RECORD_MUTUAL_FUND_SYNC_RUN':
      return StateActions.recordMutualFundSyncRun(state, action.patch)

    // Register page
    case 'ADD_BALANCE_ENTRIES':
      return StateActions.addBalanceEntries(state, action.entries)

    case 'UPDATE_BALANCE_ENTRY':
      return StateActions.updateBalanceEntry(state, action.entry)

    case 'DELETE_BALANCE_ENTRY':
      return StateActions.deleteBalanceEntry(state, action.id)

    case 'SET_REG_ACCOUNT':
      return StateActions.setRegAccount(state, action.accountId)

    case 'TOGGLE_REG_CATEGORY_EXPANDED':
      return StateActions.toggleRegCategoryExpanded(state, action.categoryKey)

    case 'SET_REG_ACTIVITY_FILTER':
      return StateActions.setRegActivityFilter(state, action.filter)

    // Budget page
    case 'SET_BUDGET_INCOME_MONTHLY':
      return StateActions.setBudgetIncomeMonthly(state, action.amount)

    case 'SET_BUDGET_INCOME_YEARLY':
      return StateActions.setBudgetIncomeYearly(state, action.amount)

    case 'ADD_BUDGET_EXPENSE':
      return StateActions.addBudgetExpense(state, action.expense)

    case 'UPDATE_BUDGET_EXPENSE':
      return StateActions.updateBudgetExpense(state, action.id, action.patch)

    case 'DELETE_BUDGET_EXPENSE':
      return StateActions.deleteBudgetExpense(state, action.id)

    case 'ADD_BUDGET_TRANSACTION':
      return StateActions.addBudgetTransaction(state, action.tx)

    case 'UPDATE_BUDGET_TRANSACTION':
      return StateActions.updateBudgetTransaction(state, action.id, action.patch)

    case 'DELETE_BUDGET_TRANSACTION':
      return StateActions.deleteBudgetTransaction(state, action.id)

    case 'IMPORT_BUDGET_TRANSACTIONS':
      return StateActions.importBudgetTransactions(state, action.rows, action.categories, action.categoryMappings)

    case 'SET_BUDGET_INCOME_FOR_PERIOD':
      return StateActions.setBudgetIncomeForPeriod(state, action.period, action.amount)

    case 'REAPPLY_CATEGORY_MAPPINGS':
      return StateActions.reapplyCategoryMappingsToState(state, action.categoryMappings)

    default:
      return state
  }
}
