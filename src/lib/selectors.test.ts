import { describe, it, expect } from 'vitest'
import {
  visibleTransactions,
  allocationBars,
  filteredPortfolioTotal,
  assetClassOptions,
  categoryCards,
  registerCategoryCards,
  registerAllAccountsTotal,
  acctAllAccountsTotal,
  closedPositionsCard,
  acctScopedPositions,
  acctAssetClassOptions,
  acctFilteredPositions,
  acctScopedClosedPositions,
  acctFilteredClosedPositions,
  acctAllocationTitle,
  heldEquityEtfSymbols,
  ALPHAVANTAGE_DAILY_CALL_CAP,
  shouldRetryPolygonSync,
  shouldRetryMutualFundSync,
  visibleExpenses,
  categoryBreakdown,
  budgetTransactionsForPeriod,
  actualByCategory,
  availableBudgetMonths,
  availableBudgetYears,
  referencedCategories,
  mappingsForCategory
} from './selectors'
import { AppState, initialState, clearAccountSelection } from './state'
import {
  Account,
  Position,
  Transaction,
  ClosedPosition,
  BalanceEntry,
  Expense,
  BudgetTransaction,
  Category,
  CategoryMapping
} from './types'
import { GAIN_COLOR, LOSS_COLOR } from './computations'

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

  // === registerCategoryCards() / registerAllAccountsTotal() tests ===

  it('registerCategoryCards: zero accounts in a category - noAccounts true, totalStr matches fmtUSD(0)', () => {
    const state = createTestState({
      accounts: [testAccount1], // taxable only
      balanceEntries: []
    })

    const cards = registerCategoryCards(state)
    const nonTaxable = cards.find((c) => c.key === 'nonTaxable')!

    expect(nonTaxable.hasAccounts).toBe(false)
    expect(nonTaxable.noAccounts).toBe(true)
    expect(nonTaxable.accounts).toEqual([])
    expect(nonTaxable.totalStr).toBe('$0.00')
  })

  it('registerCategoryCards: account with no balance entries shows "—"/"never"/0', () => {
    const state = createTestState({
      accounts: [testAccount1],
      balanceEntries: []
    })

    const cards = registerCategoryCards(state)
    const acct = cards.find((c) => c.key === 'taxable')!.accounts[0]

    expect(acct.totalStr).toBe('—')
    expect(acct.asOfStr).toBe('never')
    expect(acct.entryCount).toBe(0)
  })

  it('registerCategoryCards: account with entries reflects latest balance/date/count', () => {
    const balanceEntries: BalanceEntry[] = [
      {
        id: 'bal-1',
        accountId: 'acc-1',
        date: '2026-08-01',
        balance: 1000,
        activityType: 'None',
        activityAmount: 0,
        note: ''
      },
      {
        id: 'bal-2',
        accountId: 'acc-1',
        date: '2026-08-15',
        balance: 1500,
        activityType: 'None',
        activityAmount: 0,
        note: ''
      }
    ]

    const state = createTestState({
      accounts: [testAccount1],
      balanceEntries
    })

    const cards = registerCategoryCards(state)
    const acct = cards.find((c) => c.key === 'taxable')!.accounts[0]

    expect(acct.totalStr).toBe('$1,500.00')
    expect(acct.asOfStr).toBe('Aug 15, 2026')
    expect(acct.entryCount).toBe(2)

    const taxable = cards.find((c) => c.key === 'taxable')!
    expect(taxable.totalStr).toBe('$1,500.00')
  })

  it('registerCategoryCards: expanded/selected follow reg* state, not expandedCategories/selectedAccountId', () => {
    const state = createTestState({
      accounts: [testAccount1],
      // Positions page state deliberately set differently
      expandedCategories: { taxable: false },
      selectedAccountId: null,
      selectedCategoryKey: null,
      // Register page state
      regExpanded: { taxable: true },
      regAccountId: 'acc-1'
    })

    const cards = registerCategoryCards(state)
    const taxable = cards.find((c) => c.key === 'taxable')!

    expect(taxable.expanded).toBe(true)
    expect(taxable.accounts[0].selected).toBe(true)
  })

  it('registerAllAccountsTotal: sums latest balances across all accounts', () => {
    const balanceEntries: BalanceEntry[] = [
      {
        id: 'bal-1',
        accountId: 'acc-1',
        date: '2026-08-01',
        balance: 1000,
        activityType: 'None',
        activityAmount: 0,
        note: ''
      },
      {
        id: 'bal-2',
        accountId: 'acc-2',
        date: '2026-08-10',
        balance: 2500,
        activityType: 'None',
        activityAmount: 0,
        note: ''
      }
    ]

    const state = createTestState({
      accounts: [testAccount1, testAccount2],
      balanceEntries
    })

    expect(registerAllAccountsTotal(state)).toBe('$3,500.00')
  })

  it('registerAllAccountsTotal: account with no entries contributes 0', () => {
    const state = createTestState({
      accounts: [testAccount1, testAccount2],
      balanceEntries: []
    })

    expect(registerAllAccountsTotal(state)).toBe('$0.00')
  })

  // === acctAllAccountsTotal() tests ===

  it('acctAllAccountsTotal: sums shares*price across all positions, unscoped by account/category filters', () => {
    const positions: Position[] = [
      { id: 'pos-1', accountId: 'acc-1', symbol: 'AAPL', name: 'Apple', assetClass: 'Equity', shares: 10, avgCost: 100, price: 150, lastImportedAt: '2026-08-08' },
      { id: 'pos-2', accountId: 'acc-2', symbol: 'BND', name: 'Bond', assetClass: 'Fixed Income', shares: 20, avgCost: 50, price: 55, lastImportedAt: '2026-08-08' }
    ]

    const state = createTestState({
      accounts: [testAccount1, testAccount2],
      positions,
      selectedAccountId: 'acc-1',
      selectedCategoryKey: 'taxable'
    })

    // 10*150 + 20*55 = 1500 + 1100 = 2600
    expect(acctAllAccountsTotal(state)).toBe('$2,600.00')

    // Not scoped: changing selectedAccountId/selectedCategoryKey doesn't change the result
    const stateOtherFilters = createTestState({
      accounts: [testAccount1, testAccount2],
      positions,
      selectedAccountId: 'acc-2',
      selectedCategoryKey: 'taxDeferred'
    })
    expect(acctAllAccountsTotal(stateOtherFilters)).toBe('$2,600.00')

    const stateNoFilters = createTestState({
      accounts: [testAccount1, testAccount2],
      positions,
      selectedAccountId: null,
      selectedCategoryKey: null
    })
    expect(acctAllAccountsTotal(stateNoFilters)).toBe('$2,600.00')
  })

  it('acctAllAccountsTotal: empty positions returns $0.00', () => {
    const state = createTestState({ accounts: [testAccount1], positions: [] })
    expect(acctAllAccountsTotal(state)).toBe('$0.00')
  })

  it('acctAllAccountsTotal: closedPositions never contribute, even when positions is empty', () => {
    const closedPositions: ClosedPosition[] = [
      { id: 'cp-1', accountId: 'acc-1', symbol: 'TSLA', name: 'Tesla', closedDate: '2026-07-01', assetClass: 'Equity', shares: 5, avgCost: 200, price: 250, lastImportedAt: '2026-07-01' }
    ]
    const state = createTestState({ accounts: [testAccount1], positions: [], closedPositions })
    expect(acctAllAccountsTotal(state)).toBe('$0.00')
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

  it('acctFilteredPositions: search matches trackingSymbol substring', () => {
    const positions: Position[] = [
      { id: 'pos-1', accountId: 'acc-1', symbol: 'AAPL', name: 'Apple Inc.', assetClass: 'Tech', shares: 1, avgCost: 100, price: 100, lastImportedAt: '2026-08-08', trackingSymbol: 'GRP-1' },
      { id: 'pos-2', accountId: 'acc-1', symbol: 'MSFT', name: 'Microsoft', assetClass: 'Tech', shares: 1, avgCost: 100, price: 100, lastImportedAt: '2026-08-08' }
    ]
    const state = createTestState({ accounts: [testAccount1], positions, acctPosSearch: 'GRP-1' })
    expect(acctFilteredPositions(state)).toEqual([positions[0]])
  })

  it('acctFilteredPositions: search matches trackingSymbol case-insensitively', () => {
    const positions: Position[] = [
      { id: 'pos-1', accountId: 'acc-1', symbol: 'AAPL', name: 'Apple Inc.', assetClass: 'Tech', shares: 1, avgCost: 100, price: 100, lastImportedAt: '2026-08-08', trackingSymbol: 'GRP-1' },
      { id: 'pos-2', accountId: 'acc-1', symbol: 'MSFT', name: 'Microsoft', assetClass: 'Tech', shares: 1, avgCost: 100, price: 100, lastImportedAt: '2026-08-08' }
    ]
    const state = createTestState({ accounts: [testAccount1], positions, acctPosSearch: 'grp' })
    expect(acctFilteredPositions(state)).toEqual([positions[0]])
  })

  it('acctFilteredPositions: undefined trackingSymbol excluded when search matches nothing', () => {
    const positions: Position[] = [
      { id: 'pos-1', accountId: 'acc-1', symbol: 'AAPL', name: 'Apple Inc.', assetClass: 'Tech', shares: 1, avgCost: 100, price: 100, lastImportedAt: '2026-08-08' }
    ]
    const state = createTestState({ accounts: [testAccount1], positions, acctPosSearch: 'zzz-no-match' })
    expect(acctFilteredPositions(state)).toEqual([])
  })

  it('acctAllocationTitle: selected account uses account name', () => {
    const state = createTestState({ accounts: [testAccount1], selectedAccountId: 'acc-1' })
    expect(acctAllocationTitle(state)).toBe('Allocation — Brokerage')
  })

  it('acctAllocationTitle: no selection returns "Allocation — All Accounts"', () => {
    const state = createTestState({ accounts: [testAccount1], selectedAccountId: null })
    expect(acctAllocationTitle(state)).toBe('Allocation — All Accounts')
  })

  it('acctAllocationTitle: after clearAccountSelection returns "Allocation — All Accounts"', () => {
    const state = createTestState({ accounts: [testAccount1], selectedAccountId: 'acc-1' })
    const cleared = clearAccountSelection(state)
    expect(acctAllocationTitle(cleared)).toBe('Allocation — All Accounts')
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

  // === heldEquityEtfSymbols() tests ===

  it('heldEquityEtfSymbols: dedupes the same symbol held across multiple accounts', () => {
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
        symbol: 'AAPL',
        name: 'Apple Inc.',
        assetClass: 'Equity',
        shares: 50,
        avgCost: 140,
        price: 200,
        lastImportedAt: '2026-08-08'
      }
    ]

    const state = createTestState({
      accounts: [testAccount1, testAccount2],
      positions
    })

    expect(heldEquityEtfSymbols(state)).toEqual(['AAPL'])
  })

  it('heldEquityEtfSymbols: excludes non-Equity/ETF asset classes', () => {
    const positions: Position[] = [
      {
        id: 'pos-1',
        accountId: 'acc-1',
        symbol: 'BND',
        name: 'Bond Fund',
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

    expect(heldEquityEtfSymbols(state)).toEqual([])
  })

  it('heldEquityEtfSymbols: includes a position when manual override is ETF, even if base assetClass is not', () => {
    const positions: Position[] = [
      {
        id: 'pos-1',
        accountId: 'acc-1',
        symbol: 'VBTLX',
        name: 'Vanguard Total Bond',
        assetClass: 'Mutual Fund',
        assetClassManualOverride: 'ETF',
        shares: 10,
        avgCost: 10,
        price: 10,
        lastImportedAt: '2026-08-08'
      }
    ]

    const state = createTestState({
      accounts: [testAccount1],
      positions
    })

    expect(heldEquityEtfSymbols(state)).toEqual(['VBTLX'])
  })

  it('heldEquityEtfSymbols: includes a position with base assetClass ETF and no override', () => {
    const positions: Position[] = [
      {
        id: 'pos-1',
        accountId: 'acc-1',
        symbol: 'VTI',
        name: 'Total Market ETF',
        assetClass: 'ETF',
        shares: 20,
        avgCost: 200,
        price: 250,
        lastImportedAt: '2026-08-08'
      }
    ]

    const state = createTestState({
      accounts: [testAccount1],
      positions
    })

    expect(heldEquityEtfSymbols(state)).toEqual(['VTI'])
  })

  it('heldEquityEtfSymbols: returns empty array when there are no positions', () => {
    const state = createTestState({
      accounts: [testAccount1],
      positions: []
    })

    expect(heldEquityEtfSymbols(state)).toEqual([])
  })

  // === shouldRetryPolygonSync() tests ===

  it('shouldRetryPolygonSync: returns true when the last run left symbols unresolved', () => {
    const state = createTestState({
      priceSync: {
        apiKey: '',
        lastFetchedDate: '2026-08-22',
        heldPrices: {},
        lastRun: {
          at: '2026-08-22T10:00:00.000Z',
          updatedCount: 3,
          notFound: ['X'],
          marketTickerCount: 100
        }
      }
    })

    expect(shouldRetryPolygonSync(state, {})).toBe(true)
  })

  it('shouldRetryPolygonSync: returns false when nothing is unresolved and no ticker-overview errors', () => {
    const state = createTestState({
      priceSync: {
        apiKey: '',
        lastFetchedDate: '2026-08-22',
        heldPrices: {},
        lastRun: {
          at: '2026-08-22T10:00:00.000Z',
          updatedCount: 3,
          notFound: [],
          marketTickerCount: 100
        }
      }
    })

    expect(shouldRetryPolygonSync(state, {})).toBe(false)
  })

  it('shouldRetryPolygonSync: returns true when there is no last run but ticker-overview fetches are failing', () => {
    const state = createTestState({
      priceSync: {
        apiKey: '',
        lastFetchedDate: null,
        heldPrices: {},
        lastRun: null
      }
    })

    expect(shouldRetryPolygonSync(state, { X: 'err' })).toBe(true)
  })

  // === shouldRetryMutualFundSync() tests ===

  const mutualFundPosition: Position = {
    id: 'pos-mf-1',
    accountId: 'acc-1',
    symbol: 'VFIAX',
    name: 'Vanguard 500 Index Fund',
    assetClass: 'Mutual Fund',
    shares: 5,
    avgCost: 400,
    price: 420,
    lastImportedAt: '2026-08-08'
  }

  it('shouldRetryMutualFundSync: returns true for a held mutual fund symbol with no cached price and budget under cap', () => {
    const state = createTestState({
      accounts: [testAccount1],
      positions: [mutualFundPosition],
      mutualFundSync: {
        apiKey: '',
        heldPrices: {},
        lastRun: null,
        callBudget: { date: '2026-08-23', callsUsed: 0 }
      }
    })

    expect(shouldRetryMutualFundSync(state, '2026-08-23')).toBe(true)
  })

  it('shouldRetryMutualFundSync: returns false when the held symbol was already fetched today', () => {
    const state = createTestState({
      accounts: [testAccount1],
      positions: [mutualFundPosition],
      mutualFundSync: {
        apiKey: '',
        heldPrices: {
          VFIAX: { price: 420, date: '2026-08-23', fetchedAt: '2026-08-23T09:00:00.000Z' }
        },
        lastRun: null,
        callBudget: { date: '2026-08-23', callsUsed: 1 }
      }
    })

    expect(shouldRetryMutualFundSync(state, '2026-08-23')).toBe(false)
  })

  it('shouldRetryMutualFundSync: returns true when the cached price for the held symbol is from yesterday', () => {
    const state = createTestState({
      accounts: [testAccount1],
      positions: [mutualFundPosition],
      mutualFundSync: {
        apiKey: '',
        heldPrices: {
          VFIAX: { price: 415, date: '2026-08-22', fetchedAt: '2026-08-22T09:00:00.000Z' }
        },
        lastRun: null,
        callBudget: { date: '2026-08-23', callsUsed: 0 }
      }
    })

    expect(shouldRetryMutualFundSync(state, '2026-08-23')).toBe(true)
  })

  it('shouldRetryMutualFundSync: returns false when there are no held mutual fund symbols', () => {
    const state = createTestState({
      accounts: [testAccount1],
      positions: [],
      mutualFundSync: {
        apiKey: '',
        heldPrices: {},
        lastRun: null,
        callBudget: { date: '2026-08-23', callsUsed: 0 }
      }
    })

    expect(shouldRetryMutualFundSync(state, '2026-08-23')).toBe(false)
  })

  it('shouldRetryMutualFundSync: returns false when today\'s call budget is already exhausted', () => {
    const state = createTestState({
      accounts: [testAccount1],
      positions: [mutualFundPosition],
      mutualFundSync: {
        apiKey: '',
        heldPrices: {},
        lastRun: null,
        callBudget: { date: '2026-08-23', callsUsed: ALPHAVANTAGE_DAILY_CALL_CAP }
      }
    })

    expect(shouldRetryMutualFundSync(state, '2026-08-23')).toBe(false)
  })

  it('shouldRetryMutualFundSync: treats a stale budget date as 0 calls used today', () => {
    const state = createTestState({
      accounts: [testAccount1],
      positions: [mutualFundPosition],
      mutualFundSync: {
        apiKey: '',
        heldPrices: {},
        lastRun: null,
        callBudget: { date: '2026-08-22', callsUsed: ALPHAVANTAGE_DAILY_CALL_CAP }
      }
    })

    expect(shouldRetryMutualFundSync(state, '2026-08-23')).toBe(true)
  })
})

describe('visibleExpenses', () => {
  // ids deliberately reversed relative to their names: id order (cat-1, cat-2) is the
  // OPPOSITE of name order (Housing, Entertainment) is not what we want either — we want
  // id-alpha-order and name-alpha-order to disagree. cat-1 -> 'Zebra Category' (would sort
  // LAST by name but FIRST by id), cat-2 -> 'Apple Category' (would sort FIRST by name but
  // LAST by id). If the sort used raw ids, Zebra's expenses would come first; since it uses
  // resolved names, Apple's expenses must come first instead.
  const catZebra: Category = { id: 'cat-1', name: 'Zebra Category' }
  const catApple: Category = { id: 'cat-2', name: 'Apple Category' }
  const categoriesById = new Map<string, string>([
    [catZebra.id, catZebra.name],
    [catApple.id, catApple.name]
  ])

  const rent: Expense = { id: 'e1', name: 'Rent', categoryId: catZebra.id, amount: 2000, frequency: 'monthly' }
  const netflix: Expense = {
    id: 'e2',
    name: 'Netflix',
    categoryId: catApple.id,
    amount: 180,
    frequency: 'yearly'
  }
  const gym: Expense = { id: 'e3', name: 'Gym', categoryId: catZebra.id, amount: 600, frequency: 'yearly' }
  const groceries: Expense = {
    id: 'e4',
    name: 'Groceries',
    categoryId: catApple.id,
    amount: 400,
    frequency: 'monthly'
  }
  const expenses = [rent, netflix, gym, groceries]

  it('__all returns everything', () => {
    const result = visibleExpenses(expenses, '__all', 'name', 'monthly', categoriesById)
    expect(result).toHaveLength(4)
  })

  it('filters by specific categoryId', () => {
    const result = visibleExpenses(expenses, catZebra.id, 'name', 'monthly', categoriesById)
    expect(result.map((e) => e.id)).toEqual(['e3', 'e1'])
  })

  it('sortBy name gives alpha order', () => {
    const result = visibleExpenses(expenses, '__all', 'name', 'monthly', categoriesById)
    expect(result.map((e) => e.name)).toEqual(['Groceries', 'Gym', 'Netflix', 'Rent'])
  })

  it('sortBy amount sorts descending by toPeriod value (monthly period)', () => {
    // monthly equivalents: rent=2000, netflix=15, gym=50, groceries=400
    const result = visibleExpenses(expenses, '__all', 'amount', 'monthly', categoriesById)
    expect(result.map((e) => e.id)).toEqual(['e1', 'e4', 'e3', 'e2'])
  })

  it('sortBy amount sorts descending by toPeriod value (yearly period)', () => {
    // yearly equivalents: rent=24000, netflix=180, gym=600, groceries=4800
    const result = visibleExpenses(expenses, '__all', 'amount', 'yearly', categoriesById)
    expect(result.map((e) => e.id)).toEqual(['e1', 'e4', 'e3', 'e2'])
  })

  it('sortBy category groups by resolved category NAME (not raw categoryId) then name', () => {
    // categoryId alpha order would put catZebra (cat-1) first, catApple (cat-2) second —
    // i.e. Rent/Gym before Netflix/Groceries. But name-alpha order puts 'Apple Category'
    // before 'Zebra Category', so Netflix/Groceries (Apple) must come first.
    const result = visibleExpenses(expenses, '__all', 'category', 'monthly', categoriesById)
    expect(result.map((e) => e.name)).toEqual(['Groceries', 'Netflix', 'Gym', 'Rent'])
  })

  it('empty input returns empty array', () => {
    expect(visibleExpenses([], '__all', 'name', 'monthly', categoriesById)).toEqual([])
  })

  it('does not mutate the original array', () => {
    const original = [rent, netflix, gym, groceries]
    const originalOrder = original.map((e) => e.id)
    visibleExpenses(original, '__all', 'name', 'monthly', categoriesById)
    expect(original.map((e) => e.id)).toEqual(originalOrder)
  })
})

describe('categoryBreakdown', () => {
  const catHousing: Category = { id: 'cat-housing', name: 'Housing' }
  const catEntertainment: Category = { id: 'cat-entertainment', name: 'Entertainment' }
  const catHealth: Category = { id: 'cat-health', name: 'Health' }
  const catFood: Category = { id: 'cat-food', name: 'Food' }
  const catA: Category = { id: 'cat-a', name: 'A' }
  const catB: Category = { id: 'cat-b', name: 'B' }
  const catC: Category = { id: 'cat-c', name: 'C' }
  const allCats = [catHousing, catEntertainment, catHealth, catFood, catA, catB, catC]

  it('returns empty array for no expenses', () => {
    expect(categoryBreakdown([], [], 'monthly', allCats)).toEqual([])
  })

  it('returns one entry with budgetPct 100 for a single category with no actuals, name resolved from categories', () => {
    const expenses: Expense[] = [
      { id: 'e1', name: 'Rent', categoryId: catHousing.id, amount: 2000, frequency: 'monthly' }
    ]
    const result = categoryBreakdown(expenses, [], 'monthly', allCats)
    expect(result).toEqual([
      {
        name: 'Housing',
        amount: 2000,
        actual: 0,
        variance: 2000,
        budgetPct: 100,
        actualPct: 0,
        actualColor: '#3b6ef6',
        varianceColor: GAIN_COLOR
      }
    ])
  })

  it('falls back to categoryId as name when category is unknown', () => {
    const expenses: Expense[] = [
      { id: 'e1', name: 'Mystery', categoryId: 'cat-unknown', amount: 500, frequency: 'monthly' }
    ]
    const result = categoryBreakdown(expenses, [], 'monthly', allCats)
    expect(result[0].name).toBe('cat-unknown')
  })

  it('sorts multiple categories descending by amount', () => {
    const expenses: Expense[] = [
      { id: 'e1', name: 'Rent', categoryId: catHousing.id, amount: 2000, frequency: 'monthly' },
      { id: 'e2', name: 'Netflix', categoryId: catEntertainment.id, amount: 15, frequency: 'monthly' },
      { id: 'e3', name: 'Gym', categoryId: catHealth.id, amount: 50, frequency: 'monthly' }
    ]
    const result = categoryBreakdown(expenses, [], 'monthly', allCats)
    expect(result.map((r) => r.name)).toEqual(['Housing', 'Health', 'Entertainment'])
  })

  it('budgetPct is relative to the max category, not the sum', () => {
    // Categories: A=100, B=100, C=200. Sum=400.
    // Sum-based pct for C would be 50%; max-based pct for C is 100%.
    const expenses: Expense[] = [
      { id: 'e1', name: 'A1', categoryId: catA.id, amount: 100, frequency: 'monthly' },
      { id: 'e2', name: 'B1', categoryId: catB.id, amount: 100, frequency: 'monthly' },
      { id: 'e3', name: 'C1', categoryId: catC.id, amount: 200, frequency: 'monthly' }
    ]
    const result = categoryBreakdown(expenses, [], 'monthly', allCats)
    const cEntry = result.find((r) => r.name === 'C')
    const aEntry = result.find((r) => r.name === 'A')
    expect(cEntry?.budgetPct).toBe(100)
    expect(aEntry?.budgetPct).toBe(50)
  })

  it('converts mixed monthly/yearly expenses via toPeriod before summing', () => {
    const expenses: Expense[] = [
      { id: 'e1', name: 'Rent', categoryId: catHousing.id, amount: 2000, frequency: 'monthly' },
      { id: 'e2', name: 'Property Tax', categoryId: catHousing.id, amount: 12000, frequency: 'yearly' }
    ]
    // monthly period: rent=2000, property tax=1000 -> total 3000
    const monthlyResult = categoryBreakdown(expenses, [], 'monthly', allCats)
    expect(monthlyResult[0]).toMatchObject({ name: 'Housing', amount: 3000, budgetPct: 100 })

    // yearly period: rent=24000, property tax=12000 -> total 36000
    const yearlyResult = categoryBreakdown(expenses, [], 'yearly', allCats)
    expect(yearlyResult[0]).toMatchObject({ name: 'Housing', amount: 36000, budgetPct: 100 })
  })

  it('computes actual/variance/colors for a fixture with one over-budget and one under-budget category', () => {
    // Housing: budget 2000, actual 2500 -> over budget (variance -500)
    // Food: budget 500, actual 300 -> under budget (variance 200)
    // maxCat = max(2000, 500, 2500, 300) = 2500
    const expenses: Expense[] = [
      { id: 'e1', name: 'Rent', categoryId: catHousing.id, amount: 2000, frequency: 'monthly' },
      { id: 'e2', name: 'Groceries', categoryId: catFood.id, amount: 500, frequency: 'monthly' }
    ]
    const transactions: BudgetTransaction[] = [
      { id: 't1', date: '2026-09-05', description: 'Rent', categoryId: catHousing.id, amount: 2500 },
      { id: 't2', date: '2026-09-10', description: 'Groceries', categoryId: catFood.id, amount: 300 }
    ]
    const result = categoryBreakdown(expenses, transactions, 'monthly', allCats)
    const housing = result.find((r) => r.name === 'Housing')
    const food = result.find((r) => r.name === 'Food')

    expect(housing).toEqual({
      name: 'Housing',
      amount: 2000,
      actual: 2500,
      variance: -500,
      budgetPct: (2000 / 2500) * 100,
      actualPct: 100,
      actualColor: LOSS_COLOR,
      varianceColor: LOSS_COLOR
    })
    expect(food).toEqual({
      name: 'Food',
      amount: 500,
      actual: 300,
      variance: 200,
      budgetPct: (500 / 2500) * 100,
      actualPct: (300 / 2500) * 100,
      actualColor: '#3b6ef6',
      varianceColor: GAIN_COLOR
    })
  })
})

describe('budget selectors', () => {
  describe('budgetTransactionsForPeriod', () => {
    const transactions: BudgetTransaction[] = [
      { id: 't1', date: '2026-08-31', description: 'a', categoryId: 'cat-food', amount: 10 },
      { id: 't2', date: '2026-09-01', description: 'b', categoryId: 'cat-food', amount: 20 },
      { id: 't3', date: '2026-09-30', description: 'c', categoryId: 'cat-food', amount: 30 },
      { id: 't4', date: '2025-09-15', description: 'd', categoryId: 'cat-food', amount: 40 }
    ]

    it('filters by YYYY-MM prefix for monthly period, boundary dates included', () => {
      const result = budgetTransactionsForPeriod(transactions, 'monthly', '2026-09', '2026')
      expect(result.map((t) => t.id)).toEqual(['t2', 't3'])
    })

    it('excludes dates outside the selected month', () => {
      const result = budgetTransactionsForPeriod(transactions, 'monthly', '2026-08', '2026')
      expect(result.map((t) => t.id)).toEqual(['t1'])
    })

    it('filters by YYYY prefix for yearly period, boundary dates included', () => {
      const result = budgetTransactionsForPeriod(transactions, 'yearly', '2026-09', '2026')
      expect(result.map((t) => t.id)).toEqual(['t1', 't2', 't3'])
    })

    it('excludes dates outside the selected year', () => {
      const result = budgetTransactionsForPeriod(transactions, 'yearly', '2026-09', '2025')
      expect(result.map((t) => t.id)).toEqual(['t4'])
    })
  })

  describe('actualByCategory', () => {
    it('sums amounts per categoryId', () => {
      const transactions: BudgetTransaction[] = [
        { id: 't1', date: '2026-09-01', description: 'a', categoryId: 'cat-food', amount: 10 },
        { id: 't2', date: '2026-09-02', description: 'b', categoryId: 'cat-food', amount: 20 },
        { id: 't3', date: '2026-09-03', description: 'c', categoryId: 'cat-housing', amount: 100 }
      ]
      expect(actualByCategory(transactions)).toEqual({ 'cat-food': 30, 'cat-housing': 100 })
    })

    it('returns empty object for empty input', () => {
      expect(actualByCategory([])).toEqual({})
    })
  })

  describe('referencedCategories', () => {
    const catHousing: Category = { id: 'cat-housing', name: 'Housing' }
    const catFood: Category = { id: 'cat-food', name: 'Food' }
    const catUnused: Category = { id: 'cat-unused', name: 'Unused' }
    const catMappingOnly: Category = { id: 'cat-mapping-only', name: 'Mapping Only' }

    it('includes a category referenced only via a CategoryMapping (zero expense/transaction refs)', () => {
      const categories = [catHousing, catMappingOnly]
      const budgetExpenses: Expense[] = [{ id: 'e1', name: 'Rent', categoryId: catHousing.id, amount: 2000, frequency: 'monthly' }]
      const budgetTransactions: BudgetTransaction[] = []
      const categoryMappings: CategoryMapping[] = [
        { id: 'm1', substring: 'STARBUCKS', categoryId: catMappingOnly.id, updatedAt: '2026-01-01T00:00:00Z' }
      ]
      const result = referencedCategories(categories, categoryMappings, budgetExpenses, budgetTransactions)
      expect(result.map((c) => c.id)).toEqual(expect.arrayContaining([catHousing.id, catMappingOnly.id]))
    })

    it('excludes a category with zero references anywhere (expenses, transactions, or mappings)', () => {
      const categories = [catHousing, catFood, catUnused]
      const budgetExpenses: Expense[] = [{ id: 'e1', name: 'Rent', categoryId: catHousing.id, amount: 2000, frequency: 'monthly' }]
      const budgetTransactions: BudgetTransaction[] = [{ id: 't1', date: '2026-09-01', description: 'a', categoryId: catFood.id, amount: 10 }]
      const categoryMappings: CategoryMapping[] = []
      const result = referencedCategories(categories, categoryMappings, budgetExpenses, budgetTransactions)
      expect(result.map((c) => c.id)).toEqual(expect.arrayContaining([catHousing.id, catFood.id]))
      expect(result.find((c) => c.id === catUnused.id)).toBeUndefined()
    })
  })

  describe('mappingsForCategory', () => {
    it('filters by categoryId and sorts by substring', () => {
      const mappings: CategoryMapping[] = [
        { id: 'm1', substring: 'Whole Foods', categoryId: 'cat-food', updatedAt: '2026-01-01T00:00:00Z' },
        { id: 'm2', substring: 'Amazon', categoryId: 'cat-food', updatedAt: '2026-01-02T00:00:00Z' },
        { id: 'm3', substring: 'Netflix', categoryId: 'cat-entertainment', updatedAt: '2026-01-03T00:00:00Z' },
        { id: 'm4', substring: 'Costco', categoryId: 'cat-food', updatedAt: '2026-01-04T00:00:00Z' }
      ]
      const result = mappingsForCategory(mappings, 'cat-food')
      expect(result.map((m) => m.id)).toEqual(['m2', 'm4', 'm1'])
    })

    it('returns empty array when no mappings match', () => {
      const mappings: CategoryMapping[] = [
        { id: 'm1', substring: 'Whole Foods', categoryId: 'cat-food', updatedAt: '2026-01-01T00:00:00Z' }
      ]
      expect(mappingsForCategory(mappings, 'cat-other')).toEqual([])
    })
  })

  describe('availableBudgetMonths', () => {
    it('includes the current month even with zero transactions, with correct label', () => {
      const now = new Date('2026-09-13T12:00:00Z')
      const result = availableBudgetMonths([], now)
      expect(result).toEqual([{ value: '2026-09', label: 'September 2026' }])
    })

    it('unions transaction months with current month, sorted descending', () => {
      const now = new Date('2026-09-13T12:00:00Z')
      const transactions: BudgetTransaction[] = [
        { id: 't1', date: '2026-06-01', description: 'a', categoryId: 'cat-food', amount: 10 },
        { id: 't2', date: '2026-12-01', description: 'b', categoryId: 'cat-food', amount: 10 }
      ]
      const result = availableBudgetMonths(transactions, now)
      expect(result.map((m) => m.value)).toEqual(['2026-12', '2026-09', '2026-06'])
    })
  })

  describe('availableBudgetYears', () => {
    it('includes the current year even with zero transactions', () => {
      const now = new Date('2026-09-13T12:00:00Z')
      expect(availableBudgetYears([], now)).toEqual(['2026'])
    })

    it('unions transaction years with current year, sorted descending', () => {
      const now = new Date('2026-09-13T12:00:00Z')
      const transactions: BudgetTransaction[] = [
        { id: 't1', date: '2024-06-01', description: 'a', categoryId: 'cat-food', amount: 10 },
        { id: 't2', date: '2025-12-01', description: 'b', categoryId: 'cat-food', amount: 10 }
      ]
      expect(availableBudgetYears(transactions, now)).toEqual(['2026', '2025', '2024'])
    })
  })
})
