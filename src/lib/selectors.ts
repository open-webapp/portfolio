import type { AppState } from './state'
import type { Position, Transaction, Account, TaxCategory } from './types'
import { sortBy } from './sort'
import { allocationByAssetClass, fmtUSD, fmtPct, computePosition } from './computations'

/**
 * Map tax category keys to display labels.
 */
export const CATEGORY_LABEL: Record<TaxCategory, string> = {
  taxable: 'Taxable',
  nonTaxable: 'Non-Taxable',
  taxDeferred: 'Tax-Deferred'
}

/**
 * Filter positions by asset class, search text, and sort according to state.
 * Applies asset-class filter (or 'All' for everything), search on symbol/name (case-insensitive),
 * and sorts by the current sortKey/sortDir.
 */
export function visiblePositions(state: AppState): Position[] {
  const accountsInCategory = getAccountsForCategory(state)
  let results = state.positions.filter((p) =>
    accountsInCategory.some((a) => a.id === p.accountId)
  )

  // Apply asset class filter
  if (state.assetClassFilter !== 'All') {
    results = results.filter((p) => {
      const effectiveClass = p.assetClassManualOverride || p.assetClass
      return effectiveClass === state.assetClassFilter
    })
  }

  // Apply search filter (on symbol or name, case-insensitive)
  // Note: name is nullable (display-only field). Null names don't exclude positions from search;
  // only symbol matching is used if name is null. Search correctly handles both cases.
  if (state.posSearch.trim()) {
    const searchLower = state.posSearch.toLowerCase()
    results = results.filter((p) =>
      p.symbol.toLowerCase().includes(searchLower) ||
      (p.name?.toLowerCase().includes(searchLower) ?? false)
    )
  }

  // Apply sort
  results = sortBy(results, state.sortKey, state.sortDir)

  return results
}

/**
 * Compute total market value of positions filtered by category.
 * This is the denominator for portfolio percentage calculations.
 * Does NOT apply asset-class or search filters — only category filter.
 * Returns the sum of all filtered positions' market values (can be zero, negative, or positive).
 */
export function filteredPortfolioTotal(state: AppState): number {
  const accountsInCategory = getAccountsForCategory(state)
  let results = state.positions.filter((p) =>
    accountsInCategory.some((a) => a.id === p.accountId)
  )

  // Sum market values across all filtered positions
  return results.reduce((sum, p) => sum + computePosition(p).marketValue, 0)
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
  const accountsInCategory = getAccountsForCategory(state)
  let results = state.transactions.filter((t) =>
    accountsInCategory.some((a) => a.id === t.accountId)
  )

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
 * Private helper: generate card data for Total Value, Total Gain/Loss, and Amount Invested.
 * Used by summaryCards() and segmentSummaryCards().
 */
function valueGlInvestedCards(
  positions: Position[]
): Array<{
  label: string
  value: string
  sub?: string
  color: string
}> {
  const GAIN = 'var(--color-accent-700)'
  const LOSS = '#8a3c2e'

  // Total Value: sum of all open positions' market value
  const totalValue = positions.reduce((sum, p) => {
    return sum + p.shares * p.price
  }, 0)

  // Total Gain/Loss: sum of all positions' gl
  const totalGL = positions.reduce((sum, p) => {
    const marketValue = p.shares * p.price
    const costBasis = p.shares * p.avgCost
    return sum + (marketValue - costBasis)
  }, 0)

  // Cost Basis: sum of all positions' costBasis
  const costBasis = positions.reduce((sum, p) => {
    return sum + p.shares * p.avgCost
  }, 0)

  // Total GL percentage (for the sub field)
  const totalGLPct = costBasis === 0 ? 0 : (totalGL / costBasis) * 100

  return [
    {
      label: 'Total Value',
      value: fmtUSD(totalValue),
      color: 'var(--color-text)'
    },
    {
      label: 'Total Gain/Loss',
      value: (totalGL >= 0 ? '+' : '') + fmtUSD(totalGL),
      sub: fmtPct(totalGLPct),
      color: totalGL >= 0 ? GAIN : LOSS
    },
    {
      label: 'Amount Invested',
      value: fmtUSD(costBasis),
      color: 'var(--color-text)'
    }
  ]
}

/**
 * Generate summary cards for Total Value, Total Gain/Loss, and Amount Invested.
 * Returns cards with formatted values, colors, and optional sub-values (percentages).
 */
export function summaryCards(
  state: AppState
): Array<{
  label: string
  value: string
  sub?: string
  color: string
}> {
  return valueGlInvestedCards(state.positions)
}

/**
 * Generate summary cards filtered by retirement status.
 * Returns the same three cards as valueGlInvestedCards (Total Value, Total Gain/Loss, Amount Invested)
 * but for positions in accounts matching the provided retirement status.
 */
export function segmentSummaryCards(
  state: AppState,
  retirement: boolean
): Array<{
  label: string
  value: string
  sub?: string
  color: string
}> {
  const filteredPositions = state.positions.filter((p) => {
    const account = state.accounts.find((a) => a.id === p.accountId)
    return account?.retirement === retirement
  })
  return valueGlInvestedCards(filteredPositions)
}

/**
 * Generate allocation bars by asset class.
 * Uses the computations.allocationByAssetClass() helper and formats values.
 * Note: Allocation percentages are market-value based and do not include taxes.
 */
export function allocationBars(
  state: AppState
): Array<{ label: string; value: string; pct: string }> {
  const accountsInCategory = getAccountsForCategory(state)
  const positionsInCategory = state.positions.filter((p) =>
    accountsInCategory.some((a) => a.id === p.accountId)
  )

  // Use the allocationByAssetClass helper (respects manual overrides)
  // Note: taxes field is not used in allocation calculations
  const allocationData = allocationByAssetClass(
    positionsInCategory.map((p) => ({
      ...p,
      assetClass: p.assetClassManualOverride || p.assetClass
    }))
  )

  return allocationData.map((item) => ({
    label: item.label,
    value: fmtUSD(item.value),
    pct: fmtPct(item.pct)
  }))
}

/**
 * Compute cash and investment totals for a specific account.
 * Cash is positions with symbol 'cash' (case-insensitive), investment is everything else.
 * Returns { cash, investment } as numeric values.
 */
export function computeCashInvestment(
  state: AppState,
  accountId: string
): { cash: number; investment: number } {
  const accountPositions = state.positions.filter((p) => p.accountId === accountId)
  let cash = 0
  let investment = 0

  accountPositions.forEach((p) => {
    const value = p.shares * p.price
    if ((p.symbol || '').toLowerCase() === 'cash') {
      cash += value
    } else {
      investment += value
    }
  })

  return { cash, investment }
}

/**
 * Generate sections grouped by tax category for the accounts view.
 * Each section contains rows for accounts in that category with cash/investment/total values.
 * Returns array of sections with labels, rows, and aggregate totals.
 */
export function accountsSections(
  state: AppState
): Array<{
  label: string
  rows: Array<{
    accountId: string
    institution: string
    accountName: string
    cashStr: string
    investmentStr: string
    totalStr: string
  }>
  hasRows: boolean
  noRows: boolean
  cashTotalStr: string
  investmentTotalStr: string
  grandTotalStr: string
  showDivider: boolean
}> {
  const catKeys = ['taxable', 'nonTaxable', 'taxDeferred'] as const

  return catKeys.map((catKey, idx) => {
    const label = CATEGORY_LABEL[catKey as TaxCategory]
    const accountsInCategory = state.accounts.filter((a) => a.taxCategory === catKey)

    let cashTotal = 0
    let investmentTotal = 0

    const rows = accountsInCategory.map((account) => {
      const { cash, investment } = computeCashInvestment(state, account.id)
      cashTotal += cash
      investmentTotal += investment

      const total = cash + investment

      return {
        accountId: account.id,
        institution: account.institution || '',
        accountName: `${account.name} (${account.accountNumber})`,
        cashStr: fmtUSD(cash),
        investmentStr: fmtUSD(investment),
        totalStr: fmtUSD(total)
      }
    })

    const grandTotal = cashTotal + investmentTotal

    return {
      label,
      rows,
      hasRows: rows.length > 0,
      noRows: rows.length === 0,
      cashTotalStr: fmtUSD(cashTotal),
      investmentTotalStr: fmtUSD(investmentTotal),
      grandTotalStr: fmtUSD(grandTotal),
      showDivider: idx < catKeys.length - 1
    }
  })
}

/**
 * Get all accounts that match the currently-selected category filter.
 * Returns all accounts if category is 'all'.
 */
function getAccountsForCategory(state: AppState): Account[] {
  if (state.category === 'all') {
    return state.accounts
  }
  return state.accounts.filter((a) => a.taxCategory === state.category)
}

