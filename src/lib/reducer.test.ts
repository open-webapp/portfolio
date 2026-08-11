import { describe, it, expect } from 'vitest'
import { appReducer } from './reducer'
import { closePosition, initialState } from './state'
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
            taxCategory: 'taxable',
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
            taxes: null,
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
})
