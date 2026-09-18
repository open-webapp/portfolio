import { describe, it, expect } from 'vitest'
import {
  initialState,
  deleteAccount,
  upsertCsvMapping,
  setView,
  closePosition,
  selectAccount,
  clearAccountSelection,
  toggleCategoryExpanded,
  setAcctAssetClassFilter,
  setAcctPosSearch,
  setPriceSyncApiKey,
  recordPriceSyncRun,
  setMutualFundSyncApiKey,
  recordMutualFundSyncRun,
  addBalanceEntries,
  deleteBalanceEntry,
  updateBalanceEntry,
  setRegAccount,
  toggleRegCategoryExpanded,
  setRegActivityFilter,
  replaceImportedState,
  nearestBudgetExpensesYear,
  resolveBudgetExpensesForYear,
  resolveBudgetExpensesForAnalyticsYear,
  seedBudgetExpensesForYear,
  rolloverBudgetExpensesIfNeeded,
  addBudgetExpense,
  updateBudgetExpense,
  deleteBudgetExpense,
  nearestBudgetIncomeYear,
  resolveBudgetIncomeForYear,
  resolveBudgetIncomeForAnalyticsYear,
  seedBudgetIncomeForYear,
  rolloverBudgetIncomeIfNeeded,
  setBudgetIncome,
  addBudgetTransaction,
  updateBudgetTransaction,
  updateBudgetTransactionsBulk,
  deleteBudgetTransaction,
  importBudgetTransactions,
} from './state'
import type { AppState } from './types'
import type { BalanceEntry, Expense, BudgetTransaction, CategoryMapping, Category } from './types'
import type { ExportableState } from './importExport'

describe('state helpers', () => {
  describe('initialState', () => {
    it('selectedCategoryKey defaults to null', () => {
      const state = initialState()
      expect(state.selectedCategoryKey).toBeNull()
    })

    it('budget fields default to empty year-scoped maps and no transactions', () => {
      const state = initialState()
      expect(state.budgetIncomeByYear).toEqual({})
      expect(state.budgetExpensesByYear).toEqual({})
      expect(state.budgetTransactions).toEqual([])
    })
  })

  describe('deleteAccount', () => {
    it('removes account and associated positions', () => {
      const state: AppState = {
        ...initialState(),
        accounts: [
          {
            id: 'acc1',
            accountNumber: '123456',
            name: 'Account 1',
            retirement: false,
            createdAt: '2024-01-01T10:00:00Z',
          },
          {
            id: 'acc2',
            accountNumber: '234567',
            name: 'Account 2',
            retirement: true,
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

      const updated = deleteAccount(state, 'acc1')

      // acc1 should be removed
      expect(updated.accounts).toHaveLength(1)
      expect(updated.accounts[0].id).toBe('acc2')

      // Positions for acc1 should be removed
      expect(updated.positions).toHaveLength(0)
    })


    it('cascade-deletes csvMappings entries for the deleted account', () => {
      const state: AppState = {
        ...initialState(),
        accounts: [
          {
            id: 'acc1',
            accountNumber: '123456',
            name: 'Account 1',
            retirement: false,
            createdAt: '2024-01-01T10:00:00Z',
          },
          {
            id: 'acc2',
            accountNumber: '234567',
            name: 'Account 2',
            retirement: true,
            createdAt: '2024-01-01T10:00:00Z',
          },
        ],
        csvMappings: [
          {
            id: 'mapping1',
            accountId: 'acc1',
            kind: 'positions',
            fieldMap: { 'Symbol': 'symbol', 'Shares': 'shares' },
            updatedAt: '2024-01-01T10:00:00Z',
          },
          {
            id: 'mapping2',
            accountId: 'acc2',
            kind: 'positions',
            fieldMap: { 'Ticker': 'symbol', 'Qty': 'shares' },
            updatedAt: '2024-01-01T10:00:00Z',
          },
        ],
      }

      const updated = deleteAccount(state, 'acc1')

      // acc1 should be removed
      expect(updated.accounts).toHaveLength(1)
      expect(updated.accounts[0].id).toBe('acc2')

      // csvMappings for acc1 should be removed, acc2 mapping should remain
      expect(updated.csvMappings).toHaveLength(1)
      expect(updated.csvMappings[0].id).toBe('mapping2')
      expect(updated.csvMappings[0].accountId).toBe('acc2')
    })

    it('cascade-deletes balanceEntries for the deleted account, leaving other accounts untouched', () => {
      const state: AppState = {
        ...initialState(),
        accounts: [
          {
            id: 'acc1',
            accountNumber: '123456',
            name: 'Account 1',
            retirement: false,
            createdAt: '2024-01-01T10:00:00Z',
          },
          {
            id: 'acc2',
            accountNumber: '234567',
            name: 'Account 2',
            retirement: true,
            createdAt: '2024-01-01T10:00:00Z',
          },
        ],
        balanceEntries: [
          {
            id: 'bal1',
            accountId: 'acc1',
            date: '2024-01-01',
            balance: 1000,
            activityType: 'None',
            activityAmount: 0,
            note: '',
          },
          {
            id: 'bal2',
            accountId: 'acc2',
            date: '2024-01-01',
            balance: 2000,
            activityType: 'None',
            activityAmount: 0,
            note: '',
          },
        ],
      }

      const updated = deleteAccount(state, 'acc1')

      expect(updated.balanceEntries).toHaveLength(1)
      expect(updated.balanceEntries[0].id).toBe('bal2')
      expect(updated.balanceEntries[0].accountId).toBe('acc2')
    })
  })

  describe('upsertCsvMapping', () => {
    it('pushes a new entry when no existing mapping for accountId+kind, with generated id and updatedAt set', () => {
      const state = initialState()
      const fieldMap = { 'Symbol': 'symbol', 'Shares': 'shares' }

      const updated = upsertCsvMapping(state, 'acc1', 'positions', fieldMap)

      expect(updated.csvMappings).toHaveLength(1)
      expect(updated.csvMappings[0].accountId).toBe('acc1')
      expect(updated.csvMappings[0].kind).toBe('positions')
      expect(updated.csvMappings[0].fieldMap).toEqual(fieldMap)
      expect(updated.csvMappings[0].id).toBeDefined()
      expect(updated.csvMappings[0].id).toMatch(/^mapping-/)
      expect(updated.csvMappings[0].updatedAt).toBeDefined()
      // updatedAt should be close to now (within a few seconds)
      const now = new Date()
      const mappingTime = new Date(updated.csvMappings[0].updatedAt)
      expect(now.getTime() - mappingTime.getTime()).toBeLessThan(5000)
    })

    it('replaces existing entry for same accountId+kind, preserving the id', () => {
      const state: AppState = {
        ...initialState(),
        csvMappings: [
          {
            id: 'mapping1',
            accountId: 'acc1',
            kind: 'positions',
            fieldMap: { 'Symbol': 'symbol', 'Shares': 'shares' },
            updatedAt: '2024-01-01T10:00:00Z',
          },
        ],
      }

      const newFieldMap = { 'Ticker': 'symbol', 'Qty': 'shares', 'Price': 'price' }
      const updated = upsertCsvMapping(state, 'acc1', 'positions', newFieldMap)

      expect(updated.csvMappings).toHaveLength(1)
      // Same id as before
      expect(updated.csvMappings[0].id).toBe('mapping1')
      expect(updated.csvMappings[0].accountId).toBe('acc1')
      expect(updated.csvMappings[0].kind).toBe('positions')
      // Updated fieldMap
      expect(updated.csvMappings[0].fieldMap).toEqual(newFieldMap)
      // updatedAt should be refreshed to now
      const now = new Date()
      const mappingTime = new Date(updated.csvMappings[0].updatedAt)
      expect(now.getTime() - mappingTime.getTime()).toBeLessThan(5000)
    })

    it('allows different kinds for the same accountId to coexist', () => {
      let state = initialState()
      const posFieldMap = { 'Symbol': 'symbol', 'Shares': 'shares' }
      const txFieldMap = { 'Date': 'date', 'Type': 'type', 'Amount': 'amount' }

      state = upsertCsvMapping(state, 'acc1', 'positions', posFieldMap)
      expect(state.csvMappings).toHaveLength(1)
      expect(state.csvMappings[0].kind).toBe('positions')

      state = upsertCsvMapping(state, 'acc1', 'transactions', txFieldMap)
      expect(state.csvMappings).toHaveLength(2)

      // Verify both mappings exist
      const posMappings = state.csvMappings.filter((m) => m.kind === 'positions')
      const txMappings = state.csvMappings.filter((m) => m.kind === 'transactions')

      expect(posMappings).toHaveLength(1)
      expect(posMappings[0].accountId).toBe('acc1')
      expect(posMappings[0].fieldMap).toEqual(posFieldMap)

      expect(txMappings).toHaveLength(1)
      expect(txMappings[0].accountId).toBe('acc1')
      expect(txMappings[0].fieldMap).toEqual(txFieldMap)
    })
  })

  describe('setView', () => {
    it('defaults to "accounts" and toggles between "accounts" and "settings"', () => {
      const state = initialState()
      expect(state.view).toBe('accounts')

      const toSettings = setView(state, 'settings')
      expect(toSettings.view).toBe('settings')

      const toAccounts = setView(toSettings, 'accounts')
      expect(toAccounts.view).toBe('accounts')
    })

    it('sets view to "quotes"', () => {
      const state = initialState()
      const toQuotes = setView(state, 'quotes')
      expect(toQuotes.view).toBe('quotes')
    })
  })

  describe('closePosition', () => {
    it('happy path: moves position to closedPositions with correct fields and today date', () => {
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

      const updated = closePosition(state, 'pos1')

      // Position should be removed
      expect(updated.positions).toHaveLength(0)

      // ClosedPosition should be added
      expect(updated.closedPositions).toHaveLength(1)
      const closed = updated.closedPositions[0]
      expect(closed.accountId).toBe('acc1')
      expect(closed.symbol).toBe('AAPL')
      expect(closed.name).toBe('Apple Inc.')
      expect(closed.assetClass).toBe('Equity')
      expect(closed.realizedGL).toBeNull()
      expect(closed.realizedGLBasis).toBe('unknown')
      // Check closedDate is today
      const today = new Date().toISOString().slice(0, 10)
      expect(closed.closedDate).toBe(today)
    })

    it('effective asset class: override wins over original assetClass', () => {
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
            symbol: 'BOND1',
            name: 'Bond Fund',
            assetClass: 'Equity',
            assetClassManualOverride: 'Bond',
            shares: 100,
            avgCost: 100,
            price: 102,
            lastImportedAt: '2024-01-01T10:00:00Z',
          },
        ],
      }

      const updated = closePosition(state, 'pos1')

      expect(updated.closedPositions).toHaveLength(1)
      expect(updated.closedPositions[0].assetClass).toBe('Bond')
    })

    it('existing closedPositions preserved: closing a different position keeps original', () => {
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
          {
            id: 'pos2',
            accountId: 'acc1',
            symbol: 'MSFT',
            name: 'Microsoft Inc.',
            assetClass: 'Equity',
            shares: 50,
            avgCost: 200,
            price: 250,
            lastImportedAt: '2024-01-01T10:00:00Z',
          },
        ],
        closedPositions: [
          {
            id: 'closed1',
            accountId: 'acc1',
            symbol: 'GOOG',
            name: 'Google Inc.',
            closedDate: '2024-06-01',
            assetClass: 'Equity',
            realizedGL: 500,
            realizedGLBasis: 'transactions',
          },
        ],
      }

      const updated = closePosition(state, 'pos1')

      // Should have 2 closed positions now
      expect(updated.closedPositions).toHaveLength(2)
      // Original closed position should be untouched
      expect(updated.closedPositions[0].id).toBe('closed1')
      expect(updated.closedPositions[0].symbol).toBe('GOOG')
      // New closed position should be at end
      expect(updated.closedPositions[1].symbol).toBe('AAPL')
    })

    it('missing id case: returns state unchanged', () => {
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

      const updated = closePosition(state, 'nonexistent-id')

      // State should be unchanged
      expect(updated).toEqual(state)
      expect(updated.positions).toHaveLength(1)
      expect(updated.closedPositions).toHaveLength(0)
    })
  })

  describe('selectAccount', () => {
    it('happy path: sets selectedAccountId and selectedCategoryKey when new values are provided', () => {
      const state = initialState()
      expect(state.selectedAccountId).toBeNull()
      expect(state.selectedCategoryKey).toBeNull()

      const updated = selectAccount(state, 'acc1', 'taxable')
      expect(updated.selectedAccountId).toBe('acc1')
      expect(updated.selectedCategoryKey).toBe('taxable')
    })

    it('toggle: selecting already-selected account+category clears both', () => {
      const state = {
        ...initialState(),
        selectedAccountId: 'acc1',
        selectedCategoryKey: 'taxable',
      }

      const updated = selectAccount(state, 'acc1', 'taxable')
      expect(updated.selectedAccountId).toBeNull()
      expect(updated.selectedCategoryKey).toBeNull()
    })

    it('other fields remain reference-equal when selecting a different account', () => {
      const state = initialState()
      const originalAccounts = state.accounts
      const originalPositions = state.positions

      const updated = selectAccount(state, 'acc1', 'taxable')

      expect(updated.accounts).toBe(originalAccounts)
      expect(updated.positions).toBe(originalPositions)
    })

    it('selecting same accountId but different categoryKey switches to new category', () => {
      const state = {
        ...initialState(),
        selectedAccountId: 'acc1',
        selectedCategoryKey: 'taxable',
      }

      const updated = selectAccount(state, 'acc1', 'nonTaxable')
      expect(updated.selectedAccountId).toBe('acc1')
      expect(updated.selectedCategoryKey).toBe('nonTaxable')
    })

    it('selecting different accountId clears previous selection and sets new one', () => {
      const state = {
        ...initialState(),
        selectedAccountId: 'acc1',
        selectedCategoryKey: 'taxable',
      }

      const updated = selectAccount(state, 'acc2', 'taxDeferred')
      expect(updated.selectedAccountId).toBe('acc2')
      expect(updated.selectedCategoryKey).toBe('taxDeferred')
    })

    it('selecting closedPositions categoryKey works like other categories', () => {
      const state = initialState()

      const updated = selectAccount(state, 'acc1', 'closedPositions')
      expect(updated.selectedAccountId).toBe('acc1')
      expect(updated.selectedCategoryKey).toBe('closedPositions')

      const toggled = selectAccount(updated, 'acc1', 'closedPositions')
      expect(toggled.selectedAccountId).toBeNull()
      expect(toggled.selectedCategoryKey).toBeNull()
    })
  })

  describe('clearAccountSelection', () => {
    it('happy path: clears a non-null selection back to null and leaves other fields untouched', () => {
      const state = {
        ...initialState(),
        selectedAccountId: 'acc1',
        selectedCategoryKey: 'taxable',
      }
      const originalAccounts = state.accounts
      const originalPositions = state.positions

      const updated = clearAccountSelection(state)

      expect(updated.selectedAccountId).toBeNull()
      expect(updated.selectedCategoryKey).toBeNull()
      expect(updated.accounts).toBe(originalAccounts)
      expect(updated.positions).toBe(originalPositions)
    })

    it('edge: no-op when selection is already null', () => {
      const state = initialState()
      expect(state.selectedAccountId).toBeNull()
      expect(state.selectedCategoryKey).toBeNull()

      const updated = clearAccountSelection(state)

      expect(updated.selectedAccountId).toBeNull()
      expect(updated.selectedCategoryKey).toBeNull()
      expect(updated.accounts).toBe(state.accounts)
      expect(updated.positions).toBe(state.positions)
    })
  })

  describe('toggleCategoryExpanded', () => {
    it('happy path: toggles false→true for new key', () => {
      const state = initialState()
      expect(state.expandedCategories['cat1']).toBeUndefined()

      const updated = toggleCategoryExpanded(state, 'cat1')
      expect(updated.expandedCategories['cat1']).toBe(true)
    })

    it('toggling twice returns to false', () => {
      let state = initialState()
      state = toggleCategoryExpanded(state, 'cat1')
      expect(state.expandedCategories['cat1']).toBe(true)

      state = toggleCategoryExpanded(state, 'cat1')
      expect(state.expandedCategories['cat1']).toBe(false)
    })

    it('other category keys remain untouched', () => {
      let state = {
        ...initialState(),
        expandedCategories: { 'cat1': true, 'cat2': false },
      }

      state = toggleCategoryExpanded(state, 'cat1')
      expect(state.expandedCategories['cat1']).toBe(false)
      expect(state.expandedCategories['cat2']).toBe(false)

      state = toggleCategoryExpanded(state, 'cat3')
      expect(state.expandedCategories['cat1']).toBe(false)
      expect(state.expandedCategories['cat2']).toBe(false)
      expect(state.expandedCategories['cat3']).toBe(true)
    })
  })

  describe('setAcctAssetClassFilter', () => {
    it('happy path: sets filter field', () => {
      const state = initialState()
      expect(state.acctAssetClassFilter).toBe('All')

      const updated = setAcctAssetClassFilter(state, 'Equity')
      expect(updated.acctAssetClassFilter).toBe('Equity')
    })

    it('empty string and "All" round-trip correctly', () => {
      let state = initialState()
      state = setAcctAssetClassFilter(state, '')
      expect(state.acctAssetClassFilter).toBe('')

      state = setAcctAssetClassFilter(state, 'All')
      expect(state.acctAssetClassFilter).toBe('All')
    })
  })

  describe('setAcctPosSearch', () => {
    it('happy path: sets search field', () => {
      const state = initialState()
      expect(state.acctPosSearch).toBe('')

      const updated = setAcctPosSearch(state, 'AAPL')
      expect(updated.acctPosSearch).toBe('AAPL')
    })

    it('empty string round-trip', () => {
      let state = initialState()
      state = setAcctPosSearch(state, 'MSFT')
      expect(state.acctPosSearch).toBe('MSFT')

      state = setAcctPosSearch(state, '')
      expect(state.acctPosSearch).toBe('')
    })
  })

  describe('setPriceSyncApiKey', () => {
    it('sets apiKey and leaves other priceSync fields untouched', () => {
      const state: AppState = {
        ...initialState(),
        priceSync: {
          apiKey: '',
          lastFetchedDate: '2024-01-01',
          heldPrices: { AAPL: { price: 180, date: '2024-01-01', fetchedAt: '2024-01-01T10:00:00Z' } },
          lastRun: { at: '2024-01-01T10:00:00Z', updatedCount: 1, notFound: [], marketTickerCount: 1 },
        },
      }

      const result = setPriceSyncApiKey(state, 'sk-123')

      expect(result.priceSync.apiKey).toBe('sk-123')
      expect(result.priceSync.lastFetchedDate).toBe('2024-01-01')
      expect(result.priceSync.heldPrices).toEqual(state.priceSync.heldPrices)
      expect(result.priceSync.lastRun).toEqual(state.priceSync.lastRun)
    })
  })

  describe('recordPriceSyncRun', () => {
    it('applies a full patch (lastFetchedDate, heldPrices, lastRun) to priceSync', () => {
      const state: AppState = {
        ...initialState(),
        priceSync: {
          apiKey: 'sk-123',
          lastFetchedDate: null,
          heldPrices: {},
          lastRun: null,
        },
      }

      const patch = {
        lastFetchedDate: '2024-02-01',
        heldPrices: { AAPL: { price: 190, date: '2024-02-01', fetchedAt: '2024-02-01T10:00:00Z' } },
        lastRun: { at: '2024-02-01T10:00:00Z', updatedCount: 1, notFound: [], marketTickerCount: 1 },
      }

      const result = recordPriceSyncRun(state, patch)

      expect(result.priceSync.lastFetchedDate).toBe('2024-02-01')
      expect(result.priceSync.heldPrices).toEqual(patch.heldPrices)
      expect(result.priceSync.lastRun).toEqual(patch.lastRun)
    })

    it('with only lastRun (empty/error-fetch case), leaves lastFetchedDate/heldPrices unchanged', () => {
      const state: AppState = {
        ...initialState(),
        priceSync: {
          apiKey: 'sk-123',
          lastFetchedDate: '2024-01-15',
          heldPrices: { MSFT: { price: 300, date: '2024-01-15', fetchedAt: '2024-01-15T10:00:00Z' } },
          lastRun: null,
        },
      }

      const patch = {
        lastRun: { at: '2024-02-01T10:00:00Z', updatedCount: 0, notFound: ['AAPL'], marketTickerCount: 0 },
      }

      const result = recordPriceSyncRun(state, patch)

      expect(result.priceSync.lastFetchedDate).toBe('2024-01-15')
      expect(result.priceSync.heldPrices).toEqual(state.priceSync.heldPrices)
      expect(result.priceSync.lastRun).toEqual(patch.lastRun)
    })
  })

  describe('setMutualFundSyncApiKey', () => {
    it('sets apiKey and leaves other mutualFundSync fields untouched', () => {
      const state: AppState = {
        ...initialState(),
        mutualFundSync: {
          apiKey: '',
          heldPrices: { VFIAX: { price: 450, date: '2024-01-01', fetchedAt: '2024-01-01T10:00:00Z' } },
          lastRun: { at: '2024-01-01T10:00:00Z', updatedCount: 1, notFound: [], marketTickerCount: 0 },
          callBudget: { date: '2024-01-01', callsUsed: 3 },
        },
      }

      const result = setMutualFundSyncApiKey(state, 'sk-mf-123')

      expect(result.mutualFundSync.apiKey).toBe('sk-mf-123')
      expect(result.mutualFundSync.heldPrices).toEqual(state.mutualFundSync.heldPrices)
      expect(result.mutualFundSync.lastRun).toEqual(state.mutualFundSync.lastRun)
      expect(result.mutualFundSync.callBudget).toEqual(state.mutualFundSync.callBudget)
    })
  })

  describe('recordMutualFundSyncRun', () => {
    it('applies a full patch (heldPrices, lastRun, callBudget) to mutualFundSync', () => {
      const state: AppState = {
        ...initialState(),
        mutualFundSync: {
          apiKey: 'sk-mf-123',
          heldPrices: {},
          lastRun: null,
          callBudget: { date: '', callsUsed: 0 },
        },
      }

      const patch = {
        heldPrices: { VFIAX: { price: 460, date: '2024-02-01', fetchedAt: '2024-02-01T10:00:00Z' } },
        lastRun: { at: '2024-02-01T10:00:00Z', updatedCount: 1, notFound: [], marketTickerCount: 0 },
        callBudget: { date: '2024-02-01', callsUsed: 1 },
      }

      const result = recordMutualFundSyncRun(state, patch)

      expect(result.mutualFundSync.heldPrices).toEqual(patch.heldPrices)
      expect(result.mutualFundSync.lastRun).toEqual(patch.lastRun)
      expect(result.mutualFundSync.callBudget).toEqual(patch.callBudget)
    })

    it('with no heldPrices in patch, leaves existing heldPrices unchanged while updating lastRun/callBudget', () => {
      const state: AppState = {
        ...initialState(),
        mutualFundSync: {
          apiKey: 'sk-mf-123',
          heldPrices: { VBTLX: { price: 10, date: '2024-01-15', fetchedAt: '2024-01-15T10:00:00Z' } },
          lastRun: null,
          callBudget: { date: '2024-01-15', callsUsed: 2 },
        },
      }

      const patch = {
        lastRun: { at: '2024-02-01T10:00:00Z', updatedCount: 0, notFound: ['SWPPX'], marketTickerCount: 0 },
        callBudget: { date: '2024-02-01', callsUsed: 1 },
      }

      const result = recordMutualFundSyncRun(state, patch)

      expect(result.mutualFundSync.heldPrices).toEqual(state.mutualFundSync.heldPrices)
      expect(result.mutualFundSync.lastRun).toEqual(patch.lastRun)
      expect(result.mutualFundSync.callBudget).toEqual(patch.callBudget)
    })
  })

  describe('initialState mutualFundSync', () => {
    it('defaults to empty apiKey, heldPrices, null lastRun, and zeroed callBudget', () => {
      const state = initialState()
      expect(state.mutualFundSync).toEqual({
        apiKey: '',
        heldPrices: {},
        lastRun: null,
        callBudget: { date: '', callsUsed: 0 },
      })
    })
  })

  describe('initialState register fields', () => {
    it('defaults balanceEntries/regAccountId/regExpanded/regActivityFilter', () => {
      const state = initialState()
      expect(state.balanceEntries).toEqual([])
      expect(state.regAccountId).toBeNull()
      expect(state.regExpanded).toEqual({})
      expect(state.regActivityFilter).toBe('All')
    })
  })

  describe('addBalanceEntries', () => {
    const entry = (overrides: Partial<BalanceEntry>): BalanceEntry => ({
      id: 'bal1',
      accountId: 'acc1',
      date: '2024-01-01',
      balance: 1000,
      activityType: 'None',
      activityAmount: 0,
      note: '',
      ...overrides,
    })

    it('appends an entry for a new (accountId, date)', () => {
      const state = initialState()
      const updated = addBalanceEntries(state, [entry({})])

      expect(updated.balanceEntries).toHaveLength(1)
      expect(updated.balanceEntries[0].id).toBe('bal1')
    })

    it('replaces an existing entry sharing (accountId, date): length unchanged, new values present, old gone', () => {
      const state: AppState = {
        ...initialState(),
        balanceEntries: [entry({ id: 'bal1', balance: 1000 })],
      }

      const updated = addBalanceEntries(state, [
        entry({ id: 'bal2', balance: 1500 }),
      ])

      expect(updated.balanceEntries).toHaveLength(1)
      expect(updated.balanceEntries[0].id).toBe('bal2')
      expect(updated.balanceEntries[0].balance).toBe(1500)
      expect(updated.balanceEntries.find((b) => b.id === 'bal1')).toBeUndefined()
    })

    it('one call with one replacing entry and one brand-new entry: both land correctly', () => {
      const state: AppState = {
        ...initialState(),
        balanceEntries: [
          entry({ id: 'bal1', accountId: 'acc1', date: '2024-01-01', balance: 1000 }),
          entry({ id: 'bal-untouched', accountId: 'acc1', date: '2024-02-01', balance: 999 }),
        ],
      }

      const updated = addBalanceEntries(state, [
        entry({ id: 'bal1-new', accountId: 'acc1', date: '2024-01-01', balance: 1100 }),
        entry({ id: 'bal-new', accountId: 'acc2', date: '2024-01-01', balance: 500 }),
      ])

      expect(updated.balanceEntries).toHaveLength(3)
      expect(updated.balanceEntries.find((b) => b.id === 'bal1')).toBeUndefined()
      const replaced = updated.balanceEntries.find((b) => b.accountId === 'acc1' && b.date === '2024-01-01')
      expect(replaced?.id).toBe('bal1-new')
      expect(replaced?.balance).toBe(1100)
      expect(updated.balanceEntries.find((b) => b.id === 'bal-untouched')).toBeDefined()
      expect(updated.balanceEntries.find((b) => b.id === 'bal-new')).toBeDefined()
    })
  })

  describe('deleteBalanceEntry', () => {
    it('removes the entry by id', () => {
      const state: AppState = {
        ...initialState(),
        balanceEntries: [
          {
            id: 'bal1',
            accountId: 'acc1',
            date: '2024-01-01',
            balance: 1000,
            activityType: 'None',
            activityAmount: 0,
            note: '',
          },
        ],
      }

      const updated = deleteBalanceEntry(state, 'bal1')
      expect(updated.balanceEntries).toHaveLength(0)
    })

    it('no-op when id not found', () => {
      const state: AppState = {
        ...initialState(),
        balanceEntries: [
          {
            id: 'bal1',
            accountId: 'acc1',
            date: '2024-01-01',
            balance: 1000,
            activityType: 'None',
            activityAmount: 0,
            note: '',
          },
        ],
      }

      expect(() => deleteBalanceEntry(state, 'nonexistent')).not.toThrow()
      const updated = deleteBalanceEntry(state, 'nonexistent')
      expect(updated.balanceEntries).toHaveLength(1)
      expect(updated.balanceEntries[0].id).toBe('bal1')
    })
  })

  describe('updateBalanceEntry', () => {
    const entry = (overrides: Partial<BalanceEntry>): BalanceEntry => ({
      id: 'bal1',
      accountId: 'acc1',
      date: '2024-01-01',
      balance: 1000,
      activities: [],
      ...overrides,
    })

    it('updates an existing entry by id: length unchanged, values replaced', () => {
      const state: AppState = {
        ...initialState(),
        balanceEntries: [entry({ id: 'bal1', balance: 1000, activities: [] })],
      }

      const updated = updateBalanceEntry(
        state,
        entry({
          id: 'bal1',
          balance: 1500,
          activities: [{ type: 'Deposit', amount: 500, note: 'raise' }],
        })
      )

      expect(updated.balanceEntries).toHaveLength(1)
      expect(updated.balanceEntries[0].balance).toBe(1500)
      expect(updated.balanceEntries[0].activities).toEqual([
        { type: 'Deposit', amount: 500, note: 'raise' },
      ])
    })

    it('moving entry to a colliding (accountId, date) drops the other entry occupying that slot', () => {
      const state: AppState = {
        ...initialState(),
        balanceEntries: [
          entry({ id: 'bal1', accountId: 'acc1', date: '2024-01-01' }),
          entry({ id: 'bal2', accountId: 'acc1', date: '2024-02-01', balance: 2000 }),
        ],
      }

      const updated = updateBalanceEntry(
        state,
        entry({ id: 'bal1', accountId: 'acc1', date: '2024-02-01', balance: 1234 })
      )

      expect(updated.balanceEntries).toHaveLength(1)
      expect(updated.balanceEntries[0].id).toBe('bal1')
      expect(updated.balanceEntries[0].date).toBe('2024-02-01')
      expect(updated.balanceEntries[0].balance).toBe(1234)
      expect(updated.balanceEntries.find((b) => b.id === 'bal2')).toBeUndefined()
    })

    it('moving entry to a non-colliding (accountId, date): length unchanged, no dangling duplicate', () => {
      const state: AppState = {
        ...initialState(),
        balanceEntries: [
          entry({ id: 'bal1', accountId: 'acc1', date: '2024-01-01' }),
          entry({ id: 'bal-untouched', accountId: 'acc1', date: '2024-02-01', balance: 999 }),
        ],
      }

      const updated = updateBalanceEntry(
        state,
        entry({ id: 'bal1', accountId: 'acc1', date: '2024-03-01', balance: 1234 })
      )

      expect(updated.balanceEntries).toHaveLength(2)
      expect(updated.balanceEntries.filter((b) => b.id === 'bal1')).toHaveLength(1)
      const moved = updated.balanceEntries.find((b) => b.id === 'bal1')
      expect(moved?.date).toBe('2024-03-01')
      expect(moved?.balance).toBe(1234)
      expect(updated.balanceEntries.find((b) => b.id === 'bal-untouched')).toBeDefined()
    })
  })

  describe('setRegAccount', () => {
    it('sets and clears the selected register account', () => {
      const state = initialState()
      expect(state.regAccountId).toBeNull()

      const selected = setRegAccount(state, 'acc1')
      expect(selected.regAccountId).toBe('acc1')

      const cleared = setRegAccount(selected, null)
      expect(cleared.regAccountId).toBeNull()
    })
  })

  describe('toggleRegCategoryExpanded', () => {
    it('toggles false -> true -> false for a key, leaving other keys untouched', () => {
      let state = initialState()
      expect(state.regExpanded['cat1']).toBeUndefined()

      state = toggleRegCategoryExpanded(state, 'cat1')
      expect(state.regExpanded['cat1']).toBe(true)

      state = toggleRegCategoryExpanded(state, 'cat1')
      expect(state.regExpanded['cat1']).toBe(false)

      state = toggleRegCategoryExpanded(state, 'cat2')
      expect(state.regExpanded['cat1']).toBe(false)
      expect(state.regExpanded['cat2']).toBe(true)
    })
  })

  describe('setRegActivityFilter', () => {
    it('sets and round-trips the activity filter', () => {
      const state = initialState()
      expect(state.regActivityFilter).toBe('All')

      const updated = setRegActivityFilter(state, 'With Activity')
      expect(updated.regActivityFilter).toBe('With Activity')

      const reverted = setRegActivityFilter(updated, 'All')
      expect(reverted.regActivityFilter).toBe('All')
    })
  })

  describe('nearestBudgetExpensesYear', () => {
    it('returns exact match', () => {
      const byYear = { '2024': [], '2025': [] }
      expect(nearestBudgetExpensesYear(byYear, '2025')).toBe('2025')
    })

    it('returns nearest by distance', () => {
      const byYear = { '2020': [], '2026': [] }
      expect(nearestBudgetExpensesYear(byYear, '2025')).toBe('2026')
    })

    it('breaks ties toward the earlier year', () => {
      const byYear = { '2023': [], '2025': [] }
      expect(nearestBudgetExpensesYear(byYear, '2024')).toBe('2023')
    })

    it('returns null for an empty map', () => {
      expect(nearestBudgetExpensesYear({}, '2025')).toBeNull()
    })
  })

  describe('resolveBudgetExpensesForYear', () => {
    const e1: Expense = { id: 'exp-1', name: 'Rent', categoryId: 'cat-Housing', amount: 2000, frequency: 'monthly' }
    const e2: Expense = { id: 'exp-2', name: 'Gym', categoryId: 'cat-Health', amount: 50, frequency: 'monthly' }

    it('returns the own array when present', () => {
      const byYear = { '2024': [e1], '2025': [e2] }
      expect(resolveBudgetExpensesForYear(byYear, '2025')).toEqual([e2])
    })

    it('returns nearest year data when absent', () => {
      const byYear = { '2024': [e1] }
      expect(resolveBudgetExpensesForYear(byYear, '2025')).toEqual([e1])
    })

    it('returns [] when fully empty', () => {
      expect(resolveBudgetExpensesForYear({}, '2025')).toEqual([])
    })
  })

  describe('resolveBudgetExpensesForAnalyticsYear', () => {
    const e1: Expense = { id: 'exp-1', name: 'Rent', categoryId: 'cat-Housing', amount: 2000, frequency: 'monthly' }
    const e2: Expense = { id: 'exp-2', name: 'Gym', categoryId: 'cat-Health', amount: 50, frequency: 'monthly' }
    const now = new Date('2026-06-01T00:00:00Z')

    it('returns own year when present', () => {
      const byYear = { '2024': [e1], '2026': [e2] }
      expect(resolveBudgetExpensesForAnalyticsYear(byYear, '2024', now)).toEqual([e1])
    })

    it('falls back to the CURRENT year specifically, not nearest', () => {
      // nearest to 2020 is 2024 (distance 4) vs 2026 (distance 6), but the fallback
      // must land on 2026 (the current year), proving it does not use "nearest".
      const byYear = { '2024': [e1], '2026': [e2] }
      expect(resolveBudgetExpensesForAnalyticsYear(byYear, '2020', now)).toEqual([e2])
    })

    it('returns [] when both the requested and current year are absent', () => {
      const byYear = { '2024': [e1] }
      expect(resolveBudgetExpensesForAnalyticsYear(byYear, '2020', now)).toEqual([])
    })
  })

  describe('seedBudgetExpensesForYear', () => {
    it('leaves an already-seeded year untouched', () => {
      const e1: Expense = { id: 'exp-1', name: 'Rent', categoryId: 'cat-Housing', amount: 2000, frequency: 'monthly' }
      const state = { ...initialState(), budgetExpensesByYear: { '2025': [e1] } }
      const updated = seedBudgetExpensesForYear(state, '2025')
      expect(updated).toBe(state)
    })

    it('copies the nearest year expenses as a fresh array/objects', () => {
      const e1: Expense = { id: 'exp-1', name: 'Rent', categoryId: 'cat-Housing', amount: 2000, frequency: 'monthly' }
      const state = { ...initialState(), budgetExpensesByYear: { '2024': [e1] } }
      const updated = seedBudgetExpensesForYear(state, '2025')
      expect(updated.budgetExpensesByYear['2025']).toEqual([e1])
      expect(updated.budgetExpensesByYear['2025']).not.toBe(state.budgetExpensesByYear['2024'])

      // mutating the copy must not mutate the source
      updated.budgetExpensesByYear['2025'][0].amount = 9999
      expect(state.budgetExpensesByYear['2024'][0].amount).toBe(2000)
    })

    it('seeds [] when there is no data anywhere', () => {
      const updated = seedBudgetExpensesForYear(initialState(), '2025')
      expect(updated.budgetExpensesByYear['2025']).toEqual([])
    })
  })

  describe('rolloverBudgetExpensesIfNeeded', () => {
    const now = new Date('2026-06-01T00:00:00Z')

    it('is a no-op when the current year already has a snapshot', () => {
      const state = { ...initialState(), budgetExpensesByYear: { '2026': [] } }
      const updated = rolloverBudgetExpensesIfNeeded(state, now)
      expect(updated).toBe(state)
    })

    it('seeds the current year from a prior year when missing', () => {
      const e1: Expense = { id: 'exp-1', name: 'Rent', categoryId: 'cat-Housing', amount: 2000, frequency: 'monthly' }
      const state = { ...initialState(), budgetExpensesByYear: { '2024': [e1] } }
      const updated = rolloverBudgetExpensesIfNeeded(state, now)
      expect(updated.budgetExpensesByYear['2026']).toEqual([e1])
    })

    it('stays {} when budgetExpensesByYear is entirely empty', () => {
      const updated = rolloverBudgetExpensesIfNeeded(initialState(), now)
      expect(updated.budgetExpensesByYear).toEqual({})
    })
  })

  describe('addBudgetExpense', () => {
    it('appends a new expense with a generated id, preserving existing entries in that year', () => {
      const existing: Expense = { id: 'exp-1', name: 'Rent', categoryId: 'cat-Housing', amount: 2000, frequency: 'monthly' }
      const state = { ...initialState(), budgetExpensesByYear: { '2025': [existing] } }
      const updated = addBudgetExpense(state, '2025', { name: 'Netflix', categoryId: 'cat-Subscriptions', amount: 15, frequency: 'monthly' })
      expect(updated.budgetExpensesByYear['2025']).toHaveLength(2)
      expect(updated.budgetExpensesByYear['2025'][0]).toEqual(existing)
      expect(updated.budgetExpensesByYear['2025'][1]).toMatchObject({ name: 'Netflix', categoryId: 'cat-Subscriptions', amount: 15, frequency: 'monthly' })
      expect(typeof updated.budgetExpensesByYear['2025'][1].id).toBe('string')
      expect(updated.budgetExpensesByYear['2025'][1].id.length).toBeGreaterThan(0)
    })

    it('seeds a not-yet-seeded year from the nearest year, then appends', () => {
      const existing: Expense = { id: 'exp-1', name: 'Rent', categoryId: 'cat-Housing', amount: 2000, frequency: 'monthly' }
      const state = { ...initialState(), budgetExpensesByYear: { '2024': [existing] } }
      const updated = addBudgetExpense(state, '2025', { name: 'Netflix', categoryId: 'cat-Subscriptions', amount: 15, frequency: 'monthly' })
      expect(updated.budgetExpensesByYear['2025']).toHaveLength(2)
      expect(updated.budgetExpensesByYear['2025'][0]).toEqual(existing)
      expect(updated.budgetExpensesByYear['2025'][1]).toMatchObject({ name: 'Netflix' })
      expect(updated.budgetExpensesByYear['2024']).toEqual([existing])
    })
  })

  describe('updateBudgetExpense', () => {
    it('patches the matching expense by id within the given year', () => {
      const existing: Expense = { id: 'exp-1', name: 'Rent', categoryId: 'cat-Housing', amount: 2000, frequency: 'monthly' }
      const other: Expense = { id: 'exp-2', name: 'Other year', categoryId: 'cat-Housing', amount: 1, frequency: 'monthly' }
      const state = { ...initialState(), budgetExpensesByYear: { '2025': [existing], '2024': [other] } }
      const updated = updateBudgetExpense(state, '2025', 'exp-1', { amount: 2100 })
      expect(updated.budgetExpensesByYear['2025'][0]).toEqual({ ...existing, amount: 2100 })
      expect(updated.budgetExpensesByYear['2024']).toEqual([other])
    })

    it('is a no-op when the id is not found', () => {
      const existing: Expense = { id: 'exp-1', name: 'Rent', categoryId: 'cat-Housing', amount: 2000, frequency: 'monthly' }
      const state = { ...initialState(), budgetExpensesByYear: { '2025': [existing] } }
      const updated = updateBudgetExpense(state, '2025', 'missing', { amount: 9999 })
      expect(updated.budgetExpensesByYear['2025']).toEqual([existing])
    })
  })

  describe('deleteBudgetExpense', () => {
    it('removes the matching expense by id within the given year', () => {
      const e1: Expense = { id: 'exp-1', name: 'Rent', categoryId: 'cat-Housing', amount: 2000, frequency: 'monthly' }
      const e2: Expense = { id: 'exp-2', name: 'Netflix', categoryId: 'cat-Subscriptions', amount: 15, frequency: 'monthly' }
      const other: Expense = { id: 'exp-3', name: 'Other year', categoryId: 'cat-Housing', amount: 1, frequency: 'monthly' }
      const state = { ...initialState(), budgetExpensesByYear: { '2025': [e1, e2], '2024': [other] } }
      const updated = deleteBudgetExpense(state, '2025', 'exp-1')
      expect(updated.budgetExpensesByYear['2025']).toEqual([e2])
      expect(updated.budgetExpensesByYear['2024']).toEqual([other])
    })

    it('is a no-op when the id is not found', () => {
      const e1: Expense = { id: 'exp-1', name: 'Rent', categoryId: 'cat-Housing', amount: 2000, frequency: 'monthly' }
      const state = { ...initialState(), budgetExpensesByYear: { '2025': [e1] } }
      const updated = deleteBudgetExpense(state, '2025', 'missing')
      expect(updated.budgetExpensesByYear['2025']).toEqual([e1])
    })
  })

  describe('nearestBudgetIncomeYear', () => {
    it('returns exact match', () => {
      const byYear = { '2024': { monthly: 1, yearly: 0 }, '2025': { monthly: 2, yearly: 0 } }
      expect(nearestBudgetIncomeYear(byYear, '2025')).toBe('2025')
    })

    it('returns nearest by distance', () => {
      const byYear = { '2020': { monthly: 1, yearly: 0 }, '2026': { monthly: 2, yearly: 0 } }
      expect(nearestBudgetIncomeYear(byYear, '2025')).toBe('2026')
    })

    it('breaks ties toward the earlier year', () => {
      const byYear = { '2023': { monthly: 1, yearly: 0 }, '2025': { monthly: 2, yearly: 0 } }
      expect(nearestBudgetIncomeYear(byYear, '2024')).toBe('2023')
    })

    it('returns null for an empty map', () => {
      expect(nearestBudgetIncomeYear({}, '2025')).toBeNull()
    })
  })

  describe('resolveBudgetIncomeForYear', () => {
    it('returns own snapshot when present', () => {
      const byYear = { '2024': { monthly: 100, yearly: 0 }, '2025': { monthly: 200, yearly: 0 } }
      expect(resolveBudgetIncomeForYear(byYear, '2025')).toEqual({ monthly: 200, yearly: 0 })
    })

    it('returns nearest year data when absent', () => {
      const byYear = { '2024': { monthly: 100, yearly: 0 } }
      expect(resolveBudgetIncomeForYear(byYear, '2025')).toEqual({ monthly: 100, yearly: 0 })
    })

    it('returns {monthly:0,yearly:0} when fully empty', () => {
      expect(resolveBudgetIncomeForYear({}, '2025')).toEqual({ monthly: 0, yearly: 0 })
    })
  })

  describe('resolveBudgetIncomeForAnalyticsYear', () => {
    const now = new Date('2026-06-01T00:00:00Z')

    it('returns own year when present', () => {
      const byYear = { '2024': { monthly: 1, yearly: 0 }, '2026': { monthly: 2, yearly: 0 } }
      expect(resolveBudgetIncomeForAnalyticsYear(byYear, '2024', now)).toEqual({ monthly: 1, yearly: 0 })
    })

    it('falls back to the CURRENT year specifically, not nearest', () => {
      const byYear = { '2024': { monthly: 1, yearly: 0 }, '2026': { monthly: 2, yearly: 0 } }
      expect(resolveBudgetIncomeForAnalyticsYear(byYear, '2020', now)).toEqual({ monthly: 2, yearly: 0 })
    })

    it('returns {monthly:0,yearly:0} when both requested and current year are absent', () => {
      const byYear = { '2024': { monthly: 1, yearly: 0 } }
      expect(resolveBudgetIncomeForAnalyticsYear(byYear, '2020', now)).toEqual({ monthly: 0, yearly: 0 })
    })
  })

  describe('seedBudgetIncomeForYear', () => {
    it('leaves an already-seeded year untouched', () => {
      const state = { ...initialState(), budgetIncomeByYear: { '2025': { monthly: 100, yearly: 0 } } }
      const updated = seedBudgetIncomeForYear(state, '2025')
      expect(updated).toBe(state)
    })

    it('copies the nearest year income as a fresh object', () => {
      const state = { ...initialState(), budgetIncomeByYear: { '2024': { monthly: 100, yearly: 0 } } }
      const updated = seedBudgetIncomeForYear(state, '2025')
      expect(updated.budgetIncomeByYear['2025']).toEqual({ monthly: 100, yearly: 0 })
      expect(updated.budgetIncomeByYear['2025']).not.toBe(state.budgetIncomeByYear['2024'])

      updated.budgetIncomeByYear['2025'].monthly = 9999
      expect(state.budgetIncomeByYear['2024'].monthly).toBe(100)
    })

    it('seeds {monthly:0,yearly:0} when there is no data anywhere', () => {
      const updated = seedBudgetIncomeForYear(initialState(), '2025')
      expect(updated.budgetIncomeByYear['2025']).toEqual({ monthly: 0, yearly: 0 })
    })
  })

  describe('rolloverBudgetIncomeIfNeeded', () => {
    const now = new Date('2026-06-01T00:00:00Z')

    it('is a no-op when the current year already has a snapshot', () => {
      const state = { ...initialState(), budgetIncomeByYear: { '2026': { monthly: 0, yearly: 0 } } }
      const updated = rolloverBudgetIncomeIfNeeded(state, now)
      expect(updated).toBe(state)
    })

    it('seeds the current year from a prior year when missing', () => {
      const state = { ...initialState(), budgetIncomeByYear: { '2024': { monthly: 100, yearly: 0 } } }
      const updated = rolloverBudgetIncomeIfNeeded(state, now)
      expect(updated.budgetIncomeByYear['2026']).toEqual({ monthly: 100, yearly: 0 })
    })

    it('stays {} when budgetIncomeByYear is entirely empty', () => {
      const updated = rolloverBudgetIncomeIfNeeded(initialState(), now)
      expect(updated.budgetIncomeByYear).toEqual({})
    })
  })

  describe('setBudgetIncome', () => {
    it('sets fields without touching other years', () => {
      const state = { ...initialState(), budgetIncomeByYear: { '2024': { monthly: 300, yearly: 0 } } }
      const updated = setBudgetIncome(state, '2025', { monthly: 4000 })
      expect(updated.budgetIncomeByYear['2025']).toEqual({ monthly: 4000, yearly: 0 })
      expect(updated.budgetIncomeByYear['2024']).toEqual({ monthly: 300, yearly: 0 })
    })

    it('seeds a not-yet-seeded year from the nearest year, then merges the patch', () => {
      const state = { ...initialState(), budgetIncomeByYear: { '2024': { monthly: 300, yearly: 500 } } }
      const updated = setBudgetIncome(state, '2025', { yearly: 900 })
      expect(updated.budgetIncomeByYear['2025']).toEqual({ monthly: 300, yearly: 900 })
    })

    it('clamps negative input to 0', () => {
      const updated = setBudgetIncome(initialState(), '2025', { monthly: -100, yearly: -50 })
      expect(updated.budgetIncomeByYear['2025']).toEqual({ monthly: 0, yearly: 0 })
    })
  })

  describe('addBudgetTransaction', () => {
    it('appends a new transaction with a generated id, preserving existing entries', () => {
      const existing: BudgetTransaction = { id: 'tx-1', date: '2026-01-01', description: 'Rent', categoryId: 'cat-Housing', amount: 2000 }
      const state = { ...initialState(), budgetTransactions: [existing] }
      const updated = addBudgetTransaction(state, { date: '2026-01-02', description: 'Groceries', categoryId: 'cat-Food', amount: 50 })
      expect(updated.budgetTransactions).toHaveLength(2)
      expect(updated.budgetTransactions[0]).toEqual(existing)
      expect(updated.budgetTransactions[1]).toMatchObject({ date: '2026-01-02', description: 'Groceries', categoryId: 'cat-Food', amount: 50 })
      expect(typeof updated.budgetTransactions[1].id).toBe('string')
      expect(updated.budgetTransactions[1].id.length).toBeGreaterThan(0)
    })
  })

  describe('updateBudgetTransaction', () => {
    it('patches the matching transaction by id', () => {
      const existing: BudgetTransaction = { id: 'tx-1', date: '2026-01-01', description: 'Rent', categoryId: 'cat-Housing', amount: 2000 }
      const state = { ...initialState(), budgetTransactions: [existing] }
      const updated = updateBudgetTransaction(state, 'tx-1', { amount: 2100 })
      expect(updated.budgetTransactions[0]).toEqual({ ...existing, amount: 2100 })
    })

    it('is a no-op when the id is not found', () => {
      const existing: BudgetTransaction = { id: 'tx-1', date: '2026-01-01', description: 'Rent', categoryId: 'cat-Housing', amount: 2000 }
      const state = { ...initialState(), budgetTransactions: [existing] }
      const updated = updateBudgetTransaction(state, 'missing', { amount: 9999 })
      expect(updated.budgetTransactions).toEqual([existing])
    })
  })

  describe('updateBudgetTransactionsBulk', () => {
    const t1: BudgetTransaction = { id: 'tx-1', date: '2026-01-01', description: 'Rent', categoryId: 'cat-Housing', amount: 2000 }
    const t2: BudgetTransaction = { id: 'tx-2', date: '2026-01-02', description: 'Groceries', categoryId: 'cat-Food', amount: 50 }
    const t3: BudgetTransaction = { id: 'tx-3', date: '2026-01-03', description: 'Gas', categoryId: 'cat-Auto', amount: 40 }

    it('patches categoryId on the matching ids, leaving others untouched', () => {
      const state = { ...initialState(), budgetTransactions: [t1, t2, t3] }
      const updated = updateBudgetTransactionsBulk(state, ['tx-1', 'tx-3'], 'cat-Misc')
      expect(updated.budgetTransactions[0]).toEqual({ ...t1, categoryId: 'cat-Misc' })
      expect(updated.budgetTransactions[1]).toEqual(t2)
      expect(updated.budgetTransactions[2]).toEqual({ ...t3, categoryId: 'cat-Misc' })
    })

    it('is a no-op when ids is empty', () => {
      const state = { ...initialState(), budgetTransactions: [t1, t2, t3] }
      const updated = updateBudgetTransactionsBulk(state, [], 'cat-Misc')
      expect(updated.budgetTransactions).toEqual([t1, t2, t3])
    })

    it('silently ignores ids not found in budgetTransactions', () => {
      const state = { ...initialState(), budgetTransactions: [t1, t2] }
      const updated = updateBudgetTransactionsBulk(state, ['tx-1', 'missing'], 'cat-Misc')
      expect(updated.budgetTransactions[0]).toEqual({ ...t1, categoryId: 'cat-Misc' })
      expect(updated.budgetTransactions[1]).toEqual(t2)
    })

    it('does not touch other AppState fields', () => {
      const state = { ...initialState(), budgetTransactions: [t1, t2, t3] }
      const updated = updateBudgetTransactionsBulk(state, ['tx-1'], 'cat-Misc')
      expect(updated.accounts).toBe(state.accounts)
      expect(updated.transactions).toBe(state.transactions)
    })
  })

  describe('deleteBudgetTransaction', () => {
    it('removes the matching transaction by id', () => {
      const t1: BudgetTransaction = { id: 'tx-1', date: '2026-01-01', description: 'Rent', categoryId: 'cat-Housing', amount: 2000 }
      const t2: BudgetTransaction = { id: 'tx-2', date: '2026-01-02', description: 'Groceries', categoryId: 'cat-Food', amount: 50 }
      const state = { ...initialState(), budgetTransactions: [t1, t2] }
      const updated = deleteBudgetTransaction(state, 'tx-1')
      expect(updated.budgetTransactions).toEqual([t2])
    })

    it('is a no-op when the id is not found', () => {
      const t1: BudgetTransaction = { id: 'tx-1', date: '2026-01-01', description: 'Rent', categoryId: 'cat-Housing', amount: 2000 }
      const state = { ...initialState(), budgetTransactions: [t1] }
      const updated = deleteBudgetTransaction(state, 'missing')
      expect(updated.budgetTransactions).toEqual([t1])
    })
  })

  describe('importBudgetTransactions', () => {
    const categories: Category[] = [
      { id: 'cat-other', name: 'Other' },
      { id: 'cat-housing', name: 'Housing' },
      { id: 'cat-food', name: 'Food' },
    ]

    it('skips a row matching an existing (date,description,categoryId,amount) exactly', () => {
      const existing: BudgetTransaction = { id: 'tx-1', date: '2026-01-01', description: 'Rent', categoryId: 'cat-other', amount: 2000 }
      const state = { ...initialState(), budgetTransactions: [existing] }
      const updated = importBudgetTransactions(state, [
        { date: '2026-01-01', description: 'Rent', amount: 2000 },
      ], categories, [])
      expect(updated.budgetTransactions).toEqual([existing])
    })

    it('adds a row differing in any one field from an existing transaction', () => {
      const existing: BudgetTransaction = { id: 'tx-1', date: '2026-01-01', description: 'Rent', categoryId: 'cat-other', amount: 2000 }
      const state = { ...initialState(), budgetTransactions: [existing] }
      const updated = importBudgetTransactions(state, [
        { date: '2026-01-01', description: 'Rent', amount: 2001 },
      ], categories, [])
      expect(updated.budgetTransactions).toHaveLength(2)
      expect(updated.budgetTransactions[1]).toMatchObject({ date: '2026-01-01', description: 'Rent', categoryId: 'cat-other', amount: 2001 })
    })

    it('dedups two identical rows within the same import batch, adding only one', () => {
      const state = initialState()
      const row = { date: '2026-01-01', description: 'Coffee', amount: 5 }
      const updated = importBudgetTransactions(state, [row, row], categories, [])
      expect(updated.budgetTransactions).toHaveLength(1)
      expect(updated.budgetTransactions[0]).toMatchObject({ ...row, categoryId: 'cat-other' })
    })

    it('dedups rows with no accountName (both undefined) as before, regression', () => {
      const existing: BudgetTransaction = { id: 'tx-1', date: '2026-01-01', description: 'Rent', categoryId: 'cat-other', amount: 2000 }
      const state = { ...initialState(), budgetTransactions: [existing] }
      const updated = importBudgetTransactions(state, [
        { date: '2026-01-01', description: 'Rent', amount: 2000 },
      ], categories, [])
      expect(updated.budgetTransactions).toEqual([existing])
    })

    it('keeps two rows identical on date/description/categoryId/amount but differing accountName', () => {
      const state = initialState()
      const rowA = { date: '2026-01-01', description: 'Rent', amount: 2000, accountName: 'Checking' }
      const rowB = { date: '2026-01-01', description: 'Rent', amount: 2000, accountName: 'Savings' }
      const updated = importBudgetTransactions(state, [rowA, rowB], categories, [])
      expect(updated.budgetTransactions).toHaveLength(2)
      expect(updated.budgetTransactions[0]).toMatchObject({ ...rowA, categoryId: 'cat-other' })
      expect(updated.budgetTransactions[1]).toMatchObject({ ...rowB, categoryId: 'cat-other' })
    })

    it('drops the second row when date/description/categoryId/amount/accountName all match', () => {
      const state = initialState()
      const row = { date: '2026-01-01', description: 'Rent', amount: 2000, accountName: 'Checking' }
      const updated = importBudgetTransactions(state, [row, { ...row }], categories, [])
      expect(updated.budgetTransactions).toHaveLength(1)
      expect(updated.budgetTransactions[0]).toMatchObject({ ...row, categoryId: 'cat-other' })
    })

    it('resolves categoryId from a matching category mapping instead of defaulting to Other', () => {
      const state = initialState()
      const mappings: CategoryMapping[] = [
        { id: 'm1', substring: 'rent', categoryId: 'cat-housing', updatedAt: '2026-01-01T00:00:00Z' },
      ]
      const updated = importBudgetTransactions(state, [
        { date: '2026-01-01', description: 'Monthly Rent Payment', amount: 2000 },
      ], categories, mappings)
      expect(updated.budgetTransactions[0].categoryId).toBe('cat-housing')
    })

    it('falls back to the "Other" category id when no mapping matches', () => {
      const state = initialState()
      const mappings: CategoryMapping[] = [
        { id: 'm1', substring: 'rent', categoryId: 'cat-housing', updatedAt: '2026-01-01T00:00:00Z' },
      ]
      const updated = importBudgetTransactions(state, [
        { date: '2026-01-02', description: 'Coffee Shop', amount: -5 },
      ], categories, mappings)
      expect(updated.budgetTransactions[0].categoryId).toBe('cat-other')
    })

    it('when two mappings match the same description, the mapping with the latest updatedAt wins', () => {
      const state = initialState()
      const mappings: CategoryMapping[] = [
        { id: 'm1', substring: 'coffee', categoryId: 'cat-food', updatedAt: '2026-01-01T00:00:00Z' },
        { id: 'm2', substring: 'coffee shop', categoryId: 'cat-housing', updatedAt: '2026-02-01T00:00:00Z' },
      ]
      const updated = importBudgetTransactions(state, [
        { date: '2026-01-02', description: 'Coffee Shop', amount: -5 },
      ], categories, mappings)
      expect(updated.budgetTransactions[0].categoryId).toBe('cat-housing')
    })
  })

  describe('replaceImportedState', () => {
    // Cast (rather than annotate) as ExportableState: this fixture includes
    // budgetIncomeByYear/budgetExpensesByYear
    // which are not yet part of the ExportableState type (owned by a
    // parallel task on importExport.ts) — the cast avoids an excess-property
    // error until that type is widened.
    const sampleData = {
      accounts: [
        {
          id: 'acc-imported',
          accountNumber: '999999',
          name: 'Imported Account',
          institution: 'Fidelity',
          taxCategory: 'taxable',
          retirement: false,
          createdAt: '2025-01-01T00:00:00Z',
        },
      ],
      positions: [
        {
          id: 'pos-imported',
          accountId: 'acc-imported',
          symbol: 'AAPL',
          name: 'Apple Inc.',
          assetClass: 'Equity',
          shares: 10,
          avgCost: 100,
          price: 150,
          lastImportedAt: '2025-01-01T00:00:00Z',
        },
      ],
      closedPositions: [
        {
          id: 'closed-imported',
          accountId: 'acc-imported',
          symbol: 'MSFT',
          name: 'Microsoft',
          closedDate: '2025-01-01',
          assetClass: 'Equity',
          shares: 5,
          avgCost: 50,
          price: 60,
          lastImportedAt: '2025-01-01T00:00:00Z',
          realizedGL: 50,
          realizedGLBasis: 'transactions',
        },
      ],
      transactions: [
        {
          id: 'tx-imported',
          accountId: 'acc-imported',
          date: '2025-01-01',
          symbol: 'AAPL',
          type: 'Buy',
          shares: 10,
          price: 100,
          amount: 1000,
          importedAt: '2025-01-01T00:00:00Z',
        },
      ],
      snapshots: [
        { id: 'snap-imported', accountId: 'acc-imported', date: '2025-01-01', value: 1500 },
      ],
      csvMappings: [
        {
          id: 'mapping-imported',
          accountId: 'acc-imported',
          kind: 'positions',
          fieldMap: { Symbol: 'symbol' },
          updatedAt: '2025-01-01T00:00:00Z',
        },
      ],
      customInstitutions: ['Imported Bank'],
      balanceEntries: [
        {
          id: 'bal-imported',
          accountId: 'acc-imported',
          date: '2025-01-01',
          balance: 5000,
          activities: [],
        },
      ],
      priceSync: {
        apiKey: 'imported-price-key',
        lastRun: { at: '2025-01-01T00:00:00Z', updatedCount: 3, notFound: [], marketTickerCount: 100 },
      },
      mutualFundSync: {
        apiKey: 'imported-mf-key',
        lastRun: { at: '2025-01-01T00:00:00Z', updatedCount: 1, notFound: [], marketTickerCount: 0 },
      },
      budgetIncomeByYear: { '2025': { monthly: 6000, yearly: 72000 } },
      budgetExpensesByYear: {
        '2025': [{ id: 'exp-imported', name: 'Rent', categoryId: 'cat-housing', amount: 2000, frequency: 'monthly' }],
      },
    } as ExportableState

    it('replaces the 8 data collections and apiKey/lastRun, preserving cached prices and UI state', () => {
      const original: AppState = {
        ...initialState(),
        accounts: [
          {
            id: 'acc-old',
            accountNumber: '111111',
            name: 'Old Account',
            institution: 'Chase',
            taxCategory: 'taxable',
            retirement: false,
            createdAt: '2024-01-01T00:00:00Z',
          },
        ],
        priceSync: {
          apiKey: 'old-price-key',
          lastFetchedDate: '2024-06-01',
          heldPrices: { AAPL: { price: 200, date: '2024-06-01', fetchedAt: '2024-06-01T00:00:00Z' } },
          lastRun: { at: '2024-06-01T00:00:00Z', updatedCount: 1, notFound: [], marketTickerCount: 50 },
        },
        mutualFundSync: {
          apiKey: 'old-mf-key',
          heldPrices: { VTSAX: { price: 100, date: '2024-06-01', fetchedAt: '2024-06-01T00:00:00Z' } },
          lastRun: { at: '2024-06-01T00:00:00Z', updatedCount: 1, notFound: [], marketTickerCount: 0 },
          callBudget: { date: '2024-06-01', callsUsed: 5 },
        },
        view: 'register',
        sortKey: 'shares',
        sortDir: 'desc',
        selectedAccountId: 'acc-old',
        selectedCategoryKey: 'taxable',
      }

      const updated = replaceImportedState(original, sampleData)

      expect(updated.accounts).toEqual(sampleData.accounts)
      expect(updated.positions).toEqual(sampleData.positions)
      expect(updated.closedPositions).toEqual(sampleData.closedPositions)
      expect(updated.transactions).toEqual(sampleData.transactions)
      expect(updated.snapshots).toEqual(sampleData.snapshots)
      expect(updated.csvMappings).toEqual(sampleData.csvMappings)
      expect(updated.customInstitutions).toEqual(sampleData.customInstitutions)
      expect(updated.balanceEntries).toEqual(sampleData.balanceEntries)
      expect(updated.budgetIncomeByYear).toEqual(sampleData.budgetIncomeByYear)
      expect(updated.budgetExpensesByYear).toEqual(sampleData.budgetExpensesByYear)

      expect(updated.priceSync.apiKey).toBe(sampleData.priceSync.apiKey)
      expect(updated.priceSync.lastRun).toEqual(sampleData.priceSync.lastRun)
      expect(updated.mutualFundSync.apiKey).toBe(sampleData.mutualFundSync.apiKey)
      expect(updated.mutualFundSync.lastRun).toEqual(sampleData.mutualFundSync.lastRun)

      // Cached price data untouched
      expect(updated.priceSync.heldPrices).toEqual(original.priceSync.heldPrices)
      expect(updated.priceSync.lastFetchedDate).toEqual(original.priceSync.lastFetchedDate)
      expect(updated.mutualFundSync.heldPrices).toEqual(original.mutualFundSync.heldPrices)
      expect(updated.mutualFundSync.callBudget).toEqual(original.mutualFundSync.callBudget)

      // UI state untouched
      expect(updated.view).toEqual(original.view)
      expect(updated.sortKey).toEqual(original.sortKey)
      expect(updated.sortDir).toEqual(original.sortDir)
      expect(updated.selectedAccountId).toEqual(original.selectedAccountId)
      expect(updated.selectedCategoryKey).toEqual(original.selectedCategoryKey)
    })

    it('fully replaces existing data with an empty backup rather than merging', () => {
      const original: AppState = {
        ...initialState(),
        accounts: sampleData.accounts,
        positions: sampleData.positions,
        closedPositions: sampleData.closedPositions,
        transactions: sampleData.transactions,
        snapshots: sampleData.snapshots,
        csvMappings: sampleData.csvMappings,
        customInstitutions: sampleData.customInstitutions,
        balanceEntries: sampleData.balanceEntries,
      }

      const emptyData: ExportableState = {
        accounts: [],
        positions: [],
        closedPositions: [],
        transactions: [],
        snapshots: [],
        csvMappings: [],
        customInstitutions: [],
        balanceEntries: [],
        priceSync: { apiKey: '', lastRun: null },
        mutualFundSync: { apiKey: '', lastRun: null },
      }

      const updated = replaceImportedState(original, emptyData)

      expect(updated.accounts).toEqual([])
      expect(updated.positions).toEqual([])
      expect(updated.closedPositions).toEqual([])
      expect(updated.transactions).toEqual([])
      expect(updated.snapshots).toEqual([])
      expect(updated.csvMappings).toEqual([])
      expect(updated.customInstitutions).toEqual([])
      expect(updated.balanceEntries).toEqual([])
      expect(updated.priceSync.apiKey).toBe('')
      expect(updated.priceSync.lastRun).toBeNull()
      expect(updated.mutualFundSync.apiKey).toBe('')
      expect(updated.mutualFundSync.lastRun).toBeNull()
    })
  })

})
