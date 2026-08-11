import { describe, it, expect } from 'vitest'
import {
  visiblePositions,
  visibleTransactions,
  summaryCards,
  allocationBars,
  filteredPortfolioTotal,
  segmentSummaryCards,
  assetClassOptions
} from './selectors'
import { AppState, initialState } from './state'
import { Account, Position, Transaction, PortfolioSnapshot } from './types'

describe('selectors', () => {
  // Helper to create a test state
  function createTestState(overrides?: Partial<AppState>): AppState {
    return {
      ...initialState(),
      ...overrides
    }
  }

  // Helper to create test accounts
  const testAccount1: Account = {
    id: 'acc-1',
    accountNumber: '12345',
    name: 'Brokerage',
    taxCategory: 'taxable',
    retirement: false,
    createdAt: '2026-01-01'
  }

  const testAccount2: Account = {
    id: 'acc-2',
    accountNumber: '67890',
    name: 'Retirement IRA',
    taxCategory: 'taxDeferred',
    retirement: true,
    createdAt: '2026-01-01'
  }

  // Test 1: visiblePositions with 'All' asset class filter returns everything
  it('visiblePositions: asset-class filter All returns all positions', () => {
    const positions: Position[] = [
      {
        id: 'pos-1',
        accountId: 'acc-1',
        symbol: 'AAPL',
        name: 'Apple Inc.',
        assetClass: 'Equity',
        shares: 100,
        avgCost: 150,
        price: 200,
        lastImportedAt: '2026-08-08'
      },
      {
        id: 'pos-2',
        accountId: 'acc-1',
        symbol: 'BND',
        name: 'Bond ETF',
        assetClass: 'Fixed Income',
        shares: 50,
        avgCost: 100,
        price: 105,
        lastImportedAt: '2026-08-08'
      }
    ]

    const state = createTestState({
      accounts: [testAccount1],
      positions,
      assetClassFilter: 'All',
    })

    const visible = visiblePositions(state)

    expect(visible).toHaveLength(2)
    expect(visible[0].symbol).toBe('AAPL')
    expect(visible[1].symbol).toBe('BND')
  })

  // Test 2: visiblePositions with specific asset class filters correctly
  it('visiblePositions: specific asset-class filter returns only matching positions', () => {
    const positions: Position[] = [
      {
        id: 'pos-1',
        accountId: 'acc-1',
        symbol: 'AAPL',
        name: 'Apple Inc.',
        assetClass: 'Equity',
        shares: 100,
        avgCost: 150,
        price: 200,
        lastImportedAt: '2026-08-08'
      },
      {
        id: 'pos-2',
        accountId: 'acc-1',
        symbol: 'MSFT',
        name: 'Microsoft',
        assetClass: 'Equity',
        shares: 50,
        avgCost: 300,
        price: 400,
        lastImportedAt: '2026-08-08'
      },
      {
        id: 'pos-3',
        accountId: 'acc-1',
        symbol: 'BND',
        name: 'Bond ETF',
        assetClass: 'Fixed Income',
        shares: 200,
        avgCost: 100,
        price: 105,
        lastImportedAt: '2026-08-08'
      }
    ]

    const state = createTestState({
      accounts: [testAccount1],
      positions,
      assetClassFilter: 'Equity',
    })

    const visible = visiblePositions(state)

    expect(visible).toHaveLength(2)
    expect(visible[0].symbol).toBe('AAPL')
    expect(visible[1].symbol).toBe('MSFT')
  })

  // Test 3: visiblePositions search matches on symbol OR name, case-insensitive
  it('visiblePositions: search matches on symbol or name, case-insensitive, substring', () => {
    const positions: Position[] = [
      {
        id: 'pos-1',
        accountId: 'acc-1',
        symbol: 'AAPL',
        name: 'Apple Inc.',
        assetClass: 'Equity',
        shares: 100,
        avgCost: 150,
        price: 200,
        lastImportedAt: '2026-08-08'
      },
      {
        id: 'pos-2',
        accountId: 'acc-1',
        symbol: 'MSFT',
        name: 'Microsoft Corporation',
        assetClass: 'Equity',
        shares: 50,
        avgCost: 300,
        price: 400,
        lastImportedAt: '2026-08-08'
      },
      {
        id: 'pos-3',
        accountId: 'acc-1',
        symbol: 'GOOG',
        name: 'Alphabet Inc.',
        assetClass: 'Equity',
        shares: 200,
        avgCost: 100,
        price: 150,
        lastImportedAt: '2026-08-08'
      }
    ]

    const state = createTestState({
      accounts: [testAccount1],
      positions,
      assetClassFilter: 'All',
      posSearch: 'micro',
    })

    const visible = visiblePositions(state)

    expect(visible).toHaveLength(1)
    expect(visible[0].symbol).toBe('MSFT')
  })

  // Test 4: visibleTransactions type filter + search
  it('visibleTransactions: type filter and search work correctly', () => {
    const transactions: Transaction[] = [
      {
        id: 'tx-1',
        accountId: 'acc-1',
        date: '2026-08-01',
        symbol: 'AAPL',
        type: 'Buy',
        shares: 10,
        price: 150,
        amount: 1500,
        importedAt: '2026-08-01'
      },
      {
        id: 'tx-2',
        accountId: 'acc-1',
        date: '2026-08-02',
        symbol: 'AAPL',
        type: 'Dividend',
        shares: 0,
        price: 0,
        amount: 50,
        importedAt: '2026-08-02'
      },
      {
        id: 'tx-3',
        accountId: 'acc-1',
        date: '2026-08-03',
        symbol: 'MSFT',
        type: 'Buy',
        shares: 5,
        price: 300,
        amount: 1500,
        importedAt: '2026-08-03'
      }
    ]

    const state = createTestState({
      accounts: [testAccount1],
      transactions,
      txTypeFilter: 'Buy',
      txSearch: 'aapl',
    })

    const visible = visibleTransactions(state)

    expect(visible).toHaveLength(1)
    expect(visible[0].symbol).toBe('AAPL')
    expect(visible[0].type).toBe('Buy')
  })


  // Test 6: summaryCards returns 3 cards (Total Value, Total Gain/Loss, Amount Invested)
  it('summaryCards: returns exactly 3 cards with correct labels', () => {
    const positions: Position[] = [
      {
        id: 'pos-1',
        accountId: 'acc-1',
        symbol: 'AAPL',
        name: 'Apple Inc.',
        assetClass: 'Equity',
        shares: 100,
        avgCost: 150,
        price: 200,
        lastImportedAt: '2026-08-08'
      }
    ]

    const state = createTestState({
      accounts: [testAccount1],
      positions,
    })

    const cards = summaryCards(state)

    // Should have exactly 3 cards
    expect(cards).toHaveLength(3)

    // Verify the labels
    expect(cards[0].label).toBe('Total Value')
    expect(cards[1].label).toBe('Total Gain/Loss')
    expect(cards[2].label).toBe('Amount Invested')

    // Verify values are formatted
    expect(cards[0].value).toMatch(/^\$/)
    expect(cards[2].value).toMatch(/^\$/)
  })


  // Test: Asset class manual override in visiblePositions
  it('visiblePositions: respects assetClassManualOverride when filtering', () => {
    const positions: Position[] = [
      {
        id: 'pos-1',
        accountId: 'acc-1',
        symbol: 'AAPL',
        name: 'Apple Inc.',
        assetClass: 'Equity',
        assetClassManualOverride: 'ETF',
        shares: 100,
        avgCost: 150,
        price: 200,
        lastImportedAt: '2026-08-08'
      }
    ]

    const state = createTestState({
      accounts: [testAccount1],
      positions,
      assetClassFilter: 'ETF',
    })

    const visible = visiblePositions(state)

    expect(visible).toHaveLength(1)
  })


  // Test: allocationBars formats correctly
  it('allocationBars: returns formatted allocation data', () => {
    const positions: Position[] = [
      {
        id: 'pos-1',
        accountId: 'acc-1',
        symbol: 'AAPL',
        name: 'Apple Inc.',
        assetClass: 'Equity',
        shares: 100,
        avgCost: 150,
        price: 200,
        lastImportedAt: '2026-08-08'
      },
      {
        id: 'pos-2',
        accountId: 'acc-1',
        symbol: 'BND',
        name: 'Bond ETF',
        assetClass: 'Fixed Income',
        shares: 100,
        avgCost: 100,
        price: 100,
        lastImportedAt: '2026-08-08'
      }
    ]

    const state = createTestState({
      accounts: [testAccount1],
      positions,
    })

    const bars = allocationBars(state)

    expect(bars).toHaveLength(2)
    bars.forEach((bar) => {
      expect(bar.label).toBeTruthy()
      expect(bar.value).toMatch(/^\$/) // Should start with $
      expect(bar.pct).toMatch(/%$/) // Should end with %
    })
  })

  // Test: Empty state
  it('selectors: handle empty state gracefully', () => {
    const state = createTestState({
      accounts: [],
      positions: [],
      transactions: [],
      snapshots: []
    })

    expect(visiblePositions(state)).toHaveLength(0)
    expect(visibleTransactions(state)).toHaveLength(0)
  })

  // Test: Sorting in visiblePositions
  it('visiblePositions: applies sort from state', () => {
    const positions: Position[] = [
      {
        id: 'pos-1',
        accountId: 'acc-1',
        symbol: 'ZZZA',
        name: 'Last',
        assetClass: 'Equity',
        shares: 100,
        avgCost: 150,
        price: 200,
        lastImportedAt: '2026-08-08'
      },
      {
        id: 'pos-2',
        accountId: 'acc-1',
        symbol: 'AAAB',
        name: 'First',
        assetClass: 'Equity',
        shares: 50,
        avgCost: 300,
        price: 400,
        lastImportedAt: '2026-08-08'
      }
    ]

    const state = createTestState({
      accounts: [testAccount1],
      positions,
      assetClassFilter: 'All',
      sortKey: 'symbol',
      sortDir: 'asc'
    })

    const visible = visiblePositions(state)

    expect(visible[0].symbol).toBe('AAAB')
    expect(visible[1].symbol).toBe('ZZZA')
  })


  // Test: totalTaxesPaid with null taxes (treated as 0)

  // === filteredPortfolioTotal() tests ===

  // Test 1: filteredPortfolioTotal with 'All' category filter
  it('filteredPortfolioTotal: calculates total with All category filter', () => {
    const positions: Position[] = [
      {
        id: 'pos-1',
        accountId: 'acc-1',
        symbol: 'AAPL',
        name: 'Apple Inc.',
        assetClass: 'Equity',
        shares: 10,
        avgCost: 150,
        price: 200,
        lastImportedAt: '2026-08-08'
      },
      {
        id: 'pos-2',
        accountId: 'acc-2',
        symbol: 'MSFT',
        name: 'Microsoft',
        assetClass: 'Equity',
        shares: 5,
        avgCost: 300,
        price: 400,
        lastImportedAt: '2026-08-08'
      }
    ]

    const state = createTestState({
      accounts: [testAccount1, testAccount2],
      positions,
      category: 'all' // All category
    })

    const total = filteredPortfolioTotal(state)

    // Expected: (10 * 200) + (5 * 400) = 2000 + 2000 = 4000
    expect(total).toBe(4000)
  })

  // Test 7: filteredPortfolioTotal with negative position market value (short position)
  it('filteredPortfolioTotal: includes negative market values in sum', () => {
    const positions: Position[] = [
      {
        id: 'pos-1',
        accountId: 'acc-1',
        symbol: 'AAPL',
        name: 'Apple Inc.',
        assetClass: 'Equity',
        shares: 10,
        avgCost: 150,
        price: 200,
        lastImportedAt: '2026-08-08'
      },
      {
        id: 'pos-2',
        accountId: 'acc-1',
        symbol: 'TSLA',
        name: 'Tesla Short',
        assetClass: 'Equity',
        shares: -5, // Short position
        avgCost: 300,
        price: 400,
        lastImportedAt: '2026-08-08'
      }
    ]

    const state = createTestState({
      accounts: [testAccount1],
      positions,
    })

    const total = filteredPortfolioTotal(state)

    // Expected: (10 * 200) + (-5 * 400) = 2000 - 2000 = 0
    expect(total).toBe(0)
  })

  // Test 9: filteredPortfolioTotal with only negative positions
  it('filteredPortfolioTotal: returns negative sum for all-short portfolio', () => {
    const positions: Position[] = [
      {
        id: 'pos-1',
        accountId: 'acc-1',
        symbol: 'AAPL',
        name: 'Apple Short',
        assetClass: 'Equity',
        shares: -10,
        avgCost: 150,
        price: 200,
        lastImportedAt: '2026-08-08'
      }
    ]

    const state = createTestState({
      accounts: [testAccount1],
      positions,
    })

    const total = filteredPortfolioTotal(state)

    // Expected: -10 * 200 = -2000
    expect(total).toBe(-2000)
  })

  // Test 10: filteredPortfolioTotal does NOT apply asset class filter
  it('filteredPortfolioTotal: ignores asset class filter (only uses category+retirement)', () => {
    const positions: Position[] = [
      {
        id: 'pos-1',
        accountId: 'acc-1',
        symbol: 'AAPL',
        name: 'Apple Inc.',
        assetClass: 'Equity',
        shares: 10,
        avgCost: 150,
        price: 200,
        lastImportedAt: '2026-08-08'
      },
      {
        id: 'pos-2',
        accountId: 'acc-1',
        symbol: 'BND',
        name: 'Bond ETF',
        assetClass: 'Fixed Income',
        shares: 5,
        avgCost: 100,
        price: 105,
        lastImportedAt: '2026-08-08'
      }
    ]

    const state = createTestState({
      accounts: [testAccount1],
      positions,
      assetClassFilter: 'Equity' // Filter applied, but should be ignored
    })

    const total = filteredPortfolioTotal(state)

    // Expected: total of ALL positions, ignoring assetClassFilter
    // (10 * 200) + (5 * 105) = 2000 + 525 = 2525
    expect(total).toBe(2525)
  })

  // === segmentSummaryCards() tests ===

  // Test 1: segmentSummaryCards includes positions outside category filter if account is retirement
  it('segmentSummaryCards: includes retirement positions even if outside category filter', () => {
    const positions: Position[] = [
      {
        id: 'pos-1',
        accountId: 'acc-1',
        symbol: 'AAPL',
        name: 'Apple Inc.',
        assetClass: 'Equity',
        shares: 10,
        avgCost: 150,
        price: 200,
        lastImportedAt: '2026-08-08'
      },
      {
        id: 'pos-2',
        accountId: 'acc-2',
        symbol: 'MSFT',
        name: 'Microsoft',
        assetClass: 'Equity',
        shares: 5,
        avgCost: 300,
        price: 400,
        lastImportedAt: '2026-08-08'
      }
    ]

    const state = createTestState({
      accounts: [testAccount1, testAccount2],
      positions,
      category: 'taxable' // Only testAccount1 matches this category
    })

    const cards = segmentSummaryCards(state, true)

    // Expected: segmentSummaryCards should include MSFT (acc-2, retirement)
    // even though acc-2 is not in the taxable category
    // Total Value should be 5 * 400 = 2000
    expect(cards).toHaveLength(3)
    expect(cards[0].label).toBe('Total Value')
    expect(cards[0].value).toBe('$2,000.00')
  })

  // Test 2: segmentSummaryCards with zero retirement accounts returns zero-value cards
  it('segmentSummaryCards: returns zero-value cards with no retirement accounts', () => {
    const positions: Position[] = [
      {
        id: 'pos-1',
        accountId: 'acc-1',
        symbol: 'AAPL',
        name: 'Apple Inc.',
        assetClass: 'Equity',
        shares: 10,
        avgCost: 150,
        price: 200,
        lastImportedAt: '2026-08-08'
      }
    ]

    const state = createTestState({
      accounts: [testAccount1],
      positions
    })

    const cards = segmentSummaryCards(state, true)

    // Expected: all three cards should show $0.00 since no retirement accounts
    expect(cards).toHaveLength(3)
    expect(cards[0].label).toBe('Total Value')
    expect(cards[0].value).toBe('$0.00')
    expect(cards[1].label).toBe('Total Gain/Loss')
    expect(cards[1].value).toBe('+$0.00')
    expect(cards[2].label).toBe('Amount Invested')
    expect(cards[2].value).toBe('$0.00')
  })

  // === assetClassOptions() tests ===

  // Test 1: assetClassOptions returns sorted unique list for mixed classes
  it('assetClassOptions: returns sorted unique list for mixed asset classes', () => {
    const positions: Position[] = [
      {
        id: 'pos-1',
        accountId: 'acc-1',
        symbol: 'AAPL',
        name: 'Apple Inc.',
        assetClass: 'Equity',
        shares: 100,
        avgCost: 150,
        price: 200,
        lastImportedAt: '2026-08-08'
      },
      {
        id: 'pos-2',
        accountId: 'acc-1',
        symbol: 'BND',
        name: 'Bond ETF',
        assetClass: 'Fixed Income',
        shares: 50,
        avgCost: 100,
        price: 105,
        lastImportedAt: '2026-08-08'
      },
      {
        id: 'pos-3',
        accountId: 'acc-1',
        symbol: 'VTI',
        name: 'Total Market',
        assetClass: 'Equity',
        shares: 200,
        avgCost: 200,
        price: 250,
        lastImportedAt: '2026-08-08'
      }
    ]

    const state = createTestState({
      accounts: [testAccount1],
      positions
    })

    const options = assetClassOptions(state)

    // Should be sorted alphabetically: Equity, Fixed Income
    expect(options).toEqual(['Equity', 'Fixed Income'])
  })

  // Test 2: assetClassOptions returns empty array for no positions
  it('assetClassOptions: returns empty array when no positions exist', () => {
    const state = createTestState({
      accounts: [testAccount1],
      positions: []
    })

    const options = assetClassOptions(state)

    expect(options).toEqual([])
  })

  // Test 3: assetClassOptions dedupes by manual override, not base class
  it('assetClassOptions: dedupes by manual override, not base assetClass', () => {
    const positions: Position[] = [
      {
        id: 'pos-1',
        accountId: 'acc-1',
        symbol: 'AAPL',
        name: 'Apple Inc.',
        assetClass: 'Equity',
        assetClassManualOverride: 'Tech',
        shares: 100,
        avgCost: 150,
        price: 200,
        lastImportedAt: '2026-08-08'
      },
      {
        id: 'pos-2',
        accountId: 'acc-1',
        symbol: 'MSFT',
        name: 'Microsoft',
        assetClass: 'Equity',
        assetClassManualOverride: 'Tech',
        shares: 50,
        avgCost: 300,
        price: 400,
        lastImportedAt: '2026-08-08'
      },
      {
        id: 'pos-3',
        accountId: 'acc-1',
        symbol: 'BND',
        name: 'Bond ETF',
        assetClass: 'Fixed Income',
        shares: 200,
        avgCost: 100,
        price: 105,
        lastImportedAt: '2026-08-08'
      }
    ]

    const state = createTestState({
      accounts: [testAccount1],
      positions
    })

    const options = assetClassOptions(state)

    // Should dedupe by override: Tech (from AAPL and MSFT overrides) + Fixed Income
    expect(options).toEqual(['Fixed Income', 'Tech'])
  })
})
