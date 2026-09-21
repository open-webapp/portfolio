import type { AppState } from './state'
import { resolveExpenseAmountsForAnalyticsYear } from './state'
import type { Position, ClosedPosition, Transaction, TaxCategory, ExpenseDefinition, BudgetTransaction, Category, CategoryMapping } from './types'
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
  definitions: ExpenseDefinition[],
  amountsForYear: Record<string, number>,
  filterCategoryId: string,
  sortBy: 'category' | 'name' | 'amount',
  categoriesById: Map<string, string>
): ExpenseDefinition[] {
  const visible = filterCategoryId === '__all' ? definitions : definitions.filter((e) => e.categoryId === filterCategoryId)
  return [...visible].sort((a, b) => {
    if (sortBy === 'name') return a.name.localeCompare(b.name)
    if (sortBy === 'amount') return (amountsForYear[b.id] ?? 0) - (amountsForYear[a.id] ?? 0)
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
 * Set of category ids marked excludeFromSpend, used to filter actual-spend figures.
 */
export function excludedCategoryIdSet(categories: Category[]): Set<string> {
  return new Set(categories.filter((c) => c.excludeFromSpend || isIncomeCategory(c)).map((c) => c.id))
}

/**
 * Flags BudgetTransactions that form a chain of the same (accountName,
 * effectiveCategoryId) across >=3 CONSECUTIVE calendar months, with each
 * month's amount within +/-10% of the chain's running average (recomputed
 * as the chain grows). Computed over the FULL transaction history passed
 * in -- caller must not pre-filter by year/scope, so the flag is stable
 * regardless of the Spend tab's year selector. Records whose effective
 * category has excludeFromSpend are never considered. Returns the set of
 * BudgetTransaction ids that are a chain's representative for their month
 * in any chain reaching length >=3.
 */
export function computeRecurringSpendIds(
  transactions: BudgetTransaction[],
  categories: Category[],
  definitions: ExpenseDefinition[]
): Set<string> {
  const excludedIds = excludedCategoryIdSet(categories)
  const groups = new Map<string, BudgetTransaction[]>()

  transactions.forEach((transaction) => {
    const categoryId = effectiveCategoryId(transaction, definitions)
    if (excludedIds.has(categoryId)) return
    const key = `${transaction.accountName ?? ''}|${categoryId}`
    const group = groups.get(key) ?? []
    group.push(transaction)
    groups.set(key, group)
  })

  const recurringIds = new Set<string>()
  groups.forEach((group) => {
    const byMonth = new Map<string, BudgetTransaction[]>()
    const consumedIds = new Set<string>()
    group.forEach((transaction) => {
      const month = transaction.date.slice(0, 7)
      const bucket = byMonth.get(month) ?? []
      bucket.push(transaction)
      byMonth.set(month, bucket)
    })

    const flagChain = (chain: BudgetTransaction[]) => {
      if (chain.length >= 3) chain.forEach((transaction) => recurringIds.add(transaction.id))
    }
    let chain: BudgetTransaction[] = []
    let runningAverage = 0
    let previousMonth: string | undefined

    [...byMonth.keys()].sort().forEach((month) => {
      if (previousMonth) {
        const [previousYear, previousMonthNumber] = previousMonth.split('-').map(Number)
        const [year, monthNumber] = month.split('-').map(Number)
        if (year * 12 + monthNumber !== previousYear * 12 + previousMonthNumber + 1) {
          flagChain(chain)
          chain = []
          runningAverage = 0
        }
      }

      const bucket = byMonth.get(month)!
      const candidate = chain.length === 0
        ? bucket.find((transaction) => !consumedIds.has(transaction.id))
        : bucket
          .filter((transaction) =>
            !consumedIds.has(transaction.id) &&
            Math.abs(Math.abs(transaction.amount) - runningAverage) <= runningAverage * 0.1
          )
          .sort((a, b) => Math.abs(Math.abs(a.amount) - runningAverage) - Math.abs(Math.abs(b.amount) - runningAverage))[0]

      if (candidate) {
        consumedIds.add(candidate.id)
        chain.push(candidate)
        runningAverage = chain.reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0) / chain.length
      } else {
        flagChain(chain)
        chain = []
        runningAverage = 0
      }
      previousMonth = month
    })

    flagChain(chain)
  })

  return recurringIds
}

/** Active categories whose normalized name is exactly "income". */
export function incomeCategoryIdSet(categories: Category[]): Set<string> {
  return new Set(categories.filter(isIncomeCategory).map((c) => c.id))
}

function isIncomeCategory(category: Category): boolean {
  return !category.deletedAt && category.name.trim().toLowerCase() === 'income'
}

/** Whether a transaction resolves to an active Income category. */
export function isIncomeTransaction(
  transaction: BudgetTransaction,
  categories: Category[],
  definitions: ExpenseDefinition[]
): boolean {
  return incomeCategoryIdSet(categories).has(effectiveCategoryId(transaction, definitions))
}

/** Shared spend exclusion rule for records and all spend aggregates. */
export function isIncomeOrExcludedTransaction(
  transaction: BudgetTransaction,
  categories: Category[],
  definitions: ExpenseDefinition[]
): boolean {
  return excludedCategoryIdSet(categories).has(effectiveCategoryId(transaction, definitions))
}

/** Annualized Income definition amounts for one selected year. */
export function budgetedIncomeForYear(
  definitions: ExpenseDefinition[],
  amountsByYear: Record<string, Record<string, number>>,
  categories: Category[],
  year: string
): number {
  const incomeIds = incomeCategoryIdSet(categories)
  const amounts = amountsByYear[year] ?? {}
  return definitions.reduce((sum, definition) =>
    incomeIds.has(definition.categoryId)
      ? sum + toPeriod(amounts[definition.id] ?? 0, definition.frequency, 'yearly')
      : sum,
  0)
}

/** Signed Income transaction total for one selected year. */
export function actualIncomeForYear(
  transactions: BudgetTransaction[],
  categories: Category[],
  definitions: ExpenseDefinition[],
  year: string
): number {
  return transactions
    .filter((transaction) => transaction.date.slice(0, 4) === year && isIncomeTransaction(transaction, categories, definitions))
    .reduce((sum, transaction) => sum + transaction.amount, 0)
}

/**
 * Distinct month numbers (1-12) with at least one non-excluded transaction in the given year,
 * sorted ascending.
 */
export function monthsPresentInYear(
  transactions: BudgetTransaction[],
  categories: Category[],
  year: string,
  definitions: ExpenseDefinition[]
): number[] {
  const excludedIds = excludedCategoryIdSet(categories)
  const set = new Set<number>()
  transactions.forEach((t) => {
    if (excludedIds.has(effectiveCategoryId(t, definitions))) return
    if (t.date.slice(0, 4) !== year) return
    set.add(Number(t.date.slice(5, 7)))
  })
  return [...set].sort((a, b) => a - b)
}

/**
 * Sum of all non-excluded transaction amounts dated in the given year.
 */
export function yearTotalSpend(
  transactions: BudgetTransaction[],
  categories: Category[],
  year: string,
  definitions: ExpenseDefinition[]
): number {
  const excludedIds = excludedCategoryIdSet(categories)
  return transactions
    .filter((t) => t.date.slice(0, 4) === year && !excludedIds.has(effectiveCategoryId(t, definitions)))
    .reduce((sum, t) => sum - t.amount, 0)
}

/**
 * Sum of non-excluded transaction amounts for a specific category dated in the given year.
 * Returns 0 if the category itself is excluded.
 */
export function yearCategoryTotalSpend(
  transactions: BudgetTransaction[],
  categories: Category[],
  year: string,
  categoryId: string,
  definitions: ExpenseDefinition[]
): number {
  const excludedIds = excludedCategoryIdSet(categories)
  if (excludedIds.has(categoryId)) return 0
  return transactions
    .filter((t) => {
      const effId = effectiveCategoryId(t, definitions)
      return t.date.slice(0, 4) === year && effId === categoryId && !excludedIds.has(effId)
    })
    .reduce((sum, t) => sum - t.amount, 0)
}

/**
 * Sum of non-excluded transaction amounts dated in the given year+month (month is 1-12).
 */
export function monthTotalSpend(
  transactions: BudgetTransaction[],
  categories: Category[],
  year: string,
  month: number,
  definitions: ExpenseDefinition[]
): number {
  const excludedIds = excludedCategoryIdSet(categories)
  const monthStr = `${year}-${String(month).padStart(2, '0')}`
  return transactions
    .filter((t) => t.date.slice(0, 7) === monthStr && !excludedIds.has(effectiveCategoryId(t, definitions)))
    .reduce((sum, t) => sum - t.amount, 0)
}

/**
 * Sum actual spend per category from budget transactions.
 */
export function actualByCategory(
  transactions: BudgetTransaction[],
  definitions: ExpenseDefinition[],
  categories: Category[] = []
): Record<string, number> {
  const excludedIds = excludedCategoryIdSet(categories)
  const out: Record<string, number> = {}
  transactions.forEach((t) => {
    const catId = effectiveCategoryId(t, definitions)
    if (excludedIds.has(catId)) return
    out[catId] = (out[catId] ?? 0) - t.amount
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

/** Sentinel for the Spend page's transaction-backed all-years scope. */
export const SPEND_ALL_YEARS = Symbol('spend-all-years')
export type SpendScope = string | typeof SPEND_ALL_YEARS

export type SankeyNode = {
  id: string
  label: string
  column: 'income' | 'budget' | 'actual'
  x: number
  y: number
  width: number
  height: number
  value: number
}

export type SankeyLink = {
  sourceId: string
  targetId: string
  d: string
  opacity: number
  title: string
}

/** Distinct transaction years available to the Spend page, newest first. */
export function spendBudgetYears(transactions: BudgetTransaction[]): string[] {
  return [...new Set(transactions.map((transaction) => transaction.date.slice(0, 4)))].sort().reverse()
}

/** Transactions in a Spend scope; all-years deliberately does not use period filtering. */
export function spendTransactionsForScope(
  transactions: BudgetTransaction[],
  scope: SpendScope
): BudgetTransaction[] {
  return scope === SPEND_ALL_YEARS
    ? transactions
    : transactions.filter((transaction) => transaction.date.slice(0, 4) === scope)
}

type PerCategoryBudgetActual = {
  categoryId: string
  label: string
  budget: number
  actual: number
}

/** Shared scope-aware category totals used by Spend budget-versus-actual views. */
function perCategoryBudgetActual(
  definitions: ExpenseDefinition[],
  amountsByYear: Record<string, Record<string, number>>,
  transactions: BudgetTransaction[],
  categories: Category[],
  scope: SpendScope
): PerCategoryBudgetActual[] {
  const scopedTransactions = spendTransactionsForScope(transactions, scope)
  const years = spendBudgetYears(scopedTransactions)
  const excludedIds = excludedCategoryIdSet(categories)
  const categoryIds = new Set<string>()

  categories.forEach((category) => {
    if (!excludedIds.has(category.id)) categoryIds.add(category.id)
  })
  definitions.forEach((definition) => {
    if (!excludedIds.has(definition.categoryId)) categoryIds.add(definition.categoryId)
  })
  scopedTransactions.forEach((transaction) => {
    const categoryId = effectiveCategoryId(transaction, definitions)
    if (!excludedIds.has(categoryId)) categoryIds.add(categoryId)
  })

  const budgetByCategory: Record<string, number> = {}
  definitions.forEach((definition) => {
    if (excludedIds.has(definition.categoryId)) return
    const budget = years.reduce((sum, year) =>
      sum + toPeriod((amountsByYear[year] ?? {})[definition.id] ?? 0, definition.frequency, 'yearly'), 0)
    budgetByCategory[definition.categoryId] = (budgetByCategory[definition.categoryId] ?? 0) + budget
  })
  const actualByCategoryForScope = actualByCategory(scopedTransactions, definitions, categories)

  return [...categoryIds].map((categoryId) => ({
    categoryId,
    label: categories.find((category) => category.id === categoryId)?.name ?? categoryId,
    budget: Math.max(0, budgetByCategory[categoryId] ?? 0),
    actual: Math.max(0, actualByCategoryForScope[categoryId] ?? 0)
  }))
}

/**
 * Budget-to-actual Sankey geometry for the Spend page's 1200px-wide viewBox.
 * Budget definitions and actual transactions are aggregated by category within
 * the selected scope; unused budget flows to the actual-column Unspent node.
 */
export function sankeyFlowData(
  definitions: ExpenseDefinition[],
  amountsByYear: Record<string, Record<string, number>>,
  transactions: BudgetTransaction[],
  categories: Category[],
  scope: SpendScope
): { nodes: SankeyNode[]; links: SankeyLink[] } {
  const rows = perCategoryBudgetActual(definitions, amountsByYear, transactions, categories, scope)
    .map((row) => ({ ...row, id: row.categoryId }))
    .sort((a, b) => b.budget - a.budget || b.actual - a.actual || a.label.localeCompare(b.label))

  if (rows.length === 0) return { nodes: [], links: [] }

  const totalBudget = rows.reduce((sum, row) => sum + row.budget, 0)
  const totalActual = rows.reduce((sum, row) => sum + row.actual, 0)
  const unspent = rows.reduce((sum, row) => sum + Math.max(0, row.budget - row.actual), 0)
  const scale = 360 / Math.max(totalBudget, totalActual, 1)
  const nodeWidth = 18
  const incomeX = 70
  const budgetX = 545
  const actualX = 1010
  const top = 40
  const gap = 32
  const nodes: SankeyNode[] = []
  const links: SankeyLink[] = []
  const budgetOffsets = new Map<string, number>()
  const actualOffsets = new Map<string, number>()
  let budgetY = top
  let actualY = top

  rows.forEach((row) => {
    const height = row.budget * scale
    budgetOffsets.set(row.id, budgetY)
    nodes.push({ id: `budget:${row.id}`, label: row.label, column: 'budget', x: budgetX, y: budgetY, width: nodeWidth, height, value: row.budget })
    budgetY += height + gap
  })
  rows.forEach((row) => {
    const height = row.actual * scale
    actualOffsets.set(row.id, actualY)
    nodes.push({ id: `actual:${row.id}`, label: row.label, column: 'actual', x: actualX, y: actualY, width: nodeWidth, height, value: row.actual })
    actualY += height + gap
  })
  if (unspent > 0) {
    nodes.push({ id: 'actual:unspent', label: 'Unspent', column: 'actual', x: actualX, y: actualY, width: nodeWidth, height: unspent * scale, value: unspent })
  }
  nodes.unshift({ id: 'income', label: 'Income', column: 'income', x: incomeX, y: top, width: nodeWidth, height: totalBudget * scale, value: totalBudget })

  const path = (sourceX: number, sourceY: number, sourceHeight: number, targetX: number, targetY: number, targetHeight: number): string => {
    const control = (targetX - sourceX) * 0.45
    return `M ${sourceX} ${sourceY} C ${sourceX + control} ${sourceY}, ${targetX - control} ${targetY}, ${targetX} ${targetY} L ${targetX} ${targetY + targetHeight} C ${targetX - control} ${targetY + targetHeight}, ${sourceX + control} ${sourceY + sourceHeight}, ${sourceX} ${sourceY + sourceHeight} Z`
  }

  let incomeOffset = top
  let unspentOffset = nodes.find((node) => node.id === 'actual:unspent')?.y ?? 0
  rows.forEach((row) => {
    const budgetHeight = row.budget * scale
    const budgetNodeY = budgetOffsets.get(row.id)!
    const actualNodeY = actualOffsets.get(row.id)!
    if (row.budget > 0) {
      links.push({
        sourceId: 'income', targetId: `budget:${row.id}`,
        d: path(incomeX + nodeWidth, incomeOffset, budgetHeight, budgetX, budgetNodeY, budgetHeight),
        opacity: 0.35,
        title: `${row.label}: budget ${fmtUSD(row.budget)}`
      })
      incomeOffset += budgetHeight
    }

    if (row.actual > 0) {
      const renderedActual = row.budget > 0 ? Math.min(row.actual, row.budget * 1.15) : row.actual
      const overage = row.budget > 0 ? (row.actual / row.budget - 1) * 100 : null
      links.push({
        sourceId: `budget:${row.id}`, targetId: `actual:${row.id}`,
        d: path(budgetX + nodeWidth, budgetNodeY, renderedActual * scale, actualX, actualNodeY, row.actual * scale),
        opacity: 0.65,
        title: overage !== null && overage > 0
          ? `${row.label}: ${fmtUSD(row.actual)} actual, ${overage.toFixed(1)}% over budget`
          : `${row.label}: ${fmtUSD(row.actual)} actual`
      })
    }

    const shortfall = Math.max(0, row.budget - row.actual)
    if (shortfall > 0) {
      const shortfallHeight = shortfall * scale
      links.push({
        sourceId: `budget:${row.id}`, targetId: 'actual:unspent',
        d: path(budgetX + nodeWidth, budgetNodeY + row.actual * scale, shortfallHeight, actualX, unspentOffset, shortfallHeight),
        opacity: 0.3,
        title: `${row.label}: ${fmtUSD(shortfall)} unspent`
      })
      unspentOffset += shortfallHeight
    }
  })

  return { nodes, links }
}

/**
 * Categories whose actual scoped spend exceeds their scoped budget, largest
 * overage first. A positive actual against a zero budget reports `Infinity`
 * for pctOver so callers can display it as an uncapped overage.
 */
export function overBudgetCategories(
  definitions: ExpenseDefinition[],
  amountsByYear: Record<string, Record<string, number>>,
  transactions: BudgetTransaction[],
  categories: Category[],
  scope: SpendScope
): Array<{ categoryId: string; label: string; overageAmount: number; pctOver: number }> {
  return perCategoryBudgetActual(definitions, amountsByYear, transactions, categories, scope)
    .filter((row) => row.actual > row.budget)
    .map((row) => ({
      categoryId: row.categoryId,
      label: row.label,
      overageAmount: row.actual - row.budget,
      pctOver: row.budget === 0 ? Infinity : (row.actual / row.budget - 1) * 100
    }))
    .sort((a, b) => b.overageAmount - a.overageAmount || a.label.localeCompare(b.label))
}

/** Spend-card totals for exact transaction-backed years in the selected scope. */
export function spendCardTotals(
  definitions: ExpenseDefinition[],
  amountsByYear: Record<string, Record<string, number>>,
  transactions: BudgetTransaction[],
  categories: Category[],
  scope: SpendScope
): { budgetedIncome: number; actualIncome: number; budgetedSpend: number; actualSpend: number; variance: number } {
  const scopedTransactions = spendTransactionsForScope(transactions, scope)
  const excludedIds = excludedCategoryIdSet(categories)
  const totals = spendBudgetYears(scopedTransactions).reduce(
    (sum, year) => {
      const amounts = amountsByYear[year] ?? {}
      sum.budgetedIncome += budgetedIncomeForYear(definitions, amountsByYear, categories, year)
      sum.actualIncome += actualIncomeForYear(scopedTransactions, categories, definitions, year)
      sum.budgetedSpend += definitions.reduce(
        (budget, definition) => excludedIds.has(definition.categoryId) ? budget : budget + (amounts[definition.id] ?? 0),
        0
      )
      sum.actualSpend += yearTotalSpend(scopedTransactions, categories, year, definitions)
      return sum
    },
    { budgetedIncome: 0, actualIncome: 0, budgetedSpend: 0, actualSpend: 0 }
  )
  return { ...totals, variance: totals.budgetedSpend - totals.actualSpend }
}

/**
 * Project selected-year spend from its actual spend rate through `asOfDate`.
 * All-years has no bounded period and therefore cannot be projected.
 */
export function projectedSpendForScope(
  definitions: ExpenseDefinition[],
  amountsByYear: Record<string, Record<string, number>>,
  transactions: BudgetTransaction[],
  categories: Category[],
  scope: SpendScope,
  asOfDate: Date
): { projectedTotal: number; budgetTotal: number; pctOver: number; isOverBudget: boolean } | null {
  if (scope === SPEND_ALL_YEARS) return null

  const totals = spendCardTotals(definitions, amountsByYear, transactions, categories, scope)
  const periodStart = Date.UTC(Number(scope), 0, 1)
  const periodEnd = Date.UTC(Number(scope) + 1, 0, 1)
  const periodDays = (periodEnd - periodStart) / 86_400_000
  const asOfDay = Date.UTC(asOfDate.getFullYear(), asOfDate.getMonth(), asOfDate.getDate())
  const elapsedDays = Math.max(0, Math.min(periodDays, (asOfDay - periodStart) / 86_400_000))
  const projectedTotal = elapsedDays === 0 ? 0 : totals.actualSpend * periodDays / elapsedDays
  const pctOver = totals.budgetedSpend === 0 ? 0 : (projectedTotal / totals.budgetedSpend - 1) * 100

  return {
    projectedTotal,
    budgetTotal: totals.budgetedSpend,
    pctOver,
    isOverBudget: projectedTotal > totals.budgetedSpend
  }
}

/**
 * Distinct years for the Expenses table: transaction date prefixes, expense
 * amount snapshot keys, and the current local year, sorted ascending.
 */
export function expenseTableYears(
  transactions: BudgetTransaction[],
  amountsByYear: Record<string, Record<string, number>>,
  now: Date
): string[] {
  const years = new Set<string>([String(now.getFullYear())])
  transactions.forEach((transaction) => years.add(transaction.date.slice(0, 4)))
  Object.keys(amountsByYear).forEach((year) => years.add(year))
  return [...years].sort()
}

/**
 * Aggregate expenses by category for the given year, alongside actual spend from
 * budget transactions in the same year. Budget amounts are per-frequency
 * snapshots annualized via frequency (monthly × 12) so both sides are yearly totals.
 * `budgetPct`/`actualPct` are relative to the larger budget or actual total for
 * that category.
 * Returns entries sorted by budgeted amount descending.
 */
export function categoryBreakdown(
  definitions: ExpenseDefinition[],
  amountsForYear: Record<string, number>,
  transactions: BudgetTransaction[],
  categories: Category[]
): Array<{
  categoryId: string
  name: string
  amount: number
  actual: number
  variance: number
  budgetPct: number
  actualPct: number
  actualColor: string
  varianceColor: string
  drillLines: Array<{
    id: string
    name: string
    frequencyLabel: string
    budget: number
    actual: number
    variance: number
    budgetPct: number
    actualPct: number
    actualColor: string
    varianceColor: string
  }>
  unlinkedActual: number | null
}> {
  const excludedIds = excludedCategoryIdSet(categories)
  const byCategory: Record<string, number> = {}
  definitions.forEach((e) => {
    if (excludedIds.has(e.categoryId)) return
    const amount = toPeriod(amountsForYear[e.id] ?? 0, e.frequency, 'yearly')
    byCategory[e.categoryId] = (byCategory[e.categoryId] ?? 0) + amount
  })
  const actuals = actualByCategory(transactions, definitions, categories)
  return [...new Set([...categories.filter((c) => !excludedIds.has(c.id)).map((c) => c.id), ...Object.keys(byCategory), ...Object.keys(actuals)])]
    .sort((a, b) => (byCategory[b] ?? 0) - (byCategory[a] ?? 0))
    .map((categoryId) => {
      const amount = byCategory[categoryId] ?? 0
      const actual = actuals[categoryId] ?? 0
      const variance = amount - actual
      const categoryMax = Math.max(1, amount, actual)
      const name = categories.find((c) => c.id === categoryId)?.name ?? categoryId
      const catDefs = definitions.filter((d) => d.categoryId === categoryId && !excludedIds.has(categoryId))
      const catTx = transactions.filter((t) => effectiveCategoryId(t, definitions) === categoryId)
      const linkedIds = new Set(catDefs.map((d) => d.id))
      const unlinkedSum = catTx
        .filter((t) => !t.spendExpenseId || !linkedIds.has(t.spendExpenseId))
        .reduce((sum, t) => sum - t.amount, 0)
      return {
        categoryId,
        name,
        amount,
        actual,
        variance,
        budgetPct: (amount / categoryMax) * 100,
        actualPct: (actual / categoryMax) * 100,
        actualColor: variance >= 0 ? '#3b6ef6' : LOSS_COLOR,
        varianceColor: variance >= 0 ? GAIN_COLOR : LOSS_COLOR,
        drillLines: catDefs.map((catDef) => {
          const budget = toPeriod(amountsForYear[catDef.id] ?? 0, catDef.frequency, 'yearly')
          const actualForExp = catTx
            .filter((t) => t.spendExpenseId === catDef.id)
            .reduce((sum, t) => sum - t.amount, 0)
          const drillVariance = budget - actualForExp
          const drillMax = Math.max(1, budget, actualForExp)
          return {
            id: catDef.id,
            name: catDef.name,
            frequencyLabel: catDef.frequency === 'monthly' ? 'Monthly' : 'Yearly',
            budget,
            actual: actualForExp,
            variance: drillVariance,
            budgetPct: (budget / drillMax) * 100,
            actualPct: (actualForExp / drillMax) * 100,
            actualColor: drillVariance >= 0 ? '#3b6ef6' : LOSS_COLOR,
            varianceColor: drillVariance >= 0 ? GAIN_COLOR : LOSS_COLOR
          }
        }),
        unlinkedActual: unlinkedSum !== 0 ? unlinkedSum : null
      }
    })
}

/**
 * Category mappings for a given expense, sorted alphabetically by substring.
 */
export function mappingsForExpense(mappings: CategoryMapping[], spendExpenseId: string): CategoryMapping[] {
  return mappings
    .filter((m) => m.spendExpenseId === spendExpenseId && !m.deletedAt)
    .sort((a, b) => a.substring.localeCompare(b.substring))
}

/**
 * Categories whose latest-year actual monthly average spend exceeds their budgeted
 * monthly amount by more than 15%. Uses `years[0]` (assumed most-recent-first) as the
 * latest year, resolving that year's expense snapshot via analytics-year resolution.
 */
export function overBudgetConcern(
  years: string[],
  transactions: BudgetTransaction[],
  categories: Category[],
  definitions: ExpenseDefinition[],
  amountsByYear: Record<string, Record<string, number>>
): { count: number; categoryNames: string[] } {
  if (years.length === 0) return { count: 0, categoryNames: [] }
  const latestYear = years[0]
  const amounts = resolveExpenseAmountsForAnalyticsYear(amountsByYear, latestYear)
  const monthCount = monthsPresentInYear(transactions, categories, latestYear, definitions).length
  const categoryNames: string[] = []
  definitions.forEach((definition) => {
    const amount = amounts[definition.id]
    if (amount === undefined) return
    const monthlyBudget = toPeriod(amount, definition.frequency, 'monthly')
    const totalActual = yearCategoryTotalSpend(transactions, categories, latestYear, definition.categoryId, definitions)
    const monthlyActualAvg = monthCount === 0 ? 0 : totalActual / monthCount
    if (monthlyActualAvg > monthlyBudget * 1.15) {
      const name = categories.find((c) => c.id === definition.categoryId)?.name ?? definition.categoryId
      categoryNames.push(name)
    }
  })
  return { count: categoryNames.length, categoryNames }
}

/**
 * Percent change in monthly-average total spend between the two most recent years
 * (years[1] -> years[0]). Returns null if fewer than 2 years, or if the prior year's
 * monthly average is 0 (undefined percent change).
 */
export function spendTrendConcern(
  years: string[],
  transactions: BudgetTransaction[],
  categories: Category[],
  definitions: ExpenseDefinition[]
): { pctChange: number } | null {
  if (years.length < 2) return null
  const last = years[0]
  const prev = years[1]
  const lastMonths = monthsPresentInYear(transactions, categories, last, definitions).length
  const prevMonths = monthsPresentInYear(transactions, categories, prev, definitions).length
  if (lastMonths === 0 || prevMonths === 0) return null
  const lastAvg = yearTotalSpend(transactions, categories, last, definitions) / lastMonths
  const prevAvg = yearTotalSpend(transactions, categories, prev, definitions) / prevMonths
  if (prevAvg === 0) return null
  const pctChange = (lastAvg / prevAvg - 1) * 100
  return { pctChange }
}

/**
 * The single (year, month) across all given years with the highest population
 * z-score of total spend. Uses population stddev (divide by N). Returns null if
 * there's no data at all, or if stddev is 0 (no meaningful spike).
 */
export function spikeMonthConcern(
  years: string[],
  transactions: BudgetTransaction[],
  categories: Category[],
  definitions: ExpenseDefinition[]
): { year: string; month: number; total: number; zScore: number } | null {
  const points: Array<{ year: string; month: number; total: number }> = []
  years.forEach((year) => {
    monthsPresentInYear(transactions, categories, year, definitions).forEach((month) => {
      points.push({ year, month, total: monthTotalSpend(transactions, categories, year, month, definitions) })
    })
  })
  if (points.length === 0) return null
  const n = points.length
  const mean = points.reduce((sum, p) => sum + p.total, 0) / n
  const variance = points.reduce((sum, p) => sum + (p.total - mean) ** 2, 0) / n
  const stddev = Math.sqrt(variance)
  if (stddev === 0) return null
  let best = points[0]
  let bestZ = (points[0].total - mean) / stddev
  for (const p of points) {
    const z = (p.total - mean) / stddev
    if (z > bestZ) {
      bestZ = z
      best = p
    }
  }
  return { year: best.year, month: best.month, total: best.total, zScore: bestZ }
}

/**
 * Drop in savings rate (%) between the chronologically-earliest and latest of the
 * given years (years[0] = latest, years[years.length-1] = earliest considered).
 * Returns null if fewer than 2 years, or if either endpoint's yearly income is 0 or has
 * no month activity that year.
 */
export function savingsRateShrinkingConcern(
  years: string[],
  transactions: BudgetTransaction[],
  categories: Category[],
    definitions: ExpenseDefinition[]
): { firstYear: string; firstRate: number; lastYear: string; lastRate: number; drop: number } | null {
  if (years.length < 2) return null
  const lastYear = years[0]
  const firstYear = years[years.length - 1]

  const rateFor = (year: string): number | null => {
    const totalIncome = actualIncomeForYear(transactions, categories, definitions, year)
    if (totalIncome === 0) return null
    const monthCount = monthsPresentInYear(transactions, categories, year, definitions).length
    if (monthCount === 0) return null
    const spend = yearTotalSpend(transactions, categories, year, definitions)
    return ((totalIncome - spend) / totalIncome) * 100
  }

  const firstRate = rateFor(firstYear)
  const lastRate = rateFor(lastYear)
  if (firstRate === null || lastRate === null) return null
  return { firstYear, firstRate, lastYear, lastRate, drop: firstRate - lastRate }
}

/**
 * Top spending category's share of total spend in the latest year, and whether
 * that share exceeds 40% ("high risk" concentration). Excludes excludeFromSpend
 * and deleted categories from the ranking pool. Returns null if there's no year
 * or total spend is 0.
 */
export function concentrationRiskConcern(
  years: string[],
  transactions: BudgetTransaction[],
  categories: Category[],
  definitions: ExpenseDefinition[]
): { categoryName: string; topSharePct: number; isHighRisk: boolean } | null {
  if (years.length === 0) return null
  const latestYear = years[0]
  const total = yearTotalSpend(transactions, categories, latestYear, definitions)
  if (total === 0) return null
  const pool = categories.filter((c) => !c.excludeFromSpend && !c.deletedAt)
  const ranked: Array<{ name: string; amount: number }> = pool.map((c) => ({
    name: c.name,
    amount: yearCategoryTotalSpend(transactions, categories, latestYear, c.id, definitions)
  }))
  const top = ranked.reduce<{ name: string; amount: number } | null>(
    (best, cur) => (!best || cur.amount > best.amount ? cur : best),
    null
  )
  if (!top || top.amount === 0) return null
  const topSharePct = (top.amount / total) * 100
  return { categoryName: top.name, topSharePct, isHighRisk: topSharePct > 40 }
}

/**
 * Savings rate (%) per year: (income - spend) / income * 100. Income for a year
 * is the resolved yearly income figure. Returns pct: 0 (not NaN/Infinity) when
 * income is 0. Order matches input `years`.
 */
export function savingsRateByYear(
  years: string[],
  transactions: BudgetTransaction[],
  categories: Category[],
    definitions: ExpenseDefinition[]
): Array<{ year: string; pct: number; isPositive: boolean }> {
  return years.map((year) => {
    const income = actualIncomeForYear(transactions, categories, definitions, year)
    const spend = yearTotalSpend(transactions, categories, year, definitions)
    const pct = income > 0 ? ((income - spend) / income) * 100 : 0
    return { year, pct, isPositive: pct >= 0 }
  })
}

/**
 * Placeholder qualitative palette for category-share-over-time chart (no
 * --chart-* CSS custom properties exist in styles.css as of this writing).
 * Categories ranked beyond the 6th share this array's last color.
 */
export const CATEGORY_SHARE_PALETTE = ['#3b6ef6', '#1fa971', '#e2574c', '#f2b134', '#8b5cf6', '#06b6d4']

export type StreamBand = {
  categoryId: string
  label: string
  color: string
  d: string
}

export type LegendEntry = {
  categoryId: string
  label: string
  color: string
  total: number
}

/**
 * Stacked annual actual-spend areas for the Expense Stream chart's
 * 1120 x 220 viewBox. Only years with non-excluded spend activity render.
 */
export function expenseStreamBands(
  transactions: BudgetTransaction[],
  categories: Category[],
  definitions: ExpenseDefinition[]
): { years: string[]; bands: StreamBand[]; legend: LegendEntry[] } {
  const years = [...new Set(transactions.map((transaction) => transaction.date.slice(0, 4)))]
    .filter((year) => monthsPresentInYear(transactions, categories, year, definitions).length > 0)
    .sort()
  if (years.length === 0) return { years: [], bands: [], legend: [] }

  const excludedIds = excludedCategoryIdSet(categories)
  const ranked = categories
    .filter((category) => !excludedIds.has(category.id) && !category.deletedAt)
    .map((category) => ({
      category,
      total: years.reduce(
        (sum, year) => sum + Math.max(0, yearCategoryTotalSpend(transactions, categories, year, category.id, definitions)),
        0
      )
    }))
    .filter(({ total }) => total > 0)
    .sort((a, b) => b.total - a.total || a.category.name.localeCompare(b.category.name))
  if (ranked.length === 0) return { years, bands: [], legend: [] }

  const values = ranked.map(({ category }) =>
    years.map((year) => Math.max(0, yearCategoryTotalSpend(transactions, categories, year, category.id, definitions)))
  )
  const maxTotal = Math.max(...years.map((_, yearIndex) => values.reduce((sum, categoryValues) => sum + categoryValues[yearIndex], 0)), 1)
  const xFor = (index: number) => 60 + (1000 * index) / Math.max(years.length - 1, 1)
  const yFor = (amount: number) => 200 - (amount / maxTotal) * 180
  const lower = years.map(() => 0)

  const bands = ranked.map(({ category }, categoryIndex) => {
    const upper = lower.map((value, yearIndex) => value + values[categoryIndex][yearIndex])
    const topPath = upper.map((value, yearIndex) => `${yearIndex === 0 ? 'M' : 'L'} ${xFor(yearIndex)} ${yFor(value)}`).join(' ')
    const bottomPath = lower
      .map((_, yearIndex) => `L ${xFor(years.length - 1 - yearIndex)} ${yFor(lower[years.length - 1 - yearIndex])}`)
      .join(' ')
    lower.splice(0, lower.length, ...upper)
    return {
      categoryId: category.id,
      label: category.name,
      color: CATEGORY_SHARE_PALETTE[Math.min(categoryIndex, CATEGORY_SHARE_PALETTE.length - 1)],
      d: `${topPath} ${bottomPath} Z`
    }
  })

  return {
    years,
    bands,
    legend: ranked.map(({ category, total }, index) => ({
      categoryId: category.id,
      label: category.name,
      color: CATEGORY_SHARE_PALETTE[Math.min(index, CATEGORY_SHARE_PALETTE.length - 1)],
      total
    }))
  }
}

/**
 * Per-year category share-of-spend breakdown, for a stacked/area chart.
 * Segment order and color assignment are both driven by each category's total
 * in the LATEST year (years[0], assumed sorted descending) so the visual order
 * stays stable across years even if a category's own rank shifts year to year.
 * Excludes excludeFromSpend and deleted categories entirely. legend holds the
 * top 6 ranked categories; rows include ALL ranked categories per year (low-rank
 * ones just get small/zero segments). Guards divide-by-zero: a year with 0 total
 * spend gets 0% for every segment.
 */
export function categoryShareOverTime(
  years: string[],
  transactions: BudgetTransaction[],
  categories: Category[],
  definitions: ExpenseDefinition[]
): {
  legend: Array<{ categoryId: string; name: string; color: string }>
  rows: Array<{ year: string; segments: Array<{ categoryId: string; name: string; pct: number; color: string }> }>
} {
  const excludedIds = excludedCategoryIdSet(categories)
  const pool = categories.filter((c) => !excludedIds.has(c.id) && !c.deletedAt)
  const latestYear = years[0]
  const ranked = [...pool].sort((a, b) => {
    const aTotal = latestYear ? yearCategoryTotalSpend(transactions, categories, latestYear, a.id, definitions) : 0
    const bTotal = latestYear ? yearCategoryTotalSpend(transactions, categories, latestYear, b.id, definitions) : 0
    return bTotal - aTotal
  })
  const colorFor = (index: number): string =>
    CATEGORY_SHARE_PALETTE[Math.min(index, CATEGORY_SHARE_PALETTE.length - 1)]

  const legend = ranked.slice(0, 6).map((c, i) => ({ categoryId: c.id, name: c.name, color: colorFor(i) }))

  const rows = years.map((year) => {
    const total = yearTotalSpend(transactions, categories, year, definitions)
    const segments = ranked.map((c, i) => {
      const amount = yearCategoryTotalSpend(transactions, categories, year, c.id, definitions)
      const pct = total > 0 ? (amount / total) * 100 : 0
      return { categoryId: c.id, name: c.name, pct, color: colorFor(i) }
    })
    return { year, segments }
  })

  return { legend, rows }
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * Average actual spend per calendar month (1-12) across the given years, counting
 * only years that have that month present in `monthsPresentInYear` (a year missing
 * a month does not dilute that month's average with a 0). Flags the single highest
 * month as `isPeak` (first occurring on ties).
 */
export function monthlySeasonality(
  years: string[],
  transactions: BudgetTransaction[],
  categories: Category[],
  definitions: ExpenseDefinition[]
): Array<{ month: number; label: string; avgSpend: number; isPeak: boolean }> {
  const presentByYear = new Map(years.map((y) => [y, monthsPresentInYear(transactions, categories, y, definitions)]))

  const months = Array.from({ length: 12 }, (_, i) => {
    const month = i + 1
    const yearsWithMonth = years.filter((y) => presentByYear.get(y)!.includes(month))
    const avgSpend =
      yearsWithMonth.length === 0
        ? 0
        : yearsWithMonth.reduce((sum, y) => sum + monthTotalSpend(transactions, categories, y, month, definitions), 0) /
          yearsWithMonth.length
    return { month, label: MONTH_LABELS[i], avgSpend }
  })

  let peakIndex = 0
  months.forEach((m, i) => {
    if (m.avgSpend > months[peakIndex].avgSpend) peakIndex = i
  })

  return months.map((m, i) => ({ ...m, isPeak: i === peakIndex }))
}

/**
 * Budget-vs-actual accuracy per year: budgetTotal is the resolved monthly expense
 * snapshot (own year, else current-year fallback) scaled by the number of months
 * actually present that year; actualTotal is the real spend total. variance >= 0
 * means under/at budget, negative means over budget. budgetPct/actualPct are each
 * relative to the larger of the two totals (floored at 1 to avoid divide-by-zero).
 */
export function budgetAccuracyByYear(
  years: string[],
  transactions: BudgetTransaction[],
  categories: Category[],
  definitions: ExpenseDefinition[],
  amountsByYear: Record<string, Record<string, number>>
): Array<{ year: string; budgetTotal: number; actualTotal: number; variance: number; budgetPct: number; actualPct: number }> {
  return years.map((year) => {
    const amounts = resolveExpenseAmountsForAnalyticsYear(amountsByYear, year)
    const excludedIds = excludedCategoryIdSet(categories)
    const monthlyBudget = definitions.reduce((sum, d) => {
      if (excludedIds.has(d.categoryId)) return sum
      const amount = amounts[d.id]
      return amount === undefined ? sum : sum + toPeriod(amount, d.frequency, 'monthly')
    }, 0)
    const monthCount = monthsPresentInYear(transactions, categories, year, definitions).length
    const budgetTotal = monthlyBudget * monthCount
    const actualTotal = yearTotalSpend(transactions, categories, year, definitions)
    const variance = budgetTotal - actualTotal
    const denom = Math.max(budgetTotal, actualTotal, 1)
    return {
      year,
      budgetTotal,
      actualTotal,
      variance,
      budgetPct: (budgetTotal / denom) * 100,
      actualPct: (actualTotal / denom) * 100
    }
  })
}

/**
 * Per-category year-over-year monthly-average spend comparison between the two most
 * recent years (years[0] = last, years[1] = prev). Returns null if fewer than 2 years.
 * Includes only non-excluded, non-deleted categories with a nonzero total in `last` or
 * `prev`. `totalsByYear` carries one entry per year in the full `years` array (not just
 * the last/prev pair) so a rendering table can show every year as a column.
 *
 * Edge case convention: when `prev`'s monthly average is 0 and `last`'s is > 0, `delta`
 * is set to a fixed sentinel of 100 (i.e. treated as a "+100%" jump) rather than +Infinity,
 * since percent-change from a true zero base is undefined. When both are 0, `delta` is 0.
 */
export function categoryTrendsYoY(
  years: string[],
  transactions: BudgetTransaction[],
  categories: Category[],
  definitions: ExpenseDefinition[],
  amountsByYear: Record<string, Record<string, number>>
): {
  year1: string
  year2: string
  rows: Array<{ categoryId: string; name: string; totalsByYear: Record<string, number>; delta: number; overBudget: boolean }>
} | null {
  if (years.length < 2) return null
  const last = years[0]
  const prev = years[1]
  const excludedIds = excludedCategoryIdSet(categories)
  const lastMonths = monthsPresentInYear(transactions, categories, last, definitions).length
  const prevMonths = monthsPresentInYear(transactions, categories, prev, definitions).length
  const amounts = resolveExpenseAmountsForAnalyticsYear(amountsByYear, last)

  const eligible = categories.filter((c) => !excludedIds.has(c.id) && !c.deletedAt)

  const rows = eligible
    .map((cat) => {
      const lastTotal = yearCategoryTotalSpend(transactions, categories, last, cat.id, definitions)
      const prevTotal = yearCategoryTotalSpend(transactions, categories, prev, cat.id, definitions)
      if (lastTotal === 0 && prevTotal === 0) return null

      const totalsByYear: Record<string, number> = {}
      years.forEach((y) => {
        totalsByYear[y] = yearCategoryTotalSpend(transactions, categories, y, cat.id, definitions)
      })

      const lastAvg = lastMonths === 0 ? 0 : lastTotal / lastMonths
      const prevAvg = prevMonths === 0 ? 0 : prevTotal / prevMonths
      let delta: number
      if (prevAvg === 0) {
        delta = lastAvg === 0 ? 0 : 100
      } else {
        delta = (lastAvg / prevAvg - 1) * 100
      }

      const definition = definitions.find((d) => d.categoryId === cat.id)
      const amount = definition ? amounts[definition.id] : undefined
      let overBudget = false
      if (definition && amount !== undefined) {
        const monthlyBudget = toPeriod(amount, definition.frequency, 'monthly')
        overBudget = lastAvg > monthlyBudget * 1.15
      }

      return { categoryId: cat.id, name: cat.name, totalsByYear, delta, overBudget }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)

  rows.sort((a, b) => b.delta - a.delta)

  return { year1: last, year2: prev, rows }
}

/**
 * Top 3 categories by dollar increase and top 3 by dollar decrease in monthly-average
 * spend between the two most recent years (years[0] = last, years[1] = prev). Excludes
 * excludeFromSpend/deleted categories. `increases` only includes diff > 0 entries (may
 * be fewer than 3); `decreases` only includes diff < 0 entries, ordered most-negative
 * first, and may also be fewer than 3. Returns null if fewer than 2 years.
 */
export function topMovers(
  years: string[],
  transactions: BudgetTransaction[],
  categories: Category[],
  definitions: ExpenseDefinition[]
): {
  increases: Array<{ categoryId: string; name: string; diff: number }>
  decreases: Array<{ categoryId: string; name: string; diff: number }>
} | null {
  if (years.length < 2) return null
  const last = years[0]
  const prev = years[1]
  const excludedIds = excludedCategoryIdSet(categories)
  const lastMonths = monthsPresentInYear(transactions, categories, last, definitions).length
  const prevMonths = monthsPresentInYear(transactions, categories, prev, definitions).length

  const eligible = categories.filter((c) => !excludedIds.has(c.id) && !c.deletedAt)

  const diffs = eligible.map((cat) => {
    const curMonthlyAvg = lastMonths === 0 ? 0 : yearCategoryTotalSpend(transactions, categories, last, cat.id, definitions) / lastMonths
    const prevMonthlyAvg = prevMonths === 0 ? 0 : yearCategoryTotalSpend(transactions, categories, prev, cat.id, definitions) / prevMonths
    return { categoryId: cat.id, name: cat.name, diff: curMonthlyAvg - prevMonthlyAvg }
  })

  diffs.sort((a, b) => b.diff - a.diff)

  const increases = diffs.filter((d) => d.diff > 0).slice(0, 3)
  const decreases = diffs
    .filter((d) => d.diff < 0)
    .slice(-3)
    .reverse()

  return { increases, decreases }
}

/**
 * Resolve the effective category for a Budget transaction, following a linked
 * Expense (via spendExpenseId) when present so the expense's own category wins.
 * Falls back to the transaction's own categoryId if unlinked, or if the linked
 * expense definition can't be found (deleted, etc). Definitions are global/
 * year-independent, so no year-based lookup is needed.
 */
export function effectiveCategoryId(tx: BudgetTransaction, definitions: ExpenseDefinition[]): string {
  if (!tx.spendExpenseId) return tx.categoryId
  const definition = definitions.find((d) => d.id === tx.spendExpenseId)
  return definition ? definition.categoryId : tx.categoryId
}

/**
 * Shared display-label formatter for a Budget transaction's spend category,
 * used by both SpendCategoryPicker (dropdown option labels) and BudgetPage
 * (read-only cell). Mirrors SpendCategoryPicker's "<expense name> (<category
 * name>)" format when the transaction is linked to a resolvable Expense
 * definition; falls back to "Uncategorized (<category name>)" when unlinked or
 * when the link is stale (expense not found). If the category itself can't be
 * resolved via categoriesById, falls back to the raw id.
 */
export function formatSpendCategoryLabel(
  spendExpenseId: string | undefined,
  categoryId: string,
  definitions: ExpenseDefinition[],
  categoriesById: Map<string, string>
): string {
  const categoryLabel = categoriesById.get(categoryId) ?? categoryId
  if (spendExpenseId) {
    const definition = definitions.find((d) => d.id === spendExpenseId)
    if (definition) return `${definition.name} (${categoryLabel})`
  }
  return `Uncategorized (${categoryLabel})`
}
