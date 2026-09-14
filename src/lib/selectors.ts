import type { AppState } from './state'
import type { Position, ClosedPosition, Transaction, TaxCategory, Expense, BudgetTransaction, Category, CategoryMapping } from './types'
import { sortBy } from './sort'
import { allocationByAssetClass, fmtUSD, fmtPct, computePosition, toPeriod, GAIN_COLOR, LOSS_COLOR } from './computations'
import { latestBalance } from './register'

/**
 * Map tax category keys to display labels.
 */
export const CATEGORY_LABEL: Record<TaxCategory, string> = {
  taxable: 'Taxable',
  nonTaxable: 'Non-Taxable',
  taxDeferred: 'Tax-Deferred'
}

/**
 * Compute total market value across every open position.
 * This is the denominator for portfolio percentage calculations.
 * Returns the sum of all positions' market values (can be zero, negative, or positive).
 */
export function filteredPortfolioTotal(state: AppState): number {
  return state.positions.reduce((sum, p) => sum + computePosition(p).marketValue, 0)
}

/**
 * Get all distinct asset classes (including manual overrides) from positions, sorted alphabetically.
 */
export function assetClassOptions(state: AppState): string[] {
  const assetClasses = new Set<string>()
  state.positions.forEach((p) => {
    const effectiveClass = p.assetClassManualOverride || p.assetClass
    assetClasses.add(effectiveClass)
  })
  return Array.from(assetClasses).sort()
}

/**
 * Filter transactions by type and search text.
 * Applies type filter (or 'All' for everything) and search on symbol/date (case-insensitive).
 */
export function visibleTransactions(state: AppState): Transaction[] {
  let results = state.transactions

  // Apply type filter
  if (state.txTypeFilter !== 'All') {
    results = results.filter((t) => t.type === state.txTypeFilter)
  }

  // Apply search filter (on symbol or date, case-insensitive)
  if (state.txSearch.trim()) {
    const searchLower = state.txSearch.toLowerCase()
    results = results.filter((t) =>
      t.symbol.toLowerCase().includes(searchLower) ||
      t.date.toLowerCase().includes(searchLower)
    )
  }

  // Sort by date descending (most recent first)
  results = sortBy(results, 'date', 'desc')

  return results
}



/**
 * Generate allocation bars by asset class.
 * Uses the computations.allocationByAssetClass() helper and formats values.
 * Note: Allocation percentages are market-value based and do not include taxes.
 */
export function allocationBars(
  positions: Position[]
): Array<{ label: string; value: string; pct: string; pctNum: number }> {
  // Use the allocationByAssetClass helper (respects manual overrides)
  // Note: taxes field is not used in allocation calculations
  const allocationData = allocationByAssetClass(
    positions.map((p) => ({
      ...p,
      assetClass: p.assetClassManualOverride || p.assetClass
    }))
  )

  return allocationData.map((item) => ({
    label: item.label,
    value: fmtUSD(item.value),
    pct: fmtPct(item.pct),
    pctNum: item.pct
  }))
}

/**
 * Generate category-card data for the Accounts page's left column.
 * One card per tax category (Taxable, Non-Taxable, Tax-Deferred, in that order),
 * each listing its accounts with per-account totals, expand/collapse state, and selection state.
 */
export function categoryCards(state: AppState): Array<{
  key: TaxCategory
  label: string
  totalStr: string
  accountCount: number
  expanded: boolean
  accounts: Array<{
    id: string
    institution: string
    name: string
    accountNumber: string
    updatedStr: string
    totalStr: string
    selected: boolean
  }>
  hasAccounts: boolean
  noAccounts: boolean
}> {
  const catKeys = Object.keys(CATEGORY_LABEL) as TaxCategory[]

  return catKeys.map((catKey) => {
    const accountsInCategory = state.accounts.filter((a) => a.taxCategory === catKey)

    let categoryTotal = 0
    const accounts = accountsInCategory.map((account) => {
      const accountPositions = state.positions.filter((p) => p.accountId === account.id)
      const total = accountPositions.reduce((sum, p) => sum + p.shares * p.price, 0)
      categoryTotal += total
      const updatedStr =
        accountPositions.length === 0
          ? '—'
          : new Date(
              Math.max(...accountPositions.map((p) => new Date(p.lastImportedAt).getTime()))
            ).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

      return {
        id: account.id,
        institution: account.institution || '',
        name: account.name,
        accountNumber: account.accountNumber,
        updatedStr,
        totalStr: fmtUSD(total),
        selected: state.selectedAccountId === account.id && state.selectedCategoryKey === catKey
      }
    })

    return {
      key: catKey,
      label: CATEGORY_LABEL[catKey],
      totalStr: fmtUSD(categoryTotal),
      accountCount: accounts.length,
      expanded: !!state.expandedCategories[catKey],
      accounts,
      hasAccounts: accounts.length > 0,
      noAccounts: accounts.length === 0
    }
  })
}

/**
 * Format a 'YYYY-MM-DD' date string for display without timezone-shift artifacts
 * (avoids `new Date('YYYY-MM-DD')` being interpreted as UTC midnight).
 */
function fmtDateLocal(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })
}

/**
 * Generate category-card data for the Register page's left column.
 * Mirrors categoryCards structure but sources balances from balanceEntries (via latestBalance)
 * instead of position totals, and reflects Register-page-scoped expand/select state.
 */
export function registerCategoryCards(state: AppState): Array<{
  key: TaxCategory
  label: string
  totalStr: string
  accountCount: number
  expanded: boolean
  accounts: Array<{
    id: string
    institution: string
    name: string
    totalStr: string
    asOfStr: string
    entryCount: number
    selected: boolean
  }>
  hasAccounts: boolean
  noAccounts: boolean
}> {
  const catKeys = Object.keys(CATEGORY_LABEL) as TaxCategory[]

  return catKeys.map((catKey) => {
    const accountsInCategory = state.accounts.filter((a) => a.taxCategory === catKey)

    let categoryTotal = 0
    const accounts = accountsInCategory.map((account) => {
      const latest = latestBalance(state.balanceEntries, account.id)
      const total = latest ? latest.balance : 0
      categoryTotal += total
      const entryCount = state.balanceEntries.filter((b) => b.accountId === account.id).length

      return {
        id: account.id,
        institution: account.institution || '',
        name: account.name,
        totalStr: latest ? fmtUSD(latest.balance) : '—',
        asOfStr: latest ? fmtDateLocal(latest.date) : 'never',
        entryCount,
        selected: state.regAccountId === account.id
      }
    })

    return {
      key: catKey,
      label: CATEGORY_LABEL[catKey],
      totalStr: fmtUSD(categoryTotal),
      accountCount: accounts.length,
      expanded: !!state.regExpanded[catKey],
      accounts,
      hasAccounts: accounts.length > 0,
      noAccounts: accounts.length === 0
    }
  })
}

/**
 * Sum of each account's latest balance across all accounts, for the Register page's
 * "All Accounts" pill total.
 */
export function registerAllAccountsTotal(state: AppState): string {
  const total = state.accounts.reduce((sum, account) => {
    const latest = latestBalance(state.balanceEntries, account.id)
    return sum + (latest ? latest.balance : 0)
  }, 0)
  return fmtUSD(total)
}

/**
 * Sum of shares*price across every open position, regardless of any account/category
 * filter state, for the Positions/Accounts page's "All Accounts" pill total.
 * Unscoped: ignores selectedAccountId/selectedCategoryKey and never includes closedPositions.
 */
export function acctAllAccountsTotal(state: AppState): string {
  const total = state.positions.reduce((sum, p) => sum + p.shares * p.price, 0)
  return fmtUSD(total)
}

/**
 * Generate closed-positions card data for the Accounts page's left column.
 * Mirrors categoryCards structure but shows closed positions across all accounts.
 * One card labeled "Closed Positions", listing only accounts with ≥1 closed position,
 * with per-account totals (sum of realizedGL where not null), expand/collapse state, and selection state.
 */
export function closedPositionsCard(state: AppState): {
  key: string
  label: string
  totalStr: string
  accountCount: number
  expanded: boolean
  accounts: Array<{
    id: string
    institution: string
    name: string
    accountNumber: string
    updatedStr: string
    totalStr: string
    selected: boolean
  }>
  hasAccounts: boolean
  noAccounts: boolean
} {
  // Group closed positions by account
  const closedPositionsByAccount = new Map<string, ClosedPosition[]>()
  state.closedPositions.forEach((cp) => {
    if (!closedPositionsByAccount.has(cp.accountId)) {
      closedPositionsByAccount.set(cp.accountId, [])
    }
    closedPositionsByAccount.get(cp.accountId)!.push(cp)
  })

  // Build accounts list: only include accounts with ≥1 closed position
  let cardTotal = 0
  const accounts = state.accounts
    .filter((account) => closedPositionsByAccount.has(account.id))
    .map((account) => {
      const accountClosedPositions = closedPositionsByAccount.get(account.id)!

      // Calculate total: sum of realizedGL where not null
      const total = accountClosedPositions.reduce((sum, cp) => {
        return cp.realizedGL !== null ? sum + cp.realizedGL : sum
      }, 0)
      cardTotal += total

      // Determine totalStr: if all realizedGL are null, show '—', otherwise show sum
      const hasAnyRealized = accountClosedPositions.some((cp) => cp.realizedGL !== null)
      const totalStr = hasAnyRealized ? fmtUSD(total) : '—'

      // updatedStr: latest lastImportedAt across closed positions
      const updatedStr =
        accountClosedPositions.length === 0
          ? '—'
          : new Date(
              Math.max(...accountClosedPositions.map((cp) => new Date(cp.lastImportedAt).getTime()))
            ).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

      return {
        id: account.id,
        institution: account.institution || '',
        name: account.name,
        accountNumber: account.accountNumber,
        updatedStr,
        totalStr,
        selected: state.selectedAccountId === account.id && state.selectedCategoryKey === 'closedPositions'
      }
    })

  // Determine card-level total
  const hasAnyCardRealized = state.closedPositions.some((cp) => cp.realizedGL !== null)
  const cardTotalStr = hasAnyCardRealized ? fmtUSD(cardTotal) : '—'

  return {
    key: 'closedPositions',
    label: 'Closed Positions',
    totalStr: cardTotalStr,
    accountCount: accounts.length,
    expanded: !!state.expandedCategories['closedPositions'],
    accounts,
    hasAccounts: accounts.length > 0,
    noAccounts: accounts.length === 0
  }
}

/**
 * Positions scoped to the currently-selected account on the Accounts page,
 * or all positions when no account is selected.
 */
export function acctScopedPositions(state: AppState): Position[] {
  if (state.selectedAccountId) {
    return state.positions.filter((p) => p.accountId === state.selectedAccountId)
  }
  return state.positions
}

/**
 * Structural type for items with asset class fields.
 * Allows acctAssetClassOptions to work with Position or ClosedPosition.
 */
type AssetClassed = { assetClass: string; assetClassManualOverride?: string }

/**
 * Distinct effective asset classes among the given positions, sorted alphabetically.
 */
export function acctAssetClassOptions(positions: AssetClassed[]): string[] {
  const assetClasses = new Set<string>()
  positions.forEach((p) => {
    assetClasses.add(p.assetClassManualOverride || p.assetClass)
  })
  return Array.from(assetClasses).sort()
}

/**
 * Distinct symbols among held positions whose effective asset class is Equity or ETF.
 */
export function heldEquityEtfSymbols(state: AppState): string[] {
  return Array.from(
    new Set(
      state.positions
        .filter((p) => {
          const cls = p.assetClassManualOverride || p.assetClass
          return cls === 'Equity' || cls === 'ETF'
        })
        .map((p) => p.symbol)
    )
  )
}

/**
 * Distinct symbols among held positions whose effective asset class is Mutual Fund.
 */
export function heldMutualFundSymbols(state: AppState): string[] {
  return Array.from(
    new Set(
      state.positions
        .filter((p) => (p.assetClassManualOverride || p.assetClass) === 'Mutual Fund')
        .map((p) => p.symbol)
    )
  )
}

/**
 * Accounts page positions further filtered by acctAssetClassFilter and acctPosSearch.
 */
export function acctFilteredPositions(state: AppState): Position[] {
  let results = acctScopedPositions(state)

  if (state.acctAssetClassFilter !== 'All') {
    results = results.filter((p) => {
      const effectiveClass = p.assetClassManualOverride || p.assetClass
      return effectiveClass === state.acctAssetClassFilter
    })
  }

  if (state.acctPosSearch.trim()) {
    const searchLower = state.acctPosSearch.toLowerCase()
    results = results.filter(
      (p) =>
        p.symbol.toLowerCase().includes(searchLower) ||
        (p.name?.toLowerCase().includes(searchLower) ?? false) ||
        (p.trackingSymbol?.toLowerCase().includes(searchLower) ?? false)
    )
  }

  return results
}

/**
 * Closed positions scoped to the currently-selected account on the Accounts page,
 * or all closed positions when no account is selected.
 */
export function acctScopedClosedPositions(state: AppState): ClosedPosition[] {
  if (state.selectedAccountId) {
    return state.closedPositions.filter((cp) => cp.accountId === state.selectedAccountId)
  }
  return state.closedPositions
}

/**
 * Accounts page closed positions further filtered by acctAssetClassFilter and acctPosSearch.
 */
export function acctFilteredClosedPositions(state: AppState): ClosedPosition[] {
  let results = acctScopedClosedPositions(state)

  if (state.acctAssetClassFilter !== 'All') {
    results = results.filter((cp) => {
      const effectiveClass = cp.assetClassManualOverride || cp.assetClass
      return effectiveClass === state.acctAssetClassFilter
    })
  }

  if (state.acctPosSearch.trim()) {
    const searchLower = state.acctPosSearch.toLowerCase()
    results = results.filter(
      (cp) =>
        cp.symbol.toLowerCase().includes(searchLower) ||
        (cp.name?.toLowerCase().includes(searchLower) ?? false)
    )
  }

  return results
}

/**
 * Title for the Accounts page's allocation card, reflecting the current account selection.
 */
export function acctAllocationTitle(state: AppState): string {
  if (state.selectedAccountId) {
    const account = state.accounts.find((a) => a.id === state.selectedAccountId)
    return `Allocation — ${account?.name ?? ''}`
  }
  return 'Allocation — All Accounts'
}

export const ALPHAVANTAGE_DAILY_CALL_CAP = 25

/** True if the last Polygon run left symbols unresolved, or a ticker-overview
 *  fetch is currently failing — either means a retry is worth trying. */
export function shouldRetryPolygonSync(
  state: AppState,
  tickerOverviewErrors: Record<string, string>
): boolean {
  const notFoundCount = state.priceSync.lastRun?.notFound.length ?? 0
  return notFoundCount > 0 || Object.keys(tickerOverviewErrors).length > 0
}

/** True if any held mutual fund symbol has a stale (not-today) or missing
 *  price AND today's Alphavantage call budget isn't exhausted yet. */
export function shouldRetryMutualFundSync(
  state: AppState,
  today: string = new Date().toISOString().slice(0, 10)
): boolean {
  const budget = state.mutualFundSync.callBudget
  const callsUsedToday = budget.date === today ? budget.callsUsed : 0
  if (callsUsedToday >= ALPHAVANTAGE_DAILY_CALL_CAP) return false
  return heldMutualFundSymbols(state).some((symbol) => {
    const held = state.mutualFundSync.heldPrices[symbol]
    return !held || held.fetchedAt.slice(0, 10) !== today
  })
}

/**
 * Filter expenses by category (or all) and sort by the given key.
 * When sorting by amount, compares each expense's value converted to `period`.
 * `categoriesById` resolves each expense's `categoryId` to a display name for the
 * category sort, so alphabetical sort reflects category names, not ids.
 */
export function visibleExpenses(
  expenses: Expense[],
  filterCategoryId: string,
  sortBy: 'category' | 'name' | 'amount',
  period: 'monthly' | 'yearly',
  categoriesById: Map<string, string>
): Expense[] {
  const visible = filterCategoryId === '__all' ? expenses : expenses.filter((e) => e.categoryId === filterCategoryId)
  return [...visible].sort((a, b) => {
    if (sortBy === 'name') return a.name.localeCompare(b.name)
    if (sortBy === 'amount') return toPeriod(b.amount, b.frequency, period) - toPeriod(a.amount, a.frequency, period)
    const nameA = categoriesById.get(a.categoryId) ?? a.categoryId
    const nameB = categoriesById.get(b.categoryId) ?? b.categoryId
    return nameA.localeCompare(nameB) || a.name.localeCompare(b.name)
  })
}

/**
 * Filter budget transactions to those falling within the selected month/year.
 */
export function budgetTransactionsForPeriod(
  transactions: BudgetTransaction[],
  period: 'monthly' | 'yearly',
  selectedMonth: string, // YYYY-MM
  selectedYear: string // YYYY
): BudgetTransaction[] {
  return transactions.filter((t) =>
    period === 'monthly' ? t.date.slice(0, 7) === selectedMonth : t.date.slice(0, 4) === selectedYear
  )
}

/**
 * Sum actual spend per category from budget transactions.
 */
export function actualByCategory(transactions: BudgetTransaction[]): Record<string, number> {
  const out: Record<string, number> = {}
  transactions.forEach((t) => {
    out[t.categoryId] = (out[t.categoryId] ?? 0) + t.amount
  })
  return out
}

/**
 * Distinct months present in budget transactions plus the current month, sorted
 * descending, with a locale-formatted label for display.
 */
export function availableBudgetMonths(transactions: BudgetTransaction[], now: Date): Array<{ value: string; label: string }> {
  const set = new Set(transactions.map((t) => t.date.slice(0, 7)))
  const current = now.toISOString().slice(0, 7)
  set.add(current)
  return [...set]
    .sort()
    .reverse()
    .map((v) => ({
      value: v,
      label: new Date(v + '-01T00:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    }))
}

/**
 * Distinct years present in budget transactions plus the current year, sorted descending.
 */
export function availableBudgetYears(transactions: BudgetTransaction[], now: Date): string[] {
  const set = new Set(transactions.map((t) => t.date.slice(0, 4)))
  set.add(String(now.getFullYear()))
  return [...set].sort().reverse()
}

/**
 * Aggregate expenses by category for the given period, alongside actual spend from
 * budget transactions in the same period.
 * `budgetPct`/`actualPct` are relative to the largest category total across both
 * budget and actual (not the sum of all categories).
 * Returns entries sorted by budgeted amount descending.
 */
export function categoryBreakdown(
  expenses: Expense[],
  transactions: BudgetTransaction[],
  period: 'monthly' | 'yearly',
  categories: Category[]
): Array<{
  name: string
  amount: number
  actual: number
  variance: number
  budgetPct: number
  actualPct: number
  actualColor: string
  varianceColor: string
}> {
  const byCategory: Record<string, number> = {}
  expenses.forEach((e) => {
    byCategory[e.categoryId] = (byCategory[e.categoryId] ?? 0) + toPeriod(e.amount, e.frequency, period)
  })
  const actuals = actualByCategory(transactions)
  const maxCat = Math.max(1, ...Object.values(byCategory), ...Object.values(actuals))
  return Object.entries(byCategory)
    .sort((a, b) => b[1] - a[1])
    .map(([categoryId, amount]) => {
      const actual = actuals[categoryId] ?? 0
      const variance = amount - actual
      const name = categories.find((c) => c.id === categoryId)?.name ?? categoryId
      return {
        name,
        amount,
        actual,
        variance,
        budgetPct: (amount / maxCat) * 100,
        actualPct: (Math.min(actual, maxCat) / maxCat) * 100,
        actualColor: variance >= 0 ? '#3b6ef6' : LOSS_COLOR,
        varianceColor: variance >= 0 ? GAIN_COLOR : LOSS_COLOR
      }
    })
}

/**
 * Categories referenced by at least one budgeted expense, actual budget transaction,
 * or category mapping.
 */
export function referencedCategories(state: AppState): Category[] {
  const used = new Set<string>()
  state.budgetExpenses.forEach((e) => used.add(e.categoryId))
  state.budgetTransactions.forEach((t) => used.add(t.categoryId))
  state.categoryMappings.forEach((m) => used.add(m.categoryId))
  return state.categories.filter((c) => used.has(c.id))
}

/**
 * Category mappings for a given category, sorted alphabetically by substring.
 */
export function mappingsForCategory(mappings: CategoryMapping[], categoryId: string): CategoryMapping[] {
  return mappings.filter((m) => m.categoryId === categoryId).sort((a, b) => a.substring.localeCompare(b.substring))
}

