import { describe, it, expect } from 'vitest'
import { appReducer } from './reducer'
import { closePosition, restoreClosedPosition, initialState } from './state'
import type { AppState } from './types'

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

  describe('SET_ASSET_CLASS_FILTER', () => {
    it('sets assetClassFilter from action.assetClass', () => {
      const state: AppState = { ...initialState() }

      const result = appReducer(state, { type: 'SET_ASSET_CLASS_FILTER', assetClass: 'Equity' })

      expect(result.assetClassFilter).toBe('Equity')
    })
  })

  describe('SELECT_ACCOUNT', () => {
    it('sets selectedAccountId from action.accountId', () => {
      const state: AppState = { ...initialState(), selectedAccountId: null }

      const result = appReducer(state, { type: 'SELECT_ACCOUNT', accountId: 'acc1' })

      expect(result.selectedAccountId).toBe('acc1')
    })

    it('toggles to null when selecting the same account twice', () => {
      const state: AppState = { ...initialState(), selectedAccountId: 'acc1' }

      const result = appReducer(state, { type: 'SELECT_ACCOUNT', accountId: 'acc1' })

      expect(result.selectedAccountId).toBeNull()
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
})
