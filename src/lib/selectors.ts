import type { AppState } from './state'
import type { Position, Transaction, Account } from './types'
import { sortBy } from './sort'
import { allocationByAssetClass, fmtUSD, fmtPct } from './computations'

/**
 * Filter positions by asset class, search text, and sort according to state.
 * Applies asset-class filter (or 'All' for everything), search on symbol/name (case-insensitive),
 * and sorts by the current sortKey/sortDir.
 */
export function visiblePositions(state: AppState): Position[] {
  // Start with all positions for accounts in the selected category
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
 * Filter transactions by type and search text.
 * Applies type filter (or 'All' for everything) and search on symbol/date (case-insensitive).
 */
export function visibleTransactions(state: AppState): Transaction[] {
  // Start with all transactions for accounts in the selected category
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
 * Generate a time series of portfolio values by date.
 * Groups snapshots by date and sums market value across the specified account set.
 * If accountIds not provided, uses all accounts in the selected category.
 */
export function totalValueSeries(
  state: AppState,
  accountIds?: string[]
): Array<{ date: string; value: number }> {
  // Determine which accounts to include
  const targetAccountIds = accountIds
    ? new Set(accountIds)
    : new Set(getAccountsForCategory(state).map((a) => a.id))

  // Group snapshots by date and sum values
  const byDate: Record<string, number> = {}
  state.snapshots.forEach((snap) => {
    if (targetAccountIds.has(snap.accountId)) {
      byDate[snap.date] = (byDate[snap.date] || 0) + snap.value
    }
  })

  // Convert to array and sort by date ascending
  const series = Object.entries(byDate)
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => a.date.localeCompare(b.date))

  return series
}

/**
 * Compute total taxes paid across all transactions in the current category.
 * Treats null taxes values as 0 in aggregation.
 */
export function totalTaxesPaid(state: AppState): number {
  const accountsInCategory = getAccountsForCategory(state)
  const transactionsInCategory = state.transactions.filter((t) =>
    accountsInCategory.some((a) => a.id === t.accountId)
  )
  return transactionsInCategory.reduce((sum, t) => sum + (t.taxes ?? 0), 0)
}

/**
 * Generate summary cards for Total Value, Day Change, Total Gain/Loss, Cost Basis, and Total Taxes Paid.
 * All values are for positions in the currently-selected category's accounts.
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
  const GAIN = 'var(--color-accent-700)'
  const LOSS = '#8a3c2e'

  const accountsInCategory = getAccountsForCategory(state)
  const positionsInCategory = state.positions.filter((p) =>
    accountsInCategory.some((a) => a.id === p.accountId)
  )

  // Total Value: sum of all open positions' market value
  const totalValue = positionsInCategory.reduce((sum, p) => {
    return sum + p.shares * p.price
  }, 0)

  // Day Change: delta between last two totalValueSeries points (as USD value, not percentage)
  const series = totalValueSeries(state)
  let dayChange = 0
  let dayChangeStr = '$0.00'
  if (series.length >= 2) {
    const lastValue = series[series.length - 1].value
    const prevValue = series[series.length - 2].value
    dayChange = lastValue - prevValue
    dayChangeStr = (dayChange >= 0 ? '+' : '') + fmtUSD(dayChange)
  } else {
    // Fewer than 2 points: Day Change is N/A
    dayChangeStr = 'N/A'
  }

  // Total Gain/Loss: sum of all positions' gl
  // Note: GL calculation uses only shares, price, and avgCost. Taxes field is not included.
  const totalGL = positionsInCategory.reduce((sum, p) => {
    const marketValue = p.shares * p.price
    const costBasis = p.shares * p.avgCost
    return sum + (marketValue - costBasis)
  }, 0)

  // Cost Basis: sum of all positions' costBasis
  // Note: Cost basis calculation uses only shares and avgCost. Taxes field is not included.
  const costBasis = positionsInCategory.reduce((sum, p) => {
    return sum + p.shares * p.avgCost
  }, 0)

  // Total GL percentage (for the sub field)
  const totalGLPct = costBasis === 0 ? 0 : (totalGL / costBasis) * 100

  // Total Taxes Paid: sum of all transaction taxes in the category
  const totalTaxes = totalTaxesPaid(state)

  return [
    {
      label: 'Total Value',
      value: fmtUSD(totalValue),
      color: 'var(--color-text)'
    },
    {
      label: 'Day Change',
      value: dayChangeStr,
      color: dayChange >= 0 ? GAIN : LOSS
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
    },
    {
      label: 'Total Taxes Paid',
      value: fmtUSD(totalTaxes),
      color: 'var(--color-text)'
    }
  ]
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
 * Filter a totalValueSeries by a Nav date-range value ('6m' | '1y' | 'ytd' | 'all').
 * Cutoff is computed from the current date; series entries strictly before the
 * cutoff are dropped. Unknown range values behave like 'all' (no filtering).
 */
export function totalValueSeriesInRange(
  state: AppState,
  range: string
): Array<{ date: string; value: number }> {
  const series = totalValueSeries(state)
  if (range === 'all' || series.length === 0) {
    return series
  }

  const now = new Date()
  let cutoff: Date
  switch (range) {
    case 'ytd':
      cutoff = new Date(now.getFullYear(), 0, 1)
      break
    case '6m':
      cutoff = new Date(now)
      cutoff.setMonth(cutoff.getMonth() - 6)
      break
    case '1y':
      cutoff = new Date(now)
      cutoff.setFullYear(cutoff.getFullYear() - 1)
      break
    default:
      return series
  }

  const cutoffStr = cutoff.toISOString().slice(0, 10)
  return series.filter((s) => s.date >= cutoffStr)
}

/**
 * Generate SVG polyline points from the performance series filtered by date range.
 * Points are normalized to fit a standard chart space (e.g., 0-500 on Y-axis, 0-100 on X).
 * Handles single-point series without divide-by-zero.
 */
export function performanceLinePoints(state: AppState, range: string): string {
  const filteredSeries = totalValueSeriesInRange(state, range)

  if (filteredSeries.length === 0) {
    return ''
  }

  if (filteredSeries.length === 1) {
    // Single point: place at center
    const x = 50
    const y = 250 // middle of 0-500 range
    return `${x},${y}`
  }

  // Multiple points: normalize to fit chart space
  const minValue = Math.min(...filteredSeries.map((s) => s.value))
  const maxValue = Math.max(...filteredSeries.map((s) => s.value))
  const valueRange = maxValue - minValue || 1 // Avoid divide by zero if all values are the same

  const yMin = 500
  const yMax = 0
  const xMin = 0
  const xMax = 100

  const points = filteredSeries.map((s, i) => {
    const x = xMin + ((i / (filteredSeries.length - 1)) * (xMax - xMin))
    const y = yMax + (((s.value - minValue) / valueRange) * (yMin - yMax))
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })

  return points.join(' ')
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
