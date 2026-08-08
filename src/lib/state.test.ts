import { describe, it, expect } from 'vitest'
import {
  initialState,
  addImportSession,
  deleteImportSession,
  deleteAccount,
  setView,
} from './state'
import type { AppState, ImportSession, Position, ClosedPosition, Transaction, PortfolioSnapshot } from './types'

describe('state helpers', () => {
  describe('addImportSession', () => {
    it('appends new session at front (newest-first ordering)', () => {
      const state = initialState()
      const session1: ImportSession = {
        id: 'session1',
        importedAt: '2024-01-01T10:00:00Z',
        kind: 'positions',
        fileName: 'positions.csv',
        accountIds: ['acc1'],
        rowCount: 10,
      }
      const session2: ImportSession = {
        id: 'session2',
        importedAt: '2024-01-02T10:00:00Z',
        kind: 'positions',
        fileName: 'positions2.csv',
        accountIds: ['acc1'],
        rowCount: 15,
      }

      let updated = addImportSession(state, session1)
      expect(updated.importSessions).toHaveLength(1)
      expect(updated.importSessions[0].id).toBe('session1')

      updated = addImportSession(updated, session2)
      expect(updated.importSessions).toHaveLength(2)
      expect(updated.importSessions[0].id).toBe('session2')
      expect(updated.importSessions[1].id).toBe('session1')
    })

    it('pushing a 51st session drops the oldest (list length stays 50, the dropped one is the one that was previously oldest/last)', () => {
      let state = initialState()

      // Add 50 sessions
      for (let i = 1; i <= 50; i++) {
        const session: ImportSession = {
          id: `session${i}`,
          importedAt: `2024-01-${String(i).padStart(2, '0')}T10:00:00Z`,
          kind: 'positions',
          fileName: `positions${i}.csv`,
          accountIds: ['acc1'],
          rowCount: 10 * i,
        }
        state = addImportSession(state, session)
      }

      expect(state.importSessions).toHaveLength(50)
      // The newest should be session50
      expect(state.importSessions[0].id).toBe('session50')
      // The oldest should be session1
      expect(state.importSessions[49].id).toBe('session1')

      // Now add the 51st session
      const session51: ImportSession = {
        id: 'session51',
        importedAt: '2024-02-20T10:00:00Z',
        kind: 'positions',
        fileName: 'positions51.csv',
        accountIds: ['acc1'],
        rowCount: 510,
      }
      state = addImportSession(state, session51)

      // Should still be 50
      expect(state.importSessions).toHaveLength(50)
      // Newest should be session51
      expect(state.importSessions[0].id).toBe('session51')
      // session1 should be dropped, oldest should now be session2
      expect(state.importSessions[49].id).toBe('session2')
      // Verify session1 is gone
      expect(state.importSessions.find((s) => s.id === 'session1')).toBeUndefined()
    })

    it('pushing when list has fewer than 50 just appends, no eviction', () => {
      let state = initialState()

      // Add 30 sessions
      for (let i = 1; i <= 30; i++) {
        const session: ImportSession = {
          id: `session${i}`,
          importedAt: `2024-01-${String(i).padStart(2, '0')}T10:00:00Z`,
          kind: 'positions',
          fileName: `positions${i}.csv`,
          accountIds: ['acc1'],
          rowCount: 10 * i,
        }
        state = addImportSession(state, session)
      }

      expect(state.importSessions).toHaveLength(30)
      expect(state.importSessions[0].id).toBe('session30')
      expect(state.importSessions[29].id).toBe('session1')

      // Add one more (total 31, still under 50)
      const session31: ImportSession = {
        id: 'session31',
        importedAt: '2024-02-20T10:00:00Z',
        kind: 'positions',
        fileName: 'positions31.csv',
        accountIds: ['acc1'],
        rowCount: 310,
      }
      state = addImportSession(state, session31)

      expect(state.importSessions).toHaveLength(31)
      expect(state.importSessions[0].id).toBe('session31')
      expect(state.importSessions[30].id).toBe('session1')
    })
  })

  describe('deleteImportSession', () => {
    it('removes the ImportSession entry from importSessions', () => {
      const state: AppState = {
        ...initialState(),
        importSessions: [
          {
            id: 'session1',
            importedAt: '2024-01-01T10:00:00Z',
            kind: 'positions',
            fileName: 'positions.csv',
            accountIds: ['acc1'],
            rowCount: 10,
          },
          {
            id: 'session2',
            importedAt: '2024-01-02T10:00:00Z',
            kind: 'positions',
            fileName: 'positions2.csv',
            accountIds: ['acc1'],
            rowCount: 15,
          },
        ],
      }

      const updated = deleteImportSession(state, 'session1')
      expect(updated.importSessions).toHaveLength(1)
      expect(updated.importSessions[0].id).toBe('session2')
    })

    it('removes all Position/ClosedPosition/Transaction/PortfolioSnapshot rows with matching importSessionId, leaves rows from other sessions untouched', () => {
      const state: AppState = {
        ...initialState(),
        positions: [
          {
            id: 'pos1',
            importSessionId: 'session1',
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
            importSessionId: 'session2',
            accountId: 'acc1',
            symbol: 'MSFT',
            name: 'Microsoft Corp.',
            assetClass: 'Equity',
            shares: 50,
            avgCost: 300,
            price: 350,
            taxes: null,
            lastImportedAt: '2024-01-02T10:00:00Z',
          },
        ],
        closedPositions: [
          {
            id: 'closed1',
            importSessionId: 'session1',
            accountId: 'acc1',
            symbol: 'TSLA',
            name: 'Tesla Inc.',
            closedDate: '2023-12-31',
            assetClass: 'Equity',
            realizedGL: 5000,
            realizedGLBasis: 'transactions',
          },
          {
            id: 'closed2',
            importSessionId: 'session2',
            accountId: 'acc1',
            symbol: 'GOOGL',
            name: 'Alphabet Inc.',
            closedDate: '2023-12-30',
            assetClass: 'Equity',
            realizedGL: 3000,
            realizedGLBasis: 'transactions',
          },
        ],
        transactions: [
          {
            id: 'tx1',
            importSessionId: 'session1',
            accountId: 'acc1',
            date: '2024-01-01',
            symbol: 'AAPL',
            type: 'Buy',
            shares: 100,
            price: 150,
            amount: 15000,
            taxes: null,
            importedAt: '2024-01-01T10:00:00Z',
          },
          {
            id: 'tx2',
            importSessionId: 'session2',
            accountId: 'acc1',
            date: '2024-01-02',
            symbol: 'MSFT',
            type: 'Buy',
            shares: 50,
            price: 300,
            amount: 15000,
            taxes: null,
            importedAt: '2024-01-02T10:00:00Z',
          },
        ],
        snapshots: [
          {
            id: 'snap1',
            importSessionId: 'session1',
            accountId: 'acc1',
            date: '2024-01-01',
            value: 50000,
          },
          {
            id: 'snap2',
            importSessionId: 'session2',
            accountId: 'acc1',
            date: '2024-01-02',
            value: 60000,
          },
        ],
        importSessions: [
          {
            id: 'session1',
            importedAt: '2024-01-01T10:00:00Z',
            kind: 'positions',
            fileName: 'positions.csv',
            accountIds: ['acc1'],
            rowCount: 10,
          },
          {
            id: 'session2',
            importedAt: '2024-01-02T10:00:00Z',
            kind: 'positions',
            fileName: 'positions2.csv',
            accountIds: ['acc1'],
            rowCount: 15,
          },
        ],
      }

      const updated = deleteImportSession(state, 'session1')

      // Check positions
      expect(updated.positions).toHaveLength(1)
      expect(updated.positions[0].id).toBe('pos2')

      // Check closed positions
      expect(updated.closedPositions).toHaveLength(1)
      expect(updated.closedPositions[0].id).toBe('closed2')

      // Check transactions
      expect(updated.transactions).toHaveLength(1)
      expect(updated.transactions[0].id).toBe('tx2')

      // Check snapshots
      expect(updated.snapshots).toHaveLength(1)
      expect(updated.snapshots[0].id).toBe('snap2')

      // Check import sessions
      expect(updated.importSessions).toHaveLength(1)
      expect(updated.importSessions[0].id).toBe('session2')
    })

    it('no-op-safe when called on a session whose rows were already superseded by a later import on the same account (i.e. nothing currently in state.positions has that importSessionId anymore) — doesn\'t throw, just removes the now-orphaned ImportSession log entry', () => {
      const state: AppState = {
        ...initialState(),
        positions: [
          {
            id: 'pos1',
            importSessionId: 'session2',
            accountId: 'acc1',
            symbol: 'AAPL',
            name: 'Apple Inc.',
            assetClass: 'Equity',
            shares: 100,
            avgCost: 150,
            price: 180,
            taxes: null,
            lastImportedAt: '2024-01-02T10:00:00Z',
          },
        ],
        closedPositions: [],
        transactions: [],
        snapshots: [],
        importSessions: [
          {
            id: 'session1',
            importedAt: '2024-01-01T10:00:00Z',
            kind: 'positions',
            fileName: 'positions.csv',
            accountIds: ['acc1'],
            rowCount: 10,
          },
          {
            id: 'session2',
            importedAt: '2024-01-02T10:00:00Z',
            kind: 'positions',
            fileName: 'positions2.csv',
            accountIds: ['acc1'],
            rowCount: 15,
          },
        ],
      }

      // Delete session1 even though no rows have that importSessionId
      const updated = deleteImportSession(state, 'session1')

      // Should not throw and should remove the orphaned session entry
      expect(updated.importSessions).toHaveLength(1)
      expect(updated.importSessions[0].id).toBe('session2')
      // Positions should remain unchanged
      expect(updated.positions).toHaveLength(1)
      expect(updated.positions[0].importSessionId).toBe('session2')
    })

    it('calling with an unknown sessionId is a no-op (returns state with same collections, doesn\'t throw)', () => {
      const state: AppState = {
        ...initialState(),
        positions: [
          {
            id: 'pos1',
            importSessionId: 'session1',
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
        importSessions: [
          {
            id: 'session1',
            importedAt: '2024-01-01T10:00:00Z',
            kind: 'positions',
            fileName: 'positions.csv',
            accountIds: ['acc1'],
            rowCount: 10,
          },
        ],
      }

      // Call with unknown sessionId
      const updated = deleteImportSession(state, 'unknownSessionId')

      // Should not throw and state should be unchanged
      expect(updated.positions).toHaveLength(1)
      expect(updated.positions[0].id).toBe('pos1')
      expect(updated.importSessions).toHaveLength(1)
      expect(updated.importSessions[0].id).toBe('session1')
    })
  })

  describe('deleteAccount', () => {
    it('a session touching only the deleted account is removed entirely from importSessions', () => {
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
            importSessionId: 'session1',
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
        importSessions: [
          {
            id: 'session1',
            importedAt: '2024-01-01T10:00:00Z',
            kind: 'positions',
            fileName: 'positions.csv',
            accountIds: ['acc1'],
            rowCount: 10,
          },
          {
            id: 'session2',
            importedAt: '2024-01-02T10:00:00Z',
            kind: 'positions',
            fileName: 'positions2.csv',
            accountIds: ['acc2'],
            rowCount: 15,
          },
        ],
      }

      const updated = deleteAccount(state, 'acc1')

      // acc1 should be removed
      expect(updated.accounts).toHaveLength(1)
      expect(updated.accounts[0].id).toBe('acc2')

      // Positions for acc1 should be removed
      expect(updated.positions).toHaveLength(0)

      // session1 (which only touched acc1) should be removed
      expect(updated.importSessions).toHaveLength(1)
      expect(updated.importSessions[0].id).toBe('session2')
    })

    it('a session touching the deleted account AND another surviving account keeps the entry, with the deleted id removed from accountIds (and the other id still present)', () => {
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
            importSessionId: 'session1',
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
            importSessionId: 'session1',
            accountId: 'acc2',
            symbol: 'MSFT',
            name: 'Microsoft Corp.',
            assetClass: 'Equity',
            shares: 50,
            avgCost: 300,
            price: 350,
            taxes: null,
            lastImportedAt: '2024-01-01T10:00:00Z',
          },
        ],
        importSessions: [
          {
            id: 'session1',
            importedAt: '2024-01-01T10:00:00Z',
            kind: 'positions',
            fileName: 'positions.csv',
            accountIds: ['acc1', 'acc2'],
            rowCount: 25,
          },
        ],
      }

      const updated = deleteAccount(state, 'acc1')

      // acc1 should be removed
      expect(updated.accounts).toHaveLength(1)
      expect(updated.accounts[0].id).toBe('acc2')

      // Position for acc1 should be removed, acc2 position should remain
      expect(updated.positions).toHaveLength(1)
      expect(updated.positions[0].accountId).toBe('acc2')

      // session1 should still exist but with acc1 removed from accountIds
      expect(updated.importSessions).toHaveLength(1)
      expect(updated.importSessions[0].id).toBe('session1')
      expect(updated.importSessions[0].accountIds).toEqual(['acc2'])
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
})
