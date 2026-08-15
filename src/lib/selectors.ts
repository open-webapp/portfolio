import type { AppState } from './state'
import type { Position, ClosedPosition, Transaction, TaxCategory } from './types'
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

