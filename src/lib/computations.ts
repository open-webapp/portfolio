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

const MONTH_NAME_MAP: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
}

/**
 * Normalize a raw date string from a budget CSV into ISO `YYYY-MM-DD` form.
 * Supports ISO passthrough, MM/DD/YYYY or MM-DD-YYYY (unconditionally, no
 * DD/MM fallback), and "Month D, YYYY" (full or 3-letter abbreviation).
 * Returns null for anything unparseable or out-of-range.
 */
function normalizeBudgetDate(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [, , monthStr, dayStr] = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/) ?? []
    const month = parseInt(monthStr, 10)
    const day = parseInt(dayStr, 10)
    if (month < 1 || month > 12 || day < 1 || day > 31) return null
    return trimmed
  }

  const slashMatch = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (slashMatch) {
    const month = parseInt(slashMatch[1], 10)
    const day = parseInt(slashMatch[2], 10)
    const year = slashMatch[3]
    if (month < 1 || month > 12 || day < 1 || day > 31) return null
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }

  const monthNameMatch = trimmed.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/)
  if (monthNameMatch) {
    const month = MONTH_NAME_MAP[monthNameMatch[1].toLowerCase()]
    if (!month) return null
    const day = parseInt(monthNameMatch[2], 10)
    const year = monthNameMatch[3]
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }

  return null
}

/**
 * Parse a raw CSV string of budget actual-spend transactions.
 * Crude, deliberately non-RFC4180 parser (no quoting/escaping support) per spec.
 * Header-detection heuristic: drop the first line only if its last comma-separated
 * field does NOT parse as a float (this is a known quirk, not a bug — a data row
 * whose amount field happens to be non-numeric will also be dropped).
 */
export function parseBudgetTransactionsCsv(text: string): Array<{ date: string; description: string; amount: number }> {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  let rows = lines
  if (rows.length && isNaN(parseFloat(rows[0].split(',').pop() ?? ''))) rows = rows.slice(1)
  const parsed: Array<{ date: string; description: string; amount: number }> = []
  rows.forEach((line) => {
    const parts = line.split(',').map((p) => p.trim())
    if (parts.length < 3) return
    const [date, description, amountStr] = parts
    const amount = parseFloat(amountStr)
    const normalizedDate = normalizeBudgetDate(date)
    if (!normalizedDate || isNaN(amount)) return
    parsed.push({ date: normalizedDate, description, amount })
  })
  return parsed
}

/**
 * Parses transactions out of an OFX (classic SGML, not valid XML) statement
 * export via string scanning rather than DOMParser. Flattens <STMTTRN>
 * blocks across every <STMTRS> account section in the file — no per-account
 * grouping in the output. Never throws; unparseable blocks are skipped and
 * a file with zero usable records yields [].
 */
export function parseOfxTransactions(text: string): Array<{ date: string; description: string; amount: number }> {
  const parsed: Array<{ date: string; description: string; amount: number }> = []
  const blockRe = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi
  const extract = (block: string, tag: string): string | null => {
    const m = new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i').exec(block)
    return m ? m[1].trim() : null
  }
  let match: RegExpExecArray | null
  while ((match = blockRe.exec(text)) !== null) {
    const block = match[1]
    const dtposted = extract(block, 'DTPOSTED')
    if (!dtposted) continue

    let date: string | null = null
    if (dtposted.length >= 8) {
      const y = dtposted.slice(0, 4)
      const m = dtposted.slice(4, 6)
      const d = dtposted.slice(6, 8)
      date = `${y}-${m}-${d}`
    } else if (dtposted.length >= 6) {
      const yy = dtposted.slice(0, 2)
      const m = dtposted.slice(2, 4)
      const d = dtposted.slice(4, 6)
      date = `20${yy}-${m}-${d}`
    }
    if (!date) continue

    const name = extract(block, 'NAME')
    const memo = extract(block, 'MEMO')
    const description = name && name.trim() ? name : memo && memo.trim() ? memo : null
    if (!description) continue

    const trnamtStr = extract(block, 'TRNAMT')
    if (trnamtStr === null) continue
    const amount = parseFloat(trnamtStr)
    if (isNaN(amount)) continue

    parsed.push({ date, description, amount })
  }
  return parsed
}
