import type { AppState } from './state'
import type { Position, Transaction, Account, TaxCategory } from './types'
import { sortBy } from './sort'
import { allocationByAssetClass, fmtUSD, fmtPct, computePosition, glColor } from './computations'

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
 * Private helper: compute total value and formatted GL string for a set of positions.
 * Returns { totalValueStr, glStr, glColor } for use in segment card display.
 */
function valueGlSummary(positions: Position[]): {
  totalValueStr: string
  glStr: string
  glColor: string
} {
  // Total Value: sum of all open positions' market value
  const totalValue = positions.reduce((sum, p) => {
    return sum + computePosition(p).marketValue
  }, 0)

  // Total Gain/Loss: sum of all positions' gl
  const totalGL = positions.reduce((sum, p) => {
    return sum + computePosition(p).gl
  }, 0)

  // Cost Basis: sum of all positions' costBasis
  const costBasis = positions.reduce((sum, p) => {
    return sum + computePosition(p).costBasis
  }, 0)

  // Total GL percentage
  const totalGLPct = costBasis === 0 ? 0 : (totalGL / costBasis) * 100

  return {
    totalValueStr: fmtUSD(totalValue),
    glStr: (totalGL >= 0 ? '+' : '') + fmtUSD(totalGL) + ' (' + fmtPct(totalGLPct) + ')',
    glColor: glColor(totalGL)
  }
}

/**
 * Generate segment card data (total value and GL) filtered by retirement status.
 * Returns { totalValueStr, glStr, glColor } for display in segment cards.
 */
export function segmentCards(
  state: AppState,
  retirement: boolean
): {
  totalValueStr: string
  glStr: string
  glColor: string
} {
  const filteredPositions = state.positions.filter((p) => {
    const account = state.accounts.find((a) => a.id === p.accountId)
    return account?.retirement === retirement
  })
  return valueGlSummary(filteredPositions)
}

/**
 * Get all positions scoped to the currently-selected category filter.
 * Returns all positions if category is 'all', otherwise only positions
 * from accounts in the selected tax category.
 */
export function positionsForCategory(state: AppState): Position[] {
  const accountsInCategory = getAccountsForCategory(state)
  return state.positions.filter((p) =>
    accountsInCategory.some((a) => a.id === p.accountId)
  )
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
        selected: state.selectedAccountId === account.id
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
 * Distinct effective asset classes among the given positions, sorted alphabetically.
 */
export function acctAssetClassOptions(positions: Position[]): string[] {
  const assetClasses = new Set<string>()
  positions.forEach((p) => {
    assetClasses.add(p.assetClassManualOverride || p.assetClass)
  })
  return Array.from(assetClasses).sort()
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
        (p.name?.toLowerCase().includes(searchLower) ?? false)
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

