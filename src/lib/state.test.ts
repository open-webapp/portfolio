import { describe, it, expect } from 'vitest'
import {
  initialState,
  deleteAccount,
  upsertCsvMapping,
  setView,
  closePosition,
  selectAccount,
  toggleCategoryExpanded,
  setAcctAssetClassFilter,
  setAcctPosSearch,
} from './state'
import type { AppState } from './types'

describe('state helpers', () => {
  describe('initialState', () => {
    it('selectedCategoryKey defaults to null', () => {
      const state = initialState()
      expect(state.selectedCategoryKey).toBeNull()
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
})
