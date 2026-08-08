import type { AppState } from './state'
import * as StateActions from './state'
import { finalizeNewAccount } from './accounts'
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

    case 'FINALIZE_NEW_ACCOUNT':
      return finalizeNewAccount(
        state,
        action.accountNumber,
        action.name,
        action.taxCategory,
        action.retirement
      )

    // Position management
    case 'UPDATE_POSITION':
      return StateActions.updatePosition(state, action.positionId, action.patch)

    case 'SET_ASSET_CLASS_OVERRIDE':
      return StateActions.updatePosition(state, action.positionId, {
        assetClassManualOverride: action.override || undefined,
      })

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

    // Import flow
    case 'SET_PENDING_IMPORT':
      return StateActions.setPendingImport(state, action.pendingImport)

    case 'CLEAR_IMPORT_DIALOG':
      return StateActions.setPendingImport(state, undefined)

    case 'SET_ACCOUNT_PROMPT_QUEUE':
      return StateActions.setAccountPromptQueue(state, action.accountPromptQueue)

    case 'IMPORT_POSITIONS':
      return importPositions(state, action.accountId, action.mappedRows, action.importDate)

    case 'IMPORT_TRANSACTIONS':
      return importTransactions(state, action.accountId, action.mappedRows)

    // Mapping profile management
    case 'ADD_MAPPING_PROFILE':
      return {
        ...state,
        mappingProfiles: [...state.mappingProfiles, action.profile],
      }

    case 'UPDATE_MAPPING_PROFILE':
      return {
        ...state,
        mappingProfiles: state.mappingProfiles.map((p) =>
          p.id === action.profileId ? action.profile : p
        ),
      }

    case 'DELETE_MAPPING_PROFILE':
      return {
        ...state,
        mappingProfiles: state.mappingProfiles.filter((p) => p.id !== action.profileId),
      }

    default:
      return state
  }
}
