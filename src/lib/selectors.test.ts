import { describe, it, expect } from 'vitest'
import {
  visibleTransactions,
  allocationBars,
  filteredPortfolioTotal,
  assetClassOptions,
  categoryCards,
  closedPositionsCard,
  acctScopedPositions,
  acctAssetClassOptions,
  acctFilteredPositions,
  acctScopedClosedPositions,
  acctFilteredClosedPositions,
  acctAllocationTitle
} from './selectors'
import { AppState, initialState } from './state'
import { Account, Position, Transaction, ClosedPosition } from './types'

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
  // Test 2: visiblePositions with specific asset class filters correctly
  // Test 3: visiblePositions search matches on symbol OR name, case-insensitive
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
  // Test: Sorting in visiblePositions

  // Test: totalTaxesPaid with null taxes (treated as 0)

  // === filteredPortfolioTotal() tests ===

  it('filteredPortfolioTotal: sums market value across every position, regardless of account', () => {
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
        symbol: 'VTI',
        name: 'Vanguard Total Market',
        assetClass: 'ETF',
        shares: 4,
        avgCost: 100,
        price: 125,
        lastImportedAt: '2026-08-08'
      }
    ]

    const state = createTestState({
      accounts: [testAccount1, testAccount2],
      positions,
    })

    // (10 * 200) + (4 * 125) = 2500 — both accounts contribute.
    expect(filteredPortfolioTotal(state)).toBe(2500)
  })

  it('filteredPortfolioTotal: returns 0 for an empty portfolio', () => {
    expect(filteredPortfolioTotal(createTestState({}))).toBe(0)
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

  // === categoryCards() tests ===

  it('categoryCards: multiple accounts in one category - totals and order correct', () => {
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
        accountId: 'acc-3',
        symbol: 'MSFT',
        name: 'Microsoft',
        assetClass: 'Equity',
        shares: 5,
        avgCost: 150,
        price: 400,
        lastImportedAt: '2026-08-08'
      }
    ]

    const state = createTestState({
      accounts: [testAccount2, testAccount1, testAccount3],
      positions
    })

    const cards = categoryCards(state)

    // Order is always Taxable, Non-Taxable, Tax-Deferred
    expect(cards.map((c) => c.label)).toEqual(['Taxable', 'Non-Taxable', 'Tax-Deferred'])

    const taxable = cards[0]
    expect(taxable.accountCount).toBe(2)
    // Account 1: 10*100=1000, Account 3: 5*400=2000, total 3000
    expect(taxable.totalStr).toBe('$3,000.00')
    expect(taxable.accounts.find((a) => a.id === 'acc-1')?.totalStr).toBe('$1,000.00')
    expect(taxable.accounts.find((a) => a.id === 'acc-3')?.totalStr).toBe('$2,000.00')
  })

  it('categoryCards: zero accounts in a category - hasAccounts/noAccounts and zero total', () => {
    const state = createTestState({
      accounts: [testAccount1], // taxable only
      positions: []
    })

    const cards = categoryCards(state)
    const nonTaxable = cards[1]

    expect(nonTaxable.hasAccounts).toBe(false)
    expect(nonTaxable.noAccounts).toBe(true)
    expect(nonTaxable.accounts).toEqual([])
    expect(nonTaxable.totalStr).toBe('$0.00')
  })

  it('categoryCards: account with zero positions shows updatedStr "—"', () => {
    const state = createTestState({
      accounts: [testAccount1],
      positions: []
    })

    const cards = categoryCards(state)
    expect(cards[0].accounts[0].updatedStr).toBe('—')
  })

  it('categoryCards: expanded reflects state.expandedCategories, defaults to false', () => {
    const state = createTestState({
      accounts: [testAccount1],
      expandedCategories: { taxable: true }
    })

    const cards = categoryCards(state)
    expect(cards.find((c) => c.key === 'taxable')?.expanded).toBe(true)
    expect(cards.find((c) => c.key === 'nonTaxable')?.expanded).toBe(false)
  })

  it('categoryCards: selected reflects state.selectedAccountId && state.selectedCategoryKey', () => {
    const state = createTestState({
      accounts: [testAccount1],
      selectedAccountId: 'acc-1',
      selectedCategoryKey: 'taxable'
    })

    const cards = categoryCards(state)
    expect(cards[0].accounts[0].selected).toBe(true)
  })

  it('categoryCards: selected is false when selectedCategoryKey differs', () => {
    const state = createTestState({
      accounts: [testAccount1],
      selectedAccountId: 'acc-1',
      selectedCategoryKey: 'closedPositions'
    })

    const cards = categoryCards(state)
    expect(cards[0].accounts[0].selected).toBe(false)
  })

  // === acctScopedPositions() / acctAssetClassOptions() / acctFilteredPositions() / acctAllocationTitle() tests ===

  it('acctScopedPositions: selected account returns only its positions', () => {
    const positions: Position[] = [
      { id: 'pos-1', accountId: 'acc-1', symbol: 'AAPL', name: 'Apple', assetClass: 'Equity', shares: 1, avgCost: 100, price: 100, lastImportedAt: '2026-08-08' },
      { id: 'pos-2', accountId: 'acc-2', symbol: 'BND', name: 'Bond', assetClass: 'Fixed Income', shares: 1, avgCost: 100, price: 100, lastImportedAt: '2026-08-08' }
    ]
    const state = createTestState({ accounts: [testAccount1, testAccount2], positions, selectedAccountId: 'acc-1' })
    expect(acctScopedPositions(state)).toEqual([positions[0]])
  })

  it('acctScopedPositions: no selection returns all positions', () => {
    const positions: Position[] = [
      { id: 'pos-1', accountId: 'acc-1', symbol: 'AAPL', name: 'Apple', assetClass: 'Equity', shares: 1, avgCost: 100, price: 100, lastImportedAt: '2026-08-08' }
    ]
    const state = createTestState({ accounts: [testAccount1], positions, selectedAccountId: null })
    expect(acctScopedPositions(state)).toEqual(positions)
  })

  it('acctAssetClassOptions: dedupes and sorts', () => {
    const positions: Position[] = [
      { id: 'pos-1', accountId: 'acc-1', symbol: 'AAPL', name: 'Apple', assetClass: 'Tech', shares: 1, avgCost: 100, price: 100, lastImportedAt: '2026-08-08' },
      { id: 'pos-2', accountId: 'acc-1', symbol: 'BND', name: 'Bond', assetClass: 'Bonds', shares: 1, avgCost: 100, price: 100, lastImportedAt: '2026-08-08' },
      { id: 'pos-3', accountId: 'acc-1', symbol: 'MSFT', name: 'Microsoft', assetClass: 'Tech', shares: 1, avgCost: 100, price: 100, lastImportedAt: '2026-08-08' }
    ]
    expect(acctAssetClassOptions(positions)).toEqual(['Bonds', 'Tech'])
  })

  it('acctAssetClassOptions: empty positions returns empty array', () => {
    expect(acctAssetClassOptions([])).toEqual([])
  })

  it('acctAssetClassOptions: works with ClosedPosition[] array via structural compatibility', () => {
    const closedPositions: ClosedPosition[] = [
      { id: 'cp-1', accountId: 'acc-1', symbol: 'AAPL', name: 'Apple', assetClass: 'Equity', assetClassManualOverride: 'Tech', shares: 100, avgCost: 150, price: 200, closedDate: '2026-08-01', lastImportedAt: '2026-08-08', realizedGL: 500, realizedGLBasis: 'transactions' },
      { id: 'cp-2', accountId: 'acc-1', symbol: 'BND', name: 'Bond', assetClass: 'Bonds', shares: 50, avgCost: 100, price: 105, closedDate: '2026-08-02', lastImportedAt: '2026-08-08', realizedGL: 25, realizedGLBasis: 'transactions' },
      { id: 'cp-3', accountId: 'acc-1', symbol: 'MSFT', name: 'Microsoft', assetClass: 'Equity', shares: 75, avgCost: 300, price: 400, closedDate: '2026-08-03', lastImportedAt: '2026-08-08', realizedGL: null, realizedGLBasis: 'unknown' }
    ]
    // Should return distinct effective asset classes (Tech override for cp-1, Bonds for cp-2, Equity for cp-3), sorted
    expect(acctAssetClassOptions(closedPositions)).toEqual(['Bonds', 'Equity', 'Tech'])
  })

  it('acctFilteredPositions: composes asset-class filter and search', () => {
    const positions: Position[] = [
      { id: 'pos-1', accountId: 'acc-1', symbol: 'AAPL', name: 'Apple Inc.', assetClass: 'Tech', shares: 1, avgCost: 100, price: 100, lastImportedAt: '2026-08-08' },
      { id: 'pos-2', accountId: 'acc-1', symbol: 'BND', name: 'Bond ETF', assetClass: 'Bonds', shares: 1, avgCost: 100, price: 100, lastImportedAt: '2026-08-08' }
    ]
    const state = createTestState({ accounts: [testAccount1], positions, acctAssetClassFilter: 'Tech', acctPosSearch: '' })
    expect(acctFilteredPositions(state)).toEqual([positions[0]])
  })

  it('acctFilteredPositions: All filter + empty search matches acctScopedPositions', () => {
    const positions: Position[] = [
      { id: 'pos-1', accountId: 'acc-1', symbol: 'AAPL', name: 'Apple Inc.', assetClass: 'Tech', shares: 1, avgCost: 100, price: 100, lastImportedAt: '2026-08-08' }
    ]
    const state = createTestState({ accounts: [testAccount1], positions })
    expect(acctFilteredPositions(state)).toEqual(acctScopedPositions(state))
  })

  it('acctFilteredPositions: search matches name case-insensitively', () => {
    const positions: Position[] = [
      { id: 'pos-1', accountId: 'acc-1', symbol: 'AAPL', name: 'Apple Inc.', assetClass: 'Tech', shares: 1, avgCost: 100, price: 100, lastImportedAt: '2026-08-08' },
      { id: 'pos-2', accountId: 'acc-1', symbol: 'MSFT', name: 'Microsoft', assetClass: 'Tech', shares: 1, avgCost: 100, price: 100, lastImportedAt: '2026-08-08' }
    ]
    const state = createTestState({ accounts: [testAccount1], positions, acctPosSearch: 'apple' })
    expect(acctFilteredPositions(state)).toEqual([positions[0]])
  })

  it('acctAllocationTitle: selected account uses account name', () => {
    const state = createTestState({ accounts: [testAccount1], selectedAccountId: 'acc-1' })
    expect(acctAllocationTitle(state)).toBe('Allocation — Brokerage')
  })

  it('acctAllocationTitle: no selection returns "Allocation — All Accounts"', () => {
    const state = createTestState({ accounts: [testAccount1], selectedAccountId: null })
    expect(acctAllocationTitle(state)).toBe('Allocation — All Accounts')
  })

  // === acctScopedClosedPositions() / acctFilteredClosedPositions() tests ===

  it('acctScopedClosedPositions: selected account returns only its closed positions', () => {
    const closedPositions: ClosedPosition[] = [
      { id: 'cp-1', accountId: 'acc-1', symbol: 'AAPL', name: 'Apple', assetClass: 'Equity', shares: 100, avgCost: 150, price: 200, closedDate: '2026-08-01', lastImportedAt: '2026-08-08', realizedGL: 5000, realizedGLBasis: 'transactions' },
      { id: 'cp-2', accountId: 'acc-2', symbol: 'BND', name: 'Bond', assetClass: 'Fixed Income', shares: 50, avgCost: 100, price: 105, closedDate: '2026-08-02', lastImportedAt: '2026-08-08', realizedGL: 250, realizedGLBasis: 'transactions' }
    ]
    const state = createTestState({ accounts: [testAccount1, testAccount2], closedPositions, selectedAccountId: 'acc-1' })
    expect(acctScopedClosedPositions(state)).toEqual([closedPositions[0]])
  })

  it('acctScopedClosedPositions: no selection returns all closed positions', () => {
    const closedPositions: ClosedPosition[] = [
      { id: 'cp-1', accountId: 'acc-1', symbol: 'AAPL', name: 'Apple', assetClass: 'Equity', shares: 100, avgCost: 150, price: 200, closedDate: '2026-08-01', lastImportedAt: '2026-08-08', realizedGL: 5000, realizedGLBasis: 'transactions' }
    ]
    const state = createTestState({ accounts: [testAccount1], closedPositions, selectedAccountId: null })
    expect(acctScopedClosedPositions(state)).toEqual(closedPositions)
  })

  it('acctScopedClosedPositions: account with zero closed positions returns empty array', () => {
    const state = createTestState({ accounts: [testAccount1], closedPositions: [], selectedAccountId: 'acc-1' })
    expect(acctScopedClosedPositions(state)).toEqual([])
  })

  it('acctFilteredClosedPositions: asset-class filter narrows correctly', () => {
    const closedPositions: ClosedPosition[] = [
      { id: 'cp-1', accountId: 'acc-1', symbol: 'AAPL', name: 'Apple', assetClass: 'Equity', shares: 100, avgCost: 150, price: 200, closedDate: '2026-08-01', lastImportedAt: '2026-08-08', realizedGL: 5000, realizedGLBasis: 'transactions' },
      { id: 'cp-2', accountId: 'acc-1', symbol: 'BND', name: 'Bond', assetClass: 'Fixed Income', shares: 50, avgCost: 100, price: 105, closedDate: '2026-08-02', lastImportedAt: '2026-08-08', realizedGL: 250, realizedGLBasis: 'transactions' }
    ]
    const state = createTestState({ accounts: [testAccount1], closedPositions, selectedAccountId: 'acc-1', acctAssetClassFilter: 'Equity', acctPosSearch: '' })
    expect(acctFilteredClosedPositions(state)).toEqual([closedPositions[0]])
  })

  it('acctFilteredClosedPositions: search matches symbol case-insensitively', () => {
    const closedPositions: ClosedPosition[] = [
      { id: 'cp-1', accountId: 'acc-1', symbol: 'AAPL', name: 'Apple', assetClass: 'Equity', shares: 100, avgCost: 150, price: 200, closedDate: '2026-08-01', lastImportedAt: '2026-08-08', realizedGL: 5000, realizedGLBasis: 'transactions' },
      { id: 'cp-2', accountId: 'acc-1', symbol: 'MSFT', name: 'Microsoft', assetClass: 'Equity', shares: 50, avgCost: 100, price: 105, closedDate: '2026-08-02', lastImportedAt: '2026-08-08', realizedGL: 250, realizedGLBasis: 'transactions' }
    ]
    const state = createTestState({ accounts: [testAccount1], closedPositions, selectedAccountId: 'acc-1', acctAssetClassFilter: 'All', acctPosSearch: 'aapl' })
    expect(acctFilteredClosedPositions(state)).toEqual([closedPositions[0]])
  })

  it('acctFilteredClosedPositions: search matches name case-insensitively', () => {
    const closedPositions: ClosedPosition[] = [
      { id: 'cp-1', accountId: 'acc-1', symbol: 'AAPL', name: 'Apple Inc.', assetClass: 'Equity', shares: 100, avgCost: 150, price: 200, closedDate: '2026-08-01', lastImportedAt: '2026-08-08', realizedGL: 5000, realizedGLBasis: 'transactions' },
      { id: 'cp-2', accountId: 'acc-1', symbol: 'MSFT', name: 'Microsoft', assetClass: 'Equity', shares: 50, avgCost: 100, price: 105, closedDate: '2026-08-02', lastImportedAt: '2026-08-08', realizedGL: 250, realizedGLBasis: 'transactions' }
    ]
    const state = createTestState({ accounts: [testAccount1], closedPositions, selectedAccountId: 'acc-1', acctAssetClassFilter: 'All', acctPosSearch: 'micro' })
    expect(acctFilteredClosedPositions(state)).toEqual([closedPositions[1]])
  })

  it('acctFilteredClosedPositions: combining asset-class filter and search narrows further', () => {
    const closedPositions: ClosedPosition[] = [
      { id: 'cp-1', accountId: 'acc-1', symbol: 'AAPL', name: 'Apple', assetClass: 'Equity', shares: 100, avgCost: 150, price: 200, closedDate: '2026-08-01', lastImportedAt: '2026-08-08', realizedGL: 5000, realizedGLBasis: 'transactions' },
      { id: 'cp-2', accountId: 'acc-1', symbol: 'BND', name: 'Bond', assetClass: 'Fixed Income', shares: 50, avgCost: 100, price: 105, closedDate: '2026-08-02', lastImportedAt: '2026-08-08', realizedGL: 250, realizedGLBasis: 'transactions' },
      { id: 'cp-3', accountId: 'acc-1', symbol: 'MSFT', name: 'Microsoft', assetClass: 'Equity', shares: 75, avgCost: 300, price: 400, closedDate: '2026-08-03', lastImportedAt: '2026-08-08', realizedGL: 7500, realizedGLBasis: 'transactions' }
    ]
    const state = createTestState({ accounts: [testAccount1], closedPositions, selectedAccountId: 'acc-1', acctAssetClassFilter: 'Equity', acctPosSearch: 'apple' })
    expect(acctFilteredClosedPositions(state)).toEqual([closedPositions[0]])
  })

  it('acctFilteredClosedPositions: respects assetClassManualOverride when filtering', () => {
    const closedPositions: ClosedPosition[] = [
      { id: 'cp-1', accountId: 'acc-1', symbol: 'AAPL', name: 'Apple', assetClass: 'Equity', assetClassManualOverride: 'Tech', shares: 100, avgCost: 150, price: 200, closedDate: '2026-08-01', lastImportedAt: '2026-08-08', realizedGL: 5000, realizedGLBasis: 'transactions' },
      { id: 'cp-2', accountId: 'acc-1', symbol: 'BND', name: 'Bond', assetClass: 'Fixed Income', shares: 50, avgCost: 100, price: 105, closedDate: '2026-08-02', lastImportedAt: '2026-08-08', realizedGL: 250, realizedGLBasis: 'transactions' }
    ]
    const state = createTestState({ accounts: [testAccount1], closedPositions, selectedAccountId: 'acc-1', acctAssetClassFilter: 'Tech' })
    expect(acctFilteredClosedPositions(state)).toEqual([closedPositions[0]])
  })

  it('acctFilteredClosedPositions: All filter + empty search matches acctScopedClosedPositions', () => {
    const closedPositions: ClosedPosition[] = [
      { id: 'cp-1', accountId: 'acc-1', symbol: 'AAPL', name: 'Apple', assetClass: 'Equity', shares: 100, avgCost: 150, price: 200, closedDate: '2026-08-01', lastImportedAt: '2026-08-08', realizedGL: 5000, realizedGLBasis: 'transactions' }
    ]
    const state = createTestState({ accounts: [testAccount1], closedPositions, selectedAccountId: 'acc-1' })
    expect(acctFilteredClosedPositions(state)).toEqual(acctScopedClosedPositions(state))
  })

  // === segmentCards() tests ===

  // Test 1: segmentCards with positive GL returns correct format
  // Test 2: segmentCards with negative GL returns correct format
  // Test 3: segmentCards with zero positions returns zero values
  // Test 4: segmentCards filters only retirement accounts
  // === positionsForCategory() tests ===

  // Test 1: positionsForCategory with 'all' returns all positions
  // Test 2: positionsForCategory with specific category returns only that category's positions
  // Test 3: positionsForCategory with category that has no positions returns empty array
  // Test 4: positionsForCategory with empty positions returns empty array
  // === closedPositionsCard() tests ===

  it('closedPositionsCard: happy path with 2 accounts and closed positions', () => {
    const testAccount3: Account = {
      id: 'acc-3',
      accountNumber: '11111',
      name: 'Secondary Brokerage',
      institution: 'Fidelity',
      taxCategory: 'taxable',
      retirement: false,
      createdAt: '2026-01-01'
    }

    const closedPositions: ClosedPosition[] = [
      {
        id: 'cp-1',
        accountId: 'acc-1',
        symbol: 'AAPL',
        name: 'Apple Inc.',
        assetClass: 'Equity',
        shares: 100,
        avgCost: 150,
        price: 200,
        closedDate: '2026-07-01',
        lastImportedAt: '2026-08-08',
        realizedGL: 5000,
        realizedGLBasis: 'transactions'
      },
      {
        id: 'cp-2',
        accountId: 'acc-1',
        symbol: 'MSFT',
        name: 'Microsoft',
        assetClass: 'Equity',
        shares: 50,
        avgCost: 300,
        price: 400,
        closedDate: '2026-07-15',
        lastImportedAt: '2026-08-08',
        realizedGL: 5000,
        realizedGLBasis: 'transactions'
      },
      {
        id: 'cp-3',
        accountId: 'acc-3',
        symbol: 'BND',
        name: 'Bond ETF',
        assetClass: 'Fixed Income',
        shares: 200,
        avgCost: 100,
        price: 105,
        closedDate: '2026-08-01',
        lastImportedAt: '2026-08-08',
        realizedGL: 1000,
        realizedGLBasis: 'transactions'
      }
    ]

    const state = createTestState({
      accounts: [testAccount1, testAccount2, testAccount3],
      closedPositions
    })

    const card = closedPositionsCard(state)

    // Card structure
    expect(card.key).toBe('closedPositions')
    expect(card.label).toBe('Closed Positions')
    expect(card.accountCount).toBe(2)
    expect(card.hasAccounts).toBe(true)
    expect(card.noAccounts).toBe(false)

    // Card total: 5000 + 5000 + 1000 = 11000
    expect(card.totalStr).toBe('$11,000.00')

    // Check account totals
    const acc1 = card.accounts.find((a) => a.id === 'acc-1')
    expect(acc1).toBeDefined()
    expect(acc1?.totalStr).toBe('$10,000.00') // 5000 + 5000

    const acc3 = card.accounts.find((a) => a.id === 'acc-3')
    expect(acc3).toBeDefined()
    expect(acc3?.totalStr).toBe('$1,000.00')
  })

  it('closedPositionsCard: account with all unknown-basis closed positions shows "—" for totalStr', () => {
    const closedPositions: ClosedPosition[] = [
      {
        id: 'cp-1',
        accountId: 'acc-1',
        symbol: 'AAPL',
        name: 'Apple Inc.',
        assetClass: 'Equity',
        shares: 100,
        avgCost: 150,
        price: 200,
        closedDate: '2026-07-01',
        lastImportedAt: '2026-08-08',
        realizedGL: null,
        realizedGLBasis: 'unknown'
      },
      {
        id: 'cp-2',
        accountId: 'acc-1',
        symbol: 'MSFT',
        name: 'Microsoft',
        assetClass: 'Equity',
        shares: 50,
        avgCost: 300,
        price: 400,
        closedDate: '2026-07-15',
        lastImportedAt: '2026-08-07',
        realizedGL: null,
        realizedGLBasis: 'unknown'
      }
    ]

    const state = createTestState({
      accounts: [testAccount1],
      closedPositions
    })

    const card = closedPositionsCard(state)

    // Account should still be included (has closed positions)
    expect(card.accountCount).toBe(1)
    // But totalStr should be '—'
    expect(card.accounts[0].totalStr).toBe('—')
    // Card total should also be '—'
    expect(card.totalStr).toBe('—')
  })

  it('closedPositionsCard: mixed known/unknown-basis closed positions sums only known realizedGL', () => {
    const closedPositions: ClosedPosition[] = [
      {
        id: 'cp-1',
        accountId: 'acc-1',
        symbol: 'AAPL',
        name: 'Apple Inc.',
        assetClass: 'Equity',
        shares: 100,
        avgCost: 150,
        price: 200,
        closedDate: '2026-07-01',
        lastImportedAt: '2026-08-08',
        realizedGL: 5000,
        realizedGLBasis: 'transactions'
      },
      {
        id: 'cp-2',
        accountId: 'acc-1',
        symbol: 'MSFT',
        name: 'Microsoft',
        assetClass: 'Equity',
        shares: 50,
        avgCost: 300,
        price: 400,
        closedDate: '2026-07-15',
        lastImportedAt: '2026-08-07',
        realizedGL: null,
        realizedGLBasis: 'unknown'
      }
    ]

    const state = createTestState({
      accounts: [testAccount1],
      closedPositions
    })

    const card = closedPositionsCard(state)

    // Account total should be 5000 (only the known one)
    expect(card.accounts[0].totalStr).toBe('$5,000.00')
    // Card total should also be 5000
    expect(card.totalStr).toBe('$5,000.00')
  })

  it('closedPositionsCard: card-level total with multiple accounts sums correctly', () => {
    const closedPositions: ClosedPosition[] = [
      {
        id: 'cp-1',
        accountId: 'acc-1',
        symbol: 'AAPL',
        name: 'Apple Inc.',
        assetClass: 'Equity',
        shares: 100,
        avgCost: 150,
        price: 200,
        closedDate: '2026-07-01',
        lastImportedAt: '2026-08-08',
        realizedGL: 3000,
        realizedGLBasis: 'transactions'
      },
      {
        id: 'cp-2',
        accountId: 'acc-2',
        symbol: 'BND',
        name: 'Bond ETF',
        assetClass: 'Fixed Income',
        shares: 50,
        avgCost: 100,
        price: 105,
        closedDate: '2026-08-01',
        lastImportedAt: '2026-08-08',
        realizedGL: 2000,
        realizedGLBasis: 'transactions'
      }
    ]

    const state = createTestState({
      accounts: [testAccount1, testAccount2],
      closedPositions
    })

    const card = closedPositionsCard(state)

    // Card total should be 3000 + 2000 = 5000
    expect(card.totalStr).toBe('$5,000.00')
    expect(card.accountCount).toBe(2)
  })

  it('closedPositionsCard: selected is true only when same accountId AND selectedCategoryKey === "closedPositions"', () => {
    const closedPositions: ClosedPosition[] = [
      {
        id: 'cp-1',
        accountId: 'acc-1',
        symbol: 'AAPL',
        name: 'Apple Inc.',
        assetClass: 'Equity',
        shares: 100,
        avgCost: 150,
        price: 200,
        closedDate: '2026-07-01',
        lastImportedAt: '2026-08-08',
        realizedGL: 5000,
        realizedGLBasis: 'transactions'
      }
    ]

    // Test case 1: same accountId but wrong categoryKey
    const state1 = createTestState({
      accounts: [testAccount1],
      closedPositions,
      selectedAccountId: 'acc-1',
      selectedCategoryKey: 'taxable'
    })

    const card1 = closedPositionsCard(state1)
    expect(card1.accounts[0].selected).toBe(false)

    // Test case 2: same accountId and correct categoryKey
    const state2 = createTestState({
      accounts: [testAccount1],
      closedPositions,
      selectedAccountId: 'acc-1',
      selectedCategoryKey: 'closedPositions'
    })

    const card2 = closedPositionsCard(state2)
    expect(card2.accounts[0].selected).toBe(true)
  })

  it('closedPositionsCard: empty closed positions shows noAccounts message', () => {
    const state = createTestState({
      accounts: [testAccount1, testAccount2],
      closedPositions: []
    })

    const card = closedPositionsCard(state)

    expect(card.hasAccounts).toBe(false)
    expect(card.noAccounts).toBe(true)
    expect(card.accounts).toEqual([])
    expect(card.accountCount).toBe(0)
    expect(card.totalStr).toBe('—')
  })

  it('closedPositionsCard: expanded reflects state.expandedCategories', () => {
    const closedPositions: ClosedPosition[] = [
      {
        id: 'cp-1',
        accountId: 'acc-1',
        symbol: 'AAPL',
        name: 'Apple Inc.',
        assetClass: 'Equity',
        shares: 100,
        avgCost: 150,
        price: 200,
        closedDate: '2026-07-01',
        lastImportedAt: '2026-08-08',
        realizedGL: 5000,
        realizedGLBasis: 'transactions'
      }
    ]

    const state = createTestState({
      accounts: [testAccount1],
      closedPositions,
      expandedCategories: { closedPositions: true }
    })

    const card = closedPositionsCard(state)
    expect(card.expanded).toBe(true)

    // Also test when not expanded
    const state2 = createTestState({
      accounts: [testAccount1],
      closedPositions
    })
    const card2 = closedPositionsCard(state2)
    expect(card2.expanded).toBe(false)
  })

  it('closedPositionsCard: updatedStr shows latest lastImportedAt across account\'s closed positions', () => {
    const closedPositions: ClosedPosition[] = [
      {
        id: 'cp-1',
        accountId: 'acc-1',
        symbol: 'AAPL',
        name: 'Apple Inc.',
        assetClass: 'Equity',
        shares: 100,
        avgCost: 150,
        price: 200,
        closedDate: '2026-07-01',
        lastImportedAt: '2026-08-05',
        realizedGL: 5000,
        realizedGLBasis: 'transactions'
      },
      {
        id: 'cp-2',
        accountId: 'acc-1',
        symbol: 'MSFT',
        name: 'Microsoft',
        assetClass: 'Equity',
        shares: 50,
        avgCost: 300,
        price: 400,
        closedDate: '2026-07-15',
        lastImportedAt: '2026-08-10',
        realizedGL: 5000,
        realizedGLBasis: 'transactions'
      }
    ]

    const state = createTestState({
      accounts: [testAccount1],
      closedPositions
    })

    const card = closedPositionsCard(state)

    // updatedStr should be the latest date: 2026-08-10 (may vary by timezone)
    expect(card.accounts[0].updatedStr).toMatch(/Aug (9|10), 2026/)
  })

  it('closedPositionsCard: only includes accounts with closed positions, excludes those without', () => {
    const closedPositions: ClosedPosition[] = [
      {
        id: 'cp-1',
        accountId: 'acc-1',
        symbol: 'AAPL',
        name: 'Apple Inc.',
        assetClass: 'Equity',
        shares: 100,
        avgCost: 150,
        price: 200,
        closedDate: '2026-07-01',
        lastImportedAt: '2026-08-08',
        realizedGL: 5000,
        realizedGLBasis: 'transactions'
      }
    ]

    const state = createTestState({
      accounts: [testAccount1, testAccount2], // acc-2 has no closed positions
      closedPositions
    })

    const card = closedPositionsCard(state)

    // Only acc-1 should be included
    expect(card.accountCount).toBe(1)
    expect(card.accounts[0].id).toBe('acc-1')
  })
})
