import { describe, it, expect } from 'vitest'
import { initialState } from './lib/state'
import { appReducer } from './lib/reducer'
import { importPositions } from './lib/positionsImport'
import { importTransactions } from './lib/transactionsImport'
import type { MappingProfile } from './lib/types'

describe('pending import processing', () => {
  it('should import positions when pendingImport is processed', () => {
    let state = initialState()

    // Create an account first
    state = appReducer(state, {
      type: 'ADD_ACCOUNT',
      account: {
        id: 'acc-1',
        accountNumber: '12345',
        name: 'Brokerage',
        taxCategory: 'Taxable',
        retirement: false,
        createdAt: '2024-01-01T00:00:00Z',
      },
    })

    // Create a mapping profile that maps to account number column
    const profile: MappingProfile = {
      id: 'map-1',
      name: 'Test Profile',
      kind: 'positions',
      fieldMap: {
        'Account Number': 'accountNumber',
        'Symbol': 'symbol',
        'Name': 'name',
        'Asset Class': 'assetClass',
        'Shares': 'shares',
        'Avg Cost': 'avgCost',
        'Price': 'price',
      },
      accountNumberColumn: 'Account Number',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    }

    state = appReducer(state, {
      type: 'ADD_MAPPING_PROFILE',
      profile,
    })

    // Verify account and profile are set up
    expect(state.accounts).toHaveLength(1)
    expect(state.mappingProfiles).toHaveLength(1)

    // Create mapped rows (as they would come from applyMapping)
    const mappedRows = [
      {
        accountNumber: '12345',
        symbol: 'AAPL',
        name: 'Apple',
        assetClass: 'Equities',
        shares: '100',
        avgCost: '150',
        price: '180',
      },
    ]

    // Directly call importPositions (simulating what App.tsx effect would do)
    state = importPositions(state, 'acc-1', mappedRows, '2024-01-15')

    // Verify positions were imported
    expect(state.positions).toHaveLength(1)
    expect(state.positions[0].symbol).toBe('AAPL')
    expect(state.positions[0].accountId).toBe('acc-1')
    expect(state.positions[0].shares).toBe(100)

    // Verify snapshot was created
    expect(state.snapshots).toHaveLength(1)
    expect(state.snapshots[0].accountId).toBe('acc-1')
  })

  it('should import transactions when pendingImport is processed', () => {
    let state = initialState()

    // Create an account first
    state = appReducer(state, {
      type: 'ADD_ACCOUNT',
      account: {
        id: 'acc-1',
        accountNumber: '12345',
        name: 'Brokerage',
        taxCategory: 'Taxable',
        retirement: false,
        createdAt: '2024-01-01T00:00:00Z',
      },
    })

    // Create a mapping profile for transactions
    const profile: MappingProfile = {
      id: 'map-tx-1',
      name: 'Test TX Profile',
      kind: 'transactions',
      fieldMap: {
        'Account Number': 'accountNumber',
        'Date': 'date',
        'Symbol': 'symbol',
        'Type': 'type',
        'Shares': 'shares',
        'Price': 'price',
      },
      accountNumberColumn: 'Account Number',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    }

    state = appReducer(state, {
      type: 'ADD_MAPPING_PROFILE',
      profile,
    })

    // Create mapped rows (as they would come from applyMapping)
    const mappedRows = [
      {
        accountNumber: '12345',
        date: '2024-01-10',
        symbol: 'AAPL',
        type: 'Buy',
        shares: '100',
        price: '150',
      },
    ]

    // Directly call importTransactions (simulating what App.tsx effect would do)
    state = importTransactions(state, 'acc-1', mappedRows)

    // Verify transactions were imported
    expect(state.transactions).toHaveLength(1)
    expect(state.transactions[0].symbol).toBe('AAPL')
    expect(state.transactions[0].accountId).toBe('acc-1')
    expect(state.transactions[0].type).toBe('Buy')
  })
})
