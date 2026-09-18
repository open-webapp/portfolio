import { describe, it, expect } from 'vitest'
import { appReducer } from './reducer'
import {
  closePosition,
  restoreClosedPosition,
  clearAccountSelection,
  initialState,
  setPriceSyncApiKey,
  recordPriceSyncRun,
  setMutualFundSyncApiKey,
  recordMutualFundSyncRun,
  addBalanceEntries,
  updateBalanceEntry,
  deleteBalanceEntry,
  setRegAccount,
  toggleRegCategoryExpanded,
  setRegActivityFilter,
  setBudgetIncome,
  addBudgetExpense,
  updateBudgetExpense,
  deleteBudgetExpense,
  rolloverBudgetExpensesIfNeeded,
  rolloverBudgetIncomeIfNeeded,
  currentBudgetYear,
  addBudgetTransaction,
  updateBudgetTransaction,
  updateBudgetTransactionsBulk,
  deleteBudgetTransaction,
  importBudgetTransactions,
  reapplyCategoryMappingsToState,
} from './state'
import type { AppState, BalanceEntry, Category, CategoryMapping } from './types'

describe('appReducer', () => {
  describe('CLOSE_POSITION', () => {
    it('dispatches to closePosition state action', () => {
      const state: AppState = {
        ...initialState(),
        accounts: [
          {
            id: 'acc1',
            accountNumber: '123456',
            name: 'Test Account',
            institution: 'Test Bank',
            retirement: false,
            createdAt: '2024-01-01T10:00:00Z',
          },
        ],
        positions: [
          {
            id: 'pos1',
            accountId: 'acc1',
            symbol: 'AAPL',
            name: 'Apple Inc.',
            assetClass: 'Equity',
            shares: 100,
            avgCost: 150,
            price: 180,
            lastImportedAt: '2024-01-01T10:00:00Z',
          },
        ],
      }

      // Dispatch via reducer
      const resultFromReducer = appReducer(state, { type: 'CLOSE_POSITION', positionId: 'pos1' })

      // Call closePosition directly
      const resultDirect = closePosition(state, 'pos1')

      // Both should produce equivalent results (same data, even if generated IDs differ)
      expect(resultFromReducer.positions).toEqual(resultDirect.positions)
      expect(resultFromReducer.closedPositions).toHaveLength(resultDirect.closedPositions.length)
      expect(resultFromReducer.closedPositions).toHaveLength(1)

      // Check the closed position properties match
      const closedFromReducer = resultFromReducer.closedPositions[0]
      const closedDirect = resultDirect.closedPositions[0]

      expect(closedFromReducer.accountId).toBe(closedDirect.accountId)
      expect(closedFromReducer.symbol).toBe(closedDirect.symbol)
      expect(closedFromReducer.name).toBe(closedDirect.name)
      expect(closedFromReducer.assetClass).toBe(closedDirect.assetClass)
      expect(closedFromReducer.realizedGL).toBe(closedDirect.realizedGL)
      expect(closedFromReducer.realizedGLBasis).toBe(closedDirect.realizedGLBasis)
      expect(closedFromReducer.closedDate).toBe(closedDirect.closedDate)
    })
  })

  describe('RESTORE_CLOSED_POSITION', () => {
    const baseState: AppState = {
      ...initialState(),
      accounts: [
        {
          id: 'acc1',
          accountNumber: '123456',
          name: 'Test Account',
          institution: 'Test Bank',
          retirement: false,
          createdAt: '2024-01-01T10:00:00Z',
        },
      ],
      closedPositions: [
        {
          id: 'cp1',
          accountId: 'acc1',
          symbol: 'AAPL',
          name: 'Apple Inc.',
          closedDate: '2024-02-01',
          assetClass: 'Equity',
          shares: 100,
          avgCost: 150,
          price: 180,
          lastImportedAt: '2024-01-01T10:00:00Z',
          realizedGL: null,
          realizedGLBasis: 'unknown',
        },
      ],
    }

    it('dispatches to restoreClosedPosition state action', () => {
      const resultFromReducer = appReducer(baseState, {
        type: 'RESTORE_CLOSED_POSITION',
        closedPositionId: 'cp1',
      })

      const resultDirect = restoreClosedPosition(baseState, 'cp1')

      expect(resultFromReducer.closedPositions).toEqual(resultDirect.closedPositions)
      expect(resultFromReducer.closedPositions).toHaveLength(0)
      expect(resultFromReducer.positions).toHaveLength(1)
      expect(resultFromReducer.positions).toHaveLength(resultDirect.positions.length)

      const restoredFromReducer = resultFromReducer.positions[0]
      const restoredDirect = resultDirect.positions[0]

      expect(restoredFromReducer.accountId).toBe(restoredDirect.accountId)
      expect(restoredFromReducer.symbol).toBe(restoredDirect.symbol)
      expect(restoredFromReducer.name).toBe(restoredDirect.name)
      expect(restoredFromReducer.assetClass).toBe(restoredDirect.assetClass)
      expect(restoredFromReducer.shares).toBe(restoredDirect.shares)
      expect(restoredFromReducer.avgCost).toBe(restoredDirect.avgCost)
      expect(restoredFromReducer.price).toBe(restoredDirect.price)
    })

    it('dispatches with replaceExistingPositionId and replaces the matching position', () => {
      const stateWithExisting: AppState = {
        ...baseState,
        positions: [
          {
            id: 'pos-existing',
            accountId: 'acc1',
            symbol: 'AAPL',
            name: 'Apple Inc.',
            assetClass: 'Equity',
            shares: 5,
            avgCost: 200,
            price: 210,
            lastImportedAt: '2024-01-15T10:00:00Z',
          },
        ],
      }

      const resultFromReducer = appReducer(stateWithExisting, {
        type: 'RESTORE_CLOSED_POSITION',
        closedPositionId: 'cp1',
        replaceExistingPositionId: 'pos-existing',
      })

      const resultDirect = restoreClosedPosition(stateWithExisting, 'cp1', 'pos-existing')

      expect(resultFromReducer.positions).toHaveLength(resultDirect.positions.length)
      expect(resultFromReducer.positions).toHaveLength(1)
      expect(resultFromReducer.positions.find((p) => p.id === 'pos-existing')).toBeUndefined()
      expect(resultFromReducer.positions[0].symbol).toBe(resultDirect.positions[0].symbol)
      expect(resultFromReducer.positions[0].shares).toBe(resultDirect.positions[0].shares)
      expect(resultFromReducer.positions[0].symbol).toBe('AAPL')
      expect(resultFromReducer.positions[0].shares).toBe(100)
      expect(resultFromReducer.closedPositions).toHaveLength(0)
    })
  })

  describe('SELECT_ACCOUNT', () => {
    it('sets selectedAccountId and selectedCategoryKey from action', () => {
      const state: AppState = { ...initialState(), selectedAccountId: null, selectedCategoryKey: null }

      const result = appReducer(state, { type: 'SELECT_ACCOUNT', accountId: 'acc1', categoryKey: 'taxable' })

      expect(result.selectedAccountId).toBe('acc1')
      expect(result.selectedCategoryKey).toBe('taxable')
    })

    it('toggles both to null when selecting the same account and category twice', () => {
      const state: AppState = { ...initialState(), selectedAccountId: 'acc1', selectedCategoryKey: 'taxable' }

      const result = appReducer(state, { type: 'SELECT_ACCOUNT', accountId: 'acc1', categoryKey: 'taxable' })

      expect(result.selectedAccountId).toBeNull()
      expect(result.selectedCategoryKey).toBeNull()
    })
  })

  describe('CLEAR_ACCOUNT_SELECTION', () => {
    it('clears selectedAccountId and selectedCategoryKey to null', () => {
      const state: AppState = { ...initialState(), selectedAccountId: 'acc1', selectedCategoryKey: 'taxable' }

      const resultFromReducer = appReducer(state, { type: 'CLEAR_ACCOUNT_SELECTION' })
      const resultDirect = clearAccountSelection(state)

      expect(resultFromReducer.selectedAccountId).toBeNull()
      expect(resultFromReducer.selectedCategoryKey).toBeNull()
      expect(resultFromReducer).toEqual(resultDirect)
    })

    it('is a no-op when nothing is selected', () => {
      const state: AppState = { ...initialState(), selectedAccountId: null, selectedCategoryKey: null }

      const result = appReducer(state, { type: 'CLEAR_ACCOUNT_SELECTION' })

      expect(result.selectedAccountId).toBeNull()
      expect(result.selectedCategoryKey).toBeNull()
    })
  })

  describe('TOGGLE_CATEGORY_EXPANDED', () => {
    it('toggles category expansion for named key', () => {
      const state: AppState = { ...initialState(), expandedCategories: { categoryA: false } }

      const result = appReducer(state, { type: 'TOGGLE_CATEGORY_EXPANDED', categoryKey: 'categoryA' })

      expect(result.expandedCategories.categoryA).toBe(true)
    })

    it('leaves unrelated keys untouched', () => {
      const state: AppState = {
        ...initialState(),
        expandedCategories: { categoryA: true, categoryB: false },
      }

      const result = appReducer(state, { type: 'TOGGLE_CATEGORY_EXPANDED', categoryKey: 'categoryA' })

      expect(result.expandedCategories.categoryA).toBe(false)
      expect(result.expandedCategories.categoryB).toBe(false)
    })
  })

  describe('SET_ACCT_ASSET_CLASS_FILTER', () => {
    it('sets acctAssetClassFilter from action.filter', () => {
      const state: AppState = { ...initialState(), acctAssetClassFilter: 'All' }

      const result = appReducer(state, { type: 'SET_ACCT_ASSET_CLASS_FILTER', filter: 'Bond' })

      expect(result.acctAssetClassFilter).toBe('Bond')
    })
  })

  describe('SET_ACCT_POS_SEARCH', () => {
    it('sets acctPosSearch from action.search', () => {
      const state: AppState = { ...initialState(), acctPosSearch: '' }

      const result = appReducer(state, { type: 'SET_ACCT_POS_SEARCH', search: 'AAPL' })

      expect(result.acctPosSearch).toBe('AAPL')
    })
  })

  describe('SET_PRICE_SYNC_API_KEY', () => {
    it('dispatches to setPriceSyncApiKey state action', () => {
      const state: AppState = { ...initialState() }

      const resultFromReducer = appReducer(state, { type: 'SET_PRICE_SYNC_API_KEY', apiKey: 'x' })
      const resultDirect = setPriceSyncApiKey(state, 'x')

      expect(resultFromReducer.priceSync).toEqual(resultDirect.priceSync)
      expect(resultFromReducer.priceSync.apiKey).toBe('x')
    })
  })

  describe('RECORD_PRICE_SYNC_RUN', () => {
    it('dispatches to recordPriceSyncRun state action', () => {
      const state: AppState = { ...initialState() }
      const patch = {
        lastFetchedDate: '2024-02-01',
        heldPrices: { AAPL: { price: 190, date: '2024-02-01', fetchedAt: '2024-02-01T10:00:00Z' } },
        lastRun: { at: '2024-02-01T10:00:00Z', updatedCount: 1, notFound: [], marketTickerCount: 1 },
      }

      const resultFromReducer = appReducer(state, { type: 'RECORD_PRICE_SYNC_RUN', patch })
      const resultDirect = recordPriceSyncRun(state, patch)

      expect(resultFromReducer.priceSync).toEqual(resultDirect.priceSync)
    })
  })

  describe('SET_MUTUAL_FUND_SYNC_API_KEY', () => {
    it('dispatches to setMutualFundSyncApiKey state action', () => {
      const state: AppState = { ...initialState() }

      const resultFromReducer = appReducer(state, { type: 'SET_MUTUAL_FUND_SYNC_API_KEY', apiKey: 'x' })
      const resultDirect = setMutualFundSyncApiKey(state, 'x')

      expect(resultFromReducer.mutualFundSync).toEqual(resultDirect.mutualFundSync)
      expect(resultFromReducer.mutualFundSync.apiKey).toBe('x')
    })
  })

  describe('RECORD_MUTUAL_FUND_SYNC_RUN', () => {
    it('dispatches to recordMutualFundSyncRun state action', () => {
      const state: AppState = { ...initialState() }
      const patch = {
        heldPrices: { VFIAX: { price: 450, date: '2024-02-01', fetchedAt: '2024-02-01T10:00:00Z' } },
        lastRun: { at: '2024-02-01T10:00:00Z', updatedCount: 1, notFound: [], marketTickerCount: 1 },
        callBudget: { date: '2024-02-01', callsUsed: 1 },
      }

      const resultFromReducer = appReducer(state, { type: 'RECORD_MUTUAL_FUND_SYNC_RUN', patch })
      const resultDirect = recordMutualFundSyncRun(state, patch)

      expect(resultFromReducer.mutualFundSync).toEqual(resultDirect.mutualFundSync)
    })
  })

  describe('ADD_BALANCE_ENTRIES', () => {
    it('dispatches to addBalanceEntries state action', () => {
      const state: AppState = { ...initialState() }
      const entries: BalanceEntry[] = [
        {
          id: 'be1',
          accountId: 'acc1',
          date: '2024-02-01',
          balance: 1000,
          activityType: 'Contribution',
          activityAmount: 100,
          note: '',
        },
      ]

      const resultFromReducer = appReducer(state, { type: 'ADD_BALANCE_ENTRIES', entries })
      const resultDirect = addBalanceEntries(state, entries)

      expect(resultFromReducer.balanceEntries).toEqual(resultDirect.balanceEntries)
      expect(resultFromReducer.balanceEntries).toHaveLength(1)
    })
  })

  describe('UPDATE_BALANCE_ENTRY', () => {
    it('dispatches to updateBalanceEntry state action for an existing id', () => {
      const state: AppState = {
        ...initialState(),
        balanceEntries: [
          {
            id: 'be1',
            accountId: 'acc1',
            date: '2024-02-01',
            balance: 1000,
            activityType: 'None',
            activityAmount: 0,
            note: '',
          },
        ],
      }
      const entry: BalanceEntry = {
        id: 'be1',
        accountId: 'acc1',
        date: '2024-02-01',
        balance: 2000,
        activityType: 'Contribution',
        activityAmount: 1000,
        note: 'updated',
      }

      const resultFromReducer = appReducer(state, { type: 'UPDATE_BALANCE_ENTRY', entry })
      const resultDirect = updateBalanceEntry(state, entry)

      expect(resultFromReducer.balanceEntries).toEqual(resultDirect.balanceEntries)
      expect(resultFromReducer.balanceEntries).toHaveLength(1)
      expect(resultFromReducer.balanceEntries[0].balance).toBe(2000)
    })

    it('appends the entry when the id does not exist in state', () => {
      const state: AppState = {
        ...initialState(),
        balanceEntries: [
          {
            id: 'be1',
            accountId: 'acc1',
            date: '2024-02-01',
            balance: 1000,
            activityType: 'None',
            activityAmount: 0,
            note: '',
          },
        ],
      }
      const entry: BalanceEntry = {
        id: 'be2',
        accountId: 'acc1',
        date: '2024-03-01',
        balance: 3000,
        activityType: 'None',
        activityAmount: 0,
        note: '',
      }

      const resultFromReducer = appReducer(state, { type: 'UPDATE_BALANCE_ENTRY', entry })
      const resultDirect = updateBalanceEntry(state, entry)

      expect(resultFromReducer.balanceEntries).toEqual(resultDirect.balanceEntries)
      expect(resultFromReducer.balanceEntries).toHaveLength(2)
    })
  })

  describe('DELETE_BALANCE_ENTRY', () => {
    it('dispatches to deleteBalanceEntry state action', () => {
      const state: AppState = {
        ...initialState(),
        balanceEntries: [
          {
            id: 'be1',
            accountId: 'acc1',
            date: '2024-02-01',
            balance: 1000,
            activityType: 'None',
            activityAmount: 0,
            note: '',
          },
        ],
      }

      const resultFromReducer = appReducer(state, { type: 'DELETE_BALANCE_ENTRY', id: 'be1' })
      const resultDirect = deleteBalanceEntry(state, 'be1')

      expect(resultFromReducer.balanceEntries).toEqual(resultDirect.balanceEntries)
      expect(resultFromReducer.balanceEntries).toHaveLength(0)
    })
  })

  describe('SET_REG_ACCOUNT', () => {
    it('dispatches to setRegAccount state action', () => {
      const state: AppState = { ...initialState(), regAccountId: null }

      const resultFromReducer = appReducer(state, { type: 'SET_REG_ACCOUNT', accountId: 'acc1' })
      const resultDirect = setRegAccount(state, 'acc1')

      expect(resultFromReducer.regAccountId).toBe(resultDirect.regAccountId)
      expect(resultFromReducer.regAccountId).toBe('acc1')
    })

    it('supports clearing to null', () => {
      const state: AppState = { ...initialState(), regAccountId: 'acc1' }

      const resultFromReducer = appReducer(state, { type: 'SET_REG_ACCOUNT', accountId: null })
      const resultDirect = setRegAccount(state, null)

      expect(resultFromReducer.regAccountId).toBe(resultDirect.regAccountId)
      expect(resultFromReducer.regAccountId).toBeNull()
    })
  })

  describe('TOGGLE_REG_CATEGORY_EXPANDED', () => {
    it('dispatches to toggleRegCategoryExpanded state action', () => {
      const state: AppState = { ...initialState(), regExpanded: { categoryA: false } }

      const resultFromReducer = appReducer(state, { type: 'TOGGLE_REG_CATEGORY_EXPANDED', categoryKey: 'categoryA' })
      const resultDirect = toggleRegCategoryExpanded(state, 'categoryA')

      expect(resultFromReducer.regExpanded).toEqual(resultDirect.regExpanded)
      expect(resultFromReducer.regExpanded.categoryA).toBe(true)
    })
  })

  describe('SET_REG_ACTIVITY_FILTER', () => {
    it('dispatches to setRegActivityFilter state action', () => {
      const state: AppState = { ...initialState(), regActivityFilter: 'All' }

      const resultFromReducer = appReducer(state, { type: 'SET_REG_ACTIVITY_FILTER', filter: 'With Activity' })
      const resultDirect = setRegActivityFilter(state, 'With Activity')

      expect(resultFromReducer.regActivityFilter).toBe(resultDirect.regActivityFilter)
      expect(resultFromReducer.regActivityFilter).toBe('With Activity')
    })
  })

  describe('ADD_BUDGET_EXPENSE', () => {
    it('mutates only the given year, leaving another pre-existing year untouched', () => {
      const state: AppState = {
        ...initialState(),
        budgetExpensesByYear: {
          '2025': [{ id: 'exp-2025', name: 'Old Rent', categoryId: 'cat-Housing', amount: 1800, frequency: 'monthly' }],
          '2026': [],
        },
      }
      const expense = { name: 'Rent', categoryId: 'cat-Housing', amount: 2000, frequency: 'monthly' as const }

      const resultFromReducer = appReducer(state, { type: 'ADD_BUDGET_EXPENSE', year: '2026', expense })
      const resultDirect = addBudgetExpense(state, '2026', expense)

      expect(resultFromReducer.budgetExpensesByYear['2026']).toHaveLength(1)
      expect(resultFromReducer.budgetExpensesByYear['2026']).toHaveLength(
        resultDirect.budgetExpensesByYear['2026'].length
      )
      expect(resultFromReducer.budgetExpensesByYear['2025']).toEqual(state.budgetExpensesByYear['2025'])

      const fromReducer = resultFromReducer.budgetExpensesByYear['2026'][0]
      const direct = resultDirect.budgetExpensesByYear['2026'][0]

      expect(fromReducer.name).toBe(direct.name)
      expect(fromReducer.categoryId).toBe(direct.categoryId)
      expect(fromReducer.amount).toBe(direct.amount)
      expect(fromReducer.frequency).toBe(direct.frequency)
      expect(typeof fromReducer.id).toBe('string')
      expect(fromReducer.id.length).toBeGreaterThan(0)
    })
  })

  describe('UPDATE_BUDGET_EXPENSE', () => {
    it('mutates only the given year, leaving another pre-existing year untouched', () => {
      const state: AppState = {
        ...initialState(),
        budgetExpensesByYear: {
          '2025': [{ id: 'exp-2025', name: 'Old Rent', categoryId: 'cat-Housing', amount: 1800, frequency: 'monthly' }],
          '2026': [{ id: 'exp1', name: 'Rent', categoryId: 'cat-Housing', amount: 2000, frequency: 'monthly' }],
        },
      }
      const patch = { amount: 2200 }

      const resultFromReducer = appReducer(state, { type: 'UPDATE_BUDGET_EXPENSE', year: '2026', id: 'exp1', patch })
      const resultDirect = updateBudgetExpense(state, '2026', 'exp1', patch)

      expect(resultFromReducer.budgetExpensesByYear['2026']).toEqual(resultDirect.budgetExpensesByYear['2026'])
      expect(resultFromReducer.budgetExpensesByYear['2026'][0].amount).toBe(2200)
      expect(resultFromReducer.budgetExpensesByYear['2025']).toEqual(state.budgetExpensesByYear['2025'])
    })

    it('is a no-op when the id does not exist, matching the direct call', () => {
      const state: AppState = {
        ...initialState(),
        budgetExpensesByYear: {
          '2026': [{ id: 'exp1', name: 'Rent', categoryId: 'cat-Housing', amount: 2000, frequency: 'monthly' }],
        },
      }
      const patch = { amount: 999 }

      const resultFromReducer = appReducer(state, { type: 'UPDATE_BUDGET_EXPENSE', year: '2026', id: 'missing', patch })
      const resultDirect = updateBudgetExpense(state, '2026', 'missing', patch)

      expect(resultFromReducer.budgetExpensesByYear['2026']).toEqual(resultDirect.budgetExpensesByYear['2026'])
      expect(resultFromReducer.budgetExpensesByYear['2026'][0].amount).toBe(2000)
    })
  })

  describe('DELETE_BUDGET_EXPENSE', () => {
    it('mutates only the given year, leaving another pre-existing year untouched', () => {
      const state: AppState = {
        ...initialState(),
        budgetExpensesByYear: {
          '2025': [{ id: 'exp-2025', name: 'Old Rent', categoryId: 'cat-Housing', amount: 1800, frequency: 'monthly' }],
          '2026': [{ id: 'exp1', name: 'Rent', categoryId: 'cat-Housing', amount: 2000, frequency: 'monthly' }],
        },
      }

      const resultFromReducer = appReducer(state, { type: 'DELETE_BUDGET_EXPENSE', year: '2026', id: 'exp1' })
      const resultDirect = deleteBudgetExpense(state, '2026', 'exp1')

      expect(resultFromReducer.budgetExpensesByYear['2026']).toEqual(resultDirect.budgetExpensesByYear['2026'])
      expect(resultFromReducer.budgetExpensesByYear['2026']).toHaveLength(0)
      expect(resultFromReducer.budgetExpensesByYear['2025']).toEqual(state.budgetExpensesByYear['2025'])
    })
  })

  describe('SET_BUDGET_INCOME', () => {
    it('mutates only the given year, leaving another pre-existing year untouched', () => {
      const state: AppState = {
        ...initialState(),
        budgetIncomeByYear: {
          '2025': { monthly: 4000, yearly: 48000 },
          '2026': { monthly: 0, yearly: 0 },
        },
      }

      const resultFromReducer = appReducer(state, {
        type: 'SET_BUDGET_INCOME',
        year: '2026',
        patch: { monthly: 5000 },
      })
      const resultDirect = setBudgetIncome(state, '2026', { monthly: 5000 })

      expect(resultFromReducer.budgetIncomeByYear['2026']).toEqual(resultDirect.budgetIncomeByYear['2026'])
      expect(resultFromReducer.budgetIncomeByYear['2026'].monthly).toBe(5000)
      expect(resultFromReducer.budgetIncomeByYear['2025']).toEqual(state.budgetIncomeByYear['2025'])
    })

    it('clamps negative amounts to 0, matching the direct call', () => {
      const state: AppState = {
        ...initialState(),
        budgetIncomeByYear: { '2026': { monthly: 100, yearly: 1200 } },
      }

      const resultFromReducer = appReducer(state, {
        type: 'SET_BUDGET_INCOME',
        year: '2026',
        patch: { monthly: -50 },
      })
      const resultDirect = setBudgetIncome(state, '2026', { monthly: -50 })

      expect(resultFromReducer.budgetIncomeByYear['2026']).toEqual(resultDirect.budgetIncomeByYear['2026'])
      expect(resultFromReducer.budgetIncomeByYear['2026'].monthly).toBe(0)
    })
  })

  describe('ROLLOVER_BUDGET_EXPENSES_IF_NEEDED', () => {
    it('seeds the current year from the prior year when missing', () => {
      const thisYear = currentBudgetYear()
      const priorYear = String(Number(thisYear) - 1)
      const state: AppState = {
        ...initialState(),
        budgetExpensesByYear: {
          [priorYear]: [{ id: 'exp1', name: 'Rent', categoryId: 'cat-Housing', amount: 2000, frequency: 'monthly' }],
        },
      }

      const resultFromReducer = appReducer(state, { type: 'ROLLOVER_BUDGET_EXPENSES_IF_NEEDED' })
      const resultDirect = rolloverBudgetExpensesIfNeeded(state)

      expect(resultFromReducer).toEqual(resultDirect)
      expect(resultFromReducer.budgetExpensesByYear[thisYear]).toBeDefined()
      expect(resultFromReducer.budgetExpensesByYear[thisYear]).toEqual(state.budgetExpensesByYear[priorYear])
    })
  })

  describe('ROLLOVER_BUDGET_INCOME_IF_NEEDED', () => {
    it('seeds the current year from the prior year when missing', () => {
      const thisYear = currentBudgetYear()
      const priorYear = String(Number(thisYear) - 1)
      const state: AppState = {
        ...initialState(),
        budgetIncomeByYear: { [priorYear]: { monthly: 5000, yearly: 60000 } },
      }

      const resultFromReducer = appReducer(state, { type: 'ROLLOVER_BUDGET_INCOME_IF_NEEDED' })
      const resultDirect = rolloverBudgetIncomeIfNeeded(state)

      expect(resultFromReducer).toEqual(resultDirect)
      expect(resultFromReducer.budgetIncomeByYear[thisYear]).toBeDefined()
      expect(resultFromReducer.budgetIncomeByYear[thisYear]).toEqual(state.budgetIncomeByYear[priorYear])
    })
  })

  describe('ADD_BUDGET_TRANSACTION', () => {
    it('dispatches to addBudgetTransaction state action', () => {
      const state: AppState = { ...initialState(), budgetTransactions: [] }
      const tx = { date: '2026-01-15', description: 'Groceries', categoryId: 'cat-Food', amount: 85.5 }

      const resultFromReducer = appReducer(state, { type: 'ADD_BUDGET_TRANSACTION', tx })
      const resultDirect = addBudgetTransaction(state, tx)

      expect(resultFromReducer.budgetTransactions).toHaveLength(1)
      expect(resultFromReducer.budgetTransactions).toHaveLength(resultDirect.budgetTransactions.length)

      const fromReducer = resultFromReducer.budgetTransactions[0]
      const direct = resultDirect.budgetTransactions[0]

      expect(fromReducer.date).toBe(direct.date)
      expect(fromReducer.description).toBe(direct.description)
      expect(fromReducer.categoryId).toBe(direct.categoryId)
      expect(fromReducer.amount).toBe(direct.amount)
      expect(typeof fromReducer.id).toBe('string')
      expect(fromReducer.id.length).toBeGreaterThan(0)
    })
  })

  describe('UPDATE_BUDGET_TRANSACTION', () => {
    it('dispatches to updateBudgetTransaction state action for an existing id', () => {
      const state: AppState = {
        ...initialState(),
        budgetTransactions: [{ id: 'tx1', date: '2026-01-15', description: 'Groceries', categoryId: 'cat-Food', amount: 85.5 }],
      }
      const patch = { amount: 90 }

      const resultFromReducer = appReducer(state, { type: 'UPDATE_BUDGET_TRANSACTION', id: 'tx1', patch })
      const resultDirect = updateBudgetTransaction(state, 'tx1', patch)

      expect(resultFromReducer.budgetTransactions).toEqual(resultDirect.budgetTransactions)
      expect(resultFromReducer.budgetTransactions[0].amount).toBe(90)
    })
  })

  describe('UPDATE_BUDGET_TRANSACTIONS_BULK', () => {
    it('dispatches to updateBudgetTransactionsBulk state action for matching ids', () => {
      const state: AppState = {
        ...initialState(),
        budgetTransactions: [
          { id: 'tx1', date: '2026-01-15', description: 'Groceries', categoryId: 'cat-Food', amount: 85.5 },
          { id: 'tx2', date: '2026-01-16', description: 'Gas', categoryId: 'cat-Auto', amount: 40 },
        ],
      }

      const resultFromReducer = appReducer(state, {
        type: 'UPDATE_BUDGET_TRANSACTIONS_BULK',
        ids: ['tx1', 'tx2'],
        categoryId: 'cat-Misc',
        spendExpenseId: 'exp-misc',
      })
      const resultDirect = updateBudgetTransactionsBulk(state, ['tx1', 'tx2'], {
        categoryId: 'cat-Misc',
        spendExpenseId: 'exp-misc',
      })

      expect(resultFromReducer.budgetTransactions).toEqual(resultDirect.budgetTransactions)
      expect(resultFromReducer.budgetTransactions[0].categoryId).toBe('cat-Misc')
      expect(resultFromReducer.budgetTransactions[1].categoryId).toBe('cat-Misc')
    })
  })

  describe('DELETE_BUDGET_TRANSACTION', () => {
    it('dispatches to deleteBudgetTransaction state action', () => {
      const state: AppState = {
        ...initialState(),
        budgetTransactions: [{ id: 'tx1', date: '2026-01-15', description: 'Groceries', categoryId: 'cat-Food', amount: 85.5 }],
      }

      const resultFromReducer = appReducer(state, { type: 'DELETE_BUDGET_TRANSACTION', id: 'tx1' })
      const resultDirect = deleteBudgetTransaction(state, 'tx1')

      expect(resultFromReducer.budgetTransactions).toEqual(resultDirect.budgetTransactions)
      expect(resultFromReducer.budgetTransactions).toHaveLength(0)
    })
  })

  describe('IMPORT_BUDGET_TRANSACTIONS', () => {
    it('dispatches to importBudgetTransactions state action', () => {
      const state: AppState = { ...initialState(), budgetTransactions: [] }
      const rows = [
        { date: '2026-01-15', description: 'Groceries', amount: 85.5 },
        { date: '2026-01-16', description: 'Gas', amount: 40 },
      ]
      const categories: Category[] = [{ id: 'cat-other', name: 'Other' }]
      const categoryMappings: CategoryMapping[] = []

      const resultFromReducer = appReducer(state, {
        type: 'IMPORT_BUDGET_TRANSACTIONS',
        rows,
        categories,
        categoryMappings,
      })
      const resultDirect = importBudgetTransactions(state, rows, categories, categoryMappings, state.budgetExpensesByYear)

      expect(resultFromReducer.budgetTransactions).toHaveLength(2)
      expect(resultFromReducer.budgetTransactions).toHaveLength(resultDirect.budgetTransactions.length)
      expect(resultFromReducer.budgetTransactions.map((t) => t.description)).toEqual(
        resultDirect.budgetTransactions.map((t) => t.description)
      )
    })
  })

  describe('REAPPLY_CATEGORY_MAPPINGS', () => {
    it('dispatches to reapplyCategoryMappingsToState state action, rewriting matching budgetTransactions', () => {
      const categoryMappings: CategoryMapping[] = [
        { id: 'catmap1', substring: 'STARBUCKS', categoryId: 'cat-coffee', updatedAt: '2026-01-01T00:00:00.000Z' },
      ]
      const state: AppState = {
        ...initialState(),
        budgetTransactions: [
          { id: 'tx1', date: '2026-01-15', description: 'STARBUCKS #123', categoryId: 'cat-uncategorized', amount: 5.5 },
          { id: 'tx2', date: '2026-01-16', description: 'GAS STATION', categoryId: 'cat-uncategorized', amount: 40 },
        ],
      }

      const resultFromReducer = appReducer(state, { type: 'REAPPLY_CATEGORY_MAPPINGS', categoryMappings })
      const resultDirect = reapplyCategoryMappingsToState(state, categoryMappings)

      expect(resultFromReducer.budgetTransactions).toEqual(resultDirect.budgetTransactions)
      expect(resultFromReducer.budgetTransactions.find((t) => t.id === 'tx1')?.categoryId).toBe('cat-coffee')
      expect(resultFromReducer.budgetTransactions.find((t) => t.id === 'tx2')?.categoryId).toBe('cat-uncategorized')
    })
  })
})
