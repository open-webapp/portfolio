import type { Position, Expense } from './types'

/**
 * Shared color constants for gain/loss display.
 * v11 theme: GAIN='#1fa971' (green), LOSS='#e2574c' (red)
 */
export const GAIN_COLOR = '#1fa971'
export const LOSS_COLOR = '#e2574c'

/**
 * Returns the appropriate gain/loss color based on GL value.
 * Positive (>= 0) returns green, negative returns red.
 */
export function glColor(gl: number): string {
  return gl >= 0 ? GAIN_COLOR : LOSS_COLOR
}

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
 * Format a value as a percentage of total portfolio.
 * If total <= 0, returns "—"; otherwise returns percentage with 1 decimal place.
 * Examples: 12.3%, 0.5%, -5.2%, —
 */
export function fmtPortfolioPercent(value: number, total: number): string {
  if (total <= 0) {
    return '—'
  }
  return ((value / total) * 100).toFixed(1) + '%'
}

export const DEFAULT_CATEGORIES = [
  'Housing', 'Utilities', 'Groceries', 'Transportation', 'Insurance',
  'Subscriptions', 'Health', 'Entertainment', 'Debt/Loans', 'Savings', 'Other',
] as const

export function toMonthly(amount: number, freq: Expense['frequency']): number {
  return freq === 'yearly' ? amount / 12 : amount
}

export function toYearly(amount: number, freq: Expense['frequency']): number {
  return freq === 'yearly' ? amount : amount * 12
}

export function toPeriod(amount: number, freq: Expense['frequency'], period: 'monthly' | 'yearly'): number {
  return period === 'monthly' ? toMonthly(amount, freq) : toYearly(amount, freq)
}

/**
 * Compute derived fields for a position.
 * Adds: marketValue, costBasis, gl (gain/loss), glPct (return percentage)
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

/**
 * Extract all unique asset classes from positions (including manual overrides).
 * Returns sorted alphabetically.
 */
export function getAllExistingAssetClasses(positions: Position[]): string[] {
  const classes = new Set<string>()
  positions.forEach(p => {
    // Include manual override if it exists, otherwise the computed asset class
    classes.add(p.assetClassManualOverride || p.assetClass)
  })
  return Array.from(classes).sort()
}

/**
 * Parse a raw CSV string of budget actual-spend transactions.
 * Crude, deliberately non-RFC4180 parser (no quoting/escaping support) per spec.
 * Header-detection heuristic: drop the first line only if its last comma-separated
 * field does NOT parse as a float (this is a known quirk, not a bug — a data row
 * whose amount field happens to be non-numeric will also be dropped).
 */
export function parseBudgetTransactionsCsv(text: string): Array<{ date: string; description: string; category: string; amount: number }> {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  let rows = lines
  if (rows.length && isNaN(parseFloat(rows[0].split(',').pop() ?? ''))) rows = rows.slice(1)
  const parsed: Array<{ date: string; description: string; category: string; amount: number }> = []
  rows.forEach((line) => {
    const parts = line.split(',').map((p) => p.trim())
    if (parts.length < 4) return
    const [date, description, category, amountStr] = parts
    const amount = parseFloat(amountStr)
    if (!date || isNaN(amount)) return
    parsed.push({ date, description, category: category || 'Other', amount })
  })
  return parsed
}
