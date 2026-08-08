import { describe, it, expect } from 'vitest'
import { importPositions } from './positionsImport'
import { initialState, addAccount } from './state'
import type { Account, Position, ClosedPosition, Transaction } from './types'
import { createProfile, validateProfile } from './mappingProfiles'
import { uid } from './seed'

// Helper to create test accounts
function createTestAccount(
  accountNumber: string,
  name: string,
  taxCategory: 'taxable' | 'taxDeferred' | 'nonTaxable',
  retirement: boolean
): Account {
  return {
    id: uid('acc'),
    accountNumber,
    name,
    taxCategory,
    retirement,
    createdAt: new Date().toISOString(),
  }
}

describe('positionsImport', () => {
  // Test 1: Re-importing REPLACES account's positions; old position not in new CSV is gone
  it('Test 1: Re-importing replaces all positions for an account', () => {
    // Setup: Create an account and initial positions
    let state = initialState()
    state = addAccount(state, createTestAccount('ACC-001', 'Account 1', 'taxable', false))
    const accountId = state.accounts[0].id

    // Add initial positions
    state.positions = [
      {
        id: 'pos-1',
        accountId,
        symbol: 'AAPL',
        name: 'Apple Inc.',
        assetClass: 'Equity',
        shares: 100,
        avgCost: 150,
        price: 200,
        lastImportedAt: '2026-01-01',
      },
      {
        id: 'pos-2',
        accountId,
        symbol: 'MSFT',
        name: 'Microsoft Corp.',
        assetClass: 'Equity',
        shares: 50,
        avgCost: 300,
        price: 400,
        lastImportedAt: '2026-01-01',
      },
    ]

    // Import new positions (only AAPL, not MSFT)
    const newRows = [
      {
        symbol: 'AAPL',
        name: 'Apple Inc.',
        assetClass: 'Equity',
        shares: '150', // Changed quantity
        avgCost: '160',
        price: '210',
      },
    ]

    const result = importPositions(state, accountId, newRows, '2026-08-08', 'import-test1')

    // Verify MSFT is gone
    expect(result.positions.filter((p) => p.accountId === accountId)).toHaveLength(1)
    expect(result.positions.find((p) => p.symbol === 'MSFT')).toBeUndefined()

    // Verify AAPL was updated
    const aapl = result.positions.find((p) => p.symbol === 'AAPL')
    expect(aapl).toBeDefined()
    expect(aapl!.shares).toBe(150)
    expect(aapl!.price).toBe(210)
    expect(aapl!.lastImportedAt).toBe('2026-08-08')
  })

  // Test 2: Symbol present in old snapshot but absent from new import → ClosedPosition created
  it('Test 2: Missing symbol in new import creates ClosedPosition', () => {
    let state = initialState()
    state = addAccount(state, createTestAccount('ACC-001', 'Account 1', 'taxable', false))
    const accountId = state.accounts[0].id

    state.positions = [
      {
        id: 'pos-1',
        accountId,
        symbol: 'AAPL',
        name: 'Apple Inc.',
        assetClass: 'Equity',
        shares: 100,
        avgCost: 150,
        price: 200,
        lastImportedAt: '2026-01-01',
      },
      {
        id: 'pos-2',
        accountId,
        symbol: 'TSLA',
        name: 'Tesla Inc.',
        assetClass: 'Equity',
        shares: 50,
        avgCost: 250,
        price: 300,
        lastImportedAt: '2026-01-01',
      },
    ]

    // Import without TSLA
    const newRows = [
      {
        symbol: 'AAPL',
        name: 'Apple Inc.',
        assetClass: 'Equity',
        shares: '100',
        avgCost: '150',
        price: '200',
      },
    ]

    const result = importPositions(state, accountId, newRows, '2026-08-08', 'import-test2')

    // Verify ClosedPosition for TSLA was created
    const closedTsla = result.closedPositions.find(
      (cp) => cp.symbol === 'TSLA' && cp.accountId === accountId
    )
    expect(closedTsla).toBeDefined()
    expect(closedTsla!.name).toBe('Tesla Inc.')
    expect(closedTsla!.closedDate).toBe('2026-08-08')
    expect(closedTsla!.assetClass).toBe('Equity')
    expect(closedTsla!.realizedGL).toBeNull()
    expect(closedTsla!.realizedGLBasis).toBe('unknown')
  })

  // Test 3: Symbol in both old and new → NOT added to closedPositions, assetClassManualOverride survives
  it('Test 3: Symbol in both old and new preserves assetClassManualOverride', () => {
    let state = initialState()
    state = addAccount(state, createTestAccount('ACC-001', 'Account 1', 'taxable', false))
    const accountId = state.accounts[0].id

    state.positions = [
      {
        id: 'pos-1',
        accountId,
        symbol: 'AAPL',
        name: 'Apple Inc.',
        assetClass: 'Equity',
        assetClassManualOverride: 'Tech Stock',
        shares: 100,
        avgCost: 150,
        price: 200,
        lastImportedAt: '2026-01-01',
      },
    ]

    // Re-import same symbol
    const newRows = [
      {
        symbol: 'AAPL',
        name: 'Apple Inc.',
        assetClass: 'Equity',
        shares: '120',
        avgCost: '155',
        price: '205',
      },
    ]

    const result = importPositions(state, accountId, newRows, '2026-08-08', 'import-test3')

    // Verify symbol not added to closedPositions
    const closedAapl = result.closedPositions.find((cp) => cp.symbol === 'AAPL')
    expect(closedAapl).toBeUndefined()

    // Verify assetClassManualOverride preserved
    const aapl = result.positions.find((p) => p.symbol === 'AAPL')
    expect(aapl!.assetClassManualOverride).toBe('Tech Stock')
  })

  // Test 4: Importing for account A on date D upserts exactly one PortfolioSnapshot keyed (A, D)
  it('Test 4: Importing upserts exactly one PortfolioSnapshot for (accountId, date)', () => {
    let state = initialState()
    state = addAccount(state, createTestAccount('ACC-001', 'Account 1', 'taxable', false))
    const accountId = state.accounts[0].id

    const newRows = [
      {
        symbol: 'AAPL',
        name: 'Apple Inc.',
        assetClass: 'Equity',
        shares: '100',
        avgCost: '150',
        price: '200',
      },
      {
        symbol: 'MSFT',
        name: 'Microsoft Corp.',
        assetClass: 'Equity',
        shares: '50',
        avgCost: '300',
        price: '400',
      },
    ]

    const result = importPositions(state, accountId, newRows, '2026-08-08', 'import-test4')

    // Verify exactly one snapshot for this (accountId, date)
    const snapshots = result.snapshots.filter(
      (s) => s.accountId === accountId && s.date === '2026-08-08'
    )
    expect(snapshots).toHaveLength(1)

    // Verify snapshot value is sum of marketValue
    const expectedValue = 100 * 200 + 50 * 400 // 20000 + 20000 = 40000
    expect(snapshots[0].value).toBe(expectedValue)
  })

  // Test 5: Re-importing for account A on SAME date D replaces (not duplicates) snapshot
  it('Test 5: Re-importing same account on same date replaces snapshot', () => {
    let state = initialState()
    state = addAccount(state, createTestAccount('ACC-001', 'Account 1', 'taxable', false))
    const accountId = state.accounts[0].id

    // First import
    const newRows1 = [
      {
        symbol: 'AAPL',
        name: 'Apple Inc.',
        assetClass: 'Equity',
        shares: '100',
        avgCost: '150',
        price: '200',
      },
    ]

    let result = importPositions(state, accountId, newRows1, '2026-08-08', 'import-test5a')
    expect(result.snapshots).toHaveLength(1)
    const firstSnapshotValue = result.snapshots[0].value // 100 * 200 = 20000

    // Second import for same account and date with different quantities
    const newRows2 = [
      {
        symbol: 'AAPL',
        name: 'Apple Inc.',
        assetClass: 'Equity',
        shares: '200',
        avgCost: '150',
        price: '200',
      },
    ]

    result = importPositions(result, accountId, newRows2, '2026-08-08', 'import-test5b')

    // Still exactly one snapshot
    expect(result.snapshots).toHaveLength(1)
    // Value should be updated
    const expectedNewValue = 200 * 200 // 40000
    expect(result.snapshots[0].value).toBe(expectedNewValue)
    expect(result.snapshots[0].value).not.toBe(firstSnapshotValue)
  })

  // Test 6: Single CSV spanning multiple accounts → two snapshots, one per account, each valued from that account's rows
  it('Test 6: Multiple accounts in one import creates snapshot per account', () => {
    let state = initialState()
    state = addAccount(state, createTestAccount('ACC-001', 'Account 1', 'taxable', false))
    state = addAccount(state, createTestAccount('ACC-002', 'Account 2', 'taxDeferred', true))

    const accountId1 = state.accounts.find((a) => a.accountNumber === 'ACC-001')!.id
    const accountId2 = state.accounts.find((a) => a.accountNumber === 'ACC-002')!.id

    // Import for account 1
    const rows1 = [
      {
        symbol: 'AAPL',
        name: 'Apple Inc.',
        assetClass: 'Equity',
        shares: '100',
        avgCost: '150',
        price: '200',
      },
    ]

    let result = importPositions(state, accountId1, rows1, '2026-08-08', 'import-test6a')

    // Import for account 2
    const rows2 = [
      {
        symbol: 'MSFT',
        name: 'Microsoft Corp.',
        assetClass: 'Equity',
        shares: '50',
        avgCost: '300',
        price: '400',
      },
    ]

    result = importPositions(result, accountId2, rows2, '2026-08-08', 'import-test6b')

    // Verify two snapshots exist
    const snapshots = result.snapshots.filter((s) => s.date === '2026-08-08')
    expect(snapshots).toHaveLength(2)

    // Verify each snapshot is valued from correct account's rows
    const snap1 = snapshots.find((s) => s.accountId === accountId1)
    const snap2 = snapshots.find((s) => s.accountId === accountId2)

    expect(snap1).toBeDefined()
    expect(snap1!.value).toBe(100 * 200) // 20000

    expect(snap2).toBeDefined()
    expect(snap2!.value).toBe(50 * 400) // 20000
  })

  // Test 7: Importing for account with zero prior positions → zero closed positions, still upserts snapshot
  it('Test 7: Importing to account with no prior positions creates snapshot', () => {
    let state = initialState()
    state = addAccount(state, createTestAccount('ACC-001', 'Account 1', 'taxable', false))
    const accountId = state.accounts[0].id

    // No prior positions

    const newRows = [
      {
        symbol: 'AAPL',
        name: 'Apple Inc.',
        assetClass: 'Equity',
        shares: '100',
        avgCost: '150',
        price: '200',
      },
    ]

    const result = importPositions(state, accountId, newRows, '2026-08-08', 'import-test7')

    // Verify no closed positions created
    const closedForAccount = result.closedPositions.filter((cp) => cp.accountId === accountId)
    expect(closedForAccount).toHaveLength(0)

    // Verify snapshot still created
    const snapshots = result.snapshots.filter((s) => s.accountId === accountId)
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0].value).toBe(100 * 200)
  })

  // Test 8: Realized G/L: matching Sell transaction(s) → realizedGL computed, realizedGLBasis='transactions'
  it('Test 8: Realized G/L computed from Sell transactions', () => {
    let state = initialState()
    state = addAccount(state, createTestAccount('ACC-001', 'Account 1', 'taxable', false))
    const accountId = state.accounts[0].id

    // Add position and sell transaction
    state.positions = [
      {
        id: 'pos-1',
        accountId,
        symbol: 'AAPL',
        name: 'Apple Inc.',
        assetClass: 'Equity',
        shares: 100,
        avgCost: 150,
        price: 200,
        lastImportedAt: '2026-01-01',
      },
    ]

    // Add a sell transaction: 100 shares at $250 = $25,000 proceeds
    state.transactions = [
      {
        id: 'tx-1',
        accountId,
        date: '2026-06-01',
        symbol: 'AAPL',
        type: 'Sell',
        shares: 100,
        price: 250,
        amount: 25000,
        importedAt: '2026-06-01',
      },
    ]

    // Import without AAPL (to create ClosedPosition)
    const newRows: Record<string, string>[] = []

    const result = importPositions(state, accountId, newRows, '2026-08-08', 'import-test8')

    // Verify ClosedPosition has computed realizedGL
    const closedAapl = result.closedPositions.find((cp) => cp.symbol === 'AAPL')
    expect(closedAapl).toBeDefined()
    expect(closedAapl!.realizedGLBasis).toBe('transactions')
    // realizedGL = proceeds - costBasis = 25000 - (100 * 150) = 25000 - 15000 = 10000
    expect(closedAapl!.realizedGL).toBe(10000)
  })

  // Test 9: Realized G/L: no matching Sell → realizedGL=null, realizedGLBasis='unknown'
  it('Test 9: Realized G/L set to null when no Sell transactions', () => {
    let state = initialState()
    state = addAccount(state, createTestAccount('ACC-001', 'Account 1', 'taxable', false))
    const accountId = state.accounts[0].id

    // Add position (no sell transactions)
    state.positions = [
      {
        id: 'pos-1',
        accountId,
        symbol: 'AAPL',
        name: 'Apple Inc.',
        assetClass: 'Equity',
        shares: 100,
        avgCost: 150,
        price: 200,
        lastImportedAt: '2026-01-01',
      },
    ]

    state.transactions = []

    // Import without AAPL (to create ClosedPosition)
    const newRows: Record<string, string>[] = []

    const result = importPositions(state, accountId, newRows, '2026-08-08', 'import-test9')

    // Verify ClosedPosition has no realizedGL
    const closedAapl = result.closedPositions.find((cp) => cp.symbol === 'AAPL')
    expect(closedAapl).toBeDefined()
    expect(closedAapl!.realizedGL).toBeNull()
    expect(closedAapl!.realizedGLBasis).toBe('unknown')
  })

  // Additional test: Case-insensitive transaction type matching
  it('Correctly matches Sell transactions regardless of case', () => {
    let state = initialState()
    state = addAccount(state, createTestAccount('ACC-001', 'Account 1', 'taxable', false))
    const accountId = state.accounts[0].id

    state.positions = [
      {
        id: 'pos-1',
        accountId,
        symbol: 'AAPL',
        name: 'Apple Inc.',
        assetClass: 'Equity',
        shares: 100,
        avgCost: 150,
        price: 200,
        lastImportedAt: '2026-01-01',
      },
    ]

    // Add sell transaction with lowercase type
    state.transactions = [
      {
        id: 'tx-1',
        accountId,
        date: '2026-06-01',
        symbol: 'AAPL',
        type: 'sell', // lowercase
        shares: 100,
        price: 250,
        amount: 25000,
        importedAt: '2026-06-01',
      },
    ]

    const newRows: Record<string, string>[] = []
    const result = importPositions(state, accountId, newRows, '2026-08-08', 'import-test10')

    const closedAapl = result.closedPositions.find((cp) => cp.symbol === 'AAPL')
    expect(closedAapl!.realizedGLBasis).toBe('transactions')
    expect(closedAapl!.realizedGL).toBe(10000)
  })

  // Additional test: Multiple Sell transactions for same symbol sum correctly
  it('Realized G/L sums multiple Sell transactions for same symbol', () => {
    let state = initialState()
    state = addAccount(state, createTestAccount('ACC-001', 'Account 1', 'taxable', false))
    const accountId = state.accounts[0].id

    state.positions = [
      {
        id: 'pos-1',
        accountId,
        symbol: 'AAPL',
        name: 'Apple Inc.',
        assetClass: 'Equity',
        shares: 100,
        avgCost: 150,
        price: 200,
        lastImportedAt: '2026-01-01',
      },
    ]

    // Two sell transactions: total proceeds = 15000 + 10000 = 25000
    state.transactions = [
      {
        id: 'tx-1',
        accountId,
        date: '2026-06-01',
        symbol: 'AAPL',
        type: 'Sell',
        shares: 60,
        price: 250,
        amount: 15000,
        importedAt: '2026-06-01',
      },
      {
        id: 'tx-2',
        accountId,
        date: '2026-07-01',
        symbol: 'AAPL',
        type: 'Sell',
        shares: 40,
        price: 250,
        amount: 10000,
        importedAt: '2026-07-01',
      },
    ]

    const newRows: Record<string, string>[] = []
    const result = importPositions(state, accountId, newRows, '2026-08-08', 'import-test11')

    const closedAapl = result.closedPositions.find((cp) => cp.symbol === 'AAPL')
    // realizedGL = 25000 - (100 * 150) = 25000 - 15000 = 10000
    expect(closedAapl!.realizedGL).toBe(10000)
  })

  // Additional test: Does not affect other accounts
  it('Importing positions for one account does not affect other accounts', () => {
    let state = initialState()
    state = addAccount(state, createTestAccount('ACC-001', 'Account 1', 'taxable', false))
    state = addAccount(state, createTestAccount('ACC-002', 'Account 2', 'taxDeferred', true))

    const accountId1 = state.accounts.find((a) => a.accountNumber === 'ACC-001')!.id
    const accountId2 = state.accounts.find((a) => a.accountNumber === 'ACC-002')!.id

    // Add position to account 2
    state.positions = [
      {
        id: 'pos-2',
        accountId: accountId2,
        symbol: 'GOOGL',
        name: 'Alphabet Inc.',
        assetClass: 'Equity',
        shares: 50,
        avgCost: 100,
        price: 150,
        lastImportedAt: '2026-01-01',
      },
    ]

    // Import positions for account 1
    const newRows = [
      {
        symbol: 'AAPL',
        name: 'Apple Inc.',
        assetClass: 'Equity',
        shares: '100',
        avgCost: '150',
        price: '200',
      },
    ]

    const result = importPositions(state, accountId1, newRows, '2026-08-08', 'import-test12')

    // Verify account 2's position is unchanged
    const googl = result.positions.find((p) => p.symbol === 'GOOGL')
    expect(googl).toBeDefined()
    expect(googl!.accountId).toBe(accountId2)
    expect(googl!.lastImportedAt).toBe('2026-01-01')
  })

  // Test: Computed fields from alternatives
  // Test 1: avgCost computed from purchaseAmount when avgCost is missing
  it('Test: avgCost computed from purchaseAmount when avgCost missing', () => {
    let state = initialState()
    state = addAccount(state, createTestAccount('ACC-001', 'Account 1', 'taxable', false))
    const accountId = state.accounts[0].id

    // Import row with purchaseAmount but no avgCost
    const newRows = [
      {
        symbol: 'AAPL',
        name: 'Apple Inc.',
        assetClass: 'Equity',
        shares: '10',
        avgCost: '', // missing/empty
        price: '120',
        purchaseAmount: '1000', // 1000 / 10 = 100
      },
    ]

    const result = importPositions(state, accountId, newRows, '2026-08-08', 'import-test13')

    const aapl = result.positions.find((p) => p.symbol === 'AAPL')
    expect(aapl).toBeDefined()
    expect(aapl!.avgCost).toBe(100) // computed: purchaseAmount / shares
  })

  // Test 2: price computed from marketValue when price is missing
  it('Test: price computed from marketValue when price missing', () => {
    let state = initialState()
    state = addAccount(state, createTestAccount('ACC-001', 'Account 1', 'taxable', false))
    const accountId = state.accounts[0].id

    // Import row with marketValue but no price
    const newRows = [
      {
        symbol: 'MSFT',
        name: 'Microsoft Corp.',
        assetClass: 'Equity',
        shares: '10',
        avgCost: '100',
        price: '', // missing/empty
        marketValue: '1200', // 1200 / 10 = 120
      },
    ]

    const result = importPositions(state, accountId, newRows, '2026-08-08', 'import-test14')

    const msft = result.positions.find((p) => p.symbol === 'MSFT')
    expect(msft).toBeDefined()
    expect(msft!.price).toBe(120) // computed: marketValue / shares
  })

  // Test 3: avgCost prefers direct value over purchaseAmount
  it('Test: avgCost prefers direct value over purchaseAmount', () => {
    let state = initialState()
    state = addAccount(state, createTestAccount('ACC-001', 'Account 1', 'taxable', false))
    const accountId = state.accounts[0].id

    // Import row with both avgCost and purchaseAmount
    const newRows = [
      {
        symbol: 'GOOGL',
        name: 'Alphabet Inc.',
        assetClass: 'Equity',
        shares: '10',
        avgCost: '100', // direct value (preferred)
        price: '150',
        purchaseAmount: '1200', // would be 120 if used, but avgCost takes precedence
      },
    ]

    const result = importPositions(state, accountId, newRows, '2026-08-08', 'import-test15')

    const googl = result.positions.find((p) => p.symbol === 'GOOGL')
    expect(googl).toBeDefined()
    expect(googl!.avgCost).toBe(100) // direct value wins
  })

  // Test 4: price prefers direct value over marketValue
  it('Test: price prefers direct value over marketValue', () => {
    let state = initialState()
    state = addAccount(state, createTestAccount('ACC-001', 'Account 1', 'taxable', false))
    const accountId = state.accounts[0].id

    // Import row with both price and marketValue
    const newRows = [
      {
        symbol: 'TSLA',
        name: 'Tesla Inc.',
        assetClass: 'Equity',
        shares: '10',
        avgCost: '150',
        price: '120', // direct value (preferred)
        marketValue: '1500', // would be 150 if used, but price takes precedence
      },
    ]

    const result = importPositions(state, accountId, newRows, '2026-08-08', 'import-test16')

    const tsla = result.positions.find((p) => p.symbol === 'TSLA')
    expect(tsla).toBeDefined()
    expect(tsla!.price).toBe(120) // direct value wins
  })

  // Task 8: Test 1 - Import position with no name column mapped
  it('Test 8.1: Import position with no name column mapped', () => {
    let state = initialState()
    state = addAccount(state, createTestAccount('ACC-001', 'Account 1', 'taxable', false))
    const accountId = state.accounts[0].id

    // Import row without name (undefined)
    const newRows = [
      {
        symbol: 'AAPL',
        assetClass: 'Equity',
        shares: '100',
        avgCost: '150',
        price: '200',
        // name is not provided
      },
    ]

    const result = importPositions(state, accountId, newRows, '2026-08-08', 'import-test17')

    const aapl = result.positions.find((p) => p.symbol === 'AAPL')
    expect(aapl).toBeDefined()
    expect(aapl!.name).toBeNull()
  })

  // Task 8: Test 2 - Import position with taxes column mapped
  it('Test 8.2: Import position with taxes column mapped', () => {
    let state = initialState()
    state = addAccount(state, createTestAccount('ACC-001', 'Account 1', 'taxable', false))
    const accountId = state.accounts[0].id

    // Import row with taxes mapped
    const newRows = [
      {
        symbol: 'MSFT',
        name: 'Microsoft Corp.',
        assetClass: 'Equity',
        shares: '50',
        avgCost: '300',
        price: '400',
        taxes: '50.25',
      },
    ]

    const result = importPositions(state, accountId, newRows, '2026-08-08', 'import-test18')

    const msft = result.positions.find((p) => p.symbol === 'MSFT')
    expect(msft).toBeDefined()
    expect(msft!.taxes).toBe(50.25)
  })

  // Task 8: Test 3 - Import position with no taxes column mapped
  it('Test 8.3: Import position with no taxes column mapped', () => {
    let state = initialState()
    state = addAccount(state, createTestAccount('ACC-001', 'Account 1', 'taxable', false))
    const accountId = state.accounts[0].id

    // Import row without taxes (undefined)
    const newRows = [
      {
        symbol: 'GOOGL',
        name: 'Alphabet Inc.',
        assetClass: 'Equity',
        shares: '25',
        avgCost: '2000',
        price: '2500',
        // taxes is not provided
      },
    ]

    const result = importPositions(state, accountId, newRows, '2026-08-08', 'import-test19')

    const googl = result.positions.find((p) => p.symbol === 'GOOGL')
    expect(googl).toBeDefined()
    expect(googl!.taxes).toBeNull()
  })

  // Task 8: Test 4 - ClosedPosition inherits null name
  it('Test 8.4: ClosedPosition inherits null name', () => {
    let state = initialState()
    state = addAccount(state, createTestAccount('ACC-001', 'Account 1', 'taxable', false))
    const accountId = state.accounts[0].id

    // Add old position with name=null
    state.positions = [
      {
        id: 'pos-1',
        accountId,
        symbol: 'TSLA',
        name: null,
        assetClass: 'Equity',
        shares: 50,
        avgCost: 250,
        price: 300,
        taxes: null,
        lastImportedAt: '2026-01-01',
      },
    ]

    // Import without TSLA (to create ClosedPosition)
    const newRows: Record<string, string>[] = []

    const result = importPositions(state, accountId, newRows, '2026-08-08', 'import-test20')

    // Verify ClosedPosition inherits null name
    const closedTsla = result.closedPositions.find((cp) => cp.symbol === 'TSLA')
    expect(closedTsla).toBeDefined()
    expect(closedTsla!.name).toBeNull()
  })

  // Task 8: Test 5 - Validation passes without name mapped
  it('Test 8.5: Validation passes without name mapped', () => {
    const profile = createProfile(
      'Profile without name',
      'positions',
      {
        Symbol: 'symbol',
        Class: 'assetClass',
        Qty: 'shares',
        Cost: 'avgCost',
        Price: 'price',
        // name is not mapped
      }
    )

    const result = validateProfile(profile, 'positions')

    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  // Task 8: Test 6 - Validation passes without taxes mapped
  it('Test 8.6: Validation passes without taxes mapped', () => {
    const profile = createProfile(
      'Profile without taxes',
      'positions',
      {
        Symbol: 'symbol',
        Class: 'assetClass',
        Qty: 'shares',
        Cost: 'avgCost',
        Price: 'price',
        // taxes is not mapped
      }
    )

    const result = validateProfile(profile, 'positions')

    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  // Regression: a CSV row with blank cells for required fields (e.g. missing
  // shares/price) used to still be imported, producing a Position with NaN
  // numeric fields instead of being skipped.
  it('skips rows with missing required fields instead of importing NaN positions', () => {
    let state = initialState()
    state = addAccount(state, createTestAccount('ACC-002', 'Account 2', 'taxable', false))
    const accountId = state.accounts[0].id

    const rows = [
      {
        symbol: 'AAPL',
        name: 'Apple Inc.',
        assetClass: 'Equity',
        shares: '100',
        avgCost: '150',
        price: '200',
      },
      {
        // Blank row: shares/avgCost/price cells were empty in the CSV
        symbol: 'MSFT',
        name: 'Microsoft Corp.',
        assetClass: 'Equity',
        shares: '',
        avgCost: '',
        price: '',
      },
    ]

    const result = importPositions(state, accountId, rows, '2026-01-15', 'import-test21')

    expect(result.positions).toHaveLength(1)
    expect(result.positions[0].symbol).toBe('AAPL')
    expect(result.positions.some((p) => Number.isNaN(p.shares))).toBe(false)
  })

  // Regression: brokerage CSV exports (e.g. equity-comp exports) format numbers as
  // currency ("$3.79 ") or with thousands separators ("45,000"). Plain parseFloat
  // either returns NaN for the '$' case (row silently skipped) or truncates at the
  // comma ("1,234" -> 1), importing a wildly wrong value instead of failing loudly.
  it('Test: parses currency-formatted and comma-thousands numeric fields correctly', () => {
    let state = initialState()
    state = addAccount(state, createTestAccount('ACC-003', 'Account 3', 'taxable', false))
    const accountId = state.accounts[0].id

    const rows = [
      {
        symbol: 'NTSK',
        name: 'Netskope',
        assetClass: 'ISO',
        shares: '45,000',
        avgCost: '$3.79 ',
        price: '$12.47 ',
      },
    ]

    const result = importPositions(state, accountId, rows, '2026-01-15', 'import-test22')

    expect(result.positions).toHaveLength(1)
    expect(result.positions[0].shares).toBe(45000)
    expect(result.positions[0].avgCost).toBe(3.79)
    expect(result.positions[0].price).toBe(12.47)
  })

  // Task 5 new tests: importSessionId stamping

  // New position rows get importSessionId equal to the value passed in
  it('Task 5.1: New position rows get importSessionId', () => {
    let state = initialState()
    state = addAccount(state, createTestAccount('ACC-001', 'Account 1', 'taxable', false))
    const accountId = state.accounts[0].id

    const newRows = [
      {
        symbol: 'AAPL',
        name: 'Apple Inc.',
        assetClass: 'Equity',
        shares: '100',
        avgCost: '150',
        price: '200',
      },
      {
        symbol: 'MSFT',
        name: 'Microsoft Corp.',
        assetClass: 'Equity',
        shares: '50',
        avgCost: '300',
        price: '400',
      },
    ]

    const sessionId = 'session-new-positions-test'
    const result = importPositions(state, accountId, newRows, '2026-08-08', sessionId)

    // All positions should have the passed importSessionId
    const positions = result.positions.filter((p) => p.accountId === accountId)
    expect(positions).toHaveLength(2)
    expect(positions.every((p) => p.importSessionId === sessionId)).toBe(true)
    expect(positions[0].importSessionId).toBe('session-new-positions-test')
    expect(positions[1].importSessionId).toBe('session-new-positions-test')
  })

  // New ClosedPosition rows get the current call's importSessionId, not the old position's
  it('Task 5.2: New ClosedPosition rows get current importSessionId', () => {
    let state = initialState()
    state = addAccount(state, createTestAccount('ACC-001', 'Account 1', 'taxable', false))
    const accountId = state.accounts[0].id

    // Add old position with a different session id
    state.positions = [
      {
        id: 'pos-1',
        importSessionId: 'session-old',
        accountId,
        symbol: 'AAPL',
        name: 'Apple Inc.',
        assetClass: 'Equity',
        shares: 100,
        avgCost: 150,
        price: 200,
        taxes: null,
        lastImportedAt: '2026-01-01',
      },
    ]

    // Import without AAPL to create a ClosedPosition
    const newRows: Record<string, string>[] = []
    const sessionId = 'session-closed-test'
    const result = importPositions(state, accountId, newRows, '2026-08-08', sessionId)

    // The new ClosedPosition should have the current session id, not the old one
    const closedAapl = result.closedPositions.find((cp) => cp.symbol === 'AAPL')
    expect(closedAapl).toBeDefined()
    expect(closedAapl!.importSessionId).toBe('session-closed-test')
    expect(closedAapl!.importSessionId).not.toBe('session-old')
  })

  // New PortfolioSnapshot gets the current call's importSessionId
  it('Task 5.3: New PortfolioSnapshot gets current importSessionId', () => {
    let state = initialState()
    state = addAccount(state, createTestAccount('ACC-001', 'Account 1', 'taxable', false))
    const accountId = state.accounts[0].id

    const newRows = [
      {
        symbol: 'AAPL',
        name: 'Apple Inc.',
        assetClass: 'Equity',
        shares: '100',
        avgCost: '150',
        price: '200',
      },
    ]

    const sessionId = 'session-snapshot-test'
    const result = importPositions(state, accountId, newRows, '2026-08-08', sessionId)

    // The snapshot should have the passed importSessionId
    const snapshot = result.snapshots.find(
      (s) => s.accountId === accountId && s.date === '2026-08-08'
    )
    expect(snapshot).toBeDefined()
    expect(snapshot!.importSessionId).toBe('session-snapshot-test')
  })

  // Two sequential imports with different session ids
  it('Task 5.4: Sequential imports with different session ids', () => {
    let state = initialState()
    state = addAccount(state, createTestAccount('ACC-001', 'Account 1', 'taxable', false))
    const accountId = state.accounts[0].id

    // First import with AAPL and MSFT
    const rows1 = [
      {
        symbol: 'AAPL',
        name: 'Apple Inc.',
        assetClass: 'Equity',
        shares: '100',
        avgCost: '150',
        price: '200',
      },
      {
        symbol: 'MSFT',
        name: 'Microsoft Corp.',
        assetClass: 'Equity',
        shares: '50',
        avgCost: '300',
        price: '400',
      },
    ]

    let result = importPositions(state, accountId, rows1, '2026-08-08', 'session-first')
    expect(result.positions).toHaveLength(2)
    expect(result.positions.every((p) => p.importSessionId === 'session-first')).toBe(true)
    expect(result.snapshots[0].importSessionId).toBe('session-first')

    // Second import with only AAPL (MSFT becomes closed)
    const rows2 = [
      {
        symbol: 'AAPL',
        name: 'Apple Inc.',
        assetClass: 'Equity',
        shares: '120',
        avgCost: '160',
        price: '210',
      },
    ]

    result = importPositions(result, accountId, rows2, '2026-08-08', 'session-second')

    // New AAPL position should have session-second id
    const aapl = result.positions.find((p) => p.symbol === 'AAPL')
    expect(aapl).toBeDefined()
    expect(aapl!.importSessionId).toBe('session-second')

    // MSFT should now be a ClosedPosition with session-second id (created during second call)
    const closedMsft = result.closedPositions.find((cp) => cp.symbol === 'MSFT')
    expect(closedMsft).toBeDefined()
    expect(closedMsft!.importSessionId).toBe('session-second')

    // Snapshot should have session-second id (updated during second call)
    const snapshot = result.snapshots.find(
      (s) => s.accountId === accountId && s.date === '2026-08-08'
    )
    expect(snapshot).toBeDefined()
    expect(snapshot!.importSessionId).toBe('session-second')
  })
})
