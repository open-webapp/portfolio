import { describe, it, expect } from 'vitest'
import {
  initialState,
  deleteAccount,
  upsertCsvMapping,
  setView,
  closePosition,
} from './state'
import type { AppState, Position, ClosedPosition, Transaction, PortfolioSnapshot, SavedCsvMapping } from './types'

describe('state helpers', () => {
  describe('deleteAccount', () => {
    it('removes account and associated positions', () => {
      const state: AppState = {
        ...initialState(),
        accounts: [
          {
            id: 'acc1',
            accountNumber: '123456',
            name: 'Account 1',
            taxCategory: 'taxable',
            retirement: false,
            createdAt: '2024-01-01T10:00:00Z',
          },
          {
            id: 'acc2',
            accountNumber: '234567',
            name: 'Account 2',
            taxCategory: 'taxDeferred',
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
            taxes: null,
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
            taxCategory: 'taxable',
            retirement: false,
            createdAt: '2024-01-01T10:00:00Z',
          },
          {
            id: 'acc2',
            accountNumber: '234567',
            name: 'Account 2',
            taxCategory: 'taxDeferred',
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
    it('toggles between "dashboard" and "settings"', () => {
      const state = initialState()
      expect(state.view).toBe('dashboard')

      const toSettings = setView(state, 'settings')
      expect(toSettings.view).toBe('settings')

      const toDashboard = setView(toSettings, 'dashboard')
      expect(toDashboard.view).toBe('dashboard')
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
            taxCategory: 'taxable',
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
            taxes: null,
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
          {
            id: 'pos2',
            accountId: 'acc1',
            symbol: 'MSFT',
            name: 'Microsoft Inc.',
            assetClass: 'Equity',
            shares: 50,
            avgCost: 200,
            price: 250,
            taxes: null,
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

      const updated = closePosition(state, 'nonexistent-id')

      // State should be unchanged
      expect(updated).toEqual(state)
      expect(updated.positions).toHaveLength(1)
      expect(updated.closedPositions).toHaveLength(0)
    })
  })
})
