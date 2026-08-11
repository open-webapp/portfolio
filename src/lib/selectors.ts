import type { AppState } from './state'
import type { Position, Transaction, Account } from './types'
import { sortBy } from './sort'
import { allocationByAssetClass, fmtUSD, fmtPct, computePosition } from './computations'

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

  // Apply retirement filter
  if (state.retirementFilter === 'Retirement') {
    results = results.filter((p) => {
      const account = state.accounts.find((a) => a.id === p.accountId)
      return account?.retirement === true
    })
  } else if (state.retirementFilter === 'Non-Retirement') {
    results = results.filter((p) => {
      const account = state.accounts.find((a) => a.id === p.accountId)
      return account?.retirement === false
    })
  }

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
 * Compute total market value of positions filtered by category and retirement status.
 * This is the denominator for portfolio percentage calculations.
 * Does NOT apply asset-class or search filters — only category and retirement filters.
 * Returns the sum of all filtered positions' market values (can be zero, negative, or positive).
 */
export function filteredPortfolioTotal(state: AppState): number {
  const accountsInCategory = getAccountsForCategory(state)
  let results = state.positions.filter((p) =>
    accountsInCategory.some((a) => a.id === p.accountId)
  )

  // Apply retirement filter (same logic as visiblePositions)
  if (state.retirementFilter === 'Retirement') {
    results = results.filter((p) => {
      const account = state.accounts.find((a) => a.id === p.accountId)
      return account?.retirement === true
    })
  } else if (state.retirementFilter === 'Non-Retirement') {
    results = results.filter((p) => {
      const account = state.accounts.find((a) => a.id === p.accountId)
      return account?.retirement === false
    })
  }

  // Sum market values across all filtered positions
  return results.reduce((sum, p) => sum + computePosition(p).marketValue, 0)
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
 * Generate summary cards filtered by category and retirement status.
 * Returns the same three cards as valueGlInvestedCards (Total Value, Total Gain/Loss, Amount Invested)
 * but for positions in the selected category that match the retirement filter.
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
  const accountsInCategory = getAccountsForCategory(state)
  let filteredPositions = state.positions.filter((p) =>
    accountsInCategory.some((a) => a.id === p.accountId)
  )

  // Apply retirement filter
  filteredPositions = filteredPositions.filter((p) => {
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
 * Get all accounts that match the currently-selected category filter.
 * Returns all accounts if category is 'all'.
 */
function getAccountsForCategory(state: AppState): Account[] {
  if (state.category === 'all') {
    return state.accounts
  }
  return state.accounts.filter((a) => a.taxCategory === state.category)
}

