import type { Position } from './types'

/**
 * Format a number as USD currency.
 * Examples: -$5.00, $1,234.56
 */
export function fmtUSD(n: number): string {
  const neg = n < 0
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return (neg ? '-$' : '$') + s
}

/**
 * Format a number as a percentage with sign.
 * Examples: +1.20%, -1.20%, 0.00%
 */
export function fmtPct(n: number): string {
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%'
}

/**
 * Compute derived fields for a position.
 * Adds: marketValue, costBasis, gl (gain/loss), glPct (return percentage)
 *
 * Note: taxes field is stored on Position but never used in calculations.
 * All formulas use only shares, price, and avgCost. Taxes are display-only.
 */
export function computePosition(p: Position): Position & {
  marketValue: number
  costBasis: number
  gl: number
  glPct: number
} {
  const marketValue = p.shares * p.price
  const costBasis = p.shares * p.avgCost
  const gl = marketValue - costBasis
  const glPct = costBasis === 0 ? 0 : (gl / costBasis) * 100

  return {
    ...p,
    marketValue,
    costBasis,
    gl,
    glPct
  }
}

/**
 * Group positions by asset class and calculate allocation percentages.
 * Returns entries sorted by market value descending.
 *
 * Note: Allocation calculation uses only marketValue (shares * price) and ignores taxes field.
 * Allocation percentages are pure market-based metrics, not tax-adjusted.
 */
export function allocationByAssetClass(
  positions: Position[]
): Array<{ label: string; value: number; pct: number }> {
  // Sum market values by asset class
  const byClass: Record<string, number> = {}
  positions.forEach(p => {
    const marketValue = p.shares * p.price
    byClass[p.assetClass] = (byClass[p.assetClass] || 0) + marketValue
  })

  const totalValue = Object.values(byClass).reduce((sum, val) => sum + val, 0)

  // If no positions, return empty array
  if (totalValue === 0) {
    return []
  }

  // Convert to array and sort by value descending
  const entries = Object.entries(byClass)
    .map(([cls, val]) => ({
      label: cls,
      value: val,
      pct: (val / totalValue) * 100
    }))
    .sort((a, b) => b.value - a.value)

  return entries
}
