import type { AppState } from './state'
import * as StateActions from './state'
import { importPositions } from './positionsImport'
import { importTransactions } from './transactionsImport'

export interface Action {
  type: string
  [key: string]: any
}

/**
 * Reducer function that handles all state mutations.
 * Converts action objects to state transformations.
 */
export function appReducer(state: AppState, action: Action): AppState {
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

    // Filters
    case 'SET_CATEGORY':
      return StateActions.setCategory(state, action.category)

    case 'SET_RANGE':
      return StateActions.setRange(state, action.range)

    case 'SET_TAB':
      return StateActions.setTab(state, action.tab)

    case 'SET_SORT':
      return StateActions.setSort(state, action.sortKey, action.sortDir)

    case 'TOGGLE_SORT':
      return StateActions.toggleSort(state, action.sortKey)

    case 'SET_ASSET_CLASS_FILTER':
      return StateActions.setAssetClassFilter(state, action.filter)

    case 'SET_RETIREMENT_FILTER':
      return StateActions.setRetirementFilter(state, action.filter)

    case 'SET_POSITIONS_SEARCH':
      return StateActions.setPositionsSearch(state, action.search)

    case 'SET_TRANSACTIONS_SEARCH':
      return StateActions.setTransactionsSearch(state, action.search)

    case 'SET_TRANSACTION_TYPE_FILTER':
      return StateActions.setTransactionTypeFilter(state, action.filter)

    case 'TOGGLE_SHOW_CLOSED':
      return StateActions.toggleShowClosed(state)

    case 'SET_VIEW':
      return StateActions.setView(state, action.view)

    // Import flow
    case 'IMPORT_POSITIONS':
      return importPositions(state, action.accountId, action.mappedRows, action.importDate)

    case 'IMPORT_TRANSACTIONS':
      return importTransactions(state, action.accountId, action.mappedRows)

    case 'UPSERT_CSV_MAPPING':
      return StateActions.upsertCsvMapping(state, action.accountId, action.kind, action.fieldMap)

    case 'ADD_CUSTOM_INSTITUTION':
      return StateActions.addCustomInstitution(state, action.name)

    default:
      return state
  }
}
