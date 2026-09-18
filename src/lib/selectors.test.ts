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
  mappingsForCategory,
  monthsPresentInYear,
  yearTotalSpend,
  yearCategoryTotalSpend,
  monthTotalSpend,
  overBudgetConcern,
  spendTrendConcern,
  spikeMonthConcern,
  savingsRateShrinkingConcern,
  concentrationRiskConcern,
  savingsRateByYear,
  categoryShareOverTime,
  monthlySeasonality,
  budgetAccuracyByYear,
  categoryTrendsYoY,
  topMovers,
  effectiveCategoryId,
  formatSpendCategoryLabel
} from './selectors'
import { AppState, initialState, clearAccountSelection, updateExpenseDefinition } from './state'
import {
  Account,
  Position,
  Transaction,
  ClosedPosition,
  BalanceEntry,
  ExpenseDefinition,
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

  const rent: ExpenseDefinition = { id: 'e1', name: 'Rent', categoryId: catZebra.id, frequency: 'monthly' }
  const netflix: ExpenseDefinition = { id: 'e2', name: 'Netflix', categoryId: catApple.id, frequency: 'yearly' }
  const gym: ExpenseDefinition = { id: 'e3', name: 'Gym', categoryId: catZebra.id, frequency: 'yearly' }
  const groceries: ExpenseDefinition = { id: 'e4', name: 'Groceries', categoryId: catApple.id, frequency: 'monthly' }
  const definitions = [rent, netflix, gym, groceries]
  // amountsForYear compared as raw values (no period/toPeriod conversion since the
  // Monthly/Yearly period toggle no longer exists): rent=2000, gym=600, groceries=400, netflix=180
  const amounts: Record<string, number> = { e1: 2000, e2: 180, e3: 600, e4: 400 }

  it('__all returns everything', () => {
    const result = visibleExpenses(definitions, amounts, '__all', 'name', categoriesById)
    expect(result).toHaveLength(4)
  })

  it('filters by specific categoryId', () => {
    const result = visibleExpenses(definitions, amounts, catZebra.id, 'name', categoriesById)
    expect(result.map((e) => e.id)).toEqual(['e3', 'e1'])
  })

  it('sortBy name gives alpha order', () => {
    const result = visibleExpenses(definitions, amounts, '__all', 'name', categoriesById)
    expect(result.map((e) => e.name)).toEqual(['Groceries', 'Gym', 'Netflix', 'Rent'])
  })

  it('sortBy amount sorts descending by the raw amountsForYear value (no period conversion)', () => {
    // raw amounts: rent=2000, gym=600, groceries=400, netflix=180
    const result = visibleExpenses(definitions, amounts, '__all', 'amount', categoriesById)
    expect(result.map((e) => e.id)).toEqual(['e1', 'e3', 'e4', 'e2'])
  })

  it('sortBy category groups by resolved category NAME (not raw categoryId) then name', () => {
    // categoryId alpha order would put catZebra (cat-1) first, catApple (cat-2) second —
    // i.e. Rent/Gym before Netflix/Groceries. But name-alpha order puts 'Apple Category'
    // before 'Zebra Category', so Netflix/Groceries (Apple) must come first.
    const result = visibleExpenses(definitions, amounts, '__all', 'category', categoriesById)
    expect(result.map((e) => e.name)).toEqual(['Groceries', 'Netflix', 'Gym', 'Rent'])
  })

  it('empty input returns empty array', () => {
    expect(visibleExpenses([], {}, '__all', 'name', categoriesById)).toEqual([])
  })

  it('does not mutate the original array', () => {
    const original = [rent, netflix, gym, groceries]
    const originalOrder = original.map((e) => e.id)
    visibleExpenses(original, amounts, '__all', 'name', categoriesById)
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
    expect(categoryBreakdown([], {}, [], allCats)).toEqual([])
  })

  it('returns one entry with budgetPct 100 for a single category with no actuals, name resolved from categories', () => {
    const definitions: ExpenseDefinition[] = [{ id: 'e1', name: 'Rent', categoryId: catHousing.id, frequency: 'monthly' }]
    const amounts = { e1: 2000 }
    const result = categoryBreakdown(definitions, amounts, [], allCats)
    expect(result).toEqual([
      {
        name: 'Housing',
        amount: 24000,
        actual: 0,
        variance: 24000,
        budgetPct: 100,
        actualPct: 0,
        actualColor: '#3b6ef6',
        varianceColor: GAIN_COLOR
      }
    ])
  })

  it('falls back to categoryId as name when category is unknown', () => {
    const definitions: ExpenseDefinition[] = [{ id: 'e1', name: 'Mystery', categoryId: 'cat-unknown', frequency: 'monthly' }]
    const amounts = { e1: 500 }
    const result = categoryBreakdown(definitions, amounts, [], allCats)
    expect(result[0].name).toBe('cat-unknown')
  })

  it('sorts multiple categories descending by amount', () => {
    const definitions: ExpenseDefinition[] = [
      { id: 'e1', name: 'Rent', categoryId: catHousing.id, frequency: 'monthly' },
      { id: 'e2', name: 'Netflix', categoryId: catEntertainment.id, frequency: 'monthly' },
      { id: 'e3', name: 'Gym', categoryId: catHealth.id, frequency: 'monthly' }
    ]
    const amounts = { e1: 2000, e2: 15, e3: 50 }
    const result = categoryBreakdown(definitions, amounts, [], allCats)
    expect(result.map((r) => r.name)).toEqual(['Housing', 'Health', 'Entertainment'])
  })

  it('budgetPct is relative to the max category, not the sum', () => {
    // Categories: A=100, B=100, C=200. Sum=400.
    // Sum-based pct for C would be 50%; max-based pct for C is 100%.
    const definitions: ExpenseDefinition[] = [
      { id: 'e1', name: 'A1', categoryId: catA.id, frequency: 'monthly' },
      { id: 'e2', name: 'B1', categoryId: catB.id, frequency: 'monthly' },
      { id: 'e3', name: 'C1', categoryId: catC.id, frequency: 'monthly' }
    ]
    const amounts = { e1: 100, e2: 100, e3: 200 }
    const result = categoryBreakdown(definitions, amounts, [], allCats)
    const cEntry = result.find((r) => r.name === 'C')
    const aEntry = result.find((r) => r.name === 'A')
    expect(cEntry?.budgetPct).toBe(100)
    expect(aEntry?.budgetPct).toBe(50)
  })

  it('annualizes per-frequency amounts per category (monthly × 12, yearly as-is)', () => {
    // Budget snapshots are per-frequency: monthly $2000/mo = $24000/yr,
    // yearly $12000 = $12000/yr → Housing total $36000/yr.
    const definitions: ExpenseDefinition[] = [
      { id: 'e1', name: 'Rent', categoryId: catHousing.id, frequency: 'monthly' },
      { id: 'e2', name: 'Property Tax', categoryId: catHousing.id, frequency: 'yearly' }
    ]
    const amounts = { e1: 2000, e2: 12000 }
    const result = categoryBreakdown(definitions, amounts, [], allCats)
    expect(result[0]).toMatchObject({ name: 'Housing', amount: 36000, budgetPct: 100 })
  })

  it('annualizes monthly amounts to yearly before comparing against full-year actuals', () => {
    // Regression: monthly $2000/mo budget = $24000/yr. Twelve $2000 actuals = $24000.
    // Variance must be 0, not 2000 - 24000 = -22000.
    const definitions: ExpenseDefinition[] = [
      { id: 'e1', name: 'Rent', categoryId: catHousing.id, frequency: 'monthly' }
    ]
    const amounts = { e1: 2000 }
    const transactions: BudgetTransaction[] = Array.from({ length: 12 }, (_, i) => ({
      id: `t${i + 1}`,
      date: `2026-${String(i + 1).padStart(2, '0')}-05`,
      description: 'Rent',
      categoryId: catHousing.id,
      amount: 2000
    }))
    const result = categoryBreakdown(definitions, amounts, transactions, allCats)
    expect(result[0]).toMatchObject({ name: 'Housing', amount: 24000, actual: 24000, variance: 0 })
  })

  it('computes actual/variance/colors for a fixture with one over-budget and one under-budget category', () => {
    // Housing: budget 2000/mo = 24000/yr, actual 25000 -> over budget (variance -1000)
    // Food: budget 500/mo = 6000/yr, actual 300 -> under budget (variance 5700)
    // maxCat = max(24000, 6000, 25000, 300) = 25000
    const definitions: ExpenseDefinition[] = [
      { id: 'e1', name: 'Rent', categoryId: catHousing.id, frequency: 'monthly' },
      { id: 'e2', name: 'Groceries', categoryId: catFood.id, frequency: 'monthly' }
    ]
    const amounts = { e1: 2000, e2: 500 }
    const transactions: BudgetTransaction[] = [
      { id: 't1', date: '2026-09-05', description: 'Rent', categoryId: catHousing.id, amount: 25000 },
      { id: 't2', date: '2026-09-10', description: 'Groceries', categoryId: catFood.id, amount: 300 }
    ]
    const result = categoryBreakdown(definitions, amounts, transactions, allCats)
    const housing = result.find((r) => r.name === 'Housing')
    const food = result.find((r) => r.name === 'Food')

    expect(housing).toEqual({
      name: 'Housing',
      amount: 24000,
      actual: 25000,
      variance: -1000,
      budgetPct: (24000 / 25000) * 100,
      actualPct: 100,
      actualColor: LOSS_COLOR,
      varianceColor: LOSS_COLOR
    })
    expect(food).toEqual({
      name: 'Food',
      amount: 6000,
      actual: 300,
      variance: 5700,
      budgetPct: (6000 / 25000) * 100,
      actualPct: (300 / 25000) * 100,
      actualColor: '#3b6ef6',
      varianceColor: GAIN_COLOR
    })
  })

  it('excludes categories flagged excludeFromSpend, leaving non-excluded categories intact', () => {
    const excludedCat: Category = { id: 'cat-excluded', name: 'Transfers', excludeFromSpend: true }
    const cats = [...allCats, excludedCat]
    const definitions: ExpenseDefinition[] = [
      { id: 'e1', name: 'Rent', categoryId: catHousing.id, frequency: 'monthly' },
      { id: 'e2', name: 'Transfer', categoryId: excludedCat.id, frequency: 'monthly' }
    ]
    const amounts = { e1: 2000, e2: 1000 }
    const transactions: BudgetTransaction[] = [
      { id: 't1', date: '2026-09-05', description: 'Rent', categoryId: catHousing.id, amount: 2000 },
      { id: 't2', date: '2026-09-06', description: 'Transfer', categoryId: excludedCat.id, amount: 1000 }
    ]
    const result = categoryBreakdown(definitions, amounts, transactions, cats)
    expect(result.find((r) => r.name === 'Transfers')).toBeUndefined()
    expect(result).toEqual([
      {
        name: 'Housing',
        amount: 24000,
        actual: 2000,
        variance: 22000,
        budgetPct: 100,
        actualPct: (2000 / 24000) * 100,
        actualColor: '#3b6ef6',
        varianceColor: GAIN_COLOR
      }
    ])
  })

  it('returns empty array without throwing when all categories are excluded', () => {
    const excludedA: Category = { ...catA, excludeFromSpend: true }
    const excludedB: Category = { ...catB, excludeFromSpend: true }
    const definitions: ExpenseDefinition[] = [
      { id: 'e1', name: 'A1', categoryId: catA.id, frequency: 'monthly' },
      { id: 'e2', name: 'B1', categoryId: catB.id, frequency: 'monthly' }
    ]
    const amounts = { e1: 100, e2: 200 }
    const transactions: BudgetTransaction[] = [
      { id: 't1', date: '2026-09-05', description: 'A1', categoryId: catA.id, amount: 90 }
    ]
    expect(() => categoryBreakdown(definitions, amounts, transactions, [excludedA, excludedB])).not.toThrow()
    expect(categoryBreakdown(definitions, amounts, transactions, [excludedA, excludedB])).toEqual([])
  })

  it('excludes a category with only budgeted expenses and no actual transactions entirely', () => {
    const excludedCat: Category = { id: 'cat-excluded2', name: 'Savings', excludeFromSpend: true }
    const definitions: ExpenseDefinition[] = [
      { id: 'e1', name: 'Savings deposit', categoryId: excludedCat.id, frequency: 'monthly' }
    ]
    const amounts = { e1: 500 }
    const result = categoryBreakdown(definitions, amounts, [], [excludedCat])
    expect(result).toEqual([])
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
      expect(actualByCategory(transactions, [])).toEqual({ 'cat-food': 30, 'cat-housing': 100 })
    })

    it('returns empty object for empty input', () => {
      expect(actualByCategory([], [])).toEqual({})
    })

    it('aggregates under the effective (linked-expense) category, not the stored categoryId, when spendExpenseId resolves', () => {
      const transactions: BudgetTransaction[] = [
        {
          id: 't1',
          date: '2026-09-01',
          description: 'linked',
          categoryId: 'cat-food',
          spendExpenseId: 'exp-1',
          amount: 40
        },
        { id: 't2', date: '2026-09-02', description: 'unlinked', categoryId: 'cat-food', amount: 10 }
      ]
      const definitions: ExpenseDefinition[] = [{ id: 'exp-1', name: 'Rent', categoryId: 'cat-housing', frequency: 'monthly' }]
      const result = actualByCategory(transactions, definitions)
      expect(result).toEqual({ 'cat-housing': 40, 'cat-food': 10 })
    })

    it('falls back to stored categoryId when spendExpenseId is dangling (definition not found)', () => {
      const transactions: BudgetTransaction[] = [
        {
          id: 't1',
          date: '2026-09-01',
          description: 'dangling link',
          categoryId: 'cat-food',
          spendExpenseId: 'exp-missing',
          amount: 40
        }
      ]
      const definitions: ExpenseDefinition[] = [{ id: 'exp-1', name: 'Rent', categoryId: 'cat-housing', frequency: 'monthly' }]
      const result = actualByCategory(transactions, definitions)
      expect(result).toEqual({ 'cat-food': 40 })
    })

    it('re-resolves live when the linked expense is later re-categorized, with zero changes to the transaction record (no re-selection needed)', () => {
      const transactions: BudgetTransaction[] = [
        {
          id: 't1',
          date: '2026-09-01',
          description: 'linked',
          categoryId: 'cat-food',
          spendExpenseId: 'exp-1',
          amount: 40
        }
      ]
      const stateBefore: AppState = {
        ...initialState(),
        budgetExpenseDefinitions: [{ id: 'exp-1', name: 'Rent', categoryId: 'cat-housing', frequency: 'monthly' }]
      }
      const before = actualByCategory(transactions, stateBefore.budgetExpenseDefinitions)
      expect(before).toEqual({ 'cat-housing': 40 })

      // Correct the linked expense's category via the real reducer helper — the
      // transaction record itself is never touched. Definitions are global, so this
      // affects every year at once.
      const stateAfter = updateExpenseDefinition(stateBefore, 'exp-1', { categoryId: 'cat-utilities' })

      const after = actualByCategory(transactions, stateAfter.budgetExpenseDefinitions)
      expect(after).toEqual({ 'cat-utilities': 40 })
      expect(after['cat-housing']).toBeUndefined()
    })

    it('re-resolves live when the linked expense is later renamed only (no category change), with zero changes to the transaction record', () => {
      const transactions: BudgetTransaction[] = [
        {
          id: 't1',
          date: '2026-09-01',
          description: 'linked',
          categoryId: 'cat-food',
          spendExpenseId: 'exp-1',
          amount: 40
        }
      ]
      const stateBefore: AppState = {
        ...initialState(),
        budgetExpenseDefinitions: [{ id: 'exp-1', name: 'Rent', categoryId: 'cat-housing', frequency: 'monthly' }]
      }
      const before = actualByCategory(transactions, stateBefore.budgetExpenseDefinitions)
      expect(before).toEqual({ 'cat-housing': 40 })

      const stateAfter = updateExpenseDefinition(stateBefore, 'exp-1', { name: 'Rent (updated)' })

      // Category resolution is unaffected by a name-only change.
      const after = actualByCategory(transactions, stateAfter.budgetExpenseDefinitions)
      expect(after).toEqual({ 'cat-housing': 40 })

      // The picker's option label reflects the new name live, without touching the
      // transaction record — SpendCategoryPicker builds "<name> (<category>)" directly
      // from the current ExpenseDefinition, so this is equivalent to a fresh render check.
      const renamedExpense = stateAfter.budgetExpenseDefinitions.find((e) => e.id === 'exp-1')!
      expect(renamedExpense.name).toBe('Rent (updated)')
      const categoriesById = new Map([['cat-housing', 'Housing']])
      const label = `${renamedExpense.name} (${categoriesById.get(renamedExpense.categoryId) ?? renamedExpense.categoryId})`
      expect(label).toBe('Rent (updated) (Housing)')
    })
  })

  describe('effective-category routing in spend aggregation', () => {
    const catFood: Category = { id: 'cat-food', name: 'Food' }
    const catHousing: Category = { id: 'cat-housing', name: 'Housing' }
    const catExcluded: Category = { id: 'cat-excluded', name: 'Excluded', excludeFromSpend: true }
    const categories = [catFood, catHousing, catExcluded]

    it('yearCategoryTotalSpend for the resolved category includes the re-routed transaction, and the stored-but-not-effective category does not', () => {
      const transactions: BudgetTransaction[] = [
        {
          id: 't1',
          date: '2026-03-01',
          description: 'rent booked under Food, linked to Housing expense',
          categoryId: 'cat-food',
          spendExpenseId: 'exp-1',
          amount: 500
        }
      ]
      const definitions: ExpenseDefinition[] = [{ id: 'exp-1', name: 'Rent', categoryId: 'cat-housing', frequency: 'monthly' }]
      expect(yearCategoryTotalSpend(transactions, categories, '2026', 'cat-housing', definitions)).toBe(500)
      expect(yearCategoryTotalSpend(transactions, categories, '2026', 'cat-food', definitions)).toBe(0)
    })

    it('excluded-category filtering uses the resolved category: effective category excluded drops the transaction even though the stored categoryId is not excluded', () => {
      const transactions: BudgetTransaction[] = [
        {
          id: 't1',
          date: '2026-03-01',
          description: 'stored under Food, links to an excluded-category expense',
          categoryId: 'cat-food',
          spendExpenseId: 'exp-1',
          amount: 500
        }
      ]
      const definitions: ExpenseDefinition[] = [{ id: 'exp-1', name: 'Excluded expense', categoryId: 'cat-excluded', frequency: 'monthly' }]
      expect(yearTotalSpend(transactions, categories, '2026', definitions)).toBe(0)
    })

    it('excluded-category filtering uses the resolved category: stored categoryId excluded but effective category not excluded keeps the transaction', () => {
      const transactions: BudgetTransaction[] = [
        {
          id: 't1',
          date: '2026-03-01',
          description: 'stored under Excluded, links to a non-excluded expense',
          categoryId: 'cat-excluded',
          spendExpenseId: 'exp-1',
          amount: 500
        }
      ]
      const definitions: ExpenseDefinition[] = [{ id: 'exp-1', name: 'Housing expense', categoryId: 'cat-housing', frequency: 'monthly' }]
      expect(yearTotalSpend(transactions, categories, '2026', definitions)).toBe(500)
    })
  })

  describe('referencedCategories', () => {
    const catHousing: Category = { id: 'cat-housing', name: 'Housing' }
    const catFood: Category = { id: 'cat-food', name: 'Food' }
    const catUnused: Category = { id: 'cat-unused', name: 'Unused' }
    const catMappingOnly: Category = { id: 'cat-mapping-only', name: 'Mapping Only' }

    it('includes a category referenced only via a CategoryMapping (zero expense/transaction refs)', () => {
      const categories = [catHousing, catMappingOnly]
      const budgetExpenseDefinitions: ExpenseDefinition[] = [{ id: 'e1', name: 'Rent', categoryId: catHousing.id, frequency: 'monthly' }]
      const budgetTransactions: BudgetTransaction[] = []
      const categoryMappings: CategoryMapping[] = [
        { id: 'm1', substring: 'STARBUCKS', categoryId: catMappingOnly.id, updatedAt: '2026-01-01T00:00:00Z' }
      ]
      const result = referencedCategories(categories, categoryMappings, budgetExpenseDefinitions, budgetTransactions)
      expect(result.map((c) => c.id)).toEqual(expect.arrayContaining([catHousing.id, catMappingOnly.id]))
    })

    it('excludes a category with zero references anywhere (expenses, transactions, or mappings)', () => {
      const categories = [catHousing, catFood, catUnused]
      const budgetExpenseDefinitions: ExpenseDefinition[] = [{ id: 'e1', name: 'Rent', categoryId: catHousing.id, frequency: 'monthly' }]
      const budgetTransactions: BudgetTransaction[] = [{ id: 't1', date: '2026-09-01', description: 'a', categoryId: catFood.id, amount: 10 }]
      const categoryMappings: CategoryMapping[] = []
      const result = referencedCategories(categories, categoryMappings, budgetExpenseDefinitions, budgetTransactions)
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

  describe('monthsPresentInYear', () => {
    const categories: Category[] = [
      { id: 'cat-food', name: 'Food', updatedAt: '2026-01-01' },
      { id: 'cat-excluded', name: 'Transfers', updatedAt: '2026-01-01', excludeFromSpend: true }
    ]

    it('returns distinct sorted months with non-excluded transactions', () => {
      const transactions: BudgetTransaction[] = [
        { id: 't1', date: '2026-01-05', description: 'a', categoryId: 'cat-food', amount: 10 },
        { id: 't2', date: '2026-03-05', description: 'b', categoryId: 'cat-food', amount: 20 },
        { id: 't3', date: '2026-09-05', description: 'c', categoryId: 'cat-food', amount: 30 }
      ]
      expect(monthsPresentInYear(transactions, categories, '2026', [])).toEqual([1, 3, 9])
    })

    it('does not count a month whose only transaction is in an excluded category', () => {
      const transactions: BudgetTransaction[] = [
        { id: 't1', date: '2026-01-05', description: 'a', categoryId: 'cat-food', amount: 10 },
        { id: 't2', date: '2026-05-05', description: 'b', categoryId: 'cat-excluded', amount: 999 }
      ]
      expect(monthsPresentInYear(transactions, categories, '2026', [])).toEqual([1])
    })

    it('returns empty array for a year with zero transactions', () => {
      expect(monthsPresentInYear([], categories, '2026', [])).toEqual([])
    })
  })

  describe('yearTotalSpend / yearCategoryTotalSpend / monthTotalSpend', () => {
    const categories: Category[] = [
      { id: 'cat-food', name: 'Food', updatedAt: '2026-01-01' },
      { id: 'cat-rent', name: 'Rent', updatedAt: '2026-01-01' },
      { id: 'cat-excluded', name: 'Transfers', updatedAt: '2026-01-01', excludeFromSpend: true }
    ]
    const transactions: BudgetTransaction[] = [
      { id: 't1', date: '2026-01-05', description: 'a', categoryId: 'cat-food', amount: 10 },
      { id: 't2', date: '2026-01-20', description: 'b', categoryId: 'cat-rent', amount: 100 },
      { id: 't3', date: '2026-02-05', description: 'c', categoryId: 'cat-food', amount: 25 },
      { id: 't4', date: '2026-01-15', description: 'd', categoryId: 'cat-excluded', amount: 5000 },
      { id: 't5', date: '2025-01-15', description: 'e', categoryId: 'cat-food', amount: 40 }
    ]

    it('yearTotalSpend excludes excluded-category amounts', () => {
      expect(yearTotalSpend(transactions, categories, '2026', [])).toBe(135)
    })

    it('yearTotalSpend returns 0 for a year with zero transactions', () => {
      expect(yearTotalSpend(transactions, categories, '2030', [])).toBe(0)
    })

    it('yearCategoryTotalSpend sums only the given category', () => {
      expect(yearCategoryTotalSpend(transactions, categories, '2026', 'cat-food', [])).toBe(35)
      expect(yearCategoryTotalSpend(transactions, categories, '2026', 'cat-rent', [])).toBe(100)
    })

    it('yearCategoryTotalSpend returns 0 for an excluded category', () => {
      expect(yearCategoryTotalSpend(transactions, categories, '2026', 'cat-excluded', [])).toBe(0)
    })

    it('yearCategoryTotalSpend returns 0 for a category not present in transactions', () => {
      expect(yearCategoryTotalSpend(transactions, categories, '2026', 'cat-unknown', [])).toBe(0)
    })

    it('monthTotalSpend sums only the given year+month, excluding excluded categories', () => {
      expect(monthTotalSpend(transactions, categories, '2026', 1, [])).toBe(110)
      expect(monthTotalSpend(transactions, categories, '2026', 2, [])).toBe(25)
    })

    it('monthTotalSpend returns 0 for a month with zero transactions', () => {
      expect(monthTotalSpend(transactions, categories, '2026', 12, [])).toBe(0)
    })
  })

  describe('budget analytics concern selectors', () => {
    const categories: Category[] = [
      { id: 'cat-food', name: 'Food', updatedAt: '2026-01-01' },
      { id: 'cat-rent', name: 'Rent', updatedAt: '2026-01-01' },
      { id: 'cat-excluded', name: 'Transfers', updatedAt: '2026-01-01', excludeFromSpend: true }
    ]

    // 2025: food=100 (month1), rent=900 (month1), excluded=5000 (month1, ignored)
    // 2026: food=150+150=300 (months 1,2), rent=1000+1000=2000 (months 1,2), excluded=9999 (month1, ignored)
    const transactions: BudgetTransaction[] = [
      { id: 't25-food', date: '2025-01-05', description: 'food', categoryId: 'cat-food', amount: 100 },
      { id: 't25-rent', date: '2025-01-05', description: 'rent', categoryId: 'cat-rent', amount: 900 },
      { id: 't25-excl', date: '2025-01-05', description: 'transfer', categoryId: 'cat-excluded', amount: 5000 },
      { id: 't26-food-1', date: '2026-01-05', description: 'food', categoryId: 'cat-food', amount: 150 },
      { id: 't26-food-2', date: '2026-02-05', description: 'food', categoryId: 'cat-food', amount: 150 },
      { id: 't26-rent-1', date: '2026-01-05', description: 'rent', categoryId: 'cat-rent', amount: 1000 },
      { id: 't26-rent-2', date: '2026-02-05', description: 'rent', categoryId: 'cat-rent', amount: 1000 },
      { id: 't26-excl', date: '2026-01-05', description: 'transfer', categoryId: 'cat-excluded', amount: 9999 }
    ]

    const years = ['2026', '2025'] // descending, most-recent-first

    describe('overBudgetConcern', () => {
      const definitions: ExpenseDefinition[] = [
        { id: 'e-food', name: 'Food', categoryId: 'cat-food', frequency: 'monthly' },
        { id: 'e-rent', name: 'Rent', categoryId: 'cat-rent', frequency: 'monthly' },
        { id: 'e-excl', name: 'Transfers', categoryId: 'cat-excluded', frequency: 'monthly' }
      ]
      const amountsByYear: Record<string, Record<string, number>> = {
        '2026': { 'e-food': 100, 'e-rent': 1000, 'e-excl': 10 }
      }

      it('flags a category whose latest-year monthly average exceeds budget by >15%', () => {
        // food: total=300 over 2 months present -> avg=150; budget monthly=100; 100*1.15=115; 150>115 -> over
        // rent: total=2000 over 2 months -> avg=1000; budget monthly=1000; 1000*1.15=1150; 1000 not > 1150 -> not over
        const result = overBudgetConcern(years, transactions, categories, definitions, amountsByYear)
        expect(result).toEqual({ count: 1, categoryNames: ['Food'] })
      })

      it('ignores an excludeFromSpend category even with a huge budgeted expense', () => {
        // cat-excluded actual is forced to 0 by yearCategoryTotalSpend regardless of its 9999 transaction
        const result = overBudgetConcern(years, transactions, categories, definitions, amountsByYear)
        expect(result.categoryNames).not.toContain('Transfers')
      })

      it('returns a zero result when there are no years', () => {
        expect(overBudgetConcern([], transactions, categories, definitions, amountsByYear)).toEqual({ count: 0, categoryNames: [] })
      })
    })

    describe('spendTrendConcern', () => {
      it('computes pct change in monthly-average total spend between the two latest years', () => {
        // 2026: yearTotalSpend = 300 (food) + 2000 (rent) = 2300 (excluded ignored); months=2 -> avg=1150
        // 2025: yearTotalSpend = 100 (food) + 900 (rent) = 1000 (excluded ignored); months=1 -> avg=1000
        // pctChange = (1150/1000 - 1) * 100 = 15
        const result = spendTrendConcern(years, transactions, categories, [])
        expect(result).not.toBeNull()
        expect(result!.pctChange).toBeCloseTo(15, 10)
      })

      it('returns null when fewer than 2 years are available', () => {
        expect(spendTrendConcern(['2026'], transactions, categories, [])).toBeNull()
      })

      it('returns null when the prior year average is 0 (would divide by zero)', () => {
        const onlyExcludedPrevYear: BudgetTransaction[] = [
          { id: 'x1', date: '2025-01-05', description: 'transfer', categoryId: 'cat-excluded', amount: 500 },
          { id: 'x2', date: '2026-01-05', description: 'food', categoryId: 'cat-food', amount: 100 }
        ]
        expect(spendTrendConcern(years, onlyExcludedPrevYear, categories, [])).toBeNull()
      })
    })

    describe('spikeMonthConcern', () => {
      // Population (N) vs sample (N-1) stddev give visibly different z-scores here.
      // Totals per month (cat-excluded's 5000 in month 2 is ignored): month1=10, month2=10, month3=40
      // mean = (10+10+40)/3 = 20
      // population variance = ((10-20)^2 + (10-20)^2 + (40-20)^2) / 3 = (100+100+400)/3 = 200
      // population stddev = sqrt(200) ≈ 14.142135623730951
      // population z for month3 = (40-20)/14.142135623730951 ≈ 1.4142135623730951
      // (sample stddev, divide by N-1=2, would give variance=300, stddev≈17.32, z≈1.1547 -- NOT what we assert)
      const spikeCategories: Category[] = [
        { id: 'cat-food', name: 'Food', updatedAt: '2020-01-01' },
        { id: 'cat-excluded', name: 'Transfers', updatedAt: '2020-01-01', excludeFromSpend: true }
      ]
      const spikeTransactions: BudgetTransaction[] = [
        { id: 's1', date: '2020-01-05', description: 'food', categoryId: 'cat-food', amount: 10 },
        { id: 's2', date: '2020-02-05', description: 'food', categoryId: 'cat-food', amount: 10 },
        { id: 's3', date: '2020-02-15', description: 'transfer', categoryId: 'cat-excluded', amount: 5000 },
        { id: 's4', date: '2020-03-05', description: 'food', categoryId: 'cat-food', amount: 40 }
      ]

      it('finds the highest population-z-score month using population (N) stddev, not sample (N-1)', () => {
        const result = spikeMonthConcern(['2020'], spikeTransactions, spikeCategories, [])
        expect(result).not.toBeNull()
        expect(result).toMatchObject({ year: '2020', month: 3, total: 40 })
        expect(result!.zScore).toBeCloseTo(Math.sqrt(2), 10) // 20/sqrt(200) = sqrt(2) ≈ 1.41421356
        expect(result!.zScore).not.toBeCloseTo(20 / Math.sqrt(300), 5) // sample-stddev z would differ
      })

      it('returns null when there is no data at all', () => {
        expect(spikeMonthConcern([], [], [], [])).toBeNull()
      })

      it('returns null when stddev is 0 (all months equal)', () => {
        const flat: BudgetTransaction[] = [
          { id: 'f1', date: '2021-01-05', description: 'food', categoryId: 'cat-food', amount: 10 },
          { id: 'f2', date: '2021-02-05', description: 'food', categoryId: 'cat-food', amount: 10 }
        ]
        expect(spikeMonthConcern(['2021'], flat, spikeCategories, [])).toBeNull()
      })
    })

    // Income is now a single yearly number per year (no more {monthly, yearly} shape and
    // no more monthly*monthCount scaling). These fixtures preserve the exact EFFECTIVE
    // income totals the old {monthly, yearly} fixtures produced under that scaling (e.g.
    // old 2025: monthly=2000 * 1 active month = 2000 -> new fixture: 2025: 2000), so the
    // savings-rate assertions below are unchanged — this is a fixture reshape only, not a
    // behavior-driven value change.
    describe('savingsRateShrinkingConcern', () => {
      const budgetIncomeByYear: Record<string, number> = {
        '2025': 2000,
        '2026': 5000
      }

      it('compares savings rate between the earliest and latest of the given years', () => {
        // 2025 (first/earliest): income = 2000; spend = 1000; rate = (2000-1000)/2000*100 = 50
        // 2026 (last/latest): income = 5000; spend = 2300; rate = (5000-2300)/5000*100 = 54
        // drop = firstRate - lastRate = 50 - 54 = -4
        const result = savingsRateShrinkingConcern(years, transactions, categories, budgetIncomeByYear, [])
        expect(result).not.toBeNull()
        expect(result!.firstYear).toBe('2025')
        expect(result!.lastYear).toBe('2026')
        expect(result!.firstRate).toBeCloseTo(50, 10)
        expect(result!.lastRate).toBeCloseTo(54, 10)
        expect(result!.drop).toBeCloseTo(-4, 10)
      })

      it('returns null when fewer than 2 years are available', () => {
        expect(savingsRateShrinkingConcern(['2026'], transactions, categories, budgetIncomeByYear, [])).toBeNull()
      })

      it('returns null when an endpoint year has 0 income', () => {
        const zeroIncome: Record<string, number> = { '2025': 0, '2026': 5000 }
        expect(savingsRateShrinkingConcern(years, transactions, categories, zeroIncome, [])).toBeNull()
      })
    })

    describe('concentrationRiskConcern', () => {
      it('identifies the top spending category and whether it exceeds 40% share', () => {
        // 2026 total = 300 (food) + 2000 (rent) = 2300 (excluded ignored)
        // top = rent (2000); topSharePct = 2000/2300*100 ≈ 86.9565217...
        const result = concentrationRiskConcern(years, transactions, categories, [])
        expect(result).not.toBeNull()
        expect(result!.categoryName).toBe('Rent')
        expect(result!.topSharePct).toBeCloseTo((2000 / 2300) * 100, 10)
        expect(result!.isHighRisk).toBe(true)
      })

      it('never picks an excludeFromSpend category as the top, even with far larger raw spend', () => {
        const result = concentrationRiskConcern(years, transactions, categories, [])
        expect(result!.categoryName).not.toBe('Transfers')
      })

      it('returns null when there are no years', () => {
        expect(concentrationRiskConcern([], transactions, categories, [])).toBeNull()
      })

      it('returns null when total spend is 0', () => {
        expect(concentrationRiskConcern(['2099'], transactions, categories, [])).toBeNull()
      })
    })

    // See the note above savingsRateShrinkingConcern: fixtures preserve the old
    // {monthly, yearly}-scaled effective income totals (2025: 1000*1mo=1000, 2026: 2500*2mo=5000)
    // so assertions are unchanged — a reshape, not a value change.
    describe('savingsRateByYear', () => {
      const budgetIncomeByYear: Record<string, number> = {
        '2025': 1000,
        '2026': 5000
      }

      it('matches hand-computed savings rate per year, in input year order', () => {
        // 2026: income = 5000; spend = 300 + 2000 = 2300; pct = (5000-2300)/5000*100 = 54
        // 2025: income = 1000; spend = 100 + 900 = 1000; pct = (1000-1000)/1000*100 = 0
        const result = savingsRateByYear(years, transactions, categories, budgetIncomeByYear, [])
        expect(result).toEqual([
          { year: '2026', pct: 54, isPositive: true },
          { year: '2025', pct: 0, isPositive: true }
        ])
      })

      it('returns pct: 0 (not NaN/Infinity) for a year with 0 income', () => {
        const zeroIncome: Record<string, number> = { '2026': 0 }
        const result = savingsRateByYear(['2026'], transactions, categories, zeroIncome, [])
        expect(result).toEqual([{ year: '2026', pct: 0, isPositive: true }])
      })

      it('preserves the order given in `years`, regardless of chronology', () => {
        const result = savingsRateByYear(['2025', '2026'], transactions, categories, budgetIncomeByYear, [])
        expect(result.map((r) => r.year)).toEqual(['2025', '2026'])
      })
    })

    describe('categoryShareOverTime', () => {
      // Stability fixture: cat-A is #1 in year2 (latest) but only #3 by its OWN totals in year1.
      const stableCategories: Category[] = [
        { id: 'cat-a', name: 'A', updatedAt: '2026-01-01' },
        { id: 'cat-b', name: 'B', updatedAt: '2026-01-01' },
        { id: 'cat-c', name: 'C', updatedAt: '2026-01-01' },
        { id: 'cat-excl', name: 'Excluded', updatedAt: '2026-01-01', excludeFromSpend: true }
      ]
      // year1 (own ranking): C=300, B=200, A=100 (A is last)
      // year2 (latest, drives global ranking): A=500, B=100, C=50 (A is first)
      const stableTransactions: BudgetTransaction[] = [
        { id: 'y1-a', date: '2025-01-05', description: 'a', categoryId: 'cat-a', amount: 100 },
        { id: 'y1-b', date: '2025-01-05', description: 'b', categoryId: 'cat-b', amount: 200 },
        { id: 'y1-c', date: '2025-01-05', description: 'c', categoryId: 'cat-c', amount: 300 },
        { id: 'y1-excl', date: '2025-01-05', description: 'x', categoryId: 'cat-excl', amount: 9999 },
        { id: 'y2-a', date: '2026-01-05', description: 'a', categoryId: 'cat-a', amount: 500 },
        { id: 'y2-b', date: '2026-01-05', description: 'b', categoryId: 'cat-b', amount: 100 },
        { id: 'y2-c', date: '2026-01-05', description: 'c', categoryId: 'cat-c', amount: 50 }
      ]
      const stableYears = ['2026', '2025'] // descending, latest first

      it('orders segments by the LATEST year ranking, stable across all years (not each year’s own rank)', () => {
        const result = categoryShareOverTime(stableYears, stableTransactions, stableCategories, [])
        // latest-year (2026) ranking by amount: A(500) > B(100) > C(50)
        const order = (year: string) => result.rows.find((r) => r.year === year)!.segments.map((s) => s.categoryId)
        expect(order('2026')).toEqual(['cat-a', 'cat-b', 'cat-c'])
        // year1's own ranking would be C > B > A, but segment order must still follow latest-year ranking
        expect(order('2025')).toEqual(['cat-a', 'cat-b', 'cat-c'])
        expect(result.legend.map((l) => l.categoryId)).toEqual(['cat-a', 'cat-b', 'cat-c'])
      })

      it('excludes excludeFromSpend categories entirely from ranking, legend, and segments', () => {
        const result = categoryShareOverTime(stableYears, stableTransactions, stableCategories, [])
        expect(result.legend.some((l) => l.categoryId === 'cat-excl')).toBe(false)
        result.rows.forEach((row) => {
          expect(row.segments.some((s) => s.categoryId === 'cat-excl')).toBe(false)
        })
      })

      it('segments per year sum to ~100% except years with 0 total spend (all zero)', () => {
        const result = categoryShareOverTime(stableYears, stableTransactions, stableCategories, [])
        result.rows.forEach((row) => {
          const sum = row.segments.reduce((s, seg) => s + seg.pct, 0)
          expect(sum).toBeCloseTo(100, 5)
        })

        const zeroSpendResult = categoryShareOverTime(['2099'], stableTransactions, stableCategories, [])
        const zeroRow = zeroSpendResult.rows.find((r) => r.year === '2099')!
        zeroRow.segments.forEach((seg) => expect(seg.pct).toBe(0))
      })

      it('caps legend at 6 entries even with 8+ non-excluded categories', () => {
        const manyCategories: Category[] = Array.from({ length: 8 }, (_, i) => ({
          id: `cat-${i}`,
          name: `Cat ${i}`,
          updatedAt: '2026-01-01'
        }))
        const manyTransactions: BudgetTransaction[] = manyCategories.map((c, i) => ({
          id: `t-${i}`,
          date: '2026-01-05',
          description: c.name,
          categoryId: c.id,
          amount: 100 - i
        }))
        const result = categoryShareOverTime(['2026'], manyTransactions, manyCategories, [])
        expect(result.legend.length).toBe(6)
        expect(result.rows[0].segments.length).toBe(8)
      })
    })
  })

  describe('monthlySeasonality', () => {
    const catFood: Category = { id: 'cat-food', name: 'Food', updatedAt: '2026-01-01' }
    const catExcluded: Category = { id: 'cat-excluded', name: 'Transfers', updatedAt: '2026-01-01', excludeFromSpend: true }
    const categories: Category[] = [catFood, catExcluded]

    it('averages a month only over years that have it present, without diluting via missing years', () => {
      // 2025 has Dec spend, 2026 has NO Dec transactions at all (month absent).
      const transactions: BudgetTransaction[] = [
        { id: 't1', date: '2025-12-05', description: 'a', categoryId: 'cat-food', amount: 100 },
        { id: 't2', date: '2026-01-05', description: 'b', categoryId: 'cat-food', amount: 50 }
      ]
      const result = monthlySeasonality(['2025', '2026'], transactions, categories, [])
      const dec = result.find((m) => m.month === 12)!
      // Should be 100 (average over just 2025), NOT 50 (100+0)/2.
      expect(dec.avgSpend).toBe(100)
    })

    it('flags the single highest-average month as peak, first occurring on ties', () => {
      const transactions: BudgetTransaction[] = [
        { id: 't1', date: '2026-01-05', description: 'a', categoryId: 'cat-food', amount: 10 },
        { id: 't2', date: '2026-06-05', description: 'b', categoryId: 'cat-food', amount: 500 },
        { id: 't3', date: '2026-09-05', description: 'c', categoryId: 'cat-food', amount: 10 }
      ]
      const result = monthlySeasonality(['2026'], transactions, categories, [])
      expect(result.length).toBe(12)
      expect(result.find((m) => m.month === 6)!.isPeak).toBe(true)
      expect(result.filter((m) => m.isPeak).length).toBe(1)
      expect(result.find((m) => m.month === 1)!.label).toBe('Jan')
      expect(result.find((m) => m.month === 12)!.label).toBe('Dec')
    })

    it('a month with 0 years present has avgSpend 0 and is not incorrectly picked as peak over a real month', () => {
      const transactions: BudgetTransaction[] = [
        { id: 't1', date: '2026-03-05', description: 'a', categoryId: 'cat-food', amount: 25 }
      ]
      const result = monthlySeasonality(['2026'], transactions, categories, [])
      expect(result.find((m) => m.month === 3)!.isPeak).toBe(true)
      result
        .filter((m) => m.month !== 3)
        .forEach((m) => {
          expect(m.avgSpend).toBe(0)
          expect(m.isPeak).toBe(false)
        })
    })

    it('a category whose only transaction is excluded-from-spend does not make that month present or affect the average', () => {
      const transactions: BudgetTransaction[] = [
        { id: 't1', date: '2026-01-05', description: 'a', categoryId: 'cat-food', amount: 20 },
        // December's ONLY transaction is in the excluded category -> Dec is absent, not a 0-spend present month.
        { id: 't2', date: '2026-12-05', description: 'b', categoryId: 'cat-excluded', amount: 9999 }
      ]
      const result = monthlySeasonality(['2026'], transactions, categories, [])
      const dec = result.find((m) => m.month === 12)!
      expect(dec.avgSpend).toBe(0)
      // Jan is the only present month with spend, so it's the peak, not diluted/skewed by the excluded Dec amount.
      expect(result.find((m) => m.month === 1)!.isPeak).toBe(true)
    })
  })

  describe('budgetAccuracyByYear', () => {
    const catFood: Category = { id: 'cat-food', name: 'Food', updatedAt: '2026-01-01' }
    const categories: Category[] = [catFood]
    const currentYear = String(new Date().getFullYear())

    it('falls back to the current year snapshot when the target year has no expense amounts at all', () => {
      const transactions: BudgetTransaction[] = [
        { id: 't1', date: '2020-01-05', description: 'a', categoryId: 'cat-food', amount: 40 }
      ]
      const definitions: ExpenseDefinition[] = [{ id: 'e1', name: 'Groceries', categoryId: 'cat-food', frequency: 'monthly' }]
      const amountsByYear: Record<string, Record<string, number>> = {
        [currentYear]: { e1: 100 }
      }
      // '2020' has no entry in amountsByYear -> must fall back to currentYear's snapshot (100/mo),
      // not treat budget as 0/undefined.
      const result = budgetAccuracyByYear(['2020'], transactions, categories, definitions, amountsByYear)
      expect(result.length).toBe(1)
      const monthCount = monthsPresentInYear(transactions, categories, '2020', []).length
      expect(monthCount).toBe(1)
      expect(result[0].budgetTotal).toBe(100 * monthCount)
      expect(result[0].budgetTotal).not.toBe(0)
    })

    it('computes correct variance sign: non-negative when budget >= actual, negative when over budget', () => {
      const transactions: BudgetTransaction[] = [
        { id: 't1', date: '2026-01-05', description: 'a', categoryId: 'cat-food', amount: 50 },
        { id: 't2', date: '2026-02-05', description: 'b', categoryId: 'cat-food', amount: 500 }
      ]
      const definitions: ExpenseDefinition[] = [{ id: 'e1', name: 'Groceries', categoryId: 'cat-food', frequency: 'monthly' }]
      const amountsByYear: Record<string, Record<string, number>> = { '2026': { e1: 100 } }
      const result = budgetAccuracyByYear(['2026'], transactions, categories, definitions, amountsByYear)
      // 2 months present, budgetTotal = 100*2 = 200, actualTotal = 550 -> over budget, variance negative.
      expect(result[0].budgetTotal).toBe(200)
      expect(result[0].actualTotal).toBe(550)
      expect(result[0].variance).toBe(200 - 550)
      expect(result[0].variance).toBeLessThan(0)

      const underBudgetTransactions: BudgetTransaction[] = [
        { id: 't1', date: '2026-01-05', description: 'a', categoryId: 'cat-food', amount: 10 }
      ]
      const underResult = budgetAccuracyByYear(['2026'], underBudgetTransactions, categories, definitions, amountsByYear)
      // 1 month present, budgetTotal = 100, actualTotal = 10 -> under budget, variance non-negative.
      expect(underResult[0].budgetTotal).toBe(100)
      expect(underResult[0].actualTotal).toBe(10)
      expect(underResult[0].variance).toBe(90)
      expect(underResult[0].variance).toBeGreaterThanOrEqual(0)
    })

    it('preserves input year order and computes budgetPct/actualPct relative to the larger total', () => {
      const transactions: BudgetTransaction[] = [
        { id: 't1', date: '2019-01-05', description: 'a', categoryId: 'cat-food', amount: 300 }
      ]
      const definitions: ExpenseDefinition[] = [{ id: 'e1', name: 'Groceries', categoryId: 'cat-food', frequency: 'monthly' }]
      const amountsByYear: Record<string, Record<string, number>> = {
        '2019': { e1: 100 },
        [currentYear]: { e1: 999 }
      }
      const result = budgetAccuracyByYear(['2019', '2020'], transactions, categories, definitions, amountsByYear)
      expect(result.map((r) => r.year)).toEqual(['2019', '2020'])
      // 2019: 1 month present -> budgetTotal=100, actualTotal=300 -> denom=300
      expect(result[0].budgetTotal).toBe(100)
      expect(result[0].actualTotal).toBe(300)
      expect(result[0].budgetPct).toBeCloseTo((100 / 300) * 100)
      expect(result[0].actualPct).toBeCloseTo((300 / 300) * 100)
    })
  })

  describe('categoryTrendsYoY and topMovers', () => {
    const categories: Category[] = [
      { id: 'cat-food', name: 'Food', updatedAt: '2026-01-01' },
      { id: 'cat-rent', name: 'Rent', updatedAt: '2026-01-01' },
      { id: 'cat-entertainment', name: 'Entertainment', updatedAt: '2026-01-01' },
      { id: 'cat-utilities', name: 'Utilities', updatedAt: '2026-01-01' },
      { id: 'cat-transport', name: 'Transport', updatedAt: '2026-01-01' },
      { id: 'cat-shopping', name: 'Shopping', updatedAt: '2026-01-01' },
      { id: 'cat-new', name: 'NewThing', updatedAt: '2026-01-01' },
      { id: 'cat-excluded', name: 'Transfers', updatedAt: '2026-01-01', excludeFromSpend: true }
    ]

    // Single month present in each year (Jan), so monthly-avg === total for that year.
    // 2026 totals: food=180 rent=1000 entertainment=50 utilities=80 transport=60 shopping=10 new=50 excluded=9999
    // 2025 totals: food=100 rent=1000 entertainment=150 utilities=80 transport=20 shopping=90 new=0  excluded=500
    const transactions: BudgetTransaction[] = [
      { id: 't26-food', date: '2026-01-05', description: 'food', categoryId: 'cat-food', amount: 180 },
      { id: 't26-rent', date: '2026-01-05', description: 'rent', categoryId: 'cat-rent', amount: 1000 },
      { id: 't26-ent', date: '2026-01-05', description: 'fun', categoryId: 'cat-entertainment', amount: 50 },
      { id: 't26-util', date: '2026-01-05', description: 'util', categoryId: 'cat-utilities', amount: 80 },
      { id: 't26-transport', date: '2026-01-05', description: 'gas', categoryId: 'cat-transport', amount: 60 },
      { id: 't26-shop', date: '2026-01-05', description: 'shop', categoryId: 'cat-shopping', amount: 10 },
      { id: 't26-new', date: '2026-01-05', description: 'new', categoryId: 'cat-new', amount: 50 },
      { id: 't26-excl', date: '2026-01-05', description: 'transfer', categoryId: 'cat-excluded', amount: 9999 },
      { id: 't25-food', date: '2025-01-05', description: 'food', categoryId: 'cat-food', amount: 100 },
      { id: 't25-rent', date: '2025-01-05', description: 'rent', categoryId: 'cat-rent', amount: 1000 },
      { id: 't25-ent', date: '2025-01-05', description: 'fun', categoryId: 'cat-entertainment', amount: 150 },
      { id: 't25-util', date: '2025-01-05', description: 'util', categoryId: 'cat-utilities', amount: 80 },
      { id: 't25-transport', date: '2025-01-05', description: 'gas', categoryId: 'cat-transport', amount: 20 },
      { id: 't25-shop', date: '2025-01-05', description: 'shop', categoryId: 'cat-shopping', amount: 90 },
      { id: 't25-excl', date: '2025-01-05', description: 'transfer', categoryId: 'cat-excluded', amount: 500 }
    ]

    const years = ['2026', '2025']

    const definitions: ExpenseDefinition[] = [
      { id: 'e-food', name: 'Food', categoryId: 'cat-food', frequency: 'monthly' },
      { id: 'e-rent', name: 'Rent', categoryId: 'cat-rent', frequency: 'monthly' }
    ]
    const amountsByYear: Record<string, Record<string, number>> = {
      '2026': { 'e-food': 100, 'e-rent': 1000 }
    }

    describe('categoryTrendsYoY', () => {
      it('returns null when fewer than 2 years', () => {
        expect(categoryTrendsYoY(['2026'], transactions, categories, definitions, amountsByYear)).toBeNull()
      })

      it('sorts rows by delta descending, matching hand-computed deltas', () => {
        // deltas (1 month present each year, avg === total):
        // transport: (60/20-1)*100 = 200
        // new: prevAvg=0, lastAvg=50>0 -> sentinel 100
        // food: (180/100-1)*100 = 80
        // rent: (1000/1000-1)*100 = 0
        // utilities: (80/80-1)*100 = 0
        // entertainment: (50/150-1)*100 = -66.667
        // shopping: (10/90-1)*100 = -88.889
        const result = categoryTrendsYoY(years, transactions, categories, definitions, amountsByYear)
        expect(result).not.toBeNull()
        expect(result!.year1).toBe('2026')
        expect(result!.year2).toBe('2025')
        const byId = new Map(result!.rows.map((r) => [r.categoryId, r]))
        expect(byId.get('cat-transport')!.delta).toBeCloseTo(200, 5)
        expect(byId.get('cat-new')!.delta).toBeCloseTo(100, 5)
        expect(byId.get('cat-food')!.delta).toBeCloseTo(80, 5)
        expect(byId.get('cat-rent')!.delta).toBeCloseTo(0, 5)
        expect(byId.get('cat-entertainment')!.delta).toBeCloseTo(-66.6667, 3)
        expect(byId.get('cat-shopping')!.delta).toBeCloseTo(-88.8889, 3)

        const ids = result!.rows.map((r) => r.categoryId)
        expect(ids[0]).toBe('cat-transport')
        expect(ids[1]).toBe('cat-new')
        expect(ids[2]).toBe('cat-food')
        expect(ids[ids.length - 1]).toBe('cat-shopping')
        expect(ids[ids.length - 2]).toBe('cat-entertainment')

        // sorted descending overall
        for (let i = 1; i < result!.rows.length; i++) {
          expect(result!.rows[i - 1].delta).toBeGreaterThanOrEqual(result!.rows[i].delta)
        }
      })

      it('flags overBudget correctly per hand-computed monthly budget comparisons', () => {
        const result = categoryTrendsYoY(years, transactions, categories, definitions, amountsByYear)!
        const byId = new Map(result.rows.map((r) => [r.categoryId, r]))
        // food: lastAvg=180 > 100*1.15=115 -> over
        expect(byId.get('cat-food')!.overBudget).toBe(true)
        // rent: lastAvg=1000, not > 1000*1.15=1150 -> not over
        expect(byId.get('cat-rent')!.overBudget).toBe(false)
        // no budget entry -> never over
        expect(byId.get('cat-transport')!.overBudget).toBe(false)
      })

      it('totalsByYear includes an entry for every year in the input years array', () => {
        const result = categoryTrendsYoY(years, transactions, categories, definitions, amountsByYear)!
        const food = result.rows.find((r) => r.categoryId === 'cat-food')!
        expect(food.totalsByYear).toEqual({ '2026': 180, '2025': 100 })
      })

      it('handles a category present in one year but 0 in the other without crashing, using the sentinel delta', () => {
        const result = categoryTrendsYoY(years, transactions, categories, definitions, amountsByYear)!
        const newRow = result.rows.find((r) => r.categoryId === 'cat-new')!
        expect(newRow.totalsByYear).toEqual({ '2026': 50, '2025': 0 })
        expect(newRow.delta).toBe(100)
      })

      it('never includes an excludeFromSpend category as a row, even with large spend both years', () => {
        const result = categoryTrendsYoY(years, transactions, categories, definitions, amountsByYear)!
        expect(result.rows.some((r) => r.categoryId === 'cat-excluded')).toBe(false)
      })
    })

    describe('topMovers', () => {
      it('returns null when fewer than 2 years', () => {
        expect(topMovers(['2026'], transactions, categories, [])).toBeNull()
      })

      it('picks top 3 increases and bottom 3 (reversed) decreases from a 7-category fixture', () => {
        // diffs (monthly avg deltas, 1 month present each year):
        // food: 180-100=80, new: 50-0=50, transport: 60-20=40  -> increases
        // rent: 0, utilities: 0                                -> excluded (not >0 / <0)
        // entertainment: 50-150=-100, shopping: 10-90=-80      -> decreases
        const result = topMovers(years, transactions, categories, [])
        expect(result).not.toBeNull()
        expect(result!.increases.map((m) => m.categoryId)).toEqual(['cat-food', 'cat-new', 'cat-transport'])
        expect(result!.increases.map((m) => m.diff)).toEqual([80, 50, 40])
        expect(result!.decreases.map((m) => m.categoryId)).toEqual(['cat-entertainment', 'cat-shopping'])
        expect(result!.decreases.map((m) => m.diff)).toEqual([-100, -80])
      })

      it('excludes a category with an exact $0 diff from both increases and decreases', () => {
        const result = topMovers(years, transactions, categories, [])!
        expect(result.increases.some((m) => m.categoryId === 'cat-rent')).toBe(false)
        expect(result.decreases.some((m) => m.categoryId === 'cat-rent')).toBe(false)
        expect(result.increases.some((m) => m.categoryId === 'cat-utilities')).toBe(false)
        expect(result.decreases.some((m) => m.categoryId === 'cat-utilities')).toBe(false)
      })

      it('never includes an excludeFromSpend category as a mover, even with large spend both years', () => {
        const result = topMovers(years, transactions, categories, [])!
        expect(result.increases.some((m) => m.categoryId === 'cat-excluded')).toBe(false)
        expect(result.decreases.some((m) => m.categoryId === 'cat-excluded')).toBe(false)
      })
    })
  })
})

describe('effectiveCategoryId', () => {
  function makeTx(overrides?: Partial<BudgetTransaction>): BudgetTransaction {
    return {
      id: 'tx-1',
      date: '2024-03-15',
      description: 'Test',
      categoryId: 'cat-fallback',
      amount: -50,
      ...overrides
    }
  }

  function makeDefinition(overrides?: Partial<ExpenseDefinition>): ExpenseDefinition {
    return {
      id: 'exp-1',
      name: 'Test expense',
      categoryId: 'cat-from-expense',
      frequency: 'monthly',
      ...overrides
    }
  }

  it('resolves the linked expense categoryId when spendExpenseId matches', () => {
    const tx = makeTx({ spendExpenseId: 'exp-1', categoryId: 'cat-fallback' })
    const definitions = [makeDefinition({ id: 'exp-1', categoryId: 'cat-from-expense' })]
    expect(effectiveCategoryId(tx, definitions)).toBe('cat-from-expense')
  })

  it('falls back to tx.categoryId when the linked expense definition is not present (deleted)', () => {
    const tx = makeTx({ spendExpenseId: 'exp-missing', categoryId: 'cat-fallback' })
    const definitions = [makeDefinition({ id: 'exp-1', categoryId: 'cat-from-expense' })]
    expect(effectiveCategoryId(tx, definitions)).toBe('cat-fallback')
  })

  it('returns tx.categoryId directly when spendExpenseId is unset', () => {
    const tx = makeTx({ categoryId: 'cat-fallback' })
    const definitions = [makeDefinition({ id: 'exp-1', categoryId: 'cat-from-expense' })]
    expect(effectiveCategoryId(tx, definitions)).toBe('cat-fallback')
  })

  it('resolves the linked expense regardless of the transaction date/year, since definitions are global/year-independent', () => {
    // Behavior change vs. the old year-scoped lookup: a tx dated in a year with no matching
    // "snapshot" used to fall back to tx.categoryId. Definitions are now global, so the
    // link resolves the same way no matter what year the transaction is dated.
    const tx = makeTx({ spendExpenseId: 'exp-1', categoryId: 'cat-fallback', date: '2023-01-01' })
    const definitions = [makeDefinition({ id: 'exp-1', categoryId: 'cat-from-expense' })]
    expect(() => effectiveCategoryId(tx, definitions)).not.toThrow()
    expect(effectiveCategoryId(tx, definitions)).toBe('cat-from-expense')
  })

  it('falls back to tx.categoryId without throwing when there are no definitions at all', () => {
    const tx = makeTx({ spendExpenseId: 'exp-1', categoryId: 'cat-fallback' })
    expect(() => effectiveCategoryId(tx, [])).not.toThrow()
    expect(effectiveCategoryId(tx, [])).toBe('cat-fallback')
  })
})

describe('formatSpendCategoryLabel', () => {
  const definitions: ExpenseDefinition[] = [{ id: 'exp-1', name: 'Netflix', categoryId: 'cat-1', frequency: 'monthly' }]
  const categoriesById = new Map<string, string>([
    ['cat-1', 'Subscriptions'],
    ['cat-2', 'Groceries']
  ])

  it('formats "<expense name> (<category name>)" when spendExpenseId resolves to a definition', () => {
    expect(formatSpendCategoryLabel('exp-1', 'cat-1', definitions, categoriesById)).toBe('Netflix (Subscriptions)')
  })

  it('formats "Uncategorized (<category name>)" when spendExpenseId is unset', () => {
    expect(formatSpendCategoryLabel(undefined, 'cat-2', definitions, categoriesById)).toBe('Uncategorized (Groceries)')
  })

  it('falls back to "Uncategorized (<category name>)" when spendExpenseId is set but the definition is not found (stale link)', () => {
    expect(formatSpendCategoryLabel('exp-does-not-exist', 'cat-2', definitions, categoriesById)).toBe(
      'Uncategorized (Groceries)'
    )
  })

  it('falls back to the raw category id when categoryId is not found in categoriesById', () => {
    expect(formatSpendCategoryLabel(undefined, 'cat-unknown', definitions, categoriesById)).toBe(
      'Uncategorized (cat-unknown)'
    )
  })
})
