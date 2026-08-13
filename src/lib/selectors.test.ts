import { describe, it, expect } from 'vitest'
import {
  visiblePositions,
  visibleTransactions,
  allocationBars,
  filteredPortfolioTotal,
  assetClassOptions,
  accountsSections,
  computeCashInvestment,
  segmentCards,
  positionsForCategory
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

    const bars = allocationBars(positions)

    expect(bars).toHaveLength(2)
    bars.forEach((bar) => {
      expect(bar.label).toBeTruthy()
      expect(bar.value).toMatch(/^\$/) // Should start with $
      expect(bar.pct).toMatch(/%$/) // Should end with %
      expect(typeof bar.pctNum).toBe('number') // pctNum should be numeric
    })
    // Happy-path: verify pctNum values sum to approximately 100
    const pctSum = bars.reduce((sum, bar) => sum + bar.pctNum, 0)
    expect(pctSum).toBeCloseTo(100, 1)
  })

  it('allocationBars: handles empty positions array', () => {
    const bars = allocationBars([])
    expect(bars).toHaveLength(0)
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

  // === computeCashInvestment() tests ===

  // Test 1: computeCashInvestment with multiple accounts in one category (sum math)
  it('accountsSections: multiple accounts in one category - subtotal math correct', () => {
    const testAccount3: Account = {
      id: 'acc-3',
      accountNumber: '11111',
      name: 'Taxable Brokerage 2',
      institution: 'Fidelity',
      taxCategory: 'taxable',
      retirement: false,
      createdAt: '2026-01-01'
    }

    const positions: Position[] = [
      // Account 1: $1000 investment + $500 cash = $1500
      {
        id: 'pos-1',
        accountId: 'acc-1',
        symbol: 'AAPL',
        name: 'Apple Inc.',
        assetClass: 'Equity',
        shares: 10,
        avgCost: 150,
        price: 100,
        lastImportedAt: '2026-08-08'
      },
      {
        id: 'pos-2',
        accountId: 'acc-1',
        symbol: 'cash',
        name: 'Cash',
        assetClass: 'Cash',
        shares: 500,
        avgCost: 1,
        price: 1,
        lastImportedAt: '2026-08-08'
      },
      // Account 3: $2000 investment + $300 cash = $2300
      {
        id: 'pos-3',
        accountId: 'acc-3',
        symbol: 'MSFT',
        name: 'Microsoft',
        assetClass: 'Equity',
        shares: 5,
        avgCost: 150,
        price: 400,
        lastImportedAt: '2026-08-08'
      },
      {
        id: 'pos-4',
        accountId: 'acc-3',
        symbol: 'cash',
        name: 'Cash',
        assetClass: 'Cash',
        shares: 300,
        avgCost: 1,
        price: 1,
        lastImportedAt: '2026-08-08'
      }
    ]

    const state = createTestState({
      accounts: [testAccount1, testAccount3],
      positions
    })

    const sections = accountsSections(state)
    const taxableSection = sections[0]

    // Taxable section should have 2 accounts
    expect(taxableSection.rows).toHaveLength(2)
    // Total cash: 500 + 300 = 800
    expect(taxableSection.cashTotalStr).toBe('$800.00')
    // Total investment: 1000 + 2000 = 3000
    expect(taxableSection.investmentTotalStr).toBe('$3,000.00')
    // Grand total: 3800
    expect(taxableSection.grandTotalStr).toBe('$3,800.00')
  })

  // Test 2: Zero accounts in a category
  it('accountsSections: zero accounts in a category - hasRows/noRows and zero totals', () => {
    const state = createTestState({
      accounts: [testAccount1], // Only taxable account
      positions: []
    })

    const sections = accountsSections(state)
    const nonTaxableSection = sections[1]
    const taxDeferredSection = sections[2]

    // Non-Taxable section should be empty
    expect(nonTaxableSection.hasRows).toBe(false)
    expect(nonTaxableSection.noRows).toBe(true)
    expect(nonTaxableSection.rows).toHaveLength(0)
    expect(nonTaxableSection.cashTotalStr).toBe('$0.00')
    expect(nonTaxableSection.investmentTotalStr).toBe('$0.00')
    expect(nonTaxableSection.grandTotalStr).toBe('$0.00')

    // Tax-Deferred section should be empty
    expect(taxDeferredSection.hasRows).toBe(false)
    expect(taxDeferredSection.noRows).toBe(true)
    expect(taxDeferredSection.rows).toHaveLength(0)
    expect(taxDeferredSection.cashTotalStr).toBe('$0.00')
    expect(taxDeferredSection.investmentTotalStr).toBe('$0.00')
    expect(taxDeferredSection.grandTotalStr).toBe('$0.00')
  })

  // Test 3: Account with only cash positions
  it('computeCashInvestment: account with only cash positions', () => {
    const positions: Position[] = [
      {
        id: 'pos-1',
        accountId: 'acc-1',
        symbol: 'cash',
        name: 'Cash',
        assetClass: 'Cash',
        shares: 100,
        avgCost: 1,
        price: 1,
        lastImportedAt: '2026-08-08'
      },
      {
        id: 'pos-2',
        accountId: 'acc-1',
        symbol: 'CASH',
        name: 'More Cash',
        assetClass: 'Cash',
        shares: 200,
        avgCost: 1,
        price: 1,
        lastImportedAt: '2026-08-08'
      }
    ]

    const state = createTestState({
      accounts: [testAccount1],
      positions
    })

    const result = computeCashInvestment(state, 'acc-1')

    // Total cash: 100 + 200 = 300
    expect(result.cash).toBe(300)
    // No investment positions
    expect(result.investment).toBe(0)
  })

  // Test 4: Account with only non-cash positions
  it('computeCashInvestment: account with only non-cash positions', () => {
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
        shares: 50,
        avgCost: 100,
        price: 105,
        lastImportedAt: '2026-08-08'
      }
    ]

    const state = createTestState({
      accounts: [testAccount1],
      positions
    })

    const result = computeCashInvestment(state, 'acc-1')

    // No cash positions
    expect(result.cash).toBe(0)
    // Total investment: (10 * 200) + (50 * 105) = 2000 + 5250 = 7250
    expect(result.investment).toBe(7250)
  })

  // Test 5: Account with both cash and non-cash positions
  it('computeCashInvestment: account with both cash and non-cash positions', () => {
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
        symbol: 'cash',
        name: 'Cash',
        assetClass: 'Cash',
        shares: 1500,
        avgCost: 1,
        price: 1,
        lastImportedAt: '2026-08-08'
      }
    ]

    const state = createTestState({
      accounts: [testAccount1],
      positions
    })

    const result = computeCashInvestment(state, 'acc-1')

    // Cash: 1500
    expect(result.cash).toBe(1500)
    // Investment: 10 * 200 = 2000
    expect(result.investment).toBe(2000)
  })

  // Test 6: Case-insensitivity of cash symbol
  it('computeCashInvestment: cash symbol is case-insensitive', () => {
    const positions: Position[] = [
      {
        id: 'pos-1',
        accountId: 'acc-1',
        symbol: 'cash',
        name: 'Lowercase',
        assetClass: 'Cash',
        shares: 100,
        avgCost: 1,
        price: 1,
        lastImportedAt: '2026-08-08'
      },
      {
        id: 'pos-2',
        accountId: 'acc-1',
        symbol: 'CASH',
        name: 'Uppercase',
        assetClass: 'Cash',
        shares: 200,
        avgCost: 1,
        price: 1,
        lastImportedAt: '2026-08-08'
      },
      {
        id: 'pos-3',
        accountId: 'acc-1',
        symbol: 'Cash',
        name: 'Mixed Case',
        assetClass: 'Cash',
        shares: 150,
        avgCost: 1,
        price: 1,
        lastImportedAt: '2026-08-08'
      }
    ]

    const state = createTestState({
      accounts: [testAccount1],
      positions
    })

    const result = computeCashInvestment(state, 'acc-1')

    // All variants should be treated as cash: 100 + 200 + 150 = 450
    expect(result.cash).toBe(450)
    expect(result.investment).toBe(0)
  })

  // Test 7: Section ordering is always Taxable, Non-Taxable, Tax-Deferred
  it('accountsSections: section ordering is always Taxable, Non-Taxable, Tax-Deferred', () => {
    const testAccountNonTaxable: Account = {
      id: 'acc-nt',
      accountNumber: '99999',
      name: 'Non-Taxable Account',
      institution: 'Vanguard',
      taxCategory: 'nonTaxable',
      retirement: false,
      createdAt: '2026-01-01'
    }

    const state = createTestState({
      // Insert accounts in reverse order: taxDeferred, taxable, nonTaxable
      accounts: [testAccount2, testAccount1, testAccountNonTaxable],
      positions: []
    })

    const sections = accountsSections(state)

    // Verify order is always: Taxable (0), Non-Taxable (1), Tax-Deferred (2)
    expect(sections[0].label).toBe('Taxable')
    expect(sections[1].label).toBe('Non-Taxable')
    expect(sections[2].label).toBe('Tax-Deferred')
  })

  // Test 8: showDivider is true for sections 0 and 1, false for section 2
  it('accountsSections: showDivider is correct (true for 0,1 false for 2)', () => {
    const state = createTestState({
      accounts: [testAccount1, testAccount2],
      positions: []
    })

    const sections = accountsSections(state)

    // Sections 0 and 1 should have divider
    expect(sections[0].showDivider).toBe(true)
    expect(sections[1].showDivider).toBe(true)
    // Section 2 (last) should not have divider
    expect(sections[2].showDivider).toBe(false)
  })

  // Test 9: accountName format is "{name} ({accountNumber})"
  it('accountsSections: accountName format is "{name} ({accountNumber})"', () => {
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

    const sections = accountsSections(state)
    const taxableSection = sections[0]

    // Account 1 has name: 'Brokerage', accountNumber: '12345'
    expect(taxableSection.rows[0].accountName).toBe('Brokerage (12345)')
  })

  // === segmentCards() tests ===

  // Test 1: segmentCards with positive GL returns correct format
  it('segmentCards: positive GL returns +$X.XX (+Y.YY%) format', () => {
    const positions: Position[] = [
      {
        id: 'pos-1',
        accountId: 'acc-2',
        symbol: 'AAPL',
        name: 'Apple Inc.',
        assetClass: 'Equity',
        shares: 10,
        avgCost: 100,
        price: 150,
        lastImportedAt: '2026-08-08'
      }
    ]

    const state = createTestState({
      accounts: [testAccount1, testAccount2],
      positions
    })

    const card = segmentCards(state, true)

    // Expected: totalValue = 10 * 150 = 1500
    expect(card.totalValueStr).toBe('$1,500.00')
    // GL = (10 * 150) - (10 * 100) = 1500 - 1000 = 500
    // GL% = 500 / 1000 = 50%
    expect(card.glStr).toBe('+$500.00 (+50.00%)')
    // Positive GL = green color
    expect(card.glColor).toBe('#1fa971')
  })

  // Test 2: segmentCards with negative GL returns correct format
  it('segmentCards: negative GL returns -$X.XX (-Y.YY%) format', () => {
    const positions: Position[] = [
      {
        id: 'pos-1',
        accountId: 'acc-2',
        symbol: 'AAPL',
        name: 'Apple Inc.',
        assetClass: 'Equity',
        shares: 10,
        avgCost: 150,
        price: 100,
        lastImportedAt: '2026-08-08'
      }
    ]

    const state = createTestState({
      accounts: [testAccount1, testAccount2],
      positions
    })

    const card = segmentCards(state, true)

    // Expected: totalValue = 10 * 100 = 1000
    expect(card.totalValueStr).toBe('$1,000.00')
    // GL = (10 * 100) - (10 * 150) = 1000 - 1500 = -500
    // GL% = -500 / 1500 = -33.33%
    expect(card.glStr).toBe('-$500.00 (-33.33%)')
    // Negative GL = red color
    expect(card.glColor).toBe('#e2574c')
  })

  // Test 3: segmentCards with zero positions returns zero values
  it('segmentCards: zero positions returns $0.00 and +$0.00 (+0.00%)', () => {
    const state = createTestState({
      accounts: [testAccount1, testAccount2],
      positions: []
    })

    const card = segmentCards(state, true)

    // Expected: all zero values for retirement segment
    expect(card.totalValueStr).toBe('$0.00')
    expect(card.glStr).toBe('+$0.00 (+0.00%)')
    // Zero GL = green color (>= 0)
    expect(card.glColor).toBe('#1fa971')
  })

  // Test 4: segmentCards filters only retirement accounts
  it('segmentCards: true filters only retirement accounts, false filters only non-retirement', () => {
    const positions: Position[] = [
      {
        id: 'pos-1',
        accountId: 'acc-1',
        symbol: 'AAPL',
        name: 'Apple Inc.',
        assetClass: 'Equity',
        shares: 10,
        avgCost: 100,
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
        avgCost: 100,
        price: 200,
        lastImportedAt: '2026-08-08'
      }
    ]

    const state = createTestState({
      accounts: [testAccount1, testAccount2],
      positions
    })

    // Retirement segment should only include acc-2 (MSFT)
    const retirementCard = segmentCards(state, true)
    expect(retirementCard.totalValueStr).toBe('$1,000.00') // 5 * 200
    expect(retirementCard.glStr).toBe('+$500.00 (+100.00%)') // (5*200) - (5*100) = 500; 500/500 = 100%

    // Non-retirement segment should only include acc-1 (AAPL)
    const nonRetirementCard = segmentCards(state, false)
    expect(nonRetirementCard.totalValueStr).toBe('$2,000.00') // 10 * 200
    expect(nonRetirementCard.glStr).toBe('+$1,000.00 (+100.00%)') // (10*200) - (10*100) = 1000; 1000/1000 = 100%
  })

  // === positionsForCategory() tests ===

  // Test 1: positionsForCategory with 'all' returns all positions
  it('positionsForCategory: category=all returns all positions', () => {
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
      category: 'all'
    })

    const results = positionsForCategory(state)

    // Should return all 2 positions
    expect(results).toHaveLength(2)
    expect(results[0].symbol).toBe('AAPL')
    expect(results[1].symbol).toBe('MSFT')
  })

  // Test 2: positionsForCategory with specific category returns only that category's positions
  it('positionsForCategory: specific category returns only positions from that category', () => {
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
      category: 'taxable' // Only testAccount1 is taxable
    })

    const results = positionsForCategory(state)

    // Should return only AAPL (from acc-1, which is taxable)
    expect(results).toHaveLength(1)
    expect(results[0].symbol).toBe('AAPL')
  })

  // Test 3: positionsForCategory with category that has no positions returns empty array
  it('positionsForCategory: category with no accounts returns empty array', () => {
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
      accounts: [testAccount1], // Only taxable account
      positions,
      category: 'nonTaxable' // No non-taxable accounts
    })

    const results = positionsForCategory(state)

    expect(results).toHaveLength(0)
  })

  // Test 4: positionsForCategory with empty positions returns empty array
  it('positionsForCategory: empty positions returns empty array', () => {
    const state = createTestState({
      accounts: [testAccount1, testAccount2],
      positions: [],
      category: 'all'
    })

    const results = positionsForCategory(state)

    expect(results).toHaveLength(0)
  })
})
