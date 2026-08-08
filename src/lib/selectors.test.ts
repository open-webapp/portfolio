import { describe, it, expect } from 'vitest'
import {
  visiblePositions,
  visibleTransactions,
  totalValueSeries,
  totalValueSeriesInRange,
  summaryCards,
  allocationBars,
  performanceLinePoints,
  totalTaxesPaid
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
    name: 'Taxable Brokerage',
    taxCategory: 'taxable',
    retirement: false,
    createdAt: '2026-01-01'
  }

  const testAccount2: Account = {
    id: 'acc-2',
    accountNumber: '67890',
    name: 'Retirement IRA',
    taxCategory: 'nonTaxable',
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
      category: 'all'
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
      category: 'all'
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
      category: 'all'
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
      category: 'all'
    })

    const visible = visibleTransactions(state)

    expect(visible).toHaveLength(1)
    expect(visible[0].symbol).toBe('AAPL')
    expect(visible[0].type).toBe('Buy')
  })

  // Test 5: totalValueSeries sums accounts on same date
  it('totalValueSeries: two accounts with snapshots on same date sum into one point', () => {
    const snapshots: PortfolioSnapshot[] = [
      {
        id: 'snap-1',
        accountId: 'acc-1',
        date: '2026-08-01',
        value: 10000
      },
      {
        id: 'snap-2',
        accountId: 'acc-2',
        date: '2026-08-01',
        value: 20000
      },
      {
        id: 'snap-3',
        accountId: 'acc-1',
        date: '2026-08-02',
        value: 11000
      }
    ]

    const state = createTestState({
      accounts: [testAccount1, testAccount2],
      snapshots,
      category: 'all'
    })

    const series = totalValueSeries(state)

    expect(series).toHaveLength(2)
    expect(series[0]).toEqual({ date: '2026-08-01', value: 30000 })
    expect(series[1]).toEqual({ date: '2026-08-02', value: 11000 })
  })

  // Test 6: summaryCards Day Change computed from last two points
  it('summaryCards: Day Change is computed from last two totalValueSeries points', () => {
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

    const snapshots: PortfolioSnapshot[] = [
      {
        id: 'snap-1',
        accountId: 'acc-1',
        date: '2026-08-07',
        value: 10000
      },
      {
        id: 'snap-2',
        accountId: 'acc-1',
        date: '2026-08-08',
        value: 11000
      }
    ]

    const state = createTestState({
      accounts: [testAccount1],
      positions,
      snapshots,
      category: 'all'
    })

    const cards = summaryCards(state)

    // Find the Day Change card
    const dayChangeCard = cards.find((c) => c.label === 'Day Change')
    expect(dayChangeCard).toBeDefined()
    expect(dayChangeCard!.value).not.toBe('N/A')
    // The change is 11000 - 10000 = 1000 USD, so should be +$1,000.00
    expect(dayChangeCard!.value).toBe('+$1,000.00')
  })

  // Test 7: performanceLinePoints single-point series doesn't divide by zero
  it('performanceLinePoints: single-point series handles without divide-by-zero', () => {
    const snapshots: PortfolioSnapshot[] = [
      {
        id: 'snap-1',
        accountId: 'acc-1',
        date: '2026-08-08',
        value: 10000
      }
    ]

    const state = createTestState({
      accounts: [testAccount1],
      snapshots,
      category: 'all'
    })

    const points = performanceLinePoints(state, '1y')

    // Should return a valid string with a single point
    expect(points).toBeTruthy()
    expect(points).toContain(',')
  })

  // Test 8: Round-trip: multiple snapshots → series → chart points
  it('performanceLinePoints: multiple snapshots generate valid SVG polyline points', () => {
    const snapshots: PortfolioSnapshot[] = [
      {
        id: 'snap-1',
        accountId: 'acc-1',
        date: '2026-08-01',
        value: 10000
      },
      {
        id: 'snap-2',
        accountId: 'acc-1',
        date: '2026-08-02',
        value: 12000
      },
      {
        id: 'snap-3',
        accountId: 'acc-1',
        date: '2026-08-03',
        value: 11500
      }
    ]

    const state = createTestState({
      accounts: [testAccount1],
      snapshots,
      category: 'all'
    })

    const points = performanceLinePoints(state, '1y')

    // Should have 3 point pairs separated by spaces
    const pointArray = points.split(' ')
    expect(pointArray).toHaveLength(3)
    pointArray.forEach((point) => {
      expect(point).toMatch(/^\d+(\.\d+)??,\d+(\.\d+)?$/)
    })
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
      category: 'all'
    })

    const visible = visiblePositions(state)

    expect(visible).toHaveLength(1)
  })

  // Test: Category filtering
  it('visiblePositions: respects category filter', () => {
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
        accountId: 'acc-2',
        symbol: 'MSFT',
        name: 'Microsoft',
        assetClass: 'Equity',
        shares: 50,
        avgCost: 300,
        price: 400,
        lastImportedAt: '2026-08-08'
      }
    ]

    const state = createTestState({
      accounts: [testAccount1, testAccount2],
      positions,
      category: 'taxable', // Only taxable accounts
      assetClassFilter: 'All'
    })

    const visible = visiblePositions(state)

    // Should only see AAPL from taxable account
    expect(visible).toHaveLength(1)
    expect(visible[0].symbol).toBe('AAPL')
  })

  // Test: Retirement filter
  it('visiblePositions: respects retirement filter', () => {
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
        accountId: 'acc-2',
        symbol: 'MSFT',
        name: 'Microsoft',
        assetClass: 'Equity',
        shares: 50,
        avgCost: 300,
        price: 400,
        lastImportedAt: '2026-08-08'
      }
    ]

    const state = createTestState({
      accounts: [testAccount1, testAccount2],
      positions,
      category: 'all',
      assetClassFilter: 'All',
      retirementFilter: 'Retirement' // Only retirement accounts
    })

    const visible = visiblePositions(state)

    // Should only see MSFT from retirement account
    expect(visible).toHaveLength(1)
    expect(visible[0].symbol).toBe('MSFT')
  })

  // Test: summaryCards with no snapshots (Day Change N/A)
  it('summaryCards: Day Change is N/A when fewer than 2 snapshots', () => {
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
      snapshots: [],
      category: 'all'
    })

    const cards = summaryCards(state)

    const dayChangeCard = cards.find((c) => c.label === 'Day Change')
    expect(dayChangeCard!.value).toBe('N/A')
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
      category: 'all'
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
    expect(totalValueSeries(state)).toHaveLength(0)
    expect(performanceLinePoints(state, '1y')).toBe('')
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
      category: 'all',
      sortKey: 'symbol',
      sortDir: 'asc'
    })

    const visible = visiblePositions(state)

    expect(visible[0].symbol).toBe('AAAB')
    expect(visible[1].symbol).toBe('ZZZA')
  })

  // Test: totalTaxesPaid selector computes correct sum
  it('totalTaxesPaid: sums all taxes from transactions in category', () => {
    const transactions: Transaction[] = [
      {
        id: 'tx-1',
        accountId: 'acc-1',
        date: '2026-08-01',
        symbol: 'AAPL',
        type: 'Dividend',
        shares: 0,
        price: 0,
        amount: 100,
        taxes: 15,
        importedAt: '2026-08-01'
      },
      {
        id: 'tx-2',
        accountId: 'acc-1',
        date: '2026-08-02',
        symbol: 'MSFT',
        type: 'Dividend',
        shares: 0,
        price: 0,
        amount: 50,
        taxes: 7.5,
        importedAt: '2026-08-02'
      },
      {
        id: 'tx-3',
        accountId: 'acc-2',
        date: '2026-08-03',
        symbol: 'GOOG',
        type: 'Dividend',
        shares: 0,
        price: 0,
        amount: 200,
        taxes: 30,
        importedAt: '2026-08-03'
      }
    ]

    const state = createTestState({
      accounts: [testAccount1, testAccount2],
      transactions,
      category: 'taxable' // Only taxable accounts
    })

    const taxes = totalTaxesPaid(state)

    // Should only count taxes from acc-1 (taxable) = 15 + 7.5 = 22.5
    expect(taxes).toBe(22.5)
  })

  // Test: totalTaxesPaid with null taxes (treated as 0)
  it('totalTaxesPaid: treats null taxes as 0', () => {
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
        taxes: null,
        importedAt: '2026-08-01'
      },
      {
        id: 'tx-2',
        accountId: 'acc-1',
        date: '2026-08-02',
        symbol: 'MSFT',
        type: 'Dividend',
        shares: 0,
        price: 0,
        amount: 50,
        taxes: 10,
        importedAt: '2026-08-02'
      }
    ]

    const state = createTestState({
      accounts: [testAccount1],
      transactions,
      category: 'all'
    })

    const taxes = totalTaxesPaid(state)

    // Should be 0 + 10 = 10
    expect(taxes).toBe(10)
  })

  // Test: summaryCards includes Total Taxes Paid card
  it('summaryCards: includes Total Taxes Paid card', () => {
    const transactions: Transaction[] = [
      {
        id: 'tx-1',
        accountId: 'acc-1',
        date: '2026-08-01',
        symbol: 'AAPL',
        type: 'Dividend',
        shares: 0,
        price: 0,
        amount: 100,
        taxes: 20,
        importedAt: '2026-08-01'
      }
    ]

    const state = createTestState({
      accounts: [testAccount1],
      transactions,
      category: 'all'
    })

    const cards = summaryCards(state)

    // Should have 5 cards now (added Total Taxes Paid)
    expect(cards).toHaveLength(5)

    // Find the Total Taxes Paid card
    const taxCard = cards.find((c) => c.label === 'Total Taxes Paid')
    expect(taxCard).toBeDefined()
    expect(taxCard!.value).toBe('$20.00')
    expect(taxCard!.color).toBe('var(--color-text)')
  })

  // Test: summaryCards with zero taxes
  it('summaryCards: Total Taxes Paid shows $0.00 with no taxes', () => {
    const state = createTestState({
      accounts: [testAccount1],
      transactions: [],
      category: 'all'
    })

    const cards = summaryCards(state)

    const taxCard = cards.find((c) => c.label === 'Total Taxes Paid')
    expect(taxCard).toBeDefined()
    expect(taxCard!.value).toBe('$0.00')
  })

  // Test: totalValueSeriesInRange 'all' returns the full series unfiltered
  it('totalValueSeriesInRange: "all" returns every snapshot regardless of age', () => {
    const snapshots: PortfolioSnapshot[] = [
      { id: 'snap-1', accountId: 'acc-1', date: '2015-01-01', value: 5000 },
      { id: 'snap-2', accountId: 'acc-1', date: '2026-08-08', value: 11000 }
    ]

    const state = createTestState({ accounts: [testAccount1], snapshots, category: 'all' })

    expect(totalValueSeriesInRange(state, 'all')).toHaveLength(2)
  })

  // Test: totalValueSeriesInRange drops snapshots older than the '6m' cutoff
  it('totalValueSeriesInRange: "6m" excludes snapshots older than 6 months', () => {
    const now = new Date()
    const old = new Date(now)
    old.setMonth(old.getMonth() - 8)
    const recent = new Date(now)
    recent.setMonth(recent.getMonth() - 1)

    const snapshots: PortfolioSnapshot[] = [
      { id: 'snap-old', accountId: 'acc-1', date: old.toISOString().slice(0, 10), value: 5000 },
      { id: 'snap-recent', accountId: 'acc-1', date: recent.toISOString().slice(0, 10), value: 11000 }
    ]

    const state = createTestState({ accounts: [testAccount1], snapshots, category: 'all' })

    const filtered = totalValueSeriesInRange(state, '6m')
    expect(filtered).toHaveLength(1)
    expect(filtered[0].value).toBe(11000)
  })

  // Test: totalValueSeriesInRange 'ytd' only keeps snapshots from Jan 1 of this year onward
  it('totalValueSeriesInRange: "ytd" excludes snapshots from before this calendar year', () => {
    const now = new Date()
    const lastYear = new Date(now.getFullYear() - 1, 5, 15)

    const snapshots: PortfolioSnapshot[] = [
      { id: 'snap-lastyear', accountId: 'acc-1', date: lastYear.toISOString().slice(0, 10), value: 5000 },
      { id: 'snap-jan1', accountId: 'acc-1', date: `${now.getFullYear()}-01-01`, value: 9000 }
    ]

    const state = createTestState({ accounts: [testAccount1], snapshots, category: 'all' })

    const filtered = totalValueSeriesInRange(state, 'ytd')
    expect(filtered).toHaveLength(1)
    expect(filtered[0].value).toBe(9000)
  })

  // Test: performanceLinePoints actually responds to the range argument (regression:
  // this used to ignore range entirely and always plot the full history)
  it('performanceLinePoints: a shorter range produces fewer plotted points than "all"', () => {
    const now = new Date()
    const old = new Date(now)
    old.setFullYear(old.getFullYear() - 3)

    const snapshots: PortfolioSnapshot[] = [
      { id: 'snap-old', accountId: 'acc-1', date: old.toISOString().slice(0, 10), value: 5000 },
      { id: 'snap-recent-1', accountId: 'acc-1', date: now.toISOString().slice(0, 10), value: 6000 },
      {
        id: 'snap-recent-2',
        accountId: 'acc-1',
        date: new Date(now.getTime() - 86400000).toISOString().slice(0, 10),
        value: 6500
      }
    ]

    const state = createTestState({ accounts: [testAccount1], snapshots, category: 'all' })

    const allPoints = performanceLinePoints(state, 'all').split(' ')
    const sixMonthPoints = performanceLinePoints(state, '6m').split(' ')

    expect(allPoints).toHaveLength(3)
    expect(sixMonthPoints.length).toBeLessThan(allPoints.length)
  })
})
